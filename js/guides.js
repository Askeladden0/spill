/**
 * Studilla – guider.html (oversikt) og guide.html (mal for én guide).
 *
 * Samme "enkel state -> render()" -mønster som js/admin.js, men kjører på de
 * offentlige sidene i stedet for i adminpanelet: det finnes ingen egen
 * adminpanel-seksjon for guider. Er man innlogget som admin
 * (window.StudillaAuth.getCurrentProfile().is_admin), dukker rediger-/
 * slette-knapper opp direkte på guider.html-kortene og inne i selve guiden på
 * guide.html – ellers ser alle besøkende akkurat samme side uten kontrollene.
 *
 * Kun én ting redigeres om gangen (state.guideDraft for guide-info,
 * state.moduleDraft for én modul), og skjemafeltene skriver rett inn i
 * draft-objektet via delegerte "input"/"change"-lyttere, slik at et
 * mellomlagret felt aldri forsvinner selv om en annen del av siden
 * (bildeopplasting, "legg til rad" osv.) trigger et re-render.
 */
(function () {
  "use strict";

  const Auth = window.StudillaAuth;
  const Guides = window.StudillaGuides;

  const isGuiderPage = !!document.querySelector("[data-guide-grid]");
  const isGuidePage = !!document.querySelector("[data-guide-modules]");
  if (!isGuiderPage && !isGuidePage) return;

  function escapeHTML(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function nl2br(str) { return escapeHTML(str).replace(/\n/g, "<br>"); }
  function numFmt(n) { return Number(n || 0).toLocaleString("nb-NO").replace(/ /g, " "); }
  function kr(n) { return numFmt(Math.round(Number(n) || 0)) + " kr"; }
  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("no-NO", { day: "numeric", month: "long", year: "numeric" });
  }
  function coerceModuleId(raw) { return /^\d+$/.test(raw) ? Number(raw) : raw; }
  function friendlyError(error) { return (error && error.message) || "Noe gikk galt. Prøv igjen."; }

  // Inline SVG-ikoner. Emoji-glyfene (✎/🗑) som sto her før ble tegnet ulikt i
  // hver nettleser og var vanskelige å se mot mørk bakgrunn – disse arver
  // currentColor og har lik strektykkelse som resten av grensesnittet.
  const ICON_PATHS = {
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
    eyeOff: '<path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17.8 17.8 0 0 1-3.3 4"></path><path d="M6.6 6.7A17.6 17.6 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.1-1.4"></path><path d="M3 3l18 18"></path>',
    up: '<path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path>',
    down: '<path d="M12 5v14"></path><path d="M18 13l-6 6-6-6"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    x: '<path d="M18 6 6 18M6 6l12 12"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="8.5" cy="9.5" r="1.5"></circle><path d="m4 17 5-5 4 4 3-2 4 4"></path>',
    text: '<path d="M4 6h16M4 12h16M4 18h10"></path>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path><path d="M14 3v5h5"></path><path d="M12 12v5"></path><path d="m9.5 14.5 2.5 2.5 2.5-2.5"></path>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M9 10v10M15 10v10"></path>',
    coins: '<circle cx="12" cy="12" r="9"></circle><path d="M14.5 9h-3.2a1.8 1.8 0 0 0 0 3.6h1.4a1.8 1.8 0 0 1 0 3.6H9.5"></path><path d="M12 7.5v9"></path>',
    poll: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path>',
    game: '<path d="M6 12h4M8 10v4"></path><circle cx="16" cy="11" r="1"></circle><circle cx="18.5" cy="13.5" r="1"></circle><rect x="2" y="6" width="20" height="12" rx="5"></rect>',
    drag: '<circle cx="9" cy="6" r="1.4"></circle><circle cx="15" cy="6" r="1.4"></circle><circle cx="9" cy="12" r="1.4"></circle><circle cx="15" cy="12" r="1.4"></circle><circle cx="9" cy="18" r="1.4"></circle><circle cx="15" cy="18" r="1.4"></circle>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"></path>'
  };
  function icon(name, size) {
    const d = ICON_PATHS[name];
    if (!d) return "";
    const s = size || 16;
    return `<svg class="guide-ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  let toastTimer = null;
  function flash(msg) {
    const el = document.querySelector("[data-toast]");
    if (!el) return;
    el.textContent = `✓ ${msg}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  const MODULE_LABELS = { tekst: "Tekst", fil: "Nedlasting", tabell: "Tabell", gevinst: "Gevinst", poll: "Avstemning", triks: "Triks", bilde: "Bilde" };
  const MODULE_ICONS = { tekst: "text", fil: "file", tabell: "table", gevinst: "coins", poll: "poll", triks: "game", bilde: "image" };
  // Rekkefølgen her styrer rekkefølgen i "legg til modul"-velgeren.
  const MODULE_TYPES = [
    ["tekst", "Tekst", "Overskrift, avsnitt, punktliste og en tips-boks."],
    ["bilde", "Bilde", "Et bilde eller skjermbilde, med valgfri bildetekst."],
    ["fil", "Nedlasting", "Last opp en mal eller et dokument leseren kan laste ned."],
    ["tabell", "Tabell", "Tre kolonner med tall eller fakta."],
    ["gevinst", "Gevinst", "Regnestykke som summerer hva leseren kan tjene."],
    ["poll", "Avstemning", "Spørsmål med svaralternativer leserne kan stemme på."],
    ["triks", "Triks", "Kort som lenker til et triks på siden, eller en egen lenke."]
  ];

  function defaultModuleData(type) {
    switch (type) {
      case "tekst": return { heading: "", headingLevel: 2, body: "", bullets: [], tip: null };
      case "fil": return { name: "", ext: "", meta: "", url: null };
      case "tabell": return { title: "", columns: ["Kolonne 1", "Kolonne 2", "Kolonne 3"], rows: [], source: "" };
      case "gevinst": return { heading: "Dette kan du tjene", note: "", gains: [] };
      case "poll": return { question: "", options: [{ label: "", votes: 0 }, { label: "", votes: 0 }] };
      case "triks": return { gameId: null, title: "", intro: "", href: null };
      case "bilde": return { url: null, alt: "", caption: "", size: "full" };
      default: return {};
    }
  }

  function validateModuleData(type, data) {
    switch (type) {
      case "tekst": return (data.heading || data.body) ? null : "Skriv en overskrift eller en brødtekst.";
      case "fil": return data.name ? null : "Gi filen et navn.";
      case "tabell": return data.title ? null : "Gi tabellen en tittel.";
      case "gevinst": return (data.gains || []).length ? null : "Legg til minst én post under gevinsten.";
      case "poll": return data.question && (data.options || []).filter((o) => o.label).length >= 2
        ? null : "Skriv et spørsmål og minst to svaralternativer.";
      case "triks": return (data.gameId || data.title) ? null : "Velg et triks, eller gi lenken en tittel.";
      case "bilde": return data.url ? null : "Last opp et bilde først.";
      default: return null;
    }
  }

  function sanitizeModuleData(type, raw) {
    const d = JSON.parse(JSON.stringify(raw));
    if (type === "tekst") {
      d.heading = (d.heading || "").trim();
      d.headingLevel = d.headingLevel === 3 ? 3 : 2;
      d.body = (d.body || "").trim();
      d.bullets = (d.bullets || []).map((s) => String(s).trim()).filter(Boolean);
      d.tip = (d.tip || "").toString().trim() || null;
    } else if (type === "fil") {
      d.name = (d.name || "").trim();
      d.meta = (d.meta || "").trim();
      d.ext = (d.ext || "").trim();
    } else if (type === "tabell") {
      d.title = (d.title || "").trim();
      d.source = (d.source || "").trim();
      d.columns = (d.columns && d.columns.length === 3 ? d.columns : ["Kolonne 1", "Kolonne 2", "Kolonne 3"]).map((c, i) => (c || `Kolonne ${i + 1}`).trim() || `Kolonne ${i + 1}`);
      d.rows = (d.rows || []).map((r) => ({ a: (r.a || "").trim(), b: (r.b || "").trim(), c: (r.c || "").trim() }));
    } else if (type === "gevinst") {
      d.heading = (d.heading || "Dette kan du tjene").trim();
      d.note = (d.note || "").trim();
      d.gains = (d.gains || []).map((g) => {
        const out = { label: (g.label || "").trim(), amountKr: Number(g.amountKr) || 0 };
        const txt = (g.displayText || "").trim();
        if (txt) out.displayText = txt;
        return out;
      });
    } else if (type === "poll") {
      d.question = (d.question || "").trim();
      d.options = (d.options || []).filter((o) => (o.label || "").trim()).map((o) => ({ label: o.label.trim(), votes: Number(o.votes) || 0 }));
    } else if (type === "triks") {
      d.gameId = d.gameId || null;
      d.title = (d.title || "").trim();
      d.intro = (d.intro || "").trim();
      d.href = (d.href || "").trim() || null;
    } else if (type === "bilde") {
      d.url = d.url || null;
      d.alt = (d.alt || "").trim();
      d.caption = (d.caption || "").trim();
      d.size = d.size === "medium" ? "medium" : "full";
    }
    return d;
  }

  function gevinstSum(d) { return (d.gains || []).reduce((s, g) => s + (Number(g.amountKr) || 0), 0); }

  // Kort oppsummering av en modul, brukt i slette-bekreftelsen og i
  // modul-headeren slik at admin ser hvilken modul en knapp gjelder.
  function moduleSummary(m) {
    const label = moduleTOCLabel(m);
    return label || (MODULE_LABELS[m.type] || m.type);
  }

  // =====================================================================
  // State
  // =====================================================================
  const state = {
    isAdmin: false,
    filter: "Alle",
    guideDraft: null,      // guide-info-skjemaet (nytt eller redigering av eksisterende)
    moduleDraft: null,     // modul-skjemaet på guide.html
    addPickerOpen: false,
    addPickerIndex: null,  // hvor i lista den nye modulen skal settes inn (null = til slutt)
    previewMode: false,    // admin ser siden akkurat slik en besøkende gjør
    saving: false,         // hindrer dobbelttrykk på lagre-knappene
  };
  let currentGuideId = null;

  // Admin-kontrollene skjules i forhåndsvisningsmodus, men admin beholder
  // fortsatt tilgang til skjulte guider (visibleGuides under).
  function canEdit() { return state.isAdmin && !state.previewMode; }

  // Snapshot av skjemaet slik det så ut da det ble åpnet, slik at vi bare
  // maser om ulagrede endringer når noe faktisk er endret.
  function draftSnapshot(draft) {
    if (!draft) return null;
    const { uploadBusy, ...rest } = draft;
    return JSON.stringify(rest);
  }
  function markPristine(draft) {
    if (draft) draft.pristine = draftSnapshot(Object.assign({}, draft, { pristine: undefined }));
    return draft;
  }
  function isDirty(draft) {
    if (!draft) return false;
    return draftSnapshot(Object.assign({}, draft, { pristine: undefined })) !== draft.pristine;
  }
  function hasUnsavedChanges() { return isDirty(state.guideDraft) || isDirty(state.moduleDraft); }

  // Brukes før man åpner et annet skjema, forhåndsviser eller forlater siden.
  function confirmDiscard() {
    if (!hasUnsavedChanges()) return true;
    return window.confirm("Du har endringer som ikke er lagret. Vil du forkaste dem?");
  }

  function emptyGuideDraft() {
    return markPristine({ id: null, tempId: "new-" + Date.now(), title: "", category: "", excerpt: "", valueLabel: "", coverUrl: null, featured: false, uploadBusy: false });
  }
  function guideDraftFrom(g) {
    return markPristine({ id: g.id, tempId: g.id, title: g.title, category: g.category, excerpt: g.excerpt, valueLabel: g.valueLabel, coverUrl: g.coverUrl, featured: g.featured, hidden: g.hidden, uploadBusy: false });
  }
  function getCurrentGuide() { return Guides.list().find((g) => g.id === currentGuideId) || null; }
  // Skjulte guider (g.hidden) er bare synlige for admin – brukes på guider.html
  // (oversikten) og for å blokkere direkte lenker på guide.html.
  function visibleGuides() { return state.isAdmin ? Guides.list() : Guides.list().filter((g) => !g.hidden); }

  // =====================================================================
  // Guide-info-skjema (delt mellom "+ Ny guide" og "Rediger guide-info")
  // =====================================================================
  // Felles bilde-opplaster: stort felt der bildet selv er kontrollen, i stedet
  // for en tekstknapp ved siden av en liten miniatyr. Støtter både klikk og
  // dra-og-slipp (se "drop"-lytteren nederst i fila).
  function dropzoneHTML(o) {
    const has = !!o.url;
    return `
      <div class="guide-dropzone${has ? " has-image" : ""}${o.busy ? " is-busy" : ""}" style="--dz-ratio:${o.ratio || "16 / 9"}">
        <label class="guide-dropzone-target">
          ${has ? `<img src="${escapeHTML(o.url)}" alt="">` : `
            <span class="guide-dropzone-empty">
              ${icon("image", 26)}
              <strong>Slipp et bilde her, eller klikk for å velge</strong>
              <small>${escapeHTML(o.hint || "")}</small>
            </span>`}
          ${o.busy ? `<span class="guide-dropzone-busy">Laster opp …</span>` : ""}
          <input type="file" accept="image/png,image/jpeg,image/webp" ${o.uploadAttr} ${o.busy ? "disabled" : ""}>
        </label>
        ${has ? `
          <div class="guide-dropzone-actions">
            <label class="guide-action-btn">
              ${icon("image", 15)}<span>Bytt bilde</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" ${o.uploadAttr} ${o.busy ? "disabled" : ""} hidden>
            </label>
            ${o.removeAttr ? `<button type="button" class="guide-action-btn is-danger" ${o.removeAttr}>${icon("trash", 15)}<span>Fjern</span></button>` : ""}
          </div>` : ""}
      </div>
    `;
  }

  // Live-forhåndsvisning av kortet slik det vil se ut på guider.html. Gjør at
  // man ser konsekvensen av tittel, ingress, bilde og "mengde spart" med én
  // gang, i stedet for å måtte lagre og gå tilbake til oversikten.
  function guideCardPreviewHTML(draft) {
    return `
      <div class="guide-preview-pane">
        <span class="guide-form-legend">Slik ser kortet ut</span>
        <div class="guide-card guide-card-preview${draft.hidden ? " is-hidden-guide" : ""}">
          <span class="guide-card-thumb">
            ${draft.coverUrl ? `<img class="guide-card-thumb-img" src="${escapeHTML(draft.coverUrl)}" alt="">` : `<span class="guide-card-thumb-slot">${icon("image", 20)}</span>`}
            <span class="guide-card-gradient"></span>
            <h3 class="guide-card-title">${escapeHTML(draft.title) || '<span class="is-placeholder">Overskriften din havner her</span>'}</h3>
          </span>
          ${draft.hidden ? `<span class="guide-status-badge is-hidden">${icon("eyeOff", 13)}Skjult</span>` : ""}
          ${draft.featured ? `<span class="guide-status-badge is-featured">Fremhevet</span>` : ""}
          <div class="guide-card-body">
            <p class="guide-card-excerpt">${escapeHTML(draft.excerpt) || '<span class="is-placeholder">Ingressen vises her.</span>'}</p>
            <div class="guide-card-foot">
              <span class="guide-card-value">${escapeHTML(draft.valueLabel) || '<span class="is-placeholder">Mengde spart/tjent</span>'}</span>
            </div>
          </div>
        </div>
        <span class="guide-field-hint">${draft.category
          ? `Ligger under filteret <strong>${escapeHTML(draft.category)}</strong>.`
          : "Uten kategori vises guiden bare under «Alle»."}</span>
      </div>
    `;
  }

  function guideFormHTML(draft, opts) {
    opts = opts || {};
    const cats = Array.from(new Set(Guides.list().map((g) => g.category).filter(Boolean)));
    return `
      <div class="admin-card guide-form">
        <div class="guide-form-head">
          <span class="guide-form-title">${icon(opts.isNew ? "plus" : "edit", 17)}${opts.isNew ? "Ny guide" : "Rediger guide-info"}</span>
          <button type="button" class="guide-form-close" data-gf-cancel aria-label="Lukk skjemaet">${icon("x", 16)}</button>
        </div>

        <div class="guide-form-layout">
          <div class="guide-form-body">
            <section class="guide-form-section">
              <span class="guide-form-legend">Overskrift og ingress</span>
              <label class="admin-field is-wide">Overskrift
                <input type="text" class="is-title-input" data-gf="title" value="${escapeHTML(draft.title)}" placeholder="Hvordan tjene penger på å sitte i elevrådet">
              </label>
              <label class="admin-field is-wide">Ingress
                <textarea data-gf="excerpt" rows="3" maxlength="300" placeholder="Kort beskrivelse av hva leseren sitter igjen med">${escapeHTML(draft.excerpt)}</textarea>
                <span class="guide-field-hint"><span data-gf-count="excerpt">${(draft.excerpt || "").length}</span>/300 tegn · brukes også i Google-treffet.</span>
              </label>
            </section>

            <section class="guide-form-section">
              <span class="guide-form-legend">Toppbilde</span>
              ${dropzoneHTML({
                url: draft.coverUrl, busy: draft.uploadBusy, uploadAttr: "data-gf-upload",
                removeAttr: draft.coverUrl ? "data-gf-remove-cover" : null, ratio: "16 / 9",
                hint: "PNG, JPG eller WEBP · maks 5 MB · best i 16:9",
              })}
            </section>

            <section class="guide-form-section">
              <span class="guide-form-legend">Kategori</span>
              ${cats.length ? `<div class="guide-choice-row">
                ${cats.map((c) => `<button type="button" class="guide-choice${draft.category === c ? " is-active" : ""}" data-gf-choice="category" data-value="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("")}
                ${draft.category ? `<button type="button" class="guide-choice is-clear" data-gf-choice="category" data-value="">${icon("x", 13)}Ingen</button>` : ""}
              </div>` : ""}
              <label class="admin-field is-wide">${cats.length ? "… eller skriv en ny" : "Kategori"}
                <input type="text" data-gf="category" value="${escapeHTML(draft.category)}" placeholder="F.eks. Elevrådet">
                <span class="guide-field-hint">Kategorien blir en filterknapp på oversikten.</span>
              </label>
            </section>

            <section class="guide-form-section">
              <span class="guide-form-legend">Mengde spart eller tjent</span>
              <div class="guide-choice-row">
                ${["Opptil 5 000 kr", "Opptil 12 000 kr", "Spar timer i uka"].map((v) => `
                  <button type="button" class="guide-choice${draft.valueLabel === v ? " is-active" : ""}" data-gf-choice="valueLabel" data-value="${escapeHTML(v)}">${escapeHTML(v)}</button>
                `).join("")}
              </div>
              <label class="admin-field is-wide">Egen tekst
                <input type="text" data-gf="valueLabel" value="${escapeHTML(draft.valueLabel)}" placeholder="F.eks. Opptil 12 000 kr">
                <span class="guide-field-hint">Den grønne teksten nederst på kortet.</span>
              </label>
            </section>

            ${opts.isNew ? "" : `
            <section class="guide-form-section">
              <span class="guide-form-legend">Synlighet</span>
              <div class="guide-toggle-list">
                <div class="guide-toggle-row${draft.featured ? " is-on" : ""}">
                  <button type="button" class="admin-switch${draft.featured ? " is-on" : ""}" data-gf-toggle="featured" role="switch" aria-checked="${draft.featured ? "true" : "false"}" aria-label="Vis som fremhevet guide">
                    <span class="admin-switch-track"></span><span class="admin-switch-knob"></span>
                  </button>
                  <span class="guide-toggle-text">
                    <strong>Fremhev øverst på oversikten</strong>
                    <small>Kun én guide kan være fremhevet om gangen.</small>
                  </span>
                </div>
                <div class="guide-toggle-row is-warn${draft.hidden ? " is-on" : ""}">
                  <button type="button" class="admin-switch is-warn${draft.hidden ? " is-on" : ""}" data-gf-toggle="hidden" role="switch" aria-checked="${draft.hidden ? "true" : "false"}" aria-label="Skjul guiden for besøkende">
                    <span class="admin-switch-track"></span><span class="admin-switch-knob"></span>
                  </button>
                  <span class="guide-toggle-text">
                    <strong>Skjul guiden</strong>
                    <small>${draft.hidden ? "Guiden er usynlig for besøkende – kun admin ser den." : "Guiden er publisert og synlig for alle."}</small>
                  </span>
                </div>
              </div>
            </section>`}
          </div>

          <aside class="guide-form-side">
            ${guideCardPreviewHTML(draft)}
          </aside>
        </div>

        <div class="guide-form-foot">
          <span class="guide-form-hint">Esc avbryter · ${cmdKeyLabel()} + S lagrer</span>
          <div class="admin-row-actions">
            <button type="button" class="btn-outline" data-gf-cancel>Avbryt</button>
            <button type="button" class="admin-btn-ghost is-accent" data-gf-save ${state.saving ? "disabled" : ""}>
              ${state.saving ? "Lagrer …" : (opts.isNew ? "Opprett guide" : "Lagre endringer")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function cmdKeyLabel() {
    return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
  }

  async function saveGuideDraft() {
    const d = state.guideDraft;
    if (!d || state.saving) return;
    const title = d.title.trim();
    if (!title) { flash("Guiden må ha en overskrift."); focusField('[data-gf="title"]'); return; }

    const fields = {
      title, category: d.category.trim(), excerpt: d.excerpt.trim(),
      valueLabel: d.valueLabel.trim(), coverUrl: d.coverUrl,
    };
    if (d.id !== null) { fields.featured = !!d.featured; fields.hidden = !!d.hidden; }

    state.saving = true;
    renderAll();
    try {
      if (d.id === null) {
        const { data, error } = await Guides.createGuide(fields);
        if (error) return flash(friendlyError(error));
        state.guideDraft = null;
        flash("Guide opprettet");
        window.location.href = `guide.html?id=${encodeURIComponent(data.id)}&edit=1`;
        return;
      }

      const { error } = await Guides.updateGuide(d.id, fields);
      if (error) return flash(friendlyError(error));
      state.guideDraft = null;
      flash("Guide-info lagret");
    } finally {
      state.saving = false;
      renderAll();
    }
  }

  // Rask av/på for synlighet, uten å måtte åpne hele guide-info-skjemaet.
  async function toggleGuideHidden(id) {
    const g = Guides.list().find((x) => x.id === id);
    if (!g || state.saving) return;
    const next = !g.hidden;
    state.saving = true;
    renderAll();
    const { error } = await Guides.updateGuide(id, { hidden: next });
    state.saving = false;
    if (error) { flash(friendlyError(error)); renderAll(); return; }
    if (state.guideDraft && state.guideDraft.id === id) state.guideDraft.hidden = next;
    flash(next ? "Guiden er skjult for besøkende" : "Guiden er publisert");
    renderAll();
  }

  async function deleteGuideFlow(id) {
    const g = Guides.list().find((x) => x.id === id);
    if (!g) return;
    const moduleCount = Guides.modulesFor(id).length;
    const extra = moduleCount ? `\n\nGuiden har ${moduleCount} modul${moduleCount === 1 ? "" : "er"} som slettes samtidig.` : "";
    if (!window.confirm(`Slette guiden «${g.title}»?${extra}\n\nDette kan ikke angres. Vil du heller skjule guiden, avbryt og bruk «Skjul» i stedet.`)) return;
    const { error } = await Guides.deleteGuide(id);
    if (error) return flash(friendlyError(error));
    flash("Guide slettet");
    if (isGuidePage && currentGuideId === id) { window.location.href = "guider.html"; return; }
    renderAll();
  }

  // Forhåndsvisningen av kortet oppdateres direkte i DOM mens man skriver.
  // Et fullt re-render ville flyttet markøren til slutten av tekstfeltet.
  function updateGuidePreview() {
    const d = state.guideDraft;
    const pane = document.querySelector(".guide-preview-pane");
    if (!d || !pane) return;
    const set = (sel, value, placeholder) => {
      const el = pane.querySelector(sel);
      if (!el) return;
      if (value) el.textContent = value;
      else el.innerHTML = `<span class="is-placeholder">${escapeHTML(placeholder)}</span>`;
    };
    set(".guide-card-title", d.title, "Overskriften din havner her");
    set(".guide-card-excerpt", d.excerpt, "Ingressen vises her.");
    set(".guide-card-value", d.valueLabel, "Mengde spart/tjent");
    const hint = pane.querySelector(".guide-field-hint");
    if (hint) {
      hint.innerHTML = d.category
        ? `Ligger under filteret <strong>${escapeHTML(d.category)}</strong>.`
        : "Uten kategori vises guiden bare under «Alle».";
    }
  }

  // Etter et re-render er DOM-noden byttet ut, så fokus må settes på nytt.
  function focusField(selector) {
    requestAnimationFrame(() => {
      const el = document.querySelector(selector);
      if (el) { el.focus(); if (el.select) el.select(); }
    });
  }

  async function onGuideCoverUpload(input) {
    const file = input.files[0];
    if (!file || !state.guideDraft) return;
    state.guideDraft.uploadBusy = true;
    renderAll();
    const path = state.guideDraft.id || state.guideDraft.tempId;
    const { data, error } = await Guides.uploadCover(path, file);
    state.guideDraft.uploadBusy = false;
    if (error) { flash(friendlyError(error)); renderAll(); return; }
    state.guideDraft.coverUrl = data;
    renderAll();
  }

  function removeGuideCover() {
    if (!state.guideDraft) return;
    state.guideDraft.coverUrl = null;
    renderAll();
  }

  // =====================================================================
  // guider.html – oversikt
  // =====================================================================
  function renderGuiderPage() {
    if (!isGuiderPage) return;
    renderFeature();
    renderFilters();
    renderGrid();
    const countEl = document.querySelector("[data-guide-count]");
    const list = visibleGuides();
    if (countEl) countEl.textContent = `${list.length} guide${list.length === 1 ? "" : "r"}`;
    const newBtn = document.querySelector("[data-guide-new]");
    if (newBtn) newBtn.hidden = !canEdit();
  }

  function renderFeature() {
    const el = document.querySelector("[data-guide-feature]");
    if (!el) return;
    const list = visibleGuides();
    const featured = list.find((g) => g.featured) || list[0];

    if (!featured) {
      el.innerHTML = state.isAdmin
        ? `<div class="admin-card" style="align-items:center;text-align:center;padding:48px 24px">
             <h2 style="margin:0 0 8px">Ingen guider ennå</h2>
             <p class="section-sub" style="margin:0 0 16px">Opprett den første guiden for å komme i gang.</p>
             <button type="button" class="btn-primary" data-guide-new-inline>+ Ny guide</button>
           </div>`
        : "";
      return;
    }

    const metaBits = [featured.updatedAt ? `Oppdatert ${formatDate(featured.updatedAt)}` : ""].filter(Boolean).join(" · ");
    el.innerHTML = `
      <div class="guide-feature">
        <div class="guide-feature-text">
          <span class="guide-feature-badge">Anbefalt guide</span>
          <h2>${escapeHTML(featured.title)}</h2>
          <p>${escapeHTML(featured.excerpt)}</p>
          <div class="guide-feature-actions">
            <a href="guide.html?id=${encodeURIComponent(featured.id)}" class="btn-primary btn-link">Les guiden</a>
            ${metaBits ? `<span class="section-sub">${escapeHTML(metaBits)}</span>` : ""}
          </div>
        </div>
        <div class="guide-feature-media">
          ${featured.coverUrl ? `<img src="${escapeHTML(featured.coverUrl)}" alt="">` : `<span class="hero-placeholder-label">[ guide-bilde 16:10 ]</span>`}
        </div>
      </div>
    `;
  }

  function renderFilters() {
    const el = document.querySelector("[data-guide-filters]");
    if (!el) return;
    const cats = ["Alle", ...Array.from(new Set(visibleGuides().map((g) => g.category).filter(Boolean)))];
    if (!cats.includes(state.filter)) state.filter = "Alle";
    el.innerHTML = cats.map((c) => `<button type="button" class="guide-filter-pill${c === state.filter ? " is-active" : ""}" data-guide-filter="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  }

  function guideCardHTML(g) {
    if (state.guideDraft && state.guideDraft.id === g.id) {
      return `<div class="guide-card is-editing">${guideFormHTML(state.guideDraft, { isNew: false })}</div>`;
    }
    const admin = canEdit();
    const isHidden = !!g.hidden;
    return `
      <div class="guide-card${isHidden && admin ? " is-hidden-guide" : ""}">
        <a href="guide.html?id=${encodeURIComponent(g.id)}" class="guide-card-thumb">
          ${g.coverUrl ? `<img class="guide-card-thumb-img" src="${escapeHTML(g.coverUrl)}" alt="">` : `<span class="guide-card-thumb-slot">${icon("image", 20)}</span>`}
          <div class="guide-card-gradient"></div>
          <h3 class="guide-card-title">${escapeHTML(g.title)}</h3>
        </a>
        ${isHidden && admin ? `<span class="guide-status-badge is-hidden">${icon("eyeOff", 13)}Skjult</span>` : ""}
        ${g.featured && admin ? `<span class="guide-status-badge is-featured">Fremhevet</span>` : ""}
        <div class="guide-card-body">
          <p class="guide-card-excerpt">${escapeHTML(g.excerpt)}</p>
          <div class="guide-card-foot">
            <span class="guide-card-value">${escapeHTML(g.valueLabel)}</span>
          </div>
          ${admin ? `
          <div class="guide-card-admin-bar">
            <button type="button" class="guide-action-btn" data-guide-card-edit="${escapeHTML(g.id)}">
              ${icon("edit", 15)}<span>Rediger</span>
            </button>
            <button type="button" class="guide-action-btn${isHidden ? " is-warn" : ""}" data-guide-card-hide="${escapeHTML(g.id)}">
              ${icon(isHidden ? "eye" : "eyeOff", 15)}<span>${isHidden ? "Publiser" : "Skjul"}</span>
            </button>
            <button type="button" class="guide-action-btn is-danger" data-guide-card-delete="${escapeHTML(g.id)}">
              ${icon("trash", 15)}<span>Slett</span>
            </button>
          </div>` : ""}
        </div>
      </div>
    `;
  }

  function renderGrid() {
    const el = document.querySelector("[data-guide-grid]");
    if (!el) return;
    const list = visibleGuides().filter((g) => state.filter === "Alle" || g.category === state.filter);
    const newCardHTML = (state.guideDraft && state.guideDraft.id === null)
      ? `<div class="guide-card is-editing">${guideFormHTML(state.guideDraft, { isNew: true })}</div>`
      : "";

    if (!list.length && !newCardHTML) {
      el.innerHTML = `<div class="guide-empty section-sub">Ingen guider i denne kategorien ennå.</div>`;
      return;
    }
    el.innerHTML = newCardHTML + list.map(guideCardHTML).join("");
  }

  // =====================================================================
  // guide.html – én guide
  // =====================================================================
  function addModulePickerHTML(atIndex) {
    const isInline = atIndex !== null && atIndex !== undefined;
    const openHere = state.addPickerOpen && state.addPickerIndex === (isInline ? atIndex : null);
    const draftHere = state.moduleDraft && state.moduleDraft.isNew
      && state.moduleDraft.insertIndex === (isInline ? atIndex : null);

    if (draftHere) return moduleEditorHTML(state.moduleDraft);

    if (!openHere) {
      return isInline
        ? `<button type="button" class="guide-insert-btn" data-guide-add-open="${atIndex}" aria-label="Sett inn modul her">${icon("plus", 14)}<span>Sett inn modul her</span></button>`
        : `<button type="button" class="guide-add-btn" data-guide-add-open="end">${icon("plus", 17)}Legg til modul</button>`;
    }

    return `
      <div class="guide-add-picker">
        <div class="guide-add-picker-head">
          <span class="guide-add-picker-label">Hva vil du legge til${isInline ? " her" : ""}?</span>
          <button type="button" class="guide-form-close" data-guide-add-close aria-label="Avbryt">${icon("x", 15)}</button>
        </div>
        <div class="guide-add-picker-options">
          ${MODULE_TYPES.map(([t, label, desc]) => `
            <button type="button" class="guide-type-card" data-guide-add-type="${t}" data-guide-add-index="${isInline ? atIndex : ""}">
              <span class="guide-type-icon">${icon(MODULE_ICONS[t] || "text", 18)}</span>
              <span class="guide-type-text">
                <strong>${escapeHTML(label)}</strong>
                <small>${escapeHTML(desc)}</small>
              </span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function moduleTOCLabel(m) {
    switch (m.type) {
      case "tekst": return m.data.heading || null;
      case "fil": return m.data.name || "Nedlasting";
      case "tabell": return m.data.title || "Tabell";
      case "gevinst": return m.data.heading || "Gevinst";
      case "poll": return m.data.question || "Avstemning";
      case "triks": {
        const game = m.data.gameId ? (window.STUDILLA_GAMES || []).find((x) => x.id === m.data.gameId) : null;
        return (game && game.name) || m.data.title || "Triks";
      }
      // Bilder får ingen oppføring i innholdsfortegnelsen – de hører til
      // avsnittet over, og ville bare fylt lista med "Bilde"-lenker.
      case "bilde": return null;
      default: return null;
    }
  }

  function tekstBodyHTML(d) {
    const HTag = d.headingLevel === 3 ? "h3" : "h2";
    const paragraphs = String(d.body || "").split(/\n{2,}/).filter(Boolean);
    return `
      <div class="guide-text-block">
        ${d.heading ? `<${HTag} class="guide-text-heading is-h${d.headingLevel === 3 ? 3 : 2}">${escapeHTML(d.heading)}</${HTag}>` : ""}
        ${paragraphs.map((p) => `<p class="guide-text-p">${nl2br(p)}</p>`).join("")}
        ${(d.bullets || []).length ? `<ul class="guide-text-list">${d.bullets.map((b) => `<li>${escapeHTML(b)}</li>`).join("")}</ul>` : ""}
        ${d.tip ? `<blockquote class="guide-tip-box"><strong>Tips:</strong> ${escapeHTML(d.tip)}</blockquote>` : ""}
      </div>
    `;
  }

  function filBodyHTML(d) {
    return `
      <div class="guide-file-card">
        <span class="guide-file-badge">${escapeHTML(d.ext || "FIL")}</span>
        <div class="guide-file-info">
          <span class="guide-file-name">${escapeHTML(d.name || "Fil")}</span>
          <span class="guide-file-meta">${escapeHTML(d.meta || "")}</span>
        </div>
        ${d.url
          ? `<a href="${escapeHTML(d.url)}" download class="btn-primary guide-file-btn">Last ned</a>`
          : `<span class="guide-file-missing">${state.isAdmin ? "Ingen fil lastet opp ennå" : "Utilgjengelig"}</span>`}
      </div>
    `;
  }

  function tabellBodyHTML(d) {
    const cols = (d.columns && d.columns.length === 3) ? d.columns : ["Kolonne 1", "Kolonne 2", "Kolonne 3"];
    return `
      ${d.title ? `<h3 class="guide-table-title">${escapeHTML(d.title)}</h3>` : ""}
      <div class="guide-table-wrap">
        <table class="guide-table">
          <thead><tr>${cols.map((c) => `<th>${escapeHTML(c)}</th>`).join("")}</tr></thead>
          <tbody>${(d.rows || []).map((r) => `<tr><td>${escapeHTML(r.a)}</td><td>${escapeHTML(r.b)}</td><td class="is-num">${escapeHTML(r.c)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      ${d.source ? `<span class="guide-table-source">${escapeHTML(d.source)}</span>` : ""}
    `;
  }

  function gevinstBodyHTML(d) {
    const sum = gevinstSum(d);
    const perMonth = Math.round(sum / 10 / 50) * 50;
    return `
      <div class="guide-gevinst">
        <div class="guide-gevinst-total">
          <span class="guide-gevinst-label">${escapeHTML(d.heading || "Dette kan du tjene")}</span>
          <span class="guide-gevinst-amount">${kr(sum)}</span>
          ${d.note ? `<span class="guide-gevinst-note">${escapeHTML(d.note)}</span>` : ""}
          ${sum > 0 ? `<span class="guide-gevinst-permonth">≈ ${kr(perMonth)} / mnd</span>` : ""}
        </div>
        <div class="guide-gevinst-rows">
          ${(d.gains || []).map((g) => `
            <div class="guide-gevinst-row">
              <span>${escapeHTML(g.label)}</span>
              <span>${g.amountKr ? kr(g.amountKr) : escapeHTML(g.displayText || "–")}</span>
            </div>
          `).join("")}
          <div class="guide-gevinst-row is-sum"><span>Sum</span><span>${kr(sum)}</span></div>
        </div>
      </div>
    `;
  }

  function pollVotedKey(moduleId) { return `studilla_guide_poll_${moduleId}`; }

  function pollBodyHTML(m) {
    const d = m.data;
    const votedRaw = localStorage.getItem(pollVotedKey(m.id));
    const voted = votedRaw === null ? null : Number(votedRaw);
    const options = d.options || [];
    const total = options.reduce((s, o) => s + (Number(o.votes) || 0), 0);

    return `
      <div class="guide-poll">
        <h3 class="guide-poll-question">${escapeHTML(d.question || "")}</h3>
        <span class="guide-poll-footer">${voted === null ? `${numFmt(total)} har svart · velg ett alternativ` : `Takk for svaret! ${numFmt(total)} har svart`}</span>
        <div class="guide-poll-options">
          ${options.map((o, i) => {
            const pct = total ? Math.round(((Number(o.votes) || 0) / total) * 100) : 0;
            const isMine = voted === i;
            return `
              <button type="button" class="guide-poll-option${isMine ? " is-mine" : ""}" data-poll-vote data-module="${escapeHTML(String(m.id))}" data-option="${i}" ${voted !== null ? "disabled" : ""}>
                <span class="guide-poll-option-fill" style="width:${voted === null ? 0 : pct}%"></span>
                <span class="guide-poll-option-row">
                  <span class="guide-poll-option-dot"></span>
                  <span class="guide-poll-option-label">${escapeHTML(o.label)}</span>
                  <span class="guide-poll-option-pct">${voted === null ? "" : pct + " %"}</span>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function triksBodyHTML(d) {
    const game = d.gameId ? (window.STUDILLA_GAMES || []).find((x) => x.id === d.gameId) : null;
    const title = game ? game.name : (d.title || "Triks");
    const intro = d.intro || (game ? game.description : "") || "";
    const href = game ? `player.html?id=${encodeURIComponent(game.id)}` : d.href;
    const thumb = game && game.thumbnail;

    const inner = `
      <div class="guide-trick-thumb">${thumb ? `<img src="${escapeHTML(thumb)}" alt="">` : `<span class="hero-placeholder-label">[ triks-bilde ]</span>`}</div>
      <div class="guide-trick-body">
        <span class="guide-trick-title">${escapeHTML(title)}</span>
        ${intro ? `<span class="guide-trick-intro">${escapeHTML(intro)}</span>` : ""}
        <span class="guide-trick-cta">Spill trikset →</span>
      </div>
    `;
    return href
      ? `<a class="guide-trick-card" href="${escapeHTML(href)}">${inner}</a>`
      : `<div class="guide-trick-card is-static">${inner}</div>`;
  }

  function bildeBodyHTML(d) {
    if (!d.url) {
      return `<div class="guide-image-block is-empty">${icon("image", 22)}<span>${state.isAdmin ? "Ingen fil lastet opp ennå" : ""}</span></div>`;
    }
    return `
      <figure class="guide-image-block${d.size === "medium" ? " is-medium" : ""}">
        <img src="${escapeHTML(d.url)}" alt="${escapeHTML(d.alt || "")}" loading="lazy">
        ${d.caption ? `<figcaption>${escapeHTML(d.caption)}</figcaption>` : ""}
      </figure>
    `;
  }

  function moduleBodyHTML(m) {
    switch (m.type) {
      case "bilde": return bildeBodyHTML(m.data);
      case "tekst": return tekstBodyHTML(m.data);
      case "fil": return filBodyHTML(m.data);
      case "tabell": return tabellBodyHTML(m.data);
      case "gevinst": return gevinstBodyHTML(m.data);
      case "poll": return pollBodyHTML(m);
      case "triks": return triksBodyHTML(m.data);
      default: return "";
    }
  }

  function moduleBlockHTML(m, index, total) {
    const isEditing = state.moduleDraft && !state.moduleDraft.isNew && state.moduleDraft.id === m.id;
    const idAttr = escapeHTML(String(m.id));
    const admin = canEdit();

    const moduleHead = admin ? `
      <div class="guide-module-head">
        <span class="guide-module-eyebrow">
          <span class="guide-module-num">${index + 1}</span>
          ${icon(MODULE_ICONS[m.type] || "text", 14)}
          ${escapeHTML(MODULE_LABELS[m.type] || m.type)}
        </span>
        <div class="guide-module-divider"></div>
        <div class="guide-module-toolbar">
          <span class="guide-move-group">
            <button type="button" class="guide-icon-btn" data-module-up="${idAttr}" ${index === 0 ? "disabled" : ""} title="Flytt opp" aria-label="Flytt modulen opp">${icon("up", 15)}</button>
            <button type="button" class="guide-icon-btn" data-module-down="${idAttr}" ${index === total - 1 ? "disabled" : ""} title="Flytt ned" aria-label="Flytt modulen ned">${icon("down", 15)}</button>
          </span>
          <button type="button" class="guide-action-btn${isEditing ? " is-active" : ""}" data-module-edit="${idAttr}" aria-label="Rediger modulen">
            ${icon("edit", 15)}<span>${isEditing ? "Redigerer" : "Rediger"}</span>
          </button>
          <button type="button" class="guide-action-btn is-danger" data-module-delete="${idAttr}" aria-label="Slett modulen">
            ${icon("trash", 15)}<span>Slett</span>
          </button>
        </div>
      </div>
    ` : "";

    return `
      <section class="guide-module${admin ? " is-editable" : ""}${isEditing ? " is-editing" : ""}" id="module-${idAttr}">
        ${moduleHead}
        ${isEditing ? moduleEditorHTML(state.moduleDraft) : moduleBodyHTML(m)}
      </section>
    `;
  }

  // ---- modul-redigeringsskjemaer ----
  function tekstEditorHTML(d) {
    return `
      <div class="admin-row-detail" style="padding:0;border:none">
        <label class="admin-field is-wide">Overskrift (valgfri)
          <input type="text" data-mf="heading" value="${escapeHTML(d.heading || "")}">
        </label>
        <label class="admin-field">Overskriftsnivå
          <select data-mf="headingLevel">
            <option value="2" ${d.headingLevel !== 3 ? "selected" : ""}>Stor (H2)</option>
            <option value="3" ${d.headingLevel === 3 ? "selected" : ""}>Liten (H3)</option>
          </select>
        </label>
        <label class="admin-field is-wide">Brødtekst (blank linje = nytt avsnitt)
          <textarea data-mf="body" rows="5">${escapeHTML(d.body || "")}</textarea>
        </label>
        <label class="admin-field is-wide">Punktliste (én linje per punkt, valgfri)
          <textarea data-mf="bullets" rows="3">${escapeHTML((d.bullets || []).join("\n"))}</textarea>
        </label>
        <label class="admin-field is-wide">Tips-boks (valgfri)
          <textarea data-mf="tip" rows="2">${escapeHTML(d.tip || "")}</textarea>
        </label>
      </div>
    `;
  }

  function filEditorHTML(draft) {
    const d = draft.data;
    return `
      <div class="admin-row-detail" style="padding:0;border:none">
        <label class="admin-field is-wide">Filnavn (vises til brukeren)
          <input type="text" data-mf="name" value="${escapeHTML(d.name || "")}" placeholder="F.eks. Budsjettmal for elevrådet">
        </label>
        <label class="admin-field is-wide">Beskrivelse
          <input type="text" data-mf="meta" value="${escapeHTML(d.meta || "")}" placeholder="F.eks. Regneark · 42 kB">
        </label>
        <label class="admin-field is-wide">Fil
          <span class="admin-upload-row">
            <label class="admin-upload-btn${draft.uploadBusy ? " is-busy" : ""}">
              ${draft.uploadBusy ? "Laster opp …" : (d.url ? "Bytt fil" : "Last opp fil")}
              <input type="file" data-mod-file-upload ${draft.uploadBusy ? "disabled" : ""}>
            </label>
            ${d.url ? `<span class="guide-file-uploaded">✓ ${escapeHTML(d.ext || "fil")} lastet opp</span>` : ""}
          </span>
        </label>
      </div>
    `;
  }

  function tabellEditorHTML(d) {
    const cols = (d.columns && d.columns.length === 3) ? d.columns : ["Kolonne 1", "Kolonne 2", "Kolonne 3"];
    const rows = d.rows || [];
    return `
      <div class="admin-row-detail" style="padding:0;border:none">
        <label class="admin-field is-wide">Tittel
          <input type="text" data-mf="title" value="${escapeHTML(d.title || "")}">
        </label>
        <label class="admin-field">Kolonne 1
          <input type="text" data-col="0" value="${escapeHTML(cols[0])}">
        </label>
        <label class="admin-field">Kolonne 2
          <input type="text" data-col="1" value="${escapeHTML(cols[1])}">
        </label>
        <label class="admin-field">Kolonne 3
          <input type="text" data-col="2" value="${escapeHTML(cols[2])}">
        </label>
        <label class="admin-field is-wide">Kilde (valgfri)
          <input type="text" data-mf="source" value="${escapeHTML(d.source || "")}">
        </label>
      </div>
      <div class="guide-row-editor">
        <span class="guide-form-legend">Rader</span>
        ${rows.length ? `<div class="guide-row-editor-legend">
          <span>${escapeHTML(cols[0])}</span><span>${escapeHTML(cols[1])}</span><span>${escapeHTML(cols[2])}</span><span class="is-spacer"></span>
        </div>` : `<span class="guide-field-hint">Ingen rader ennå.</span>`}
        ${rows.map((r, i) => `
          <div class="guide-row-editor-row">
            <input type="text" placeholder="Kolonne 1" data-row-list="rows" data-row-index="${i}" data-row-field="a" value="${escapeHTML(r.a || "")}">
            <input type="text" placeholder="Kolonne 2" data-row-list="rows" data-row-index="${i}" data-row-field="b" value="${escapeHTML(r.b || "")}">
            <input type="text" placeholder="Kolonne 3" data-row-list="rows" data-row-index="${i}" data-row-field="c" value="${escapeHTML(r.c || "")}">
            <button type="button" class="guide-icon-btn is-danger" data-row-remove="rows" data-row-index="${i}" title="Fjern rad">✕</button>
          </div>
        `).join("")}
        <button type="button" class="admin-btn-text" data-row-add="rows">+ Legg til rad</button>
      </div>
    `;
  }

  function gevinstEditorHTML(d) {
    const gains = d.gains || [];
    return `
      <div class="admin-row-detail" style="padding:0;border:none">
        <label class="admin-field">Overskrift
          <input type="text" data-mf="heading" value="${escapeHTML(d.heading || "Dette kan du tjene")}">
        </label>
        <label class="admin-field is-wide">Undertekst (valgfri)
          <input type="text" data-mf="note" value="${escapeHTML(d.note || "")}" placeholder="F.eks. per skoleår, som leder med full dekning">
        </label>
      </div>
      <div class="guide-row-editor">
        <span class="guide-form-legend">Poster</span>
        ${gains.length ? "" : `<span class="guide-field-hint">Legg til minst én post – summen regnes ut automatisk.</span>`}
        ${gains.map((g, i) => `
          <div class="guide-row-editor-row">
            <input type="text" placeholder="Beskrivelse" data-row-list="gains" data-row-index="${i}" data-row-field="label" value="${escapeHTML(g.label || "")}">
            <input type="number" placeholder="Beløp (kr)" data-row-list="gains" data-row-index="${i}" data-row-field="amountKr" value="${g.amountKr || 0}" min="0" step="1" style="max-width:130px">
            <input type="text" placeholder="Egen tekst i stedet for beløp (valgfri)" data-row-list="gains" data-row-index="${i}" data-row-field="displayText" value="${escapeHTML(g.displayText || "")}">
            <button type="button" class="guide-icon-btn is-danger" data-row-remove="gains" data-row-index="${i}" title="Fjern">✕</button>
          </div>
        `).join("")}
        <button type="button" class="admin-btn-text" data-row-add="gains">+ Legg til post</button>
      </div>
    `;
  }

  function pollEditorHTML(d) {
    const options = d.options || [];
    return `
      <div class="admin-row-detail" style="padding:0;border:none">
        <label class="admin-field is-wide">Spørsmål
          <input type="text" data-mf="question" value="${escapeHTML(d.question || "")}">
        </label>
      </div>
      <div class="guide-row-editor">
        <span class="guide-form-legend">Svaralternativer</span>
        ${options.map((o, i) => `
          <div class="guide-row-editor-row">
            <input type="text" placeholder="Svaralternativ" data-row-list="options" data-row-index="${i}" data-row-field="label" value="${escapeHTML(o.label || "")}">
            <span class="guide-row-votes">${o.votes || 0} stemmer</span>
            <button type="button" class="guide-icon-btn is-danger" data-row-remove="options" data-row-index="${i}" title="Fjern" ${options.length <= 2 ? "disabled" : ""}>✕</button>
          </div>
        `).join("")}
        <button type="button" class="admin-btn-text" data-row-add="options">+ Legg til alternativ</button>
      </div>
    `;
  }

  function triksEditorHTML(d) {
    const games = window.STUDILLA_GAMES || [];
    const usingGame = !!d.gameId;
    const game = usingGame ? games.find((g) => g.id === d.gameId) : null;
    return `
      <div class="guide-form-section">
        <span class="guide-form-legend">Hva skal kortet lenke til?</span>
        <div class="guide-form-grid">
          <label class="admin-field is-wide">Triks på Studilla
            <select data-mf="gameId" data-mod-game-select>
              <option value="" ${!usingGame ? "selected" : ""}>— Egendefinert lenke —</option>
              ${games.map((g) => `<option value="${escapeHTML(g.id)}" ${d.gameId === g.id ? "selected" : ""}>${escapeHTML(g.name)}</option>`).join("")}
            </select>
            <span class="guide-field-hint">${games.length
              ? "Velger du et triks henter kortet navn, bilde og beskrivelse automatisk."
              : "Fant ingen triks å velge mellom – bruk en egendefinert lenke."}</span>
          </label>
          ${usingGame ? `
          <div class="admin-field is-wide">Valgt triks
            <div class="guide-picked-game">
              ${game && game.thumbnail ? `<img src="${escapeHTML(game.thumbnail)}" alt="">` : `<span class="guide-picked-game-slot">${icon("game", 18)}</span>`}
              <span class="guide-picked-game-name">${escapeHTML((game && game.name) || d.gameId)}</span>
            </div>
          </div>` : `
          <label class="admin-field is-wide">Tittel
            <input type="text" data-mf="title" value="${escapeHTML(d.title || "")}" placeholder="F.eks. Budsjett-byggeren">
          </label>
          <label class="admin-field is-wide">Lenke (URL)
            <input type="text" data-mf="href" value="${escapeHTML(d.href || "")}" placeholder="https://…">
          </label>`}
        </div>
      </div>
      <div class="guide-form-section">
        <span class="guide-form-legend">Tekst på kortet</span>
        <div class="guide-form-grid">
          <label class="admin-field is-wide">Beskrivelse (valgfri)
            <input type="text" data-mf="intro" value="${escapeHTML(d.intro || "")}" placeholder="La stå tom for å bruke trikset sin egen beskrivelse">
            <span class="guide-field-hint">Overstyrer beskrivelsen som følger med trikset.</span>
          </label>
        </div>
      </div>
    `;
  }

  function bildeEditorHTML(draft) {
    const d = draft.data;
    return `
      <div class="guide-form-section">
        <span class="guide-form-legend">Bilde</span>
        ${dropzoneHTML({
          url: d.url, busy: draft.uploadBusy, uploadAttr: "data-mod-image-upload",
          removeAttr: d.url ? "data-mod-image-remove" : null, ratio: "16 / 9",
          hint: "PNG, JPG eller WEBP · maks 5 MB",
        })}
      </div>
      <div class="guide-form-section">
        <span class="guide-form-legend">Tekst</span>
        <div class="guide-form-grid">
          <label class="admin-field is-wide">Alt-tekst
            <input type="text" data-mf="alt" value="${escapeHTML(d.alt || "")}" placeholder="Beskriv hva bildet viser">
            <span class="guide-field-hint">Leses opp for blinde og vises hvis bildet ikke laster. La stå tom hvis bildet bare er pynt.</span>
          </label>
          <label class="admin-field is-wide">Bildetekst (valgfri)
            <input type="text" data-mf="caption" value="${escapeHTML(d.caption || "")}" placeholder="F.eks. Slik ser budsjettlinja ut i praksis">
            <span class="guide-field-hint">Vises i grått under bildet.</span>
          </label>
        </div>
      </div>
      <div class="guide-form-section">
        <span class="guide-form-legend">Bredde</span>
        <div class="guide-choice-row">
          ${[["full", "Full bredde"], ["medium", "Halv bredde"]].map(([v, label]) => `
            <button type="button" class="guide-choice${(d.size === "medium" ? "medium" : "full") === v ? " is-active" : ""}" data-mf-choice="size" data-value="${v}">${label}</button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function moduleEditorHTML(draft) {
    const body = draft.type === "bilde" ? bildeEditorHTML(draft)
      : draft.type === "tekst" ? tekstEditorHTML(draft.data)
      : draft.type === "fil" ? filEditorHTML(draft)
      : draft.type === "tabell" ? tabellEditorHTML(draft.data)
      : draft.type === "gevinst" ? gevinstEditorHTML(draft.data)
      : draft.type === "poll" ? pollEditorHTML(draft.data)
      : draft.type === "triks" ? triksEditorHTML(draft.data)
      : "";
    const label = MODULE_LABELS[draft.type] || draft.type;
    return `
      <div class="admin-card guide-module-editor">
        <div class="guide-form-head">
          <span class="guide-form-title">
            <span class="guide-type-icon is-sm">${icon(MODULE_ICONS[draft.type] || "text", 15)}</span>
            ${draft.isNew ? `Ny modul · ${escapeHTML(label)}` : `Rediger ${escapeHTML(label.toLowerCase())}`}
          </span>
          <button type="button" class="guide-form-close" data-mod-cancel aria-label="Lukk skjemaet">${icon("x", 16)}</button>
        </div>
        <div class="guide-form-body">
          ${body}
        </div>
        <div class="guide-form-foot">
          <span class="guide-form-hint">Esc avbryter · ${cmdKeyLabel()} + S lagrer</span>
          <div class="admin-row-actions">
            <button type="button" class="btn-outline" data-mod-cancel>Avbryt</button>
            <button type="button" class="admin-btn-ghost is-accent" data-mod-save ${state.saving ? "disabled" : ""}>
              ${state.saving ? "Lagrer …" : (draft.isNew ? "Legg til modul" : "Lagre modul")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderModules(g) {
    const el = document.querySelector("[data-guide-modules]");
    if (!el) return;
    const modules = Guides.modulesFor(g.id).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const admin = canEdit();

    if (!modules.length) {
      el.innerHTML = admin
        ? `<div class="guide-modules-empty">
             ${icon("text", 24)}
             <strong>Guiden har ingen innhold ennå</strong>
             <span>Legg til den første modulen nedenfor – tekst, tabell, nedlasting, gevinst eller avstemning.</span>
           </div>`
        : "";
      return;
    }

    // Mellom hver modul ligger et lite innsettingspunkt, slik at man slipper
    // å legge modulen til nederst og deretter flytte den oppover med pilene.
    const parts = [];
    modules.forEach((m, i) => {
      if (admin) {
        const open = (state.addPickerOpen && state.addPickerIndex === i)
          || (state.moduleDraft && state.moduleDraft.isNew && state.moduleDraft.insertIndex === i);
        parts.push(`<div class="guide-insert-slot${open ? " is-open" : ""}">${addModulePickerHTML(i)}</div>`);
      }
      parts.push(moduleBlockHTML(m, i, modules.length));
    });
    el.innerHTML = parts.join("");
  }

  function renderTOC(g) {
    const card = document.querySelector("[data-guide-toc-card]");
    const nav = document.querySelector("[data-guide-toc]");
    if (!card || !nav) return;
    const items = Guides.modulesFor(g.id)
      .slice().sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({ id: m.id, label: moduleTOCLabel(m) }))
      .filter((x) => x.label);

    if (!items.length) { card.hidden = true; return; }
    card.hidden = false;
    nav.innerHTML = items.map((it) => `<a href="#module-${escapeHTML(String(it.id))}" class="guide-toc-link">${escapeHTML(it.label)}</a>`).join("");
  }

  function renderGevinstSidebar(g) {
    const card = document.querySelector("[data-guide-gevinst-card]");
    if (!card) return;
    const gevinst = Guides.modulesFor(g.id).find((m) => m.type === "gevinst");
    if (!gevinst) { card.hidden = true; return; }
    card.hidden = false;
    card.innerHTML = `
      <span class="guide-gevinst-side-label">Gevinstpotensial</span>
      <span class="guide-gevinst-side-amount">${kr(gevinstSum(gevinst.data))}</span>
      <span class="guide-gevinst-side-note">${escapeHTML(gevinst.data.note || "hvis du følger alle stegene i guiden.")}</span>
    `;
  }

  function renderGuidePage() {
    if (!isGuidePage) return;
    const params = new URLSearchParams(window.location.search);
    currentGuideId = params.get("id");
    const g = getCurrentGuide();

    const root = document.querySelector("[data-guide-root]");
    const notfound = document.querySelector("[data-guide-notfound]");
    if (!g || (g.hidden && !state.isAdmin)) {
      if (root) root.hidden = true;
      if (notfound) notfound.hidden = false;
      return;
    }
    if (root) root.hidden = false;
    if (notfound) notfound.hidden = true;

    document.title = `${g.title} · Studilla`;
    const metaDesc = document.querySelector("[data-guide-meta-description]");
    if (metaDesc) metaDesc.setAttribute("content", g.excerpt || "");

    document.querySelector("[data-guide-category]").textContent = g.category || "Guide";
    document.querySelector("[data-guide-title]").textContent = g.title;
    document.querySelector("[data-guide-excerpt]").textContent = g.excerpt;
    document.querySelector("[data-guide-updated]").textContent = g.updatedAt ? `Oppdatert ${formatDate(g.updatedAt)}` : "";

    const cover = document.querySelector("[data-guide-cover]");
    cover.innerHTML = g.coverUrl ? `<img src="${escapeHTML(g.coverUrl)}" alt="">` : `<span class="hero-placeholder-label">[ toppbilde 16:7 ]</span>`;

    const adminBar = document.querySelector("[data-guide-admin-bar]");
    if (adminBar) {
      adminBar.hidden = !state.isAdmin;
      adminBar.innerHTML = state.isAdmin ? guideAdminBarHTML(g) : "";
    }

    const banner = document.querySelector("[data-guide-hidden-banner]");
    if (banner) {
      banner.hidden = !(state.isAdmin && g.hidden);
      banner.innerHTML = (state.isAdmin && g.hidden) ? `
        <span class="guide-banner-icon">${icon("eyeOff", 18)}</span>
        <span class="guide-banner-text">
          <strong>Denne guiden er skjult</strong>
          <small>Besøkende får «Fant ikke guiden» hvis de åpner lenken. Bare du som admin ser den nå.</small>
        </span>
        <button type="button" class="admin-btn-ghost is-accent" data-guide-hide-toggle ${state.saving ? "disabled" : ""}>Publiser guiden</button>
      ` : "";
    }

    const editPanel = document.querySelector("[data-guide-edit-panel]");
    if (editPanel) {
      const editing = state.guideDraft && state.guideDraft.id === g.id;
      editPanel.hidden = !editing;
      editPanel.innerHTML = editing ? guideFormHTML(state.guideDraft, { isNew: false }) : "";
    }

    renderModules(g);
    renderTOC(g);
    renderGevinstSidebar(g);

    const addModuleEl = document.querySelector("[data-guide-add-module]");
    if (addModuleEl) {
      addModuleEl.hidden = !canEdit();
      addModuleEl.innerHTML = canEdit() ? addModulePickerHTML(null) : "";
    }

    document.body.classList.toggle("is-guide-admin", canEdit());
  }

  // Verktøylinja på guide.html. Rendres fra JS slik at knappene kan speile
  // gjeldende tilstand (skjult/publisert, forhåndsvisning av/på).
  function guideAdminBarHTML(g) {
    if (state.previewMode) {
      return `
        <span class="guide-admin-bar-label is-preview">${icon("eye", 14)}Forhåndsvisning – du ser siden som en besøkende</span>
        <div class="guide-admin-bar-actions">
          <button type="button" class="admin-btn-ghost is-accent" data-guide-preview-toggle>Avslutt forhåndsvisning</button>
        </div>
      `;
    }
    const editingInfo = state.guideDraft && state.guideDraft.id === g.id;
    return `
      <span class="guide-admin-bar-label">${icon("settings", 14)}Adminverktøy</span>
      <div class="guide-admin-bar-actions">
        <button type="button" class="guide-action-btn${editingInfo ? " is-active" : ""}" data-guide-edit>
          ${icon("edit", 15)}<span>${editingInfo ? "Lukk guide-info" : "Rediger guide-info"}</span>
        </button>
        <button type="button" class="guide-action-btn${g.hidden ? " is-warn" : ""}" data-guide-hide-toggle ${state.saving ? "disabled" : ""}>
          ${icon(g.hidden ? "eye" : "eyeOff", 15)}<span>${g.hidden ? "Publiser" : "Skjul"}</span>
        </button>
        <button type="button" class="guide-action-btn" data-guide-preview-toggle>
          ${icon("eye", 15)}<span>Forhåndsvis</span>
        </button>
        <button type="button" class="guide-action-btn is-danger" data-guide-delete>
          ${icon("trash", 15)}<span>Slett guide</span>
        </button>
      </div>
    `;
  }

  function renderAll() { renderGuiderPage(); renderGuidePage(); }

  // =====================================================================
  // Modul-handlinger
  // =====================================================================
  function openAddPicker(index) {
    if (!confirmDiscard()) return;
    state.guideDraft = null;
    state.moduleDraft = null;
    state.addPickerOpen = true;
    state.addPickerIndex = index;
    renderAll();
  }
  function closeAddPicker() { state.addPickerOpen = false; state.addPickerIndex = null; renderAll(); }

  function startAddModule(type, insertIndex) {
    state.addPickerOpen = false;
    state.addPickerIndex = null;
    state.moduleDraft = markPristine({
      id: null, type, data: defaultModuleData(type), isNew: true,
      uploadBusy: false, insertIndex: insertIndex === undefined ? null : insertIndex,
    });
    renderAll();
    scrollToEditor();
  }

  function startEditModule(moduleId) {
    const m = Guides.modulesFor(currentGuideId).find((x) => x.id === moduleId);
    if (!m) return;
    // Andre trykk på samme "Rediger"-knapp lukker skjemaet igjen.
    if (state.moduleDraft && !state.moduleDraft.isNew && state.moduleDraft.id === moduleId) {
      cancelModuleEdit();
      return;
    }
    if (!confirmDiscard()) return;
    state.guideDraft = null;
    state.addPickerOpen = false;
    state.addPickerIndex = null;
    state.moduleDraft = markPristine({ id: m.id, type: m.type, data: JSON.parse(JSON.stringify(m.data)), isNew: false, uploadBusy: false, insertIndex: null });
    renderAll();
    scrollToEditor();
  }

  // Etter render: rull det åpne skjemaet inn i bildet og sett fokus i første
  // felt, så man kan begynne å skrive med én gang.
  function scrollToEditor() {
    requestAnimationFrame(() => {
      const editor = document.querySelector(".guide-module-editor, .guide-form");
      if (!editor) return;
      editor.scrollIntoView({ behavior: "smooth", block: "center" });
      const first = editor.querySelector("input:not([type=file]), textarea, select");
      if (first) first.focus({ preventScroll: true });
    });
  }

  function cancelModuleEdit() { state.moduleDraft = null; renderAll(); }

  async function saveModuleEdit() {
    const draft = state.moduleDraft;
    if (!draft || state.saving) return;
    const data = sanitizeModuleData(draft.type, draft.data);
    const err = validateModuleData(draft.type, data);
    if (err) return flash(err);

    state.saving = true;
    renderAll();
    try {
      if (draft.isNew) {
        const mods = Guides.modulesFor(currentGuideId).slice().sort((a, b) => a.sortOrder - b.sortOrder);
        const nextOrder = (Math.max(0, ...mods.map((m) => m.sortOrder || 0)) || 0) + 1;
        const { data: added, error } = await Guides.addModule(currentGuideId, draft.type, data, nextOrder);
        if (error) return flash(friendlyError(error));

        // Lagt inn mellom to eksisterende moduler: modulen havner nederst i
        // basen, så vi sender rekkefølgen på nytt med den flyttet på plass.
        if (draft.insertIndex !== null && draft.insertIndex !== undefined && added) {
          const ids = mods.map((m) => m.id);
          ids.splice(draft.insertIndex, 0, added.id);
          const { error: reorderError } = await Guides.reorderModules(currentGuideId, ids);
          if (reorderError) flash(friendlyError(reorderError));
        }
        flash("Modul lagt til");
      } else {
        const { error } = await Guides.updateModule(currentGuideId, draft.id, data);
        if (error) return flash(friendlyError(error));
        flash("Modul lagret");
      }
      state.moduleDraft = null;
    } finally {
      state.saving = false;
      renderAll();
    }
  }

  async function deleteModuleFlow(moduleId) {
    const m = Guides.modulesFor(currentGuideId).find((x) => x.id === moduleId);
    if (!m) return;
    if (!window.confirm(`Slette modulen «${moduleSummary(m)}»?\n\nDette kan ikke angres.`)) return;
    const { error } = await Guides.deleteModule(currentGuideId, moduleId);
    if (error) return flash(friendlyError(error));
    if (state.moduleDraft && state.moduleDraft.id === moduleId) state.moduleDraft = null;
    flash("Modul slettet");
    renderAll();
  }

  async function moveModule(moduleId, dir) {
    const mods = Guides.modulesFor(currentGuideId).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = mods.findIndex((m) => m.id === moduleId);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= mods.length) return;
    const tmp = mods[idx]; mods[idx] = mods[swapIdx]; mods[swapIdx] = tmp;
    const { error } = await Guides.reorderModules(currentGuideId, mods.map((m) => m.id));
    if (error) return flash(friendlyError(error));
    renderAll();
    // Rendret på nytt = ny DOM-node; flytt fokus tilbake til samme knapp slik
    // at man kan trykke flere ganger på rad uten å lete etter den igjen.
    requestAnimationFrame(() => {
      const attr = dir === -1 ? "data-module-up" : "data-module-down";
      const btn = document.querySelector(`[${attr}="${CSS.escape(String(moduleId))}"]`);
      if (btn && !btn.disabled) btn.focus({ preventScroll: true });
      const section = document.getElementById(`module-${moduleId}`);
      if (section) section.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  async function onModFileUpload(input) {
    const file = input.files[0];
    const draft = state.moduleDraft;
    if (!file || !draft) return;
    draft.uploadBusy = true;
    renderAll();
    const { data, error } = await Guides.uploadFile(currentGuideId, file);
    draft.uploadBusy = false;
    if (error) { flash(friendlyError(error)); renderAll(); return; }
    draft.data.url = data.url;
    draft.data.ext = data.ext;
    if (!draft.data.meta) draft.data.meta = `${data.ext} · ${data.sizeLabel}`;
    if (!draft.data.name) draft.data.name = file.name.replace(/\.[^.]+$/, "");
    renderAll();
  }

  async function onModImageUpload(input) {
    const file = input.files[0];
    const draft = state.moduleDraft;
    if (!file || !draft) return;
    draft.uploadBusy = true;
    renderAll();
    const { data, error } = await Guides.uploadImage(currentGuideId, file);
    draft.uploadBusy = false;
    if (error) { flash(friendlyError(error)); renderAll(); return; }
    draft.data.url = data;
    renderAll();
  }

  function onModGameSelect(el) {
    if (!state.moduleDraft) return;
    state.moduleDraft.data.gameId = el.value || null;
    renderAll();
  }

  function onRowAdd(list) {
    const draft = state.moduleDraft;
    if (!draft) return;
    if (!draft.data[list]) draft.data[list] = [];
    if (list === "rows") draft.data.rows.push({ a: "", b: "", c: "" });
    if (list === "gains") draft.data.gains.push({ label: "", amountKr: 0 });
    if (list === "options") draft.data.options.push({ label: "", votes: 0 });
    renderAll();
  }
  function onRowRemove(list, idx) {
    const draft = state.moduleDraft;
    if (!draft || !draft.data[list]) return;
    draft.data[list].splice(idx, 1);
    renderAll();
  }
  function onRowFieldInput(el) {
    const draft = state.moduleDraft;
    if (!draft) return;
    const list = el.dataset.rowList;
    const idx = Number(el.dataset.rowIndex);
    const field = el.dataset.rowField;
    if (!draft.data[list] || !draft.data[list][idx]) return;
    draft.data[list][idx][field] = field === "amountKr" ? (el.value === "" ? 0 : Number(el.value)) : el.value;
  }

  async function votePoll(guideId, moduleId, optionIndex) {
    if (localStorage.getItem(pollVotedKey(moduleId)) !== null) return;
    localStorage.setItem(pollVotedKey(moduleId), String(optionIndex));

    const { error } = await Guides.votePoll(guideId, moduleId, optionIndex);
    if (error) {
      // Ingen fungerende backend ennå (migrasjon ikke kjørt, eller vi står på
      // fallback-dataene) – tell stemmen lokalt i stedet, slik at siden
      // fortsatt oppfører seg riktig for besøkende.
      const mod = Guides.modulesFor(guideId).find((x) => x.id === moduleId);
      if (mod && mod.data.options[optionIndex]) {
        mod.data.options[optionIndex].votes = (Number(mod.data.options[optionIndex].votes) || 0) + 1;
      }
    }
    renderAll();
  }

  // =====================================================================
  // Delegerte hendelser
  // =====================================================================
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-guide-new]") || e.target.closest("[data-guide-new-inline]")) {
      if (!confirmDiscard()) return;
      state.guideDraft = emptyGuideDraft();
      state.moduleDraft = null;
      renderAll();
      scrollToEditor();
      return;
    }
    const filterBtn = e.target.closest("[data-guide-filter]");
    if (filterBtn) { state.filter = filterBtn.dataset.guideFilter; renderAll(); return; }

    const cardEdit = e.target.closest("[data-guide-card-edit]");
    if (cardEdit) {
      const g = Guides.list().find((x) => x.id === cardEdit.dataset.guideCardEdit);
      if (g && confirmDiscard()) { state.guideDraft = guideDraftFrom(g); renderAll(); scrollToEditor(); }
      return;
    }
    const cardHide = e.target.closest("[data-guide-card-hide]");
    if (cardHide) { toggleGuideHidden(cardHide.dataset.guideCardHide); return; }
    const cardDelete = e.target.closest("[data-guide-card-delete]");
    if (cardDelete) { deleteGuideFlow(cardDelete.dataset.guideCardDelete); return; }

    if (e.target.closest("[data-guide-edit]")) {
      const g = getCurrentGuide();
      if (!g) return;
      if (state.guideDraft && state.guideDraft.id === g.id) { state.guideDraft = null; renderAll(); return; }
      if (!confirmDiscard()) return;
      state.moduleDraft = null;
      state.guideDraft = guideDraftFrom(g);
      renderAll();
      scrollToEditor();
      return;
    }
    if (e.target.closest("[data-guide-hide-toggle]")) { toggleGuideHidden(currentGuideId); return; }
    if (e.target.closest("[data-guide-preview-toggle]")) {
      if (!state.previewMode && !confirmDiscard()) return;
      state.previewMode = !state.previewMode;
      if (state.previewMode) { state.guideDraft = null; state.moduleDraft = null; state.addPickerOpen = false; }
      renderAll();
      if (!state.previewMode) flash("Tilbake i redigeringsmodus");
      return;
    }
    if (e.target.closest("[data-guide-delete]")) { deleteGuideFlow(currentGuideId); return; }

    if (e.target.closest("[data-gf-cancel]")) { state.guideDraft = null; renderAll(); return; }
    if (e.target.closest("[data-gf-remove-cover]")) { removeGuideCover(); return; }
    const gfChoice = e.target.closest("[data-gf-choice]");
    if (gfChoice && state.guideDraft) {
      state.guideDraft[gfChoice.dataset.gfChoice] = gfChoice.dataset.value;
      renderAll();
      return;
    }
    const mfChoice = e.target.closest("[data-mf-choice]");
    if (mfChoice && state.moduleDraft) {
      state.moduleDraft.data[mfChoice.dataset.mfChoice] = mfChoice.dataset.value;
      renderAll();
      return;
    }
    if (e.target.closest("[data-mod-image-remove]")) {
      if (state.moduleDraft) { state.moduleDraft.data.url = null; renderAll(); }
      return;
    }
    if (e.target.closest("[data-gf-save]")) { saveGuideDraft(); return; }
    const gfToggle = e.target.closest("[data-gf-toggle]");
    if (gfToggle && state.guideDraft) {
      const key = gfToggle.dataset.gfToggle;
      state.guideDraft[key] = !state.guideDraft[key];
      renderAll();
      return;
    }

    const addOpen = e.target.closest("[data-guide-add-open]");
    if (addOpen) {
      const raw = addOpen.dataset.guideAddOpen;
      openAddPicker(raw === "end" || raw === "" ? null : Number(raw));
      return;
    }
    if (e.target.closest("[data-guide-add-close]")) { closeAddPicker(); return; }
    const addType = e.target.closest("[data-guide-add-type]");
    if (addType) {
      const raw = addType.dataset.guideAddIndex;
      startAddModule(addType.dataset.guideAddType, raw === "" || raw === undefined ? null : Number(raw));
      return;
    }

    const modEdit = e.target.closest("[data-module-edit]");
    if (modEdit) { startEditModule(coerceModuleId(modEdit.dataset.moduleEdit)); return; }
    const modDelete = e.target.closest("[data-module-delete]");
    if (modDelete) { deleteModuleFlow(coerceModuleId(modDelete.dataset.moduleDelete)); return; }
    const modUp = e.target.closest("[data-module-up]");
    if (modUp) { moveModule(coerceModuleId(modUp.dataset.moduleUp), -1); return; }
    const modDown = e.target.closest("[data-module-down]");
    if (modDown) { moveModule(coerceModuleId(modDown.dataset.moduleDown), 1); return; }

    if (e.target.closest("[data-mod-cancel]")) { cancelModuleEdit(); return; }
    if (e.target.closest("[data-mod-save]")) { saveModuleEdit(); return; }

    const rowAdd = e.target.closest("[data-row-add]");
    if (rowAdd) { onRowAdd(rowAdd.dataset.rowAdd); return; }
    const rowRemove = e.target.closest("[data-row-remove]");
    if (rowRemove) { onRowRemove(rowRemove.dataset.rowRemove, Number(rowRemove.dataset.rowIndex)); return; }

    const pollVote = e.target.closest("[data-poll-vote]");
    if (pollVote) { votePoll(currentGuideId, coerceModuleId(pollVote.dataset.module), Number(pollVote.dataset.option)); return; }
  });

  document.addEventListener("change", (e) => {
    const gfUpload = e.target.closest("[data-gf-upload]");
    if (gfUpload) { onGuideCoverUpload(gfUpload); return; }

    const modFile = e.target.closest("[data-mod-file-upload]");
    if (modFile) { onModFileUpload(modFile); return; }

    const modImage = e.target.closest("[data-mod-image-upload]");
    if (modImage) { onModImageUpload(modImage); return; }

    const gameSelect = e.target.closest("[data-mod-game-select]");
    if (gameSelect) { onModGameSelect(gameSelect); return; }

    const headingLevel = e.target.closest('[data-mf="headingLevel"]');
    if (headingLevel && state.moduleDraft) { state.moduleDraft.data.headingLevel = Number(headingLevel.value); return; }
  });

  document.addEventListener("input", (e) => {
    const gf = e.target.closest("[data-gf]");
    if (gf && state.guideDraft) { state.guideDraft[gf.dataset.gf] = gf.value; updateGuidePreview(); return; }

    const mf = e.target.closest("[data-mf]");
    if (mf && state.moduleDraft && mf.tagName !== "SELECT") {
      const field = mf.dataset.mf;
      if (field === "bullets") state.moduleDraft.data.bullets = mf.value.split("\n");
      else state.moduleDraft.data[field] = mf.value;
      return;
    }

    const col = e.target.closest("[data-col]");
    if (col && state.moduleDraft) {
      if (!state.moduleDraft.data.columns) state.moduleDraft.data.columns = ["Kolonne 1", "Kolonne 2", "Kolonne 3"];
      state.moduleDraft.data.columns[Number(col.dataset.col)] = col.value;
      return;
    }

    const rowField = e.target.closest("[data-row-field]");
    if (rowField) onRowFieldInput(rowField);
  });

  // Tegnteller for ingressen oppdateres uten re-render, slik at markøren i
  // tekstfeltet ikke hopper til slutten mens man skriver.
  document.addEventListener("input", (e) => {
    const gf = e.target.closest('[data-gf="excerpt"]');
    if (!gf) return;
    const counter = document.querySelector('[data-gf-count="excerpt"]');
    if (counter) counter.textContent = String(gf.value.length);
  });

  // Dra-og-slipp rett på bildefeltet. Filen sendes gjennom samme
  // opplastingsfunksjon som filvelgeren, via en midlertidig DataTransfer.
  ["dragenter", "dragover"].forEach((evt) => document.addEventListener(evt, (e) => {
    const dz = e.target.closest && e.target.closest(".guide-dropzone");
    if (!dz) return;
    e.preventDefault();
    dz.classList.add("is-dragover");
  }));
  document.addEventListener("dragleave", (e) => {
    const dz = e.target.closest && e.target.closest(".guide-dropzone");
    if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove("is-dragover");
  });
  document.addEventListener("drop", (e) => {
    const dz = e.target.closest && e.target.closest(".guide-dropzone");
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove("is-dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    const input = dz.querySelector('input[type="file"]');
    if (!file || !input) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    if (input.hasAttribute("data-gf-upload")) onGuideCoverUpload(input);
    else if (input.hasAttribute("data-mod-image-upload")) onModImageUpload(input);
  });

  // Esc lukker skjemaet, Cmd/Ctrl+S lagrer det som står åpent.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (state.guideDraft || state.moduleDraft || state.addPickerOpen)) {
      if (state.addPickerOpen && !state.guideDraft && !state.moduleDraft) { closeAddPicker(); return; }
      if (!confirmDiscard()) return;
      state.guideDraft = null;
      state.moduleDraft = null;
      renderAll();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
      if (state.moduleDraft) { e.preventDefault(); saveModuleEdit(); return; }
      if (state.guideDraft) { e.preventDefault(); saveGuideDraft(); return; }
    }
  });

  // Siste sikring mot å miste et halvferdig skjema ved refresh eller
  // navigering – nettleseren viser sin egen "forlate siden?"-dialog.
  window.addEventListener("beforeunload", (e) => {
    if (!hasUnsavedChanges() || state.saving) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // =====================================================================
  // Init
  // =====================================================================
  async function init() {
    if (window.STUDILLA_GUIDES_READY) await window.STUDILLA_GUIDES_READY;
    if (isGuidePage && window.STUDILLA_GAMES_READY) await window.STUDILLA_GAMES_READY;

    const profile = await Auth.getCurrentProfile();
    state.isAdmin = !!(profile && profile.is_admin);

    if (isGuidePage && state.isAdmin) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("edit") === "1") {
        const g = Guides.list().find((x) => x.id === params.get("id"));
        if (g) state.guideDraft = guideDraftFrom(g);
      }
    }

    renderAll();
  }

  init();

  window.supabaseClient.auth.onAuthStateChange(async () => {
    state.isAdmin = !!((await Auth.getCurrentProfile()) || {}).is_admin;
    renderAll();
  });
})();
