/**
 * Studilla – Slope.
 * Slope kjører som en innebygd (iframe) versjon hostet utenfor Studilla, så
 * dette er bare en tynn omslagsmodul: den fyller spillflaten med iframen.
 * Den bruker ikke den delte spill-kjøretiden (js/game-runtime.js), fordi
 * innholdet i iframen er et eget program på et annet domene som ikke gir fra
 * seg skår – det finnes derfor ingen poeng-HUD, rekord eller game-over her.
 */
(function () {
  "use strict";

  const GAME_ID = "slope";
  const EMBED_URL = "https://catfoolyou.github.io/Slope/";

  function start(container) {
    container.innerHTML = "";

    const frame = document.createElement("iframe");
    frame.className = "slope-embed";
    frame.src = EMBED_URL;
    frame.title = "Slope";
    frame.loading = "eager";
    frame.setAttribute("allow", "fullscreen; autoplay; gamepad");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("scrolling", "no");
    container.appendChild(frame);
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
