/**
 * Studilla – Bubble Shooter.
 * Sikt med mus/pekefinger og skyt kuler oppover mot et sekskantrutenett.
 * Treffer kulen tre eller flere av samme farge, spretter de bort og gir
 * poeng; kuler som mister kontakt med resten av brettet faller også bort
 * (bonuspoeng). Tøm hele brettet for å vinne, eller tap hvis kulene når
 * skytteren. Bruker den delte spill-kjøretiden (js/game-runtime.js) for
 * poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const GAME_ID = "bubble-shooter";
  const COLS = 9;
  const RADIUS = 20;
  const COL_WIDTH = RADIUS * 2;
  const ROW_HEIGHT = RADIUS * Math.sqrt(3);
  const FILLED_ROWS = 6;
  const TOTAL_ROWS = 13;
  const WIDTH = COLS * COL_WIDTH;
  const HEIGHT = Math.round(TOTAL_ROWS * ROW_HEIGHT + RADIUS * 2 + 90);
  const SHOOTER_Y = HEIGHT - 40;
  const DANGER_Y = SHOOTER_Y - RADIUS * 2.4;
  const SPEED = 620; // px/sek
  const MAX_AIM_DEG = 75;

  const ASSET_DIR = "assets/img/games/bubble-shooter/";
  const BUBBLE_COLORS = {
    red: "#e8384f",
    orange: "#f2892a",
    yellow: "#f0c419",
    green: "#22b34f",
    skyblue: "#29b6e8",
    blue: "#3f66e0",
    indigo: "#5c4de0",
    purple: "#8b3fe8",
    magenta: "#d63fc9",
    pink: "#f28fce",
  };
  const PALETTE = Object.keys(BUBBLE_COLORS);

  const bubbleImages = {};
  for (const name of PALETTE) {
    const img = new Image();
    img.src = ASSET_DIR + name + ".svg";
    bubbleImages[name] = img;
  }
  const skyImage = new Image();
  skyImage.src = ASSET_DIR + "bg-sky.svg";

  function colsInRow(r) {
    return r % 2 === 0 ? COLS : COLS - 1;
  }

  function cellCenter(r, c) {
    const offset = r % 2 === 1 ? RADIUS : 0;
    return { x: c * COL_WIDTH + RADIUS + offset, y: r * ROW_HEIGHT + RADIUS };
  }

  function neighbors(r, c) {
    const list = [
      [r, c - 1],
      [r, c + 1],
    ];
    if (r % 2 === 0) {
      list.push([r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]);
    } else {
      list.push([r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]);
    }
    return list.filter(([nr, nc]) => nr >= 0 && nr < TOTAL_ROWS && nc >= 0 && nc < colsInRow(nr));
  }

  function start(container) {
    let grid = [];
    let score = 0;
    let over = false;
    let current = null;
    let next = null;
    let moving = null;
    let aimAngle = 0; // radians from vertical, 0 = straight up
    let session = null;
    let canvas = null;
    let ctx = null;
    let rafId = null;
    let lastTime = 0;
    let effects = [];

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <canvas class="board-bubble" data-board-bubble width="${WIDTH}" height="${HEIGHT}"></canvas>
      `;
      canvas = session.playArea.querySelector("[data-board-bubble]");
      ctx = canvas.getContext("2d");
      session.onRestart(() => initGame());
      attachControls();
      // Fortsett en påbegynt runde hvis den ligger lagret, ellers ny runde.
      if (!resumeGame()) initGame();
    });

    // Stillingen som lagres mellom økter: brettet og de to neste kulene.
    // Kula som er i lufta lagres ikke – da ville et skudd kunne "fryses" og
    // spilles av på nytt; spilleren fortsetter i stedet fra skuddet før.
    function saveGame() {
      if (!session || over) return;
      session.saveState({ grid, score, current, next });
    }

    function resumeGame() {
      const saved = session.savedState();
      const validGrid = saved && Array.isArray(saved.grid) && saved.grid.length === TOTAL_ROWS
        && saved.grid.every((row, r) => Array.isArray(row) && row.length === colsInRow(r));
      if (!validGrid) return false;
      if (saved.grid.every((row) => row.every((cell) => !cell))) return false;

      grid = saved.grid.map((row) => row.slice());
      score = Number(saved.score) || 0;
      over = false;
      moving = null;
      effects = [];
      aimAngle = 0;
      current = PALETTE.includes(saved.current) ? saved.current : randomColor();
      next = PALETTE.includes(saved.next) ? saved.next : randomColor();
      session.setScore(score);
      session.hideOverlay();
      render();

      if (rafId) cancelAnimationFrame(rafId);
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
      return true;
    }

    function initGame() {
      grid = Array.from({ length: TOTAL_ROWS }, (_, r) => Array(colsInRow(r)).fill(null));
      for (let r = 0; r < FILLED_ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
          grid[r][c] = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        }
      }
      score = 0;
      over = false;
      moving = null;
      effects = [];
      aimAngle = 0;
      current = randomColor();
      next = randomColor();
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      render();

      if (rafId) cancelAnimationFrame(rafId);
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    }

    function randomColor() {
      return PALETTE[Math.floor(Math.random() * PALETTE.length)];
    }

    function loop(time) {
      const dt = Math.min(0.033, (time - lastTime) / 1000);
      lastTime = time;
      if (!over) updateMoving(dt);
      effects = effects.filter((e) => time - e.start < e.duration);
      render();
      rafId = requestAnimationFrame(loop);
    }

    function popEffect(r, c, color) {
      const { x, y } = cellCenter(r, c);
      effects.push({ type: "pop", x, y, color, start: performance.now(), duration: 260 });
    }

    function fallEffect(r, c, color) {
      const { x, y } = cellCenter(r, c);
      effects.push({ type: "fall", x, y, color, start: performance.now(), duration: 600 });
    }

    function updateMoving(dt) {
      if (!moving) return;
      moving.x += moving.vx * dt;
      moving.y += moving.vy * dt;

      if (moving.x <= RADIUS) {
        moving.x = RADIUS;
        moving.vx = -moving.vx;
      } else if (moving.x >= WIDTH - RADIUS) {
        moving.x = WIDTH - RADIUS;
        moving.vx = -moving.vx;
      }

      if (moving.y <= RADIUS) {
        attachMoving(0);
        return;
      }

      for (let r = 0; r < TOTAL_ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
          if (!grid[r][c]) continue;
          const cell = cellCenter(r, c);
          const dx = cell.x - moving.x;
          const dy = cell.y - moving.y;
          if (Math.sqrt(dx * dx + dy * dy) < RADIUS * 1.96) {
            attachMoving(r);
            return;
          }
        }
      }
    }

    function attachMoving(hintRow) {
      let r = Math.max(0, Math.round((moving.y - RADIUS) / ROW_HEIGHT));
      r = Math.min(TOTAL_ROWS - 1, Math.max(hintRow, r));
      const offset = r % 2 === 1 ? RADIUS : 0;
      let c = Math.round((moving.x - RADIUS - offset) / COL_WIDTH);
      c = Math.min(colsInRow(r) - 1, Math.max(0, c));

      while (r >= 0 && grid[r][c]) {
        r -= 1;
        if (r < 0) break;
        c = Math.min(colsInRow(r) - 1, Math.max(0, c));
      }
      if (r < 0) r = 0;

      grid[r][c] = moving.color;
      moving = null;

      resolveMatches(r, c);
      checkGameEnd();
      saveGame();
    }

    function resolveMatches(startR, startC) {
      const color = grid[startR][startC];
      const seen = new Set();
      const stack = [[startR, startC]];
      const group = [];
      while (stack.length) {
        const [r, c] = stack.pop();
        const key = `${r},${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (grid[r][c] !== color) continue;
        group.push([r, c]);
        for (const [nr, nc] of neighbors(r, c)) {
          if (!seen.has(`${nr},${nc}`) && grid[nr][nc] === color) stack.push([nr, nc]);
        }
      }

      if (group.length >= 3) {
        for (const [r, c] of group) {
          popEffect(r, c, grid[r][c]);
          grid[r][c] = null;
        }
        score += group.length * 10;
        removeFloating();
        session.setScore(score);
      }

      if (isBoardClear()) {
        score += 200;
        session.setScore(score);
        endGame(true);
      }
    }

    function removeFloating() {
      const reachable = new Set();
      const stack = [];
      for (let c = 0; c < colsInRow(0); c++) {
        if (grid[0][c]) {
          stack.push([0, c]);
          reachable.add(`0,${c}`);
        }
      }
      while (stack.length) {
        const [r, c] = stack.pop();
        for (const [nr, nc] of neighbors(r, c)) {
          const key = `${nr},${nc}`;
          if (!reachable.has(key) && grid[nr][nc]) {
            reachable.add(key);
            stack.push([nr, nc]);
          }
        }
      }

      let removed = 0;
      for (let r = 0; r < TOTAL_ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
          if (grid[r][c] && !reachable.has(`${r},${c}`)) {
            fallEffect(r, c, grid[r][c]);
            grid[r][c] = null;
            removed++;
          }
        }
      }
      if (removed) score += removed * 20;
    }

    function isBoardClear() {
      return grid.every((row) => row.every((cell) => !cell));
    }

    function checkGameEnd() {
      for (let r = 0; r < TOTAL_ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
          if (grid[r][c]) {
            const { y } = cellCenter(r, c);
            if (y + RADIUS >= DANGER_Y) {
              endGame(false);
              return;
            }
          }
        }
      }
    }

    function endGame(won) {
      if (over) return;
      over = true;
      moving = null;
      session.finish(score, { title: won ? "Brettet er tomt! 🎉" : "Spillet er over" });
    }

    function shoot() {
      if (over || moving || !session) return;
      const dx = Math.sin(aimAngle);
      const dy = -Math.cos(aimAngle);
      moving = {
        x: WIDTH / 2,
        y: SHOOTER_Y,
        vx: dx * SPEED,
        vy: dy * SPEED,
        color: current,
      };
      current = next;
      next = randomColor();
    }

    function setAimFromPoint(px, py) {
      const dx = px - WIDTH / 2;
      const dy = Math.min(py - SHOOTER_Y, -40);
      let angle = Math.atan2(dx, -dy);
      const max = (MAX_AIM_DEG * Math.PI) / 180;
      if (angle > max) angle = max;
      if (angle < -max) angle = -max;
      aimAngle = angle;
    }

    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches && e.touches[0] ? e.touches[0] : e;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }

    function attachControls() {
      canvas.addEventListener("mousemove", (e) => {
        const p = pointerPos(e);
        setAimFromPoint(p.x, p.y);
      });
      canvas.addEventListener("click", (e) => {
        const p = pointerPos(e);
        setAimFromPoint(p.x, p.y);
        shoot();
      });
      canvas.addEventListener(
        "touchmove",
        (e) => {
          const p = pointerPos(e);
          setAimFromPoint(p.x, p.y);
          e.preventDefault();
        },
        { passive: false }
      );
      canvas.addEventListener("touchend", (e) => {
        shoot();
        e.preventDefault();
      });
    }

    function drawBubble(x, y, color) {
      const img = bubbleImages[color];
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, x - RADIUS, y - RADIUS, RADIUS * 2, RADIUS * 2);
        return;
      }
      ctx.beginPath();
      ctx.arc(x, y, RADIUS - 1.5, 0, Math.PI * 2);
      ctx.fillStyle = BUBBLE_COLORS[color] || color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - RADIUS * 0.3, y - RADIUS * 0.35, RADIUS * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fill();
    }

    function render() {
      if (!ctx) return;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      if (skyImage.complete && skyImage.naturalWidth) {
        ctx.drawImage(skyImage, 0, 0, WIDTH, HEIGHT);
      } else {
        ctx.fillStyle = "#bfe4fb";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }

      ctx.strokeStyle = "rgba(255,80,120,.35)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(0, DANGER_Y);
      ctx.lineTo(WIDTH, DANGER_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let r = 0; r < TOTAL_ROWS; r++) {
        for (let c = 0; c < colsInRow(r); c++) {
          if (!grid[r][c]) continue;
          const { x, y } = cellCenter(r, c);
          drawBubble(x, y, grid[r][c]);
        }
      }

      const now = performance.now();
      for (const e of effects) {
        const t = Math.min(1, (now - e.start) / e.duration);
        ctx.globalAlpha = Math.max(0, 1 - t);
        if (e.type === "pop") {
          ctx.beginPath();
          ctx.arc(e.x, e.y, RADIUS * (1 + t * 0.9), 0, Math.PI * 2);
          ctx.fillStyle = e.color;
          ctx.fill();
        } else {
          const y = e.y + 900 * t * t * 0.5 + 40 * t;
          drawBubble(e.x, y, e.color);
        }
      }
      ctx.globalAlpha = 1;

      if (moving) drawBubble(moving.x, moving.y, moving.color);

      if (!moving && !over) {
        const dx = Math.sin(aimAngle);
        const dy = -Math.cos(aimAngle);
        ctx.strokeStyle = "rgba(255,255,255,.25)";
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.moveTo(WIDTH / 2, SHOOTER_Y);
        ctx.lineTo(WIDTH / 2 + dx * 260, SHOOTER_Y + dy * 260);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(WIDTH / 2, SHOOTER_Y + RADIUS + 10, RADIUS + 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.05)";
      ctx.fill();
      if (current) drawBubble(WIDTH / 2, SHOOTER_Y + RADIUS + 10, current);

      if (next) {
        drawBubble(WIDTH - RADIUS - 8, HEIGHT - RADIUS - 8, next);
        ctx.fillStyle = "rgba(255,255,255,.6)";
        ctx.font = "10px Poppins, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("neste", WIDTH - RADIUS - 8, HEIGHT - RADIUS * 2 - 12);
      }
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
