/**
 * PixelPlay – Snake.
 * Klassisk slangespill på et rutenett: styr slangen med piltaster/swipe,
 * spis mat for å vokse og score poeng. Spillet er over hvis slangen
 * treffer veggen eller seg selv. Bruker den delte spill-kjøretiden
 * (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const COLS = 20;
  const ROWS = 20;
  const CELL = 20;
  const TICK_MS = 120;
  const GAME_ID = "snake";

  function start(container) {
    let canvas = null;
    let ctx = null;
    let snake = [];
    let direction = "right";
    let nextDirection = "right";
    let food = null;
    let score = 0;
    let over = false;
    let timer = null;
    let session = null;

    window.PixelPlayGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <p class="game-snake-hint">Bruk piltastene (eller sveip på mobil) for å styre slangen. Spis maten for å vokse!</p>
        <canvas class="board-snake" data-board-snake tabindex="0" width="${COLS * CELL}" height="${ROWS * CELL}"></canvas>
      `;
      canvas = session.playArea.querySelector("[data-board-snake]");
      ctx = canvas.getContext("2d");
      session.onRestart(() => initGame());
      attachControls();
      initGame();
    });

    function initGame() {
      const startY = Math.floor(ROWS / 2);
      snake = [
        { x: 8, y: startY },
        { x: 7, y: startY },
        { x: 6, y: startY },
      ];
      direction = "right";
      nextDirection = "right";
      score = 0;
      over = false;
      placeFood();
      draw();
      session.setScore(0);
      session.hideOverlay();
      canvas.focus({ preventScroll: true });
      if (timer) clearInterval(timer);
      timer = setInterval(tick, TICK_MS);
    }

    function placeFood() {
      let cell;
      do {
        cell = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      } while (snake.some((s) => s.x === cell.x && s.y === cell.y));
      food = cell;
    }

    const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

    function setDirection(dir) {
      if (over) return;
      if (OPPOSITE[dir] === direction) return;
      nextDirection = dir;
    }

    function tick() {
      if (over) return;
      direction = nextDirection;
      const head = snake[0];
      let newHead;
      if (direction === "up") newHead = { x: head.x, y: head.y - 1 };
      else if (direction === "down") newHead = { x: head.x, y: head.y + 1 };
      else if (direction === "left") newHead = { x: head.x - 1, y: head.y };
      else newHead = { x: head.x + 1, y: head.y };

      const hitsWall = newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS;
      const hitsSelf = snake.some((s) => s.x === newHead.x && s.y === newHead.y);

      if (hitsWall || hitsSelf) {
        endGame();
        return;
      }

      snake.unshift(newHead);

      if (newHead.x === food.x && newHead.y === food.y) {
        score += 10;
        session.setScore(score);
        placeFood();
      } else {
        snake.pop();
      }

      draw();
    }

    function endGame() {
      over = true;
      if (timer) clearInterval(timer);
      session.finish(score);
    }

    function draw() {
      ctx.fillStyle = "#131a25";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#f5c95c";
      ctx.fillRect(food.x * CELL + 2, food.y * CELL + 2, CELL - 4, CELL - 4);

      snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? "#2ee87f" : "#1f9d5c";
        ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
      });
    }

    const KEY_DIRECTIONS = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };

    function attachControls() {
      document.addEventListener("keydown", (e) => {
        const dir = KEY_DIRECTIONS[e.key];
        if (!dir) return;
        e.preventDefault();
        setDirection(dir);
      });

      let touchStartX = 0;
      let touchStartY = 0;

      canvas.addEventListener(
        "touchstart",
        (e) => {
          const t = e.changedTouches[0];
          touchStartX = t.clientX;
          touchStartY = t.clientY;
        },
        { passive: true }
      );

      canvas.addEventListener(
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
