/**
 * Studilla – Tetris.
 * Klassisk klossespill: styr fallende brikker med piltaster/WASD (eller
 * knapper på mobil), fyll hele rader for å tømme dem og score poeng.
 * Bruker den delte spill-kjøretiden (js/game-runtime.js) for poeng-HUD,
 * rekord og game-over.
 */
(function () {
  "use strict";

  const GAME_ID = "tetris";
  const COLS = 10;
  const ROWS = 18;
  const DROP_MS = 780;
  const SOFT_DROP_MS = 55;

  const SHAPES = {
    I: { color: "i", cells: [[0, -1], [0, 0], [0, 1], [0, 2]] },
    O: { color: "o", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    T: { color: "t", cells: [[0, -1], [0, 0], [0, 1], [1, 0]] },
    S: { color: "s", cells: [[0, 0], [0, 1], [1, -1], [1, 0]] },
    Z: { color: "z", cells: [[0, -1], [0, 0], [1, 0], [1, 1]] },
    J: { color: "j", cells: [[0, -1], [0, 0], [0, 1], [1, 1]] },
    L: { color: "l", cells: [[0, -1], [0, 0], [0, 1], [1, -1]] },
  };
  const SHAPE_KEYS = Object.keys(SHAPES);

  function rotateCells(cells) {
    // 90° medurs rotasjon rundt origo (fungerer godt nok for et rutenett-spill).
    return cells.map(([r, c]) => [c, -r]);
  }

  function start(container) {
    let grid = [];
    let piece = null;
    let pendingNextKey = null;
    let bag = [];
    let score = 0;
    let linesCleared = 0;
    let over = false;
    let dropTimer = null;
    let session = null;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <p class="game-tetris-hint">Piltaster/WASD for å flytte, opp/W for å rotere, mellomrom for hard drop. Sveip eller bruk knappene på mobil.</p>
        <div class="tetris-layout">
          <div class="board-tetris" data-board-tetris tabindex="0"></div>
          <div class="tetris-side">
            <div class="tetris-next-label">Neste</div>
            <div class="tetris-next" data-tetris-next></div>
            <div class="tetris-lines" data-tetris-lines>0 linjer</div>
          </div>
        </div>
        <div class="tetris-touch" data-tetris-touch>
          <button type="button" class="tetris-btn" data-tetris-btn="left" aria-label="Venstre">◀</button>
          <button type="button" class="tetris-btn" data-tetris-btn="rotate" aria-label="Roter">⟳</button>
          <button type="button" class="tetris-btn" data-tetris-btn="right" aria-label="Høyre">▶</button>
          <button type="button" class="tetris-btn" data-tetris-btn="down" aria-label="Ned">▼</button>
        </div>
      `;
      session.onRestart(() => initGame());
      attachControls();
      initGame();
    });

    function emptyGrid() {
      return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    }

    function refillBag() {
      const shuffled = SHAPE_KEYS.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      bag.push(...shuffled);
    }

    function nextFromBag() {
      if (bag.length < 2) refillBag();
      return bag.shift();
    }

    function spawnPiece(key) {
      const def = SHAPES[key];
      return {
        key,
        color: def.color,
        cells: def.cells.map((c) => c.slice()),
        row: 1,
        col: Math.floor(COLS / 2),
      };
    }

    function initGame() {
      grid = emptyGrid();
      bag = [];
      score = 0;
      linesCleared = 0;
      over = false;
      piece = spawnPiece(nextFromBag());
      piece.nextKey = nextFromBag();
      bag.unshift(piece.nextKey);
      session.setScore(0);
      session.hideOverlay();
      updateLinesLabel();
      render();

      if (dropTimer) clearInterval(dropTimer);
      dropTimer = setInterval(() => softDrop(false), DROP_MS);

      const boardEl = session.playArea.querySelector("[data-board-tetris]");
      if (boardEl) boardEl.focus({ preventScroll: true });
    }

    function updateLinesLabel() {
      const el = session.playArea.querySelector("[data-tetris-lines]");
      if (el) el.textContent = `${linesCleared} linje${linesCleared === 1 ? "" : "r"}`;
    }

    function occupied(cells, row, col) {
      return cells.some(([dr, dc]) => {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
        if (grid[r] && grid[r][c]) return true;
        return false;
      });
    }

    function tryMove(dr, dc) {
      if (!piece || over) return false;
      const row = piece.row + dr;
      const col = piece.col + dc;
      if (occupied(piece.cells, row, col)) return false;
      piece.row = row;
      piece.col = col;
      render();
      return true;
    }

    function tryRotate() {
      if (!piece || over || piece.key === "O") return;
      const rotated = rotateCells(piece.cells);
      const kicks = [0, -1, 1, -2, 2];
      for (const kick of kicks) {
        if (!occupied(rotated, piece.row, piece.col + kick)) {
          piece.cells = rotated;
          piece.col += kick;
          render();
          return;
        }
      }
    }

    function lockPiece() {
      const justLocked = [];
      for (const [dr, dc] of piece.cells) {
        const r = piece.row + dr;
        const c = piece.col + dc;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
          grid[r][c] = piece.color;
          justLocked.push(`${r},${c}`);
        }
      }
      pendingNextKey = piece.nextKey;
      piece = null;

      const fullRows = [];
      for (let r = 0; r < ROWS; r++) {
        if (grid[r].every((cell) => cell)) fullRows.push(r);
      }

      render(fullRows, justLocked);

      // Liten forsinkelse før neste brikke spawner, slik at spilleren rekker
      // å se at rader faktisk blitser/tømmes (eller at brikken poppet fast)
      // før brettet tegnes på nytt.
      window.setTimeout(() => {
        if (fullRows.length) clearLines();
        spawnNext();
      }, fullRows.length ? 160 : 90);
    }

    function clearLines() {
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (grid[r].every((cell) => cell)) {
          grid.splice(r, 1);
          grid.unshift(Array(COLS).fill(null));
          cleared++;
          r++;
        }
      }
      if (cleared > 0) {
        const points = [0, 100, 300, 500, 800][cleared] || cleared * 200;
        score += points;
        linesCleared += cleared;
        session.setScore(score);
        updateLinesLabel();
      }
    }

    function spawnNext() {
      const key = pendingNextKey || nextFromBag();
      pendingNextKey = null;
      piece = spawnPiece(key);
      piece.nextKey = nextFromBag();
      if (occupied(piece.cells, piece.row, piece.col)) {
        endGame();
        return;
      }
      render();
    }

    function softDrop(manual) {
      if (!piece || over) return;
      if (!tryMove(1, 0)) {
        lockPiece();
        if (manual) session.setScore(score);
      } else if (manual) {
        score += 1;
        session.setScore(score);
      }
    }

    function hardDrop() {
      if (!piece || over) return;
      let dist = 0;
      while (tryMove(1, 0)) dist++;
      if (dist > 0) {
        score += dist * 2;
        const boardEl = session.playArea.querySelector("[data-board-tetris]");
        if (boardEl) {
          boardEl.classList.remove("is-impact");
          // eslint-disable-next-line no-unused-expressions
          boardEl.offsetWidth;
          boardEl.classList.add("is-impact");
        }
      }
      lockPiece();
      session.setScore(score);
    }

    function endGame() {
      over = true;
      if (dropTimer) clearInterval(dropTimer);
      session.finish(score);
    }

    function ghostRow() {
      let r = piece.row;
      while (!occupied(piece.cells, r + 1, piece.col)) r++;
      return r;
    }

    function render(flashRows, justLockedKeys) {
      flashRows = flashRows || [];
      justLockedKeys = justLockedKeys || [];
      const boardEl = session.playArea.querySelector("[data-board-tetris]");
      if (!boardEl) return;
      boardEl.innerHTML = "";
      boardEl.style.setProperty("--tetris-cols", COLS);
      boardEl.style.setProperty("--tetris-rows", ROWS);

      const ghost = piece ? ghostRow() : -1;
      const active = new Set();
      const ghostCells = new Set();
      if (piece) {
        for (const [dr, dc] of piece.cells) {
          active.add(`${piece.row + dr},${piece.col + dc}`);
          ghostCells.add(`${ghost + dr},${piece.col + dc}`);
        }
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = document.createElement("div");
          cell.className = "cell-tetris";
          const key = `${r},${c}`;
          if (active.has(key)) {
            cell.classList.add("is-filled", `is-${piece.color}`);
          } else if (grid[r][c]) {
            cell.classList.add("is-filled", `is-${grid[r][c]}`);
            if (flashRows.includes(r)) cell.classList.add("is-clearing");
            else if (justLockedKeys.includes(key)) cell.classList.add("is-locked-new");
          } else if (ghostCells.has(key)) {
            cell.classList.add("is-ghost", `is-${piece.color}`);
          }
          boardEl.appendChild(cell);
        }
      }

      const nextEl = session.playArea.querySelector("[data-tetris-next]");
      if (nextEl && piece) {
        nextEl.innerHTML = "";
        const def = SHAPES[piece.nextKey];
        nextEl.classList.add(`is-${def.color}`);
        nextEl.className = `tetris-next is-${def.color}`;
        const rs = def.cells.map((c) => c[0]);
        const cs = def.cells.map((c) => c[1]);
        const minR = Math.min(...rs);
        const minC = Math.min(...cs);
        for (const [r, c] of def.cells) {
          const b = document.createElement("span");
          b.className = "tetris-next-block";
          b.style.gridRow = String(r - minR + 1);
          b.style.gridColumn = String(c - minC + 1);
          nextEl.appendChild(b);
        }
      }
    }

    const KEY_ACTIONS = {
      ArrowLeft: () => tryMove(0, -1),
      ArrowRight: () => tryMove(0, 1),
      ArrowDown: () => softDrop(true),
      ArrowUp: () => tryRotate(),
      a: () => tryMove(0, -1),
      d: () => tryMove(0, 1),
      s: () => softDrop(true),
      w: () => tryRotate(),
      " ": () => hardDrop(),
    };

    function attachControls() {
      document.addEventListener("keydown", (e) => {
        const action = KEY_ACTIONS[e.key];
        if (!action) return;
        e.preventDefault();
        action();
      });

      const touchWrap = session.playArea.querySelector("[data-tetris-touch]");
      if (touchWrap) {
        touchWrap.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-tetris-btn]");
          if (!btn) return;
          const action = btn.getAttribute("data-tetris-btn");
          if (action === "left") tryMove(0, -1);
          else if (action === "right") tryMove(0, 1);
          else if (action === "down") softDrop(true);
          else if (action === "rotate") tryRotate();
        });
      }

      const boardEl = session.playArea.querySelector("[data-board-tetris]");
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
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
            tryRotate();
            return;
          }
          if (Math.abs(dx) > Math.abs(dy)) {
            tryMove(0, dx > 0 ? 1 : -1);
          } else if (dy > 0) {
            hardDrop();
          }
        },
        { passive: true }
      );
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
