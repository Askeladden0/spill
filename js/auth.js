/**
 * PixelPlay – delt autentiserings- og profil-logikk.
 * Brukes av alle sider (via header/footer) og av login.html / profil.html / admin.html.
 * Krever js/supabase-config.js lastet først.
 */

(function () {
  "use strict";

  const sb = window.supabaseClient;

  // Passord- og brukernavnregler (velges her siden oppgaven ga fritt valg):
  //   Brukernavn: 5–20 tegn, kun bokstaver/tall/understrek, unikt (uavh. store/små bokstaver)
  //   Passord: minst 8 tegn, minst én bokstav og ett tall
  const USERNAME_REGEX = /^[a-zA-Z0-9_]{5,20}$/;
  const PASSWORD_MIN_LENGTH = 8;
  const GUEST_POINTS_KEY = "pixelplay_guest_points";

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
    const { data, error } = await sb
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  function friendlyAuthError(error) {
    if (!error) return "Noe gikk galt. Prøv igjen.";
    const msg = error.message || "";
    if (msg.includes("Invalid login credentials")) return "Feil e-post eller passord.";
    if (msg.includes("User already registered")) return "Det finnes allerede en bruker med denne e-posten.";
    if (msg.includes("Password should be")) return "Passordet oppfyller ikke kravene.";
    if (msg.includes("Email not confirmed")) return "Du må bekrefte e-posten din før du kan logge inn.";
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
      console.error("[PixelPlay] Klarte ikke hente profil:", error.message);
      return null;
    }
    return { ...data, email: session.user.email };
  }

  function avatarHTML(profile, size) {
    return window.PixelPlayAvatars.avatarBadgeHTML(profile.avatar_color, profile.avatar_icon, size);
  }

  function xpProgress(profile) {
    const XP_PER_LEVEL = 1000;
    const pct = Math.min(100, Math.round((profile.xp / XP_PER_LEVEL) * 100));
    return { pct, xp: profile.xp, threshold: XP_PER_LEVEL };
  }

  function xpWidgetHTML(profile) {
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
        <div class="guest-points" data-guest-points-display>
          <span class="guest-points-num">${guestPoints.toLocaleString("no-NO")}</span>
          <span class="guest-points-label">POENG DU HADDE HATT</span>
        </div>
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
    const profile = await getCurrentProfile();
    renderHeaderWithProfile(profile);
  }

  /**
   * Animerer nivå-widgeten i toppmenyen fra forrige profiltilstand til den
   * nye, slik at spilleren ser nivåstolpen stige (og en egen "nivå opp"-puls
   * hvis nivået økte) i stedet for at tallene bare hopper til sluttverdien.
   */
  function animateHeaderLevelUp(prevProfile, newProfile) {
    const slot = document.querySelector("[data-auth-slot]");
    if (!slot || !prevProfile || !newProfile) {
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

    requestAnimationFrame(() => {
      fill.style.width = "100%";
    });
    // Bruker en tidsavbrudd i stedet for å vente på "transitionend": hvis
    // stolpen allerede sto på 100% (skjer for alle over nivå 1, siden
    // fremdriften er regnet ut fra total xp uten per-nivå-terskel), skjer
    // det ingen visuell endring og "transitionend" fyres da aldri.
    window.setTimeout(() => {
      fill.style.transition = "none";
      fill.style.width = "0%";
      // eslint-disable-next-line no-unused-expressions
      fill.offsetHeight;
      fill.style.transition = "";
      requestAnimationFrame(applyFinal);
    }, 950);
  }

  async function renderFooterAdminLink() {
    const link = document.querySelector("[data-admin-only]");
    if (!link) return;
    const profile = await getCurrentProfile();
    link.style.display = profile && profile.is_admin ? "" : "none";
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

  window.PixelPlayAuth = {
    USERNAME_REGEX,
    PASSWORD_MIN_LENGTH,
    validateUsername,
    validatePassword,
    isUsernameTaken,
    friendlyAuthError,
    getSession,
    getCurrentProfile,
    avatarHTML,
    xpProgress,
    getGuestPoints,
    addGuestPoints,
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

  sb.auth.onAuthStateChange(function () {
    renderHeaderAuth();
    renderFooterAdminLink();
  });
})();
