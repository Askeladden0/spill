/**
 * Studilla – adminpanel (admin.html).
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
  const Auth = window.StudillaAuth;
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
    rewards: [],
    rarityWeights: [],
    rewardCodes: [],
    claims: [],
    gameRecords: [],
    guestGameRecords: [],
    avatarOptions: { colors: [], icons: [] },
    settings: { level_step: 1000, wheel_spins_per_day: 1, daily_game_rotation: true },
    gamesNeedMigration: false,
    rewardsNeedMigration: false,
    codesNeedMigration: false,
    settingsNeedMigration: false,
    wheelNeedMigration: false,
    wheelSpinsDraft: null,

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
    gameUploadBusy: new Set(),

    // Rabatter
    openCodeLists: new Set(),
    openCodeTables: new Set(),
    rewardUploadBusy: new Set(),

    // Nivåer
    levelStepDraft: null,
    levelCountDraft: null,
    adminPreview: { spinning: false, result: null, error: null },

    // Statistikk
    signupRange: "7d",
    playRange: "7d",
    retentionRange: "30d",
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
      .select("id, name, genre, rating, points, time_estimate, description, thumbnail_url, icon_url, points_multiplier, is_daily_game, hidden, point_rate, sort_order")
      .order("sort_order", { ascending: true });

    if (!full.error) return (full.data || []).map((g) => ({ ...g, point_rate: g.point_rate == null ? 1 : Number(g.point_rate) }));

    // Fallback for prosjekter som ikke har kjørt migrasjonen med
    // games.hidden / games.point_rate ennå (se supabase/schema.sql,
    // seksjon 16 og 35).
    state.gamesNeedMigration = true;
    const fallback = await sb
      .from("games")
      .select("id, name, genre, rating, points, time_estimate, description, thumbnail_url, icon_url, points_multiplier, is_daily_game, sort_order")
      .order("sort_order", { ascending: true });
    if (fallback.error) {
      console.error("[Studilla admin] Klarte ikke hente spill:", fallback.error.message);
      return [];
    }
    return (fallback.data || []).map((g) => ({ ...g, hidden: false, point_rate: 1 }));
  }

  async function loadRewards() {
    const full = await sb
      .from("rewards")
      .select("id, brand, title, sub, rarity, image_url, active, code_type, general_code, expires_at, link_url, sort_order")
      .order("sort_order", { ascending: true });
    if (!full.error) return full.data || [];

    // Fallback for prosjekter som ikke har kjørt migrasjonen med
    // rewards.expires_at / rewards.link_url ennå (schema.sql, seksjon 33).
    state.rewardsNeedMigration = true;
    const fallback = await sb
      .from("rewards")
      .select("id, brand, title, sub, rarity, image_url, active, code_type, general_code, sort_order")
      .order("sort_order", { ascending: true });
    if (fallback.error) {
      console.error("[Studilla admin] Klarte ikke hente rabatter:", fallback.error.message);
      return [];
    }
    return (fallback.data || []).map((r) => ({ ...r, expires_at: null, link_url: null }));
  }

  async function loadRewardCodes() {
    const full = await sb.from("reward_codes").select("id, reward_id, code, claimed_by, claimed_at, disabled");
    if (!full.error) return full.data || [];

    // Fallback for prosjekter uten reward_codes.disabled (schema.sql, 34).
    state.codesNeedMigration = true;
    const fallback = await sb.from("reward_codes").select("id, reward_id, code, claimed_by, claimed_at");
    if (fallback.error) {
      console.error("[Studilla admin] Klarte ikke hente kodelister:", fallback.error.message);
      return [];
    }
    return (fallback.data || []).map((c) => ({ ...c, disabled: false }));
  }

  async function loadSettings() {
    const full = await sb
      .from("app_settings")
      .select("level_step, wheel_spins_per_day, daily_game_rotation")
      .eq("id", 1)
      .maybeSingle();

    if (!full.error && full.data) {
      return {
        level_step: Number(full.data.level_step) || 1000,
        wheel_spins_per_day: full.data.wheel_spins_per_day == null ? 1 : Number(full.data.wheel_spins_per_day),
        daily_game_rotation: full.data.daily_game_rotation !== false,
      };
    }

    // Fallback for prosjekter uten lykkehjul-/rotasjonsinnstillingene
    // (schema.sql, seksjon 41).
    const basic = await sb.from("app_settings").select("level_step").eq("id", 1).maybeSingle();
    state.wheelNeedMigration = true;
    if (basic.error || !basic.data) {
      // Fallback for prosjekter uten app_settings i det hele tatt (seksjon 36).
      state.settingsNeedMigration = true;
      return { level_step: 1000, wheel_spins_per_day: 1, daily_game_rotation: true };
    }
    return { level_step: Number(basic.data.level_step) || 1000, wheel_spins_per_day: 1, daily_game_rotation: true };
  }

  async function loadGuestGameRecords() {
    const { data, error } = await sb.from("guest_game_plays").select("game_id, score, created_at");
    if (error) {
      // Tabellen finnes ikke før supabase/schema.sql (seksjon 45) er kjørt på
      // nytt – feiler stille og lar gjesterunder mangle i statistikken i
      // stedet for å velte hele adminpanelet.
      return [];
    }
    return data || [];
  }

  async function loadAll() {
    const [profilesRes, levelsRes, rewards, rarityRes, rewardCodes, claimsRes, recordsRes, guestRecords, avatarRes, games, settings] = await Promise.all([
      sb.from("profiles").select("id, username, xp, level, is_admin, created_at, avatar_icon, avatar_color").order("created_at", { ascending: false }),
      sb.from("levels").select("level_number, points_required").order("level_number", { ascending: true }),
      loadRewards(),
      sb.from("rarity_weights").select("rarity, weight"),
      loadRewardCodes(),
      sb.from("user_codes").select("user_id, reward_id, brand, title, code, created_at").order("created_at", { ascending: false }),
      sb.from("game_records").select("user_id, game_id, score, created_at"),
      loadGuestGameRecords(),
      sb.from("avatar_options").select("colors, icons").eq("id", 1).single(),
      loadGames(),
      loadSettings(),
    ]);

    if (profilesRes.error) console.error("[Studilla admin] Klarte ikke hente brukere:", profilesRes.error.message);
    if (levelsRes.error) console.error("[Studilla admin] Klarte ikke hente nivåer:", levelsRes.error.message);
    if (rarityRes.error) console.error("[Studilla admin] Klarte ikke hente sjeldenhetsvekter:", rarityRes.error.message);
    if (claimsRes.error) console.error("[Studilla admin] Klarte ikke hente rabattlogg:", claimsRes.error.message);
    if (recordsRes.error) console.error("[Studilla admin] Klarte ikke hente spillrekorder:", recordsRes.error.message);
    if (avatarRes.error) console.error("[Studilla admin] Klarte ikke hente profilbilde-valg:", avatarRes.error.message);

    state.profiles = profilesRes.data || [];
    state.levels = levelsRes.data || [];
    state.rewards = rewards;
    state.rarityWeights = rarityRes.data || [];
    state.rewardCodes = rewardCodes;
    state.claims = claimsRes.data || [];
    state.gameRecords = recordsRes.data || [];
    state.guestGameRecords = guestRecords;
    state.avatarOptions = avatarRes.data || { colors: [], icons: [] };
    state.games = games;
    state.settings = settings;
    state.levelStepDraft = null;
    state.levelCountDraft = null;
    state.wheelSpinsDraft = null;
  }

  function rewardCodeStats(rewardId) {
    const codes = state.rewardCodes.filter((c) => c.reward_id === rewardId);
    // "Ledig" = verken hentet av en bruker eller deaktivert av admin – samme
    // regel som open_level_case bruker når den deler ut en kode.
    const remaining = codes.filter((c) => !c.claimed_by && !c.disabled).length;
    const disabled = codes.filter((c) => c.disabled && !c.claimed_by).length;
    return { total: codes.length, remaining, disabled };
  }

  // En rabatt med utløpsdato i fortiden regnes som deaktivert: den trekkes
  // ikke i kasser (schema.sql, seksjon 38) og merkes "UTGÅTT" i listene her.
  function isExpired(r) {
    return !!r.expires_at && new Date(r.expires_at).getTime() <= Date.now();
  }

  function rewardIsLive(r) {
    return !!r.active && !isExpired(r);
  }

  // <input type="date"> vil ha YYYY-MM-DD i lokal tid.
  function dateInputValue(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function usernameFor(userId) {
    const u = state.profiles.find((p) => p.id === userId);
    return u ? u.username : userId;
  }

  function downloadCSV(filename, header, rows) {
    const escape = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------
  // Navigasjon / topbar / palett / toast
  // ---------------------------------------------------------------------

  const VIEW_TITLES = {
    oversikt: "Oversikt", statistikk: "Statistikk", spill: "Spill",
    nivaaer: "Nivåer", lykkehjul: "Lykkehjul", rabatter: "Rabatter", brukere: "Brukere", avatar: "Profilbilder",
    koder: "Rabattkoder", drift: "Drift",
  };
  const VIEW_HINTS = {
    spill: "Dra ⠿ for rekkefølge. Åpne et spill for navn, beskrivelse og bilder.",
    nivaaer: "Fyll inn hvor mye hvert nivå øker med – differansen er lik hele veien opp.",
    lykkehjul: "Bestem hvor mange ganger hver spiller kan spinne hjulet per døgn.",
    rabatter: "Hver rabatt har en sjeldenhetsgrad. Tweak sannsynligheten øverst, rediger rabattene under.",
    brukere: "Klikk en rad for detaljer. Endringer lagres med én gang.",
    avatar: "Farger og ikoner nye brukere tildeles tilfeldig ved registrering.",
    koder: "Status og logg. Rabattene redigeres under «Rabatter».",
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
      go: () => goView("nivaaer"),
    }));
    const rewards = state.rewards.map((r) => ({
      label: `${r.brand} – ${r.title}`, kind: "RABATT", icon: "▸",
      go: () => { state.openCodeLists.add(r.id); goView("rabatter"); },
    }));
    const users = state.profiles.map((u) => ({
      label: u.username, kind: "BRUKER", icon: "▸",
      go: () => { state.query = ""; state.openUsers.add(u.id); goView("brukere"); },
    }));
    const actions = [
      { label: "Nytt spill", kind: "HANDLING", icon: "+", go: () => { goView("spill"); addGame(); } },
      { label: "Nytt nivå", kind: "HANDLING", icon: "+", go: () => { goView("nivaaer"); addLevel(); } },
      { label: "Ny rabatt", kind: "HANDLING", icon: "+", go: () => { goView("rabatter"); addReward(); } },
    ];
    return [...sections, ...games, ...levels, ...rewards, ...users, ...actions];
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
      ? [...state.gameRecords, ...state.guestGameRecords].filter((r) => r.game_id === daily.id && Date.now() - new Date(r.created_at).getTime() < DAY_MS).length
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
                <span class="admin-daily-note">Vises i heltefeltet på forsiden akkurat nå</span>
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
                ${window.StudillaAvatars.avatarBadgeHTML(u.avatar_color, u.avatar_icon, 30, { className: "admin-icon-badge" })}
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

  /**
   * Retention per spill: hvor stor andel av spillerne som kom tilbake til
   * spillet en annen dag enn den de spilte det første gang.
   *
   * Beregnes ut fra game_records i valgt periode:
   *   spillere  = unike brukere med minst én runde i perioden
   *   tilbake   = av disse, de som har runder på minst to ulike datoer
   *   retention = tilbake / spillere
   *
   * Bygges kun fra game_records (innloggede runder): gjesterunder logges nå
   * også (guest_game_plays, se "Spilte runder per spill" og "Dagens spill"),
   * men uten noen kobling til besøkeren kan man ikke se om samme gjest kom
   * tilbake en annen dag – retention kan derfor bare måles for registrerte
   * brukere.
   */
  const RETENTION_RANGES = { "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, "90d": 90 * DAY_MS, alle: Infinity };

  function buildRetention(range) {
    const cutoff = RETENTION_RANGES[range] != null ? RETENTION_RANGES[range] : Infinity;
    const now = Date.now();
    const perGame = new Map(); // game_id -> Map(user_id -> Set(datoer))

    state.gameRecords.forEach((r) => {
      const t = new Date(r.created_at).getTime();
      if (!Number.isFinite(t) || now - t > cutoff) return;
      if (!perGame.has(r.game_id)) perGame.set(r.game_id, new Map());
      const byUser = perGame.get(r.game_id);
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, { days: new Set(), rounds: 0 });
      const entry = byUser.get(r.user_id);
      entry.days.add(new Date(t).toDateString());
      entry.rounds++;
    });

    return state.games.map((g) => {
      const byUser = perGame.get(g.id) || new Map();
      const players = byUser.size;
      let returning = 0;
      let rounds = 0;
      byUser.forEach((entry) => {
        if (entry.days.size > 1) returning++;
        rounds += entry.rounds;
      });
      return {
        id: g.id,
        name: g.name,
        players,
        returning,
        rounds,
        pct: players ? Math.round((returning / players) * 1000) / 10 : 0,
        perPlayer: players ? Math.round((rounds / players) * 10) / 10 : 0,
      };
    }).sort((a, b) => b.pct - a.pct || b.players - a.players);
  }

  function renderRetention() {
    const rows = buildRetention(state.retentionRange);
    const withPlayers = rows.filter((r) => r.players > 0);
    const totalPlayers = withPlayers.reduce((a, r) => a + r.players, 0);
    const totalReturning = withPlayers.reduce((a, r) => a + r.returning, 0);
    const overall = totalPlayers ? Math.round((totalReturning / totalPlayers) * 1000) / 10 : 0;

    const btns = ["7d", "30d", "90d", "alle"].map((id) => `
      <button type="button" class="admin-range-btn${state.retentionRange === id ? " is-active" : ""}" data-retention-range="${id}">${id === "alle" ? "Hele tiden" : id === "7d" ? "7 dager" : id === "30d" ? "30 dager" : "90 dager"}</button>
    `).join("");

    return `
      <div class="admin-card" style="overflow-x:auto">
        <div class="admin-card-head">
          <div>
            <h2>Retention per triks</h2>
            <span class="admin-card-sub">Andelen spillere som kom tilbake til triksen en annen dag. Teller kun innloggede runder.</span>
          </div>
          <span class="admin-card-spacer"></span>
          <span class="admin-range-switch">${btns}</span>
          <span class="admin-chart-stats">
            <span class="admin-chart-stat">
              <span class="admin-chart-stat-label">TOTALT</span>
              <span class="admin-chart-stat-value is-accent">${overall} %</span>
            </span>
          </span>
        </div>
        <table class="records-table">
          <thead><tr><th>Triks</th><th>Spillere</th><th>Kom tilbake</th><th>Retention</th><th>Runder per spiller</th></tr></thead>
          <tbody>
            ${withPlayers.length ? withPlayers.map((r) => `
              <tr>
                <td>${escapeHTML(r.name)}</td>
                <td>${NOK(r.players)}</td>
                <td>${NOK(r.returning)}</td>
                <td><span style="color:${r.pct >= 40 ? "var(--accent)" : r.pct >= 20 ? "var(--text)" : "var(--muted)"};font-weight:700">${r.pct} %</span></td>
                <td>${r.perPlayer.toLocaleString("no-NO")}</td>
              </tr>
            `).join("") : `<tr><td colspan="5">Ingen runder registrert i denne perioden.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderStatistikk() {
    const series = buildSignupSeries(state.signupRange);
    const avg = Math.round(series.reduce((a, s) => a + s.value, 0) / series.length);
    const rangeLabel = { "7d": "Siste 7 dager", "30d": "Siste 30 dager", "90d": "Siste 90 dager, samlet per uke" }[state.signupRange];

    const pointsByGame = new Map();
    const countAllByGame = new Map();
    const cutoff = { "24t": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, "90d": 90 * DAY_MS }[state.playRange] || Infinity;
    const countRangeByGame = new Map();
    // Innloggede runder (game_records) og gjesterunder (guest_game_plays)
    // slås sammen her: poeng/antall runder skal telle alle spillere, ikke
    // bare de som er logget inn. Retention (under) er fortsatt kun basert på
    // game_records, siden gjesterunder ikke kan kobles til samme besøker.
    [...state.gameRecords, ...state.guestGameRecords].forEach((r) => {
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

        ${renderRetention()}
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

  const GAME_IMAGE_BUCKET = "game-images";

  function uploadRowHTML(g, field) {
    const busy = state.gameUploadBusy.has(`${g.id}:${field}`);
    return `
      <span class="admin-upload-row">
        <label class="admin-upload-btn${busy ? " is-busy" : ""}">
          ${busy ? "Laster opp …" : "Last opp PNG/JPG"}
          <input type="file" accept="image/png,image/jpeg" data-game-upload="${field}" data-game-id="${g.id}" ${busy ? "disabled" : ""}>
        </label>
      </span>
    `;
  }

  async function uploadGameImage(g, field, file) {
    if (!file) return;
    const allowed = { "image/png": "png", "image/jpeg": "jpg" };
    const ext = allowed[file.type];
    if (!ext) return flash("Kun PNG og JPG er støttet.");
    if (file.size > 5 * 1024 * 1024) return flash("Bildet er for stort (maks 5 MB).");

    const busyKey = `${g.id}:${field}`;
    state.gameUploadBusy.add(busyKey);
    renderMain();

    const path = `${g.id}/${field}-${Date.now()}.${ext}`;
    const { error: uploadError } = await sb.storage
      .from(GAME_IMAGE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });

    if (uploadError) {
      state.gameUploadBusy.delete(busyKey);
      renderMain();
      return flash(Auth.friendlyAuthError(uploadError));
    }

    const { data: pub } = sb.storage.from(GAME_IMAGE_BUCKET).getPublicUrl(path);
    state.gameUploadBusy.delete(busyKey);
    await saveGameField(g, field, pub.publicUrl);
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

  // Når automatisk rotasjon er på, regnes dagens triks ut fra datoen på
  // nøyaktig samme måte som på forsiden (js/games-data.js): døgnnummer i UTC
  // modulo antall synlige triks, i rekkefølgen de ligger på forsiden.
  function rotatingDailyGameId() {
    const visible = state.games.filter((g) => !g.hidden);
    if (!visible.length) return null;
    return visible[Math.floor(Date.now() / 86400000) % visible.length].id;
  }

  function isDailyToday(game) {
    if (state.settings.daily_game_rotation === false) return !!game.is_daily_game;
    return game.id === rotatingDailyGameId();
  }

  function renderSpill() {
    const migrationNote = state.gamesNeedMigration
      ? `<p class="admin-card-sub" style="margin:0">⚠ Kjør <code>supabase/schema.sql</code> på nytt i Supabase for å ta i bruk "skjul spill".</p>`
      : "";

    const rotationOn = state.settings.daily_game_rotation !== false;

    const rows = state.games.map((g, i) => {
      const open = state.openGames.has(g.id);
      const daily = isDailyToday(g);
      return `
        <div class="admin-row-card${daily ? " is-daily" : ""}${g.hidden ? " is-hidden" : ""}" data-game-row="${g.id}" draggable="true">
          <div class="admin-row-head" data-game-toggle="${g.id}">
            <span class="admin-drag-handle">⠿</span>
            <span class="admin-row-thumb">${g.thumbnail_url ? `<img src="${escapeHTML(g.thumbnail_url)}" alt="">` : ""}</span>
            <span class="admin-row-titles">
              <span class="admin-row-title-line">
                <span class="admin-row-title">${escapeHTML(g.name)}</span>
                ${daily ? `<span class="admin-pill-daily">★ DAGENS</span>` : ""}
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
                ${uploadRowHTML(g, "thumbnail_url")}
              </label>
              <label class="admin-field is-wide">BESKRIVELSE
                <textarea rows="2" data-game-field="description" data-game-id="${g.id}">${escapeHTML(g.description || "")}</textarea>
              </label>
              <label class="admin-field">IKON (URL)
                <input type="text" value="${escapeHTML(g.icon_url || "")}" placeholder="assets/img/icons/${g.id}.svg" data-game-field="icon_url" data-game-id="${g.id}">
                ${uploadRowHTML(g, "icon_url")}
              </label>
              <label class="admin-field">POENG PER SKÅR
                <input type="number" min="0" step="0.1" value="${g.point_rate == null ? 1 : g.point_rate}" data-game-field="point_rate" data-game-id="${g.id}"${state.gamesNeedMigration ? " disabled" : ""}>
                <span class="admin-dropzone-sub" style="padding-top:4px">1 = skåren gis 1:1. 2 = dobbelt så mange poeng, 0,5 = halvparten. Rekordene lagres alltid som den rå skåren.</span>
              </label>
              <div class="admin-row-actions">
                <button type="button" class="btn-start" style="width:auto;padding:10px 15px;opacity:${daily || rotationOn ? ".55" : "1"}" data-game-set-daily="${g.id}"${rotationOn ? " disabled title=\"Skru av automatisk rotasjon for å velge dagens triks selv\"" : ""}>${daily ? "★ Er dagens triks" : "Sett som dagens triks"}</button>
                <button type="button" class="btn-danger" style="padding:10px 15px" data-game-delete="${g.id}">Slett spill</button>
              </div>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    const rotation = state.settings.daily_game_rotation !== false;
    const rotationCard = `
      <div class="admin-card">
        <div class="admin-row-head" style="cursor:default;padding:0">
          <span class="admin-row-titles">
            <span class="admin-row-title">Dagens triks roterer automatisk</span>
            <span class="admin-row-sub" style="font-family:inherit">${rotation
              ? "Et nytt triks blir dagens triks hver dag ved midnatt, i samme rekkefølge som listen under."
              : "Rotasjonen er av: triksen du merker med «Sett som dagens triks» blir stående til du bytter den."}</span>
          </span>
          <span class="admin-row-side-label">${rotation ? "På" : "Av"}</span>
          <button type="button" class="admin-switch${rotation ? " is-on" : ""}" data-rotation-toggle aria-label="Bytt automatisk rotasjon"${state.wheelNeedMigration || state.settingsNeedMigration ? " disabled" : ""}>
            <span class="admin-switch-track"></span><span class="admin-switch-knob"></span>
          </button>
        </div>
      </div>
    `;

    return `
      <div class="admin-section">
        ${rotationCard}
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

  // Nivåstigen er lineær: nivå N krever (N - 1) * "poeng per nivå". Derfor
  // fyller admin bare inn ett tall (differansen mellom to nivåer) og hvor
  // mange nivåer stigen skal ha – resten regnes ut server-side av
  // admin_set_level_config (schema.sql, seksjon 39).
  function levelStep() {
    return state.levelStepDraft != null ? state.levelStepDraft : (state.settings.level_step || 1000);
  }

  function levelCount() {
    return state.levelCountDraft != null ? state.levelCountDraft : state.levels.length;
  }

  async function saveLevelConfig(step, count) {
    if (state.settingsNeedMigration) return flash("Kjør supabase/schema.sql på nytt for å ta i bruk «poeng per nivå».");
    if (!Number.isFinite(step) || step <= 0) return flash("Poeng per nivå må være et tall større enn 0.");
    if (!Number.isFinite(count) || count < 1 || count > 500) return flash("Antall nivåer må være mellom 1 og 500.");

    const { error } = await sb.rpc("admin_set_level_config", { p_step: Math.round(step), p_count: Math.round(count) });
    if (error) return flash(Auth.friendlyAuthError(error));

    const { data } = await sb.from("levels").select("level_number, points_required").order("level_number", { ascending: true });
    state.levels = data || [];
    state.settings.level_step = Math.round(step);
    state.levelStepDraft = null;
    state.levelCountDraft = null;
    renderMain();
    flash("Nivåstigen er lagret");
  }

  // "+ Nytt nivå" (hurtighandling/kommandopalett) legger nå ett nivå til på
  // toppen av stigen, med samme differanse som resten.
  async function addLevel() {
    goView("nivaaer");
    await saveLevelConfig(levelStep(), state.levels.length + 1);
  }

  function renderNivaaer() {
    const step = levelStep();
    const count = levelCount();
    const rows = state.levels.map((lv) => `
      <div class="admin-row-card">
        <div class="admin-row-head" style="cursor:default">
          <span class="admin-level-badge">${lv.level_number}</span>
          <span class="admin-row-titles">
            <span class="admin-row-title">Nivå ${lv.level_number}</span>
            <span class="admin-row-sub" style="font-family:inherit">${NOK(lv.points_required)} poeng kreves</span>
          </span>
          <span class="admin-row-side-label">Gir én kasse</span>
        </div>
      </div>
    `).join("");

    const migrationNote = state.settingsNeedMigration
      ? `<p class="admin-card-sub" style="margin:0">⚠ Kjør <code>supabase/schema.sql</code> på nytt i Supabase for å ta i bruk «poeng per nivå».</p>`
      : "";

    return `
      <div class="admin-section">
        <div class="admin-card">
          <div>
            <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Poeng per nivå</h2>
            <span class="admin-card-sub">Differansen er den samme fra nivå til nivå: nivå 1 krever 0 poeng, nivå 2 krever ett steg, nivå 3 to steg og så videre. Endrer du tallet, regnes hele stigen om.</span>
          </div>
          ${migrationNote}
          <div class="admin-stat-grid" style="grid-template-columns:repeat(2,minmax(0,220px))">
            <label class="admin-stat-box">POENG PER NIVÅ
              <input type="number" min="1" step="1" value="${step}" data-level-step ${state.settingsNeedMigration ? "disabled" : ""}>
            </label>
            <label class="admin-stat-box">ANTALL NIVÅER
              <input type="number" min="1" max="500" step="1" value="${count}" data-level-count ${state.settingsNeedMigration ? "disabled" : ""}>
            </label>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px">
            <button type="button" class="btn-start" style="width:auto;padding:10px 16px" data-save-levels ${state.settingsNeedMigration ? "disabled" : ""}>Lagre nivåstigen</button>
            <span class="admin-card-sub">Toppnivået (nivå ${Math.max(1, Math.round(count))}) havner på ${NOK(Math.max(0, (Math.round(count) - 1) * Math.round(step)))} poeng.</span>
          </div>
        </div>

        <div class="admin-toolbar">
          <span class="admin-toolbar-count">${state.levels.length} nivåer</span>
          <span class="admin-card-spacer"></span>
          <span class="admin-toolbar-hint">Poengkravene regnes ut automatisk – rediger dem i boksen over</span>
        </div>
        <div class="admin-row-list">${rows || `<p class="admin-card-sub">Ingen nivåer ennå.</p>`}</div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Lykkehjul
  // ---------------------------------------------------------------------

  // Hvor mange spinn hver spiller får per døgn. 0 = ingen grense. Grensen
  // håndheves server-side av RPC-ene wheel_spins_left/spin_wheel
  // (schema.sql, seksjon 41–44), så tallet her er fasiten for hele siden.
  function wheelSpinsPerDay() {
    return state.wheelSpinsDraft != null ? state.wheelSpinsDraft : (state.settings.wheel_spins_per_day == null ? 1 : state.settings.wheel_spins_per_day);
  }

  async function saveSetting(fields, message) {
    if (state.settingsNeedMigration || state.wheelNeedMigration) {
      return flash("Kjør supabase/schema.sql på nytt i Supabase for å ta i bruk denne innstillingen.");
    }
    const { error } = await sb.from("app_settings").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) return flash(Auth.friendlyAuthError(error));
    Object.assign(state.settings, fields);
    renderMain();
    if (message) flash(message);
  }

  async function saveWheelSpins(value) {
    if (!Number.isFinite(value) || value < 0 || value > 100) return flash("Antall spinn må være mellom 0 og 100.");
    state.wheelSpinsDraft = null;
    await saveSetting({ wheel_spins_per_day: Math.round(value) }, "Lykkehjulet er lagret");
  }

  function renderLykkehjul() {
    const perDay = wheelSpinsPerDay();
    const migrationNote = state.wheelNeedMigration || state.settingsNeedMigration
      ? `<p class="admin-card-sub" style="margin:0">⚠ Kjør <code>supabase/schema.sql</code> på nytt i Supabase for å ta i bruk dagsgrensen på lykkehjulet.</p>`
      : "";

    return `
      <div class="admin-section">
        <div class="admin-card">
          <div>
            <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Spinn per dag</h2>
            <span class="admin-card-sub">Hvor mange ganger hver spiller kan spinne lykkehjulet i løpet av ett døgn. Døgnet nullstilles ved midnatt (UTC). Sett tallet til 0 for å fjerne grensen helt.</span>
          </div>
          ${migrationNote}
          <div class="admin-stat-grid" style="grid-template-columns:repeat(2,minmax(0,220px))">
            <label class="admin-stat-box">SPINN PER DAG
              <input type="number" min="0" max="100" step="1" value="${perDay}" data-wheel-spins ${state.wheelNeedMigration || state.settingsNeedMigration ? "disabled" : ""}>
            </label>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px">
            <button type="button" class="btn-start" style="width:auto;padding:10px 16px" data-save-wheel ${state.wheelNeedMigration || state.settingsNeedMigration ? "disabled" : ""}>Lagre</button>
            <span class="admin-card-sub">${perDay === 0 ? "Ingen grense: spillerne kan spinne så mye de vil." : `Hver spiller kan spinne ${perDay} gang${perDay === 1 ? "" : "er"} per døgn.`}</span>
          </div>
        </div>

        <div class="admin-card">
          <div>
            <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Slik virker hjulet</h2>
            <span class="admin-card-sub">Hjulet gir mellom 10 og 1000 poeng per spinn, og poengene legges rett på spilleren. Utloggede besøkende kan også spinne, men poengene deres lagres bare i nettleseren til de logger inn.</span>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Rabatter
  // ---------------------------------------------------------------------

  const RARITY_LABELS = { vanlig: "Vanlig", sjelden: "Sjelden", episk: "Episk", legendarisk: "Legendarisk" };
  const RARITY_ORDER = ["vanlig", "sjelden", "episk", "legendarisk"];
  const REWARD_IMAGE_BUCKET = "reward-images";

  async function addReward() {
    const { data, error } = await sb
      .from("rewards")
      .insert({ brand: "Ny partner", title: "Ny rabatt", sub: "", rarity: "vanlig", code_type: "general", general_code: "BYTT-MEG" })
      .select()
      .single();
    if (error) return flash(Auth.friendlyAuthError(error));
    state.rewards.push(data);
    state.openCodeLists.add(data.id);
    goView("rabatter");
    flash("Rabatt lagt til");
  }

  async function saveReward(r, fields) {
    const { error } = await sb.from("rewards").update(fields).eq("id", r.id);
    if (error) { flash(Auth.friendlyAuthError(error)); return false; }
    Object.assign(r, fields);
    return true;
  }

  // Bryteren viser om rabatten faktisk deles ut nå ("live"): en utgått rabatt
  // står som av selv om active fortsatt er true. Skrur man den på igjen,
  // fjernes derfor utløpsdatoen samtidig – ellers ville bryteren hoppet rett
  // tilbake til "av".
  async function toggleRewardActive(r) {
    if (rewardIsLive(r)) return saveReward(r, { active: false });
    const fields = { active: true };
    if (isExpired(r) && !state.rewardsNeedMigration) fields.expires_at = null;
    return saveReward(r, fields);
  }

  async function toggleRewardCode(codeId) {
    if (state.codesNeedMigration) return flash("Kjør supabase/schema.sql på nytt for å låse opp «deaktiver kode».");
    const c = state.rewardCodes.find((x) => x.id === codeId);
    if (!c) return;
    if (c.claimed_by) return flash("Koden er allerede hentet av en bruker.");
    const next = !c.disabled;
    const { error } = await sb.from("reward_codes").update({ disabled: next }).eq("id", codeId);
    if (error) return flash(Auth.friendlyAuthError(error));
    c.disabled = next;
    renderMain();
    flash(next ? "Koden er deaktivert" : "Koden er aktiv igjen");
  }

  async function deleteReward(r) {
    if (!window.confirm(`Slette rabatten "${r.title}"? Dette sletter også kodelisten som ikke er delt ut. Koder brukere allerede har hentet blir liggende i "Mine koder" hos dem. Kan ikke angres.`)) return;
    const { error } = await sb.from("rewards").delete().eq("id", r.id);
    if (error) return flash(Auth.friendlyAuthError(error));
    state.rewards = state.rewards.filter((x) => x.id !== r.id);
    state.rewardCodes = state.rewardCodes.filter((c) => c.reward_id !== r.id);
    state.openCodeLists.delete(r.id);
    renderMain();
    flash("Rabatt fjernet");
  }

  async function addRewardCodes(rewardId, raw) {
    const codes = Array.from(new Set(raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
    if (!codes.length) return flash("Ingen koder å legge til.");
    const { data, error } = await sb.from("reward_codes").insert(codes.map((code) => ({ reward_id: rewardId, code }))).select();
    if (error) return flash(Auth.friendlyAuthError(error));
    state.rewardCodes.push(...(data || []));
    const r = findReward(rewardId);
    if (r && !r.active) await saveReward(r, { active: true });
    renderMain();
    flash(`${codes.length} kode${codes.length === 1 ? "" : "r"} lagt til`);
  }

  function downloadRewardCodes(r) {
    const codes = state.rewardCodes.filter((c) => c.reward_id === r.id);
    if (!codes.length) return flash("Ingen koder å laste ned ennå.");
    const rows = codes.map((c) => [
      c.code,
      c.claimed_by ? "Brukt" : c.disabled ? "Deaktivert" : "Ledig",
      c.claimed_by ? usernameFor(c.claimed_by) : "",
      c.claimed_at ? new Date(c.claimed_at).toLocaleString("no-NO") : "",
    ]);
    const safeName = `${r.brand}-${r.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "rabatt";
    downloadCSV(`koder-${safeName}.csv`, ["Kode", "Status", "Brukernavn", "Hentet"], rows);
  }

  function findReward(id) { return state.rewards.find((r) => r.id === id); }

  // Bildefelt for en rabatt: en slippsone man enten kan dra et bilde rett
  // inn i, eller klikke på for å velge fil på vanlig måte. Viser samtidig en
  // miniatyr av bildet som er lagret nå.
  function rewardUploadRowHTML(r) {
    const busy = state.rewardUploadBusy.has(r.id);
    return `
      <label class="admin-dropzone${busy ? " is-busy" : ""}" data-reward-dropzone="${r.id}">
        <span class="admin-dropzone-preview">${r.image_url ? `<img src="${escapeHTML(r.image_url)}" alt="">` : "🖼"}</span>
        <span class="admin-dropzone-text">
          <span class="admin-dropzone-main">${busy ? "Laster opp …" : r.image_url ? "Bytt bilde" : "Dra inn et bilde"}</span>
          <span class="admin-dropzone-sub">Slipp et bilde her, eller klikk for å velge. PNG/JPG, maks 5 MB.</span>
        </span>
        ${r.image_url && !busy ? `<button type="button" class="admin-dropzone-clear" data-reward-image-clear="${r.id}" title="Fjern bildet" aria-label="Fjern bildet">×</button>` : ""}
        <input type="file" accept="image/png,image/jpeg" data-reward-upload="${r.id}" ${busy ? "disabled" : ""}>
      </label>
    `;
  }

  // Kodelisten for en 'list'-rabatt: hver kode kan deaktiveres (og aktiveres
  // igjen) uten at den slettes eller at hele rabatten må skrus av.
  function rewardCodeTableHTML(r) {
    const codes = state.rewardCodes.filter((c) => c.reward_id === r.id);
    if (!codes.length) return `<p class="admin-card-sub" style="margin:6px 0 0">Ingen koder lagt inn ennå.</p>`;
    const rows = codes.map((c) => {
      const claimed = !!c.claimed_by;
      const status = claimed ? `Hentet av ${escapeHTML(usernameFor(c.claimed_by))}` : c.disabled ? "Deaktivert" : "Ledig";
      return `
        <div class="admin-code-row${c.disabled || claimed ? " is-off" : ""}">
          <span class="admin-code-value">${escapeHTML(c.code)}</span>
          <span class="admin-code-status">${status}</span>
          ${claimed ? "" : `<button type="button" class="admin-code-btn" data-code-toggle="${c.id}">${c.disabled ? "Aktiver" : "Deaktiver"}</button>`}
        </div>
      `;
    }).join("");
    return `<div class="admin-code-list">${rows}</div>`;
  }

  async function uploadRewardImage(r, file) {
    if (!file) return;
    const allowed = { "image/png": "png", "image/jpeg": "jpg" };
    const ext = allowed[file.type];
    if (!ext) return flash("Kun PNG og JPG er støttet.");
    if (file.size > 5 * 1024 * 1024) return flash("Bildet er for stort (maks 5 MB).");

    state.rewardUploadBusy.add(r.id);
    renderMain();

    const path = `${r.id}/bilde-${Date.now()}.${ext}`;
    const { error: uploadError } = await sb.storage
      .from(REWARD_IMAGE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });

    if (uploadError) {
      state.rewardUploadBusy.delete(r.id);
      renderMain();
      return flash(Auth.friendlyAuthError(uploadError));
    }

    const { data: pub } = sb.storage.from(REWARD_IMAGE_BUCKET).getPublicUrl(path);
    state.rewardUploadBusy.delete(r.id);
    const ok = await saveReward(r, { image_url: pub.publicUrl });
    if (ok) { renderMain(); flash("Bilde lagret"); }
  }

  function rewardRowHTML(r) {
    const isList = r.code_type === "list";
    const stats = isList ? rewardCodeStats(r.id) : null;
    const codesOpen = state.openCodeLists.has(r.id);
    const expired = isExpired(r);
    const live = rewardIsLive(r);
    return `
      <div class="admin-row-card" data-reward-id="${r.id}">
        <div class="admin-row-head" data-reward-toggle="${r.id}">
          <span class="admin-row-thumb">${r.image_url ? `<img src="${escapeHTML(r.image_url)}" alt="">` : ""}</span>
          <span class="admin-row-titles">
            <span class="admin-row-title-line">
              <span class="admin-row-title">${escapeHTML(r.brand)} – ${escapeHTML(r.title)}</span>
              <span class="admin-pill-daily" style="background:rgba(157,107,245,.14);color:#9d6bf5">${RARITY_LABELS[r.rarity] || r.rarity}</span>
              ${expired ? `<span class="admin-pill-expired">UTGÅTT</span>` : ""}
              ${!r.active ? `<span class="admin-pill-hidden">DEAKTIVERT</span>` : ""}
            </span>
            <span class="admin-row-sub">${isList ? `${stats.remaining}/${stats.total} koder igjen${stats.disabled ? ` · ${stats.disabled} deaktivert` : ""}` : `Én kode til alle: ${escapeHTML(r.general_code || "–")}`}${r.expires_at ? ` · ${expired ? "utgikk" : "utgår"} ${formatDate(r.expires_at)}` : ""}</span>
          </span>
          <span class="admin-row-side-label">${live ? "Aktiv" : expired ? "Utgått" : "Inaktiv"}</span>
          <button type="button" class="admin-switch${live ? " is-on" : ""}" data-reward-active-toggle="${r.id}" aria-label="Aktiver/deaktiver rabatt">
            <span class="admin-switch-track"></span><span class="admin-switch-knob"></span>
          </button>
          <span class="admin-chevron">${codesOpen ? "▲" : "▼"}</span>
        </div>
        ${codesOpen ? `
          <div class="admin-row-detail">
            <label class="admin-field">MERKE
              <input type="text" value="${escapeHTML(r.brand)}" placeholder="Merke" data-reward-field="brand">
            </label>
            <label class="admin-field">NAVN PÅ RABATTEN
              <input type="text" value="${escapeHTML(r.title)}" placeholder="F.eks. 25 % på sko" data-reward-field="title">
            </label>
            <label class="admin-field is-wide">BESKRIVELSE (VISES BAK INFOSYMBOLET)
              <textarea rows="2" placeholder="Vilkår, hva rabatten gjelder for …" data-reward-field="sub">${escapeHTML(r.sub || "")}</textarea>
            </label>
            <label class="admin-field">SJELDENHET
              <select data-reward-field="rarity">
                ${RARITY_ORDER.map((k) => `<option value="${k}" ${r.rarity === k ? "selected" : ""}>${RARITY_LABELS[k]}</option>`).join("")}
              </select>
            </label>
            <label class="admin-field is-wide">BILDE
              ${rewardUploadRowHTML(r)}
            </label>
            <label class="admin-field">LENKE TIL TILBUDET (VALGFRITT)
              <input type="url" value="${escapeHTML(r.link_url || "")}" placeholder="https://partner.no/kampanje" data-reward-field="link_url"${state.rewardsNeedMigration ? " disabled" : ""}>
            </label>
            <label class="admin-field">UTLØPSDATO (VALGFRITT)
              <input type="date" value="${dateInputValue(r.expires_at)}" data-reward-field="expires_at"${state.rewardsNeedMigration ? " disabled" : ""}>
            </label>
            <label class="admin-field">KODETYPE
              <select data-reward-field="code_type" title="Kodetype">
                <option value="general" ${!isList ? "selected" : ""}>Generell (én kode til alle)</option>
                <option value="list" ${isList ? "selected" : ""}>Ikke generell (kodeliste, én kode per bruker)</option>
              </select>
            </label>
            ${!isList ? `
              <label class="admin-field">RABATTKODE
                <input type="text" value="${escapeHTML(r.general_code || "")}" placeholder="Rabattkode" data-reward-field="general_code">
              </label>
            ` : `
              <div class="admin-field is-wide">
                <span>LEGG TIL KODER (ÉN PER LINJE)</span>
                <textarea rows="4" placeholder="F.eks.&#10;NIKE-25-AB12&#10;NIKE-25-CD34" data-reward-codes-input="${r.id}"></textarea>
                <div style="display:flex;gap:10px;padding-top:4px">
                  <button type="button" class="btn-start" style="width:auto;padding:9px 14px" data-reward-codes-add="${r.id}">Legg til koder</button>
                  <button type="button" class="admin-btn-ghost" data-reward-codes-download="${r.id}">Last ned oversikt (CSV)</button>
                </div>
                <p class="admin-card-sub" style="margin:6px 0 0">${stats.remaining}/${stats.total} koder igjen${stats.disabled ? `, ${stats.disabled} deaktivert` : ""}. Går kodene tomme deaktiveres rabatten automatisk.</p>
                <button type="button" class="admin-btn-text" style="align-self:flex-start;padding-left:0" data-reward-codes-list="${r.id}">${state.openCodeTables.has(r.id) ? "Skjul kodene ▲" : "Vis og deaktiver enkeltkoder ▼"}</button>
                ${state.openCodeTables.has(r.id) ? rewardCodeTableHTML(r) : ""}
              </div>
            `}
            <div style="display:flex;gap:10px;flex-basis:100%;flex-wrap:wrap;align-items:center">
              <button type="button" class="admin-btn-ghost" data-reward-deactivate="${r.id}">${live ? "Deaktiver rabatten" : "Aktiver rabatten"}</button>
              ${expired ? `<button type="button" class="admin-btn-ghost" data-reward-clear-expiry="${r.id}">Fjern utløpsdatoen</button>` : ""}
              <span class="admin-card-spacer"></span>
              <button type="button" class="btn-danger" style="padding:10px 15px" data-reward-remove="${r.id}">Slett rabatt</button>
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  async function adminPreviewSpin() {
    if (state.adminPreview.spinning) return;
    state.adminPreview.spinning = true;
    state.adminPreview.error = null;
    renderMain();
    const { data, error } = await sb.rpc("admin_preview_case").single();
    state.adminPreview.spinning = false;
    if (error) {
      state.adminPreview.error = error.message.includes("Ingen rabatter")
        ? "Ingen rabatter er tilgjengelige akkurat nå."
        : error.message;
      state.adminPreview.result = null;
    } else {
      state.adminPreview.result = data;
    }
    renderMain();
  }

  async function saveRarityWeight(rarity, weight) {
    const { error } = await sb.from("rarity_weights").upsert({ rarity, weight });
    if (error) return flash(Auth.friendlyAuthError(error));
    const row = state.rarityWeights.find((w) => w.rarity === rarity);
    if (row) row.weight = weight; else state.rarityWeights.push({ rarity, weight });
  }

  function renderRarityWeights() {
    const total = RARITY_ORDER.reduce((sum, k) => {
      const w = state.rarityWeights.find((x) => x.rarity === k);
      return sum + (w ? w.weight : 0);
    }, 0) || 1;

    return `
      <div class="admin-card">
        <div>
          <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Sannsynlighet per sjeldenhet</h2>
          <span class="admin-card-sub">Vekter relativt til hverandre – de trenger ikke summere til 100. Gjelder alle kasser.</span>
        </div>
        <div class="admin-stat-grid" style="grid-template-columns:repeat(4,1fr)">
          ${RARITY_ORDER.map((k) => {
            const w = state.rarityWeights.find((x) => x.rarity === k);
            const weight = w ? w.weight : 0;
            const pct = Math.round((weight / total) * 1000) / 10;
            return `
              <label class="admin-stat-box">${RARITY_LABELS[k]} (${pct} %)
                <input type="number" min="0" value="${weight}" data-rarity-weight="${k}">
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderAdminCasePreview() {
    const p = state.adminPreview;
    const result = p.result;
    return `
      <div class="admin-card">
        <div>
          <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Test-spinn (kun admin)</h2>
          <span class="admin-card-sub">Spinn kassen så mange ganger du vil for å se hva den kan gi. Dette er kun en forhåndsvisning – ingen kode blir reservert eller trukket fra puljen, og det påvirker ikke hva du selv eller andre brukere kan få når dere åpner en ekte kasse.</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
          <button type="button" class="btn-start" style="width:auto;padding:10px 16px" data-admin-preview-spin ${p.spinning ? "disabled" : ""}>${p.spinning ? "Spinner …" : "Spinn testkasse"}</button>
        </div>
        ${p.error ? `<p class="admin-card-sub" style="color:#ff6b6b;margin-top:10px">${escapeHTML(p.error)}</p>` : ""}
        ${result ? `
          <div style="display:flex;align-items:center;gap:16px;margin-top:16px;padding:16px 18px;border-radius:14px;background:var(--bg);border:1px solid var(--border-strong)">
            <span style="width:56px;height:56px;flex:none;border-radius:12px;background:#1b2434;display:flex;align-items:center;justify-content:center;overflow:hidden">
              ${result.image_url ? `<img src="${result.image_url}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-family:ui-monospace,Menlo,monospace;font-size:9px;color:#6b7b93">[ logo ]</span>`}
            </span>
            <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1">
              <span style="font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--accent)">${(RARITY_LABELS[result.rarity] || result.rarity).toUpperCase()} RABATT</span>
              <span style="font-size:16px;font-weight:800;letter-spacing:-.02em;color:#fff">${escapeHTML(result.title)} hos ${escapeHTML(result.brand)}</span>
              <span style="font-size:12px;font-weight:500;color:var(--muted)">Kode: ${escapeHTML(result.code)}</span>
            </div>
            <button type="button" class="admin-btn-ghost" data-admin-preview-copy>Kopier koden</button>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderRabatter() {
    const rows = state.rewards.map((r) => rewardRowHTML(r)).join("");
    return `
      <div class="admin-section">
        ${renderAdminCasePreview()}
        ${renderRarityWeights()}
        <div class="admin-toolbar">
          <span class="admin-toolbar-count">${state.rewards.length} rabatter</span>
          <span class="admin-card-spacer"></span>
          <button type="button" class="btn-start" style="width:auto;padding:10px 16px" data-quick="new-reward">+ Ny rabatt</button>
        </div>
        <div class="admin-row-list">${rows || `<p class="admin-card-sub">Ingen rabatter ennå.</p>`}</div>
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
              ${window.StudillaAvatars.avatarBadgeHTML(u.avatar_color, u.avatar_icon, 30, { className: "admin-icon-badge" })}
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
            ${window.StudillaAvatars.FIGURE_KEYS.map((key) => `
              <button type="button" class="figure-swatch ${icons.includes(key) ? "is-selected" : ""}" data-toggle-icon="${key}" title="${window.StudillaAvatars.figureLabel(key)}">${window.StudillaAvatars.figureSVG(key)}</button>
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
    return `
      <div class="admin-empty-view">
        <span class="admin-empty-icon">⚙</span>
        <h2>Drift kommer hit</h2>
        <p>Statusfelt for Supabase, feillogg og vedlikeholdsmodus. Nye admin-seksjoner legges inn som ett nytt punkt i sidemenyen med samme mønster som resten.</p>
      </div>
    `;
  }

  function renderKoder() {
    const rewardRows = state.rewards.map((r) => {
      const isList = r.code_type === "list";
      const stats = isList ? rewardCodeStats(r.id) : null;
      const statusLabel = isList
        ? `${stats.remaining}/${stats.total} ledig${stats.disabled ? ` · ${stats.disabled} deaktivert` : ""}`
        : `Én kode til alle: ${escapeHTML(r.general_code || "–")}`;
      const expired = isExpired(r);
      const stateLabel = expired
        ? '<span style="color:#ff9385">Utgått</span>'
        : r.active ? "Aktiv" : '<span style="color:#ff9385">Deaktivert</span>';
      return `
        <tr>
          <td>${escapeHTML(r.brand)} – ${escapeHTML(r.title)}</td>
          <td>${RARITY_LABELS[r.rarity] || r.rarity}</td>
          <td>${statusLabel}</td>
          <td>${r.expires_at ? formatDate(r.expires_at) : "–"}</td>
          <td>${stateLabel}</td>
          <td>
            <button type="button" class="admin-btn-ghost" data-reward-deactivate="${r.id}">${rewardIsLive(r) ? "Deaktiver" : "Aktiver"}</button>
            ${isList ? `<button type="button" class="admin-btn-ghost" data-reward-codes-download="${r.id}">Last ned CSV</button>` : ""}
          </td>
        </tr>
      `;
    }).join("");

    const claimRows = state.claims.map((c) => `
      <tr>
        <td>${escapeHTML(usernameFor(c.user_id))}</td>
        <td>${escapeHTML(c.brand)} – ${escapeHTML(c.title)}</td>
        <td>${escapeHTML(c.code)}</td>
        <td>${new Date(c.created_at).toLocaleString("no-NO")}</td>
      </tr>
    `).join("");

    return `
      <div class="admin-section">
        <div class="admin-toolbar">
          <span class="admin-toolbar-count">${state.rewards.length} rabatter</span>
          <span class="admin-card-spacer"></span>
          <button type="button" class="admin-btn-ghost" data-koder-download-all>Last ned full oversikt (CSV)</button>
        </div>
        <div class="admin-card" style="overflow-x:auto">
          <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Rabatter</h2>
          <span class="admin-card-sub">Rediger rabattene under «Rabatter». Her ser du status og kan laste ned lister.</span>
          <table class="records-table">
            <thead><tr><th>Rabatt</th><th>Sjeldenhet</th><th>Koder</th><th>Utløper</th><th>Status</th><th></th></tr></thead>
            <tbody>${rewardRows || `<tr><td colspan="6">Ingen rabatter ennå.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="admin-card" style="overflow-x:auto">
          <h2 style="margin:0 0 4px;font-size:15px;font-weight:800;color:var(--text-strong)">Logg – hvem har fått hvilken kode</h2>
          <span class="admin-card-sub">${state.claims.length} hentede koder totalt, nyeste øverst.</span>
          <table class="records-table">
            <thead><tr><th>Bruker</th><th>Rabatt</th><th>Kode</th><th>Hentet</th></tr></thead>
            <tbody>${claimRows || `<tr><td colspan="4">Ingen koder hentet ennå.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function downloadAllCodesOverview() {
    if (!state.rewards.length) return flash("Ingen rabatter å laste ned ennå.");
    const rows = state.rewards.map((r) => {
      const isList = r.code_type === "list";
      const stats = isList ? rewardCodeStats(r.id) : null;
      return [
        r.brand,
        r.title,
        RARITY_LABELS[r.rarity] || r.rarity,
        isList ? "Kodeliste" : "Én kode til alle",
        isList ? stats.total : 1,
        isList ? stats.remaining : "–",
        isExpired(r) ? "Utgått" : r.active ? "Aktiv" : "Deaktivert",
        r.expires_at ? new Date(r.expires_at).toLocaleDateString("no-NO") : "",
        r.link_url || "",
      ];
    });
    downloadCSV("rabattkoder-oversikt.csv", ["Merke", "Tittel", "Sjeldenhet", "Type", "Totalt", "Ledige", "Status", "Utløper", "Lenke"], rows);
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
      lykkehjul: renderLykkehjul,
      rabatter: renderRabatter,
      brukere: renderBrukere,
      avatar: renderAvatar,
      koder: renderKoder,
      drift: renderEmptyView,
    };
    const fn = renderers[state.view] || renderOversikt;
    els.main.innerHTML = fn();
    // Brukertabellen tegnes i sitt eget delelement, slik at søkefeltet over
    // ikke mister fokus mens man skriver. Referansene må hentes på nytt hver
    // gang <main> er skrevet om – uten dette ble brukersiden stående tom.
    els.usersDynamic = els.main.querySelector("[data-users-dynamic]");
    els.usersCount = els.main.querySelector("[data-users-count]");
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
      if (quick.dataset.quick === "new-reward") return addReward();
    }

    if (t.closest("[data-koder-download-all]")) return downloadAllCodesOverview();

    if (t.closest("[data-admin-preview-spin]")) return adminPreviewSpin();
    const previewCopy = t.closest("[data-admin-preview-copy]");
    if (previewCopy) {
      const code = state.adminPreview.result && state.adminPreview.result.code;
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => {
          const original = previewCopy.textContent;
          previewCopy.textContent = "Kopiert!";
          setTimeout(() => { previewCopy.textContent = original; }, 1500);
        });
      }
      return;
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

    // Lykkehjul
    if (t.closest("[data-save-wheel]")) {
      const input = els.main.querySelector("[data-wheel-spins]");
      return saveWheelSpins(Number(input && input.value));
    }
    if (t.closest("[data-rotation-toggle]")) {
      const next = state.settings.daily_game_rotation === false;
      return saveSetting({ daily_game_rotation: next }, next ? "Dagens triks roterer nå automatisk" : "Automatisk rotasjon er skrudd av");
    }

    // Nivåer
    if (t.closest("[data-save-levels]")) {
      const stepEl = els.main.querySelector("[data-level-step]");
      const countEl = els.main.querySelector("[data-level-count]");
      return saveLevelConfig(Number(stepEl && stepEl.value), Number(countEl && countEl.value));
    }
    const rewardToggle = t.closest("[data-reward-toggle]");
    if (rewardToggle) {
      const id = Number(rewardToggle.dataset.rewardToggle);
      state.openCodeLists.has(id) ? state.openCodeLists.delete(id) : state.openCodeLists.add(id);
      return renderMain();
    }
    const rewardActiveToggle = t.closest("[data-reward-active-toggle]");
    if (rewardActiveToggle) {
      e.stopPropagation();
      const r = findReward(Number(rewardActiveToggle.dataset.rewardActiveToggle));
      if (r) toggleRewardActive(r).then((ok) => { if (ok) { renderMain(); flash(r.active ? "Rabatt aktivert" : "Rabatt deaktivert"); } });
      return;
    }

    const rewardDeactivate = t.closest("[data-reward-deactivate]");
    if (rewardDeactivate) {
      const r = findReward(Number(rewardDeactivate.dataset.rewardDeactivate));
      if (r) toggleRewardActive(r).then((ok) => { if (ok) { renderMain(); flash(r.active ? "Rabatt aktivert" : "Rabatt deaktivert"); } });
      return;
    }
    const clearExpiry = t.closest("[data-reward-clear-expiry]");
    if (clearExpiry) {
      const r = findReward(Number(clearExpiry.dataset.rewardClearExpiry));
      if (r) saveReward(r, { expires_at: null }).then((ok) => { if (ok) { renderMain(); flash("Utløpsdatoen er fjernet"); } });
      return;
    }
    const imageClear = t.closest("[data-reward-image-clear]");
    if (imageClear) {
      e.preventDefault(); // ligger inne i en <label>, som ellers åpner filvelgeren
      const r = findReward(Number(imageClear.dataset.rewardImageClear));
      if (r) saveReward(r, { image_url: null }).then((ok) => { if (ok) { renderMain(); flash("Bildet er fjernet"); } });
      return;
    }
    const codesList = t.closest("[data-reward-codes-list]");
    if (codesList) {
      const id = Number(codesList.dataset.rewardCodesList);
      state.openCodeTables.has(id) ? state.openCodeTables.delete(id) : state.openCodeTables.add(id);
      return renderMain();
    }
    const codeToggle = t.closest("[data-code-toggle]");
    if (codeToggle) return toggleRewardCode(Number(codeToggle.dataset.codeToggle));

    const removeReward = t.closest("[data-reward-remove]");
    if (removeReward) {
      const r = findReward(Number(removeReward.dataset.rewardRemove));
      if (r) deleteReward(r);
      return;
    }
    const codesAdd = t.closest("[data-reward-codes-add]");
    if (codesAdd) {
      const id = Number(codesAdd.dataset.rewardCodesAdd);
      const textarea = els.main.querySelector(`[data-reward-codes-input="${id}"]`);
      if (textarea) addRewardCodes(id, textarea.value);
      return;
    }
    const codesDownload = t.closest("[data-reward-codes-download]");
    if (codesDownload) {
      const r = findReward(Number(codesDownload.dataset.rewardCodesDownload));
      if (r) downloadRewardCodes(r);
      return;
    }

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
    const retentionRange = t.closest("[data-retention-range]");
    if (retentionRange) { state.retentionRange = retentionRange.dataset.retentionRange; return renderMain(); }

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
    const rewardUpload = t.closest("[data-reward-upload]");
    if (rewardUpload) {
      const r = findReward(Number(rewardUpload.dataset.rewardUpload));
      const file = rewardUpload.files && rewardUpload.files[0];
      if (r && file) uploadRewardImage(r, file);
      return;
    }
    const rarityWeight = t.closest("[data-rarity-weight]");
    if (rarityWeight) {
      const rarity = rarityWeight.dataset.rarityWeight;
      const value = Number(t.value);
      if (!Number.isFinite(value) || value < 0) return flash("Ugyldig vekt.");
      saveRarityWeight(rarity, value).then(() => flash("Lagret!"));
      return;
    }
    const gameUpload = t.closest("[data-game-upload]");
    if (gameUpload) {
      const g = findGame(gameUpload.dataset.gameId);
      const file = gameUpload.files && gameUpload.files[0];
      if (g && file) uploadGameImage(g, gameUpload.dataset.gameUpload, file);
      return;
    }
    const gameField = t.closest("[data-game-field]");
    if (gameField) {
      const g = findGame(gameField.dataset.gameId);
      const field = gameField.dataset.gameField;
      let value = t.value.trim();
      if ((field === "thumbnail_url" || field === "icon_url") && value === "") value = null;
      if (field === "name" && value === "") { flash("Navn kan ikke være tomt."); renderMain(); return; }
      if (field === "point_rate") {
        const rate = Number(value.replace(",", "."));
        if (!Number.isFinite(rate) || rate < 0) { flash("Poeng per skår må være et tall (0 eller mer)."); renderMain(); return; }
        value = rate;
      }
      if (g) saveGameField(g, field, value);
      return;
    }
    if (t.matches("[data-wheel-spins]")) { state.wheelSpinsDraft = Number(t.value); return; }
    if (t.matches("[data-level-step]")) { state.levelStepDraft = Number(t.value); return; }
    if (t.matches("[data-level-count]")) { state.levelCountDraft = Number(t.value); return; }
    const rewardField = t.closest("[data-reward-field]");
    if (rewardField) {
      const row = rewardField.closest("[data-reward-id]");
      const r = findReward(Number(row.dataset.rewardId));
      if (!r) return;
      const field = rewardField.dataset.rewardField;
      let value = t.value.trim();
      const fields = {};
      if (field === "expires_at") {
        // <input type="date"> gir YYYY-MM-DD. Rabatten skal gjelde ut hele
        // den dagen, så vi lagrer siste sekund av datoen i lokal tid.
        if (!value) {
          fields.expires_at = null;
        } else {
          const d = new Date(`${value}T23:59:59`);
          if (Number.isNaN(d.getTime())) return flash("Ugyldig dato.");
          fields.expires_at = d.toISOString();
        }
      } else if (field === "link_url") {
        if (value && !/^https?:\/\//i.test(value)) return flash("Lenken må starte med http:// eller https://");
        fields.link_url = value || null;
      } else if (field === "code_type") {
        fields.code_type = value;
        if (value === "general" && !r.general_code) fields.general_code = "BYTT-MEG";
      } else if (field === "general_code") {
        if (r.code_type === "general" && !value) return flash("Kode kan ikke være tom for «Generell».");
        fields.general_code = value || null;
      } else {
        fields[field] = value;
      }
      saveReward(r, fields).then((ok) => { if (ok) { renderMain(); flash("Lagret!"); } });
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
    // Slippsonen for rabattbilder: markeres direkte på elementet (ikke via
    // state + render), siden en rerendring midt i et dra-og-slipp bytter ut
    // DOM-noden og avbryter selve slippet.
    const zone = e.target.closest("[data-reward-dropzone]");
    if (zone) {
      if (zone.classList.contains("is-busy")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      zone.classList.add("is-dragover");
      return;
    }
    if (state.dragFromId == null) return;
    if (e.target.closest("[data-game-row]")) e.preventDefault();
  }
  function onMainDragLeave(e) {
    const zone = e.target.closest("[data-reward-dropzone]");
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove("is-dragover");
  }
  function onMainDrop(e) {
    const zone = e.target.closest("[data-reward-dropzone]");
    if (zone) {
      e.preventDefault();
      zone.classList.remove("is-dragover");
      if (zone.classList.contains("is-busy")) return;
      const r = findReward(Number(zone.dataset.rewardDropzone));
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (r && file) uploadRewardImage(r, file);
      return;
    }
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
    els.main.addEventListener("dragleave", onMainDragLeave);
    els.main.addEventListener("drop", onMainDrop);
    els.main.addEventListener("dragend", onMainDragEnd);
  }

  function fillSidebarUser(profile) {
    const badge = document.querySelector("[data-sidebar-user] .admin-icon-badge");
    const name = document.querySelector("[data-sidebar-user-name]");
    if (badge) badge.outerHTML = window.StudillaAvatars.avatarBadgeHTML(profile.avatar_color, profile.avatar_icon, 30, { className: "admin-icon-badge" });
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
