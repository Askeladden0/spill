/**
 * Studilla – velkomstpopup for besøkende som ble videresendt hit fra en av
 * de gamle spillsidene (skolesaus.no). Vises kun når URL-en har
 * ?ny-side=1 (satt av redirect-scriptet der), og fjernes fra URL-en igjen
 * så popup'en ikke dukker opp på nytt ved refresh.
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  if (params.get("ny-side") !== "1") return;

  params.delete("ny-side");
  const cleanQuery = params.toString();
  const cleanUrl = window.location.pathname + (cleanQuery ? "?" + cleanQuery : "") + window.location.hash;
  window.history.replaceState({}, "", cleanUrl);

  const style = document.createElement("style");
  style.textContent = `
    #ss-welcome-overlay {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 100000;
      justify-content: center;
      align-items: center;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(0.5px);
      animation: ssWelcomeFadeIn 0.2s ease;
    }
    #ss-welcome-modal {
      background: #1a1d2e;
      border: 1px solid #2e3047;
      border-radius: 12px;
      padding: 2.2rem 2.4rem;
      max-width: 440px;
      width: 90%;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      animation: ssWelcomeSlideUp 0.25s ease;
      font-family: "Poppins", Arial, sans-serif;
    }
    #ss-welcome-modal .ss-welcome-icon { font-size: 2.2rem; margin-bottom: 0.8rem; display: block; }
    #ss-welcome-modal h2 { font-size: 1.3rem; color: #f2f2f2; margin-bottom: 0.8rem; font-weight: 700; }
    #ss-welcome-modal p { font-size: 0.9rem; color: #aaa; line-height: 1.7; margin-bottom: 1.2rem; }
    #ss-welcome-modal .ss-welcome-sign { font-style: italic; color: #2ee87f; font-weight: 700; }
    .ss-welcome-btn {
      background: #2ee87f;
      color: #000;
      border: none;
      padding: 0.75rem 1.6rem;
      font-size: 0.9rem;
      font-family: "Poppins", Arial, sans-serif;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .ss-welcome-btn:hover { opacity: 0.85; }
    @keyframes ssWelcomeFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ssWelcomeSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 500px) {
      #ss-welcome-modal { padding: 1.6rem 1.4rem; }
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "ss-welcome-overlay";
  overlay.innerHTML = `
    <div id="ss-welcome-modal" role="dialog" aria-modal="true" aria-labelledby="ss-welcome-title">
      <span class="ss-welcome-icon">🎮</span>
      <h2 id="ss-welcome-title">Dette spillet har flyttet!</h2>
      <p>Dette er min nye spillnettside – med flere spill, poeng og rangeringer.<br><span class="ss-welcome-sign">- Snorre Saus</span></p>
      <button class="ss-welcome-btn" id="ss-welcome-close">Kult, la oss spille!</button>
    </div>
  `;

  function mount() {
    document.body.appendChild(overlay);
    document.getElementById("ss-welcome-close").addEventListener("click", function () {
      overlay.remove();
    });
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
