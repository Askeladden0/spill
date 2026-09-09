/**
 * Studilla – delt sidelogikk.
 * Bruker window.STUDILLA_GAMES (js/games-data.js) som datakilde.
 * Når backend/admin-panel er klart: bytt ut games-data.js med et
 * fetch-kall som fyller samme globale variabel, resten fungerer uendret.
 */

(function () {
  "use strict";

  const games = window.STUDILLA_GAMES || [];

  function gameCardHTML(g) {
    return `
      <article class="game-card">
        <a href="player.html?id=${encodeURIComponent(g.id)}" class="game-thumb" aria-label="Åpne ${g.name}">
          ${g.thumbnail
            ? `<img class="game-thumb-img" src="${g.thumbnail}" alt="" loading="lazy">`
            : `<span class="game-thumb-slot">[ bilde ]</span>`}
          <div class="game-thumb-gradient"></div>
          <h3 class="game-title">${g.name}</h3>
        </a>
        <div class="game-body">
          <!-- Knappen lå tidligere inni <a>, som både er ugyldig HTML
               (klikkbart element inni et klikkbart element) og ga to
               tabulator-stopp for samme mål. Nå er hele kortet én lenke. -->
          <a class="btn-start" href="player.html?id=${encodeURIComponent(g.id)}">Start</a>
        </div>
      </article>
    `;
  }

  function renderGameGrid(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = games.map(gameCardHTML).join("");

    const countEl = document.querySelector("[data-game-count]");
    if (countEl) countEl.textContent = `${games.length} triks tilgjengelig`;
  }

  function dailyGame() {
    return games.find((g) => g.isDailyGame) || games[0] || null;
  }

  function renderHero(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const daily = dailyGame();
    if (!daily) return;

    el.innerHTML = `
      ${daily.pointsMultiplier ? `
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"></path></svg>
          ${daily.pointsMultiplier}
        </div>` : ""}
      <div class="hero-media" data-hero-media>
        ${daily.thumbnail
          ? `<img class="hero-media-img" src="${daily.thumbnail}" alt="" fetchpriority="high">`
          : `<span class="hero-placeholder-label">Dagens triks</span>`}
        <div class="hero-gradient"></div>
        <div class="hero-content">
          <h2>${daily.name}</h2>
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
   * Guider og maler på forsiden
   * ------------------------------------------------------------------ */

  /**
   * Dokumentene i documents/ (hjelpehefte, matteskjema, nynorskordliste) lå
   * i repoet uten å være lenket noe sted i UIen. Her får de en fast plass på
   * forsiden, ved siden av guidene.
   */
  const RESOURCES = [
    {
      href: "guider.html",
      eyebrow: "GUIDER",
      title: "Steg for steg",
      text: "Hvordan tjene og spare mer som elev – med maler og regnestykker.",
    },
    {
      href: "documents/Snorres_hjelpehefte.pdf",
      eyebrow: "PDF",
      title: "Snorres hjelpehefte",
      text: "Samlet hjelp til de fagene folk spør mest om.",
      download: true,
    },
    {
      href: "documents/Snorres_Matteskjema.xlsx",
      eyebrow: "REGNEARK",
      title: "Matteskjema",
      text: "Ferdig oppsett du kan fylle inn selv.",
      download: true,
    },
    {
      href: "documents/Nynorskordliste.xlsx",
      eyebrow: "REGNEARK",
      title: "Nynorskordliste",
      text: "De ordene folk pleier å bomme på, i én liste.",
      download: true,
    },
  ];

  function renderResources() {
    const el = document.querySelector("[data-resource-row]");
    if (!el) return;
    el.innerHTML = RESOURCES.map((r) => `
      <a class="resource-card" href="${r.href}"${r.download ? ' download target="_blank" rel="noopener"' : ""}>
        <span class="resource-eyebrow">${r.eyebrow}</span>
        <span class="resource-title">${r.title}</span>
        <span class="resource-text">${r.text}</span>
      </a>
    `).join("");
  }

  /* ------------------------------------------------------------------ *
   * Konto-stripen
   * ------------------------------------------------------------------ */

  async function initSignupStrip() {
    const strip = document.querySelector("[data-signup-strip]");
    if (!strip || !window.StudillaAuth) return;
    const profile = await window.StudillaAuth.getCurrentProfile();
    strip.hidden = !!profile;
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
    renderResources();
    initSignupStrip();
    if (window.STUDILLA_GAMES_READY) await window.STUDILLA_GAMES_READY;
    if (window.STUDILLA_GAME_SCRIPT_READY) await window.STUDILLA_GAME_SCRIPT_READY;
    renderHero("[data-hero]");
    renderGameGrid("[data-game-grid]");
    initDailyCountdown();
    initPlayerPage();
  });
})();
