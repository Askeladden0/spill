/**
 * Studilla – teaserboks for velkomstkassen på forsiden.
 *
 * Boksen er en kopi av kassepanelet på premier.html (samme markup, samme
 * rullende bånd med partnerlogoer), slik at forsiden promoterer akkurat det
 * man får på premiesiden. Utloggede som trykker på knappen får beskjed om at
 * de må logge inn; innloggede som ikke har åpnet kassen sendes til
 * premier.html. Er kassen allerede åpnet vises ingenting.
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
    // Velkomstrabatten er aldri «Støtter Snorre», så de vises heller ikke i teaseren.
    return (res.data || []).filter((r) => !r.supports_snorre);
  }

  function render(pool, profile) {
    let items = [];
    const source = pool.length ? pool : [{ brand: "?", title: "?", rarity: "vanlig" }];
    while (items.length < REEL_SET_SIZE) items = items.concat(shuffled(source));
    const set = items.slice(0, REEL_SET_SIZE).map(tileHTML).join("");
    const setWidth = REEL_SET_SIZE * REEL_TILE_WIDTH;

    // Markupen under følger kassepanelet i premier.html ([data-case-panel]).
    root.innerHTML = `
      <div style="border-radius:20px;border:1px solid var(--border-strong);background:linear-gradient(160deg,#18222f,#131a25);overflow:hidden;margin-bottom:40px">
        <div style="padding:22px 24px 16px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border)">
          <span style="width:44px;height:44px;flex:none;border-radius:12px;background:rgba(46,232,127,.12);border:1px solid rgba(46,232,127,.35);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:var(--accent)">🎁</span>
          <h3 style="margin:0;font-size:17px;font-weight:800;letter-spacing:-.02em;color:#fff">Velkomstkassen</h3>
        </div>
        <div style="position:relative;padding:22px 0;background:radial-gradient(120% 100% at 50% 0%,rgba(46,232,127,.07),transparent 70%);overflow:hidden">
          <div style="position:relative;overflow:hidden;height:130px">
            <div class="case-reel is-rolling" style="animation-duration:${(setWidth / REEL_SPEED_PX_S).toFixed(2)}s">${set + set}</div>
          </div>
        </div>
        <div style="padding:24px;display:flex;flex-direction:column;gap:14px">
          <p class="section-sub" style="margin:0" data-teaser-sub>Åpne kassen for å trekke en tilfeldig rabatt fra en av partnerne våre.</p>
          <button type="button" class="btn-primary" style="width:100%" data-teaser-open>Åpne velkomstkassen</button>
        </div>
      </div>`;
    root.hidden = false;

    const btn = root.querySelector("[data-teaser-open]");
    const sub = root.querySelector("[data-teaser-sub]");
    btn.addEventListener("click", () => {
      if (profile) { window.location.href = "premier.html"; return; }
      sub.innerHTML = `Du må logge inn for å åpne velkomstkassen. <a href="login.html" style="color:var(--accent);font-weight:700">Logg inn</a>`;
      btn.textContent = "Logg inn for å åpne kassen";
      btn.onclick = () => { window.location.href = "login.html"; };
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
