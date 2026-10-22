/**
 * Studilla – 2048.
 * Klassisk 4x4-brikkespill: skyv brikkene med piltaster/swipe, slå sammen
 * like tall, og jag den store 2048-brikken. Brikkene har egne DOM-elementer
 * som sklir fra rute til rute (i stedet for å hoppe rett dit), slik det
 * originale 2048-spillet gjør. Bruker den delte spill-kjøretiden
 * (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const SIZE = 4;
  const GAME_ID = "tallkombo";
  const MOVE_DURATION = 130;
  const GRID_GAP = 12;
  // Poeng per "nivå" en sammenslått brikke når (2=nivå 1, 4=nivå 2, ...).
  // Rå brikkeverdi ville gitt eksponentielt større poengsummer enn de andre
  // spillene på siden (en enkelt 2048-sammenslåing ville alene gitt 2048
  // poeng), så vi bruker log2-nivået i stedet for å holde skåren på samme
  // skala som de andre spillene.
  const POINTS_PER_MERGE_LEVEL = 20;

  function emptyBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  function start(container) {
    let board = emptyBoard();
    let score = 0;
    let won = false;
    let over = false;
    let tileIdCounter = 0;
    let session = null;
    let tilesLayerEl = null;
    let boardGridEl = null;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <div class="board-2048" data-board-2048 tabindex="0">
          <div class="board-2048-grid" data-board-2048-grid></div>
          <div class="board-2048-tiles" data-board-2048-tiles></div>
        </div>
      `;
      boardGridEl = session.playArea.querySelector("[data-board-2048-grid]");
      tilesLayerEl = session.playArea.querySelector("[data-board-2048-tiles]");
      for (let i = 0; i < SIZE * SIZE; i++) {
        const cell = document.createElement("div");
        cell.className = "cell-2048";
        boardGridEl.appendChild(cell);
      }
      session.onRestart(() => initGame());
      attachControls();
      // Fortsett der spilleren slapp hvis det ligger en lagret stilling
      // (js/game-runtime.js), ellers start en ny runde.
      if (!resumeGame()) initGame();
    });

    // Stillingen som lagres mellom økter: brettet (verdi + id per rute),
    // tileIdCounter (slik at nye brikker fortsatt får unike id-er etter en
    // gjenopptagelse), skåren og om 2048 alt er nådd.
    function saveGame() {
      if (!session || over) return;
      session.saveState({ board, score, won, tileIdCounter });
    }

    function validBoard(candidate) {
      return Array.isArray(candidate)
        && candidate.length === SIZE
        && candidate.every((row) => Array.isArray(row) && row.length === SIZE
          && row.every((cell) => cell === null
            || (cell && Number.isFinite(cell.id) && Number.isFinite(cell.value) && cell.value >= 2)));
    }

    function resumeGame() {
      const saved = session.savedState();
      if (!saved || !validBoard(saved.board)) return false;

      board = saved.board.map((row) => row.map((cell) => (cell ? { id: cell.id, value: cell.value } : null)));
      score = Number(saved.score) || 0;
      won = !!saved.won;
      tileIdCounter = Number.isFinite(saved.tileIdCounter) ? saved.tileIdCounter : highestTileId() + 1;
      over = false;

      // En lagret stilling uten trekk igjen ville låst spilleren fast.
      if (!hasMoves()) return false;

      renderFull();
      session.setScore(score);
      session.hideOverlay();
      const boardEl = session.playArea.querySelector("[data-board-2048]");
      if (boardEl) boardEl.focus({ preventScroll: true });
      return true;
    }

    function highestTileId() {
      let max = 0;
      for (const row of board) for (const cell of row) if (cell) max = Math.max(max, cell.id);
      return max;
    }

    function initGame() {
      window.clearTimeout(pendingTimer);
      pendingFinish = null;
      pendingTimer = null;
      board = emptyBoard();
      score = 0;
      won = false;
      over = false;
      tileIdCounter = 0;
      tilesLayerEl.innerHTML = "";
      addRandomTile();
      addRandomTile();
      renderFull();
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      const boardEl = session.playArea.querySelector("[data-board-2048]");
      if (boardEl) boardEl.focus({ preventScroll: true });
    }

    function addRandomTile() {
      const empties = [];
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (!board[r][c]) empties.push([r, c]);
        }
      }
      if (!empties.length) return null;
      const [r, c] = empties[Math.floor(Math.random() * empties.length)];
      const tile = { id: tileIdCounter++, value: Math.random() < 0.9 ? 2 : 4 };
      board[r][c] = tile;
      return { id: tile.id, row: r, col: c };
    }

    // Flytte-logikken er portert fra det åpne 2048-spillet til Gabriele
    // Cirulli (https://github.com/gabrielecirulli/2048, MIT-lisens,
    // Copyright (c) 2014 Gabriele Cirulli): brikkene gås gjennom fra den
    // fjerneste kanten i bevegelsesretningen, hver brikke glir til
    // fjerneste ledige rute, og slås sammen med naboen bak seg hvis de er
    // like og naboen ikke allerede er et resultat av en sammenslåing denne
    // runden (maks én sammenslåing per brikke). Sammenslåtte par
    // rapporteres som {survivorId, removedId} slik at brikken som
    // forsvinner kan animeres inn i den som overlever.
    const VECTORS = {
      up: { x: 0, y: -1 },
      right: { x: 1, y: 0 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
    };

    function withinBounds(x, y) {
      return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
    }

    function buildTraversals(vector) {
      const xs = [];
      const ys = [];
      for (let pos = 0; pos < SIZE; pos++) {
        xs.push(pos);
        ys.push(pos);
      }
      if (vector.x === 1) xs.reverse();
      if (vector.y === 1) ys.reverse();
      return { xs, ys };
    }

    // x = kolonne, y = rad (som i originalen); board[rad][kolonne] her.
    function findFarthestPosition(grid, x, y, vector) {
      let prev;
      do {
        prev = { x, y };
        x = prev.x + vector.x;
        y = prev.y + vector.y;
      } while (withinBounds(x, y) && !grid[y][x]);
      return { farthest: prev, next: { x, y } };
    }

    function moveBoard(direction) {
      const vector = VECTORS[direction];
      const traversals = buildTraversals(vector);
      // Arbeidskopi av brettet; brikkene er egne objekter slik at
      // sammenslåtte brikker kan markeres uten å røre det ekte brettet.
      const grid = board.map((row) => row.map((cell) => (cell ? { id: cell.id, value: cell.value } : null)));
      const merged = new Set();
      const mergeEvents = [];
      let gained = 0;
      let moved = false;

      traversals.xs.forEach((x) => {
        traversals.ys.forEach((y) => {
          const tile = grid[y][x];
          if (!tile) return;
          const { farthest, next } = findFarthestPosition(grid, x, y, vector);
          const other = withinBounds(next.x, next.y) ? grid[next.y][next.x] : null;

          grid[y][x] = null;
          if (other && other.value === tile.value && !merged.has(other.id)) {
            const value = tile.value * 2;
            // Brikken som ble stående overlever; den som beveget seg glir inn i den.
            other.value = value;
            merged.add(other.id);
            mergeEvents.push({ survivorId: other.id, removedId: tile.id });
            gained += Math.round(Math.log2(value)) * POINTS_PER_MERGE_LEVEL;
            moved = true;
          } else {
            grid[farthest.y][farthest.x] = tile;
            if (farthest.x !== x || farthest.y !== y) moved = true;
          }
        });
      });

      return { newBoard: grid, moved, gained, mergeEvents };
    }

    function hasMoves() {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (!board[r][c]) return true;
          if (c < SIZE - 1 && board[r][c + 1] && board[r][c].value === board[r][c + 1].value) return true;
          if (r < SIZE - 1 && board[r + 1][c] && board[r][c].value === board[r + 1][c].value) return true;
        }
      }
      return false;
    }

    function boardHasValue(target) {
      return board.some((row) => row.some((cell) => cell && cell.value === target));
    }

    function showWinToast() {
      const toast = document.createElement("div");
      toast.className = "game-2048-toast";
      toast.textContent = "Du nådde 2048! Fortsett å spille for enda flere poeng. 🎉";
      session.playArea.insertBefore(toast, session.playArea.firstChild);
      setTimeout(() => toast.remove(), 4000);
    }

    function getPositions(b) {
      const positions = {};
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (b[r][c]) positions[b[r][c].id] = { row: r, col: c };
        }
      }
      return positions;
    }

    function findTileById(id) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (board[r][c] && board[r][c].id === id) return { row: r, col: c };
        }
      }
      return null;
    }

    // Brikkenes top/left settes i det LOKALE (utransformerte) koordinat-
    // systemet til brettet, siden hele spillskallet kan bli skalert ned med
    // en CSS transform (js/game-runtime.js, watchShellFit) for å få plass i
    // spillboksen. getBoundingClientRect() ville gitt skjermstørrelsen ETTER
    // den skaleringen, som gjør brikkene feil store/plassert (de sklir
    // utenfor rutene) så snart skallet skaleres ned. offsetWidth er
    // upåvirket av forfedres transform og er derfor riktig her.
    function boardMetrics() {
      const width = boardGridEl.offsetWidth;
      const cellSize = (width - (SIZE - 1) * GRID_GAP) / SIZE;
      return { cellSize };
    }

    function positionTileEl(el, row, col, animate) {
      const { cellSize } = boardMetrics();
      const top = row * (cellSize + GRID_GAP);
      const left = col * (cellSize + GRID_GAP);
      el.style.width = `${cellSize}px`;
      el.style.height = `${cellSize}px`;
      if (!animate) el.style.transition = "none";
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
      if (!animate) {
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth;
        el.style.transition = "";
      }
    }

    function tileEl(id) {
      return tilesLayerEl.querySelector(`[data-tile-id="${id}"]`);
    }

    function createTileEl(tile, row, col, extraClass) {
      const el = document.createElement("div");
      el.className = `tile-2048${extraClass ? ` ${extraClass}` : ""}`;
      el.dataset.tileId = String(tile.id);
      el.dataset.value = tile.value > 2048 ? "2048plus" : String(tile.value);
      el.textContent = tile.value;
      tilesLayerEl.appendChild(el);
      positionTileEl(el, row, col, false);
      return el;
    }

    // Full ny-tegning brukt ved oppstart/gjenopptagelse – etter det holdes
    // brikkenes DOM-elementer i live og flyttes/oppdateres i stedet.
    function renderFull() {
      tilesLayerEl.innerHTML = "";
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const tile = board[r][c];
          if (tile) createTileEl(tile, r, c);
        }
      }
    }

    let pendingFinish = null;
    let pendingTimer = null;

    function flushPending() {
      window.clearTimeout(pendingTimer);
      const fn = pendingFinish;
      pendingFinish = null;
      pendingTimer = null;
      if (fn) fn();
    }

    function performMove(direction) {
      if (!session) return;
      flushPending();
      if (over) return;
      const beforePositions = getPositions(board);
      const { newBoard, moved, gained, mergeEvents } = moveBoard(direction);
      if (!moved) return;

      board = newBoard;
      score += gained;

      const afterPositions = getPositions(board);
      const removedTargets = {};
      mergeEvents.forEach(({ survivorId, removedId }) => {
        removedTargets[removedId] = afterPositions[survivorId];
      });

      // Skli hver brikke som fantes fra før til sin nye rute (den som blir
      // spist skli inn i brikken den slås sammen med, akkurat som i det
      // klassiske 2048-spillet).
      Object.keys(beforePositions).forEach((idStr) => {
        const id = Number(idStr);
        const el = tileEl(id);
        if (!el) return;
        const target = afterPositions[id] || removedTargets[id];
        if (!target) return;
        positionTileEl(el, target.row, target.col, true);
      });

      const spawn = addRandomTile();

      if (!won && boardHasValue(2048)) {
        won = true;
        showWinToast();
      }

      session.setScore(score);
      saveGame();

      // Etterarbeidet (fjerne spiste brikker, oppdatere sammenslåtte, vise
      // ny brikke) bruker data fanget NÅ, ikke brettet slik det ser ut senere.
      // Trykkes en ny retning før animasjonen er ferdig, kjøres dette først
      // (flushPending), ellers ville det truffet feil brikker og latt brikker
      // forsvinne.
      const spawnTile = spawn ? board[spawn.row][spawn.col] : null;
      const survivors = mergeEvents.map(({ survivorId }) => {
        const pos = afterPositions[survivorId];
        return { id: survivorId, row: pos.row, col: pos.col, value: board[pos.row][pos.col].value };
      });
      const finish = () => {
        mergeEvents.forEach(({ removedId }) => {
          const el = tileEl(removedId);
          if (el) el.remove();
        });
        survivors.forEach(({ id, row, col, value }) => {
          const el = tileEl(id);
          if (!el) return;
          el.textContent = value;
          el.dataset.value = value > 2048 ? "2048plus" : String(value);
          el.classList.remove("is-merged");
          // eslint-disable-next-line no-unused-expressions
          el.offsetWidth;
          el.classList.add("is-merged");
          positionTileEl(el, row, col, false);
        });
        if (spawnTile && !tileEl(spawnTile.id)) createTileEl(spawnTile, spawn.row, spawn.col, "is-new");
        if (!hasMoves()) {
          over = true;
          session.finish(score);
        }
      };
      pendingFinish = finish;
      pendingTimer = window.setTimeout(flushPending, MOVE_DURATION);
    }

    const KEY_DIRECTIONS = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };

    function attachControls() {
      document.addEventListener("keydown", (e) => {
        const direction = KEY_DIRECTIONS[e.key];
        if (!direction) return;
        e.preventDefault();
        performMove(direction);
      });

      const boardEl = session.playArea.querySelector("[data-board-2048]");
      if (!boardEl) return;

      let touchStartX = 0;
      let touchStartY = 0;

      boardEl.addEventListener(
        "touchstart",
        (e) => {
          const t = e.changedTouches[0];
          touchStartX = t.clientX;
          touchStartY = t.clientY;
        },
        { passive: true }
      );

      boardEl.addEventListener(
        "touchend",
        (e) => {
          const t = e.changedTouches[0];
          const dx = t.clientX - touchStartX;
          const dy = t.clientY - touchStartY;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
          if (Math.abs(dx) > Math.abs(dy)) {
            performMove(dx > 0 ? "right" : "left");
          } else {
            performMove(dy > 0 ? "down" : "up");
          }
        },
        { passive: true }
      );
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
