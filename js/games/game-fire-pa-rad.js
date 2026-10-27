/**
 * Studilla – Fire på rad.
 * Du spiller rødt mot en AI som spiller gult. Slipp brikker i kolonnene og
 * få fire på rad (vannrett, loddrett eller diagonalt) før AI-en gjør det.
 * AI-en bruker minimax med alpha-beta-beskjæring og en enkel heuristikk
 * (midtkolonne og åpne tre-på-rad teller mest). Bruker den delte
 * spill-kjøretiden (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 * Man kan også spille online mot en venn (js/online-match.js): da tegnes
 * brettet fra kampraden på serveren, og det gis ingen poeng.
 */
(function () {
  "use strict";

  const GAME_ID = "fire-pa-rad";
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

  // Med ?kamp=<id> i adressen er dette en online kamp mot en annen spiller
  // (js/online-match.js). Uten velger man mellom AI-en og å invitere en venn.
  function start(container) {
    const Online = window.StudillaOnline;
    const Social = window.StudillaSocial;
    let board = emptyBoard();
    let turn = HUMAN;
    let over = false;
    let busy = false;
    let moves = 0;
    let session = null;
    let boardEl = null;
    let statusEl = null;
    let onlineEl = null;
    let hoverCol = -1;
    let aiTimer = null;
    let endTimer = null;
    // Brikken som spilleren på denne skjermen slipper (styrer forhåndsvisningen).
    let myPiece = HUMAN;
    // Hva et klikk/tastetrykk på en kolonne gjør i gjeldende modus.
    let onColumn = () => {};
    let controlsAttached = false;

    // Online-tilstand.
    let matchId = null;
    let seat = 0;
    let row = null;
    let unsubscribe = null;
    let lastMoveSeen = null;
    let inviteShown = false;
    // Øker for hver startOnline, så et eldre kall som fortsatt venter på
    // serveren ikke rekker å abonnere etter at et nyere har tatt over.
    let onlineGen = 0;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      const kamp = new URLSearchParams(window.location.search).get("kamp");
      if (Online && Online.isMatchId(kamp)) startOnline(kamp);
      else showModePicker();
    });

    function esc(text) {
      return String(text == null ? "" : text).replace(/[&<>"']/g, (ch) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
      ));
    }

    function setKampParam(id) {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("kamp", id);
      else url.searchParams.delete("kamp");
      window.history.replaceState(null, "", url.toString());
    }

    function showModePicker() {
      stopOnline();
      setKampParam(null);
      session.onRestart(null);
      session.playArea.innerHTML = `
        <div class="c4-wrap c4-modes">
          <div class="c4-status">Hvem vil du spille mot?</div>
          <button type="button" class="btn-primary c4-mode-btn" data-c4-mode="ai">Mot datamaskinen</button>
          <button type="button" class="btn-outline c4-mode-btn" data-c4-mode="online">Mot en venn online</button>
          <p class="c4-mode-hint">Send en lenke eller en melding til en venn – dere trenger ikke være logget inn.</p>
          <p class="c4-mode-error" data-c4-mode-error hidden></p>
        </div>
      `;
      const errEl = session.playArea.querySelector("[data-c4-mode-error]");
      session.playArea.querySelector('[data-c4-mode="ai"]').addEventListener("click", startAi);
      const onlineBtn = session.playArea.querySelector('[data-c4-mode="online"]');
      if (!Online || !Online.isAvailable()) {
        onlineBtn.disabled = true;
        errEl.hidden = false;
        errEl.textContent = "Online-spill er ikke tilgjengelig akkurat nå.";
        return;
      }
      onlineBtn.addEventListener("click", async () => {
        onlineBtn.disabled = true;
        onlineBtn.textContent = "Lager kamp …";
        try {
          const id = await Online.create(GAME_ID);
          startOnline(id);
        } catch (e) {
          onlineBtn.disabled = false;
          onlineBtn.textContent = "Mot en venn online";
          errEl.hidden = false;
          errEl.textContent = (e && e.message) || "Klarte ikke lage kampen.";
        }
      });
    }

    // Felles brett-markup for begge modusene.
    function mountBoard(withOnlinePanel) {
      session.playArea.innerHTML = `
        <div class="c4-wrap">
          <div class="c4-status" data-c4-status></div>
          <div class="c4-board" data-c4-board tabindex="0" role="grid" aria-label="Fire på rad"></div>
          ${withOnlinePanel ? '<div class="c4-online" data-c4-online></div>' : ""}
        </div>
      `;
      boardEl = session.playArea.querySelector("[data-c4-board]");
      statusEl = session.playArea.querySelector("[data-c4-status]");
      onlineEl = session.playArea.querySelector("[data-c4-online]");
      hoverCol = -1;
      buildBoard();
      attachBoardControls();
      if (!controlsAttached) {
        controlsAttached = true;
        document.addEventListener("keydown", (e) => {
          if (!boardEl || !document.body.contains(boardEl)) return;
          if (e.key >= "1" && e.key <= "7") {
            e.preventDefault();
            onColumn(+e.key - 1);
          }
        });
      }
    }

    // ---------- Mot datamaskinen ----------

    function startAi() {
      myPiece = HUMAN;
      mountBoard(false);
      onColumn = humanMove;
      session.onRestart(() => initGame());
      initGame();
    }

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

    // ---------- Online mot en venn ----------
    // Serveren (online_c4_move) bestemmer hva som er lov og hvem som vant;
    // her tegnes bare raden den sender. Online-kamper gir ikke poeng.

    function stopOnline() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      matchId = null;
      row = null;
      seat = 0;
      lastMoveSeen = null;
    }

    async function startOnline(id) {
      if (id === matchId && unsubscribe) return;
      const gen = ++onlineGen;
      stopOnline();
      matchId = id;
      setKampParam(id);
      mountBoard(true);
      onColumn = onlineMove;
      session.onRestart(null);
      session.setScore(0);
      over = true;
      busy = true;
      render();
      setStatus("Kobler til kampen …");
      try {
        seat = await Online.join(id);
        if (gen !== onlineGen) return;
        myPiece = seat === 2 ? AI : HUMAN;
        const first = await Online.fetch(id);
        if (gen !== onlineGen) return;
        if (!first) throw new Error("Fant ikke kampen.");
        applyRow(first);
        unsubscribe = Online.subscribe(id, applyRow);
      } catch (e) {
        if (gen !== onlineGen) return;
        setStatus((e && e.message) || "Fant ikke kampen.");
        onlineEl.innerHTML = `<button type="button" class="btn-primary" data-c4-new>Start en ny kamp</button>`;
        onlineEl.querySelector("[data-c4-new]").addEventListener("click", showModePicker);
      }
    }

    function opponentName() {
      if (!row) return "Motspilleren";
      return (seat === 2 ? row.host_name : row.guest_name) || "Motspilleren";
    }

    function colorName(s) {
      return s === 1 ? "rød" : "gul";
    }

    function applyRow(next) {
      if (!next || next.id !== matchId) return;
      // Begge spillerne følger revansjen automatisk.
      if (next.rematch_id && seat > 0) {
        Online.followRematch(matchId, next.rematch_id);
        startOnline(next.rematch_id);
        return;
      }
      row = next;
      board = emptyBoard();
      for (let i = 0; i < ROWS * COLS; i++) board[Math.floor(i / COLS)][i % COLS] = +row.board[i];
      over = row.status !== "playing";
      busy = over || seat === 0 || row.turn !== seat;
      const info = {};
      if (row.last_move != null && row.last_move !== lastMoveSeen) {
        info.dropped = [Math.floor(row.last_move / COLS), row.last_move % COLS];
      }
      lastMoveSeen = row.last_move;
      if (row.win_line) info.line = row.win_line;
      render(info);
      renderOnlineStatus();
    }

    function renderOnlineStatus() {
      const opp = opponentName();
      let status;
      if (row.status === "waiting") {
        status = seat === 1 ? "Venter på motspiller …" : "Kampen har ikke startet";
      } else if (row.status === "playing") {
        if (seat === 0) status = `${row.turn === 1 ? row.host_name : row.guest_name} (${colorName(row.turn)}) sin tur`;
        else status = row.turn === seat ? `Din tur – du er ${colorName(seat)}` : `${opp} sin tur …`;
      } else if (row.winner === 0) {
        status = "Brettet er fullt – uavgjort";
      } else if (seat === 0) {
        status = `${row.winner === 1 ? row.host_name : row.guest_name} vant`;
      } else if (row.winner === seat) {
        status = row.resigned ? `${opp} ga opp – du vant!` : "Fire på rad – du vant!";
      } else {
        status = row.resigned === seat ? "Du ga opp" : `${opp} vant`;
      }
      setStatus(status);

      let html = "";
      if (seat === 0) {
        html = `
          <p class="c4-online-note">Kampen er full – du ser på.</p>
          <button type="button" class="btn-outline" data-c4-new>Start din egen kamp</button>`;
      } else if (row.status === "waiting") {
        html = `
          <p class="c4-online-note">Send lenken til en venn. Kampen starter når hen åpner den.</p>
          <button type="button" class="btn-primary" data-c4-invite>Inviter en venn</button>
          <button type="button" class="btn-outline" data-c4-new>Avbryt</button>`;
      } else if (row.status === "playing") {
        html = `
          <p class="c4-online-note">Du (${colorName(seat)}) mot ${esc(opp)} (${colorName(seat === 1 ? 2 : 1)})</p>
          <button type="button" class="btn-outline" data-c4-resign>Gi opp</button>`;
      } else {
        html = `
          <button type="button" class="btn-primary" data-c4-rematch>Revansj</button>
          <button type="button" class="btn-outline" data-c4-new>Ny kamp</button>`;
      }
      onlineEl.innerHTML = html;
      bindOnlineButtons();

      // Invitasjonsmenyen åpnes av seg selv første gang man lager en kamp.
      if (row.status === "waiting" && seat === 1 && !inviteShown) {
        inviteShown = true;
        openInvite();
      }
    }

    function bindOnlineButtons() {
      const on = (sel, fn) => {
        const el = onlineEl.querySelector(sel);
        if (el) el.addEventListener("click", fn);
      };
      on("[data-c4-new]", showModePicker);
      on("[data-c4-invite]", openInvite);
      on("[data-c4-resign]", async (e) => {
        if (!window.confirm("Vil du gi opp kampen?")) return;
        e.currentTarget.disabled = true;
        try { await Online.resign(matchId); } catch (err) { setStatus(err.message); }
      });
      on("[data-c4-rematch]", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Starter revansj …";
        try {
          const newId = await Online.rematch(matchId);
          startOnline(newId);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Revansj";
          setStatus(err.message);
        }
      });
    }

    function openInvite() {
      if (!matchId) return;
      const url = Online.matchUrl(matchId, GAME_ID);
      const attachmentBody = Social
        ? Social.buildBody({ kind: "kamp", ref: matchId, value: GAME_ID }, "Bli med på Fire på rad!")
        : url;
      session.openInvite({ url, attachmentBody, title: "Inviter en venn", copyLabel: "Kopier lenke" });
    }

    async function onlineMove(col) {
      if (!row || over || busy || seat === 0 || row.turn !== seat) return;
      const r = dropRow(board, col);
      if (r < 0) return;
      // Vis brikken med en gang; serveren bekrefter via abonnementet.
      board[r][col] = seat;
      busy = true;
      lastMoveSeen = r * COLS + col;
      render({ dropped: [r, col] });
      setStatus(`${opponentName()} sin tur …`);
      try {
        await Online.move(matchId, col);
      } catch (e) {
        setStatus((e && e.message) || "Trekket gikk ikke gjennom.");
        const fresh = await Online.fetch(matchId).catch(() => null);
        if (fresh) {
          row = null;
          applyRow(fresh);
        }
      }
    }

    // ---------- Tegning ----------

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

    function attachBoardControls() {
      boardEl.addEventListener("click", (e) => {
        const c = colFromEvent(e);
        if (c >= 0) onColumn(c);
      });
      boardEl.addEventListener("pointerover", (e) => {
        const c = colFromEvent(e);
        if (c !== hoverCol) { hoverCol = c; render(); }
      });
      boardEl.addEventListener("pointerleave", () => {
        if (hoverCol !== -1) { hoverCol = -1; render(); }
      });
    }

    function render(info) {
      info = info || {};
      const winSet = new Set((info.line || []).map(([r, c]) => r * COLS + c));
      const cells = boardEl.children;
      // Forhåndsvisning av hvor brikken lander i kolonnen musa står over.
      const ghostRow = hoverCol >= 0 && !over && !busy ? dropRow(board, hoverCol) : -1;
      const ghostCls = myPiece === AI ? " is-ghost is-ghost-yellow" : " is-ghost";
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const v = board[r][c];
          const el = cells[r * COLS + c];
          let cls = "c4-cell";
          if (v === HUMAN) cls += " is-red";
          else if (v === AI) cls += " is-yellow";
          else if (r === ghostRow && c === hoverCol) cls += ghostCls;
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
