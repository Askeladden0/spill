/**
 * Studilla – delt topp-nav og bunnmeny.
 * Setter inn header/footer i <div id="site-header"></div> og
 * <div id="site-footer"></div>. Kjører synkront (ikke DOMContentLoaded)
 * slik at auth.js rekker å finne [data-auth-slot] / [data-admin-only]
 * når den kjører etterpå.
 */

(function () {
  "use strict";

  const HEADER_HTML = `
  <header class="site-header">
    <div class="header-left">
      <a href="index.html" class="logo">
        <span class="logo-mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><rect x="3" y="10" width="6" height="11" rx="2.5" fill="#1f8f5f"/><rect x="13" y="4" width="6" height="17" rx="2.5" fill="#3ddc84"/></svg></span>
        <span class="logo-text">Studi<span>ll</span>a</span>
      </a>
      <nav class="main-nav">
        <a href="index.html#spill" class="nav-link" data-page="spill">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"></line><line x1="8" y1="9" x2="8" y2="13"></line><line x1="15" y1="12" x2="15.01" y2="12"></line><line x1="18" y1="10" x2="18.01" y2="10"></line><rect x="2" y="6" width="20" height="12" rx="5"></rect></svg>
          Triks
        </a>
        <a href="premier.html" class="nav-link" data-page="premier">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"></path><path d="M17 5h3v2a3 3 0 0 1-3 3"></path><path d="M7 5H4v2a3 3 0 0 0 3 3"></path></svg>
          Premier
        </a>
        <a href="rangering.html" class="nav-link" data-page="rangering">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="4" width="6" height="17"></rect><rect x="15" y="9" width="6" height="12"></rect><rect x="3" y="12" width="6" height="9"></rect></svg>
          Rangering
        </a>
        <a href="admin.html" class="nav-link" data-page="admin" data-admin-only style="display:none">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6l7-3z"></path><path d="M9.5 12.2l1.8 1.8 3.4-3.6"></path></svg>
          Admin
        </a>
      </nav>
    </div>

    <div class="header-right" data-auth-slot></div>
  </header>`;

  const FOOTER_HTML = `
  <footer class="site-footer">
    <div class="footer-brand">
      <span class="footer-logo-mark"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true"><rect x="3" y="10" width="6" height="11" rx="2.5" fill="#1f8f5f"/><rect x="13" y="4" width="6" height="17" rx="2.5" fill="#3ddc84"/></svg></span>
      <span class="footer-copy">© 2026 Studilla</span>
    </div>
    <nav class="footer-nav">
      <a href="kontakt.html">Kontakt</a>
      <a href="vilkar.html#personvern">Personvern</a>
      <a href="vilkar.html">Vilkår</a>
      <a href="admin.html" data-admin-only style="display:none">Admin</a>
    </nav>
  </footer>`;

  const headerSlot = document.getElementById("site-header");
  if (headerSlot) headerSlot.outerHTML = HEADER_HTML;

  const footerSlot = document.getElementById("site-footer");
  if (footerSlot) footerSlot.outerHTML = FOOTER_HTML;

  /**
   * Marker menypunktet som hører til siden man står på med aksentfargen.
   * Lå tidligere i js/main.js, som kun lastes på forsiden/spillsiden – derfor
   * fikk «Premier» og «Rangering» aldri aksentfarge når man stod der. Her
   * kjører den for alle sider som bruker den delte headeren.
   *
   * Spillsiden (player.html) bruker data-page="spill", slik at «Triks» blir
   * stående markert mens man er inne i et spill.
   */
  const current = (document.body.getAttribute("data-page") || "").toLowerCase();
  document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("data-page") === current);
  });
})();
