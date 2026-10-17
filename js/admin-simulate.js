/**
 * Studilla – admin-simulering av velkomstbonusen.
 *
 * Viser en liten rund «Simuler»-knapp nede i høyre hjørne, kun for
 * innloggede administratorer. Knappen åpner velkomsthjulet i en pop-up som
 * spinner lokalt (se `simulate` i js/welcome-wheel.js): ingen serverkall,
 * ingen kode tas av og admin mister aldri sin egen mulighet til å spinne.
 * Fungerer uansett om admin allerede har hentet velkomstbonusen.
 */
(function () {
  "use strict";

  const Auth = window.StudillaAuth;
  if (!Auth || !window.StudillaWelcomeWheel) return;

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .admin-sim-fab { position: fixed; right: 18px; bottom: 18px; z-index: 9000; width: 54px; height: 54px; border-radius: 50%; border: 0; cursor: pointer; background: #2ee87f; color: #17141f; font: 800 11px/1 "DM Sans", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.45); }
      .admin-sim-fab:hover { filter: brightness(1.08); }
      .admin-sim-overlay { position: fixed; inset: 0; z-index: 9001; background: rgba(0,0,0,.65); display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px 12px; }
      .admin-sim-overlay[hidden] { display: none; }
      .admin-sim-box { width: 100%; max-width: 460px; }
      .admin-sim-close { display: block; margin: 0 0 10px auto; background: #201c2b; color: #ece8f2; border: 1px solid rgba(255,255,255,.15); border-radius: 999px; padding: 6px 14px; font: 700 12px "DM Sans", sans-serif; cursor: pointer; }
    `;
    document.head.appendChild(style);
  }

  function build(profile) {
    injectStyles();

    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "admin-sim-fab";
    fab.textContent = "Simuler";
    fab.setAttribute("aria-label", "Simuler velkomstbonus og spinning (kun admin)");

    const overlay = document.createElement("div");
    overlay.className = "admin-sim-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="admin-sim-box">
        <button type="button" class="admin-sim-close" data-sim-close>Lukk simulering</button>
        <div data-sim-root></div>
      </div>`;

    const root = overlay.querySelector("[data-sim-root]");
    function close() { overlay.hidden = true; root.innerHTML = ""; }

    fab.addEventListener("click", () => {
      overlay.hidden = false;
      window.StudillaWelcomeWheel.mount(root, { mode: "live", profile, simulate: true });
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-sim-close]")) close();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) close(); });

    document.body.appendChild(overlay);
    document.body.appendChild(fab);
  }

  (async function init() {
    const profile = await Auth.getCurrentProfile();
    if (profile && profile.is_admin) build(profile);
  })();
})();
