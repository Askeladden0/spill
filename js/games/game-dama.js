/**
 * Studilla – Dama.
 * Du spiller hvit mot en AI som spiller rød, eller mot en venn online.
 * Brikker går ett felt diagonalt fremover, damer ett felt i alle retninger.
 * Man slår ved å hoppe over en motstander (i alle retninger) og må slå når
 * man kan. Kan brikken slå igjen etter et hopp, må den fortsette. Når en
 * brikke når siste rad, blir den dame og trekket er slutt. Vinneren er den
 * som tar alle brikkene eller stenger motstanderen inne.
 * AI-en bruker minimax med alpha-beta-beskjæring (ett hopp = ett ledd).
 * Online-reglene ligger på serveren (online_dama_move i supabase/schema.sql,
 * seksjon 77) og er de samme som her. Online-kamper gir ikke poeng.
 */
(function () {
  "use strict";

  const GAME_ID = "dama";
  const HUMAN = 1;
  const AI = 2;
  const AI_DEPTH = 6;
  const AI_DELAY_MS = 550;
  const WIN_SCORE = 100000;
  const QUIET_LIMIT = 80;
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const SIDE = { 1: "hvit", 2: "rød" };

  // ---------- Ren spillogikk (ingen DOM) ----------
  // Brettet er 64 tall (rad * 8 + kolonne): 0 tom, 1/2 brikke til spiller
  // 1/2, 3/4 dame til spiller 1/2. Spiller 1 (hvit) starter nederst og går
  // mot rad 0.

  const owner = (v) => (v === 0 ? 0 : v === 1 || v === 3 ? 1 : 2);
  const isKing = (v) => v >= 3;

  function startBoard() {
    const b = new Array(64).fill(0);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) {
          if (r <= 2) b[r * 8 + c] = 2;
          else if (r >= 5) b[r * 8 + c] = 1;
        }
      }
    }
    return b;
  }

  function jumpsFrom(b, sq) {
    const v = b[sq];
    if (!v) return [];
    const me = owner(v);
    const r = sq >> 3;
    const c = sq & 7;
    const out = [];
    for (const [dr, dc] of DIRS) {
      const tr = r + dr * 2;
      const tc = c + dc * 2;
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7 || b[tr * 8 + tc] !== 0) continue;
      const mid = (r + dr) * 8 + (c + dc);
      if (b[mid] && owner(b[mid]) !== me) out.push({ from: sq, to: tr * 8 + tc, cap: mid });
    }
    return out;
  }

  function stepsFrom(b, sq) {
    const v = b[sq];
    const fwd = owner(v) === 1 ? -1 : 1;
    const r = sq >> 3;
    const c = sq & 7;
    const out = [];
    for (const [dr, dc] of DIRS) {
      if (!isKing(v) && dr !== fwd) continue;
      const tr = r + dr;
      const tc = c + dc;
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7 || b[tr * 8 + tc] !== 0) continue;
      out.push({ from: sq, to: tr * 8 + tc, cap: -1 });
    }
    return out;
  }

  // Alle lovlige hopp/steg for `who`. Slagtvang: finnes det et hopp, er det
  // bare hopp som gjelder. Midt i en slagkjede (`chain`) gjelder bare hopp
  // fra den brikken.
  function hopsFor(b, who, chain) {
    if (chain != null) return jumpsFrom(b, chain);
    const jumps = [];
    for (let sq = 0; sq < 64; sq++) if (owner(b[sq]) === who) jumps.push(...jumpsFrom(b, sq));
    if (jumps.length) return jumps;
    const steps = [];
    for (let sq = 0; sq < 64; sq++) if (owner(b[sq]) === who) steps.push(...stepsFrom(b, sq));
    return steps;
  }

  function applyHop(st, hop) {
    const b = st.b.slice();
    const piece = b[hop.from];
    const who = owner(piece);
    const king = isKing(piece);
    b[hop.from] = 0;
    if (hop.cap >= 0) b[hop.cap] = 0;
    const row = hop.to >> 3;
    const promote = !king && (who === 1 ? row === 0 : row === 7);
    b[hop.to] = promote ? piece + 2 : piece;
    let turn = st.turn;
    let chain = null;
    if (hop.cap >= 0 && !promote && jumpsFrom(b, hop.to).length) chain = hop.to;
    else turn = who === 1 ? 2 : 1;
    const quiet = hop.cap >= 0 || !king ? 0 : st.quiet + 1;
    return { b, turn, chain, quiet };
  }

  // null = pågår, 0 = uavgjort, 1/2 = vinner.
  function outcome(st) {
    if (st.chain != null) return null;
    if (st.quiet >= QUIET_LIMIT) return 0;
    if (!hopsFor(st.b, st.turn, null).length) return st.turn === 1 ? 2 : 1;
    return null;
  }

  function countPieces(b, who) {
    let n = 0;
    for (let i = 0; i < 64; i++) if (owner(b[i]) === who) n++;
    return n;
  }

  function evaluate(b) {
    let s = 0;
    for (let sq = 0; sq < 64; sq++) {
      const v = b[sq];
      if (!v) continue;
      const o = owner(v);
      const r = sq >> 3;
      const c = sq & 7;
      let val = isKing(v) ? 175 : 100 + (o === 1 ? 7 - r : r) * 4;
      if (c >= 2 && c <= 5) val += 2;
      s += o === AI ? val : -val;
    }
    return s;
  }

  function search(st, depth, alpha, beta) {
    const out = outcome(st);
    if (out !== null) {
      if (out === 0) return 0;
      return out === AI ? WIN_SCORE + depth : -(WIN_SCORE + depth);
    }
    if (depth === 0) return evaluate(st.b);
    const hops = hopsFor(st.b, st.turn, st.chain);
    if (st.turn === AI) {
      let best = -Infinity;
      for (const h of hops) {
        const v = search(applyHop(st, h), depth - 1, alpha, beta);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const h of hops) {
      const v = search(applyHop(st, h), depth - 1, alpha, beta);
      if (v < best) best = v;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Velger neste hopp for AI-en. Blant like gode hopp velges et tilfeldig.
  function chooseAiHop(st) {
    const hops = hopsFor(st.b, st.turn, st.chain);
    if (hops.length === 1) return hops[0];
    let bestScore = -Infinity;
    let best = [];
    for (const h of hops) {
      const v = search(applyHop(st, h), AI_DEPTH - 1, -Infinity, Infinity);
      if (v > bestScore) { bestScore = v; best = [h]; }
      else if (v === bestScore) best.push(h);
    }
    return best[Math.floor(Math.random() * best.length)];
  }

  // ---------- Spillflyt og tegning ----------

  function start(container) {
    const Online = window.StudillaOnline;
    const Shell = window.StudillaOnlineShell;
    let session = null;
    let shell = null;

    let st = { b: startBoard(), turn: HUMAN, chain: null, quiet: 0 };
    let mode = "ai";
    let mySide = HUMAN;
    let over = false;
    let busy = false;
    let moves = 0;
    let selected = null;
    let last = null;
    let boardEl = null;
    let statusEl = null;
    let flipped = false;
    let aiTimer = null;
    let endTimer = null;
    // Online: hoppene køes, så to raske hopp på rad (slagkjede) når serveren
    // i riktig rekkefølge.
    let queue = Promise.resolve();
    let inflight = 0;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      shell = Shell.create({
        session,
        gameId: GAME_ID,
        title: "Dama",
        sideName: (seat) => SIDE[seat],
        onLeave: clearTimers,
        startAi,
        mountOnline,
        applyRow,
        playingStatus,
      });
      shell.begin();
    });

    function clearTimers() {
      clearTimeout(aiTimer);
      clearTimeout(endTimer);
    }

    function setStatus(text) {
      if (mode === "online") shell.setStatus(text);
      else if (statusEl) statusEl.textContent = text;
    }

    function buildBoard(host) {
      host.innerHTML = `<div class="dm-board" data-dm-board role="grid" aria-label="Dama"></div>`;
      boardEl = host.querySelector("[data-dm-board]");
      boardEl.addEventListener("click", (e) => {
        const sq = e.target.closest(".dm-sq");
        if (sq) onSquare(+sq.dataset.sq);
      });
    }

    // ---------- Mot datamaskinen ----------

    function startAi() {
      mode = "ai";
      mySide = HUMAN;
      flipped = false;
      session.playArea.innerHTML = `
        <div class="os-wrap">
          <div class="os-status" data-dm-status></div>
          <div class="os-host" data-dm-host></div>
        </div>
      `;
      statusEl = session.playArea.querySelector("[data-dm-status]");
      buildBoard(session.playArea.querySelector("[data-dm-host]"));
      session.onRestart(() => initGame());
      initGame();
    }

    function initGame() {
      clearTimers();
      st = { b: startBoard(), turn: HUMAN, chain: null, quiet: 0 };
      over = false;
      busy = false;
      moves = 0;
      selected = null;
      last = null;
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      setStatus("Din tur – du er hvit");
      render();
    }

    function humanHop(h) {
      st = applyHop(st, h);
      last = [h.from, h.to];
      moves++;
      selected = null;
      const out = outcome(st);
      if (out !== null) { render(); return finish(out); }
      if (st.turn === HUMAN) {
        // Slagkjede: samme brikke må slå videre.
        selected = st.chain;
        setStatus("Slå videre!");
        render();
        return;
      }
      busy = true;
      setStatus("AI-en tenker …");
      render();
      // Utsettelsen gir tid til å se trekket før AI-en regner.
      aiTimer = setTimeout(aiTurn, AI_DELAY_MS);
    }

    function aiTurn() {
      if (over) return;
      const hop = chooseAiHop(st);
      st = applyHop(st, hop);
      last = [hop.from, hop.to];
      const out = outcome(st);
      render();
      if (out !== null) return finish(out);
      if (st.turn === AI) {
        aiTimer = setTimeout(aiTurn, AI_DELAY_MS);
        return;
      }
      busy = false;
      setStatus("Din tur – du er hvit");
      render();
    }

    // Poeng: seier gir mer jo flere brikker du har igjen og jo raskere du
    // vinner, uavgjort gir litt, og tap gir poeng for brikkene du tok.
    function finish(out) {
      over = true;
      busy = true;
      let score;
      let title;
      if (out === HUMAN) {
        score = 100 + countPieces(st.b, HUMAN) * 15 + Math.max(0, 60 - moves) * 3;
        title = "Du vant!";
        setStatus("Du vant!");
      } else if (out === 0) {
        score = 40;
        title = "Uavgjort";
        setStatus("Uavgjort");
      } else {
        score = (12 - countPieces(st.b, AI)) * 5;
        title = "AI-en vant";
        setStatus("AI-en vant");
      }
      session.setScore(score);
      endTimer = setTimeout(() => session.finish(score, { title }), 900);
    }

    // ---------- Online mot en venn ----------

    function mountOnline(host) {
      mode = "online";
      over = true;
      busy = true;
      selected = null;
      last = null;
      st = { b: startBoard(), turn: 1, chain: null, quiet: 0 };
      buildBoard(host);
      render();
    }

    function applyRow(row, seat) {
      mode = "online";
      mySide = seat || 1;
      flipped = seat === 2;
      if (inflight) return;
      const data = row.data || {};
      st = {
        b: String(row.board).split("").map(Number),
        turn: row.turn,
        chain: data.chain != null ? Number(data.chain) : null,
        quiet: Number(data.quiet) || 0,
      };
      last = data.from != null && row.last_move != null ? [Number(data.from), row.last_move] : null;
      over = row.status !== "playing";
      busy = over || seat === 0 || row.turn !== seat;
      selected = !busy && st.chain != null ? st.chain : null;
      render();
    }

    function playingStatus(row, seat, opp) {
      if (seat === 0) return `${row.turn === 1 ? row.host_name : row.guest_name} (${SIDE[row.turn]}) sin tur`;
      if (row.turn !== seat) return `${opp} sin tur …`;
      return st.chain != null ? "Slå videre!" : `Din tur – du er ${SIDE[seat]}`;
    }

    function onlineHop(h) {
      const seat = shell.seat();
      const id = shell.id();
      st = applyHop(st, h);
      last = [h.from, h.to];
      busy = st.turn !== seat;
      selected = !busy && st.chain != null ? st.chain : null;
      render();
      if (busy) {
        const row = shell.row();
        const opp = row && (seat === 2 ? row.host_name : row.guest_name);
        setStatus(`${opp || "Motspilleren"} sin tur …`);
      }
      inflight++;
      queue = queue
        .then(() => Online.damaMove(id, h.from, h.to))
        .catch((e) => { setStatus((e && e.message) || "Trekket gikk ikke gjennom."); })
        .then(() => {
          inflight--;
          if (inflight === 0) shell.refresh();
        });
    }

    // ---------- Input ----------

    function canAct() {
      if (mode === "ai") return !!session && !over && !busy && st.turn === HUMAN;
      const row = shell && shell.row();
      return !!row && row.status === "playing" && shell.seat() > 0 && st.turn === shell.seat() && !over && !busy;
    }

    function myHops() {
      return hopsFor(st.b, st.turn, st.chain);
    }

    function onSquare(sq) {
      if (!canAct()) return;
      const hops = myHops();
      if (selected != null) {
        const h = hops.find((x) => x.from === selected && x.to === sq);
        if (h) return mode === "ai" ? humanHop(h) : onlineHop(h);
      }
      // Midt i en slagkjede kan man ikke bytte brikke.
      if (st.chain == null) selected = hops.some((x) => x.from === sq) ? sq : null;
      render();
    }

    // ---------- Tegning ----------

    function render() {
      if (!boardEl) return;
      const acting = canAct();
      const hops = acting ? myHops() : [];
      const movable = new Set(hops.map((h) => h.from));
      const targets = new Set(hops.filter((h) => h.from === selected).map((h) => h.to));
      let html = "";
      for (let i = 0; i < 64; i++) {
        const sq = flipped ? 63 - i : i;
        const r = sq >> 3;
        const c = sq & 7;
        const dark = (r + c) % 2 === 1;
        const v = st.b[sq];
        let cls = dark ? "dm-sq dm-dark" : "dm-sq dm-light";
        if (sq === selected) cls += " is-sel";
        if (targets.has(sq)) cls += " is-target";
        if (last && (sq === last[0] || sq === last[1])) cls += " is-last";
        if (acting && movable.has(sq) && sq !== selected) cls += " is-movable";
        const piece = v
          ? `<span class="dm-pc dm-p${owner(v)}${isKing(v) ? " is-king" : ""}"></span>`
          : "";
        html += `<div class="${cls}" data-sq="${sq}" role="gridcell">${piece}</div>`;
      }
      boardEl.innerHTML = html;
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
