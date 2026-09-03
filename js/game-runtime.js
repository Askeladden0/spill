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

  function shellHTML() {
    return `
      <div class="game-shell">
        <div class="game-hud">
          <div class="game-hud-stat">
            <span class="game-hud-label">Poeng</span>
            <span class="game-hud-value" data-hud-score>0</span>
          </div>
          <div class="game-hud-stat">
            <span class="game-hud-label">Rekord</span>
            <span class="game-hud-value is-accent" data-hud-best>–</span>
          </div>
          <div class="game-hud-right">
            <span class="demo-tag">Demo</span>
            <div class="game-demo-info">
              <button type="button" class="demo-info-btn" data-demo-info-btn aria-label="Om demoen" aria-expanded="false">i</button>
              <div class="demo-info-popover" data-demo-info-popover hidden>Siden nettsiden er ny er ikke alle spillene perfekte. Jeg jobber med å gjøre de bedre :)</div>
            </div>
            <button type="button" class="btn-hud-restart" data-hud-restart>Nytt spill</button>
          </div>
        </div>
        <div class="game-play-area" data-game-play-area></div>
        <div class="game-milestone-toast" data-game-milestone></div>
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
      </div>
    `;
  }

  /**
   * Monterer poeng-HUD + game-over-overlay i en beholder, og returnerer et
   * "session"-objekt spillmodulen bruker til å tegne brettet sitt og
   * rapportere poeng.
   */
  /**
   * Skalerer game-shell ned (aldri opp) slik at hele spillet – HUD + brett –
   * alltid får plass inni spillboksen, uansett hvor stort spillets eget
   * brett er (hvert spill setter sin egen faste/vw-baserte størrelse på
   * brettet sitt) og uansett hvor stor boksen er på skjermen. Siden
   * spillsiden ikke kan scrolles (se css/style.css, is-player-view), måtte
   * spillet ellers bli beskåret i stedet for tilpasset.
   */
  function watchShellFit(container, shellEl) {
    function fit() {
      shellEl.style.transform = "none";
      const availW = container.clientWidth;
      const availH = container.clientHeight;
      const naturalW = shellEl.scrollWidth;
      const naturalH = shellEl.scrollHeight;
      if (!availW || !availH || !naturalW || !naturalH) return;
      const scale = Math.min(1, availW / naturalW, availH / naturalH);
      shellEl.style.transform = scale < 1 ? `scale(${scale})` : "none";
    }

    if (window.ResizeObserver) {
      // Observerer selve skallet (ikke boksen): boksens størrelse endres
      // ikke av oss, men skallets NATURLIGE (utransformerte) høyde endres når
      // spillmodulen fyller spillflaten sin rett etter mount() – det er da vi
      // først må regne ut skaleringen.
      const ro = new ResizeObserver(fit);
      ro.observe(shellEl);
      window.addEventListener("resize", fit);
    } else {
      window.addEventListener("resize", fit);
    }
    requestAnimationFrame(fit);
  }

  async function mount(container, gameId) {
    container.innerHTML = shellHTML();
    container.classList.add("player-stage-active");
    watchShellFit(container, container.querySelector(".game-shell"));

    const els = {
      score: container.querySelector("[data-hud-score]"),
      best: container.querySelector("[data-hud-best]"),
      restartBtn: container.querySelector("[data-hud-restart]"),
      demoInfoBtn: container.querySelector("[data-demo-info-btn]"),
      demoInfoPopover: container.querySelector("[data-demo-info-popover]"),
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
    els.restartBtn.addEventListener("click", fireRestart);
    els.overlayRestart.addEventListener("click", fireRestart);

    if (els.demoInfoBtn && els.demoInfoPopover) {
      els.demoInfoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const willShow = els.demoInfoPopover.hidden;
        els.demoInfoPopover.hidden = !willShow;
        els.demoInfoBtn.setAttribute("aria-expanded", String(willShow));
      });
      document.addEventListener("click", (e) => {
        if (!els.demoInfoPopover.hidden && !e.target.closest(".game-demo-info")) {
          els.demoInfoPopover.hidden = true;
          els.demoInfoBtn.setAttribute("aria-expanded", "false");
        }
      });
    }

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
        // spilleren trykker "Spill igjen" / "Nytt spill". Faller tilbake til
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
