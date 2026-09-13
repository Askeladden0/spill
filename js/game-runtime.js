/**
 * Studilla – delt kjøretid for spill: poeng-HUD, rekordlagring og
 * game-over-visning. Alle spill (2048 og senere spill) bygger sin egen
 * spilloverflate, men bruker denne til poeng/rekord slik at UIen og
 * lagringslogikken er lik på tvers av spill.
 *
 * Poeng fra et fullført spill lagres i public.game_records (for "Mine
 * rekorder" på profil.html og en fremtidig rangeringsside) og legges til
 * brukerens xp/nivå via public.add_points (samme RPC som lykkehjulet på
 * premier.html bruker). Utlogget besøkende får poengene lagt til lokalt
 * (samme mønster som resten av siden bruker for gjestepoeng).
 */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  const Auth = window.StudillaAuth;
  const Social = window.StudillaSocial;

  // Nivåsystemet er skrudd av for den live siden (se js/feature-flags.js):
  // nivå-baren og "nivå opp"-teksten på game over-kortet skal da ikke vises.
  const LEVELS_ENABLED = !!(window.STUDILLA_FEATURES && window.STUDILLA_FEATURES.levelsEnabled);

  // Poengterskler som viser en kort "Block Blast"-aktig tekst midt i
  // spillflaten når spilleren når dem i én økt. Delt på tvers av alle spill
  // (samme terskler for alle) fordi poenggivningen er balansert til å ligge
  // på omtrent samme skala uansett hvilket spill man spiller.
  const MILESTONES = [
    { score: 100, text: "Fin start!" },
    { score: 300, text: "Bra jobbet!" },
    { score: 700, text: "Nice!" },
    { score: 1500, text: "Awesome!" },
    { score: 3000, text: "Fantastisk!" },
    { score: 6000, text: "Utrolig!" },
    { score: 12000, text: "Legendarisk!" },
  ];

  function guestBestKey(gameId) {
    return `studilla_guest_best_${gameId}`;
  }

  /**
   * Lagret spillstilling ("husk spillet man er i").
   *
   * Spillmodulene kaller session.saveState({...}) etter hvert trekk med en
   * liten, serialiserbar beskrivelse av brettet sitt, og leser
   * session.savedState() når de starter opp. Da havner spilleren rett tilbake
   * i den samme runden neste gang siden åpnes – også etter en refresh eller
   * en tur innom en annen side. Stillingen ligger lokalt i nettleseren
   * (localStorage), én nøkkel per spill, og nullstilles når runden er over
   * eller spilleren starter et nytt spill.
   *
   * Formatet er per spill: kjøretiden lagrer bare det den får, og kaster
   * stillingen hvis den er lagret av en eldre versjon (version-feltet) eller
   * er eldre enn en uke.
   */
  const STATE_VERSION = 1;
  const STATE_MAX_AGE_MS = 7 * 86400000;

  function stateKey(gameId) {
    return `studilla_game_state_${gameId}`;
  }

  function readSavedState(gameId) {
    try {
      const raw = window.localStorage.getItem(stateKey(gameId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STATE_VERSION) return null;
      if (!parsed.savedAt || Date.now() - parsed.savedAt > STATE_MAX_AGE_MS) return null;
      return parsed.state == null ? null : parsed.state;
    } catch (e) {
      return null;
    }
  }

  function writeSavedState(gameId, gameState) {
    try {
      if (gameState == null) {
        window.localStorage.removeItem(stateKey(gameId));
        return;
      }
      window.localStorage.setItem(stateKey(gameId), JSON.stringify({
        version: STATE_VERSION,
        savedAt: Date.now(),
        state: gameState,
      }));
    } catch (e) {
      // Full/blokkert localStorage skal aldri velte spillet.
    }
  }

  function getGuestBest(gameId) {
    const raw = window.localStorage.getItem(guestBestKey(gameId));
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function setGuestBest(gameId, score) {
    window.localStorage.setItem(guestBestKey(gameId), String(Math.round(score)));
  }

  async function loadBest(gameId, profile) {
    if (!profile) return getGuestBest(gameId);
    const { data, error } = await sb
      .from("game_records")
      .select("score")
      .eq("user_id", profile.id)
      .eq("game_id", gameId)
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return 0;
    return Number(data.score) || 0;
  }

  /**
   * Hvor mange poeng ett poeng skår er verdt i dette spillet. Settes per spill
   * i adminpanelet (games.point_rate) og hentes via js/games-data.js. Selve
   * rekorden lagres alltid som den rå skåren, slik at rekordlistene ikke
   * endrer seg når faktoren justeres – det er kun xp/nivå som skaleres.
   */
  function pointRateFor(gameId) {
    const games = window.STUDILLA_GAMES || [];
    const game = games.find((g) => g.id === gameId);
    const rate = game && game.pointRate != null ? Number(game.pointRate) : 1;
    return Number.isFinite(rate) && rate >= 0 ? rate : 1;
  }

  function pointsFor(gameId, score) {
    return Math.max(0, Math.round(score * pointRateFor(gameId)));
  }

  /**
   * Er feilen fra Supabase «denne funksjonen finnes ikke»? Da er ikke
   * supabase/schema.sql kjørt på nytt etter at seksjon 48 kom inn, og vi
   * faller tilbake til den gamle skrivemåten i stedet for at ingen rekorder
   * lagres i det hele tatt. Se submitScore under.
   */
  function isMissingFunction(error) {
    if (!error) return false;
    const msg = (error.message || "") + " " + (error.details || "");
    return error.code === "PGRST202" || /does not exist|could not find the function/i.test(msg);
  }

  let warnedAboutMigration = false;

  function warnMigration(what) {
    if (warnedAboutMigration) return;
    warnedAboutMigration = true;
    console.warn(
      `[Studilla] ${what} finnes ikke i databasen ennå. Kjør supabase/schema.sql på nytt ` +
      "(seksjon 48) – inntil da lagres rekorder på den gamle, usikrede måten."
    );
  }

  async function submitScore(gameId, score, profile) {
    const rounded = Math.round(score);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      return { saved: false, best: await loadBest(gameId, profile), profile: null };
    }

    const awarded = pointsFor(gameId, rounded);

    if (profile) {
      // Rekorden lagres og poengene regnes ut SERVER-SIDE (se
      // supabase/schema.sql, seksjon 48). Tidligere gjorde klienten et rått
      // insert i game_records og kalte add_points() med et tall den valgte
      // selv – begge deler kunne kjøres fra nettleserkonsollen med hvilken
      // som helst verdi, så hele rangeringen kunne forfalskes på ett sekund.
      let updatedProfile = null;
      const { data, error } = await sb.rpc("submit_game_score", {
        p_game_id: gameId,
        p_score: rounded,
      });

      if (error && isMissingFunction(error)) {
        warnMigration("submit_game_score");
        await sb.from("game_records").insert({ user_id: profile.id, game_id: gameId, score: rounded });
        const legacy = await sb.rpc("add_points", { p_delta: awarded });
        updatedProfile = legacy.data || null;
      } else if (error) {
        console.error("[Studilla] Klarte ikke lagre rekord:", error.message);
      } else {
        updatedProfile = data || null;
      }

      const best = await loadBest(gameId, profile);
      return {
        saved: true,
        best: Math.max(best, rounded),
        profile: updatedProfile ? { ...updatedProfile, email: profile.email } : null,
      };
    }

    Auth.addGuestPoints(awarded);
    const best = Math.max(getGuestBest(gameId), rounded);
    setGuestBest(gameId, best);

    // Logges også til Supabase (uten noen kobling til besøkeren) slik at
    // adminpanelets statistikk får med seg gjesterunder, ikke bare
    // innloggede – se guest_game_plays i supabase/schema.sql, seksjon 45.
    sb.from("guest_game_plays").insert({ game_id: gameId, score: rounded }).then(({ error }) => {
      if (error) console.error("[Studilla] Klarte ikke logge gjesterunde:", error.message);
    });

    return { saved: true, best, profile: null };
  }

  /**
   * Melder fra til databasen om at spilleren har fullført en runde i dag, og
   * får tilbake streaken + eventuell dagsbonus (se supabase/schema.sql,
   * seksjon 49). Feiler stille: en manglende streak skal aldri stoppe
   * game over-kortet fra å vises.
   */
  async function touchStreak() {
    try {
      const { data, error } = await sb.rpc("touch_daily_streak");
      if (error || !data) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * Liten konfetti-byge på ny rekord. Rene DOM-elementer med CSS-animasjon,
   * ingen canvas eller bibliotek – og hoppes helt over for de som har bedt om
   * mindre bevegelse i systeminnstillingene.
   */
  function fireConfetti(host) {
    if (!host) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#2ee87f", "#7cf0ad", "#f5c451", "#8ab4ff", "#ff8fb1"];
    host.innerHTML = "";
    for (let i = 0; i < 28; i++) {
      const bit = document.createElement("i");
      bit.className = "game-over-confetti-bit";
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${Math.random() * 0.25}s`;
      bit.style.transform = `rotate(${Math.random() * 360}deg)`;
      host.appendChild(bit);
    }
    window.setTimeout(() => { host.innerHTML = ""; }, 2200);
  }

  function hudHTML() {
    return `
      <div class="game-hud">
        <div class="game-hud-stat">
          <span class="game-hud-label">Poeng</span>
          <span class="game-hud-value" data-hud-score>0</span>
        </div>
        <div class="game-hud-stat">
          <span class="game-hud-label">Rekord</span>
          <span class="game-hud-value is-accent" data-hud-best>–</span>
        </div>
      </div>
    `;
  }

  /**
   * Innholdet i spillboksen. Merk hva som IKKE ligger inni .game-shell:
   *
   *  - Poeng/rekord-HUDen ligger i topplinjen over spillflaten (se
   *    player.html og mount() under). .game-shell blir da bare selve brettet,
   *    og skaleringen under kan derfor bruke HELE flaten til brettet i stedet
   *    for å dele den med HUDen. HUDen slipper samtidig å bli blåst opp
   *    sammen med brettet.
   *  - Game over-kortet ligger som SØSKEN av .game-shell og dekker hele
   *    flaten. Lå det inni skallet ville kortet blitt skalert sammen med
   *    brettet, og teksten/knappen blitt absurd stor på store skjermer.
   */
  function stageHTML() {
    return `
      <div class="game-shell">
        <div class="game-play-area" data-game-play-area></div>
        <div class="game-milestone-toast" data-game-milestone></div>
      </div>
      <div class="game-over-overlay" data-game-over hidden role="dialog" aria-modal="true" aria-labelledby="game-over-title">
        <div class="game-over-card">
          <div class="game-over-confetti" data-game-over-confetti aria-hidden="true"></div>

          <span class="game-over-eyebrow" data-game-over-eyebrow hidden>NY REKORD</span>
          <h3 id="game-over-title" data-game-over-title>Runden er over</h3>

          <div class="game-over-figure">
            <span class="game-over-figure-num" data-game-over-score>0</span>
            <span class="game-over-figure-label" data-game-over-score-label>POENG</span>
          </div>

          <!-- Tre nøkkeltall i stedet for én linje tekst: rekorden din, hvor
               mange dager på rad du har spilt, og hva runden ga i poeng.
               Poenget er at kortet skal svare på «gikk det bra?» uten at
               spilleren må lese en setning. -->
          <div class="game-over-facts">
            <div class="game-over-fact">
              <span class="game-over-fact-num" data-game-over-best-num>–</span>
              <span class="game-over-fact-label">DIN REKORD</span>
            </div>
            <div class="game-over-fact" data-game-over-streak-fact hidden>
              <span class="game-over-fact-num" data-game-over-streak-num>–</span>
              <span class="game-over-fact-label">DAGER PÅ RAD</span>
            </div>
            <div class="game-over-fact" data-game-over-earned-fact hidden>
              <span class="game-over-fact-num is-accent" data-game-over-earned>–</span>
              <span class="game-over-fact-label">POENG TJENT</span>
            </div>
          </div>

          <p class="game-over-note" data-game-over-note hidden></p>

          <div class="game-over-level" data-game-over-level hidden>
            <div class="game-over-level-labels">
              <span data-game-over-level-label>Nivå</span>
              <span data-game-over-level-xp></span>
            </div>
            <div class="game-over-level-bar"><div class="game-over-level-fill" data-game-over-level-fill></div></div>
            <p class="game-over-levelup" data-game-over-levelup>Nivå opp!</p>
          </div>

          <!-- «Spill på nytt» skal være det enkleste å gjøre: primærknappen,
               forhåndsvalgt for tastatur, og Enter/mellomrom virker uten å
               treffe den med musa. -->
          <div class="game-over-actions">
            <button type="button" class="btn-primary game-over-again" data-game-over-restart>Spill på nytt</button>
            <a class="btn-outline game-over-next" data-game-over-next href="#">Se rangering</a>
          </div>
          <button type="button" class="game-over-share" data-game-over-share hidden>Utfordre en venn</button>
        </div>
      </div>

      <!-- Menyen som åpnes fra «Utfordre en venn»: enten en delbar lenke, eller
           en direktemelding til en venn eller gruppe (gjenbruker samme
           vedleggsformat som «send et triks» i meldinger.html). -->
      <div class="modal-overlay share-overlay" data-share-overlay hidden role="dialog" aria-modal="true" aria-labelledby="share-overlay-title">
        <div class="modal-backdrop" data-share-backdrop></div>
        <div class="modal-card share-modal-card">
          <button type="button" class="modal-close" data-share-close aria-label="Lukk">×</button>
          <h3 id="share-overlay-title" class="modal-title">Utfordre en venn</h3>

          <div class="share-menu" data-share-menu>
            <button type="button" class="btn-outline share-menu-btn" data-share-copy>Del lenke til spillet</button>
            <button type="button" class="btn-outline share-menu-btn" data-share-dm hidden>Send til en venn</button>
            <button type="button" class="btn-outline share-menu-btn" data-share-group hidden>Send til en gruppe</button>
          </div>

          <div class="share-picker" data-share-picker hidden>
            <button type="button" class="share-picker-back" data-share-back>← Tilbake</button>
            <div class="share-picker-list" data-share-list></div>
          </div>

          <p class="share-status" data-share-status hidden></p>
        </div>
      </div>
    `;
  }

  /**
   * Skalerer game-shell opp ELLER ned slik at selve brettet alltid fyller
   * mest mulig av spillflaten (.player-stage-inner, som dekker hele skjermen
   * under toppmenyen og topplinjen – se css/style.css), uansett hvor stort
   * spillets eget brett er og uansett hvor stor flaten er. Siden spillsiden
   * ikke kan scrolles (se css/style.css, is-player-view), måtte spillet
   * ellers enten bli beskåret (for stort) eller flyte i et hav av tomrom
   * (for lite) i stedet for å fylle flaten.
   *
   * Skallet er absoluttposisjonert og sentrert i flaten (se .game-shell i
   * css/style.css). Det er med vilje: da er skallets layout helt frikoblet
   * fra flatens størrelse, og offsetWidth/offsetHeight gir alltid brettets
   * EGEN, utransformerte størrelse. Da skallet lå i normal flyt med
   * `max-width: 100%` ble det klemt sammen av flaten på smale skjermer,
   * mens brettet inni beholdt sin faste bredde og hang utenfor på begge
   * sider. Målingen under leste da en for liten "naturlig" bredde, regnet ut
   * en for stor skala, og brettet ble beskåret i begge kanter på mobil.
   */
  // Et tak på oppskaleringen finnes fortsatt, men bare som en fornuftsgrense:
  // brettene er rene DOM-elementer (skalerer knivskarpt), og de to
  // canvas-baserte spillene tegner nå om i den faktiske skjermoppløsningen
  // via session.onScale() i stedet for å bli strukket opp som et bilde.
  const MAX_SCALE = 4;

  function watchShellFit(container, shellEl, onScale) {
    let lastScale = 0;

    function fit() {
      // Flaten har litt luft rundt seg (padding) som brettet ikke skal legge
      // seg oppå, så den trekkes fra den tilgjengelige plassen.
      const cs = window.getComputedStyle(container);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const availW = container.clientWidth - padX;
      const availH = container.clientHeight - padY;
      // offsetWidth/offsetHeight er upåvirket av vår egen transform, så
      // skallet trenger ikke nullstilles først (det ga en synlig blafring
      // ved hver eneste resize).
      const naturalW = shellEl.offsetWidth;
      const naturalH = shellEl.offsetHeight;
      if (availW <= 0 || availH <= 0 || !naturalW || !naturalH) return;
      const scale = Math.min(MAX_SCALE, availW / naturalW, availH / naturalH);
      if (!Number.isFinite(scale) || scale <= 0) return;
      shellEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
      // Bare varsle ved reelle endringer: mottakeren (canvas-spillene) bygger
      // om tegneflaten sin, som er for dyrt å gjøre på hver eneste måling.
      if (Math.abs(scale - lastScale) > 0.01) {
        lastScale = scale;
        if (onScale) onScale(scale);
      }
    }

    if (window.ResizeObserver) {
      // Observerer BÅDE skallet og flaten. Skallets naturlige høyde endres
      // når spillmodulen fyller spillflaten sin rett etter mount() – det er
      // da vi først må regne ut skaleringen. Flatens høyde endres bl.a. når
      // mobilnettleserens adressefelt glir inn/ut, noe som ikke gir noen
      // window-resize i alle nettlesere. Skallet er absoluttposisjonert, så
      // det kan ikke selv påvirke flatens størrelse – ingen løkke.
      const ro = new ResizeObserver(fit);
      ro.observe(shellEl);
      ro.observe(container);
    }
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    requestAnimationFrame(fit);
  }

  /**
   * Monterer poeng-HUD + spillflate + game-over-kort, og returnerer et
   * "session"-objekt spillmodulen bruker til å tegne brettet sitt og
   * rapportere poeng.
   */
  async function mount(container, gameId) {
    container.innerHTML = stageHTML();

    // HUDen hører hjemme i topplinjen over spillflaten (se player.html).
    // Finnes ikke den plassen (f.eks. hvis kjøretiden brukes fra en annen
    // side), legges HUDen først i selve flaten i stedet, slik at poeng og
    // rekord alltid vises et sted.
    const hudSlot = document.querySelector("[data-player-hud]");
    if (hudSlot) {
      hudSlot.innerHTML = hudHTML();
    } else {
      container.insertAdjacentHTML("afterbegin", hudHTML());
    }
    const hudRoot = hudSlot || container;

    // Spillmoduler som tegner på canvas melder seg på her for å bygge om
    // tegneflaten sin i den faktiske skjermoppløsningen når skalaen endres.
    // Uten det ville canvaset blitt strukket opp som et bilde og blitt
    // synlig uskarpt så snart spillet fyller en stor skjerm.
    let scaleHandler = null;
    let currentScale = 1;
    watchShellFit(container, container.querySelector(".game-shell"), (scale) => {
      currentScale = scale;
      if (scaleHandler) scaleHandler(scale);
    });

    const els = {
      score: hudRoot.querySelector("[data-hud-score]"),
      best: hudRoot.querySelector("[data-hud-best]"),
      playArea: container.querySelector("[data-game-play-area]"),
      milestone: container.querySelector("[data-game-milestone]"),
      overlay: container.querySelector("[data-game-over]"),
      overlayTitle: container.querySelector("[data-game-over-title]"),
      overlayEyebrow: container.querySelector("[data-game-over-eyebrow]"),
      overlayScore: container.querySelector("[data-game-over-score]"),
      overlayScoreLabel: container.querySelector("[data-game-over-score-label]"),
      overlayBestNum: container.querySelector("[data-game-over-best-num]"),
      overlayStreakFact: container.querySelector("[data-game-over-streak-fact]"),
      overlayStreakNum: container.querySelector("[data-game-over-streak-num]"),
      overlayEarnedFact: container.querySelector("[data-game-over-earned-fact]"),
      overlayEarned: container.querySelector("[data-game-over-earned]"),
      overlayNote: container.querySelector("[data-game-over-note]"),
      overlayConfetti: container.querySelector("[data-game-over-confetti]"),
      overlayNext: container.querySelector("[data-game-over-next]"),
      overlayShare: container.querySelector("[data-game-over-share]"),
      overlayRestart: container.querySelector("[data-game-over-restart]"),
      overlayLevel: container.querySelector("[data-game-over-level]"),
      overlayLevelLabel: container.querySelector("[data-game-over-level-label]"),
      overlayLevelXp: container.querySelector("[data-game-over-level-xp]"),
      overlayLevelFill: container.querySelector("[data-game-over-level-fill]"),
      overlayLevelUp: container.querySelector("[data-game-over-levelup]"),
      shareOverlay: container.querySelector("[data-share-overlay]"),
      shareBackdrop: container.querySelector("[data-share-backdrop]"),
      shareClose: container.querySelector("[data-share-close]"),
      shareMenu: container.querySelector("[data-share-menu]"),
      shareCopyBtn: container.querySelector("[data-share-copy]"),
      shareDmBtn: container.querySelector("[data-share-dm]"),
      shareGroupBtn: container.querySelector("[data-share-group]"),
      sharePicker: container.querySelector("[data-share-picker]"),
      shareBack: container.querySelector("[data-share-back]"),
      shareList: container.querySelector("[data-share-list]"),
      shareStatus: container.querySelector("[data-share-status]"),
    };

    let best = await loadBest(gameId, await Auth.getCurrentProfile());
    els.best.textContent = best.toLocaleString("no-NO");

    function closeShareOverlay() {
      els.shareOverlay.hidden = true;
    }
    els.shareClose.addEventListener("click", closeShareOverlay);
    els.shareBackdrop.addEventListener("click", closeShareOverlay);
    els.shareBack.addEventListener("click", () => {
      els.sharePicker.hidden = true;
      els.shareMenu.hidden = false;
    });

    /**
     * Viser vennene/gruppene dine (samme data som Venner-siden) slik at man
     * kan sende utfordringen som en direktemelding i stedet for å bare dele
     * en lenke. Bruker det samme vedleggsformatet som «send et triks» i
     * meldinger.html, slik at kortet ser likt ut i innboksen uansett hvor
     * det ble sendt fra.
     */
    async function openSharePicker(kind, attachmentBody) {
      els.shareMenu.hidden = true;
      els.sharePicker.hidden = false;
      els.shareStatus.hidden = true;
      els.shareList.innerHTML = '<p class="share-status">Laster …</p>';

      let rows = [];
      try {
        rows = kind === "dm" ? await Social.friendsList() : await Social.groupThreads();
      } catch (e) {
        rows = [];
      }

      if (!rows.length) {
        els.shareList.innerHTML = `<p class="share-status">${
          kind === "dm" ? "Du har ingen venner ennå." : "Du er ikke med i noen grupper ennå."
        }</p>`;
        return;
      }

      els.shareList.innerHTML = rows.map((r, i) => {
        const label = kind === "dm" ? r.username : r.name;
        const avatar = kind === "dm"
          ? Auth.avatarHTML({ avatar_color: r.avatar_color, avatar_icon: r.avatar_icon }, 32)
          : `<span class="group-avatar" style="width:32px;height:32px;font-size:13px">${Social.escapeHTML((label || "?").trim()[0] || "?").toUpperCase()}</span>`;
        return `<button type="button" class="share-picker-item" data-share-pick="${i}">${avatar}<span class="share-picker-name">${Social.escapeHTML(label)}</span></button>`;
      }).join("");

      els.shareList.querySelectorAll("[data-share-pick]").forEach((pickBtn) => {
        pickBtn.addEventListener("click", async () => {
          const row = rows[Number(pickBtn.dataset.sharePick)];
          pickBtn.disabled = true;
          try {
            if (kind === "dm") {
              await Social.send(row.user_id, attachmentBody);
            } else {
              await Social.sendGroupMessage(row.group_id, attachmentBody);
            }
            const label = kind === "dm" ? row.username : row.name;
            els.shareList.innerHTML = `<p class="share-status">Sendt til ${Social.escapeHTML(label)} ✓</p>`;
            window.setTimeout(closeShareOverlay, 900);
          } catch (e) {
            pickBtn.disabled = false;
            els.shareStatus.hidden = false;
            els.shareStatus.textContent = (e && e.message) || "Klarte ikke sende meldingen.";
          }
        });
      });
    }

    /**
     * «Utfordre en venn» åpner en liten meny i stedet for å dele med det
     * samme: enten en delbar lenke (nettleserens egen delefunksjon der den
     * finnes, ellers kopiert til utklippstavla), eller en direktemelding til
     * en venn eller gruppe.
     */
    function setupShare(currentGameId, score, profile) {
      const games = window.STUDILLA_GAMES || [];
      const game = games.find((g) => g.id === currentGameId);
      const name = game ? game.name : "Studilla";
      const url = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(currentGameId)}`;
      const text = `Jeg fikk ${score.toLocaleString("no-NO")} i ${name} på Studilla. Klarer du å slå meg?`;
      const attachmentBody = Social ? Social.buildBody({ kind: "spill", ref: currentGameId }, text) : text;
      const canSend = !!profile && Social && Social.isAvailable();

      els.overlayShare.hidden = false;
      els.overlayShare.onclick = () => {
        els.shareMenu.hidden = false;
        els.sharePicker.hidden = true;
        els.shareStatus.hidden = true;
        els.shareCopyBtn.textContent = "Del lenke til spillet";
        els.shareDmBtn.hidden = !canSend;
        els.shareGroupBtn.hidden = !canSend;
        els.shareOverlay.hidden = false;
      };

      els.shareCopyBtn.onclick = async () => {
        try {
          if (navigator.share) {
            await navigator.share({ title: "Studilla", text, url });
            return;
          }
          await navigator.clipboard.writeText(`${text} ${url}`);
          els.shareCopyBtn.textContent = "Lenke kopiert ✓";
          window.setTimeout(() => { els.shareCopyBtn.textContent = "Del lenke til spillet"; }, 2000);
        } catch (e) {
          // Avbrutt deling eller blokkert utklippstavle – ikke noe å melde om.
        }
      };

      els.shareDmBtn.onclick = () => openSharePicker("dm", attachmentBody);
      els.shareGroupBtn.onclick = () => openSharePicker("group", attachmentBody);
    }

    let restartHandler = null;
    let pendingHeaderAnimation = null;
    let lastScoreValue = 0;
    let nextMilestoneIndex = 0;
    let milestoneTimer = null;

    function showMilestone(text) {
      if (milestoneTimer) window.clearTimeout(milestoneTimer);
      els.milestone.classList.remove("is-shown");
      // Tving reflow slik at animasjonen starter på nytt selv om samme
      // element allerede var midt i en visning.
      // eslint-disable-next-line no-unused-expressions
      els.milestone.offsetWidth;
      els.milestone.textContent = text;
      els.milestone.classList.add("is-shown");
      milestoneTimer = window.setTimeout(() => {
        els.milestone.classList.remove("is-shown");
      }, 1100);
    }

    function fireRestart() {
      writeSavedState(gameId, null);
      els.overlay.hidden = true;
      lastScoreValue = 0;
      nextMilestoneIndex = 0;
      els.milestone.classList.remove("is-shown");
      if (pendingHeaderAnimation) {
        Auth.animateHeaderLevelUp(pendingHeaderAnimation.prevProfile, pendingHeaderAnimation.newProfile);
        pendingHeaderAnimation = null;
      }
      if (restartHandler) restartHandler();
    }
    els.overlayRestart.addEventListener("click", fireRestart);

    /**
     * Animerer nivå-stolpen på game-over-kortet fra forrige nivåprogresjon
     * til den nye. Hvis spilleren steg et nivå, fylles stolpen først helt
     * opp før den nullstilles og fylles til riktig progresjon på det nye
     * nivået, sammen med en "Nivå opp!"-tekst.
     */
    function animateOverlayLevel(prevProfile, newProfile) {
      if (!prevProfile || !newProfile) {
        els.overlayLevel.hidden = true;
        return;
      }
      els.overlayLevel.hidden = false;
      els.overlayLevelUp.classList.remove("is-shown");

      const from = Auth.xpProgress(prevProfile);
      const to = Auth.xpProgress(newProfile);
      const leveledUp = newProfile.level > prevProfile.level;

      els.overlayLevelFill.style.transition = "none";
      els.overlayLevelFill.style.width = `${from.pct}%`;
      els.overlayLevelLabel.textContent = `Nivå ${prevProfile.level}`;
      els.overlayLevelXp.textContent = `${from.xp}/${from.threshold}`;
      // eslint-disable-next-line no-unused-expressions
      els.overlayLevelFill.offsetHeight;
      els.overlayLevelFill.style.transition = "";

      function applyFinal() {
        els.overlayLevelFill.style.width = `${to.pct}%`;
        els.overlayLevelLabel.textContent = `Nivå ${newProfile.level}`;
        els.overlayLevelXp.textContent = `${to.xp}/${to.threshold}`;
        if (leveledUp) els.overlayLevelUp.classList.add("is-shown");
      }

      if (!leveledUp) {
        requestAnimationFrame(applyFinal);
        return;
      }

      Auth.animateLevelBarSequence(els.overlayLevelFill, { toPct: to.pct, resetDelayMs: 1150, onFinal: applyFinal });
    }

    // Stillingen leses én gang ved oppstart, slik at spillmodulen kan spørre
    // etter den både før og etter at den har tegnet brettet sitt.
    const resumeState = readSavedState(gameId);

    return {
      playArea: els.playArea,

      /**
       * Meld deg på endringer i hvor mye spillet skaleres opp/ned for å fylle
       * skjermen (se watchShellFit). Kalles med én gang med skalaen som
       * gjelder nå, og deretter hver gang den endrer seg. Brukes av de
       * canvas-baserte spillene til å tegne i riktig oppløsning.
       */
      onScale(cb) {
        scaleHandler = cb;
        if (cb) cb(currentScale);
      },

      /** Lagret stilling fra forrige økt, eller null. */
      savedState() {
        return resumeState;
      },

      /** Lagre stillingen i denne runden (kalles etter hvert trekk). */
      saveState(gameState) {
        writeSavedState(gameId, gameState);
      },

      /** Glem stillingen – runden er over eller startet på nytt. */
      clearState() {
        writeSavedState(gameId, null);
      },

      setScore(score) {
        const rounded = Math.max(0, Math.round(score));
        if (rounded === lastScoreValue) return;
        els.score.textContent = rounded.toLocaleString("no-NO");
        if (rounded > lastScoreValue) {
          els.score.classList.remove("is-bump");
          // eslint-disable-next-line no-unused-expressions
          els.score.offsetWidth;
          els.score.classList.add("is-bump");
          while (nextMilestoneIndex < MILESTONES.length && rounded >= MILESTONES[nextMilestoneIndex].score) {
            showMilestone(MILESTONES[nextMilestoneIndex].text);
            nextMilestoneIndex++;
          }
        }
        lastScoreValue = rounded;
      },

      onRestart(cb) {
        restartHandler = cb;
      },

      hideOverlay() {
        els.overlay.hidden = true;
      },

      /**
       * Kalles når et spill er over. Lagrer skåren (hvis > 0), oppdaterer
       * rekorden i HUDen, og viser game-over-kortet.
       */
      async finish(score, opts) {
        opts = opts || {};
        // Runden er ferdig – den lagrede stillingen skal ikke gjenopptas.
        writeSavedState(gameId, null);
        const prevBest = best;
        const [prevProfile] = await Promise.all([Auth.getCurrentProfile(), Auth.loadLevels()]);
        const result = await submitScore(gameId, score, prevProfile);
        best = Math.max(best, result.best);
        els.best.textContent = best.toLocaleString("no-NO");

        // Ikke oppdater header-widgeten med sluttresultatet med en gang: den
        // holdes på forrige tilstand og animeres til den nye først når
        // spilleren trykker "Spill igjen". Faller tilbake til
        // forrige profil (ingen synlig endring) hvis xp/nivå-oppdateringen
        // feilet, i stedet for å la resten av visningen krasje.
        const newProfile = prevProfile ? result.profile || prevProfile : null;
        if (prevProfile) {
          pendingHeaderAnimation = { prevProfile, newProfile };
        } else {
          await Auth.renderHeaderAuth();
        }

        const isNewBest = result.saved && score > prevBest;
        const roundedScore = Math.max(0, Math.round(score));
        const leveledUp = !!(newProfile && prevProfile && newProfile.level > prevProfile.level);
        const awardedPoints = pointsFor(gameId, roundedScore);

        // Streaken oppdateres når runden er ferdig, ikke når siden lastes:
        // det er en fullført runde som teller som «du spilte i dag».
        const streak = prevProfile ? await touchStreak() : null;

        els.overlayTitle.textContent = opts.title || (isNewBest ? "Ny rekord!" : "Runden er over");
        els.overlayEyebrow.hidden = !isNewBest;
        els.overlayScore.textContent = roundedScore.toLocaleString("no-NO");
        els.overlayScoreLabel.textContent = awardedPoints === roundedScore ? "POENG" : "SKÅR";
        els.overlayBestNum.textContent = best.toLocaleString("no-NO");

        const showStreak = !!(prevProfile && streak && streak.streak > 0);
        els.overlayStreakFact.hidden = !showStreak;
        if (showStreak) els.overlayStreakNum.textContent = String(streak.streak);

        const showEarned = !!prevProfile && awardedPoints > 0;
        els.overlayEarnedFact.hidden = !showEarned;
        if (showEarned) {
          els.overlayEarned.textContent = `+${(awardedPoints + ((streak && streak.bonus) || 0)).toLocaleString("no-NO")}`;
        }

        // Én linje som forteller hva som skjedde ut over tallene – enten
        // dagsbonusen, en mistet rekke, eller (for utloggede) hva de går
        // glipp av ved å ikke ha konto.
        let note = "";
        if (!prevProfile) {
          note = "Du er ikke logget inn – rekorden ligger kun i denne nettleseren.";
        } else if (streak && streak.bonus > 0 && streak.streak > 1) {
          note = `${streak.streak} dager på rad! +${streak.bonus} bonuspoeng.`;
        } else if (streak && streak.bonus > 0) {
          note = streak.broke_from > 0
            ? `Rekken din på ${streak.broke_from} dager røk – du er i gang igjen. +${streak.bonus} poeng.`
            : `Første runde i dag – +${streak.bonus} bonuspoeng.`;
        }
        els.overlayNote.hidden = !note;
        els.overlayNote.textContent = note;

        if (isNewBest) fireConfetti(els.overlayConfetti);

        // «Se rangering» peker på rangeringssiden for akkurat dette trikset,
        // åpen direkte på fanen for det – se ?spill=-håndteringen i
        // rangering.html.
        els.overlayNext.hidden = false;
        els.overlayNext.href = `rangering.html?spill=${encodeURIComponent(gameId)}`;
        els.overlayNext.textContent = "Se rangering";

        setupShare(gameId, roundedScore, prevProfile);

        if (LEVELS_ENABLED) {
          animateOverlayLevel(prevProfile, newProfile);
        } else {
          els.overlayLevel.hidden = true;
        }
        els.overlay.hidden = false;
        // Fokus på «Spill på nytt» slik at Enter starter en ny runde med det
        // samme – både for tastaturbrukere og for den som bare vil videre.
        try { els.overlayRestart.focus({ preventScroll: true }); } catch (e) {}

        if (LEVELS_ENABLED && leveledUp && window.StudillaLevelUp) {
          window.StudillaLevelUp.show(prevProfile, newProfile);
        }

        return { isNewBest, best, leveledUp, streak };
      },
    };
  }

  window.StudillaGameRuntime = { mount };
})();
