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

  let toastTimer = null;
  function flash(msg) {
    const el = document.querySelector("[data-toast]");
    if (!el) return;
    el.textContent = `✓ ${msg}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  const MODULE_LABELS = { tekst: "Tekst", fil: "Nedlasting", tabell: "Tabell", gevinst: "Gevinst", poll: "Avstemning", triks: "Triks" };
  const MODULE_TYPES = [
    ["tekst", "Tekst"], ["fil", "Fil"], ["tabell", "Tabell"], ["gevinst", "Gevinst"], ["poll", "Avstemning"], ["triks", "Triks-lenke"]
  ];

  function defaultModuleData(type) {
    switch (type) {
      case "tekst": return { heading: "", headingLevel: 2, body: "", bullets: [], tip: null };
      case "fil": return { name: "", ext: "", meta: "", url: null };
      case "tabell": return { title: "", columns: ["Kolonne 1", "Kolonne 2", "Kolonne 3"], rows: [], source: "" };
      case "gevinst": return { heading: "Dette kan du tjene", note: "", gains: [] };
      case "poll": return { question: "", options: [{ label: "", votes: 0 }, { label: "", votes: 0 }] };
      case "triks": return { gameId: null, title: "", intro: "", href: null };
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
    }
    return d;
  }

  function gevinstSum(d) { return (d.gains || []).reduce((s, g) => s + (Number(g.amountKr) || 0), 0); }

  // =====================================================================
  // State
  // =====================================================================
  const state = {
    isAdmin: false,
    filter: "Alle",
    guideDraft: null,      // guide-info-skjemaet (nytt eller redigering av eksisterende)
    moduleDraft: null,     // modul-skjemaet på guide.html
    addPickerOpen: false,
  };
  let currentGuideId = null;

  function emptyGuideDraft() {
    return { id: null, tempId: "new-" + Date.now(), title: "", category: "", excerpt: "", valueLabel: "", readTime: "", coverUrl: null, featured: false, uploadBusy: false };
  }
  function guideDraftFrom(g) {
    return { id: g.id, tempId: g.id, title: g.title, category: g.category, excerpt: g.excerpt, valueLabel: g.valueLabel, readTime: g.readTime, coverUrl: g.coverUrl, featured: g.featured, uploadBusy: false };
  }
  function getCurrentGuide() { return Guides.list().find((g) => g.id === currentGuideId) || null; }

  // =====================================================================
  // Guide-info-skjema (delt mellom "+ Ny guide" og "Rediger guide-info")
  // =====================================================================
  function guideFormHTML(draft, opts) {
    opts = opts || {};
    return `
      <div class="admin-card guide-form">
        <div class="admin-row-detail" style="padding:0;border:none">
          <label class="admin-field is-wide">Overskrift
            <input type="text" data-gf="title" value="${escapeHTML(draft.title)}" placeholder="F.eks. Hvordan tjene penger på å sitte i elevrådet">
          </label>
          <label class="admin-field">Kategori
            <input type="text" data-gf="category" value="${escapeHTML(draft.category)}" placeholder="F.eks. Elevrådet">
          </label>
          <label class="admin-field">Lesetid
            <input type="text" data-gf="readTime" value="${escapeHTML(draft.readTime)}" placeholder="F.eks. 8 min">
          </label>
          <label class="admin-field is-wide">Ingress (vises på kortet og øverst i guiden)
            <textarea data-gf="excerpt" rows="2" placeholder="Kort beskrivelse av guiden">${escapeHTML(draft.excerpt)}</textarea>
          </label>
          <label class="admin-field">Mengde spart/tjent
            <input type="text" data-gf="valueLabel" value="${escapeHTML(draft.valueLabel)}" placeholder="F.eks. Opptil 12 000 kr">
          </label>
          <label class="admin-field">Toppbilde
            <span class="admin-upload-row">
              <label class="admin-upload-btn${draft.uploadBusy ? " is-busy" : ""}">
                ${draft.uploadBusy ? "Laster opp …" : (draft.coverUrl ? "Bytt bilde" : "Last opp PNG/JPG")}
                <input type="file" accept="image/png,image/jpeg,image/webp" data-gf-upload ${draft.uploadBusy ? "disabled" : ""}>
              </label>
            </span>
          </label>
          ${opts.isNew ? "" : `
          <label class="admin-field" style="flex-direction:row;align-items:center;gap:10px;padding-top:26px">
            <button type="button" class="admin-switch${draft.featured ? " is-on" : ""}" data-gf-toggle="featured" aria-label="Vis som fremhevet guide">
              <span class="admin-switch-track"></span><span class="admin-switch-knob"></span>
            </button>
            <span style="font-size:12.5px;font-weight:600;color:var(--muted)">Vis som fremhevet guide øverst</span>
          </label>`}
        </div>
        <div class="admin-row-actions">
          <button type="button" class="btn-outline" data-gf-cancel>Avbryt</button>
          <button type="button" class="admin-btn-ghost is-accent" data-gf-save>${opts.isNew ? "Opprett guide" : "Lagre"}</button>
        </div>
      </div>
    `;
  }

  async function saveGuideDraft() {
    const d = state.guideDraft;
    if (!d) return;
    const title = d.title.trim();
    if (!title) return flash("Guiden må ha en overskrift.");

    const fields = {
      title, category: d.category.trim(), excerpt: d.excerpt.trim(),
      valueLabel: d.valueLabel.trim(), readTime: d.readTime.trim(), coverUrl: d.coverUrl,
    };
    if (d.id !== null) fields.featured = !!d.featured;

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
    flash("Lagret!");
    renderAll();
  }

  async function deleteGuideFlow(id) {
    const g = Guides.list().find((x) => x.id === id);
    if (!g) return;
    if (!window.confirm(`Slette guiden «${g.title}»? Dette kan ikke angres.`)) return;
    const { error } = await Guides.deleteGuide(id);
    if (error) return flash(friendlyError(error));
    flash("Guide slettet");
    if (isGuidePage && currentGuideId === id) { window.location.href = "guider.html"; return; }
    renderAll();
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

  // =====================================================================
  // guider.html – oversikt
  // =====================================================================
  function renderGuiderPage() {
    if (!isGuiderPage) return;
    renderFeature();
    renderFilters();
    renderGrid();
    const countEl = document.querySelector("[data-guide-count]");
    const list = Guides.list();
    if (countEl) countEl.textContent = `${list.length} guide${list.length === 1 ? "" : "r"}`;
    const newBtn = document.querySelector("[data-guide-new]");
    if (newBtn) newBtn.hidden = !state.isAdmin;
  }

  function renderFeature() {
    const el = document.querySelector("[data-guide-feature]");
    if (!el) return;
    const list = Guides.list();
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

    const metaBits = [featured.readTime, featured.updatedAt ? `Oppdatert ${formatDate(featured.updatedAt)}` : ""].filter(Boolean).join(" · ");
    el.innerHTML = `
      <div class="guide-feature">
        <div class="guide-feature-text">
          <span class="guide-feature-badge">Anbefalt guide</span>
          <h2>${escapeHTML(featured.title)}</h2>
          <p>${escapeHTML(featured.excerpt)}</p>
          <div class="guide-feature-actions">
            <a href="guide.html?id=${encodeURIComponent(featured.id)}"><button type="button" class="btn-primary">Les guiden</button></a>
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
    const cats = ["Alle", ...Array.from(new Set(Guides.list().map((g) => g.category).filter(Boolean)))];
    if (!cats.includes(state.filter)) state.filter = "Alle";
    el.innerHTML = cats.map((c) => `<button type="button" class="guide-filter-pill${c === state.filter ? " is-active" : ""}" data-guide-filter="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  }

  function guideCardHTML(g) {
    if (state.guideDraft && state.guideDraft.id === g.id) {
      return `<div class="guide-card is-editing">${guideFormHTML(state.guideDraft, { isNew: false })}</div>`;
    }
    return `
      <div class="guide-card">
        <a href="guide.html?id=${encodeURIComponent(g.id)}" class="guide-card-thumb">
          ${g.coverUrl ? `<img class="guide-card-thumb-img" src="${escapeHTML(g.coverUrl)}" alt="">` : `<span class="guide-card-thumb-slot">[ guide-bilde ]</span>`}
          <div class="guide-card-gradient"></div>
          <h3 class="guide-card-title">${escapeHTML(g.title)}</h3>
        </a>
        ${state.isAdmin ? `
          <div class="guide-card-admin-actions">
            <button type="button" class="guide-icon-btn" data-guide-card-edit="${escapeHTML(g.id)}" title="Rediger">✎</button>
            <button type="button" class="guide-icon-btn is-danger" data-guide-card-delete="${escapeHTML(g.id)}" title="Slett">🗑</button>
          </div>
        ` : ""}
        <div class="guide-card-body">
          <p class="guide-card-excerpt">${escapeHTML(g.excerpt)}</p>
          <div class="guide-card-foot">
            <span class="guide-card-value">${escapeHTML(g.valueLabel)}</span>
            ${g.readTime ? `<span class="guide-card-time">${escapeHTML(g.readTime)}</span>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function renderGrid() {
    const el = document.querySelector("[data-guide-grid]");
    if (!el) return;
    const list = Guides.list().filter((g) => state.filter === "Alle" || g.category === state.filter);
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
  function addModulePickerHTML() {
    if (state.moduleDraft && state.moduleDraft.isNew) return moduleEditorHTML(state.moduleDraft);
    if (!state.addPickerOpen) return `<button type="button" class="btn-outline" data-guide-add-open>+ Legg til modul</button>`;
    return `
      <div class="guide-add-picker">
        <span class="guide-add-picker-label">Velg modultype:</span>
        <div class="guide-add-picker-options">
          ${MODULE_TYPES.map(([t, label]) => `<button type="button" class="admin-btn-ghost" data-guide-add-type="${t}">${label}</button>`).join("")}
        </div>
        <button type="button" class="admin-btn-text" data-guide-add-close>Avbryt</button>
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
        <span class="guide-trick-eyebrow">Øv på dette i et triks</span>
        <span class="guide-trick-title">${escapeHTML(title)}</span>
        ${intro ? `<span class="guide-trick-intro">${escapeHTML(intro)}</span>` : ""}
        <span class="guide-trick-cta">Spill trikset →</span>
      </div>
    `;
    return href
      ? `<a class="guide-trick-card" href="${escapeHTML(href)}">${inner}</a>`
      : `<div class="guide-trick-card is-static">${inner}</div>`;
  }

  function moduleBodyHTML(m) {
    switch (m.type) {
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
    const adminToolbar = state.isAdmin ? `
      <div class="guide-module-toolbar">
        <button type="button" class="guide-icon-btn" data-module-up="${idAttr}" ${index === 0 ? "disabled" : ""} title="Flytt opp">↑</button>
        <button type="button" class="guide-icon-btn" data-module-down="${idAttr}" ${index === total - 1 ? "disabled" : ""} title="Flytt ned">↓</button>
        <button type="button" class="guide-icon-btn" data-module-edit="${idAttr}" title="Rediger">✎</button>
        <button type="button" class="guide-icon-btn is-danger" data-module-delete="${idAttr}" title="Slett">🗑</button>
      </div>
    ` : "";

    return `
      <section class="guide-module" id="module-${idAttr}">
        <div class="guide-module-head">
          <span class="guide-module-eyebrow">Modul · ${escapeHTML(MODULE_LABELS[m.type] || m.type)}</span>
          <div class="guide-module-divider"></div>
          ${adminToolbar}
        </div>
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
    return `
      <div class="admin-row-detail" style="padding:0;border:none">
        <label class="admin-field is-wide">Triks
          <select data-mf="gameId" data-mod-game-select>
            <option value="" ${!usingGame ? "selected" : ""}>— Egendefinert lenke —</option>
            ${games.map((g) => `<option value="${escapeHTML(g.id)}" ${d.gameId === g.id ? "selected" : ""}>${escapeHTML(g.name)}</option>`).join("")}
          </select>
        </label>
        ${!usingGame ? `
        <label class="admin-field is-wide">Tittel
          <input type="text" data-mf="title" value="${escapeHTML(d.title || "")}">
        </label>
        <label class="admin-field is-wide">Lenke (URL)
          <input type="text" data-mf="href" value="${escapeHTML(d.href || "")}" placeholder="https://…">
        </label>` : ""}
        <label class="admin-field is-wide">Tekst (valgfri – overstyrer beskrivelsen)
          <input type="text" data-mf="intro" value="${escapeHTML(d.intro || "")}">
        </label>
      </div>
    `;
  }

  function moduleEditorHTML(draft) {
    const body = draft.type === "tekst" ? tekstEditorHTML(draft.data)
      : draft.type === "fil" ? filEditorHTML(draft)
      : draft.type === "tabell" ? tabellEditorHTML(draft.data)
      : draft.type === "gevinst" ? gevinstEditorHTML(draft.data)
      : draft.type === "poll" ? pollEditorHTML(draft.data)
      : draft.type === "triks" ? triksEditorHTML(draft.data)
      : "";
    return `
      <div class="admin-card guide-module-editor">
        ${body}
        <div class="admin-row-actions">
          <button type="button" class="btn-outline" data-mod-cancel>Avbryt</button>
          <button type="button" class="admin-btn-ghost is-accent" data-mod-save>${draft.isNew ? "Legg til modul" : "Lagre modul"}</button>
        </div>
      </div>
    `;
  }

  function renderModules(g) {
    const el = document.querySelector("[data-guide-modules]");
    if (!el) return;
    const modules = Guides.modulesFor(g.id).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    el.innerHTML = modules.map((m, i) => moduleBlockHTML(m, i, modules.length)).join("");
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
    if (!g) {
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
    document.querySelector("[data-guide-time]").textContent = g.readTime ? `${g.readTime} lesing` : "";

    const cover = document.querySelector("[data-guide-cover]");
    cover.innerHTML = g.coverUrl ? `<img src="${escapeHTML(g.coverUrl)}" alt="">` : `<span class="hero-placeholder-label">[ toppbilde 16:7 ]</span>`;

    const adminBar = document.querySelector("[data-guide-admin-bar]");
    if (adminBar) adminBar.hidden = !state.isAdmin;

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
      addModuleEl.hidden = !state.isAdmin;
      addModuleEl.innerHTML = state.isAdmin ? addModulePickerHTML() : "";
    }
  }

  function renderAll() { renderGuiderPage(); renderGuidePage(); }

  // =====================================================================
  // Modul-handlinger
  // =====================================================================
  function openAddPicker() { state.addPickerOpen = true; renderAll(); }
  function closeAddPicker() { state.addPickerOpen = false; renderAll(); }

  function startAddModule(type) {
    state.addPickerOpen = false;
    state.moduleDraft = { id: null, type, data: defaultModuleData(type), isNew: true, uploadBusy: false };
    renderAll();
    const el = document.querySelector("[data-guide-add-module]");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function startEditModule(moduleId) {
    const m = Guides.modulesFor(currentGuideId).find((x) => x.id === moduleId);
    if (!m) return;
    state.moduleDraft = { id: m.id, type: m.type, data: JSON.parse(JSON.stringify(m.data)), isNew: false, uploadBusy: false };
    renderAll();
  }

  function cancelModuleEdit() { state.moduleDraft = null; renderAll(); }

  async function saveModuleEdit() {
    const draft = state.moduleDraft;
    if (!draft) return;
    const data = sanitizeModuleData(draft.type, draft.data);
    const err = validateModuleData(draft.type, data);
    if (err) return flash(err);

    if (draft.isNew) {
      const mods = Guides.modulesFor(currentGuideId);
      const nextOrder = (Math.max(0, ...mods.map((m) => m.sortOrder || 0)) || 0) + 1;
      const { error } = await Guides.addModule(currentGuideId, draft.type, data, nextOrder);
      if (error) return flash(friendlyError(error));
      flash("Modul lagt til");
    } else {
      const { error } = await Guides.updateModule(currentGuideId, draft.id, data);
      if (error) return flash(friendlyError(error));
      flash("Modul lagret");
    }
    state.moduleDraft = null;
    renderAll();
  }

  async function deleteModuleFlow(moduleId) {
    if (!window.confirm("Slette denne modulen? Dette kan ikke angres.")) return;
    const { error } = await Guides.deleteModule(currentGuideId, moduleId);
    if (error) return flash(friendlyError(error));
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
      state.guideDraft = emptyGuideDraft();
      renderAll();
      return;
    }
    const filterBtn = e.target.closest("[data-guide-filter]");
    if (filterBtn) { state.filter = filterBtn.dataset.guideFilter; renderAll(); return; }

    const cardEdit = e.target.closest("[data-guide-card-edit]");
    if (cardEdit) {
      const g = Guides.list().find((x) => x.id === cardEdit.dataset.guideCardEdit);
      if (g) { state.guideDraft = guideDraftFrom(g); renderAll(); }
      return;
    }
    const cardDelete = e.target.closest("[data-guide-card-delete]");
    if (cardDelete) { deleteGuideFlow(cardDelete.dataset.guideCardDelete); return; }

    if (e.target.closest("[data-guide-edit]")) {
      const g = getCurrentGuide();
      if (g) { state.guideDraft = (state.guideDraft && state.guideDraft.id === g.id) ? null : guideDraftFrom(g); renderAll(); }
      return;
    }
    if (e.target.closest("[data-guide-delete]")) { deleteGuideFlow(currentGuideId); return; }

    if (e.target.closest("[data-gf-cancel]")) { state.guideDraft = null; renderAll(); return; }
    if (e.target.closest("[data-gf-save]")) { saveGuideDraft(); return; }
    const gfToggle = e.target.closest("[data-gf-toggle]");
    if (gfToggle && state.guideDraft) {
      const key = gfToggle.dataset.gfToggle;
      state.guideDraft[key] = !state.guideDraft[key];
      renderAll();
      return;
    }

    if (e.target.closest("[data-guide-add-open]")) { openAddPicker(); return; }
    if (e.target.closest("[data-guide-add-close]")) { closeAddPicker(); return; }
    const addType = e.target.closest("[data-guide-add-type]");
    if (addType) { startAddModule(addType.dataset.guideAddType); return; }

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

    const gameSelect = e.target.closest("[data-mod-game-select]");
    if (gameSelect) { onModGameSelect(gameSelect); return; }

    const headingLevel = e.target.closest('[data-mf="headingLevel"]');
    if (headingLevel && state.moduleDraft) { state.moduleDraft.data.headingLevel = Number(headingLevel.value); return; }
  });

  document.addEventListener("input", (e) => {
    const gf = e.target.closest("[data-gf]");
    if (gf && state.guideDraft) { state.guideDraft[gf.dataset.gf] = gf.value; return; }

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
