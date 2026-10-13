/**
 * Studilla – sprettoppvarsel for nye meldinger.
 *
 * Tidligere måtte man stå på Venner-siden for å oppdage at noen hadde svart.
 * Nå dukker nye meldinger opp som et lite kort nede i hjørnet uansett hvor på
 * siden man er, og kortet er en lenke: holder man musa over det, kommer
 * «Gå til chatten» fram, og et klikk åpner samtalen.
 *
 * Varselet er en INNSTILLING (profiles.dm_popups_enabled, se
 * supabase/schema.sql seksjon 61) som kan skrus av under Innstillinger →
 * Varsler. Standard er på.
 *
 * Krever js/supabase-config.js, js/auth.js og js/social.js lastet først.
 */
(function () {
  "use strict";

  const Social = window.StudillaSocial;
  const Auth = window.StudillaAuth;
  const Avatars = window.StudillaAvatars;
  if (!Social || !Auth || !Avatars) return;

  // På Venner-siden ser man allerede samtalene; et kort som spretter opp over
  // dem er bare i veien.
  if (document.body && document.body.dataset.page === "meldinger") return;

  const POLL_MS = 20000;
  const VISIBLE_MS = 9000;
  // Hvilke meldinger som allerede er vist ligger i sessionStorage, slik at
  // samme melding ikke spretter opp på nytt for hver side man klikker seg til.
  const SEEN_KEY = "studilla_dm_popup_seen";

  let container = null;
  let timer = null;
  let profile = null;

  function readSeen() {
    try {
      const raw = window.sessionStorage.getItem(SEEN_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function markSeen(ids) {
    try {
      // Holder lista kort – det er bare de siste meldingene som er relevante.
      const next = readSeen().concat(ids).slice(-60);
      window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch (e) {
      /* privat nettleservindu o.l. – da spretter varselet opp én gang til */
    }
  }

  function ensureContainer() {
    if (container) return container;
    container = document.createElement("div");
    container.className = "dm-popup-stack";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
    return container;
  }

  function hrefFor(row) {
    return row.kind === "group"
      ? `meldinger.html?gruppe=${encodeURIComponent(row.ref)}`
      : `meldinger.html?til=${encodeURIComponent(row.ref)}`;
  }

  /** Kort forhåndsvisning: et vedlegg vises som «Vedlegg», ikke som rå kode. */
  function previewText(body) {
    const parsed = Social.parseBody(body);
    if (!parsed.attachment) return parsed.text;
    const labels = { spill: "Sendte deg et triks", guide: "Sendte deg en guide", rekord: "Sendte deg en rekord" };
    const label = labels[parsed.attachment.kind] || "Vedlegg";
    return parsed.text ? `${label} · ${parsed.text}` : label;
  }

  function show(row) {
    const esc = Social.escapeHTML;
    const el = document.createElement("a");
    el.className = "dm-popup";
    el.href = hrefFor(row);
    // Gruppemeldinger viser hvem som skrev i tillegg til gruppenavnet.
    const sub = row.kind === "group" && row.sender_username
      ? `${row.sender_username}: ${previewText(row.body)}`
      : previewText(row.body);

    el.innerHTML = `
      ${Avatars.avatarBadgeHTML(row.avatar_color, row.avatar_icon, 36)}
      <span class="dm-popup-text">
        <span class="dm-popup-name">${esc(row.title)}</span>
        <span class="dm-popup-body">${esc(sub)}</span>
      </span>
      <span class="dm-popup-go">Gå til chatten →</span>
      <button type="button" class="dm-popup-close" aria-label="Lukk varselet">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
      </button>`;

    ensureContainer().appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));

    let hideTimer = window.setTimeout(dismiss, VISIBLE_MS);

    function dismiss() {
      window.clearTimeout(hideTimer);
      el.classList.remove("is-in");
      window.setTimeout(() => el.remove(), 260);
    }

    // Ligger musa over kortet skal det bli stående – ellers forsvinner det
    // akkurat idet man strekker seg etter det.
    el.addEventListener("mouseenter", () => window.clearTimeout(hideTimer));
    el.addEventListener("mouseleave", () => { hideTimer = window.setTimeout(dismiss, 2500); });
    el.querySelector(".dm-popup-close").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    });
  }

  async function poll() {
    if (document.hidden) return;
    let rows = [];
    try {
      rows = await Social.recentUnread(5);
    } catch (e) {
      return;
    }
    if (!rows.length) return;

    const seen = readSeen();
    const fresh = rows
      .filter((r) => seen.indexOf(`${r.kind}:${r.message_id}`) === -1)
      // Eldste først, slik at det nyeste havner nederst i stabelen.
      .reverse();
    if (!fresh.length) return;

    markSeen(fresh.map((r) => `${r.kind}:${r.message_id}`));
    // Maks tre kort om gangen; resten teller prikken i menyen for.
    fresh.slice(-3).forEach(show);
    Social.refreshUnreadBadge();
  }

  async function start() {
    profile = await Auth.getCurrentProfile();
    if (!profile) return;
    // Kolonnen finnes ikke før migrasjonen er kjørt – da er varselet på, som
    // er standardverdien.
    if (profile.dm_popups_enabled === false) return;
    if (!Social.isAvailable()) return;

    await poll();
    timer = window.setInterval(poll, POLL_MS);
    // Kommer man tilbake til fanen, sjekk med en gang i stedet for å vente
    // ut resten av intervallet.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  document.addEventListener("DOMContentLoaded", start);

  window.supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") stop();
  });
})();
