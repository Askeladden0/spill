/**
 * Studilla – tegner innholdet i et tips (modulene) som HTML-strenger.
 *
 * Delt mellom nettleseren (js/guides.js på tip.html og artikkelsidene) og
 * byggesteget (build/build.mjs), som bruker de samme funksjonene til å skrive
 * hvert tips ut som en ferdig statisk side. Da står teksten i sidekilden for
 * søkemotorer, og markupen finnes fortsatt bare ett sted.
 *
 * Ingen DOM-tilgang her – alt som avhenger av besøkende (admin, stemmer i
 * avstemninger, spillisten) sendes inn i ctx:
 *   { isAdmin, games, pollVoted(moduleId) -> indeks eller null }
 */
(function (root) {
  "use strict";

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
  function gevinstSum(d) { return (d.gains || []).reduce((s, g) => s + (Number(g.amountKr) || 0), 0); }

  const IMAGE_ICON = '<svg class="guide-ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="8.5" cy="9.5" r="1.5"></circle><path d="m4 17 5-5 4 4 3-2 4 4"></path></svg>';

  function findGame(ctx, id) {
    return id ? ((ctx && ctx.games) || []).find((x) => x.id === id) : null;
  }

  function moduleTOCLabel(m, ctx) {
    switch (m.type) {
      case "tekst": return m.data.heading || null;
      case "fil": return m.data.name || "Nedlasting";
      case "tabell": return m.data.title || "Tabell";
      case "gevinst": return m.data.heading || "Gevinst";
      case "poll": return m.data.question || "Avstemning";
      case "triks": {
        const game = findGame(ctx, m.data.gameId);
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

  function filBodyHTML(d, ctx) {
    return `
      <div class="guide-file-card">
        <span class="guide-file-badge">${escapeHTML(d.ext || "FIL")}</span>
        <div class="guide-file-info">
          <span class="guide-file-name">${escapeHTML(d.name || "Fil")}</span>
          <span class="guide-file-meta">${escapeHTML(d.meta || "")}</span>
        </div>
        ${d.url
          ? `<a href="${escapeHTML(d.url)}" download class="btn-primary guide-file-btn">Last ned</a>`
          : `<span class="guide-file-missing">${ctx && ctx.isAdmin ? "Ingen fil lastet opp ennå" : "Utilgjengelig"}</span>`}
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

  function pollBodyHTML(m, ctx) {
    const d = m.data;
    const voted = ctx && ctx.pollVoted ? ctx.pollVoted(m.id) : null;
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

  function triksBodyHTML(d, ctx) {
    const game = findGame(ctx, d.gameId);
    const title = game ? game.name : (d.title || "Triks");
    const intro = d.intro || (game ? game.description : "") || "";
    const href = game ? `player.html?id=${encodeURIComponent(game.id)}` : d.href;
    const thumb = game && game.thumbnail;

    const inner = `
      <div class="guide-trick-thumb">${thumb ? `<img src="${escapeHTML(thumb)}" alt="">` : ""}</div>
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

  function bildeBodyHTML(d, ctx) {
    if (!d.url) {
      return `<div class="guide-image-block is-empty">${IMAGE_ICON}<span>${ctx && ctx.isAdmin ? "Ingen fil lastet opp ennå" : ""}</span></div>`;
    }
    return `
      <figure class="guide-image-block${d.size === "medium" ? " is-medium" : ""}">
        <img src="${escapeHTML(d.url)}" alt="${escapeHTML(d.alt || "")}" loading="lazy">
        ${d.caption ? `<figcaption>${escapeHTML(d.caption)}</figcaption>` : ""}
      </figure>
    `;
  }

  function moduleBodyHTML(m, ctx) {
    switch (m.type) {
      case "bilde": return bildeBodyHTML(m.data, ctx);
      case "tekst": return tekstBodyHTML(m.data);
      case "fil": return filBodyHTML(m.data, ctx);
      case "tabell": return tabellBodyHTML(m.data);
      case "gevinst": return gevinstBodyHTML(m.data);
      case "poll": return pollBodyHTML(m, ctx);
      case "triks": return triksBodyHTML(m.data, ctx);
      default: return "";
    }
  }

  root.StudillaGuideRender = {
    escapeHTML, nl2br, numFmt, kr, formatDate, gevinstSum, moduleTOCLabel, moduleBodyHTML,
  };
})(typeof window !== "undefined" ? window : globalThis);
