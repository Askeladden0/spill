/**
 * Studilla – felles skall for online tospiller (window.StudillaOnlineShell).
 *
 * Fire på rad har sin egen kopi av dette; Senke skip og Dama deler denne.
 * Skallet tar seg av valget mellom AI og en venn, det å lage/bli med i en
 * kamp (js/online-match.js), statuslinjen, invitasjonen, å gi opp og
 * revansj. Selve brettet eier spillet, via valgene i `create`:
 *
 *   session        spill-kjøretiden fra StudillaGameRuntime.mount
 *   gameId, title  «dama», «Dama»
 *   sideName(seat) navn på siden til plass 1/2 («hvit»)
 *   onLeave()      spillet rydder bort AI-timere o.l.
 *   startAi()      brukeren valgte «Mot datamaskinen»
 *   mountOnline(host)           bygger brettet i `host`
 *   applyRow(row, seat)         tegner brettet fra kampraden
 *   playingStatus(row, seat, opp)  statuslinje mens kampen pågår
 */
(function () {
  "use strict";

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
    ));
  }

  function create(opts) {
    const Online = window.StudillaOnline;
    const Social = window.StudillaSocial;
    const { session, gameId, title } = opts;

    let matchId = null;
    let seat = 0;
    let row = null;
    let unsubscribe = null;
    let inviteShown = false;
    // Øker for hver startOnline, så et eldre kall som fortsatt venter på
    // serveren ikke rekker å abonnere etter at et nyere har tatt over.
    let gen = 0;
    let statusEl = null;
    let panelEl = null;

    function setKampParam(id) {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("kamp", id);
      else url.searchParams.delete("kamp");
      window.history.replaceState(null, "", url.toString());
    }

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text;
    }

    function stopOnline() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      matchId = null;
      row = null;
      seat = 0;
    }

    /** Starter: åpner kampen i ?kamp= hvis det finnes, ellers valgmenyen. */
    function begin() {
      const kamp = new URLSearchParams(window.location.search).get("kamp");
      if (Online && Online.isMatchId(kamp)) startOnline(kamp);
      else showModePicker();
    }

    function showModePicker() {
      stopOnline();
      setKampParam(null);
      if (opts.onLeave) opts.onLeave();
      session.onRestart(null);
      session.playArea.innerHTML = `
        <div class="os-wrap os-modes">
          <div class="os-status">Hvem vil du spille mot?</div>
          <button type="button" class="btn-primary c4-mode-btn" data-os-mode="ai">Mot datamaskinen</button>
          <button type="button" class="btn-outline c4-mode-btn" data-os-mode="online">Mot en venn online</button>
          <p class="c4-mode-hint">Send en lenke eller en melding til en venn – dere trenger ikke være logget inn.</p>
          <p class="c4-mode-error" data-os-error hidden></p>
        </div>
      `;
      const errEl = session.playArea.querySelector("[data-os-error]");
      session.playArea.querySelector('[data-os-mode="ai"]').addEventListener("click", () => opts.startAi());
      const onlineBtn = session.playArea.querySelector('[data-os-mode="online"]');
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
          const id = await Online.create(gameId);
          startOnline(id);
        } catch (e) {
          onlineBtn.disabled = false;
          onlineBtn.textContent = "Mot en venn online";
          errEl.hidden = false;
          errEl.textContent = (e && e.message) || "Klarte ikke lage kampen.";
        }
      });
    }

    async function startOnline(id) {
      if (id === matchId && unsubscribe) return;
      const myGen = ++gen;
      stopOnline();
      matchId = id;
      setKampParam(id);
      if (opts.onLeave) opts.onLeave();
      session.playArea.innerHTML = `
        <div class="os-wrap">
          <div class="os-status" data-os-status></div>
          <div class="os-host" data-os-host></div>
          <div class="c4-online" data-os-panel></div>
        </div>
      `;
      statusEl = session.playArea.querySelector("[data-os-status]");
      panelEl = session.playArea.querySelector("[data-os-panel]");
      session.onRestart(null);
      session.setScore(0);
      opts.mountOnline(session.playArea.querySelector("[data-os-host]"));
      setStatus("Kobler til kampen …");
      try {
        seat = await Online.join(id);
        if (myGen !== gen) return;
        const first = await Online.fetch(id);
        if (myGen !== gen) return;
        if (!first) throw new Error("Fant ikke kampen.");
        if (first.game !== gameId) throw new Error("Denne kampen hører til et annet triks.");
        applyRow(first);
        unsubscribe = Online.subscribe(id, applyRow);
      } catch (e) {
        if (myGen !== gen) return;
        setStatus((e && e.message) || "Fant ikke kampen.");
        panelEl.innerHTML = `<button type="button" class="btn-primary" data-os-new>Start en ny kamp</button>`;
        panelEl.querySelector("[data-os-new]").addEventListener("click", showModePicker);
      }
    }

    function opponentName() {
      if (!row) return "Motspilleren";
      return (seat === 2 ? row.host_name : row.guest_name) || "Motspilleren";
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
      opts.applyRow(row, seat);
      renderStatus();
    }

    // «Du (hvit) mot Kari (rød)», eller bare «Du mot Kari» uten sidenavn.
    function versus(opp) {
      const mine = opts.sideName(seat);
      const theirs = opts.sideName(seat === 1 ? 2 : 1);
      return mine ? `Du (${esc(mine)}) mot ${esc(opp)} (${esc(theirs)})` : `Du mot ${esc(opp)}`;
    }

    function renderStatus() {
      const opp = opponentName();
      let status;
      if (row.status === "waiting") {
        status = seat === 1 ? "Venter på motspiller …" : "Kampen har ikke startet";
      } else if (row.status === "playing") {
        status = opts.playingStatus(row, seat, opp);
      } else if (row.winner === 0) {
        status = "Uavgjort";
      } else if (seat === 0) {
        status = `${row.winner === 1 ? row.host_name : row.guest_name} vant`;
      } else if (row.winner === seat) {
        status = row.resigned ? `${opp} ga opp – du vant!` : "Du vant!";
      } else {
        status = row.resigned === seat ? "Du ga opp" : `${opp} vant`;
      }
      setStatus(status);

      let html;
      if (seat === 0) {
        html = `
          <p class="c4-online-note">Kampen er full – du ser på.</p>
          <button type="button" class="btn-outline" data-os-new>Start din egen kamp</button>`;
      } else if (row.status === "waiting") {
        html = `
          <p class="c4-online-note">Send lenken til en venn. Kampen starter når hen åpner den.</p>
          <button type="button" class="btn-primary" data-os-invite>Inviter en venn</button>
          <button type="button" class="btn-outline" data-os-new>Avbryt</button>`;
      } else if (row.status === "playing") {
        html = `
          <p class="c4-online-note">${versus(opp)}</p>
          <button type="button" class="btn-outline" data-os-resign>Gi opp</button>`;
      } else {
        html = `
          <button type="button" class="btn-primary" data-os-rematch>Revansj</button>
          <button type="button" class="btn-outline" data-os-new>Ny kamp</button>`;
      }
      panelEl.innerHTML = html;
      bindPanel();

      // Invitasjonsmenyen åpnes av seg selv første gang man lager en kamp.
      if (row.status === "waiting" && seat === 1 && !inviteShown) {
        inviteShown = true;
        openInvite();
      }
    }

    function bindPanel() {
      const on = (sel, fn) => {
        const el = panelEl.querySelector(sel);
        if (el) el.addEventListener("click", fn);
      };
      on("[data-os-new]", showModePicker);
      on("[data-os-invite]", openInvite);
      on("[data-os-resign]", async (e) => {
        if (!window.confirm("Vil du gi opp kampen?")) return;
        e.currentTarget.disabled = true;
        try { await Online.resign(matchId); } catch (err) { setStatus(err.message); }
      });
      on("[data-os-rematch]", async (e) => {
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
      const url = Online.matchUrl(matchId, gameId);
      const attachmentBody = Social
        ? Social.buildBody({ kind: "kamp", ref: matchId, value: gameId }, `Bli med på ${title}!`)
        : url;
      session.openInvite({ url, attachmentBody, title: "Inviter en venn", copyLabel: "Kopier lenke" });
    }

    /** Henter kampen på nytt og tegner den (etter en feil eller et trekk). */
    async function refresh() {
      if (!matchId) return;
      const fresh = await Online.fetch(matchId).catch(() => null);
      if (fresh) applyRow(fresh);
    }

    return {
      begin,
      showModePicker,
      setStatus,
      refresh,
      id: () => matchId,
      seat: () => seat,
      row: () => row,
    };
  }

  window.StudillaOnlineShell = { create, esc };
})();
