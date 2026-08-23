/**
 * Studilla – cookie-banner (UI).
 *
 * Bygger på designet i Cookie-banner.dc.html. Varselet dukker først opp når
 * en besøkende går inn på et triks (spillsiden) og ikke har tatt et valg
 * ennå – ikke på hver eneste side. Etter at valget er tatt ligger det ingen
 * flytende knapp igjen i hjørnet; innstillingene åpnes fra
 * innstillinger.html eller via window.StudillaCookieBanner.open().
 * Selve lagringen/håndhevingen av valget skjer i js/consent.js.
 */
(function () {
  "use strict";

  if (!window.StudillaConsent) return; // consent.js må lastes først

  const POLICY_URL = "vilkar.html";

  function trackStyle(on) {
    return (
      "position:absolute;inset:0;border-radius:99px;transition:background .15s ease;" +
      "background:" + (on ? "#2ee87f" : "rgba(255,255,255,.09)") + ";"
    );
  }
  function dotStyle(on) {
    return (
      "position:absolute;width:16px;height:16px;top:3px;border-radius:50%;transition:left .15s ease;" +
      "background:#fff;left:" + (on ? "19px" : "3px") + ";"
    );
  }

  function buildRoot() {
    const root = document.createElement("div");
    root.id = "studilla-cookie-banner";
    root.innerHTML =
      '<div id="scb-overlay" style="position:fixed;inset:0;z-index:9998;display:none;align-items:center;justify-content:center;padding:24px;">' +
        '<div id="scb-backdrop" style="position:absolute;inset:0;background:rgba(6,9,14,.82);backdrop-filter:blur(3px);"></div>' +
        '<div id="scb-initial" style="position:relative;z-index:1;width:100%;max-width:440px;background:#131a25;border:1px solid rgba(255,255,255,.09);border-radius:20px;padding:32px 32px 28px;display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.5);font-family:\'Poppins\',system-ui,sans-serif;">' +
          '<div style="display:flex;flex-direction:column;gap:8px;">' +
            '<h2 style="margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#ffffff;">Vi bruker cookies🍪</h2>' +
            '<p style="margin:0;font-size:13.5px;line-height:1.6;color:#96a3b8;">Studilla bruker cookies for at siden skal fungere og for å samle inn statistikk og vise relevant markedsføring. Les mer i <a href="' + POLICY_URL + '" style="color:#2ee87f;">vilkårene</a>.</p>' +
          '</div>' +
          '<div style="display:flex;gap:10px;width:100%;margin-top:4px;">' +
            '<button type="button" id="scb-customize" style="flex:1;padding:13px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:transparent;color:#e8edf5;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;">Tilpass</button>' +
            '<button type="button" id="scb-accept-all" style="flex:1;padding:13px;border:none;border-radius:10px;background:#2ee87f;color:#0d1117;font-size:14px;font-weight:800;letter-spacing:-.01em;cursor:pointer;">Godta alle</button>' +
          '</div>' +
        '</div>' +
        '<div id="scb-preferences" style="display:none;position:relative;z-index:1;width:100%;max-width:460px;background:#131a25;border:1px solid rgba(255,255,255,.09);border-radius:20px;padding:30px 30px 26px;flex-direction:column;gap:18px;box-shadow:0 24px 64px rgba(0,0,0,.5);font-family:\'Poppins\',system-ui,sans-serif;">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
            '<div style="display:flex;flex-direction:column;gap:4px;">' +
              '<h2 style="margin:0;font-size:19px;font-weight:800;letter-spacing:-.02em;color:#ffffff;">Tilpass cookies</h2>' +
              '<p style="margin:0;font-size:13px;color:#7c8aa0;">Velg hva du vil tillate. Du kan endre dette senere.</p>' +
            '</div>' +
            '<button type="button" id="scb-back" aria-label="Tilbake" style="flex-shrink:0;width:30px;height:30px;border-radius:9px;border:1px solid rgba(255,255,255,.09);background:#0d1117;color:#96a3b8;font-size:15px;line-height:1;cursor:pointer;">←</button>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 16px;border-radius:14px;background:#0d1117;border:1px solid rgba(255,255,255,.06);">' +
              '<div style="display:flex;flex-direction:column;gap:4px;">' +
                '<span style="font-size:14px;font-weight:700;color:#e8edf5;">Nødvendige</span>' +
                '<span style="font-size:12.5px;line-height:1.5;color:#7c8aa0;">Kreves for at Studilla skal fungere som den skal. Kan ikke skrus av.</span>' +
              '</div>' +
              '<span style="position:relative;display:inline-block;width:38px;height:22px;flex-shrink:0;margin-top:2px;">' +
                '<span style="position:absolute;inset:0;background:#2ee87f;border-radius:99px;opacity:.5;"></span>' +
                '<span style="position:absolute;width:16px;height:16px;left:19px;top:3px;background:#fff;border-radius:50%;opacity:.5;"></span>' +
              '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 16px;border-radius:14px;background:#0d1117;border:1px solid rgba(255,255,255,.06);">' +
              '<div style="display:flex;flex-direction:column;gap:4px;">' +
                '<span style="font-size:14px;font-weight:700;color:#e8edf5;">Statistikk</span>' +
                '<span style="font-size:12.5px;line-height:1.5;color:#7c8aa0;">Hjelper oss å forstå hvilke triks som brukes, slik at vi kan forbedre dem.</span>' +
              '</div>' +
              '<label style="position:relative;display:inline-block;width:38px;height:22px;flex-shrink:0;margin-top:2px;cursor:pointer;">' +
                '<input type="checkbox" id="scb-stats" style="opacity:0;width:0;height:0;">' +
                '<span id="scb-stats-track" style="' + trackStyle(false) + '"></span>' +
                '<span id="scb-stats-dot" style="' + dotStyle(false) + '"></span>' +
              '</label>' +
            '</div>' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 16px;border-radius:14px;background:#0d1117;border:1px solid rgba(255,255,255,.06);">' +
              '<div style="display:flex;flex-direction:column;gap:4px;">' +
                '<span style="font-size:14px;font-weight:700;color:#e8edf5;">Markedsføring</span>' +
                '<span style="font-size:12.5px;line-height:1.5;color:#7c8aa0;">Brukes for å vise relevante rabatter og annonser til deg, blant annet via Google Ads.</span>' +
              '</div>' +
              '<label style="position:relative;display:inline-block;width:38px;height:22px;flex-shrink:0;margin-top:2px;cursor:pointer;">' +
                '<input type="checkbox" id="scb-marketing" style="opacity:0;width:0;height:0;">' +
                '<span id="scb-marketing-track" style="' + trackStyle(false) + '"></span>' +
                '<span id="scb-marketing-dot" style="' + dotStyle(false) + '"></span>' +
              '</label>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;margin-top:2px;">' +
            '<button type="button" id="scb-reject" style="flex:1;padding:13px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:transparent;color:#e8edf5;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer;">Avvis alle</button>' +
            '<button type="button" id="scb-save" style="flex:1;padding:13px;border:none;border-radius:10px;background:#2ee87f;color:#0d1117;font-size:13.5px;font-weight:800;letter-spacing:-.01em;cursor:pointer;">Lagre valg</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    return root;
  }

  document.addEventListener("DOMContentLoaded", function () {
    const root = buildRoot();
    document.body.appendChild(root);

    const overlay = root.querySelector("#scb-overlay");
    const initialView = root.querySelector("#scb-initial");
    const preferencesView = root.querySelector("#scb-preferences");
    const statsInput = root.querySelector("#scb-stats");
    const marketingInput = root.querySelector("#scb-marketing");
    const statsTrack = root.querySelector("#scb-stats-track");
    const statsDot = root.querySelector("#scb-stats-dot");
    const marketingTrack = root.querySelector("#scb-marketing-track");
    const marketingDot = root.querySelector("#scb-marketing-dot");

    function syncToggleUI() {
      statsTrack.setAttribute("style", trackStyle(statsInput.checked));
      statsDot.setAttribute("style", dotStyle(statsInput.checked));
      marketingTrack.setAttribute("style", trackStyle(marketingInput.checked));
      marketingDot.setAttribute("style", dotStyle(marketingInput.checked));
    }

    function showInitial() {
      initialView.style.display = "flex";
      preferencesView.style.display = "none";
    }
    function showPreferences() {
      const current = window.StudillaConsent.get();
      statsInput.checked = !!(current && current.stats);
      marketingInput.checked = !!(current && current.marketing);
      syncToggleUI();
      initialView.style.display = "none";
      preferencesView.style.display = "flex";
    }
    function openBanner(view) {
      overlay.style.display = "flex";
      if (view === "preferences") showPreferences();
      else showInitial();
    }
    function closeBanner() {
      overlay.style.display = "none";
    }

    root.querySelector("#scb-customize").addEventListener("click", showPreferences);
    root.querySelector("#scb-back").addEventListener("click", showInitial);
    root.querySelector("#scb-accept-all").addEventListener("click", function () {
      window.StudillaConsent.save({ stats: true, marketing: true });
      closeBanner();
    });
    root.querySelector("#scb-reject").addEventListener("click", function () {
      window.StudillaConsent.save({ stats: false, marketing: false });
      closeBanner();
    });
    root.querySelector("#scb-save").addEventListener("click", function () {
      window.StudillaConsent.save({ stats: statsInput.checked, marketing: marketingInput.checked });
      closeBanner();
    });
    statsInput.addEventListener("change", syncToggleUI);
    marketingInput.addEventListener("change", syncToggleUI);

    // Varselet vises kun på spillsiden (player.html), og bare til brukeren har
    // tatt et valg. Andre sider laster fortsatt banneret, slik at det kan
    // åpnes manuelt fra innstillingene.
    const isGamePage = !!document.querySelector("[data-player-stage]");
    if (isGamePage && !window.StudillaConsent.hasChoice()) {
      openBanner("initial");
    } else {
      closeBanner();
    }

    window.StudillaCookieBanner = { open: openBanner, close: closeBanner };
  });
})();
