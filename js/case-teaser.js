/**
 * Studilla – teaserboks for velkomstbonusen på forsiden.
 *
 * Boksen er en kopi av rabattpanelet på premier.html (samme markup, samme
 * rullende bånd med partnerlogoer), slik at forsiden promoterer akkurat det
 * man får på premiesiden. Utloggede som trykker på knappen sendes til
 * registrering; innloggede som ikke har åpnet rabatten sendes til
 * premier.html. Er rabatten allerede åpnet vises ingenting.
 */
(function () {
  "use strict";

  const root = document.querySelector("[data-case-teaser]");
  const sb = window.supabaseClient;
  const Auth = window.StudillaAuth;
  if (!root || !sb || !Auth) return;
  if (!(window.STUDILLA_FEATURES && window.STUDILLA_FEATURES.levelsEnabled)) return;

  const RARITY_COLOR = { sjelden: "#4b8ef0", episk: "#9d6bf5", legendarisk: "#f0b429" };
  const REEL_TILE_WIDTH = 124;
  const REEL_SET_SIZE = 14;
  const REEL_SPEED_PX_S = 46;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function shuffled(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function tileHTML(item) {
    const color = RARITY_COLOR[item.rarity];
    const styled = color ? ` style="background:linear-gradient(180deg,${color}1f,#131a25 62%);border-color:${color}55"` : "";
    return `
      <span class="case-reel-tile"${styled}>
        <span class="case-reel-thumb">${item.image_url ? `<img src="${esc(item.image_url)}" alt="">` : `<span>[ logo ]</span>`}</span>
        <span class="case-reel-body">
          <span class="case-reel-title">${esc(item.title)}</span>
          <span class="case-reel-brand">${esc(item.brand)}</span>
        </span>
      </span>`;
  }

  async function fetchRewards() {
    const base = () => sb.from("rewards").select("id, brand, title, rarity, image_url, supports_snorre").eq("active", true);
    let res = await base().or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order("sort_order");
    if (res.error) {
      res = await sb.from("rewards").select("id, brand, title, rarity, image_url").eq("active", true).order("sort_order");
    }
    // Velkomstbonusen er aldri «Støtter Snorre», så de vises heller ikke i teaseren.
    return (res.data || []).filter((r) => !r.supports_snorre);
  }

  function render(pool, profile) {
    let items = [];
    const source = pool.length ? pool : [{ brand: "?", title: "?", rarity: "vanlig" }];
    while (items.length < REEL_SET_SIZE) items = items.concat(shuffled(source));
    const set = items.slice(0, REEL_SET_SIZE).map(tileHTML).join("");
    const setWidth = REEL_SET_SIZE * REEL_TILE_WIDTH;

    // Markupen under følger rabattpanelet i premier.html ([data-case-panel]).
    root.innerHTML = `
      <div style="border-radius:20px;border:1px solid var(--border-strong);background:linear-gradient(160deg,#18222f,#131a25);overflow:hidden;margin-bottom:40px">
        <div style="padding:22px 24px 16px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border)">
          <span style="width:44px;height:44px;flex:none;border-radius:12px;background:rgba(var(--accent-rgb), .12);border:1px dashed rgba(var(--accent-rgb), .45);display:flex;align-items:center;justify-content:center;color:var(--accent)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5h16a1 1 0 0 1 1 1v2.6a2 2 0 0 0 0 3.8v2.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.6a2 2 0 0 0 0-3.8V7.5a1 1 0 0 1 1-1z"></path><line x1="9.5" y1="14.5" x2="14.5" y2="9.5"></line><circle cx="9.7" cy="10" r=".9"></circle><circle cx="14.3" cy="14" r=".9"></circle></svg></span>
          <h3 style="margin:0;font-size:17px;font-weight:800;letter-spacing:-.02em;color:#fff">Velkomstbonusen</h3>
        </div>
        <div style="position:relative;padding:22px 0;background:radial-gradient(120% 100% at 50% 0%,rgba(var(--accent-rgb), .07),transparent 70%);overflow:hidden">
          <div style="position:relative;overflow:hidden;height:130px">
            <div class="case-reel is-rolling" style="animation-duration:${(setWidth / REEL_SPEED_PX_S).toFixed(2)}s">${set + set}</div>
          </div>
        </div>
        <div style="padding:24px;display:flex;flex-direction:column;gap:14px">
          <p class="section-sub" style="margin:0" data-teaser-sub>Åpne rabatten for å trekke en tilfeldig rabatt.</p>
          <button type="button" class="btn-primary" style="width:100%" data-teaser-open>Registrer deg</button>
        </div>
      </div>`;
    root.hidden = false;

    // Utloggede sendes rett til registrering (login.html åpner på «Registrer
    // deg» og fører nyregistrerte videre til rabatten på premier.html);
    // innloggede går rett til rabatten.
    const btn = root.querySelector("[data-teaser-open]");
    if (profile) {
      btn.textContent = "Åpne velkomstbonusen";
    } else {
      root.querySelector("[data-teaser-sub]").textContent = "Registrer deg gratis for å trekke en tilfeldig rabatt.";
    }
    btn.addEventListener("click", () => {
      window.location.href = profile ? "premier.html#velkomst" : "login.html";
    });
  }

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
    render(await fetchRewards(), profile);
  })();
})();
