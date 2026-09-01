/**
 * Studilla – delt autentiserings- og profil-logikk.
 * Brukes av alle sider (via header/footer) og av login.html / profil.html / admin.html.
 * Krever js/supabase-config.js lastet først.
 */

(function () {
  "use strict";

  const sb = window.supabaseClient;

  // Nivåsystemet er skrudd av for den live siden (se js/feature-flags.js):
  // toppmeny-widgeten viser da bare avatar/brukernavn, uten nivåring/xp-bar.
  const LEVELS_ENABLED = !!(window.STUDILLA_FEATURES && window.STUDILLA_FEATURES.levelsEnabled);

  // Passord- og brukernavnregler (velges her siden oppgaven ga fritt valg):
  //   Brukernavn: 5–20 tegn, kun bokstaver/tall/understrek, unikt (uavh. store/små bokstaver)
  //   Passord: minst 8 tegn, minst én bokstav og ett tall
  const USERNAME_REGEX = /^[a-zA-Z0-9_]{5,20}$/;
  const PASSWORD_MIN_LENGTH = 8;

  // Studilla logges inn med brukernavn og passord – ikke e-post. Supabase Auth
  // krever likevel en e-postadresse per konto, så vi lager en intern, fast
  // adresse ut fra brukernavnet (den brukes aldri til å sende noe). Samme
  // brukernavn gir alltid samme adresse, slik at innlogging fungerer på tvers
  // av økter og enheter.
  const INTERNAL_EMAIL_DOMAIN = "brukere.studilla.no";

  function emailForUsername(username) {
    return String(username || "").trim().toLowerCase() + "@" + INTERNAL_EMAIL_DOMAIN;
  }
  const GUEST_POINTS_KEY = "studilla_guest_points";

  // Poeng en utlogget besøkende har "tjent" (f.eks. ved å spinne hjulet uten
  // å være innlogget). Lagres lokalt i nettleseren og vises i headeren i
  // stedet for nivå-widgeten, sammen med en "Logg inn"-knapp, slik at
  // besøkende ser hva de går glipp av å ikke lagre permanent.
  function getGuestPoints() {
    const raw = window.localStorage.getItem(GUEST_POINTS_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function addGuestPoints(delta) {
    const next = getGuestPoints() + Math.max(0, delta || 0);
    window.localStorage.setItem(GUEST_POINTS_KEY, String(next));
    return next;
  }

  const GUEST_BEST_PREFIX = "studilla_guest_best_";

  /**
   * Overfører gjestepoeng (lykkehjul spunnet uinnlogget) og gjeste-rekorder
   * (spill spilt uinnlogget, lagret av js/game-runtime.js) til kontoen når en
   * bruker logger inn/registrerer seg, i stedet for at de bare forsvinner
   * stille fra localStorage. Kjøres én gang per innlogging (se
   * onAuthStateChange under) og rydder opp lagringsnøklene etterpå, slik at
   * de aldri overføres på nytt.
   */
  async function migrateGuestDataToProfile(profile) {
    if (!profile) return;

    const bestEntries = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || key.indexOf(GUEST_BEST_PREFIX) !== 0) continue;
      const gameId = key.slice(GUEST_BEST_PREFIX.length);
      const score = parseInt(window.localStorage.getItem(key), 10);
      if (Number.isFinite(score) && score > 0) bestEntries.push({ key, gameId, score });
    }
    const guestPoints = getGuestPoints();

    if (!guestPoints && !bestEntries.length) return;

    if (bestEntries.length) {
      const { error } = await sb
        .from("game_records")
        .insert(bestEntries.map((e) => ({ user_id: profile.id, game_id: e.gameId, score: e.score })));
      if (error) {
        console.error("[Studilla] Klarte ikke overføre gjesterekorder:", error.message);
      } else {
        bestEntries.forEach((e) => window.localStorage.removeItem(e.key));
      }
    }

    if (guestPoints > 0) {
      const { error } = await sb.rpc("add_points", { p_delta: guestPoints });
      if (error) {
        console.error("[Studilla] Klarte ikke overføre gjestepoeng:", error.message);
      } else {
        window.localStorage.removeItem(GUEST_POINTS_KEY);
      }
    }

    await renderHeaderAuth();
  }

  function validateUsername(username) {
    if (!username) return "Brukernavn er påkrevd.";
    if (!USERNAME_REGEX.test(username)) {
      return "Brukernavn må være 5–20 tegn og kan kun inneholde bokstaver, tall og understrek.";
    }
    return null;
  }

  function validatePassword(password) {
    if (!password || password.length < PASSWORD_MIN_LENGTH) {
      return `Passord må være minst ${PASSWORD_MIN_LENGTH} tegn.`;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return "Passord må inneholde minst én bokstav og ett tall.";
    }
    return null;
  }

  async function isUsernameTaken(username) {
    // profiles_public (ikke profiles direkte): en anonym besøkende som
    // registrerer seg må kunne sjekke ALLE brukernavn, men RLS på profiles
    // gir nå kun tilgang til egen rad + admin (se supabase/schema.sql, seksjon 24).
    const { data, error } = await sb
      .from("profiles_public")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  function friendlyAuthError(error) {
    if (!error) return "Noe gikk galt. Prøv igjen.";
    const msg = error.message || "";
    if (msg.includes("Invalid login credentials")) return "Feil brukernavn eller passord.";
    if (msg.includes("User already registered")) return "Dette brukernavnet er allerede tatt.";
    if (msg.includes("Password should be")) return "Passordet oppfyller ikke kravene.";
    if (msg.includes("Email not confirmed")) return "Kontoen er ikke bekreftet ennå. Skru av e-postbekreftelse i Supabase (Authentication → Providers → Email).";
    return msg || "Noe gikk galt. Prøv igjen.";
  }

  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session || null;
  }

  async function getCurrentProfile() {
    const session = await getSession();
    if (!session) return null;
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    if (error) {
      console.error("[Studilla] Klarte ikke hente profil:", error.message);
      return null;
    }
    return { ...data, email: session.user.email };
  }

  function avatarHTML(profile, size) {
    return window.StudillaAvatars.avatarBadgeHTML(profile.avatar_color, profile.avatar_icon, size);
  }

  // Nivåene har ulikt poengkrav (se public.levels), ikke et fast antall
  // poeng per nivå. Hentes én gang og caches, slik at xpProgress() kan
  // regne ut riktig fremdrift *innenfor* gjeldende nivå i stedet for å anta
  // at hvert nivå koster like mye (det ga en stolpe som hoppet feil, eller
  // så ut som den "nullstilte" seg, ved nivå opp).
  let levelsCache = null;

  async function loadLevels() {
    if (levelsCache) return levelsCache;
    const { data, error } = await sb
      .from("levels")
      .select("level_number, points_required")
      .order("points_required", { ascending: true });
    levelsCache = !error && data ? data : [];
    return levelsCache;
  }

  function xpProgress(profile) {
    const xp = profile.xp;
    const levels = levelsCache || [];
    const passed = levels.filter((l) => l.points_required <= xp).sort((a, b) => b.points_required - a.points_required);
    const upcoming = levels.filter((l) => l.points_required > xp).sort((a, b) => a.points_required - b.points_required);
    const currentThreshold = passed.length ? passed[0].points_required : 0;
    const next = upcoming[0];

    if (!next) {
      return { pct: 100, xp, threshold: xp };
    }

    const span = next.points_required - currentThreshold;
    const pct = span > 0 ? Math.min(100, Math.round(((xp - currentThreshold) / span) * 100)) : 100;
    return { pct, xp: xp - currentThreshold, threshold: span };
  }

  function xpWidgetHTML(profile) {
    if (!LEVELS_ENABLED) {
      return `
        <a href="profil.html" class="login-btn" style="padding:6px 14px 6px 6px" aria-label="Min profil">
          ${avatarHTML(profile, 30)}
          <span>${profile.username}</span>
        </a>
      `;
    }
    const { pct, xp, threshold } = xpProgress(profile);
    return `
      <div class="xp-widget" data-xp-widget>
        <div class="xp-level" data-xp-level>${profile.level}</div>
        <div class="xp-meta">
          <div class="xp-labels"><span data-xp-level-label>NIVÅ ${profile.level}</span><span data-xp-fraction>${xp}/${threshold}</span></div>
          <div class="xp-bar"><div class="xp-bar-fill" data-xp-bar-fill style="width:${pct}%"></div></div>
        </div>
      </div>
      <a href="profil.html" class="login-btn" style="padding:6px 14px 6px 6px" aria-label="Min profil">
        ${avatarHTML(profile, 30)}
        <span>${profile.username}</span>
      </a>
    `;
  }

  function renderHeaderWithProfile(profile) {
    const slot = document.querySelector("[data-auth-slot]");
    if (!slot) return;

    if (!profile) {
      const guestPoints = getGuestPoints();
      slot.innerHTML = `
        ${LEVELS_ENABLED ? `
        <div class="guest-points" data-guest-points-display>
          <span class="guest-points-num">${guestPoints.toLocaleString("no-NO")}</span>
          <span class="guest-points-label">POENG DU HADDE HATT</span>
        </div>` : ""}
        <a href="login.html">
          <button class="login-btn" type="button">
            <span class="login-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#96a3b8" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"></path></svg>
            </span>
            Logg inn
          </button>
        </a>
      `;
      return;
    }

    slot.innerHTML = xpWidgetHTML(profile);
  }

  async function renderHeaderAuth() {
    const [profile] = await Promise.all([getCurrentProfile(), loadLevels()]);
    renderHeaderWithProfile(profile);
  }

  /**
   * Delt "fyll til 100% → nullstill uten transition → fyll til ny prosent"-
   * sekvens, brukt av alle steder som animerer en nivåstolpe forbi 100% ved
   * nivå opp (header-widgeten her, og game-over-kortet i js/game-runtime.js).
   * Bruker et tidsavbrudd i stedet for å vente på "transitionend": stolpen
   * kan allerede stå på 100% når nivået økte (f.eks. rett før terskelen), og
   * da skjer det ingen visuell endring, så "transitionend" fyres aldri.
   */
  function animateLevelBarSequence(fillEl, opts) {
    requestAnimationFrame(() => {
      fillEl.style.width = "100%";
    });
    window.setTimeout(() => {
      fillEl.style.transition = "none";
      fillEl.style.width = "0%";
      // eslint-disable-next-line no-unused-expressions
      fillEl.offsetHeight;
      fillEl.style.transition = "";
      requestAnimationFrame(() => {
        fillEl.style.width = `${opts.toPct}%`;
        if (opts.onFinal) opts.onFinal();
      });
    }, opts.resetDelayMs);
  }

  /**
   * Animerer nivå-widgeten i toppmenyen fra forrige profiltilstand til den
   * nye, slik at spilleren ser nivåstolpen stige (og en egen "nivå opp"-puls
   * hvis nivået økte) i stedet for at tallene bare hopper til sluttverdien.
   */
  function animateHeaderLevelUp(prevProfile, newProfile) {
    const slot = document.querySelector("[data-auth-slot]");
    if (!LEVELS_ENABLED || !slot || !prevProfile || !newProfile) {
      renderHeaderWithProfile(newProfile);
      return;
    }

    renderHeaderWithProfile(prevProfile);
    const widget = slot.querySelector("[data-xp-widget]");
    const fill = slot.querySelector("[data-xp-bar-fill]");
    const levelEl = slot.querySelector("[data-xp-level]");
    const levelLabel = slot.querySelector("[data-xp-level-label]");
    const fraction = slot.querySelector("[data-xp-fraction]");
    if (!widget || !fill) return;

    const from = xpProgress(prevProfile);
    const to = xpProgress(newProfile);
    const leveledUp = newProfile.level > prevProfile.level;

    function applyFinal() {
      fill.style.width = `${to.pct}%`;
      fraction.textContent = `${to.xp}/${to.threshold}`;
      levelEl.textContent = newProfile.level;
      levelLabel.textContent = `NIVÅ ${newProfile.level}`;
      widget.classList.add("is-leveling");
      widget.addEventListener("animationend", () => widget.classList.remove("is-leveling"), { once: true });
    }

    if (!leveledUp) {
      requestAnimationFrame(() => {
        fill.style.width = `${to.pct}%`;
        fraction.textContent = `${to.xp}/${to.threshold}`;
      });
      return;
    }

    animateLevelBarSequence(fill, { toPct: to.pct, resetDelayMs: 950, onFinal: applyFinal });
  }

  // Admin-lenkene (toppmenyen og bunnmenyen) er skjult som standard og vises
  // kun for innloggede administratorer.
  async function renderFooterAdminLink() {
    const links = document.querySelectorAll("[data-admin-only]");
    if (!links.length) return;
    const profile = await getCurrentProfile();
    const show = !!(profile && profile.is_admin);
    links.forEach((link) => { link.style.display = show ? "" : "none"; });
  }

  async function requireAuth() {
    const profile = await getCurrentProfile();
    if (!profile) {
      window.location.href = "login.html";
      return null;
    }
    return profile;
  }

  async function requireAdmin() {
    const profile = await requireAuth();
    if (profile && !profile.is_admin) {
      window.location.href = "index.html";
      return null;
    }
    return profile;
  }

  async function signOut() {
    await sb.auth.signOut();
    window.location.href = "index.html";
  }

  window.StudillaAuth = {
    USERNAME_REGEX,
    PASSWORD_MIN_LENGTH,
    validateUsername,
    validatePassword,
    emailForUsername,
    isUsernameTaken,
    friendlyAuthError,
    getSession,
    getCurrentProfile,
    avatarHTML,
    xpProgress,
    animateLevelBarSequence,
    loadLevels,
    getGuestPoints,
    addGuestPoints,
    migrateGuestDataToProfile,
    renderHeaderAuth,
    animateHeaderLevelUp,
    renderFooterAdminLink,
    requireAuth,
    requireAdmin,
    signOut,
  };

  document.addEventListener("DOMContentLoaded", function () {
    renderHeaderAuth();
    renderFooterAdminLink();
  });

  sb.auth.onAuthStateChange(function (event) {
    renderHeaderAuth();
    renderFooterAdminLink();
    if (event === "SIGNED_IN") {
      getCurrentProfile().then((profile) => migrateGuestDataToProfile(profile));
    }
  });
})();
