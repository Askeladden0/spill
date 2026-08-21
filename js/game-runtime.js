/**
 * Dilla – delt kjøretid for spill: poeng-HUD, rekordlagring og
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
  const Auth = window.DillaAuth;

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
    return `dilla_guest_best_${gameId}`;
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

  async function submitScore(gameId, score, profile) {
    const rounded = Math.round(score);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      return { saved: false, best: await loadBest(gameId, profile), profile: null };
    }

    if (profile) {
      const { error: insertError } = await sb
        .from("game_records")
        .insert({ user_id: profile.id, game_id: gameId, score: rounded });
      if (insertError) {
        console.error("[Dilla] Klarte ikke lagre rekord:", insertError.message);
      }

      // add_points returnerer den oppdaterte profilraden direkte, så vi
      // slipper å hente den på nytt i et eget kall etterpå (som kan gi
      // race/cache-problemer og vise gammel xp/nivå i UIen).
      const { data: updatedProfile, error: rpcError } = await sb.rpc("add_points", { p_delta: rounded });
      if (rpcError) {
        console.error("[Dilla] Klarte ikke oppdatere xp/nivå:", rpcError.message);
      }

      const best = await loadBest(gameId, profile);
      return {
        saved: true,
        best: Math.max(best, rounded),
        profile: updatedProfile ? { ...updatedProfile, email: profile.email } : null,
      };
    }

    Auth.addGuestPoints(rounded);
    const best = Math.max(getGuestBest(gameId), rounded);
    setGuestBest(gameId, best);
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
          <button type="button" class="btn-hud-restart" data-hud-restart>Nytt spill</button>
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
  async function mount(container, gameId) {
    container.innerHTML = shellHTML();
    container.classList.add("player-stage-active");

    const els = {
      score: container.querySelector("[data-hud-score]"),
      best: container.querySelector("[data-hud-best]"),
      restartBtn: container.querySelector("[data-hud-restart]"),
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

      requestAnimationFrame(() => {
        els.overlayLevelFill.style.width = "100%";
      });
      // Tidsavbrudd i stedet for "transitionend": hvis stolpen allerede sto
      // på 100% (typisk for alle over nivå 1, siden fremdriften regnes ut
      // fra total xp uten per-nivå-terskel), skjer det ingen visuell
      // endring, og "transitionend" fyres da aldri.
      window.setTimeout(() => {
        els.overlayLevelFill.style.transition = "none";
        els.overlayLevelFill.style.width = "0%";
        // eslint-disable-next-line no-unused-expressions
        els.overlayLevelFill.offsetHeight;
        els.overlayLevelFill.style.transition = "";
        requestAnimationFrame(applyFinal);
      }, 1150);
    }

    return {
      playArea: els.playArea,

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
        const prevBest = best;
        const prevProfile = await Auth.getCurrentProfile();
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
        els.overlayScore.textContent = `Du fikk ${roundedScore.toLocaleString("no-NO")} poeng.`;
        els.overlayBest.textContent = isNewBest
          ? "Ny personlig rekord! 🎉"
          : `Rekord: ${best.toLocaleString("no-NO")} poeng.`;
        animateOverlayLevel(prevProfile, newProfile);
        els.overlay.hidden = false;

        if (leveledUp && window.DillaLevelUp) {
          window.DillaLevelUp.show(prevProfile, newProfile);
        }

        return { isNewBest, best, leveledUp };
      },
    };
  }

  window.DillaGameRuntime = { mount };
})();
