/**
 * PixelPlay – 2048.
 * Klassisk 4x4-brikkespill: skyv brikkene med piltaster/swipe, slå sammen
 * like tall, og jag den store 2048-brikken. Bruker den delte spill-
 * kjøretiden (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const SIZE = 4;
  const GAME_ID = "2048";

  function emptyBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  }

  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  // Sklir og slår sammen én rad med tall mot indeks 0 ("target"-enden).
  function collapseLine(values) {
    const filtered = values.filter((v) => v !== 0);
    const merged = [];
    const mergedFlags = [];
    let scoreGained = 0;
    let i = 0;
    while (i < filtered.length) {
      if (filtered[i + 1] !== undefined && filtered[i] === filtered[i + 1]) {
        const value = filtered[i] * 2;
        merged.push(value);
        mergedFlags.push(true);
        scoreGained += value;
        i += 2;
      } else {
        merged.push(filtered[i]);
        mergedFlags.push(false);
        i += 1;
      }
    }
    while (merged.length < SIZE) {
      merged.push(0);
      mergedFlags.push(false);
    }
    return { merged, mergedFlags, scoreGained };
  }

  function start(container) {
    let board = emptyBoard();
    let score = 0;
    let won = false;
    let over = false;
    let mergedThisRender = [];
    let newThisRender = [];
    let session = null;

    window.PixelPlayGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <p class="game-2048-hint">Bruk piltastene (eller sveip på mobil) for å flytte brikkene. Like tall slås sammen!</p>
        <div class="board-2048" data-board-2048 tabindex="0"></div>
      `;
      session.onRestart(() => initGame());
      attachControls();
      initGame();
    });

    function initGame() {
      board = emptyBoard();
      score = 0;
      won = false;
      over = false;
      mergedThisRender = [];
      newThisRender = [];
      addRandomTile();
      addRandomTile();
      render();
      session.setScore(0);
      session.hideOverlay();
      const boardEl = session.playArea.querySelector("[data-board-2048]");
      if (boardEl) boardEl.focus({ preventScroll: true });
    }

    function addRandomTile() {
      const empties = [];
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (board[r][c] === 0) empties.push([r, c]);
        }
      }
      if (!empties.length) return;
      const [r, c] = empties[Math.floor(Math.random() * empties.length)];
      board[r][c] = Math.random() < 0.9 ? 2 : 4;
      newThisRender.push(`${r},${c}`);
    }

    // Kjører én linje (rad eller kolonne) gjennom collapseLine, og skriver
    // resultatet tilbake via getRC(k) som gir (r, c) for slot k i
    // "target-først"-rekkefølge. Slik unngås separate transponerings-/
    // snu-implementasjoner per retning.
    function processLine(getRC, newBoard, mergedCells) {
      const values = [];
      for (let k = 0; k < SIZE; k++) {
        const [r, c] = getRC(k);
        values.push(board[r][c]);
      }
      const { merged, mergedFlags, scoreGained } = collapseLine(values);
      for (let k = 0; k < SIZE; k++) {
        const [r, c] = getRC(k);
        newBoard[r][c] = merged[k];
        if (mergedFlags[k]) mergedCells.push(`${r},${c}`);
      }
      return scoreGained;
    }

    function moveBoard(direction) {
      const newBoard = emptyBoard();
      const mergedCells = [];
      let gained = 0;

      if (direction === "left") {
        for (let r = 0; r < SIZE; r++) gained += processLine((k) => [r, k], newBoard, mergedCells);
      } else if (direction === "right") {
        for (let r = 0; r < SIZE; r++) gained += processLine((k) => [r, SIZE - 1 - k], newBoard, mergedCells);
      } else if (direction === "up") {
        for (let c = 0; c < SIZE; c++) gained += processLine((k) => [k, c], newBoard, mergedCells);
      } else if (direction === "down") {
        for (let c = 0; c < SIZE; c++) gained += processLine((k) => [SIZE - 1 - k, c], newBoard, mergedCells);
      }

      let moved = false;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (newBoard[r][c] !== board[r][c]) moved = true;
        }
      }

      return { newBoard, moved, gained, mergedCells };
    }

    function hasMoves() {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (board[r][c] === 0) return true;
          if (c < SIZE - 1 && board[r][c] === board[r][c + 1]) return true;
          if (r < SIZE - 1 && board[r][c] === board[r + 1][c]) return true;
        }
      }
      return false;
    }

    function boardHasValue(target) {
      return board.some((row) => row.some((v) => v === target));
    }

    function showWinToast() {
      const toast = document.createElement("div");
      toast.className = "game-2048-toast";
      toast.textContent = "Du nådde 2048! Fortsett å spille for enda flere poeng. 🎉";
      session.playArea.insertBefore(toast, session.playArea.firstChild);
      setTimeout(() => toast.remove(), 4000);
    }

    function performMove(direction) {
      if (!session || over) return;
      const { newBoard, moved, gained, mergedCells } = moveBoard(direction);
      if (!moved) return;

      board = newBoard;
      score += gained;
      mergedThisRender = mergedCells;
      newThisRender = [];
      addRandomTile();

      if (!won && boardHasValue(2048)) {
        won = true;
        showWinToast();
      }

      render();
      session.setScore(score);

      if (!hasMoves()) {
        over = true;
        session.finish(score);
      }
    }

    function render() {
      const boardEl = session.playArea.querySelector("[data-board-2048]");
      if (!boardEl) return;
      boardEl.innerHTML = "";
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const value = board[r][c];
          const cell = document.createElement("div");
          cell.className = "cell-2048";
          if (value !== 0) {
            cell.classList.add("tile-2048");
            cell.dataset.value = value > 2048 ? "2048plus" : String(value);
            cell.textContent = value;
            const key = `${r},${c}`;
            if (newThisRender.includes(key)) cell.classList.add("is-new");
            if (mergedThisRender.includes(key)) cell.classList.add("is-merged");
          }
          boardEl.appendChild(cell);
        }
      }
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

  window.PIXELPLAY_GAME_MODULES = window.PIXELPLAY_GAME_MODULES || {};
  window.PIXELPLAY_GAME_MODULES[GAME_ID] = { start };
})();
