/**
 * Dilla – delt sidelogikk.
 * Bruker window.DILLA_GAMES (js/games-data.js) som datakilde.
 * Når backend/admin-panel er klart: bytt ut games-data.js med et
 * fetch-kall som fyller samme globale variabel, resten fungerer uendret.
 */

(function () {
  "use strict";

  const games = window.DILLA_GAMES || [];

  function starIcon() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8L5.7 21l1.7-7L2 9.2l7.1-.6z"></path></svg>';
  }

  function gameCardHTML(g) {
    return `
      <article class="game-card">
        <a href="player.html?id=${encodeURIComponent(g.id)}" class="game-thumb" aria-label="Åpne ${g.name}">
          <span class="game-rating">${starIcon()} ${g.rating}</span>
          ${g.thumbnail
            ? `<img class="game-thumb-img" src="${g.thumbnail}" alt="">`
            : `<span class="game-thumb-slot">[ spillbilde ]</span>`}
          <div class="game-thumb-gradient"></div>
          <h3 class="game-title">${g.name}</h3>
        </a>
        <div class="game-body">
          <div class="game-meta">
            <span class="game-points">${g.points}</span>
            <span class="game-time">${g.time}</span>
          </div>
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

  function initActiveNav() {
    const current = (document.body.getAttribute("data-page") || "").toLowerCase();
    document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("data-page") === current);
    });
  }

  function initPlayerPage() {
    const stage = document.querySelector("[data-player-stage]");
    if (!stage) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const game = games.find((g) => g.id === id) || games[0];

    if (!game) return;

    document.title = `${game.name} · Dilla`;

    const titleEl = document.querySelector("[data-player-title]");
    const genreEl = document.querySelector("[data-player-genre]");
    const ratingEl = document.querySelector("[data-player-rating]");
    const pointsEl = document.querySelector("[data-player-points]");
    const timeEl = document.querySelector("[data-player-time]");
    const descEl = document.querySelector("[data-player-description]");

    if (titleEl) titleEl.textContent = game.name;
    if (genreEl) genreEl.textContent = game.genre;
    if (ratingEl) ratingEl.innerHTML = `${starIcon()} ${game.rating}`;
    if (pointsEl) pointsEl.textContent = game.points;
    if (timeEl) timeEl.textContent = game.time;
    if (descEl) descEl.textContent = game.description || "";

    const module = window.DILLA_GAME_MODULES && window.DILLA_GAME_MODULES[game.id];
    if (module && window.DillaGameRuntime) {
      module.start(stage, game);
    } else {
      stage.innerHTML = `<span class="player-stage-slot">[ spillinnhold lastes her: ${game.id} ]</span>`;
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    initActiveNav();
    if (window.DILLA_GAMES_READY) await window.DILLA_GAMES_READY;
    renderHero("[data-hero]");
    renderGameGrid("[data-game-grid]");
    initPlayerPage();
  });
})();
