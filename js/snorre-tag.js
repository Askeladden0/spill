/**
 * Studilla – «Støtter Snorre»-taggen på rabatter (rewards.supports_snorre).
 * Tegnes i aksentfargen med et infosymbol som viser forklaringen ved hover.
 */
(function () {
  "use strict";

  const TIP = "Om du bruker denne rabatten støtter du meg:)";

  function html() {
    return (
      '<span class="snorre-tag">' +
        '<img class="snorre-tag-avatar" src="assets/img/snorre-saus-avatar.jpeg" alt="" width="16" height="16">' +
        '<span class="snorre-tag-label">STØTTER SNORRE</span>' +
        '<span class="snorre-tag-info" tabindex="0" role="img" aria-label="' + TIP + '" data-tip="' + TIP + '">' +
          '?' +
        '</span>' +
      '</span>'
    );
  }

  // Neonfarger til rabattkodene: sideaksentene (rosa, gul, blå, oransje, grønn)
  // og profilbildefargene. Samme kode får alltid samme farge.
  const NEON = ["#2ee87f", "#eb34e1", "#f4f74a", "#4abef7", "#f78f4a", "#38bdf8", "#a78bfa", "#f472b6", "#ffd166", "#fb923c", "#ff9385"];

  function neonFor(code) {
    let h = 0;
    const s = String(code || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return NEON[h % NEON.length];
  }

  window.StudillaSnorreTag = { html, TIP, neonFor };
})();
