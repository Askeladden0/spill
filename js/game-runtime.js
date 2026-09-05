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

  async function submitScore(gameId, score, profile) {
    const rounded = Math.round(score);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      return { saved: false, best: await loadBest(gameId, profile), profile: null };
    }

    const awarded = pointsFor(gameId, rounded);

    if (profile) {
      const { error: insertError } = await sb
        .from("game_records")
        .insert({ user_id: profile.id, game_id: gameId, score: rounded });
      if (insertError) {
        console.error("[Studilla] Klarte ikke lagre rekord:", insertError.message);
      }

      // add_points returnerer den oppdaterte profilraden direkte, så vi
      // slipper å hente den på nytt i et eget kall etterpå (som kan gi
      // race/cache-problemer og vise gammel xp/nivå i UIen).
      const { data: updatedProfile, error: rpcError } = await sb.rpc("add_points", { p_delta: awarded });
      if (rpcError) {
        console.error("[Studilla] Klarte ikke oppdatere xp/nivå:", rpcError.message);
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
      <div class="game-over-overlay" data-game-over hidden>
        <div class="game-over-card">
          <h3 data-game-over-title>Spillet er over</h3>
          <p class="game-over-score" data-game-over-score></p>
          <p class="section-sub" data-game-over-best></p>
          <div class="game-over-level" data-game-over-level hidden>
            <div class="game-over-level-labels">
              <span data-game-over-level-label>Nivå</span>
              <span data-game-over-level-xp></span>
            </div>
            <div class="game-over-level-bar"><div class="game-over-level-fill" data-game-over-level-fill></div></div>
            <p class="game-over-levelup" data-game-over-levelup>Nivå opp!</p>
          </div>
          <button type="button" class="btn-primary" data-game-over-restart>Spill igjen</button>
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
      overlayScore: container.querySelector("[data-game-over-score]"),
      overlayBest: container.querySelector("[data-game-over-best]"),
      overlayRestart: container.querySelector("[data-game-over-restart]"),
      overlayLevel: container.querySelector("[data-game-over-level]"),
      overlayLevelLabel: container.querySelector("[data-game-over-level-label]"),
      overlayLevelXp: container.querySelector("[data-game-over-level-xp]"),
      overlayLevelFill: container.querySelector("[data-game-over-level-fill]"),
      overlayLevelUp: container.querySelector("[data-game-over-levelup]"),
    };

    let best = await loadBest(gameId, await Auth.getCurrentProfile());
    els.best.textContent = best.toLocaleString("no-NO");

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

        els.overlayTitle.textContent = opts.title || "Spillet er over";
        const awardedPoints = pointsFor(gameId, roundedScore);
        els.overlayScore.textContent = awardedPoints === roundedScore
          ? `Du fikk ${roundedScore.toLocaleString("no-NO")} poeng.`
          : `Du fikk ${roundedScore.toLocaleString("no-NO")} i skår – det ble ${awardedPoints.toLocaleString("no-NO")} poeng.`;
        els.overlayBest.textContent = isNewBest
          ? "Ny personlig rekord! 🎉"
          : `Rekord: ${best.toLocaleString("no-NO")} poeng.`;
        if (LEVELS_ENABLED) {
          animateOverlayLevel(prevProfile, newProfile);
        } else {
          els.overlayLevel.hidden = true;
        }
        els.overlay.hidden = false;

        if (LEVELS_ENABLED && leveledUp && window.StudillaLevelUp) {
          window.StudillaLevelUp.show(prevProfile, newProfile);
        }

        return { isNewBest, best, leveledUp };
      },
    };
  }

  window.StudillaGameRuntime = { mount };
})();
