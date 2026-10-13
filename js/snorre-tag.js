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
        '<span class="snorre-tag-label">STØTTER SNORRE</span>' +
        '<span class="snorre-tag-info" tabindex="0" role="img" aria-label="' + TIP + '" data-tip="' + TIP + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="11"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>' +
        '</span>' +
      '</span>'
    );
  }

  window.StudillaSnorreTag = { html, TIP };
})();
