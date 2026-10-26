/**
 * Studilla – Minesveiper.
 * Avdekk alle rutene som ikke er miner. Trykk for å åpne en rute, høyreklikk
 * (eller bruk flaggmodus / langt trykk på mobil) for å sette flagg. Første
 * trykk er alltid trygt. Bruker den delte spill-kjøretiden
 * (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 *
 * Spillogikken (minelegging, flomfylling, flagg, vinnerbetingelse) er skilt
 * ut fra tegningen og ligger øverst i start().
 */
(function () {
  "use strict";

  const GAME_ID = "minesveiper";
  const ROWS = 9;
  const COLS = 9;
  const MINES = 10;
  const LONG_PRESS_MS = 380;
  const CELL_POINTS = 10;

  function start(container) {
    let cells = [];
    let started = false;
    let over = false;
    let flagMode = false;
    let flagsLeft = MINES;
    let revealed = 0;
    let seconds = 0;
    let timer = null;
    let session = null;
    let boardEl = null;
    let flagsEl = null;
    let timeEl = null;
    let modeBtn = null;

    // ---------- Spillogikk ----------

    function newCells() {
      cells = [];
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) row.push({ mine: false, open: false, flag: false, n: 0 });
        cells.push(row);
      }
    }

    function neighbors(r, c) {
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push([rr, cc]);
        }
      }
      return out;
    }

    // Legger miner ETTER første trykk, slik at første rute (og naboene)
    // aldri er en mine.
    function placeMines(safeR, safeC) {
      const forbidden = new Set([safeR * COLS + safeC]);
      neighbors(safeR, safeC).forEach(([r, c]) => forbidden.add(r * COLS + c));
      const pool = [];
      for (let i = 0; i < ROWS * COLS; i++) if (!forbidden.has(i)) pool.push(i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      pool.slice(0, MINES).forEach((i) => { cells[Math.floor(i / COLS)][i % COLS].mine = true; });
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          cells[r][c].n = neighbors(r, c).filter(([rr, cc]) => cells[rr][cc].mine).length;
        }
      }
    }

    // Åpner en rute; tomme ruter (0 miner rundt) åpner naboene sine videre.
    // Iterativ, så den tåler store brett uten rekursjonsdybde.
    function reveal(r, c) {
      const stack = [[r, c]];
      let hitMine = false;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        const cell = cells[cr][cc];
        if (cell.open || cell.flag) continue;
        cell.open = true;
        if (cell.mine) { hitMine = true; continue; }
        revealed++;
        if (cell.n === 0) neighbors(cr, cc).forEach((p) => stack.push(p));
      }
      return hitMine;
    }

    function toggleFlag(r, c) {
      const cell = cells[r][c];
      if (cell.open) return false;
      if (!cell.flag && flagsLeft <= 0) return false;
      cell.flag = !cell.flag;
      flagsLeft += cell.flag ? -1 : 1;
      return true;
    }

    // Trykk på en åpnet rute hvis tallet stemmer med antall flagg rundt:
    // åpner alle de andre naboene (akkurat som i klassisk Minesveiper).
    function chord(r, c) {
      const cell = cells[r][c];
      if (!cell.open || cell.n === 0) return false;
      const around = neighbors(r, c);
      if (around.filter(([rr, cc]) => cells[rr][cc].flag).length !== cell.n) return false;
      let hit = false;
      around.forEach(([rr, cc]) => { if (reveal(rr, cc)) hit = true; });
      return hit;
    }

    function hasWon() {
      return revealed === ROWS * COLS - MINES;
    }

    function currentScore() {
      return revealed * CELL_POINTS;
    }

    // ---------- Flyt ----------

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <div class="ms-wrap">
          <div class="ms-bar">
            <span class="ms-stat" title="Flagg igjen">🚩 <b data-ms-flags>${MINES}</b></span>
            <button type="button" class="ms-mode" data-ms-mode aria-pressed="false">⛏ Åpne</button>
            <span class="ms-stat" title="Tid">⏱ <b data-ms-time>0</b></span>
          </div>
          <div class="ms-board" data-ms-board></div>
          <p class="ms-hint">Trykk for å åpne. Høyreklikk eller langt trykk setter flagg.</p>
        </div>
      `;
      boardEl = session.playArea.querySelector("[data-ms-board]");
      flagsEl = session.playArea.querySelector("[data-ms-flags]");
      timeEl = session.playArea.querySelector("[data-ms-time]");
      modeBtn = session.playArea.querySelector("[data-ms-mode]");
      boardEl.style.setProperty("--ms-cols", COLS);
      modeBtn.addEventListener("click", () => {
        flagMode = !flagMode;
        renderMode();
      });
      session.onRestart(() => initGame());
      // Pause (js/game-runtime.js): stopp klokka, som gir tidsbonus ved seier.
      session.onPause(() => {
        if (!timer || over) return false;
        clearInterval(timer);
        timer = null;
        return true;
      }, () => {
        if (!over) startTimer();
      });
      buildBoard();
      initGame();
    });

    function initGame() {
      if (timer) clearInterval(timer);
      timer = null;
      newCells();
      started = false;
      over = false;
      flagMode = false;
      flagsLeft = MINES;
      revealed = 0;
      seconds = 0;
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      renderMode();
      render();
    }

    function startTimer() {
      timer = setInterval(() => {
        seconds++;
        timeEl.textContent = seconds;
      }, 1000);
    }

    function endGame(won) {
      over = true;
      if (timer) clearInterval(timer);
      timer = null;
      // Ved seier: bonus for hurtighet. Ved tap: poeng for det som ble åpnet.
      const bonus = won ? 200 + Math.max(0, 300 - seconds) * 2 : 0;
      const score = currentScore() + bonus;
      session.setScore(score);
      render();
      setTimeout(() => {
        session.finish(score, { title: won ? "Du ryddet brettet!" : "Boom! Du traff en mine" });
      }, won ? 250 : 700);
    }

    function act(r, c, asFlag) {
      if (!session || over) return;
      const cell = cells[r][c];
      if (asFlag) {
        if (toggleFlag(r, c)) render();
        return;
      }
      if (cell.flag) return;
      let hit;
      if (cell.open) {
        hit = chord(r, c);
      } else {
        if (!started) {
          started = true;
          placeMines(r, c);
          startTimer();
        }
        hit = reveal(r, c);
      }
      session.setScore(currentScore());
      render();
      if (hit) endGame(false);
      else if (hasWon()) endGame(true);
    }

    // ---------- Tegning ----------

    function buildBoard() {
      boardEl.innerHTML = "";
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "ms-cell";
          b.dataset.r = r;
          b.dataset.c = c;
          boardEl.appendChild(b);
        }
      }

      // Langt trykk = flagg (uavhengig av modus). `longFired` hindrer at
      // slippet etterpå også regnes som et vanlig trykk.
      let pressTimer = null;
      let longFired = false;
      const cancelPress = () => clearTimeout(pressTimer);

      boardEl.addEventListener("pointerdown", (e) => {
        const btn = e.target.closest(".ms-cell");
        if (!btn || e.button === 2) return;
        longFired = false;
        cancelPress();
        pressTimer = setTimeout(() => {
          longFired = true;
          act(+btn.dataset.r, +btn.dataset.c, true);
          if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* ignorer */ } }
        }, LONG_PRESS_MS);
      });
      boardEl.addEventListener("pointerup", cancelPress);
      boardEl.addEventListener("pointerleave", cancelPress);
      boardEl.addEventListener("pointercancel", cancelPress);

      boardEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".ms-cell");
        if (!btn) return;
        if (longFired) { longFired = false; return; }
        act(+btn.dataset.r, +btn.dataset.c, flagMode);
      });
      boardEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const btn = e.target.closest(".ms-cell");
        if (!btn) return;
        longFired = false;
        act(+btn.dataset.r, +btn.dataset.c, true);
      });
    }

    function renderMode() {
      modeBtn.textContent = flagMode ? "🚩 Flagg" : "⛏ Åpne";
      modeBtn.setAttribute("aria-pressed", String(flagMode));
      modeBtn.classList.toggle("is-flag", flagMode);
    }

    function render() {
      flagsEl.textContent = flagsLeft;
      timeEl.textContent = seconds;
      const btns = boardEl.children;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = cells[r][c];
          const el = btns[r * COLS + c];
          let cls = "ms-cell";
          let text = "";
          if (cell.open) {
            cls += " is-open";
            if (cell.mine) { cls += " is-mine is-hit"; text = "💣"; }
            else if (cell.n) { cls += " n" + cell.n; text = String(cell.n); }
          } else if (over && cell.mine && !cell.flag) {
            cls += " is-open is-mine";
            text = "💣";
          } else if (cell.flag) {
            cls += " is-flag";
            text = "🚩";
            if (over && !cell.mine) cls += " is-wrong";
          }
          if (el.className !== cls) el.className = cls;
          if (el.textContent !== text) el.textContent = text;
        }
      }
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
