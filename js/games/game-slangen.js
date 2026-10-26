/**
 * Studilla – Snake.
 * Klassisk slange-spill på et rutenett: styr med piltaster/WASD (eller
 * sveip på mobil), spis prikkene og voks deg lengst mulig uten å treffe
 * veggen eller deg selv. Bruker den delte spill-kjøretiden
 * (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const SIZE = 10;
  const GAME_ID = "slangen";
  const TICK_MS = 130;
  const SPRITE_PATH = "assets/img/games/snake/";
  const HEAD_IDLE = ["normal", "tongue", "normal", "tongue", "normal", "normal", "blink", "normal", "open", "open", "normal", "tongue"];
  const SPRITE_NAMES = [
    "apple", "body-h", "body-v", "corner-0", "corner-90", "corner-180", "corner-270",
    "grass-0", "grass-1", "grass-2", "flower", "frame",
  ];
  ["right", "down", "left", "up"].forEach((d) => {
    SPRITE_NAMES.push("tail-" + d);
    ["normal", "tongue", "blink", "open"].forEach((f) => SPRITE_NAMES.push("head-" + f + "-" + d));
  });

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
    let sprEls = null;
    let moves = 0;
    let idleStep = 0;
    // Satt til true frem til spilleren trykker en retningstast eller sveiper:
    // slangen står stille helt til da, både ved ny runde og ved en
    // gjenopptatt lagret runde, slik at man ikke krasjer med en gang.
    // Hintet på brettet (hintEl) sier hva som skal til.
    let waitingToStart = false;
    let hintEl = null;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      // Forhåndslast alle sprites så ruter ikke blinker tomme ved bytte.
      SPRITE_NAMES.forEach((n) => { new Image().src = SPRITE_PATH + n + ".svg"; });
      setInterval(() => { idleStep++; if (waitingToStart) updateHead(); }, 380);
      session.playArea.innerHTML = `
        <div class="board-snake" data-board-snake tabindex="0"></div>
      `;
      session.onRestart(() => initGame());
      // Pause (js/game-runtime.js): stopp steg-timeren. Venter slangen på
      // første tast, står den allerede stille.
      session.onPause(() => {
        if (!timer) return false;
        clearInterval(timer);
        timer = null;
        return true;
      }, () => {
        if (!over && !waitingToStart) timer = setInterval(tick, TICK_MS);
      });
      attachControls();
      // Fortsett en påbegynt runde hvis den ligger lagret, ellers ny runde.
      if (!resumeGame()) initGame();
    });

    function saveGame() {
      if (!session || over) return;
      session.saveState({ snake, direction, food, score });
    }

    function resumeGame() {
      const saved = session.savedState();
      const validSnake = saved && Array.isArray(saved.snake) && saved.snake.length
        && saved.snake.every((seg) => seg && Number.isFinite(seg.r) && Number.isFinite(seg.c)
          && seg.r >= 0 && seg.r < SIZE && seg.c >= 0 && seg.c < SIZE);
      if (!validSnake) return false;

      snake = saved.snake.map((seg) => ({ r: seg.r, c: seg.c }));
      direction = OPPOSITE[saved.direction] ? saved.direction : "right";
      nextDirection = direction;
      score = Number(saved.score) || 0;
      over = false;
      food = saved.food && Number.isFinite(saved.food.r) && Number.isFinite(saved.food.c) ? saved.food : null;
      if (!food) placeFood();

      render();
      session.setScore(score);
      session.hideOverlay();

      if (timer) clearInterval(timer);
      timer = null;
      setWaiting(true);

      const boardEl = session.playArea.querySelector("[data-board-snake]");
      if (boardEl) boardEl.focus({ preventScroll: true });
      return true;
    }

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
      moves = 0;
      placeFood();
      render();
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      setWaiting(true);

      if (timer) clearInterval(timer);
      timer = null;

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
      moves++;

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
      saveGame();
    }

    function endGame() {
      over = true;
      if (timer) clearInterval(timer);
      updateHead();
      const boardEl = session.playArea.querySelector("[data-board-snake]");
      if (boardEl) {
        boardEl.classList.add("is-shaking");
        setTimeout(() => boardEl.classList.remove("is-shaking"), 400);
      }
      session.finish(score);
    }

    // Rutene bygges kun én gang og gjenbrukes videre (i stedet for å bygges
    // helt på nytt hvert eneste tikk). Hver rute har et bakke-bilde
    // (gress/blomst) som bakgrunn, og et eget sprite-element oppå som viser
    // slangen eller eplet. Bakken bestemmes av rutens posisjon og endrer seg
    // aldri, så render() rører den ikke.
    function buildBoard() {
      const boardEl = session.playArea.querySelector("[data-board-snake]");
      if (!boardEl) return null;
      boardEl.innerHTML = "";
      boardEl.style.setProperty("--snake-size", SIZE);
      boardEl.classList.remove("is-shaking");
      cellEls = [];
      sprEls = [];
      for (let r = 0; r < SIZE; r++) {
        const rowEls = [];
        const sprRow = [];
        for (let c = 0; c < SIZE; c++) {
          const cell = document.createElement("div");
          cell.className = "cell-snake " + groundClass(r, c);
          const spr = document.createElement("span");
          spr.className = "snake-spr";
          cell.appendChild(spr);
          boardEl.appendChild(cell);
          rowEls.push(cell);
          sprRow.push(spr);
        }
        cellEls.push(rowEls);
        sprEls.push(sprRow);
      }
      hintEl = document.createElement("div");
      hintEl.className = "snake-start-hint";
      hintEl.textContent = "Trykk en piltast eller sveip for å starte";
      hintEl.hidden = !waitingToStart;
      boardEl.appendChild(hintEl);
      return boardEl;
    }

    // Fast, "tilfeldig" fordeling av gresstyper ut fra rutens posisjon.
    function groundClass(r, c) {
      const h = ((r * 73856093) ^ (c * 19349663)) >>> 0;
      return h % 100 < 8 ? "ground-flower" : "ground-" + (h % 3);
    }

    function setSprite(spr, name) {
      if (spr.dataset.sprite === name) return;
      if (name) {
        spr.dataset.sprite = name;
        spr.style.backgroundImage = 'url("' + SPRITE_PATH + name + '.svg")';
      } else {
        delete spr.dataset.sprite;
        spr.style.backgroundImage = "";
      }
    }

    const DIR_OF_DELTA = { "0,1": "right", "1,0": "down", "0,-1": "left", "-1,0": "up" };
    function dirFrom(from, to) {
      return DIR_OF_DELTA[(to.r - from.r) + "," + (to.c - from.c)] || direction;
    }

    const DIR_DELTA = {
      up: { dr: -1, dc: 0 },
      down: { dr: 1, dc: 0 },
      left: { dr: 0, dc: -1 },
      right: { dr: 0, dc: 1 },
    };

    // Hodet veksler mellom rammene vanlig/tunge/blunk/åpen munn. Før start
    // går de i en rolig løkke; under spill følger de tikkene, og munnen
    // åpner seg når eplet er rett foran. Etter krasj blunker hodet.
    function headFrame() {
      if (over) return "blink";
      const h = snake[0];
      const d = DIR_DELTA[direction];
      if (food && h.r + d.dr === food.r && h.c + d.dc === food.c) return "open";
      if (waitingToStart) return HEAD_IDLE[idleStep % HEAD_IDLE.length];
      if (moves % 9 === 4) return "blink";
      return moves % 6 < 2 ? "tongue" : "normal";
    }

    function updateHead() {
      if (!sprEls || !snake.length) return;
      const h = snake[0];
      const faceDir = snake.length > 1 ? dirFrom(snake[1], h) : direction;
      setSprite(sprEls[h.r][h.c], "head-" + headFrame() + "-" + faceDir);
    }

    function segmentSprite(i) {
      const cur = snake[i];
      if (i === snake.length - 1) return "tail-" + dirFrom(snake[i - 1], cur);
      const side = (q) => (q.c < cur.c ? "L" : q.c > cur.c ? "R" : q.r < cur.r ? "T" : "B");
      const set = [side(snake[i - 1]), side(snake[i + 1])].sort().join("");
      if (set === "LR") return "body-h";
      if (set === "BT") return "body-v";
      return "corner-" + { BL: 0, LT: 90, RT: 180, BR: 270 }[set];
    }

    function render(ateAt) {
      if (!session.playArea.querySelector("[data-board-snake]")) return;
      if (!cellEls) buildBoard();
      const body = new Map();
      for (let i = 1; i < snake.length; i++) body.set(snake[i].r * SIZE + snake[i].c, segmentSprite(i));
      const head = snake[0];
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const spr = sprEls[r][c];
          const key = r * SIZE + c;
          const isFood = !!(food && food.r === r && food.c === c);
          spr.classList.toggle("is-food", isFood);
          spr.classList.remove("is-eating");
          if (head.r === r && head.c === c) {
            if (ateAt) spr.classList.add("is-eating");
          } else if (isFood) setSprite(spr, "apple");
          else setSprite(spr, body.get(key) || null);
        }
      }
      updateHead();
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

    function setWaiting(on) {
      waitingToStart = on;
      if (hintEl) hintEl.hidden = !on;
    }

    function setDirection(dir) {
      if (!dir || !session || over) return;
      // Første retning starter runden. Før godtok den bare «høyre», og alle
      // andre taster ble ignorert uten at noe på skjermen sa hvorfor. Rett
      // bakover (inn i halen) ville vært game over på første steg, så da
      // fortsetter slangen bare dit den peker.
      if (waitingToStart) {
        if (dir !== OPPOSITE[direction]) nextDirection = dir;
        setWaiting(false);
        if (timer) clearInterval(timer);
        timer = setInterval(tick, TICK_MS);
        return;
      }
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

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
