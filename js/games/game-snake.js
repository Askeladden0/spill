/**
 * PixelPlay – Snake.
 * Klassisk slange-spill på et rutenett: styr med piltaster/WASD (eller
 * sveip på mobil), spis prikkene og voks deg lengst mulig uten å treffe
 * veggen eller deg selv. Bruker den delte spill-kjøretiden
 * (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const SIZE = 16;
  const GAME_ID = "snake";
  const TICK_MS = 130;

  function start(container) {
    let snake = [];
    let direction = "right";
    let nextDirection = "right";
    let food = null;
    let score = 0;
    let over = false;
    let timer = null;
    let session = null;
    let cellEls = null;

    window.PixelPlayGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <p class="game-snake-hint">Bruk piltastene/WASD (eller sveip på mobil) for å styre slangen. Spis prikkene og unngå veggen og deg selv!</p>
        <div class="board-snake" data-board-snake tabindex="0"></div>
      `;
      session.onRestart(() => initGame());
      attachControls();
      initGame();
    });

    function initGame() {
      const mid = Math.floor(SIZE / 2);
      snake = [
        { r: mid, c: mid - 1 },
        { r: mid, c: mid - 2 },
        { r: mid, c: mid - 3 },
      ];
      direction = "right";
      nextDirection = "right";
      score = 0;
      over = false;
      placeFood();
      render();
      session.setScore(0);
      session.hideOverlay();

      if (timer) clearInterval(timer);
      timer = setInterval(tick, TICK_MS);

      const boardEl = session.playArea.querySelector("[data-board-snake]");
      if (boardEl) boardEl.focus({ preventScroll: true });
    }

    function placeFood() {
      const empties = [];
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (!snake.some((seg) => seg.r === r && seg.c === c)) empties.push({ r, c });
        }
      }
      if (!empties.length) return;
      food = empties[Math.floor(Math.random() * empties.length)];
    }

    const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

    function tick() {
      if (!session || over) return;
      if (nextDirection !== OPPOSITE[direction]) direction = nextDirection;

      const head = snake[0];
      let { r, c } = head;
      if (direction === "up") r -= 1;
      else if (direction === "down") r += 1;
      else if (direction === "left") c -= 1;
      else if (direction === "right") c += 1;

      const hitsWall = r < 0 || r >= SIZE || c < 0 || c >= SIZE;
      const hitsSelf = snake.some((seg) => seg.r === r && seg.c === c);
      if (hitsWall || hitsSelf) {
        endGame();
        return;
      }

      snake.unshift({ r, c });

      let ateAt = null;
      if (food && r === food.r && c === food.c) {
        ateAt = { r, c };
        score += 10;
        session.setScore(score);
        placeFood();
      } else {
        snake.pop();
      }

      render(ateAt);
    }

    function endGame() {
      over = true;
      if (timer) clearInterval(timer);
      session.finish(score);
    }

    // Rutene bygges kun én gang og gjenbrukes videre (i stedet for å bygges
    // helt på nytt hvert eneste tikk). Slik kan CSS-overganger og
    // pop-animasjonen på nytt hode faktisk spille av i stedet for å bli
    // avbrutt av at elementene stadig erstattes med helt nye.
    function buildBoard() {
      const boardEl = session.playArea.querySelector("[data-board-snake]");
      if (!boardEl) return null;
      boardEl.innerHTML = "";
      boardEl.style.setProperty("--snake-size", SIZE);
      cellEls = [];
      for (let r = 0; r < SIZE; r++) {
        const rowEls = [];
        for (let c = 0; c < SIZE; c++) {
          const cell = document.createElement("div");
          cell.className = "cell-snake";
          boardEl.appendChild(cell);
          rowEls.push(cell);
        }
        cellEls.push(rowEls);
      }
      return boardEl;
    }

    function render(ateAt) {
      if (!session.playArea.querySelector("[data-board-snake]")) return;
      if (!cellEls) buildBoard();
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const cell = cellEls[r][c];
          cell.className = "cell-snake";
          if (food && food.r === r && food.c === c) {
            cell.classList.add("is-food");
          }
          const segIndex = snake.findIndex((seg) => seg.r === r && seg.c === c);
          if (segIndex === 0) {
            cell.classList.add("is-head");
            if (ateAt && ateAt.r === r && ateAt.c === c) cell.classList.add("is-eating");
          } else if (segIndex > 0) {
            cell.classList.add("is-body");
          }
        }
      }
    }

    const KEY_DIRECTIONS = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      a: "left",
      d: "right",
      w: "up",
      s: "down",
    };

    function setDirection(dir) {
      if (!dir || !session || over) return;
      nextDirection = dir;
    }

    function attachControls() {
      document.addEventListener("keydown", (e) => {
        const dir = KEY_DIRECTIONS[e.key];
        if (!dir) return;
        e.preventDefault();
        setDirection(dir);
      });

      const boardEl = session.playArea.querySelector("[data-board-snake]");
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
            setDirection(dx > 0 ? "right" : "left");
          } else {
            setDirection(dy > 0 ? "down" : "up");
          }
        },
        { passive: true }
      );
    }
  }

  window.PIXELPLAY_GAME_MODULES = window.PIXELPLAY_GAME_MODULES || {};
  window.PIXELPLAY_GAME_MODULES[GAME_ID] = { start };
})();
