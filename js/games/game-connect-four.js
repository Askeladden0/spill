/**
 * Studilla – Fire på rad.
 * Du spiller rødt mot en AI som spiller gult. Slipp brikker i kolonnene og
 * få fire på rad (vannrett, loddrett eller diagonalt) før AI-en gjør det.
 * AI-en bruker minimax med alpha-beta-beskjæring og en enkel heuristikk
 * (midtkolonne og åpne tre-på-rad teller mest). Bruker den delte
 * spill-kjøretiden (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const GAME_ID = "connect-four";
  const ROWS = 6;
  const COLS = 7;
  const HUMAN = 1;
  const AI = 2;
  const AI_DEPTH = 5;
  const AI_DELAY_MS = 450;
  const WIN_SCORE = 100000;

  // ---------- Ren spillogikk (ingen DOM) ----------

  function emptyBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  }

  function validCols(board) {
    // Midten først gir bedre beskjæring i alpha-beta.
    const order = [3, 2, 4, 1, 5, 0, 6];
    return order.filter((c) => board[0][c] === 0);
  }

  function dropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === 0) return r;
    return -1;
  }

  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  // Returnerer de fire rutene som vinner for `who` gjennom (r, c), eller null.
  function winLine(board, r, c, who) {
    for (const [dr, dc] of DIRS) {
      const line = [[r, c]];
      for (const sign of [1, -1]) {
        let rr = r + dr * sign;
        let cc = c + dc * sign;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === who) {
          line.push([rr, cc]);
          rr += dr * sign;
          cc += dc * sign;
        }
      }
      if (line.length >= 4) return line;
    }
    return null;
  }

  function boardFull(board) {
    return board[0].every((v) => v !== 0);
  }

  function scoreWindow(cells, who) {
    const other = who === AI ? HUMAN : AI;
    let mine = 0;
    let theirs = 0;
    let empty = 0;
    for (const v of cells) {
      if (v === who) mine++;
      else if (v === other) theirs++;
      else empty++;
    }
    if (mine === 4) return 1000;
    if (mine === 3 && empty === 1) return 50;
    if (mine === 2 && empty === 2) return 8;
    if (theirs === 3 && empty === 1) return -60;
    if (theirs === 2 && empty === 2) return -6;
    return 0;
  }

  function evaluate(board) {
    let score = 0;
    for (let r = 0; r < ROWS; r++) if (board[r][3] === AI) score += 6; else if (board[r][3] === HUMAN) score -= 6;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        for (const [dr, dc] of DIRS) {
          const er = r + dr * 3;
          const ec = c + dc * 3;
          if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
          const win = [];
          for (let i = 0; i < 4; i++) win.push(board[r + dr * i][c + dc * i]);
          score += scoreWindow(win, AI);
        }
      }
    }
    return score;
  }

  // Minimax med alpha-beta. `lastWin` sier om forrige trekk ga fire på rad,
  // så vi slipper å skanne hele brettet for hver node.
  function minimax(board, depth, alpha, beta, maximizing, lastWin) {
    if (lastWin) return maximizing ? -(WIN_SCORE + depth) : (WIN_SCORE + depth);
    const cols = validCols(board);
    if (!cols.length) return 0;
    if (depth === 0) return evaluate(board);

    if (maximizing) {
      let best = -Infinity;
      for (const c of cols) {
        const r = dropRow(board, c);
        board[r][c] = AI;
        const won = !!winLine(board, r, c, AI);
        const v = minimax(board, depth - 1, alpha, beta, false, won);
        board[r][c] = 0;
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const c of cols) {
      const r = dropRow(board, c);
      board[r][c] = HUMAN;
      const won = !!winLine(board, r, c, HUMAN);
      const v = minimax(board, depth - 1, alpha, beta, true, won);
      board[r][c] = 0;
      if (v < best) best = v;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Velger kolonne for AI-en. Blant like gode trekk velges et tilfeldig,
  // så ikke alle partier ender likt.
  function chooseAiMove(board) {
    let bestScore = -Infinity;
    let bestCols = [];
    for (const c of validCols(board)) {
      const r = dropRow(board, c);
      board[r][c] = AI;
      const won = !!winLine(board, r, c, AI);
      const v = minimax(board, AI_DEPTH - 1, -Infinity, Infinity, false, won);
      board[r][c] = 0;
      if (v > bestScore) { bestScore = v; bestCols = [c]; }
      else if (v === bestScore) bestCols.push(c);
    }
    return bestCols[Math.floor(Math.random() * bestCols.length)];
  }

  // ---------- Spillflyt og tegning ----------

  function start(container) {
    let board = emptyBoard();
    let turn = HUMAN;
    let over = false;
    let busy = false;
    let moves = 0;
    let session = null;
    let boardEl = null;
    let statusEl = null;
    let hoverCol = -1;
    let aiTimer = null;
    let endTimer = null;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <div class="c4-wrap">
          <div class="c4-status" data-c4-status></div>
          <div class="c4-board" data-c4-board tabindex="0" role="grid" aria-label="Fire på rad"></div>
        </div>
      `;
      boardEl = session.playArea.querySelector("[data-c4-board]");
      statusEl = session.playArea.querySelector("[data-c4-status]");
      buildBoard();
      session.onRestart(() => initGame());
      attachControls();
      initGame();
    });

    function initGame() {
      clearTimeout(aiTimer);
      clearTimeout(endTimer);
      board = emptyBoard();
      turn = HUMAN;
      over = false;
      busy = false;
      moves = 0;
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      render();
      setStatus("Din tur – du er rød");
    }

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function play(col, who) {
      const r = dropRow(board, col);
      if (r < 0) return null;
      board[r][col] = who;
      moves++;
      const line = winLine(board, r, col, who);
      render({ dropped: [r, col], line });
      return { r, line };
    }

    // Poeng: seier gir mer jo raskere du vinner, uavgjort gir litt, tap gir 0.
    function finish(result, line) {
      over = true;
      busy = true;
      let score = 0;
      let title;
      if (result === "win") {
        const myMoves = Math.ceil(moves / 2);
        score = 100 + Math.max(0, 21 - myMoves) * 10;
        title = "Du vant!";
        setStatus("Fire på rad – du vant!");
      } else if (result === "draw") {
        score = 50;
        title = "Uavgjort";
        setStatus("Brettet er fullt – uavgjort");
      } else {
        title = "AI-en vant";
        setStatus("AI-en fikk fire på rad");
      }
      session.setScore(score);
      render({ line });
      endTimer = setTimeout(() => session.finish(score, { title }), 900);
    }

    function humanMove(col) {
      if (!session || over || busy || turn !== HUMAN) return;
      const res = play(col, HUMAN);
      if (!res) return;
      if (res.line) return finish("win", res.line);
      if (boardFull(board)) return finish("draw");
      turn = AI;
      busy = true;
      setStatus("AI-en tenker …");
      // Utsettelsen gir tid til å se brikken lande før AI-en regner
      // (minimax blokkerer tråden en kort stund).
      aiTimer = setTimeout(aiMove, AI_DELAY_MS);
    }

    function aiMove() {
      if (over) return;
      const col = chooseAiMove(board);
      const res = play(col, AI);
      if (res && res.line) return finish("lose", res.line);
      if (boardFull(board)) return finish("draw");
      turn = HUMAN;
      busy = false;
      setStatus("Din tur – du er rød");
      render();
    }

    function buildBoard() {
      boardEl.innerHTML = "";
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = document.createElement("div");
          cell.className = "c4-cell";
          cell.dataset.r = r;
          cell.dataset.c = c;
          cell.setAttribute("role", "gridcell");
          boardEl.appendChild(cell);
        }
      }
    }

    function colFromEvent(e) {
      const cell = e.target.closest(".c4-cell");
      return cell ? +cell.dataset.c : -1;
    }

    function attachControls() {
      boardEl.addEventListener("click", (e) => {
        const c = colFromEvent(e);
        if (c >= 0) humanMove(c);
      });
      boardEl.addEventListener("pointerover", (e) => {
        const c = colFromEvent(e);
        if (c !== hoverCol) { hoverCol = c; render(); }
      });
      boardEl.addEventListener("pointerleave", () => {
        if (hoverCol !== -1) { hoverCol = -1; render(); }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key >= "1" && e.key <= "7") {
          e.preventDefault();
          humanMove(+e.key - 1);
        }
      });
    }

    function render(info) {
      info = info || {};
      const winSet = new Set((info.line || []).map(([r, c]) => r * COLS + c));
      const cells = boardEl.children;
      // Forhåndsvisning av hvor brikken lander i kolonnen musa står over.
      const ghostRow = hoverCol >= 0 && !over && !busy ? dropRow(board, hoverCol) : -1;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const v = board[r][c];
          const el = cells[r * COLS + c];
          let cls = "c4-cell";
          if (v === HUMAN) cls += " is-red";
          else if (v === AI) cls += " is-yellow";
          else if (r === ghostRow && c === hoverCol) cls += " is-ghost";
          if (winSet.has(r * COLS + c)) cls += " is-win";
          if (info.dropped && info.dropped[0] === r && info.dropped[1] === c) cls += " is-drop";
          if (c === hoverCol && !over && !busy) cls += " is-col";
          if (el.className !== cls) el.className = cls;
        }
      }
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
