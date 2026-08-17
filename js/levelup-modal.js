/**
 * PixelPlay – nivå opp-modal. Vises som en overlay med konfetti og en
 * animert ring/stolpe når en spiller stiger et nivå (etter et fullført
 * spill via js/game-runtime.js). Bygget etter design­filen
 * "Nivaa opp.dc.html", men koblet til de samme profil-/nivådataene som
 * resten av siden (js/auth.js sin xpProgress, og public.levels for
 * premier).
 */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  const Auth = window.PixelPlayAuth;
  const CONFETTI_COLORS = ["#2ee87f", "#5cf5a0", "#5c8df5", "#f5c95c", "#f55c9b", "#a56cf5", "#ffffff"];
  const RING_CIRCUMFERENCE = 364.4;

  let levelsCache = null;
  let els = null;
  let timers = [];
  let runId = 0;

  function markup() {
    return `
      <div class="levelup-overlay" data-levelup-overlay hidden>
        <div class="levelup-backdrop" data-levelup-backdrop></div>
        <div class="levelup-confetti" data-levelup-confetti></div>
        <div class="levelup-card">
          <button type="button" class="levelup-close" data-levelup-close aria-label="Lukk">×</button>
          <div class="levelup-stage">
            <div class="levelup-figure levelup-figure-a"><span class="levelup-arm levelup-arm-l"></span><span class="levelup-arm levelup-arm-r"></span><div class="levelup-figure-head"><span></span><span></span></div><div class="levelup-figure-feet"><span></span><span></span></div></div>
            <div class="levelup-figure levelup-figure-b"><span class="levelup-arm levelup-arm-l"></span><div class="levelup-figure-head"><span></span><span></span></div><div class="levelup-figure-feet"><span></span><span></span></div></div>
            <div class="levelup-figure levelup-figure-c"><span class="levelup-arm levelup-arm-r"></span><span class="levelup-sparkle"></span><div class="levelup-figure-head"><span></span><span></span></div><div class="levelup-figure-feet"><span></span><span></span></div></div>
          </div>

          <div class="levelup-ring">
            <svg width="132" height="132" viewBox="0 0 132 132">
              <circle class="levelup-ring-track" cx="66" cy="66" r="58"></circle>
              <circle class="levelup-ring-fill" data-levelup-ring-fill cx="66" cy="66" r="58" stroke-dasharray="${RING_CIRCUMFERENCE}"></circle>
            </svg>
            <div class="levelup-ring-label">
              <span data-levelup-shown-level>1</span>
              <span>NIVÅ</span>
            </div>
          </div>

          <div class="levelup-heading">
            <span class="levelup-pill">NIVÅ OPP!</span>
            <h2 data-levelup-title>Du er nå nivå 1</h2>
            <p class="levelup-sub" data-levelup-sub></p>
          </div>

          <div class="levelup-progress">
            <div class="levelup-progress-labels"><span data-levelup-level-label></span><span data-levelup-fraction></span></div>
            <div class="levelup-progress-bar"><div class="levelup-progress-fill" data-levelup-fill></div></div>
          </div>

          <div class="levelup-reward" data-levelup-reward hidden>
            <span class="levelup-reward-icon">🎁</span>
            <div class="levelup-reward-body">
              <span class="levelup-reward-title" data-levelup-reward-title></span>
              <span class="levelup-reward-sub" data-levelup-reward-sub></span>
            </div>
          </div>

          <div class="levelup-actions">
            <button type="button" class="btn-primary" data-levelup-continue>Fortsett</button>
            <a class="btn-outline levelup-reward-link" data-levelup-reward-link href="premier.html" hidden>Se premien</a>
          </div>
        </div>
      </div>
    `;
  }

  function ensureMounted() {
    if (els) return els;
    const wrap = document.createElement("div");
    wrap.innerHTML = markup();
    document.body.appendChild(wrap.firstElementChild);

    els = {
      overlay: document.querySelector("[data-levelup-overlay]"),
      confetti: document.querySelector("[data-levelup-confetti]"),
      ringFill: document.querySelector("[data-levelup-ring-fill]"),
      shownLevel: document.querySelector("[data-levelup-shown-level]"),
      title: document.querySelector("[data-levelup-title]"),
      sub: document.querySelector("[data-levelup-sub]"),
      levelLabel: document.querySelector("[data-levelup-level-label]"),
      fraction: document.querySelector("[data-levelup-fraction]"),
      fill: document.querySelector("[data-levelup-fill]"),
      reward: document.querySelector("[data-levelup-reward]"),
      rewardTitle: document.querySelector("[data-levelup-reward-title]"),
      rewardSub: document.querySelector("[data-levelup-reward-sub]"),
      rewardLink: document.querySelector("[data-levelup-reward-link]"),
      continueBtn: document.querySelector("[data-levelup-continue]"),
      closeBtn: document.querySelector("[data-levelup-close]"),
      backdrop: document.querySelector("[data-levelup-backdrop]"),
    };

    els.closeBtn.addEventListener("click", close);
    els.backdrop.addEventListener("click", close);
    els.continueBtn.addEventListener("click", close);
    return els;
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function close() {
    clearTimers();
    if (!els) return;
    els.overlay.hidden = true;
    els.confetti.innerHTML = "";
  }

  function spawnConfetti(count) {
    const id = runId;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const round = i % 4 === 0;
      const w = 6 + Math.random() * 6;
      const h = round ? w : 10 + Math.random() * 10;
      const span = document.createElement("span");
      span.className = "levelup-confetti-piece";
      span.style.left = `${Math.random() * 100}%`;
      span.style.width = `${w}px`;
      span.style.height = `${h}px`;
      span.style.borderRadius = round ? "50%" : "2px";
      span.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      span.style.setProperty("--dx", `${-120 + Math.random() * 240}px`);
      span.style.setProperty("--rot", `${240 + Math.random() * 660}deg`);
      span.style.animation = `lvlConfetti ${(2.4 + Math.random() * 2).toFixed(2)}s linear ${(Math.random() * 2.6).toFixed(2)}s infinite`;
      frag.appendChild(span);
    }
    if (id !== runId) return;
    els.confetti.innerHTML = "";
    els.confetti.appendChild(frag);
  }

  async function loadLevels() {
    if (levelsCache) return levelsCache;
    if (!sb) return [];
    const { data, error } = await sb.from("levels").select("level_number, points_required, rewards").order("level_number");
    levelsCache = !error && data ? data : [];
    return levelsCache;
  }

  function rewardForLevel(levels, level) {
    const lv = levels.find((l) => l.level_number === level);
    const rewards = lv && lv.rewards ? lv.rewards : [];
    if (!rewards.length) return null;
    if (rewards.length === 1) return `${rewards[0].brand} – ${rewards[0].title}`;
    return `${rewards.length} nye premier hos ${rewards[0].brand} og flere`;
  }

  /**
   * Viser nivå opp-modalen. Animerer den gamle nivåstolpen til 100 %, bytter
   * til det nye nivået, og fyller stolpen på nytt til riktig fremdrift –
   * samme sekvens som design­filen (fyll → nullstill → fyll igjen).
   */
  async function show(prevProfile, newProfile) {
    if (!prevProfile || !newProfile || newProfile.level <= prevProfile.level) return;
    const e = ensureMounted();
    clearTimers();
    runId += 1;
    const id = runId;

    const from = Auth.xpProgress(prevProfile);
    const to = Auth.xpProgress(newProfile);
    const gained = Math.max(0, newProfile.xp - prevProfile.xp);

    e.overlay.hidden = false;
    e.title.textContent = `Du er nå nivå ${newProfile.level}`;
    e.sub.textContent = `${gained.toLocaleString("no-NO")} poeng lagt til. Fortsett å spille for å nå nivå ${newProfile.level + 1}.`;
    spawnConfetti(60);

    e.shownLevel.textContent = prevProfile.level;
    e.levelLabel.textContent = `NIVÅ ${prevProfile.level}`;
    e.fraction.textContent = `${from.xp}/${from.threshold}`;
    e.fill.style.transition = "none";
    e.fill.style.width = `${from.pct}%`;
    e.ringFill.style.transition = "none";
    e.ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * from.pct) / 100);
    // eslint-disable-next-line no-unused-expressions
    e.fill.offsetHeight;
    e.fill.style.transition = "";
    e.ringFill.style.transition = "";

    e.reward.hidden = true;
    e.rewardLink.hidden = true;

    // Hentes i parallell med animasjonen under, ikke før den, slik at en
    // treg/mislykket nettforespørsel ikke fryser nivå opp-sekvensen.
    loadLevels().then((levels) => {
      if (id !== runId) return;
      const rewardText = rewardForLevel(levels, newProfile.level);
      if (!rewardText) return;
      e.reward.hidden = false;
      e.rewardTitle.textContent = rewardText;
      e.rewardSub.textContent = `Låst opp på nivå ${newProfile.level} · hent koden under Premier`;
      e.rewardLink.hidden = false;
    });

    timers = [
      setTimeout(() => {
        if (id !== runId) return;
        e.fill.style.width = "100%";
        e.ringFill.style.strokeDashoffset = "0";
      }, 350),
      setTimeout(() => {
        if (id !== runId) return;
        e.fill.style.transition = "none";
        e.fill.style.width = "0%";
        e.ringFill.style.transition = "none";
        e.ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
        // eslint-disable-next-line no-unused-expressions
        e.fill.offsetHeight;
        e.fill.style.transition = "";
        e.ringFill.style.transition = "";
        e.shownLevel.textContent = newProfile.level;
        e.shownLevel.classList.remove("is-popping");
        e.levelLabel.textContent = `NIVÅ ${newProfile.level}`;
      }, 1500),
      setTimeout(() => {
        if (id !== runId) return;
        e.fill.style.width = `${to.pct}%`;
        e.fraction.textContent = `${to.xp}/${to.threshold}`;
        e.ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * to.pct) / 100);
        e.shownLevel.classList.add("is-popping");
      }, 1620),
    ];
  }

  window.PixelPlayLevelUp = { show, close };
})();
