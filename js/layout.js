/**
 * Studilla – delt topp-nav og bunnmeny.
 * Setter inn header/footer i <div id="site-header"></div> og
 * <div id="site-footer"></div>. Kjører synkront (ikke DOMContentLoaded)
 * slik at auth.js rekker å finne [data-auth-slot] / [data-admin-only]
 * når den kjører etterpå.
 */

(function () {
  "use strict";

  // Header-/footer-markupen ligger i js/layout-markup.js, som må lastes før
  // denne filen. Byggesteget (build/build.mjs) leser den samme filen og
  // skriver markupen rett inn i HTML-en, så i produksjon finnes menyen
  // allerede – da er slot-ene borte og innsettingen under hopper over.
  const LAYOUT = window.STUDILLA_LAYOUT;
  if (!LAYOUT) {
    console.error("js/layout-markup.js må lastes før js/layout.js");
  }

  const headerSlot = document.getElementById("site-header");
  if (headerSlot && LAYOUT) headerSlot.outerHTML = LAYOUT.header;

  const footerSlot = document.getElementById("site-footer");
  if (footerSlot && LAYOUT) footerSlot.outerHTML = LAYOUT.footer;

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

  /**
   * Mobil-meny: toppmenyen var tidligere en horisontalt scrollbar liste på
   * mobil, som gjorde at «Rangering» ble skjult utenfor skjermen. Nå åpnes
   * hele lenkelisten som et nedtrekkspanel under headeren via hamburger-
   * knappen, slik at alle sidene er synlige med det samme.
   */
  const header = document.querySelector(".site-header");
  const menuToggle = header && header.querySelector(".mobile-menu-toggle");
  const mainNav = document.getElementById("main-nav");

  function closeMobileMenu() {
    if (!header) return;
    header.classList.remove("is-menu-open");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
  }

  if (header && menuToggle && mainNav) {
    menuToggle.addEventListener("click", () => {
      const isOpen = header.classList.toggle("is-menu-open");
      menuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    mainNav.addEventListener("click", (event) => {
      if (event.target.closest(".nav-link")) closeMobileMenu();
    });

    document.addEventListener("click", (event) => {
      if (!header.classList.contains("is-menu-open")) return;
      if (header.contains(event.target)) return;
      closeMobileMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMobileMenu();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 720) closeMobileMenu();
    });
  }
})();
