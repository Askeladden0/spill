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
  // stedet for nivå-widgeten, sammen med en "Registrer deg"-knapp, slik at
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
      // Går gjennom claim_guest_progress (supabase/schema.sql, seksjon 48),
      // som kjører hver rad gjennom det samme taket som en vanlig runde.
      // Ellers hadde gjeste-nøklene i localStorage vært en bakvei rundt
      // valideringen: sett studilla_guest_best_2048 til 9 999 999, logg inn,
      // og du står øverst på topplista.
      const { error } = await sb.rpc("claim_guest_progress", {
        p_records: bestEntries.map((e) => ({ game_id: e.gameId, score: e.score })),
      });
      if (error && (error.code === "PGRST202" || /does not exist|could not find the function/i.test(error.message || ""))) {
        console.warn("[Studilla] claim_guest_progress mangler – kjør supabase/schema.sql på nytt.");
        const legacy = await sb
          .from("game_records")
          .insert(bestEntries.map((e) => ({ user_id: profile.id, game_id: e.gameId, score: e.score })));
        if (!legacy.error) bestEntries.forEach((e) => window.localStorage.removeItem(e.key));
      } else if (error) {
        console.error("[Studilla] Klarte ikke overføre gjesterekorder:", error.message);
      } else {
        bestEntries.forEach((e) => window.localStorage.removeItem(e.key));
      }
    }

    // Gjestepoengene fra lykkehjulet er nå dekket av rekordoverføringen over
    // for spilte runder. Poeng som stammer fra hjulet kan ikke lenger legges
    // til fritt (add_points er stengt for klienten, seksjon 48), så nøkkelen
    // ryddes bort i stedet for å bli stående og love noe vi ikke gir.
    if (guestPoints > 0) window.localStorage.removeItem(GUEST_POINTS_KEY);

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

  // Nivået regnes alltid fra poengene (som på premier.html). profiles.level går
  // aldri ned, så etter endret nivåstige kunne toppmenyen vise feil nivå.
  function displayLevel(profile) {
    const levels = levelsCache || [];
    if (!levels.length) return profile.level;
    let best = levels[0].level_number;
    let bestReq = -Infinity;
    levels.forEach((l) => {
      if (profile.xp >= l.points_required && l.points_required >= bestReq) {
        best = l.level_number;
        bestReq = l.points_required;
      }
    });
    return best;
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
        <div class="xp-meta">
          <div class="xp-labels"><span data-xp-level-label>NIVÅ ${displayLevel(profile)}</span><span data-xp-fraction>${xp}/${threshold}</span></div>
          <div class="xp-bar"><div class="xp-bar-fill" data-xp-bar-fill style="width:${pct}%"></div></div>
        </div>
      </div>
      <a href="profil.html" class="login-btn" style="padding:6px 14px 6px 6px" aria-label="Min profil">
        ${avatarHTML(profile, 30)}
        <span>${profile.username}</span>
      </a>
    `;
  }

  // Utloggede ser samme nivåstolpe som innloggede, drevet av gjestepoengene.
  // Poengene lagres lokalt og kan først hentes inn ved innlogging
  // (migrateGuestDataToProfile), så stolpen peker mot «Registrer deg».
  function guestXpWidgetHTML(guestPoints) {
    const guest = { xp: guestPoints };
    const { pct, xp, threshold } = xpProgress(guest);
    return `
      <a href="login.html" class="xp-widget" data-xp-widget title="Logg inn for å beholde poengene dine">
        <div class="xp-meta">
          <div class="xp-labels"><span data-xp-level-label>NIVÅ ${displayLevel(guest)}</span><span data-xp-fraction>${xp}/${threshold}</span></div>
          <div class="xp-bar"><div class="xp-bar-fill" data-xp-bar-fill style="width:${pct}%"></div></div>
        </div>
      </a>`;
  }

  function renderHeaderWithProfile(profile) {
    const slot = document.querySelector("[data-auth-slot]");
    if (!slot) return;

    if (!profile) {
      const guestPoints = getGuestPoints();
      slot.innerHTML = `
        ${LEVELS_ENABLED ? guestXpWidgetHTML(guestPoints) : ""}
        <button class="login-btn" type="button" data-google-signin aria-label="Logg inn med Google">
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.87.92 7.53 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          <span class="google-signin-label">Logg inn med Google</span>
        </button>
        <a href="login.html">
          <button class="login-btn" type="button">
            <span class="login-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a9a3b6" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"></path></svg>
            </span>
            Registrer deg
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
    renderAuthOnlyLinks(!!profile);
    if (profile && window.StudillaSocial) window.StudillaSocial.refreshUnreadBadge();
  }

  /**
   * Lenker som kun gir mening når man er logget inn (i dag «Venner»/
   * meldinger). Skjult i markupen som standard, slik at en utlogget besøkende
   * aldri ser dem blinke innom mens profilen lastes.
   */
  function renderAuthOnlyLinks(signedIn) {
    document.querySelectorAll("[data-auth-only]").forEach((el) => { el.hidden = !signedIn; });
    signedInForGate = signedIn;
  }

  /**
   * Lenker med data-signup-gate (Venner) er synlige for alle, men utloggede
   * får en «Registrer deg»-popup i stedet for å komme til siden.
   */
  let signedInForGate = false;
  function openSignupPopup() {
    let ov = document.querySelector("[data-signup-popup]");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "modal-overlay";
      ov.setAttribute("data-signup-popup", "");
      ov.innerHTML = `
        <div class="modal-backdrop" data-signup-close></div>
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="signup-popup-title">
          <h2 class="modal-title" id="signup-popup-title">Registrer deg for å bruke Venner</h2>
          <p style="margin:0;font-size:14px;line-height:1.6;color:var(--muted)">Lag en gratis konto for å legge til venner og sende meldinger.</p>
          <a class="btn-primary" style="width:100%;text-align:center" href="login.html">Registrer deg</a>
          <button type="button" class="btn-outline" style="width:100%" data-signup-close>Ikke nå</button>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener("click", (e) => { if (e.target.closest("[data-signup-close]")) ov.hidden = true; });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") ov.hidden = true; });
    }
    ov.hidden = false;
  }
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-signup-gate]");
    if (!link || signedInForGate) return;
    e.preventDefault();
    openSignupPopup();
  });

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
    const levelLabel = slot.querySelector("[data-xp-level-label]");
    const fraction = slot.querySelector("[data-xp-fraction]");
    if (!widget || !fill) return;

    const from = xpProgress(prevProfile);
    const to = xpProgress(newProfile);
    const leveledUp = displayLevel(newProfile) > displayLevel(prevProfile);

    function applyFinal() {
      fill.style.width = `${to.pct}%`;
      fraction.textContent = `${to.xp}/${to.threshold}`;
      levelLabel.textContent = `NIVÅ ${displayLevel(newProfile)}`;
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

  // Logger inn (eller oppretter konto) med Google og sender brukeren tilbake
  // til siden de var på. Profilen lages av handle_new_user-triggeren.
  async function signInWithGoogle() {
    return sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href.split("#")[0] },
    });
  }

  // Vilkårene krever at man er over 16 år (vilkar.html). Registrering med
  // brukernavn har en egen avkrysning, men Google-knappen – også den i
  // toppmenyen – opprettet konto uten at noen ble spurt. Svaret huskes i
  // nettleseren, så den som logger inn igjen blir spurt bare én gang.
  const AGE_CONFIRMED_KEY = "studilla_age_confirmed";

  function confirmAge() {
    try {
      if (window.localStorage.getItem(AGE_CONFIRMED_KEY) === "1") return true;
    } catch (e) {}
    const ok = window.confirm("Studilla er for deg som er over 16 år. Trykk OK for å bekrefte at du er over 16 år og godtar vilkårene på studilla.no/vilkar.html.");
    if (ok) {
      try { window.localStorage.setItem(AGE_CONFIRMED_KEY, "1"); } catch (e) {}
    }
    return ok;
  }

  document.addEventListener("click", function (e) {
    const btn = e.target.closest && e.target.closest("[data-google-signin]");
    if (!btn) return;
    if (!confirmAge()) return;
    btn.disabled = true;
    signInWithGoogle().then(function (res) {
      if (res && res.error) {
        btn.disabled = false;
        window.alert(friendlyAuthError(res.error));
      }
    });
  });

  // Google-popupen («One Tap») som dukker opp øverst til høyre for utloggede
  // besøkende. Google gir en ID-token som Supabase bytter til en økt. Nonce:
  // Google får hashen, Supabase får originalen.
  async function startGoogleOneTap() {
    const clientId = window.GOOGLE_CLIENT_ID;
    if (!clientId || (await getSession())) return;

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const rawNonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawNonce));
    const hashedNonce = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

    await new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    window.google.accounts.id.initialize({
      client_id: clientId,
      nonce: hashedNonce,
      use_fedcm_for_prompt: true,
      callback: async function (response) {
        const { error } = await sb.auth.signInWithIdToken({
          provider: "google",
          token: response.credential,
          nonce: rawNonce,
        });
        if (error) console.error("[Studilla] Google-innlogging feilet:", error.message);
      },
    });
    window.google.accounts.id.prompt();
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
    signInWithGoogle,
    signOut,
  };

  document.addEventListener("DOMContentLoaded", function () {
    renderHeaderAuth();
    renderFooterAdminLink();
    startGoogleOneTap().catch((err) => console.warn("[Studilla] Google-popup:", err));
  });

  sb.auth.onAuthStateChange(function (event) {
    renderHeaderAuth();
    renderFooterAdminLink();
    if (event === "SIGNED_IN") {
      getCurrentProfile().then((profile) => migrateGuestDataToProfile(profile));
    }
  });
})();
