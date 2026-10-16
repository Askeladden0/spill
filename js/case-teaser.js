/**
 * Studilla – teaser for velkomstbonusen på forsiden.
 *
 * Viser samme velkomsthjul som på premier.html (js/welcome-wheel.js).
 * Utloggede som trykker på knappen sendes til registrering; innloggede som
 * ikke har spunnet hjulet sendes til premier.html#velkomst. Er velkomstbonusen
 * allerede hentet vises ingenting.
 */
(function () {
  "use strict";

  const root = document.querySelector("[data-case-teaser]");
  const sb = window.supabaseClient;
  const Auth = window.StudillaAuth;
  if (!root || !sb || !Auth || !window.StudillaWelcomeWheel) return;
  if (!(window.STUDILLA_FEATURES && window.STUDILLA_FEATURES.levelsEnabled)) return;

  async function opened(profile) {
    if (!profile) return false;
    const { data, error } = await sb.from("user_welcome_cases").select("user_id").eq("user_id", profile.id).maybeSingle();
    // Mangler tabellen (migrasjon ikke kjørt) skjules boksen i stedet for å love noe.
    if (error) return true;
    return !!data;
  }

  (async function init() {
    const profile = await Auth.getCurrentProfile();
    if (await opened(profile)) return;
    window.StudillaWelcomeWheel.mount(root, { mode: "teaser", profile });
    const faq = document.querySelector("[data-case-faq]");
    if (faq) faq.hidden = false;
  })();
})();
