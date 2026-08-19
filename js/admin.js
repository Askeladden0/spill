/**
 * PixelPlay – adminpanel (admin.html).
 *
 * Sidemeny-dashbord med egne seksjoner (Oversikt/Statistikk/Spill/Nivåer og
 * premier/Brukere/Profilbilder). Alt lagres direkte i Supabase (samme
 * tabeller som resten av siden leser fra), slik at endringer her slår ut med
 * en gang på forsiden/rangering/premier/profiler, og omvendt.
 *
 * Rendring: enkel state -> render()-modell uten rammeverk. Tekstfelt som
 * lagres på "change" (blur) rendres ikke på nytt før lagring er ferdig, slik
 * at man ikke mister fokus midt i skriving. Søkefelt som filtrerer live
 * (brukersøk, kommandopalett) rendrer kun sitt eget resultat-delelement, ikke
 * hele inputen, av samme grunn.
 */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  const Auth = window.PixelPlayAuth;
  const NOK = (n) => Number(n || 0).toLocaleString("no-NO");
  const DAY_MS = 86400000;

  function escapeHTML(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function formatDate(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleDateString("no-NO");
  }

  const state = {
    view: "oversikt",
    profile: null,
    profiles: [],
    games: [],
    levels: [],
    gameRecords: [],
    avatarOptions: { colors: [], icons: [] },
    gamesNeedMigration: false,

    paletteOpen: false,
    paletteQuery: "",

    // Brukere
    query: "",
    sort: "created",
    dir: "desc",
    selected: new Set(),
    openUsers: new Set(),
    editingName: null,

    // Spill
    openGames: new Set(),
    dragFromId: null,

    // Nivåer
    openLevels: new Set(),

    // Statistikk
    signupRange: "7d",
    playRange: "7d",
  };

  const els = {};
  let toastTimer = null;

  function flash(msg) {
    if (!els.toast) return;
    els.toast.textContent = `✓ ${msg}`;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
  }

  // ---------------------------------------------------------------------
  // Datainnlasting
  // ---------------------------------------------------------------------

  async function loadGames() {
    const full = await sb
      .from("games")
      .select("id, name, genre, rating, points, time_estimate, description, thumbnail_url, icon_url, points_multiplier, is_daily_game, hidden, sort_order")
      .order("sort_order", { ascending: true });

    if (!full.error) return full.data || [];

    // Fallback for prosjekter som ikke har kjørt migrasjonen med
    // games.hidden ennå (se supabase/schema.sql, seksjon 16).
    state.gamesNeedMigration = true;
    const fallback = await sb
      .from("games")
      .select("id, name, genre, rating, points, time_estimate, description, thumbnail_url, icon_url, points_multiplier, is_daily_game, sort_order")
      .order("sort_order", { ascending: true });
    if (fallback.error) {
      console.error("[PixelPlay admin] Klarte ikke hente spill:", fallback.error.message);
      return [];
    }
    return (fallback.data || []).map((g) => ({ ...g, hidden: false }));
  }

  async function loadAll() {
    const [profilesRes, levelsRes, recordsRes, avatarRes, games] = await Promise.all([
      sb.from("profiles").select("id, username, xp, level, is_admin, created_at, avatar_icon, avatar_color").order("created_at", { ascending: false }),
      sb.from("levels").select("level_number, points_required, rewards").order("level_number", { ascending: true }),
      sb.from("game_records").select("user_id, game_id, score, created_at"),
      sb.from("avatar_options").select("colors, icons").eq("id", 1).single(),
      loadGames(),
    ]);

    if (profilesRes.error) console.error("[PixelPlay admin] Klarte ikke hente brukere:", profilesRes.error.message);
    if (levelsRes.error) console.error("[PixelPlay admin] Klarte ikke hente nivåer:", levelsRes.error.message);
    if (recordsRes.error) console.error("[PixelPlay admin] Klarte ikke hente spillrekorder:", recordsRes.error.message);
    if (avatarRes.error) console.error("[PixelPlay admin] Klarte ikke hente profilbilde-valg:", avatarRes.error.message);

    state.profiles = profilesRes.data || [];
    state.levels = levelsRes.data || [];
    state.gameRecords = recordsRes.data || [];
    state.avatarOptions = avatarRes.data || { colors: [], icons: [] };
    state.games = games;
  }

  // ---------------------------------------------------------------------
  // Navigasjon / topbar / palett / toast
  // ---------------------------------------------------------------------

  const VIEW_TITLES = {
    oversikt: "Oversikt", statistikk: "Statistikk", spill: "Spill",
    nivaaer: "Nivåer og premier", brukere: "Brukere", avatar: "Profilbilder",
    koder: "Rabattkoder", drift: "Drift",
  };
  const VIEW_HINTS = {
    spill: "Dra ⠿ for rekkefølge. Åpne et spill for navn, beskrivelse og bilder.",
    nivaaer: "Poengkravet avgjør når nivået låses opp automatisk.",
    brukere: "Klikk en rad for detaljer. Endringer lagres med én gang.",
    avatar: "Farger og ikoner nye brukere tildeles tilfeldig ved registrering.",
  };

  function goView(view) {
    state.view = view;
    state.paletteOpen = false;
    renderAll();
    els.main.scrollTo({ top: 0 });
  }

  function renderNav() {
    els.navButtons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.nav === state.view);
    });
  }

  function renderTopbar() {
    els.viewTitle.textContent = VIEW_TITLES[state.view] || "";
    els.viewHint.textContent = VIEW_HINTS[state.view] || "";
  }

  function paletteCommands() {
    const sections = Object.keys(VIEW_TITLES).map((id) => ({
      label: VIEW_TITLES[id], kind: "SEKSJON", icon: "→", go: () => goView(id),
    }));
    const games = state.games.map((g) => ({
      label: g.name, kind: "SPILL", icon: "▸",
      go: () => { state.openGames.add(g.id); goView("spill"); },
    }));
    const levels = state.levels.map((lv) => ({
      label: `Nivå ${lv.level_number}`, kind: "NIVÅ", icon: "▸",
      go: () => { state.openLevels.add(lv.level_number); goView("nivaaer"); },
    }));
    const users = state.profiles.map((u) => ({
      label: u.username, kind: "BRUKER", icon: "▸",
      go: () => { state.query = ""; state.openUsers.add(u.id); goView("brukere"); },
    }));
    const actions = [
      { label: "Nytt spill", kind: "HANDLING", icon: "+", go: () => { goView("spill"); addGame(); } },
      { label: "Nytt nivå", kind: "HANDLING", icon: "+", go: () => { goView("nivaaer"); addLevel(); } },
    ];
    return [...sections, ...games, ...levels, ...users, ...actions];
  }

  function renderPaletteResults() {
    const q = state.paletteQuery.trim().toLowerCase();
    const results = paletteCommands()
      .filter((c) => !q || c.label.toLowerCase().includes(q) || c.kind.toLowerCase().includes(q))
      .slice(0, 12);

    if (!results.length) {
      els.paletteResults.innerHTML = `<div class="admin-palette-empty">Ingen treff.</div>`;
      return;
    }
    els.paletteResults.innerHTML = results
      .map((r, i) => `
        <button type="button" class="admin-palette-item" data-palette-item="${i}">
          <span class="admin-palette-item-icon">${r.icon}</span>
          <span class="admin-palette-item-label">${escapeHTML(r.label)}</span>
          <span class="admin-palette-item-kind">${r.kind}</span>
        </button>
      `)
      .join("");
    els.paletteResults._commands = results;
  }

  function openPalette() {
    state.paletteOpen = true;
    state.paletteQuery = "";
    els.paletteOverlay.hidden = false;
    els.paletteInput.value = "";
    renderPaletteResults();
    setTimeout(() => els.paletteInput.focus(), 0);
  }

  function closePalette() {
    state.paletteOpen = false;
    els.paletteOverlay.hidden = true;
  }

  // ---------------------------------------------------------------------
  // Oversikt
  // ---------------------------------------------------------------------

  function buildSignupSeries(range) {
    const spanDays = { "7d": 7, "30d": 30, "90d": 90 }[range] || 7;
    const bucketDays = range === "90d" ? 7 : 1;
    const bucketCount = Math.round(spanDays / bucketDays);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const buckets = [];
    for (let i = bucketCount - 1; i >= 0; i--) {
      const endExclusive = new Date(todayStart.getTime() - i * bucketDays * DAY_MS + DAY_MS);
      const start = new Date(endExclusive.getTime() - bucketDays * DAY_MS);
      buckets.push({ start, endExclusive, count: 0 });
    }
    state.profiles.forEach((p) => {
      const t = new Date(p.created_at).getTime();
      const b = buckets.find((b) => t >= b.start.getTime() && t < b.endExclusive.getTime());
      if (b) b.count++;
    });

    const weekdayShort = ["sø", "ma", "ti", "on", "to", "fr", "lø"];
    return buckets.map((b, i) => {
      const dateLabel = bucketDays === 1
        ? (bucketCount <= 7 ? weekdayShort[b.start.getDay()] : String(b.start.getDate()).padStart(2, "0"))
        : `${b.start.getDate()}.${b.start.getMonth() + 1}`;
      const sparse = bucketCount > 14 && bucketDays === 1;
      return {
        value: b.count,
        label: sparse && i % 5 !== 0 ? "" : dateLabel,
        tip: bucketDays === 1
          ? `${b.start.toLocaleDateString("no-NO")} – ${b.count} nye`
          : `${b.start.toLocaleDateString("no-NO")}–${new Date(b.endExclusive.getTime() - DAY_MS).toLocaleDateString("no-NO")} – ${b.count} nye`,
      };
    });
  }

  function barsHTML(series, opts) {
    const max = Math.max(1, ...series.map((s) => s.value));
    const bars = series
      .map((s, i) => `
        <span class="admin-bar-col" title="${escapeHTML(s.tip)}">
          <span class="admin-bar-fill${i === series.length - 1 && opts.highlightLast ? " is-current" : ""}" style="height:${Math.max(2, Math.round((s.value / max) * 100))}%"></span>
          <span class="admin-bar-label">${escapeHTML(s.label)}</span>
        </span>
      `)
      .join("");
    const mid = Math.round(max / 2);
    return `
      <div class="admin-bars-row">
        <div class="admin-bars-axis"><span>${NOK(max)}</span><span>${NOK(mid)}</span><span>0</span></div>
        <div class="admin-bars">${bars}</div>
      </div>
    `;
  }

  function renderOversikt() {
    const series = buildSignupSeries("7d");
    const avg = Math.round(series.reduce((a, s) => a + s.value, 0) / series.length);
    const totalPoints = state.profiles.reduce((a, u) => a + (u.xp || 0), 0);
    const daily = state.games.find((g) => g.is_daily_game);
    const dailyPlaysDay = daily
      ? state.gameRecords.filter((r) => r.game_id === daily.id && Date.now() - new Date(r.created_at).getTime() < DAY_MS).length
      : 0;
    const newest = state.profiles.slice(0, 4);

    return `
      <div class="admin-section">
        <div class="admin-card">
          <div class="admin-card-head">
            <div>
              <h2>Nye brukere</h2>
              <span class="admin-card-sub">Siste 7 dager</span>
            </div>
            <span class="admin-card-spacer"></span>
            <span class="admin-chart-stats">
              <span class="admin-chart-stat">
                <span class="admin-chart-stat-label">SNITT PER DAG</span>
                <span class="admin-chart-stat-value is-accent">${NOK(avg)}</span>
              </span>
            </span>
          </div>
          ${barsHTML(series, { highlightLast: true })}
        </div>

        <div class="admin-kpi-grid">
          <div class="admin-kpi-card">
            <span class="admin-kpi-label">BRUKERE</span>
            <span class="admin-kpi-value">${NOK(state.profiles.length)}</span>
            <span class="admin-kpi-delta">totalt registrert</span>
          </div>
          <div class="admin-kpi-card">
            <span class="admin-kpi-label">POENG UTDELT</span>
            <span class="admin-kpi-value">${NOK(totalPoints)}</span>
            <span class="admin-kpi-delta">summen av alles poeng</span>
          </div>
          <div class="admin-kpi-card">
            <span class="admin-kpi-label">SPILL</span>
            <span class="admin-kpi-value">${NOK(state.games.length)}</span>
            <span class="admin-kpi-delta">${state.games.filter((g) => g.hidden).length} skjult</span>
          </div>
          <div class="admin-kpi-card">
            <span class="admin-kpi-label">NIVÅER</span>
            <span class="admin-kpi-value">${NOK(state.levels.length)}</span>
            <span class="admin-kpi-delta">i premiestigen</span>
          </div>
        </div>

        <div class="admin-split-grid">
          <div class="admin-card admin-daily-card">
            <div class="admin-card-head">
              <h2>Dagens spill</h2>
              <span class="admin-card-spacer"></span>
              <button type="button" class="admin-btn-ghost" data-go="spill">Bytt spill</button>
            </div>
            <div class="admin-daily-body">
              <div class="admin-daily-cover">${daily && daily.thumbnail_url ? `<img src="${escapeHTML(daily.thumbnail_url)}" alt="">` : ""}</div>
              <div class="admin-daily-meta">
                <span class="admin-daily-name">${daily ? escapeHTML(daily.name) : "Ingen valgt"}</span>
                <span class="admin-daily-note">Vises i heltefeltet på forsiden akkurat nå, gir 1,5x poeng · roterer automatisk til neste spill hver 24. time</span>
                <span class="admin-daily-plays">${NOK(dailyPlaysDay)} runder siste 24 timer</span>
              </div>
            </div>
          </div>

          <div class="admin-card admin-newest-card">
            <div class="admin-newest-head">
              <h2>Nyeste brukere</h2>
              <button type="button" class="admin-link-btn" data-go="brukere">Se alle →</button>
            </div>
            ${newest.length ? newest.map((u) => `
              <div class="admin-newest-row">
                ${window.PixelPlayAvatars.avatarBadgeHTML(u.avatar_color, u.avatar_icon, 30, { className: "admin-icon-badge" })}
                <span class="admin-newest-name">${escapeHTML(u.username)}</span>
                <span class="admin-newest-date">${formatDate(u.created_at)}</span>
              </div>
            `).join("") : `<div class="admin-newest-row"><span class="admin-newest-name">Ingen brukere ennå.</span></div>`}
          </div>
        </div>

        <div>
          <h2 style="margin:0 0 12px;font-size:14.5px;font-weight:800;color:var(--text-strong)">Hurtighandlinger</h2>
          <div class="admin-quick-actions">
            <button type="button" class="admin-quick-btn" data-quick="new-game"><span>+</span>Nytt spill</button>
            <button type="button" class="admin-quick-btn" data-quick="new-level"><span>+</span>Nytt nivå</button>
            <button type="button" class="admin-quick-btn" data-open-palette><span>⌕</span>Finn bruker</button>
            <button type="button" class="admin-quick-btn" data-go="avatar"><span>◔</span>Profilbilder</button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Statistikk
  // ---------------------------------------------------------------------

  function renderStatistikk() {
    const series = buildSignupSeries(state.signupRange);
    const avg = Math.round(series.reduce((a, s) => a + s.value, 0) / series.length);
    const rangeLabel = { "7d": "Siste 7 dager", "30d": "Siste 30 dager", "90d": "Siste 90 dager, samlet per uke" }[state.signupRange];

    const pointsByGame = new Map();
    const countAllByGame = new Map();
    const cutoff = { "24t": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, "90d": 90 * DAY_MS }[state.playRange] || Infinity;
    const countRangeByGame = new Map();
    state.gameRecords.forEach((r) => {
      pointsByGame.set(r.game_id, (pointsByGame.get(r.game_id) || 0) + (Number(r.score) || 0));
      countAllByGame.set(r.game_id, (countAllByGame.get(r.game_id) || 0) + 1);
      if (Date.now() - new Date(r.created_at).getTime() <= cutoff) {
        countRangeByGame.set(r.game_id, (countRangeByGame.get(r.game_id) || 0) + 1);
      }
    });

    const pointsTotal = [...pointsByGame.values()].reduce((a, v) => a + v, 0);
    const pointsMax = Math.max(1, ...pointsByGame.values());
    const pointsShare = state.games
      .map((g) => ({ name: g.name, value: pointsByGame.get(g.id) || 0 }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    const playsMax = Math.max(1, ...countRangeByGame.values());
    const gameShare = state.games
      .map((g) => ({ name: g.name, value: countRangeByGame.get(g.id) || 0 }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    const rangeBtns = (current, dataAttr, options) => options
      .map((id) => `<button type="button" class="admin-range-btn${current === id ? " is-active" : ""}" data-${dataAttr}="${id}">${id === "24t" ? "24 timer" : id === "7d" ? "7 dager" : id === "30d" ? "30 dager" : "90 dager"}</button>`)
      .join("");

    return `
      <div class="admin-section">
        <div class="admin-card">
          <div class="admin-card-head">
            <div>
              <h2>Nye brukere per ${state.signupRange === "90d" ? "uke" : "dag"}</h2>
              <span class="admin-card-sub">${rangeLabel}</span>
            </div>
            <span class="admin-card-spacer"></span>
            <span class="admin-range-switch">${rangeBtns(state.signupRange, "signup-range", ["7d", "30d", "90d"])}</span>
            <span class="admin-chart-stats">
              <span class="admin-chart-stat">
                <span class="admin-chart-stat-label">SNITT</span>
                <span class="admin-chart-stat-value is-accent">${NOK(avg)}</span>
              </span>
            </span>
          </div>
          ${barsHTML(series, { highlightLast: true })}
        </div>

        <div class="admin-card">
          <div class="admin-card-head">
            <h2>Poeng samlet opp per spill</h2>
            <span class="admin-card-spacer"></span>
            <span class="admin-card-sub">${NOK(pointsTotal)} totalt</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${pointsShare.length ? pointsShare.map((p, i) => `
              <span class="admin-progress-row">
                <span class="admin-progress-name">${escapeHTML(p.name)}</span>
                <span class="admin-progress-track"><span class="admin-progress-fill${i === 0 ? " is-top" : ""}" style="width:${Math.round((p.value / pointsMax) * 100)}%"></span></span>
                <span class="admin-progress-value">${NOK(p.value)}</span>
              </span>
            `).join("") : `<p class="admin-card-sub" style="margin:0">Ingen poeng registrert ennå.</p>`}
          </div>
        </div>

        <div class="admin-card">
          <div class="admin-card-head">
            <h2>Spilte runder per spill</h2>
            <span class="admin-card-spacer"></span>
            <span class="admin-range-switch">${rangeBtns(state.playRange, "play-range", ["24t", "7d", "30d", "90d"])}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${gameShare.length ? gameShare.map((g, i) => `
              <span class="admin-progress-row">
                <span class="admin-progress-name">${escapeHTML(g.name)}</span>
                <span class="admin-progress-track"><span class="admin-progress-fill${i === 0 ? " is-top" : ""}" style="width:${Math.round((g.value / playsMax) * 100)}%"></span></span>
                <span class="admin-progress-value">${NOK(g.value)}</span>
              </span>
            `).join("") : `<p class="admin-card-sub" style="margin:0">Ingen runder spilt i denne perioden.</p>`}
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Spill
  // ---------------------------------------------------------------------

  async function persistGameOrder() {
    await Promise.all(state.games.map((g, i) => sb.from("games").update({ sort_order: i }).eq("id", g.id)));
  }

  async function addGame() {
    const raw = window.prompt("Unik id for spillet (kun a–z, 0–9 og bindestrek). Brukes i URL-en og som filnavn for bilder:", "");
    if (raw == null) return;
    const id = raw.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(id)) return flash("Ugyldig id. Bruk kun a–z, 0–9 og bindestrek (2–40 tegn).");
    if (state.games.some((g) => g.id === id)) return flash("Denne id-en er allerede i bruk.");

    const sortOrder = state.games.reduce((max, g) => Math.max(max, g.sort_order || 0), 0) + 1;
    const payload = { id, name: "Nytt spill", sort_order: sortOrder };
    if (!state.gamesNeedMigration) payload.hidden = true;

    const { data, error } = await sb.from("games").insert(payload).select().single();
    if (error) return flash(Auth.friendlyAuthError(error));
    state.games.push({ ...data, hidden: data.hidden ?? true });
    state.openGames.add(id);
    goView("spill");
    flash("Nytt spill opprettet (skjult)");
  }

  async function setDailyGame(id) {
    const { error } = await sb.rpc("set_daily_game", { p_game_id: id });
    if (error) return flash(Auth.friendlyAuthError(error));
    state.games.forEach((g) => { g.is_daily_game = g.id === id; });
    renderMain();
    flash("Dagens spill oppdatert");
  }

  async function toggleGameHidden(g) {
    if (state.gamesNeedMigration) return flash("Kjør supabase/schema.sql på nytt for å låse opp “skjult spill”.");
    const next = !g.hidden;
    const { error } = await sb.from("games").update({ hidden: next }).eq("id", g.id);
    if (error) return flash(Auth.friendlyAuthError(error));
    g.hidden = next;
    renderMain();
    flash(next ? "Spillet er skjult" : "Spillet er synlig igjen");
  }

  async function saveGameField(g, field, value) {
    const { error } = await sb.from("games").update({ [field]: value }).eq("id", g.id);
    if (error) return flash(Auth.friendlyAuthError(error));
    g[field] = value;
    // Trygt å rendre på nytt her: "change" fyrer først når feltet mister
    // fokus, så ingen aktiv skriving avbrytes. Sørger for at f.eks. et nytt
    // navn også slår ut i den sammenslåtte rad-tittelen med én gang.
    renderMain();
    flash("Lagret!");
  }

  async function deleteGame(g) {
    if (!window.confirm(`Slette spillet "${g.name}"? Dette kan ikke angres.`)) return;
    const { error } = await sb.from("games").delete().eq("id", g.id);
    if (error) return flash(Auth.friendlyAuthError(error));
    state.games = state.games.filter((x) => x.id !== g.id);
    state.openGames.delete(g.id);
    renderMain();
    flash("Spill slettet");
  }

  function renderSpill() {
    const migrationNote = state.gamesNeedMigration
      ? `<p class="admin-card-sub" style="margin:0">⚠ Kjør <code>supabase/schema.sql</code> på nytt i Supabase for å ta i bruk "skjul spill".</p>`
      : "";

    const rows = state.games.map((g, i) => {
      const open = state.openGames.has(g.id);
      return `
        <div class="admin-row-card${g.is_daily_game ? " is-daily" : ""}${g.hidden ? " is-hidden" : ""}" data-game-row="${g.id}" draggable="true">
          <div class="admin-row-head" data-game-toggle="${g.id}">
            <span class="admin-drag-handle">⠿</span>
            <span class="admin-row-thumb">${g.thumbnail_url ? `<img src="${escapeHTML(g.thumbnail_url)}" alt="">` : ""}</span>
            <span class="admin-row-titles">
              <span class="admin-row-title-line">
                <span class="admin-row-title">${escapeHTML(g.name)}</span>
                ${g.is_daily_game ? `<span class="admin-pill-daily">★ DAGENS</span>` : ""}
                ${g.hidden ? `<span class="admin-pill-hidden">SKJULT</span>` : ""}
              </span>
              <span class="admin-row-sub">${escapeHTML(g.id)}</span>
            </span>
            <span class="admin-row-side-label">${g.hidden ? "Skjult" : "Synlig"}</span>
            <button type="button" class="admin-switch${g.hidden ? "" : " is-on"}" data-game-hidden-toggle="${g.id}" aria-label="Bytt synlighet">
              <span class="admin-switch-track"></span><span class="admin-switch-knob"></span>
            </button>
            <span class="admin-chevron">${open ? "▲" : "▼"}</span>
          </div>
          ${open ? `
            <div class="admin-row-detail">
              <label class="admin-field">NAVN
                <input type="text" value="${escapeHTML(g.name)}" data-game-field="name" data-game-id="${g.id}">
              </label>
              <label class="admin-field">COVER-BILDE (URL)
                <input type="text" value="${escapeHTML(g.thumbnail_url || "")}" placeholder="assets/img/games/${g.id}.svg" data-game-field="thumbnail_url" data-game-id="${g.id}">
              </label>
              <label class="admin-field is-wide">BESKRIVELSE
                <textarea rows="2" data-game-field="description" data-game-id="${g.id}">${escapeHTML(g.description || "")}</textarea>
              </label>
              <label class="admin-field">IKON (URL)
                <input type="text" value="${escapeHTML(g.icon_url || "")}" placeholder="assets/img/icons/${g.id}.svg" data-game-field="icon_url" data-game-id="${g.id}">
              </label>
              <div class="admin-row-actions">
                <button type="button" class="btn-start" style="width:auto;padding:10px 15px;opacity:${g.is_daily_game ? ".55" : "1"}" data-game-set-daily="${g.id}">${g.is_daily_game ? "★ Er dagens spill" : "Sett som dagens spill"}</button>
                <button type="button" class="btn-danger" style="padding:10px 15px" data-game-delete="${g.id}">Slett spill</button>
              </div>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    return `
      <div class="admin-section">
        <div class="admin-toolbar">
          <span class="admin-toolbar-count">${state.games.length} spill</span>
          <span class="admin-card-spacer"></span>
          <span class="admin-toolbar-hint">Dra ⠿ for å endre rekkefølgen på forsiden</span>
          <button type="button" class="btn-start" style="width:auto;padding:10px 16px" data-quick="new-game">+ Nytt spill</button>
        </div>
        ${migrationNote}
        <div class="admin-row-list" data-games-list>
          ${rows || `<p class="admin-card-sub">Ingen spill ennå.</p>`}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Nivåer og premier
  // ---------------------------------------------------------------------

  async function addLevel() {
    const next = state.levels.reduce((max, l) => Math.max(max, l.level_number), 0) + 1;
    const prevPoints = state.levels.reduce((max, l) => Math.max(max, l.points_required), 0);
    const points = prevPoints + 1000;
    const { data, error } = await sb.from("levels").insert({ level_number: next, points_required: points, rewards: [] }).select().single();
    if (error) return flash(Auth.friendlyAuthError(error));
    state.levels.push(data);
    state.openLevels.add(next);
    goView("nivaaer");
    flash(`Nivå ${next} lagt til`);
  }

  async function saveLevel(lv, fields) {
    const { error } = await sb.from("levels").update(fields).eq("level_number", lv.level_number);
    if (error) { flash(Auth.friendlyAuthError(error)); return false; }
    Object.assign(lv, fields);
    return true;
  }

  async function deleteLevel(lv) {
    if (!window.confirm(`Slette nivå ${lv.level_number}? Dette kan ikke angres.`)) return;
    const { error } = await sb.from("levels").delete().eq("level_number", lv.level_number);
    if (error) return flash(Auth.friendlyAuthError(error));
    state.levels = state.levels.filter((l) => l.level_number !== lv.level_number);
    state.openLevels.delete(lv.level_number);
    renderMain();
    flash("Nivå slettet");
  }

  function collectRewards(card) {
    return Array.from(card.querySelectorAll(".admin-reward-row")).map((row) => ({
      brand: row.querySelector('[data-reward-field="brand"]').value.trim(),
      title: row.querySelector('[data-reward-field="title"]').value.trim(),
      sub: row.querySelector('[data-reward-field="sub"]').value.trim(),
    }));
  }

  function renderNivaaer() {
    const rows = state.levels.map((lv) => {
      const open = state.openLevels.has(lv.level_number);
      const rewards = lv.rewards || [];
      return `
        <div class="admin-row-card" data-level-card="${lv.level_number}">
          <div class="admin-row-head" data-level-toggle="${lv.level_number}">
            <span class="admin-level-badge">${lv.level_number}</span>
            <span class="admin-row-titles">
              <span class="admin-row-title">Nivå ${lv.level_number}</span>
              <span class="admin-row-sub" style="font-family:inherit">${NOK(lv.points_required)} poeng kreves</span>
            </span>
            <span class="admin-row-side-label">${rewards.length} premie${rewards.length === 1 ? "" : "r"}</span>
            <span class="admin-chevron">${open ? "▲" : "▼"}</span>
          </div>
          ${open ? `
            <div class="admin-level-detail">
              <label class="admin-field" style="max-width:200px">POENG KREVD
                <input type="number" min="0" value="${lv.points_required}" data-level-points="${lv.level_number}">
              </label>
              <span style="font-size:11.5px;font-weight:700;letter-spacing:.04em;color:var(--muted)">PREMIER</span>
              <div class="admin-reward-list">
                ${rewards.map((r, ri) => `
                  <div class="admin-reward-row">
                    <input type="text" value="${escapeHTML(r.brand)}" placeholder="Merke" data-reward-field="brand" data-reward-level="${lv.level_number}" data-reward-index="${ri}">
                    <input type="text" value="${escapeHTML(r.title)}" placeholder="Tittel" data-reward-field="title" data-reward-level="${lv.level_number}" data-reward-index="${ri}">
                    <input type="text" value="${escapeHTML(r.sub || "")}" placeholder="Undertekst" data-reward-field="sub" data-reward-level="${lv.level_number}" data-reward-index="${ri}">
                    <span class="admin-reward-info" title="Undertekst: kort forklaring som vises under premien på Premier-siden">i</span>
                    <button type="button" class="admin-btn-ghost is-danger" data-reward-remove="${ri}" data-reward-level="${lv.level_number}">Fjern</button>
                  </div>
                `).join("")}
              </div>
              <div style="display:flex;gap:10px">
                <button type="button" class="btn-start" style="width:auto;padding:10px 15px" data-level-add-reward="${lv.level_number}">+ Legg til premie</button>
                <button type="button" class="btn-danger" style="padding:10px 15px" data-level-delete="${lv.level_number}">Slett nivå</button>
              </div>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    return `
      <div class="admin-section">
        <div class="admin-toolbar">
          <span class="admin-toolbar-count">${state.levels.length} nivåer</span>
          <span class="admin-card-spacer"></span>
          <button type="button" class="btn-start" style="width:auto;padding:10px 16px" data-quick="new-level">+ Nytt nivå</button>
        </div>
        <div class="admin-row-list">${rows || `<p class="admin-card-sub">Ingen nivåer ennå.</p>`}</div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Brukere
  // ---------------------------------------------------------------------

  function sortedUsers() {
    const q = state.query.trim().toLowerCase();
    let list = state.profiles.filter((u) => !q || u.username.toLowerCase().includes(q));
    const key = state.sort;
    list = list.slice().sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === "created") { av = new Date(a.created_at).getTime(); bv = new Date(b.created_at).getTime(); }
      if (key === "admin") { av = a.is_admin ? 1 : 0; bv = b.is_admin ? 1 : 0; }
      if (typeof av === "string") return state.dir === "asc" ? av.localeCompare(bv, "no") : bv.localeCompare(av, "no");
      return state.dir === "asc" ? av - bv : bv - av;
    });
    return list;
  }

  const USER_COLS = [
    ["username", "BRUKER"], ["xp", "POENG"], ["level", "NIVÅ"], ["created", "REGISTRERT"], ["admin", "ADMIN"],
  ];

  function renderUsersTableAndBulkbar() {
    const users = sortedUsers();
    const allSelected = users.length > 0 && users.every((u) => state.selected.has(u.id));

    const bulkbar = state.selected.size ? `
      <div class="admin-bulkbar">
        <span class="admin-bulkbar-label">${state.selected.size} valgt</span>
        <span class="admin-card-spacer"></span>
        <button type="button" class="admin-btn-ghost" data-bulk-admin>Gi admin</button>
        <button type="button" class="admin-btn-ghost" data-bulk-unadmin>Fjern admin</button>
        <button type="button" class="admin-btn-ghost is-danger" data-bulk-delete>Slett valgte</button>
        <button type="button" class="admin-btn-text" data-clear-selection>Avbryt</button>
      </div>
    ` : "";

    const headCols = USER_COLS.map(([id, label]) => `
      <button type="button" class="admin-users-sort-btn${id !== "username" ? " align-end" : ""}${state.sort === id ? " is-active" : ""}" data-sort-col="${id}">
        ${label}<span style="font-size:9px">${state.sort === id ? (state.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    `).join("");

    const rows = users.map((u) => {
      const selected = state.selected.has(u.id);
      const open = state.openUsers.has(u.id);
      const isSelf = state.profile && u.id === state.profile.id;
      const editingName = state.editingName === u.id;
      return `
        <div class="admin-user-row${selected ? " is-selected" : ""}">
          <div class="admin-user-row-main" data-user-toggle="${u.id}">
            <button type="button" class="admin-checkbox${selected ? " is-checked" : ""}" data-user-select="${u.id}">${selected ? "✓" : ""}</button>
            <span class="admin-user-identity">
              ${window.PixelPlayAvatars.avatarBadgeHTML(u.avatar_color, u.avatar_icon, 30, { className: "admin-icon-badge" })}
              <span class="admin-user-name">${escapeHTML(u.username)}</span>
              ${u.is_admin ? `<span class="admin-pill-admin">ADMIN</span>` : ""}
            </span>
            <span class="admin-user-num">${NOK(u.xp)}</span>
            <span class="admin-user-num">${u.level}</span>
            <span class="admin-user-date">${formatDate(u.created_at)}</span>
            <button type="button" class="admin-switch${u.is_admin ? " is-on" : ""}" data-user-admin-toggle="${u.id}" ${isSelf ? "disabled style=\"opacity:.4;cursor:not-allowed\"" : ""} aria-label="Admin-tilgang">
              <span class="admin-switch-track"></span><span class="admin-switch-knob"></span>
            </button>
            <span class="admin-chevron">${open ? "▲" : "▼"}</span>
          </div>
          ${open ? `
            <div class="admin-user-detail">
              <div class="admin-user-detail-top">
                ${editingName
                  ? `<input type="text" class="admin-user-rename-input" value="${escapeHTML(u.username)}" data-user-rename="${u.id}">`
                  : `<span class="admin-user-detail-name">${escapeHTML(u.username)}</span>`}
                <button type="button" class="admin-btn-text" data-user-edit-name="${u.id}">${editingName ? "Ferdig" : "Endre navn"}</button>
                <span class="admin-user-detail-spacer"></span>
                <a href="spillerprofil.html?u=${encodeURIComponent(u.username)}" target="_blank" class="admin-profile-link">Offentlig profil ↗</a>
                ${isSelf ? "" : `<button type="button" class="admin-delete-btn" data-user-delete="${u.id}">Slett</button>`}
              </div>
              <div class="admin-stat-grid">
                <label class="admin-stat-box">POENG<input type="number" min="0" value="${u.xp}" data-user-xp="${u.id}"></label>
                <label class="admin-stat-box">NIVÅ<input type="number" min="1" value="${u.level}" data-user-level="${u.id}"></label>
              </div>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    return `
      ${bulkbar}
      <div class="admin-users-table">
        <div class="admin-users-cols">
          <button type="button" class="admin-checkbox${allSelected ? " is-checked" : ""}" data-select-all>${allSelected ? "✓" : ""}</button>
          ${headCols}
          <span></span>
        </div>
        ${rows || `<div class="admin-empty-users">Ingen brukere passer søket.</div>`}
      </div>
    `;
  }

  function updateUsersCount() {
    if (els.usersCount) els.usersCount.textContent = `${sortedUsers().length} av ${state.profiles.length} brukere`;
  }

  function renderUsersDynamic() {
    if (els.usersDynamic) {
      els.usersDynamic.innerHTML = renderUsersTableAndBulkbar();
      updateUsersCount();
    }
  }

  function renderBrukere() {
    return `
      <div class="admin-section">
        <div class="admin-toolbar">
          <input type="text" class="admin-search-input" placeholder="Søk på brukernavn …" value="${escapeHTML(state.query)}" data-users-search>
          <span class="admin-card-spacer"></span>
          <span class="admin-toolbar-count" data-users-count></span>
        </div>
        <div data-users-dynamic></div>
      </div>
    `;
  }

  async function renameUser(u, rawValue) {
    const value = rawValue.trim();
    const err = Auth.validateUsername(value);
    if (err) { flash(err); renderUsersDynamic(); return; }
    if (value.toLowerCase() !== u.username.toLowerCase()) {
      let taken;
      try { taken = await Auth.isUsernameTaken(value); } catch (e) { return flash(Auth.friendlyAuthError(e)); }
      if (taken) { flash("Brukernavnet er allerede i bruk."); renderUsersDynamic(); return; }
    }
    const { error } = await sb.from("profiles").update({ username: value, username_is_default: false }).eq("id", u.id);
    if (error) return flash(Auth.friendlyAuthError(error));
    u.username = value;
    state.editingName = null;
    renderUsersDynamic();
    flash("Brukernavn lagret");
  }

  async function saveUserField(u, field, rawValue) {
    const value = Number(rawValue);
    const min = field === "level" ? 1 : 0;
    if (!Number.isFinite(value) || value < min) return flash(`Ugyldig ${field === "level" ? "nivå" : "poengverdi"}.`);
    const { error } = await sb.from("profiles").update({ [field]: value }).eq("id", u.id);
    if (error) return flash(Auth.friendlyAuthError(error));
    u[field] = value;
    renderUsersDynamic();
    flash(field === "level" ? "Nivå lagret" : "Poeng lagret");
  }

  async function toggleUserAdmin(u) {
    if (state.profile && u.id === state.profile.id) return flash("Du kan ikke endre din egen admin-tilgang herfra.");
    const next = !u.is_admin;
    const { error } = await sb.from("profiles").update({ is_admin: next }).eq("id", u.id);
    if (error) return flash(Auth.friendlyAuthError(error));
    u.is_admin = next;
    renderUsersDynamic();
    flash(next ? "Admin-tilgang gitt" : "Admin-tilgang fjernet");
  }

  async function deleteUser(u) {
    if (state.profile && u.id === state.profile.id) return flash("Du kan ikke slette din egen konto herfra.");
    if (!window.confirm(`Slette brukeren ${u.username}? Dette kan ikke angres.`)) return;
    const { error } = await sb.rpc("admin_delete_user", { p_user_id: u.id });
    if (error) return flash(Auth.friendlyAuthError(error));
    state.profiles = state.profiles.filter((x) => x.id !== u.id);
    state.selected.delete(u.id);
    state.openUsers.delete(u.id);
    renderUsersDynamic();
    flash("Bruker slettet");
  }

  async function bulkSetAdmin(next) {
    const ids = [...state.selected].filter((id) => !state.profile || id !== state.profile.id);
    if (!ids.length) return flash("Ingen gyldige brukere valgt.");
    const { error } = await sb.from("profiles").update({ is_admin: next }).in("id", ids);
    if (error) return flash(Auth.friendlyAuthError(error));
    state.profiles.forEach((u) => { if (ids.includes(u.id)) u.is_admin = next; });
    state.selected.clear();
    renderUsersDynamic();
    flash(next ? "Admin-tilgang gitt" : "Admin-tilgang fjernet");
  }

  async function bulkDelete() {
    const ids = [...state.selected].filter((id) => !state.profile || id !== state.profile.id);
    if (!ids.length) return flash("Kan ikke slette din egen konto herfra.");
    if (!window.confirm(`Slette ${ids.length} bruker${ids.length === 1 ? "" : "e"}? Dette kan ikke angres.`)) return;
    const results = await Promise.all(ids.map(async (id) => ({ id, error: (await sb.rpc("admin_delete_user", { p_user_id: id })).error })));
    const okIds = results.filter((r) => !r.error).map((r) => r.id);
    state.profiles = state.profiles.filter((u) => !okIds.includes(u.id));
    state.selected.clear();
    renderUsersDynamic();
    flash(okIds.length === ids.length ? "Brukere slettet" : `${okIds.length} av ${ids.length} slettet`);
  }

  // ---------------------------------------------------------------------
  // Profilbilder
  // ---------------------------------------------------------------------

  async function saveAvatarOptions() {
    const { error } = await sb
      .from("avatar_options")
      .update({ colors: state.avatarOptions.colors, icons: state.avatarOptions.icons, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) { flash(Auth.friendlyAuthError(error)); return false; }
    return true;
  }

  function renderAvatar() {
    const colors = state.avatarOptions.colors || [];
    const icons = state.avatarOptions.icons || [];
    return `
      <div class="admin-avatar-grid">
        <div class="admin-card">
          <div>
            <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Farger</h2>
            <span class="admin-card-sub">Nye brukere får én tilfeldig farge herfra.</span>
          </div>
          <div class="swatch-row">
            ${colors.map((c, i) => `
              <span class="swatch swatch-removable" style="background:${escapeHTML(c)}">
                <button type="button" data-remove-color="${i}" aria-label="Fjern farge">×</button>
              </span>
            `).join("")}
          </div>
          <div class="admin-avatar-add">
            <input type="text" placeholder="#4287f5" data-color-draft>
            <button type="button" class="btn-start" style="width:auto;padding:11px 20px" data-add-color>Legg til</button>
          </div>
        </div>
        <div class="admin-card">
          <div>
            <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Figurer</h2>
            <span class="admin-card-sub">Velg hvilke figurer nye brukere kan få tildelt og selv velge mellom.</span>
          </div>
          <div class="figure-grid" style="max-width:420px">
            ${window.PixelPlayAvatars.FIGURE_KEYS.map((key) => `
              <button type="button" class="figure-swatch ${icons.includes(key) ? "is-selected" : ""}" data-toggle-icon="${key}" title="${window.PixelPlayAvatars.figureLabel(key)}">${window.PixelPlayAvatars.figureSVG(key)}</button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Tomme "Senere"-seksjoner
  // ---------------------------------------------------------------------

  function renderEmptyView() {
    const isKoder = state.view === "koder";
    return `
      <div class="admin-empty-view">
        <span class="admin-empty-icon">${isKoder ? "%" : "⚙"}</span>
        <h2>${isKoder ? "Rabattkoder kommer hit" : "Drift kommer hit"}</h2>
        <p>${isKoder
          ? "Oversikt over hentede koder per bruker og nivå, med mulighet for å laste opp egne kodelister. Seksjonen er satt av i menyen slik at den kan bygges videre uten å endre resten av panelet."
          : "Statusfelt for Supabase, feillogg og vedlikeholdsmodus. Nye admin-seksjoner legges inn som ett nytt punkt i sidemenyen med samme mønster som resten."}</p>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Hoved-render
  // ---------------------------------------------------------------------

  function renderMain() {
    const renderers = {
      oversikt: renderOversikt,
      statistikk: renderStatistikk,
      spill: renderSpill,
      nivaaer: renderNivaaer,
      brukere: renderBrukere,
      avatar: renderAvatar,
      koder: renderEmptyView,
      drift: renderEmptyView,
    };
    const fn = renderers[state.view] || renderOversikt;
    els.main.innerHTML = fn();
    if (state.view === "brukere") renderUsersDynamic();
  }

  function renderAll() {
    renderNav();
    renderTopbar();
    renderMain();
  }

  // ---------------------------------------------------------------------
  // Event-delegering
  // ---------------------------------------------------------------------

  function findGame(id) { return state.games.find((g) => g.id === id); }
  function findLevel(n) { return state.levels.find((l) => l.level_number === n); }
  function findUser(id) { return state.profiles.find((u) => u.id === id); }

  function onMainClick(e) {
    const t = e.target;

    if (t.closest("[data-open-palette]")) return openPalette();

    const goBtn = t.closest("[data-go]");
    if (goBtn) return goView(goBtn.dataset.go);

    const quick = t.closest("[data-quick]");
    if (quick) {
      if (quick.dataset.quick === "new-game") return addGame();
      if (quick.dataset.quick === "new-level") return addLevel();
    }

    // Spill
    const gameToggle = t.closest("[data-game-toggle]");
    if (gameToggle && !t.closest("[data-game-hidden-toggle]")) {
      const id = gameToggle.dataset.gameToggle;
      state.openGames.has(id) ? state.openGames.delete(id) : state.openGames.add(id);
      return renderMain();
    }
    const hiddenToggle = t.closest("[data-game-hidden-toggle]");
    if (hiddenToggle) { e.stopPropagation(); const g = findGame(hiddenToggle.dataset.gameHiddenToggle); if (g) toggleGameHidden(g); return; }
    const setDaily = t.closest("[data-game-set-daily]");
    if (setDaily) return setDailyGame(setDaily.dataset.gameSetDaily);
    const delGame = t.closest("[data-game-delete]");
    if (delGame) { const g = findGame(delGame.dataset.gameDelete); if (g) deleteGame(g); return; }

    // Nivåer
    const lvToggle = t.closest("[data-level-toggle]");
    if (lvToggle) {
      const n = Number(lvToggle.dataset.levelToggle);
      state.openLevels.has(n) ? state.openLevels.delete(n) : state.openLevels.add(n);
      return renderMain();
    }
    const addReward = t.closest("[data-level-add-reward]");
    if (addReward) {
      const lv = findLevel(Number(addReward.dataset.levelAddReward));
      if (!lv) return;
      const rewards = (lv.rewards || []).concat({ brand: "Ny partner", title: "Ny premie", sub: "" });
      saveLevel(lv, { rewards }).then((ok) => { if (ok) { renderMain(); flash("Premie lagt til"); } });
      return;
    }
    const removeReward = t.closest("[data-reward-remove]");
    if (removeReward) {
      const lv = findLevel(Number(removeReward.dataset.rewardLevel));
      if (!lv) return;
      const card = removeReward.closest("[data-level-card]");
      const rewards = collectRewards(card);
      rewards.splice(Number(removeReward.dataset.rewardRemove), 1);
      saveLevel(lv, { rewards }).then((ok) => { if (ok) { renderMain(); flash("Premie fjernet"); } });
      return;
    }
    const delLevel = t.closest("[data-level-delete]");
    if (delLevel) { const lv = findLevel(Number(delLevel.dataset.levelDelete)); if (lv) deleteLevel(lv); return; }

    // Brukere
    const selectAll = t.closest("[data-select-all]");
    if (selectAll) {
      const users = sortedUsers();
      const allSelected = users.length > 0 && users.every((u) => state.selected.has(u.id));
      state.selected = allSelected ? new Set() : new Set(users.map((u) => u.id));
      return renderUsersDynamic();
    }
    const sortCol = t.closest("[data-sort-col]");
    if (sortCol) {
      const id = sortCol.dataset.sortCol;
      state.dir = state.sort === id && state.dir === "desc" ? "asc" : "desc";
      state.sort = id;
      return renderUsersDynamic();
    }
    const userSelect = t.closest("[data-user-select]");
    if (userSelect) {
      e.stopPropagation();
      const id = userSelect.dataset.userSelect;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      return renderUsersDynamic();
    }
    const adminToggle = t.closest("[data-user-admin-toggle]");
    if (adminToggle) { e.stopPropagation(); const u = findUser(adminToggle.dataset.userAdminToggle); if (u) toggleUserAdmin(u); return; }
    const userToggle = t.closest("[data-user-toggle]");
    if (userToggle) {
      const id = userToggle.dataset.userToggle;
      state.openUsers.has(id) ? state.openUsers.delete(id) : state.openUsers.add(id);
      return renderUsersDynamic();
    }
    const editName = t.closest("[data-user-edit-name]");
    if (editName) {
      const id = editName.dataset.userEditName;
      state.editingName = state.editingName === id ? null : id;
      return renderUsersDynamic();
    }
    const delUser = t.closest("[data-user-delete]");
    if (delUser) { const u = findUser(delUser.dataset.userDelete); if (u) deleteUser(u); return; }
    if (t.closest("[data-bulk-admin]")) return bulkSetAdmin(true);
    if (t.closest("[data-bulk-unadmin]")) return bulkSetAdmin(false);
    if (t.closest("[data-bulk-delete]")) return bulkDelete();
    if (t.closest("[data-clear-selection]")) { state.selected.clear(); return renderUsersDynamic(); }

    // Statistikk ranges
    const signupRange = t.closest("[data-signup-range]");
    if (signupRange) { state.signupRange = signupRange.dataset.signupRange; return renderMain(); }
    const playRange = t.closest("[data-play-range]");
    if (playRange) { state.playRange = playRange.dataset.playRange; return renderMain(); }

    // Profilbilder
    const removeColor = t.closest("[data-remove-color]");
    if (removeColor) {
      if (state.avatarOptions.colors.length <= 1) return flash("Du må ha minst én farge.");
      state.avatarOptions.colors.splice(Number(removeColor.dataset.removeColor), 1);
      saveAvatarOptions().then((ok) => { if (ok) { renderMain(); flash("Farge fjernet"); } });
      return;
    }
    const toggleIcon = t.closest("[data-toggle-icon]");
    if (toggleIcon) {
      const key = toggleIcon.dataset.toggleIcon;
      const icons = state.avatarOptions.icons;
      const idx = icons.indexOf(key);
      if (idx === -1) {
        icons.push(key);
      } else {
        if (icons.length <= 1) return flash("Du må ha minst én figur.");
        icons.splice(idx, 1);
      }
      saveAvatarOptions().then((ok) => { if (ok) renderMain(); });
      return;
    }
    if (t.closest("[data-add-color]")) {
      const input = els.main.querySelector("[data-color-draft]");
      const value = input.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) return flash("Bruk hex-format, f.eks. #4287f5.");
      state.avatarOptions.colors.push(value);
      saveAvatarOptions().then((ok) => { if (ok) { renderMain(); flash("Farge lagt til"); } });
      return;
    }
  }

  function onMainChange(e) {
    const t = e.target;
    const gameField = t.closest("[data-game-field]");
    if (gameField) {
      const g = findGame(gameField.dataset.gameId);
      const field = gameField.dataset.gameField;
      let value = t.value.trim();
      if ((field === "thumbnail_url" || field === "icon_url") && value === "") value = null;
      if (field === "name" && value === "") { flash("Navn kan ikke være tomt."); renderMain(); return; }
      if (g) saveGameField(g, field, value);
      return;
    }
    const levelPoints = t.closest("[data-level-points]");
    if (levelPoints) {
      const lv = findLevel(Number(levelPoints.dataset.levelPoints));
      const value = Number(t.value);
      if (!lv || !Number.isFinite(value) || value < 0) return;
      saveLevel(lv, { points_required: value }).then((ok) => { if (ok) { renderMain(); flash("Lagret!"); } });
      return;
    }
    const rewardField = t.closest("[data-reward-field]");
    if (rewardField) {
      const lv = findLevel(Number(rewardField.dataset.rewardLevel));
      if (!lv) return;
      const card = rewardField.closest("[data-level-card]");
      const rewards = collectRewards(card);
      saveLevel(lv, { rewards }).then((ok) => { if (ok) flash("Lagret!"); });
      return;
    }
    const rename = t.closest("[data-user-rename]");
    if (rename) { const u = findUser(rename.dataset.userRename); if (u) renameUser(u, t.value); return; }
    const xp = t.closest("[data-user-xp]");
    if (xp) { const u = findUser(xp.dataset.userXp); if (u) saveUserField(u, "xp", t.value); return; }
    const level = t.closest("[data-user-level]");
    if (level) { const u = findUser(level.dataset.userLevel); if (u) saveUserField(u, "level", t.value); return; }
  }

  function onMainInput(e) {
    if (e.target.matches("[data-users-search]")) {
      state.query = e.target.value;
      renderUsersDynamic();
    }
  }

  // Dra-og-slipp for spillrekkefølge: reorder skjer først på "drop", ikke
  // fortløpende under dragover, slik at raden ikke rerendres (og dermed
  // avbryter drag-sesjonen) midt i draget.
  function onMainDragStart(e) {
    const row = e.target.closest("[data-game-row]");
    if (!row) return;
    state.dragFromId = row.dataset.gameRow;
    e.dataTransfer.effectAllowed = "move";
  }
  function onMainDragOver(e) {
    if (state.dragFromId == null) return;
    if (e.target.closest("[data-game-row]")) e.preventDefault();
  }
  function onMainDrop(e) {
    const row = e.target.closest("[data-game-row]");
    if (!row || state.dragFromId == null) return;
    e.preventDefault();
    const targetId = row.dataset.gameRow;
    if (targetId === state.dragFromId) return;
    const fromIndex = state.games.findIndex((g) => g.id === state.dragFromId);
    const toIndex = state.games.findIndex((g) => g.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const [moved] = state.games.splice(fromIndex, 1);
    state.games.splice(toIndex, 0, moved);
    renderMain();
    persistGameOrder().then(() => flash("Rekkefølgen er lagret"));
  }
  function onMainDragEnd() { state.dragFromId = null; }

  function onMainSubmit(e) { e.preventDefault(); }

  // ---------------------------------------------------------------------
  // Oppstart
  // ---------------------------------------------------------------------

  function bindStaticEvents() {
    els.navButtons.forEach((btn) => btn.addEventListener("click", () => goView(btn.dataset.nav)));
    els.paletteClose.addEventListener("click", closePalette);
    els.paletteInput.addEventListener("input", (e) => { state.paletteQuery = e.target.value; renderPaletteResults(); });
    els.paletteResults.addEventListener("click", (e) => {
      const item = e.target.closest("[data-palette-item]");
      if (!item || !els.paletteResults._commands) return;
      const cmd = els.paletteResults._commands[Number(item.dataset.paletteItem)];
      if (cmd) cmd.go();
      closePalette();
    });

    document.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") { e.preventDefault(); state.paletteOpen ? closePalette() : openPalette(); }
      if (k === "escape" && state.paletteOpen) closePalette();
    });

    els.main.addEventListener("click", onMainClick);
    els.main.addEventListener("change", onMainChange);
    els.main.addEventListener("input", onMainInput);
    els.main.addEventListener("submit", onMainSubmit);
    els.main.addEventListener("dragstart", onMainDragStart);
    els.main.addEventListener("dragover", onMainDragOver);
    els.main.addEventListener("drop", onMainDrop);
    els.main.addEventListener("dragend", onMainDragEnd);
  }

  function fillSidebarUser(profile) {
    const badge = document.querySelector("[data-sidebar-user] .admin-icon-badge");
    const name = document.querySelector("[data-sidebar-user-name]");
    if (badge) badge.outerHTML = window.PixelPlayAvatars.avatarBadgeHTML(profile.avatar_color, profile.avatar_icon, 30, { className: "admin-icon-badge" });
    if (name) name.textContent = profile.username;
  }

  (async function init() {
    const profile = await Auth.requireAdmin();
    if (!profile) return; // requireAdmin() redigerer allerede bort ikke-admins

    els.guard = document.querySelector("[data-admin-guard]");
    els.shell = document.querySelector("[data-admin-shell]");
    els.main = document.querySelector("[data-admin-main]");
    els.navButtons = Array.from(document.querySelectorAll("[data-nav]"));
    els.viewTitle = document.querySelector("[data-view-title]");
    els.viewHint = document.querySelector("[data-view-hint]");
    els.paletteOverlay = document.querySelector("[data-palette-overlay]");
    els.paletteClose = document.querySelector("[data-close-palette]");
    els.paletteInput = document.querySelector("[data-palette-input]");
    els.paletteResults = document.querySelector("[data-palette-results]");
    els.toast = document.querySelector("[data-toast]");

    // "Søk eller hopp til …"-knappen i sidemenyen ligger utenfor <main> (den
    // rendres aldri på nytt), så den trenger sin egen, direkte lytter.
    // Tilsvarende knapper inne i <main> (f.eks. "Finn bruker") fanges i
    // stedet opp av delegeringen i onMainClick, siden de rendres på nytt.
    document.querySelector(".admin-sidebar [data-open-palette]").addEventListener("click", openPalette);

    els.paletteKbd = document.querySelector("[data-palette-kbd]");
    if (els.paletteKbd && !/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "")) {
      els.paletteKbd.textContent = "Ctrl K";
    } else if (els.paletteKbd) {
      els.paletteKbd.textContent = "⌘K";
    }

    state.profile = profile;
    fillSidebarUser(profile);
    bindStaticEvents();

    await loadAll();

    els.guard.hidden = true;
    els.shell.hidden = false;
    renderAll();
  })();
})();
