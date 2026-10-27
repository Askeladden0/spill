/**
 * Studilla – Senke skip.
 * Plasser flåten din på et 10 × 10-brett og skyt mot motstanderens farvann.
 * Den som først senker alle fem skip (5, 4, 3, 3 og 2 ruter lange), vinner.
 * Mot AI-en: AI-en regner ut hvor skipene kan ligge (sannsynlighetsjakt),
 * og jo færre skudd du bruker, jo flere poeng får du. Online mot en venn
 * ligger flåtene skjult på serveren (online_bs_* i supabase/schema.sql,
 * seksjon 77), så ingen kan se motstanderens skip før de er senket.
 * Online-kamper gir ikke poeng.
 */
(function () {
  "use strict";

  const GAME_ID = "senke-skip";
  const SIZE = 10;
  const CELLS = SIZE * SIZE;
  const AI_DELAY_MS = 750;
  const SHIPS = [
    { id: 1, len: 5, name: "Hangarskip" },
    { id: 2, len: 4, name: "Slagskip" },
    { id: 3, len: 3, name: "Krysser" },
    { id: 4, len: 3, name: "Ubåt" },
    { id: 5, len: 2, name: "Jager" },
  ];
  const SHIP_NAME = SHIPS.reduce((m, s) => { m[s.id] = s.name; return m; }, {});
  const SIDE = { 1: "", 2: "" };
  const TOTAL_HITS = SHIPS.reduce((n, s) => n + s.len, 0);

  // ---------- Ren spillogikk (ingen DOM) ----------
  // En flåte er 100 tall: 0 vann, 1-5 skip-id. Skuddene er 100 tall:
  // 0 ikke skutt, 1 bom, 2 treff, 3 treff på senket skip.

  function cellsOf(head, len, horiz) {
    const out = [];
    const r = Math.floor(head / SIZE);
    const c = head % SIZE;
    for (let i = 0; i < len; i++) out.push(horiz ? r * SIZE + c + i : (r + i) * SIZE + c);
    return out;
  }

  function inBounds(head, len, horiz) {
    const r = Math.floor(head / SIZE);
    const c = head % SIZE;
    return horiz ? c + len <= SIZE : r + len <= SIZE;
  }

  function fits(fleet, head, len, horiz) {
    return inBounds(head, len, horiz) && cellsOf(head, len, horiz).every((i) => fleet[i] === 0);
  }

  function randomFleet() {
    const fleet = new Array(CELLS).fill(0);
    for (const ship of SHIPS) {
      for (;;) {
        const horiz = Math.random() < 0.5;
        const head = Math.floor(Math.random() * CELLS);
        if (!fits(fleet, head, ship.len, horiz)) continue;
        cellsOf(head, ship.len, horiz).forEach((i) => { fleet[i] = ship.id; });
        break;
      }
    }
    return fleet;
  }

  // Skyter på rute `idx` og oppdaterer `shots`. Returnerer "miss", "hit"
  // eller id-en til skipet som ble senket.
  function fire(fleet, shots, idx) {
    if (fleet[idx] === 0) {
      shots[idx] = 1;
      return { result: "miss" };
    }
    shots[idx] = 2;
    const id = fleet[idx];
    const cells = [];
    for (let i = 0; i < CELLS; i++) if (fleet[i] === id) cells.push(i);
    if (cells.every((i) => shots[i] >= 2)) {
      cells.forEach((i) => { shots[i] = 3; });
      return { result: "sunk", id };
    }
    return { result: "hit" };
  }

  function sunkIds(fleet, shots) {
    return SHIPS.filter((s) => {
      for (let i = 0; i < CELLS; i++) if (fleet[i] === s.id && shots[i] !== 3) return false;
      return true;
    }).map((s) => s.id);
  }

  // AI-en teller for hver rute hvor mange plasseringer av skipene som er
  // igjen som kan dekke den (ikke over bom eller senkede skip). Plasseringer
  // som dekker ruter den allerede har truffet, teller mye mer, så den
  // jakter ferdig skipet den har funnet.
  function aiPick(shots, remainingLens) {
    const weight = new Array(CELLS).fill(0);
    for (const len of remainingLens) {
      for (const horiz of [true, false]) {
        for (let head = 0; head < CELLS; head++) {
          if (!inBounds(head, len, horiz)) continue;
          const cells = cellsOf(head, len, horiz);
          if (cells.some((i) => shots[i] === 1 || shots[i] === 3)) continue;
          const hits = cells.filter((i) => shots[i] === 2).length;
          const w = hits ? 40 * hits * hits : 1;
          cells.forEach((i) => { if (shots[i] === 0) weight[i] += w; });
        }
      }
    }
    let best = 0;
    let picks = [];
    for (let i = 0; i < CELLS; i++) {
      if (shots[i] !== 0) continue;
      if (weight[i] > best) { best = weight[i]; picks = [i]; }
      else if (weight[i] === best) picks.push(i);
    }
    return picks[Math.floor(Math.random() * picks.length)];
  }

  const toNums = (str) => String(str || "").split("").map(Number);

  // ---------- Tegning ----------

  function gridHTML(extraClass) {
    let cells = "";
    for (let i = 0; i < CELLS; i++) cells += `<div class="bs-cell" data-i="${i}" role="gridcell"></div>`;
    return `<div class="bs-grid ${extraClass}" role="grid">${cells}</div>`;
  }

  // Plasseringen: trykk på brettet for å sette ned skipet som er valgt.
  function createPlacement(host, onDone) {
    let fleet = new Array(CELLS).fill(0);
    let horiz = true;
    let active = 1;
    let hover = -1;

    host.innerHTML = `
      <div class="bs-place">
        <div class="bs-ships" data-bs-ships></div>
        ${gridHTML("bs-grid-lg")}
        <div class="bs-actions">
          <button type="button" class="btn-outline" data-bs-rotate>Roter (R)</button>
          <button type="button" class="btn-outline" data-bs-random>Tilfeldig</button>
          <button type="button" class="btn-outline" data-bs-reset>Nullstill</button>
          <button type="button" class="btn-primary" data-bs-ready disabled>Klar</button>
        </div>
        <p class="c4-mode-hint">Velg et skip og trykk på brettet. Trykk på et plassert skip for å ta det opp igjen.</p>
      </div>
    `;
    const grid = host.querySelector(".bs-grid");
    const shipsEl = host.querySelector("[data-bs-ships]");
    const readyBtn = host.querySelector("[data-bs-ready]");

    const placed = () => new Set(fleet.filter(Boolean));
    const firstFree = () => {
      const p = placed();
      const s = SHIPS.find((x) => !p.has(x.id));
      return s ? s.id : 0;
    };

    function headFor(idx, len) {
      let r = Math.floor(idx / SIZE);
      let c = idx % SIZE;
      if (horiz) c = Math.min(c, SIZE - len);
      else r = Math.min(r, SIZE - len);
      return r * SIZE + c;
    }

    function render() {
      const p = placed();
      shipsEl.innerHTML = SHIPS.map((s) => `
        <button type="button" class="bs-ship-btn${p.has(s.id) ? " is-placed" : ""}${active === s.id ? " is-active" : ""}" data-ship="${s.id}">
          ${s.name} <span>${"■".repeat(s.len)}</span>
        </button>`).join("");
      let preview = new Set();
      let bad = false;
      if (hover >= 0 && fleet[hover] === 0 && active) {
        const ship = SHIPS[active - 1];
        const head = headFor(hover, ship.len);
        preview = new Set(cellsOf(head, ship.len, horiz));
        bad = !fits(fleet, head, ship.len, horiz);
      }
      const cells = grid.children;
      for (let i = 0; i < CELLS; i++) {
        let cls = "bs-cell";
        if (fleet[i]) cls += " is-ship";
        if (preview.has(i)) cls += bad ? " is-bad" : " is-preview";
        cells[i].className = cls;
      }
      readyBtn.disabled = p.size < SHIPS.length;
    }

    function place(idx) {
      if (fleet[idx] !== 0) {
        const id = fleet[idx];
        fleet = fleet.map((v) => (v === id ? 0 : v));
        active = id;
        return render();
      }
      if (!active) return;
      const ship = SHIPS[active - 1];
      const head = headFor(idx, ship.len);
      if (!fits(fleet, head, ship.len, horiz)) return render();
      cellsOf(head, ship.len, horiz).forEach((i) => { fleet[i] = ship.id; });
      active = firstFree();
      render();
    }

    grid.addEventListener("click", (e) => {
      const el = e.target.closest(".bs-cell");
      if (el) place(+el.dataset.i);
    });
    grid.addEventListener("pointerover", (e) => {
      const el = e.target.closest(".bs-cell");
      const i = el ? +el.dataset.i : -1;
      if (i !== hover) { hover = i; render(); }
    });
    grid.addEventListener("pointerleave", () => { hover = -1; render(); });
    shipsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ship]");
      if (!b) return;
      const id = +b.dataset.ship;
      if (placed().has(id)) fleet = fleet.map((v) => (v === id ? 0 : v));
      active = id;
      render();
    });
    const rotate = () => { horiz = !horiz; render(); };
    host.querySelector("[data-bs-rotate]").addEventListener("click", rotate);
    host.querySelector("[data-bs-random]").addEventListener("click", () => {
      fleet = randomFleet();
      active = 0;
      render();
    });
    host.querySelector("[data-bs-reset]").addEventListener("click", () => {
      fleet = new Array(CELLS).fill(0);
      active = 1;
      render();
    });
    readyBtn.addEventListener("click", () => {
      if (placed().size < SHIPS.length) return;
      readyBtn.disabled = true;
      onDone(fleet.slice());
    });
    const onKey = (e) => {
      if (!document.body.contains(grid)) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (e.key === "r" || e.key === "R") rotate();
    };
    document.addEventListener("keydown", onKey);
    render();
  }

  // Kampbildet: motstanderens farvann (der du skyter) og din egen flåte.
  function createBattle(host, onEnemyCell) {
    host.innerHTML = `
      <div class="bs-battle">
        <div class="bs-board-wrap">
          <div class="bs-label">Motstanderens farvann</div>
          ${gridHTML("bs-grid-lg bs-enemy")}
        </div>
        <div class="bs-chips" data-bs-chips></div>
        <div class="bs-board-wrap">
          <div class="bs-label">Din flåte</div>
          ${gridHTML("bs-grid-sm bs-own")}
        </div>
      </div>
    `;
    const enemyEl = host.querySelector(".bs-enemy");
    const ownEl = host.querySelector(".bs-own");
    const chipsEl = host.querySelector("[data-bs-chips]");
    enemyEl.addEventListener("click", (e) => {
      const el = e.target.closest(".bs-cell");
      if (el) onEnemyCell(+el.dataset.i);
    });

    // v: { enemyShots, ownFleet, ownShots, sunk, myTurn, reveal, lastEnemy, lastOwn }
    function paint(v) {
      const shotCls = (s) => (s === 1 ? " is-miss" : s === 2 ? " is-hit" : s === 3 ? " is-sunk" : "");
      for (let i = 0; i < CELLS; i++) {
        const s = v.enemyShots[i] || 0;
        let cls = "bs-cell" + shotCls(s);
        if (!s && v.reveal && v.reveal[i]) cls += " is-reveal";
        if (!s && v.myTurn) cls += " is-live";
        if (i === v.lastEnemy) cls += " is-last";
        enemyEl.children[i].className = cls;

        const os = v.ownShots[i] || 0;
        cls = "bs-cell" + shotCls(os);
        if (v.ownFleet && v.ownFleet[i]) cls += " is-ship";
        if (i === v.lastOwn) cls += " is-last";
        ownEl.children[i].className = cls;
      }
      const sunk = new Set(v.sunk);
      chipsEl.innerHTML = SHIPS.map((s) =>
        `<span class="bs-chip${sunk.has(s.id) ? " is-sunk" : ""}" title="${s.name}">${"■".repeat(s.len)}</span>`).join("");
    }
    return { paint };
  }

  // ---------- Spillflyt ----------

  function start(container) {
    const Online = window.StudillaOnline;
    const Shell = window.StudillaOnlineShell;
    let session = null;
    let shell = null;
    let mode = "ai";
    let statusEl = null;
    let aiTimer = null;
    let endTimer = null;

    // Mot AI-en.
    let myFleet = null;
    let aiFleet = null;
    let myShots = null;
    let aiShots = null;
    let battle = null;
    let turn = 1;
    let over = false;
    let shotsFired = 0;
    let lastEnemy = -1;
    let lastOwn = -1;

    // Online.
    let view = null;
    let onlineFleet = null;
    let onlineHost = null;
    let onlineBattle = null;
    let canShoot = false;
    let shooting = false;
    let fleetReq = 0;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      shell = Shell.create({
        session,
        gameId: GAME_ID,
        title: "Senke skip",
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

    // ---------- Mot datamaskinen ----------

    function startAi() {
      mode = "ai";
      session.playArea.innerHTML = `
        <div class="os-wrap">
          <div class="os-status" data-bs-status></div>
          <div class="os-host" data-bs-host></div>
        </div>
      `;
      statusEl = session.playArea.querySelector("[data-bs-status]");
      session.onRestart(() => initGame());
      initGame();
    }

    function initGame() {
      clearTimers();
      over = false;
      turn = 1;
      shotsFired = 0;
      lastEnemy = -1;
      lastOwn = -1;
      myShots = new Array(CELLS).fill(0);
      aiShots = new Array(CELLS).fill(0);
      aiFleet = randomFleet();
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      setStatus("Plasser skipene dine");
      const host = session.playArea.querySelector("[data-bs-host]");
      createPlacement(host, (fleet) => {
        myFleet = fleet;
        beginBattle(host);
      });
    }

    function beginBattle(host) {
      battle = createBattle(host, playerShoot);
      setStatus("Din tur – skyt!");
      paintAi();
    }

    function paintAi() {
      battle.paint({
        enemyShots: myShots,
        ownFleet: myFleet,
        ownShots: aiShots,
        sunk: sunkIds(aiFleet, myShots),
        myTurn: !over && turn === 1,
        reveal: over ? aiFleet : null,
        lastEnemy,
        lastOwn,
      });
    }

    function shotText(res) {
      return res.result === "sunk" ? `Senket ${SHIP_NAME[res.id].toLowerCase()}` : res.result === "hit" ? "Treff" : "Bom";
    }

    function playerShoot(idx) {
      if (over || turn !== 1 || myShots[idx] !== 0) return;
      const res = fire(aiFleet, myShots, idx);
      shotsFired++;
      lastEnemy = idx;
      if (sunkIds(aiFleet, myShots).length === SHIPS.length) {
        paintAi();
        return finish(true);
      }
      turn = 2;
      setStatus(`${shotText(res)}! AI-en skyter …`);
      paintAi();
      aiTimer = setTimeout(aiShoot, AI_DELAY_MS);
    }

    function aiShoot() {
      if (over) return;
      const sunk = sunkIds(myFleet, aiShots);
      const remaining = SHIPS.filter((s) => !sunk.includes(s.id)).map((s) => s.len);
      const idx = aiPick(aiShots, remaining);
      const res = fire(myFleet, aiShots, idx);
      lastOwn = idx;
      if (sunkIds(myFleet, aiShots).length === SHIPS.length) {
        paintAi();
        return finish(false);
      }
      turn = 1;
      const what = res.result === "sunk" ? `AI-en senket din ${SHIP_NAME[res.id].toLowerCase()}!`
        : res.result === "hit" ? "AI-en traff!" : "AI-en bommet.";
      setStatus(`${what} Din tur – skyt!`);
      paintAi();
    }

    // Poeng: seier gir mer jo færre skudd du bruker, tap gir poeng for
    // skipene du fikk senket.
    function finish(won) {
      over = true;
      let score;
      let title;
      if (won) {
        score = 100 + Math.max(0, 80 - shotsFired) * 5;
        title = "Du vant!";
        setStatus(`Du senket hele flåten på ${shotsFired} skudd!`);
      } else {
        score = sunkIds(aiFleet, myShots).length * 20;
        title = "AI-en vant";
        setStatus("AI-en senket hele flåten din");
      }
      session.setScore(score);
      paintAi();
      endTimer = setTimeout(() => session.finish(score, { title }), 1100);
    }

    // ---------- Online mot en venn ----------

    function mountOnline(host) {
      mode = "online";
      onlineHost = host;
      view = null;
      onlineFleet = null;
      onlineBattle = null;
      canShoot = false;
      shooting = false;
      fleetReq++;
      host.innerHTML = "";
    }

    function mountOnlineBattle() {
      view = "battle";
      onlineBattle = createBattle(onlineHost, onlineShoot);
    }

    async function loadMyFleet(id) {
      const req = ++fleetReq;
      try {
        const str = await Online.myFleet(id);
        if (req !== fleetReq || !str) return;
        onlineFleet = toNums(str);
        const row = shell.row();
        if (row) applyRow(row, shell.seat());
      } catch (e) { /* flåten vises bare ikke */ }
    }

    function applyRow(row, seat) {
      mode = "online";
      const d = row.data || {};
      if (row.status === "waiting") {
        view = null;
        onlineHost.innerHTML = `<p class="c4-mode-hint">Skipene plasseres når motstanderen er med.</p>`;
        return;
      }
      const placing = d.phase === "placing";
      const ready = seat > 0 && d["r" + seat];

      if (seat > 0 && placing && !ready && row.status === "playing") {
        if (view !== "place") {
          view = "place";
          createPlacement(onlineHost, async (fleet) => {
            try {
              await Online.placeFleet(shell.id(), fleet.join(""));
              onlineFleet = fleet;
              if (view === "place") mountOnlineBattle();
              shell.refresh();
            } catch (e) {
              view = null;
              shell.setStatus((e && e.message) || "Klarte ikke sende flåten.");
              shell.refresh();
            }
          });
        }
        return;
      }

      if (view !== "battle") mountOnlineBattle();
      if (seat > 0 && !onlineFleet) loadMyFleet(shell.id());

      const opp = seat === 2 ? 1 : 2;
      // Tilskuere ser begge brettene som skuddkart.
      const meSeat = seat > 0 ? seat : 1;
      const oppSeat = seat > 0 ? opp : 2;
      const enemyShots = toNums(d["s" + meSeat]);
      const ownShots = toNums(d["s" + oppSeat]);
      const fin = row.status === "finished";
      canShoot = seat > 0 && row.status === "playing" && d.phase === "firing" && row.turn === seat;
      let lastEnemyIdx = -1;
      let lastOwnIdx = -1;
      if (row.last_move != null && d.phase === "firing") {
        const shooter = row.turn === 1 ? 2 : 1;
        if (shooter === meSeat) lastEnemyIdx = row.last_move; else lastOwnIdx = row.last_move;
      }
      onlineBattle.paint({
        enemyShots: enemyShots.length === CELLS ? enemyShots : new Array(CELLS).fill(0),
        ownFleet: seat > 0 ? onlineFleet : null,
        ownShots: ownShots.length === CELLS ? ownShots : new Array(CELLS).fill(0),
        sunk: Array.isArray(d["sunk" + meSeat]) ? d["sunk" + meSeat] : [],
        myTurn: canShoot && !shooting,
        reveal: fin && d["f" + oppSeat] ? toNums(d["f" + oppSeat]) : null,
        lastEnemy: lastEnemyIdx,
        lastOwn: lastOwnIdx,
      });
    }

    function playingStatus(row, seat, opp) {
      const d = row.data || {};
      if (d.phase === "placing") {
        if (seat === 0) return "Spillerne plasserer skipene sine";
        return d["r" + seat] ? `Venter på at ${opp} plasserer skipene …` : "Plasser skipene dine";
      }
      const turnText = seat === 0
        ? `${row.turn === 1 ? row.host_name : row.guest_name} skyter`
        : row.turn === seat ? "Din tur – skyt!" : `${opp} skyter …`;
      if (row.last_move == null) return turnText;
      const shooter = row.turn === 1 ? 2 : 1;
      const state = toNums(d["s" + shooter])[row.last_move];
      const sunkList = Array.isArray(d["sunk" + shooter]) ? d["sunk" + shooter] : [];
      const shooterName = shooter === seat ? "Du" : (shooter === 1 ? row.host_name : row.guest_name);
      const verb = state === 3
        ? `senket ${SHIP_NAME[sunkList[sunkList.length - 1]] ? "et skip (" + SHIP_NAME[sunkList[sunkList.length - 1]].toLowerCase() + ")" : "et skip"}`
        : state === 2 ? "traff" : "bommet";
      return `${shooterName} ${verb}. ${turnText}`;
    }

    async function onlineShoot(idx) {
      if (!canShoot || shooting) return;
      const row = shell.row();
      if (!row) return;
      const shots = toNums((row.data || {})["s" + shell.seat()]);
      if (shots[idx] !== 0) return;
      shooting = true;
      shell.setStatus("Skyter …");
      try {
        await Online.shoot(shell.id(), idx);
      } catch (e) {
        shell.setStatus((e && e.message) || "Skuddet gikk ikke gjennom.");
      }
      shooting = false;
      shell.refresh();
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
