/**
 * PixelPlay – Block Blast.
 * Dra klosser fra brettet nederst og slipp dem på 8x8-rutenettet. Fyll en
 * hel rad eller kolonne for å sprenge den og få poeng. Spillet er over når
 * ingen av de tre klossene i "hånden" lenger passer noe sted på brettet.
 * Bruker den delte spill-kjøretiden (js/game-runtime.js) for poeng-HUD,
 * rekord og game-over.
 */
(function () {
  "use strict";

  const GAME_ID = "block-blast";
  const SIZE = 8;
  const COLORS = ["a", "b", "c", "d", "e", "f"];
  // Poeng per rute som legges ned, og poeng per rad/kolonne som sprenges.
  // Justert opp fra de opprinnelige (1 poeng/rute, 8 poeng/linje) slik at et
  // typisk parti gir omtrent like mange poeng som de andre spillene på
  // siden, i stedet for å ligge langt bak dem.
  const POINTS_PER_CELL = 3;
  const POINTS_PER_CLEARED_LINE = 20;
  const MULTI_CLEAR_BONUS = 1.5;

  const SHAPES = [
    [[0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [1, 0]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 1], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [1, 0]],
  ];

  function randomColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  function shapeSize(cells) {
    const rows = Math.max(...cells.map((c) => c[0])) + 1;
    const cols = Math.max(...cells.map((c) => c[1])) + 1;
    return { rows, cols };
  }

  function start(container) {
    let grid = [];
    let tray = [];
    let score = 0;
    let over = false;
    let session = null;
    let boardEl = null;
    let cellSize = 0;
    let dragState = null;

    window.PixelPlayGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <p class="game-blast-hint">Dra en kloss fra hånden og slipp den på brettet. Fyll en hel rad eller kolonne for å sprenge den!</p>
        <div class="board-blast" data-board-blast></div>
        <div class="blast-tray" data-blast-tray></div>
      `;
      boardEl = session.playArea.querySelector("[data-board-blast]");
      session.onRestart(() => initGame());
      attachControls();
      initGame();
    });

    function initGame() {
      grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      tray = newTray();
      score = 0;
      over = false;
      session.setScore(0);
      session.hideOverlay();
      render();
    }

    function fits(cells, row, col) {
      return cells.every(([dr, dc]) => {
        const r = row + dr;
        const c = col + dc;
        return r >= 0 && r < SIZE && c >= 0 && c < SIZE && !grid[r][c];
      });
    }

    function anyFit(piece) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (fits(piece.cells, r, c)) return true;
        }
      }
      return false;
    }

    function boardFillRatio() {
      let filled = 0;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (grid[r][c]) filled++;
        }
      }
      return filled / (SIZE * SIZE);
    }

    // Ekte Block Blast unngår sjelden-rettferdige tap ved å tilpasse hvilke
    // klosser som deles ut etter hvor fullt brettet er, og ved (nesten)
    // alltid å sørge for at minst én av de tre klossene faktisk passer et
    // sted. Vi gjør det samme her i stedet for å trekke helt uvektet.
    function weightedShape(fillRatio) {
      const maxCells = fillRatio > 0.72 ? 3 : fillRatio > 0.5 ? 4 : SHAPES.reduce((m, s) => Math.max(m, s.length), 0);
      const pool = SHAPES.filter((cells) => cells.length <= maxCells);
      const cells = (pool.length ? pool : SHAPES)[Math.floor(Math.random() * (pool.length || SHAPES.length))];
      return { id: Math.random().toString(36).slice(2), cells, color: randomColor() };
    }

    function newTray() {
      const fillRatio = boardFillRatio();
      const pieces = [weightedShape(fillRatio), weightedShape(fillRatio), weightedShape(fillRatio)];
      if (!pieces.some((p) => anyFit(p))) {
        pieces[2] = { id: Math.random().toString(36).slice(2), cells: SHAPES[0], color: randomColor() };
      }
      return pieces;
    }

    function placePiece(piece, row, col) {
      const justPlaced = [];
      for (const [dr, dc] of piece.cells) {
        grid[row + dr][col + dc] = piece.color;
        justPlaced.push(`${row + dr},${col + dc}`);
      }
      score += piece.cells.length * POINTS_PER_CELL;

      const fullRows = [];
      const fullCols = [];
      for (let r = 0; r < SIZE; r++) {
        if (grid[r].every((cell) => cell)) fullRows.push(r);
      }
      for (let c = 0; c < SIZE; c++) {
        if (grid.every((row) => row[c])) fullCols.push(c);
      }

      tray = tray.filter((p) => p.id !== piece.id);
      if (tray.length === 0) tray = newTray();

      session.setScore(Math.round(score));
      render(justPlaced, fullRows, fullCols);

      if (fullRows.length || fullCols.length) {
        window.setTimeout(() => {
          for (const r of fullRows) grid[r].fill(null);
          for (const c of fullCols) for (let r = 0; r < SIZE; r++) grid[r][c] = null;
          const cleared = fullRows.length + fullCols.length;
          score += cleared * POINTS_PER_CLEARED_LINE * (cleared > 1 ? MULTI_CLEAR_BONUS : 1);
          session.setScore(Math.round(score));
          render();
          checkGameOver();
        }, 190);
      } else {
        checkGameOver();
      }
    }

    function checkGameOver() {
      const stuck = tray.every((p) => !anyFit(p));
      if (stuck) {
        over = true;
        session.finish(score);
      }
    }

    function render(justPlaced, flashRows, flashCols) {
      justPlaced = justPlaced || [];
      flashRows = flashRows || [];
      flashCols = flashCols || [];
      boardEl.innerHTML = "";
      boardEl.style.setProperty("--blast-size", SIZE);
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const cell = document.createElement("div");
          cell.className = "cell-blast";
          cell.dataset.row = String(r);
          cell.dataset.col = String(c);
          if (grid[r][c]) {
            cell.classList.add("is-filled", `is-${grid[r][c]}`);
            const key = `${r},${c}`;
            if (flashRows.includes(r) || flashCols.includes(c)) cell.classList.add("is-clearing");
            else if (justPlaced.includes(key)) cell.classList.add("is-just-placed");
          }
          boardEl.appendChild(cell);
        }
      }

      const trayEl = session.playArea.querySelector("[data-blast-tray]");
      trayEl.innerHTML = "";
      for (const piece of tray) {
        const { rows, cols } = shapeSize(piece.cells);
        const pieceEl = document.createElement("div");
        pieceEl.className = "blast-piece";
        pieceEl.dataset.pieceId = piece.id;
        pieceEl.style.setProperty("--piece-rows", rows);
        pieceEl.style.setProperty("--piece-cols", cols);
        for (const [r, c] of piece.cells) {
          const b = document.createElement("span");
          b.className = `blast-piece-block is-${piece.color}`;
          b.style.gridRow = String(r + 1);
          b.style.gridColumn = String(c + 1);
          pieceEl.appendChild(b);
        }
        trayEl.appendChild(pieceEl);
      }
    }

    function boardRect() {
      return boardEl.getBoundingClientRect();
    }

    function pointFromEvent(e) {
      const t = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
      return { x: t.clientX, y: t.clientY };
    }

    function cellFromPoint(x, y) {
      const rect = boardRect();
      cellSize = rect.width / SIZE;
      const col = Math.floor((x - rect.left) / cellSize);
      const row = Math.floor((y - rect.top) / cellSize);
      return { row, col };
    }

    function clearPreview() {
      boardEl.querySelectorAll(".cell-blast").forEach((cell) => {
        cell.classList.remove("is-preview", "is-preview-bad");
      });
    }

    function showPreview(piece, row, col) {
      clearPreview();
      const ok = fits(piece.cells, row, col);
      for (const [dr, dc] of piece.cells) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
        const cell = boardEl.querySelector(`.cell-blast[data-row="${r}"][data-col="${c}"]`);
        if (cell) cell.classList.add(ok ? "is-preview" : "is-preview-bad");
      }
      return ok;
    }

    function startDrag(pieceEl, e) {
      if (over) return;
      const pieceId = pieceEl.dataset.pieceId;
      const piece = tray.find((p) => p.id === pieceId);
      if (!piece) return;
      e.preventDefault();

      const ghost = pieceEl.cloneNode(true);
      ghost.classList.add("blast-piece-ghost");
      document.body.appendChild(ghost);
      pieceEl.classList.add("is-dragging-source");

      dragState = { piece, ghost, anchorRow: 0, anchorCol: 0 };

      const { rows, cols } = shapeSize(piece.cells);
      dragState.rows = rows;
      dragState.cols = cols;

      moveGhost(e);

      function onMove(ev) {
        moveGhost(ev);
      }
      function onUp(ev) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onUp);
        finishDrag(ev, pieceEl);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
    }

    function moveGhost(e) {
      if (!dragState) return;
      const p = pointFromEvent(e);
      if (e.cancelable) e.preventDefault();
      const rect = boardRect();
      cellSize = rect.width / SIZE;
      const offsetY = dragState.rows * cellSize * 0.65 + 24;
      dragState.ghost.style.left = `${p.x - (dragState.cols * cellSize) / 2}px`;
      dragState.ghost.style.top = `${p.y - offsetY}px`;
      dragState.ghost.style.width = `${dragState.cols * cellSize}px`;
      dragState.ghost.style.height = `${dragState.rows * cellSize}px`;
      dragState.ghost.style.setProperty("--piece-rows", dragState.rows);
      dragState.ghost.style.setProperty("--piece-cols", dragState.cols);

      const targetX = p.x - (dragState.cols * cellSize) / 2;
      const targetY = p.y - offsetY;
      const { row, col } = cellFromPoint(targetX + cellSize / 2, targetY + cellSize / 2);
      dragState.previewRow = row;
      dragState.previewCol = col;
      showPreview(dragState.piece, row, col);
    }

    function finishDrag(e, pieceEl) {
      pieceEl.classList.remove("is-dragging-source");
      if (!dragState) return;
      const { piece, ghost, previewRow, previewCol } = dragState;
      ghost.remove();
      clearPreview();
      dragState = null;
      if (previewRow === undefined) return;
      if (fits(piece.cells, previewRow, previewCol)) {
        placePiece(piece, previewRow, previewCol);
      }
    }

    function attachControls() {
      const trayEl = session.playArea.querySelector("[data-blast-tray]");
      trayEl.addEventListener("mousedown", (e) => {
        const pieceEl = e.target.closest(".blast-piece");
        if (pieceEl) startDrag(pieceEl, e);
      });
      trayEl.addEventListener(
        "touchstart",
        (e) => {
          const pieceEl = e.target.closest(".blast-piece");
          if (pieceEl) startDrag(pieceEl, e);
        },
        { passive: false }
      );
    }
  }

  window.PIXELPLAY_GAME_MODULES = window.PIXELPLAY_GAME_MODULES || {};
  window.PIXELPLAY_GAME_MODULES[GAME_ID] = { start };
})();
