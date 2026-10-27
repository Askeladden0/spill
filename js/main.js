/**
 * Studilla – delt sidelogikk.
 * Bruker window.STUDILLA_GAMES (js/games-data.js) som datakilde.
 * Når backend/admin-panel er klart: bytt ut games-data.js med et
 * fetch-kall som fyller samme globale variabel, resten fungerer uendret.
 */

(function () {
  "use strict";

  const games = window.STUDILLA_GAMES || [];

  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const formatNumber = (n) => Number(n || 0).toLocaleString("nb-NO");

  // "~10 min" i spilldataene blir "Cirka 10 min" på kortene.
  const formatTime = (t) => (t ? String(t).replace(/^~\s*/, "Cirka ") : "");

  function dailyGame() {
    return games.find((g) => g.isDailyGame) || games[0] || null;
  }

  /* ------------------------------------------------------------------ *
   * Triksene
   *
   * Hele kortet er én lenke; knappeparet «Start / Se rangering» på hvert
   * kort ga sju like knapper på rad. Rekorden fylles inn når
   * leaderboard_totals har svart (loadRecordsIntoGrid).
   * ------------------------------------------------------------------ */

  function trickCardHTML(g, big) {
    return `
      <a class="front-trick${big ? " front-trick-big" : ""}" href="player.html?id=${encodeURIComponent(g.id)}">
        <span class="front-trick-img">
          ${g.thumbnail ? `<img src="${esc(g.thumbnail)}" alt="" loading="lazy">` : ""}
        </span>
        <h3>${esc(g.name)}</h3>
        <span class="front-trick-row">
          <span>${esc(formatTime(g.time))}</span>
          <span data-trick-record="${esc(g.id)}"></span>
        </span>
      </a>
    `;
  }

  function renderGameGrid(selector) {
    const el = document.querySelector(selector);
    if (!el) return;

    // Det første trikset som ikke er dagens (det står allerede øverst) får
    // stor plass.
    const daily = dailyGame();
    const bigIndex = Math.max(0, games.findIndex((g) => g !== daily));
    el.innerHTML = games.map((g, i) => trickCardHTML(g, i === bigIndex)).join("");

    // Det store kortet tar 2×2 ruter (2×1 på mobil). data-lastN forteller CSS-en
    // hvor mange kort som står på siste rad med N kolonner, så de kan strekkes
    // og rutenettet går opp uansett hvor mange triks det er.
    const n = games.length;
    [[4, 4 + n - 1], [3, 4 + n - 1], [2, 2 + n - 1]].forEach(([cols, cells]) => {
      const onLastRow = cells % cols;
      if (n > 2 && onLastRow) el.setAttribute(`data-last${cols}`, onLastRow);
      else el.removeAttribute(`data-last${cols}`);
    });
  }

  async function loadRecordsIntoGrid() {
    const LB = window.StudillaLeaderboard;
    if (!LB || !window.supabaseClient) return;
    const rows = await LB.loadRecords();
    const best = {};
    rows.forEach((r) => {
      const s = Number(r.score) || 0;
      if (!(r.game_id in best) || s > best[r.game_id]) best[r.game_id] = s;
    });
    document.querySelectorAll("[data-trick-record]").forEach((el) => {
      const s = best[el.getAttribute("data-trick-record")];
      el.innerHTML = s ? `Rekord <b>${formatNumber(s)}</b>` : "Ingen rekord ennå";
    });
  }

  /* ------------------------------------------------------------------ *
   * Dagens triks
   * ------------------------------------------------------------------ */

  function renderDate() {
    const el = document.querySelector("[data-front-date]");
    if (!el) return;
    const text = new Date().toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
    el.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  }

  function renderHero(selector) {
    const el = document.querySelector(selector);
    const slot = el && el.querySelector("[data-hero-slot]");
    if (!slot) return;
    const daily = dailyGame();
    if (!daily) return;

    slot.setAttribute("data-hero-media", "");
    slot.innerHTML = `
      <div class="front-feature-img">
        ${daily.thumbnail ? `<img src="${esc(daily.thumbnail)}" alt="" fetchpriority="high">` : ""}
      </div>
      <div class="front-feature-body">
        <h2>Dagens triks: ${esc(daily.name)}</h2>
        <p>${esc(daily.description)}</p>
        <div class="front-feature-meta">
          ${daily.time ? `<span>Tar ${esc(formatTime(daily.time).toLowerCase())}</span>` : ""}
          <span data-hero-best hidden></span>
          <span>Nytt triks om <strong data-daily-countdown></strong></span>
        </div>
        <button type="button" class="btn-primary" data-hero-start>Start dagens triks</button>
      </div>
    `;

    // Selve flaten når man trykker start. Ligger tom til da, slik at
    // forsiden ikke drar inn en modul den kanskje aldri trenger.
    el.insertAdjacentHTML("beforeend", `
      <div class="hero-stage" data-hero-stage hidden>
        <div class="hero-stage-bar">
          <span class="hero-stage-title">${esc(daily.name)}</span>
          <div class="player-hud-slot" data-player-hud></div>
          <a class="hero-stage-full" href="player.html?id=${encodeURIComponent(daily.id)}">Åpne i full skjerm</a>
        </div>
        <div class="hero-stage-inner" data-hero-stage-inner></div>
      </div>
    `);
  }

  async function loadHeroBest() {
    const LB = window.StudillaLeaderboard;
    const daily = dailyGame();
    const el = document.querySelector("[data-hero-best]");
    if (!LB || !daily || !el || !window.supabaseClient) return;
    const rows = await LB.loadPeriod("today", daily.id);
    const best = rows.reduce((m, r) => Math.max(m, Number(r.score) || 0), 0);
    el.innerHTML = best
      ? `Beste i dag <strong>${formatNumber(best)}</strong>`
      : "Ingen har satt rekord i dag ennå";
    el.hidden = false;
  }

  /* ------------------------------------------------------------------ *
   * Topplista: de tre øverste totalt, samme tall som rangering.html.
   * ------------------------------------------------------------------ */

  async function renderPodium() {
    const el = document.querySelector("[data-front-podium]");
    const LB = window.StudillaLeaderboard;
    if (!el || !LB || !window.supabaseClient) return;
    const profiles = LB.visiblePlayers(await LB.loadProfiles());
    const top = profiles
      .map((p) => ({ name: p.username, score: p.score != null ? p.score : p.xp }))
      .filter((p) => p.name && p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    el.innerHTML = top.length
      ? top.map((p, i) => `
          <li>
            <span class="front-place front-place-${i + 1}">${i + 1}</span>
            <a href="spillerprofil.html?u=${encodeURIComponent(p.name)}">${esc(p.name)}</a>
            <span class="front-pts">${formatNumber(p.score)}</span>
          </li>`).join("")
      : `<li>Ingen på lista ennå. Bli den første!</li>`;
  }

  /* ------------------------------------------------------------------ *
   * Maskoten følger pekeren med øynene. Ingenting skjer uten at brukeren
   * selv beveger musa, og ingenting med redusert bevegelse.
   * ------------------------------------------------------------------ */

  function initMascotEyes() {
    const mascot = document.querySelector("[data-front-mascot]");
    const pupils = mascot && mascot.querySelector("[data-front-pupils]");
    if (!pupils || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    window.addEventListener("pointermove", (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = mascot.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const reach = 22 * Math.min(1, d / 300); // SVG-enheter (viewBox 612)
        pupils.style.transform = `translate(${(dx / d) * reach}px, ${(dy / d) * reach}px)`;
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * Start trikset rett i heltefeltet
   *
   * Tidligere var korteste vei til noe som skjedde på skjermen: godta
   * cookies → klikk et kort → vent på en ny sidelasting → vent på at
   * spillmodulen lastes. Nå lastes modulen på klikk, og brettet dukker opp
   * der bildet var, uten sidelasting.
   * ------------------------------------------------------------------ */

  const EXTRA_SCRIPTS_BY_ID = { fruktfusjon: ["js/vendor/matter.min.js"] };
  const MODULE_BY_ID = { fruktfusjon: "js/games/game-fruit-merge.js" };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = window.studillaAsset ? window.studillaAsset(src) : src;
      el.onload = resolve;
      el.onerror = () => reject(new Error("Klarte ikke laste " + src));
      document.head.appendChild(el);
    });
  }

  async function loadGameModule(id) {
    if (window.STUDILLA_GAME_MODULES && window.STUDILLA_GAME_MODULES[id]) return true;
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return false;
    const sources = (EXTRA_SCRIPTS_BY_ID[id] || []).concat([MODULE_BY_ID[id] || `js/games/game-${id}.js`]);
    try {
      for (const src of sources) await loadScript(src);
    } catch (e) {
      return false;
    }
    return !!(window.STUDILLA_GAME_MODULES && window.STUDILLA_GAME_MODULES[id]);
  }

  let heroStarted = false;

  async function startHeroGame(button) {
    if (heroStarted) return;
    const daily = dailyGame();
    const stage = document.querySelector("[data-hero-stage]");
    const inner = document.querySelector("[data-hero-stage-inner]");
    if (!daily || !stage || !inner || !window.StudillaGameRuntime) {
      // Uten kjøretiden faller vi tilbake til den vanlige triks-siden i
      // stedet for at knappen ikke gjør noe.
      window.location.href = `player.html?id=${encodeURIComponent(daily ? daily.id : "")}`;
      return;
    }

    const buttons = document.querySelectorAll("[data-hero-start]");
    buttons.forEach((b) => { b.disabled = true; b.textContent = "Laster …"; });

    const ok = await loadGameModule(daily.id);
    if (!ok) {
      window.location.href = `player.html?id=${encodeURIComponent(daily.id)}`;
      return;
    }

    heroStarted = true;
    document.querySelector("[data-hero-media]").hidden = true;
    stage.hidden = false;
    document.querySelector("[data-hero]").classList.add("is-playing");

    const module = window.STUDILLA_GAME_MODULES[daily.id];
    module.start(inner, daily);

    // Rull heltefeltet i syne på mobil, der brettet ellers kan starte
    // halvveis utenfor skjermen.
    stage.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function initHeroStart() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-hero-start]");
      if (!btn) return;
      e.preventDefault();
      startHeroGame(btn);
    });
  }

  /* ------------------------------------------------------------------ *
   * Tipsene på forsiden
   * ------------------------------------------------------------------ */

  /**
   * Tipsene står som en innholdsfortegnelse i kladdeboka: tittel, ingress og
   * lesertall, i samme rekkefølge som på tips.html. Det mest leste får en
   * liten håndskrevet merknad. Maler og filer bor på tips.html.
   */
  const FRONT_GUIDE_LIMIT = 5;

  async function renderFrontGuide() {
    const section = document.querySelector("[data-front-guide-section]");
    const el = document.querySelector("[data-front-guide]");
    if (!section || !el) return;

    if (window.STUDILLA_GUIDES_READY) await window.STUDILLA_GUIDES_READY;
    const guides = (window.STUDILLA_GUIDES || []).filter((g) => !g.hidden);
    if (!guides.length) return;

    const mostRead = guides.reduce((a, b) => (b.viewCount > a.viewCount ? b : a));
    el.innerHTML = guides.slice(0, FRONT_GUIDE_LIMIT).map((g) => `
      <li>
        <a href="tip.html?id=${encodeURIComponent(g.id)}">
          <h3>${esc(g.title)}</h3>
          ${g.excerpt ? `<p>${esc(g.excerpt)}</p>` : ""}
          ${g === mostRead && g.viewCount > 0 ? `<span class="front-toc-note">Det mest leste tipset!</span>` : ""}
          ${g.viewCount > 0 ? `<span class="front-toc-views"><b>${formatNumber(g.viewCount)}</b> lesere</span>` : ""}
        </a>
      </li>
    `).join("");

    const countEl = document.querySelector("[data-front-guide-count]");
    if (countEl) countEl.textContent = `Alle ${guides.length} tips`;
    section.hidden = false;
  }

  function initPlayerPage() {
    const stage = document.querySelector("[data-player-stage]");
    if (!stage) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const game = games.find((g) => g.id === id) || games[0];

    if (!game) return;

    document.title = `${game.name} · Studilla`;

    const titleEl = document.querySelector("[data-player-title]");
    const timeEl = document.querySelector("[data-player-time]");
    const descEl = document.querySelector("[data-player-description]");

    if (titleEl) titleEl.textContent = game.name;
    if (timeEl) timeEl.textContent = game.time;
    if (descEl) descEl.textContent = game.description || "";

    const module = window.STUDILLA_GAME_MODULES && window.STUDILLA_GAME_MODULES[game.id];
    if (module && window.StudillaGameRuntime) {
      module.start(stage, game);
    } else {
      stage.innerHTML = `<span class="player-stage-slot">Innholdet lastes …</span>`;
    }
  }

  /**
   * Nedtelling til neste "dagens triks". Dagens triks roterer automatisk ved
   * midnatt (se js/games-data.js), så teksten teller ned til det faktiske
   * byttet i stedet for å stå på et fast tall.
   */
  function initDailyCountdown() {
    const el = document.querySelector("[data-daily-countdown]");
    if (!el || !window.studillaMsUntilNextDailyGame) return;

    function tick() {
      const ms = Math.max(0, window.studillaMsUntilNextDailyGame());
      const total = Math.floor(ms / 1000);
      const pad = (n) => String(n).padStart(2, "0");
      el.textContent = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
      // Når tiden er ute: hent siden på nytt, slik at dagens triks byttes uten
      // at brukeren må gjøre det selv. Men ikke midt i en runde – da mister
      // spilleren stillingen sin.
      if (ms <= 0 && !heroStarted) window.location.reload();
    }

    tick();
    setInterval(tick, 1000);
  }

  document.addEventListener("DOMContentLoaded", async function () {
    // Aktivt menypunkt markeres av js/layout.js (kjører på alle sider).
    initHeroStart();
    initMascotEyes();
    renderDate();
    renderFrontGuide();
    renderPodium();
    if (window.STUDILLA_GAMES_READY) await window.STUDILLA_GAMES_READY;
    if (window.STUDILLA_GAME_SCRIPT_READY) await window.STUDILLA_GAME_SCRIPT_READY;
    renderHero("[data-hero]");
    renderGameGrid("[data-game-grid]");
    loadHeroBest();
    loadRecordsIntoGrid();
    initDailyCountdown();
    initPlayerPage();
  });
})();
