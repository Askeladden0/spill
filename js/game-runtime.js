/**
 * PixelPlay – delt kjøretid for spill: poeng-HUD, rekordlagring og
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
  const Auth = window.PixelPlayAuth;

  function guestBestKey(gameId) {
    return `pixelplay_guest_best_${gameId}`;
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
      return { saved: false, best: await loadBest(gameId, profile) };
    }

    if (profile) {
      await sb.from("game_records").insert({ user_id: profile.id, game_id: gameId, score: rounded });
      await sb.rpc("add_points", { p_delta: rounded });
      const best = await loadBest(gameId, profile);
      return { saved: true, best: Math.max(best, rounded) };
    }

    Auth.addGuestPoints(rounded);
    const best = Math.max(getGuestBest(gameId), rounded);
    setGuestBest(gameId, best);
    return { saved: true, best };
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
        <div class="game-over-overlay" data-game-over hidden>
          <div class="game-over-card">
            <h3 data-game-over-title>Spillet er over</h3>
            <p class="game-over-score" data-game-over-score></p>
            <p class="section-sub" data-game-over-best></p>
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
      overlay: container.querySelector("[data-game-over]"),
      overlayTitle: container.querySelector("[data-game-over-title]"),
      overlayScore: container.querySelector("[data-game-over-score]"),
      overlayBest: container.querySelector("[data-game-over-best]"),
      overlayRestart: container.querySelector("[data-game-over-restart]"),
    };

    let best = await loadBest(gameId, await Auth.getCurrentProfile());
    els.best.textContent = best.toLocaleString("no-NO");

    let restartHandler = null;
    function fireRestart() {
      els.overlay.hidden = true;
      if (restartHandler) restartHandler();
    }
    els.restartBtn.addEventListener("click", fireRestart);
    els.overlayRestart.addEventListener("click", fireRestart);

    return {
      playArea: els.playArea,

      setScore(score) {
        els.score.textContent = Math.max(0, Math.round(score)).toLocaleString("no-NO");
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
        const profile = await Auth.getCurrentProfile();
        const result = await submitScore(gameId, score, profile);
        best = Math.max(best, result.best);
        els.best.textContent = best.toLocaleString("no-NO");
        await Auth.renderHeaderAuth();

        const isNewBest = result.saved && score > prevBest;
        const roundedScore = Math.max(0, Math.round(score));

        els.overlayTitle.textContent = opts.title || "Spillet er over";
        els.overlayScore.textContent = `Du fikk ${roundedScore.toLocaleString("no-NO")} poeng.`;
        els.overlayBest.textContent = isNewBest
          ? "Ny personlig rekord! 🎉"
          : `Rekord: ${best.toLocaleString("no-NO")} poeng.`;
        els.overlay.hidden = false;

        return { isNewBest, best };
      },
    };
  }

  window.PixelPlayGameRuntime = { mount };
})();
