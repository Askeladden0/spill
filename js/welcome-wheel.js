/**
 * Studilla – velkomstbonusen.
 *
 * Felles modul for velkomstbonusen: samme rullebånd som «Få en rabatt» vises på
 * forsiden (teaser) og på premiesiden (der man faktisk spinner), men båndet
 * inneholder bare de få alternativene admin har valgt. Alternativene kommer fra
 * welcome_wheel_config() og spinnet avgjøres server-side av
 * spin_welcome_wheel() (schema.sql, seksjon 71), så det kan ikke jukses med i
 * nettleseren. (Filnavnet og globalen StudillaWelcomeWheel er beholdt fra den
 * gamle hjul-versjonen så sidene som bruker den ikke må endres.)
 *
 *   StudillaWelcomeWheel.mount(root, { mode: "teaser" | "live", profile, onOpened, simulate })
 *
 * simulate: admin-simulering (js/admin-simulate.js) – spinner lokalt, uten
 *           serverkall, så ingen kode forbrukes.
 *
 * teaser: knappen sender utloggede til registrering og innloggede til
 *         premier.html#velkomst.
 * live:   knappen spinner båndet (utloggede sendes til registrering).
 */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  if (!sb) return;

  const RARITY_COLOR = { sjelden: "#4b8ef0", episk: "#9d6bf5", legendarisk: "#f0b429", vanlig: "#8d8799" };
  const TICKET_ICON = '';
  const COPY_ICON = '';
  const LINK_ICON = '';

  // Samme mål og fart som rullebåndet på premier.html («Få en rabatt»).
  const TILE_WIDTH = 124;        // 112 px kort + 12 px margin (css/pages.css)
  const MIN_SET_SIZE = 12;       // minste antall kort i ett sett
  const IDLE_SPEED_PX_S = 46;    // rolig rullefart
  const TOP_SPEED = 2400;        // px/s når båndet suser som raskest
  const RAMP_MS = 900;           // tid fra rolig til full fart
  const EXTRA_BEFORE_WINNER = 4;
  const EXTRA_AFTER_WINNER = 8;
  const EASE_SLOPE = 5;          // stigningstallet til bremsekurven cubic-bezier(.12,.6,.1,1)

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

  // Hver rabatt kan ligge på flere ruter (veier tyngre i trekningen), men
  // båndet viser hver rabatt bare én gang.
  function alternativesOf(slots) {
    const seen = new Set();
    return slots.filter((s) => {
      const key = `${s.brand}|${s.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function tileHTML(item) {
    const color = RARITY_COLOR[item.rarity] || RARITY_COLOR.vanlig;
    const styled = item.rarity && item.rarity !== "vanlig"
      ? ` style="background:linear-gradient(180deg,${color}1f,#201c2b 62%);border-color:${color}55"`
      : "";
    return `
      <span class="case-reel-tile"${styled}>
        <span class="case-reel-thumb">${item.image_url ? `<img src="${esc(item.image_url)}" alt="">` : "<span>[ logo ]</span>"}</span>
        <span class="case-reel-body">
          <span class="case-reel-title">${esc(item.title)}</span>
          <span class="case-reel-brand">${esc(item.brand)}</span>
        </span>
      </span>`;
  }

  async function fetchSlots() {
    const { data, error } = await sb.rpc("welcome_wheel_config");
    if (error || !data) return [];
    return data.slice().sort((a, b) => a.slot - b.slot);
  }

  async function mount(root, opts) {
    const options = opts || {};
    const live = options.mode === "live";
    const simulate = !!options.simulate;
    const profile = options.profile || null;
    const slots = await fetchSlots();
    const pool = alternativesOf(slots);
    // Uten alternativer (admin har ikke valgt rabatter) vises ingenting.
    if (!pool.length) { root.hidden = true; return null; }

    let spinning = false;
    let opened = false;

    root.innerHTML = `
      <div style="border-radius:20px;border:1px solid var(--border-strong);background:linear-gradient(160deg,#221e2d,#201c2b);overflow:hidden;margin-bottom:40px">
        <div style="padding:22px 24px 16px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border)">
          <span style="width:44px;height:44px;flex:none;border-radius:12px;background:rgba(var(--accent-rgb), .12);border:1px dashed rgba(var(--accent-rgb), .45);display:flex;align-items:center;justify-content:center;color:var(--accent)">${TICKET_ICON}</span>
          <h3 style="margin:0;font-size:17px;font-weight:700;letter-spacing:-.02em;color:#fff">Velkomstbonusen</h3>
        </div>
        <div style="position:relative;padding:22px 0;background:radial-gradient(120% 100% at 50% 0%,rgba(var(--accent-rgb), .07),transparent 70%);overflow:hidden" data-ww-stage>
          <div style="position:relative;overflow:hidden;height:130px" data-ww-viewport>
            <div class="case-reel" data-ww-reel></div>
          </div>
          <div style="position:absolute;top:14px;bottom:14px;left:50%;width:2px;transform:translateX(-1px);background:var(--accent);box-shadow:0 0 18px rgba(var(--accent-rgb), .6);pointer-events:none"></div>
        </div>
        <div style="padding:6px 24px 24px;display:flex;flex-direction:column;gap:14px" data-ww-foot>
          <p class="section-sub" style="margin:0;text-align:center" data-ww-sub></p>
          <button type="button" class="btn-primary" style="width:100%" data-ww-btn></button>
        </div>
        <div style="padding:0 24px 24px" data-ww-reveal-slot></div>
      </div>`;
    root.hidden = false;

    const reel = root.querySelector("[data-ww-reel]");
    const viewport = root.querySelector("[data-ww-viewport]");
    const btn = root.querySelector("[data-ww-btn]");
    const sub = root.querySelector("[data-ww-sub]");

    // Ett sett er et helt antall runder gjennom alternativene, så de to like
    // settene i båndet går sømløst i hverandre.
    const setLen = Math.ceil(MIN_SET_SIZE / pool.length) * pool.length;
    const setWidth = setLen * TILE_WIDTH;

    function cycleItems(n) {
      const items = [];
      while (items.length < n) items.push(...shuffled(pool));
      return items.slice(0, n);
    }

    let raf = 0;
    let anim = null;

    // Det rolige båndet: én uendelig CSS-animasjon over to like sett.
    function startIdle() {
      cancelAnimationFrame(raf);
      if (anim) { anim.cancel(); anim = null; }
      const set = cycleItems(setLen).map(tileHTML).join("");
      reel.innerHTML = set + set;
      reel.style.transform = "";
      reel.style.animationDuration = `${(setWidth / IDLE_SPEED_PX_S).toFixed(2)}s`;
      reel.classList.add("is-rolling");
    }

    // Skrur opp farten jevnt mens trekningen hentes (rAF-løkke i stedet for å
    // endre animation-duration, som ville gitt et hopp).
    let speed = IDLE_SPEED_PX_S;
    function rush() {
      const current = window.getComputedStyle(reel).transform;
      let pos = current === "none" ? 0 : new DOMMatrixReadOnly(current).m41;
      reel.classList.remove("is-rolling");
      reel.style.animationDuration = "";
      reel.style.transform = `translate3d(${pos}px,0,0)`;
      const t0 = performance.now();
      let last = t0;
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const k = Math.min(1, (now - t0) / RAMP_MS);
        const eased = k * k * (3 - 2 * k);
        speed = IDLE_SPEED_PX_S + (TOP_SPEED - IDLE_SPEED_PX_S) * eased;
        pos -= speed * dt;
        while (pos <= -setWidth) pos += setWidth;
        reel.style.transform = `translate3d(${pos}px,0,0)`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    // Bremser gradvis til vinnerkortet står under markøren. Vinnerkortet legges
    // til bak kortene som allerede er på skjermen, så båndet ikke hopper.
    async function spinTo(winner) {
      const entrySpeed = Math.max(IDLE_SPEED_PX_S, speed);
      cancelAnimationFrame(raf);
      raf = 0;
      const startX = new DOMMatrixReadOnly(window.getComputedStyle(reel).transform).m41;
      const existing = reel.children.length;
      const before = cycleItems(EXTRA_BEFORE_WINNER);
      const after = cycleItems(EXTRA_AFTER_WINNER);
      reel.insertAdjacentHTML("beforeend", before.map(tileHTML).join("") + tileHTML(winner) + after.map(tileHTML).join(""));

      const winnerIndex = existing + before.length;
      const winnerTile = reel.children[winnerIndex];
      // Lander et sted innenfor vinnerkortet (ikke alltid midt på), som på ekte.
      const jitter = (Math.random() - 0.5) * (TILE_WIDTH - 40);
      const endX = -(winnerIndex * TILE_WIDTH + TILE_WIDTH / 2 - 6 + jitter - viewport.clientWidth / 2);

      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const spinMs = Math.min(8000, Math.max(3500, (EASE_SLOPE * Math.abs(endX - startX) / entrySpeed) * 1000));
      anim = reel.animate(
        [{ transform: `translate3d(${startX}px,0,0)` }, { transform: `translate3d(${endX}px,0,0)` }],
        { duration: reduced ? 1 : spinMs, easing: "cubic-bezier(0.12, 0.6, 0.1, 1)", fill: "forwards" }
      );
      try { await anim.finished; } catch (e) { return; }
      reel.style.transform = `translate3d(${endX}px,0,0)`;
      anim.cancel();
      anim = null;
      winnerTile.classList.add("is-winner");
    }

    startIdle();

    function setIdleText() {
      if (!profile) {
        sub.textContent = "Registrer deg gratis og åpne velkomstbonusen for å vinne en rabatt.";
        btn.textContent = "Registrer deg";
      } else {
        sub.textContent = "Spinn og vinn én av rabattene over – koden havner i «Mine koder».";
        btn.textContent = live ? "Spinn" : "Spinn velkomstbonusen";
      }
    }
    setIdleText();

    function showReveal(data) {
      const color = RARITY_COLOR[data.rarity] || RARITY_COLOR.vanlig;
      const neon = window.StudillaSnorreTag ? window.StudillaSnorreTag.neonFor(data.code) : "";
      root.querySelector("[data-ww-stage]").style.display = "none";
      root.querySelector("[data-ww-foot]").style.display = "none";
      root.querySelector("[data-ww-reveal-slot]").innerHTML = `
        <div class="case-reveal" style="--reveal-color:${color}">
          <span class="case-reveal-logo">${data.image_url ? `<img src="${esc(data.image_url)}" alt="">` : "<span>[ logo ]</span>"}</span>
          <h3 class="case-reveal-value">${esc(data.title)} hos ${esc(data.brand)}</h3>
          <button type="button" class="case-reveal-code code-neon" style="background:${neon}" data-ww-copy="${esc(data.code)}" aria-label="Kopier koden">
            <span class="case-reveal-code-label" data-ww-copy-label>Din kode</span>
            <span class="case-reveal-code-row"><span class="case-reveal-code-value">${esc(data.code)}</span>${COPY_ICON}</span>
          </button>
          ${data.link_url ? `<a class="case-reveal-use" style="background:${neon}" href="${esc(data.link_url)}" target="_blank" rel="noopener noreferrer">Bruk koden ${LINK_ICON}</a>` : ""}
          ${data.sub ? `<p class="case-reveal-sub-text" style="display:block;-webkit-line-clamp:unset;max-height:none">${esc(data.sub)}</p>` : ""}
          ${simulate
            ? `<p class="case-reveal-note">Simulering – ingen kode er brukt eller lagret.</p><button type="button" class="btn-primary" style="width:100%;margin-top:12px" data-ww-again>Simuler på nytt</button>`
            : `<p class="case-reveal-note">Koden er lagret i «Mine koder» på profilen din.</p>`}
        </div>`;
    }

    root.onclick = (e) => {
      if (e.target.closest("[data-ww-again]")) { mount(root, options); return; }
      const copyEl = e.target.closest("[data-ww-copy]");
      if (copyEl && navigator.clipboard) {
        navigator.clipboard.writeText(copyEl.dataset.wwCopy).then(() => {
          const label = copyEl.querySelector("[data-ww-copy-label]");
          if (!label) return;
          label.textContent = "Kopiert!";
          clearTimeout(copyEl._t);
          copyEl._t = setTimeout(() => { label.textContent = "Din kode"; }, 1500);
        });
      }
    };

    async function spin() {
      if (spinning || opened) return;
      spinning = true;
      btn.disabled = true;
      btn.textContent = "Spinner …";

      const t0 = Date.now();
      rush();

      // Admin-simulering: trekker en tilfeldig rute lokalt uten å kalle
      // serveren, så ingen kode tas av og ingenting lagres.
      let data, error;
      if (simulate) {
        const pick = slots[Math.floor(Math.random() * slots.length)];
        data = Object.assign({}, pick, { code: "SIMULERT", link_url: "", already_opened: false });
      } else {
        ({ data, error } = await sb.rpc("spin_welcome_wheel").single());
      }
      const elapsed = Date.now() - t0;
      if (elapsed < RAMP_MS) await new Promise((r) => setTimeout(r, RAMP_MS - elapsed));

      if (error) {
        spinning = false;
        btn.disabled = false;
        startIdle();
        setIdleText();
        window.alert(error.message.includes("Ingen rabatter")
          ? "Ingen rabatter er tilgjengelige akkurat nå. Prøv igjen senere."
          : error.message);
        return;
      }

      await spinTo(data);
      await new Promise((r) => setTimeout(r, 650));

      opened = true;
      spinning = false;
      showReveal(data);
      if (!simulate && typeof options.onOpened === "function") options.onOpened(data);
    }

    btn.addEventListener("click", () => {
      if (!profile) { window.location.href = "login.html"; return; }
      if (!live) { window.location.href = "premier.html#velkomst"; return; }
      spin();
    });

    return { slots };
  }

  window.StudillaWelcomeWheel = { mount, fetchSlots };
})();
