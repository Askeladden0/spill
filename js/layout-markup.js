/**
 * Studilla – delt markup for topp-nav og bunnmeny.
 *
 * Denne filen er ENESTE kilde til header/footer-HTML. Den leses to steder:
 *   1. I nettleseren, av js/layout.js, som setter markupen inn i
 *      <div id="site-header"> / <div id="site-footer"> hvis byggesteget
 *      ikke allerede har gjort det.
 *   2. Under bygg, av build/build.mjs, som skriver den rett inn i HTML-en
 *      slik at menyen finnes i sidekilden (bedre for SEO, ingen layout-hopp).
 *
 * Må derfor kunne kjøre både i nettleser og i Node. Den rører ikke DOM-en –
 * den setter bare window.STUDILLA_LAYOUT. Krever at js/feature-flags.js er
 * lastet først.
 */

(function (global) {
  "use strict";

  const window = global;


  // Nivå-/premiesystemet er skrudd av for den live siden (se
  // js/feature-flags.js) – «Premier» skal derfor ikke vises i toppmenyen så
  // lenge bryteren står på false, uten at lenken/siden fjernes fra koden.
  const LEVELS_ENABLED = !!(window.STUDILLA_FEATURES && window.STUDILLA_FEATURES.levelsEnabled);


  // Meldinger er kun relevant når man er logget inn, så lenken ligger skjult
  // til js/auth.js slår den på (samme mønster som data-admin-only). Prikken
  // med antall uleste fylles av js/social.js.
  const MELDINGER_NAV_LINK = `
        <a href="meldinger.html" class="nav-link" data-page="meldinger" data-signup-gate>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.4-.6L3 21l1.9-5.1A8.3 8.3 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"></path></svg>
          Venner
          <span class="nav-badge" data-dm-badge hidden aria-label="uleste meldinger"></span>
        </a>`;

  const HEADER_HTML = `
  <a class="skip-link" href="#hovedinnhold">Hopp til innholdet</a>
  <header class="site-header">
    <div class="header-left">
      <a href="index.html" class="logo">
        <span class="logo-mark"><img src="assets/img/snorre-saus-avatar.jpeg" alt="" width="30" height="30"></span>
        <span class="logo-text">Studi<span>ll</span>a</span>
      </a>
      <nav class="main-nav" id="main-nav">
        <a href="index.html#spill" class="nav-link" data-page="spill">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"></line><line x1="8" y1="9" x2="8" y2="13"></line><line x1="15" y1="12" x2="15.01" y2="12"></line><line x1="18" y1="10" x2="18.01" y2="10"></line><rect x="2" y="6" width="20" height="12" rx="5"></rect></svg>
          Triks
        </a>
        <a href="guider.html" class="nav-link" data-page="guider">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z"></path><path d="M8 7.5h7"></path><path d="M8 11h5"></path></svg>
          Guider
        </a>
        <a href="rangering.html" class="nav-link" data-page="rangering">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="4" width="6" height="17"></rect><rect x="15" y="9" width="6" height="12"></rect><rect x="3" y="12" width="6" height="9"></rect></svg>
          Rangering
        </a>${MELDINGER_NAV_LINK}
        <a href="admin.html" class="nav-link" data-page="admin" data-admin-only style="display:none">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6l7-3z"></path><path d="M9.5 12.2l1.8 1.8 3.4-3.6"></path></svg>
          Admin
        </a>
      </nav>
    </div>

    <div class="header-right-group">
      <div class="header-right" data-auth-slot></div>

      <button type="button" class="mobile-menu-toggle" aria-label="Åpne meny" aria-expanded="false" aria-controls="main-nav">
        <svg class="mobile-menu-icon-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="20" y2="17"></line></svg>
        <svg class="mobile-menu-icon-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
      </button>
    </div>
  </header>`;

  const FOOTER_HTML = `
  <footer class="site-footer">
    <div class="footer-brand">
      <span class="footer-logo-mark"><img src="assets/img/snorre-saus-avatar.jpeg" alt="" width="24" height="24"></span>
      <span class="footer-copy">© 2026 Studilla</span>
    </div>
    <nav class="footer-nav">
      <a href="om.html">Om oss</a>
      <a href="kontakt.html">Kontakt</a>
      <a href="personvern.html">Personvern</a>
      <a href="vilkar.html">Vilkår</a>
      <a href="https://www.tiktok.com/@snorre.saus" target="_blank" rel="noopener noreferrer">TikTok</a>
      <a href="admin.html" data-admin-only style="display:none">Admin</a>
    </nav>
  </footer>`;

  global.STUDILLA_LAYOUT = { header: HEADER_HTML, footer: FOOTER_HTML };
})(typeof globalThis !== "undefined" ? globalThis : this);
