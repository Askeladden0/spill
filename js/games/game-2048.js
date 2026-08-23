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
  const GAME_ID = "2048";
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
        <p class="game-2048-hint">Bruk piltastene (eller sveip på mobil) for å flytte brikkene. Like tall slås sammen!</p>
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

    // Kjører én linje (rad eller kolonne) gjennom slåsammen-logikken, og
    // skriver resultatet tilbake via getRC(k) som gir (r, c) for slot k i
    // "target-først"-rekkefølge. Slik unngås separate transponerings-/
    // snu-implementasjoner per retning. Sammenslåtte par rapporteres som
    // {survivorId, removedId} slik at brikken som forsvinner kan animeres
    // inn i den som overlever, i stedet for å bare hoppe vekk.
    function processLine(getRC, newBoard, mergeEvents) {
      const tiles = [];
      for (let k = 0; k < SIZE; k++) {
        const [r, c] = getRC(k);
        if (board[r][c]) tiles.push(board[r][c]);
      }

      const result = [];
      let gained = 0;
      let i = 0;
      while (i < tiles.length) {
        const cur = tiles[i];
        const next = tiles[i + 1];
        if (next && cur.value === next.value) {
          const value = cur.value * 2;
          gained += Math.round(Math.log2(value)) * POINTS_PER_MERGE_LEVEL;
          result.push({ id: cur.id, value });
          mergeEvents.push({ survivorId: cur.id, removedId: next.id });
          i += 2;
        } else {
          result.push({ id: cur.id, value: cur.value });
          i += 1;
        }
      }

      for (let k = 0; k < SIZE; k++) {
        const [r, c] = getRC(k);
        newBoard[r][c] = result[k] || null;
      }
      return gained;
    }

    function moveBoard(direction) {
      const newBoard = emptyBoard();
      const mergeEvents = [];
      let gained = 0;

      if (direction === "left") {
        for (let r = 0; r < SIZE; r++) gained += processLine((k) => [r, k], newBoard, mergeEvents);
      } else if (direction === "right") {
        for (let r = 0; r < SIZE; r++) gained += processLine((k) => [r, SIZE - 1 - k], newBoard, mergeEvents);
      } else if (direction === "up") {
        for (let c = 0; c < SIZE; c++) gained += processLine((k) => [k, c], newBoard, mergeEvents);
      } else if (direction === "down") {
        for (let c = 0; c < SIZE; c++) gained += processLine((k) => [SIZE - 1 - k, c], newBoard, mergeEvents);
      }

      let moved = false;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const a = board[r][c];
          const b = newBoard[r][c];
          if ((a ? a.id : null) !== (b ? b.id : null) || (a && b && a.value !== b.value)) moved = true;
        }
      }

      return { newBoard, moved, gained, mergeEvents };
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

    function boardMetrics() {
      const rect = boardGridEl.getBoundingClientRect();
      const cellSize = (rect.width - (SIZE - 1) * GRID_GAP) / SIZE;
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

    function performMove(direction) {
      if (!session || over) return;
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

      window.setTimeout(() => {
        mergeEvents.forEach(({ removedId }) => {
          const el = tileEl(removedId);
          if (el) el.remove();
        });
        mergeEvents.forEach(({ survivorId }) => {
          const pos = findTileById(survivorId);
          const el = tileEl(survivorId);
          if (!pos || !el) return;
          const tile = board[pos.row][pos.col];
          el.textContent = tile.value;
          el.dataset.value = tile.value > 2048 ? "2048plus" : String(tile.value);
          el.classList.remove("is-merged");
          // eslint-disable-next-line no-unused-expressions
          el.offsetWidth;
          el.classList.add("is-merged");
          positionTileEl(el, pos.row, pos.col, false);
        });
        if (spawn) {
          const tile = board[spawn.row][spawn.col];
          if (tile) createTileEl(tile, spawn.row, spawn.col, "is-new");
        }

        if (!hasMoves()) {
          over = true;
          session.finish(score);
        }
      }, MOVE_DURATION);
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
