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
            ? `<img class="game-thumb-img" src="${g.thumbnail}" alt="">`
            : `<span class="game-thumb-slot">[ spillbilde ]</span>`}
          <div class="game-thumb-gradient"></div>
          <h3 class="game-title">${g.name}</h3>
        </a>
        <div class="game-body">
          <a href="player.html?id=${encodeURIComponent(g.id)}"><button class="btn-start" type="button">Start</button></a>
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

  function renderHero(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const daily = games.find((g) => g.isDailyGame) || games[0];
    if (!daily) return;

    el.innerHTML = `
      ${daily.pointsMultiplier ? `
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"></path></svg>
          ${daily.pointsMultiplier}
        </div>` : ""}
      <div class="hero-media">
        ${daily.thumbnail
          ? `<img class="hero-media-img" src="${daily.thumbnail}" alt="">`
          : `<span class="hero-placeholder-label">[ hero-bilde: dagens spill 1600×880 ]</span>`}
        <div class="hero-gradient"></div>
        <div class="hero-content">
          <h2>${daily.name}</h2>
          <a href="player.html?id=${encodeURIComponent(daily.id)}">
            <button class="btn-primary" type="button">Spill nå</button>
          </a>
        </div>
      </div>
    `;
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
      stage.innerHTML = `<span class="player-stage-slot">[ spillinnhold lastes her: ${game.id} ]</span>`;
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
      el.textContent = `Byttes ut om ${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
      // Når tiden er ute: hent siden på nytt, slik at dagens triks byttes uten
      // at brukeren må gjøre det selv.
      if (ms <= 0) window.location.reload();
    }

    tick();
    setInterval(tick, 1000);
  }

  document.addEventListener("DOMContentLoaded", async function () {
    // Aktivt menypunkt markeres av js/layout.js (kjører på alle sider).
    if (window.STUDILLA_GAMES_READY) await window.STUDILLA_GAMES_READY;
    if (window.STUDILLA_GAME_SCRIPT_READY) await window.STUDILLA_GAME_SCRIPT_READY;
    renderHero("[data-hero]");
    renderGameGrid("[data-game-grid]");
    initDailyCountdown();
    initPlayerPage();
  });
})();
