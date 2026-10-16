/**
 * Studilla – velkomsthjulet.
 *
 * Felles modul for velkomstbonusen: samme hjul vises på forsiden (teaser) og
 * på premiesiden (der man faktisk spinner). Rutene kommer fra
 * welcome_wheel_config() og spinnet avgjøres server-side av
 * spin_welcome_wheel() (schema.sql, seksjon 71), så hjulet kan ikke jukses
 * med i nettleseren.
 *
 *   StudillaWelcomeWheel.mount(root, { mode: "teaser" | "live", profile, onOpened, simulate })
 *
 * simulate: admin-simulering (js/admin-simulate.js) – spinner lokalt, uten
 *           serverkall, så ingen kode forbrukes.
 *
 * teaser: knappen sender utloggede til registrering og innloggede til
 *         premier.html#velkomst.
 * live:   knappen spinner hjulet (utloggede sendes til registrering).
 */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  if (!sb) return;

  const COLORS = ["#2ee87f", "#1b2434"];
  const RARITY_COLOR = { sjelden: "#4b8ef0", episk: "#9d6bf5", legendarisk: "#f0b429", vanlig: "#7c8aa0" };
  const TICKET_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5h16a1 1 0 0 1 1 1v2.6a2 2 0 0 0 0 3.8v2.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.6a2 2 0 0 0 0-3.8V7.5a1 1 0 0 1 1-1z"></path><line x1="9.5" y1="14.5" x2="14.5" y2="9.5"></line><circle cx="9.7" cy="10" r=".9"></circle><circle cx="14.3" cy="14" r=".9"></circle></svg>';
  const COPY_ICON = '<svg class="case-reveal-code-copy" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2.5"></rect><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"></path></svg>';
  const LINK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"></path><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"></path></svg>';
  const SIZE = 300;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function polar(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  // Samme hjul som det gamle lykkehjulet: annenhver rute grønn/mørk, med
  // teksten rotert langs radius. Her står partnernavnet i hver rute.
  function wheelSVG(slots) {
    const cx = SIZE / 2, cy = SIZE / 2, r = SIZE / 2 - 4;
    const n = slots.length;
    const seg = 360 / n;
    let paths = "", labels = "";
    for (let i = 0; i < n; i++) {
      const start = i * seg, end = (i + 1) * seg;
      const p1 = polar(cx, cy, r, start);
      const p2 = polar(cx, cy, r, end);
      // Oddetall ruter: siste rute får en tredje farge så to like ikke møtes.
      const color = n % 2 === 1 && i === n - 1 ? "#2a3a52" : COLORS[i % 2];
      paths += `<path d="M${cx} ${cy} L${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A${r} ${r} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z" fill="${color}"></path>`;
      const mid = start + seg / 2;
      const lp = polar(cx, cy, r * 0.62, mid);
      const textColor = color === "#2ee87f" ? "#0d1117" : "#e8edf5";
      if (slots[i].image_url) {
        // Kvadratisk logo ytterst i ruta (hvit plate så den synes på både grønn
        // og mørk rute), og rabattnavnet innenfor, begge langs radius.
        const sq = Math.min(r * 0.3, ((2 * Math.PI * r * 0.74) / n) * 0.8);
        const lg = polar(cx, cy, r * 0.76, mid);
        const tp = polar(cx, cy, r * 0.42, mid);
        const t = String(slots[i].title || slots[i].brand || "");
        const title = t.length > 11 ? t.slice(0, 10) + "…" : t;
        const rot = (mid - 90).toFixed(2);
        labels += `<g transform="rotate(${rot} ${lg.x.toFixed(2)} ${lg.y.toFixed(2)})">
          <rect x="${(lg.x - sq / 2).toFixed(2)}" y="${(lg.y - sq / 2).toFixed(2)}" width="${sq.toFixed(2)}" height="${sq.toFixed(2)}" rx="5" fill="#fff"></rect>
          <image href="${esc(slots[i].image_url)}" x="${(lg.x - sq / 2 + 3).toFixed(2)}" y="${(lg.y - sq / 2 + 3).toFixed(2)}" width="${(sq - 6).toFixed(2)}" height="${(sq - 6).toFixed(2)}" preserveAspectRatio="xMidYMid meet"></image>
        </g>
        <text x="${tp.x.toFixed(2)}" y="${tp.y.toFixed(2)}" fill="${textColor}" font-size="${(SIZE * 0.04).toFixed(1)}" font-weight="800" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rot} ${tp.x.toFixed(2)} ${tp.y.toFixed(2)})" font-family="Poppins, sans-serif">${esc(title)}</text>`;
        continue;
      }
      const label = String(slots[i].brand || "").split(" ")[0].slice(0, 10);
      labels += `<text x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}" fill="${textColor}" font-size="${(SIZE * 0.058).toFixed(1)}" font-weight="800" text-anchor="middle" dominant-baseline="middle" transform="rotate(${(mid - 90).toFixed(2)} ${lp.x.toFixed(2)} ${lp.y.toFixed(2)})" font-family="Poppins, sans-serif">${esc(label)}</text>`;
    }
    return `<svg width="100%" height="100%" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">
      <circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="#0d1117"></circle>
      ${paths}
      ${labels}
      <circle cx="${cx}" cy="${cy}" r="${SIZE * 0.11}" fill="#131a25" stroke="rgba(46,232,127,.5)" stroke-width="3"></circle>
    </svg>`;
  }

  async function fetchSlots() {
    const { data, error } = await sb.rpc("welcome_wheel_config");
    if (error || !data) return [];
    return data.slice().sort((a, b) => a.slot - b.slot);
  }

  function currentAngle(el) {
    const m = window.getComputedStyle(el).transform;
    if (!m || m === "none") return 0;
    const v = new DOMMatrixReadOnly(m);
    return (Math.atan2(v.b, v.a) * 180) / Math.PI;
  }

  async function mount(root, opts) {
    const options = opts || {};
    const live = options.mode === "live";
    const simulate = !!options.simulate;
    const profile = options.profile || null;
    const slots = await fetchSlots();
    // Uten hjul (admin har ikke valgt rabatter) vises ingenting.
    if (!slots.length) { root.hidden = true; return null; }

    let spinning = false;
    let opened = false;

    root.innerHTML = `
      <div style="border-radius:20px;border:1px solid var(--border-strong);background:linear-gradient(160deg,#18222f,#131a25);overflow:hidden;margin-bottom:40px">
        <div style="padding:22px 24px 16px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border)">
          <span style="width:44px;height:44px;flex:none;border-radius:12px;background:rgba(var(--accent-rgb), .12);border:1px dashed rgba(var(--accent-rgb), .45);display:flex;align-items:center;justify-content:center;color:var(--accent)">${TICKET_ICON}</span>
          <h3 style="margin:0;font-size:17px;font-weight:800;letter-spacing:-.02em;color:#fff">Velkomstbonusen</h3>
        </div>
        <div style="padding:26px 0 20px;background:radial-gradient(120% 100% at 50% 0%,rgba(var(--accent-rgb), .07),transparent 70%);display:flex;justify-content:center" data-ww-stage>
          <div class="welcome-wheel-wrap">
            <div class="welcome-wheel welcome-wheel-idle" data-ww-wheel>${wheelSVG(slots)}</div>
            <svg width="24" height="18" viewBox="0 0 18 14" class="welcome-wheel-pointer" aria-hidden="true"><path d="M9 14 L0 0 L18 0 Z" fill="#2ee87f"></path></svg>
          </div>
        </div>
        <div style="padding:6px 24px 24px;display:flex;flex-direction:column;gap:14px" data-ww-foot>
          <p class="section-sub" style="margin:0;text-align:center" data-ww-sub></p>
          <button type="button" class="btn-primary" style="width:100%" data-ww-btn></button>
        </div>
        <div style="padding:0 24px 24px" data-ww-reveal-slot></div>
      </div>`;
    root.hidden = false;

    const wheel = root.querySelector("[data-ww-wheel]");
    const btn = root.querySelector("[data-ww-btn]");
    const sub = root.querySelector("[data-ww-sub]");

    function setIdleText() {
      if (!profile) {
        sub.textContent = "Registrer deg gratis og spinn hjulet for å vinne en rabatt.";
        btn.textContent = "Registrer deg";
      } else {
        sub.textContent = "Spinn hjulet og vinn en rabatt – koden havner i «Mine koder».";
        btn.textContent = live ? "Spinn hjulet" : "Spinn velkomsthjulet";
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
      btn.textContent = "Hjulet spinner …";

      // Admin-simulering: trekker en tilfeldig rute lokalt uten å kalle
      // serveren, så ingen kode tas av og ingenting lagres.
      let data, error;
      if (simulate) {
        const pick = slots[Math.floor(Math.random() * slots.length)];
        data = Object.assign({}, pick, { code: "SIMULERT", link_url: "", already_opened: false });
      } else {
        ({ data, error } = await sb.rpc("spin_welcome_wheel").single());
      }
      if (error) {
        spinning = false;
        btn.disabled = false;
        setIdleText();
        window.alert(error.message.includes("Ingen rabatter")
          ? "Ingen rabatter er tilgjengelige akkurat nå. Prøv igjen senere."
          : error.message);
        return;
      }

      // Rutenummeret fra serveren er 1-basert og følger samme liste som hjulet.
      const idx = Math.min(slots.length - 1, Math.max(0, Number(data.slot) - 1));
      const seg = 360 / slots.length;
      const targetCenter = idx * seg + seg / 2;
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Fryser den rolige rotasjonen der den står, og spinner derfra.
      const start = currentAngle(wheel);
      wheel.classList.remove("welcome-wheel-idle");
      wheel.style.transition = "none";
      wheel.style.transform = `rotate(${start}deg)`;
      void wheel.offsetWidth;
      const jitter = (Math.random() - 0.5) * seg * 0.6;
      const delta = ((360 - targetCenter + jitter - (start % 360)) % 360 + 360) % 360;
      const end = start + 6 * 360 + delta;
      wheel.style.transition = reduced ? "none" : "transform 5s cubic-bezier(.17,.67,.12,1)";
      wheel.style.transform = `rotate(${end}deg)`;

      await new Promise((r) => setTimeout(r, reduced ? 50 : 5300));

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
