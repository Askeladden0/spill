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

  const EYE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;

  function dailyGame() {
    return games.find((g) => g.isDailyGame) || games[0] || null;
  }

  /* ------------------------------------------------------------------ *
   * Triksene
   *
   * Hele kortet er én lenke. Antall spillere og rekorden fylles inn når
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
          <span class="front-trick-players" data-trick-players="${esc(g.id)}"></span>
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
    const players = {};
    rows.forEach((r) => {
      const s = Number(r.score) || 0;
      if (!(r.game_id in best) || s > best[r.game_id]) best[r.game_id] = s;
      (players[r.game_id] = players[r.game_id] || new Set()).add(r.user_id);
    });
    // Antall runder spilt (innloggede + gjester) via game_play_count, så tallet
    // går opp hver gang noen spiller (supabase/schema.sql, seksjon 73). Faller
    // tilbake til unike innloggede spillere hvis funksjonen ikke svarer.
    document.querySelectorAll("[data-trick-players]").forEach(async (el) => {
      const gameId = el.getAttribute("data-trick-players");
      const set = players[gameId];
      let count = set ? set.size : 0;
      const { data, error } = await window.supabaseClient.rpc("game_play_count", { p_game_id: gameId });
      if (!error && data != null) count = Number(data) || 0;
      el.innerHTML = `${EYE_ICON}<span><b>${formatNumber(count)}</b> ganger spilt</span>`;
      el.title = `Dette trikset er spilt ${formatNumber(count)} ganger`;
    });
    document.querySelectorAll("[data-trick-record]").forEach((el) => {
      const s = best[el.getAttribute("data-trick-record")];
      el.innerHTML = s ? `Rekord <b>${formatNumber(s)}</b>` : "Ingen rekord ennå";
    });
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

  function renderHero(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const daily = dailyGame();
    if (!daily) return;

    el.innerHTML = `
      <div class="hero-media" data-hero-media>
        <div class="hero-image">
          ${daily.thumbnail
            ? `<img class="hero-media-img" src="${daily.thumbnail}" alt="" fetchpriority="high">`
            : ""}
        </div>
        <div class="hero-content">
          <h2>${daily.name}</h2>
          ${daily.pointsMultiplier ? `<p class="hero-bonus">${daily.pointsMultiplier}</p>` : ""}
          <p class="hero-desc">${daily.description || ""}</p>
          <button type="button" class="btn-primary" data-hero-start>Start her</button>
        </div>
      </div>
      <!-- Selve spillflaten når man trykker start. Ligger tom til da, slik at
           forsiden ikke drar inn en spillmodul den kanskje aldri trenger. -->
      <div class="hero-stage" data-hero-stage hidden>
        <div class="hero-stage-bar">
          <span class="hero-stage-title">${daily.name}</span>
          <div class="player-hud-slot" data-player-hud></div>
          <a class="hero-stage-full" href="player.html?id=${encodeURIComponent(daily.id)}">Åpne i full skjerm →</a>
        </div>
        <div class="hero-stage-inner" data-hero-stage-inner></div>
      </div>
    `;
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
    document.querySelector(".hero-card").classList.add("is-playing");

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
   * Tipsene står som en innholdsfortegnelse: tittel, ingress og lesertall,
   * i samme rekkefølge som på tips.html. Det mest leste får en liten
   * merknad. Maler og filer bor på tips.html.
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
        <a href="${esc(window.studillaGuideHref(g.id))}">
          <h3>${esc(g.title)}</h3>
          ${g.excerpt ? `<p>${esc(g.excerpt)}</p>` : ""}
          ${g === mostRead && g.viewCount > 0 ? `<span class="front-toc-note">Mest lest</span>` : ""}
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
      el.textContent = `byttes om ${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
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
    renderFrontGuide();
    renderPodium();
    if (window.STUDILLA_GAMES_READY) await window.STUDILLA_GAMES_READY;
    if (window.STUDILLA_GAME_SCRIPT_READY) await window.STUDILLA_GAME_SCRIPT_READY;
    renderHero("[data-hero]");
    renderGameGrid("[data-game-grid]");
    loadRecordsIntoGrid();
    initDailyCountdown();
    initPlayerPage();
  });
})();
