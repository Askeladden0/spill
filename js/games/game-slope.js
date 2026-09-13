/**
 * Studilla – Slope.
 * Ballen ruller nedover en endeløs bane og akselererer hele tiden. Styr til
 * venstre/høyre (piltaster/A-D, eller trykk og hold venstre/høyre halvdel på
 * mobil) for å unngå de røde blokkene og for ikke å trille utfor kanten.
 * Skåren er hvor langt du ruller før du krasjer. Bruker den delte
 * spill-kjøretiden (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 *
 * Banen tegnes med en enkel pseudo-3D-projeksjon (samme grunnprinsipp som
 * gamle kjørespill): et punkt i verdensrommet (x, z) skaleres ned mot et
 * fluktpunkt på horisonten etter hvor langt unna (z) det er.
 */
(function () {
  "use strict";

  const GAME_ID = "slope";
  const WIDTH = 480;
  const HEIGHT = 720;
  const HORIZON_Y = HEIGHT * 0.3;
  const FOCAL = 130;
  const TRACK_HALF_WIDTH = 5.2;
  const SEGMENT_LEN = 10;
  const RENDER_SEGMENTS = 46;
  const PX_PER_WORLD = (WIDTH * 0.86) / (TRACK_HALF_WIDTH * 2);
  const BALL_RADIUS = 0.62;
  const BALL_SCREEN_Y = HEIGHT - 96;

  const BASE_SPEED = 15;
  const MAX_SPEED = 34;
  const SPEED_RAMP_DIST = 2600;
  const STEER_MAX = 9.5;
  const STEER_LERP = 9;
  const SCORE_PER_UNIT = 3.4;
  const SAFE_SEGMENTS = 6;

  function start(container) {
    let canvas = null;
    let ctx = null;
    let session = null;
    let renderScale = 1;
    let rafId = null;
    let lastTime = 0;

    let ballX = 0;
    let vx = 0;
    let distance = 0;
    let score = 0;
    let over = false;
    let steerDir = 0;
    let rollPhase = 0;
    let crashAt = 0;
    let saveAccum = 0;

    // Hindre lagres på indeksen til segmentet de hører til
    // (Math.floor(z / SEGMENT_LEN)), i stedet for i en fast liste – da slipper
    // vi å flytte hele banen når kameraet beveger seg, og gamle indekser
    // fjernes bare når de er langt bak ballen (se pruneObstacles).
    let obstacles = {};
    let maxGeneratedIndex = -1;
    let lastHadObstacle = false;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `<canvas class="board-slope" data-board-slope tabindex="0"></canvas>`;
      canvas = session.playArea.querySelector("[data-board-slope]");
      ctx = canvas.getContext("2d");
      session.onScale(applyRenderScale);
      session.onRestart(() => initGame());
      attachControls();
      if (!resumeGame()) initGame();
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    });

    function applyRenderScale(scale) {
      if (!canvas) return;
      canvas.style.width = `${WIDTH}px`;
      canvas.style.height = `${HEIGHT}px`;
      const dpr = window.devicePixelRatio || 1;
      const next = Math.min(3, Math.max(1, (scale || 1) * dpr));
      if (Math.abs(next - renderScale) < 0.01 && canvas.width) return;
      renderScale = next;
      canvas.width = Math.round(WIDTH * renderScale);
      canvas.height = Math.round(HEIGHT * renderScale);
    }

    function initGame() {
      ballX = 0;
      vx = 0;
      distance = 0;
      score = 0;
      over = false;
      steerDir = 0;
      rollPhase = 0;
      saveAccum = 0;
      obstacles = {};
      maxGeneratedIndex = -1;
      lastHadObstacle = false;
      ensureGenerated(RENDER_SEGMENTS);
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      if (canvas) canvas.focus({ preventScroll: true });
    }

    function pruneObstacles(fromIndex) {
      for (const key in obstacles) {
        if (Number(key) < fromIndex - 2) delete obstacles[key];
      }
    }

    function resumeGame() {
      const saved = session.savedState();
      const validNum = (n) => Number.isFinite(n);
      if (!saved || !validNum(saved.distance) || saved.distance < 0 || !saved.obstacles) return false;

      distance = saved.distance;
      ballX = validNum(saved.ballX) ? saved.ballX : 0;
      vx = validNum(saved.vx) ? saved.vx : 0;
      score = Math.floor(distance * SCORE_PER_UNIT);
      over = false;
      steerDir = 0;
      rollPhase = validNum(saved.rollPhase) ? saved.rollPhase : 0;
      saveAccum = 0;
      obstacles = {};
      for (const key in saved.obstacles) {
        const o = saved.obstacles[key];
        if (o && validNum(o.x) && validNum(o.halfWidth)) obstacles[key] = { x: o.x, halfWidth: o.halfWidth };
      }
      maxGeneratedIndex = validNum(saved.maxGeneratedIndex) ? saved.maxGeneratedIndex : -1;
      lastHadObstacle = !!saved.lastHadObstacle;

      const currentIndex = Math.floor(distance / SEGMENT_LEN);
      ensureGenerated(currentIndex + RENDER_SEGMENTS);

      session.setScore(score);
      session.hideOverlay();
      if (canvas) canvas.focus({ preventScroll: true });
      return true;
    }

    function saveGame() {
      if (!session || over) return;
      const currentIndex = Math.floor(distance / SEGMENT_LEN);
      const packed = {};
      for (const key in obstacles) {
        if (Number(key) >= currentIndex - 2) packed[key] = obstacles[key];
      }
      session.saveState({
        distance, ballX, vx, rollPhase, maxGeneratedIndex, lastHadObstacle,
        obstacles: packed,
      });
    }

    // Bredden på hindrene øker jo lenger man har kommet, men aldri mer enn at
    // det alltid er plass nok til ballen (+ litt reaksjonsmargin) et sted i
    // banebredden. Segmentet rett etter et hinder er alltid fritt, slik at man
    // aldri kan møte to hindre man må reagere på i samme øyeblikk.
    function generateSegment(index) {
      if (index < SAFE_SEGMENTS) return;
      const difficulty = Math.min(1, distance / 4000);
      const chance = 0.4 + difficulty * 0.35;
      if (lastHadObstacle || Math.random() > chance) {
        lastHadObstacle = false;
        return;
      }
      const trackWidth = TRACK_HALF_WIDTH * 2;
      const widthFrac = 0.35 + difficulty * 0.3 + Math.random() * 0.08;
      const obstacleWidth = trackWidth * Math.min(0.7, widthFrac);
      const left = -TRACK_HALF_WIDTH + Math.random() * (trackWidth - obstacleWidth);
      obstacles[index] = { x: left + obstacleWidth / 2, halfWidth: obstacleWidth / 2 };
      lastHadObstacle = true;
    }

    function ensureGenerated(uptoIndex) {
      for (let i = maxGeneratedIndex + 1; i <= uptoIndex; i++) generateSegment(i);
      if (uptoIndex > maxGeneratedIndex) maxGeneratedIndex = uptoIndex;
    }

    function crash() {
      if (over) return;
      over = true;
      crashAt = performance.now();
      window.setTimeout(() => {
        if (session) session.finish(score);
      }, 380);
    }

    function update(dt) {
      const targetVX = steerDir * STEER_MAX;
      vx += (targetVX - vx) * Math.min(1, dt * STEER_LERP);
      ballX += vx * dt;

      const speed = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * Math.min(1, distance / SPEED_RAMP_DIST);
      distance += speed * dt;
      rollPhase += speed * dt * 0.9;
      score = Math.floor(distance * SCORE_PER_UNIT);
      session.setScore(score);

      const currentIndex = Math.floor(distance / SEGMENT_LEN);
      ensureGenerated(currentIndex + RENDER_SEGMENTS);
      pruneObstacles(currentIndex);

      if (Math.abs(ballX) - BALL_RADIUS * 0.5 > TRACK_HALF_WIDTH) {
        crash();
        return;
      }

      const obs = obstacles[currentIndex];
      if (obs) {
        const hitMargin = BALL_RADIUS * 0.7;
        if (ballX + hitMargin > obs.x - obs.halfWidth && ballX - hitMargin < obs.x + obs.halfWidth) {
          crash();
          return;
        }
      }

      saveAccum += dt;
      if (saveAccum >= 1) {
        saveAccum = 0;
        saveGame();
      }
    }

    function project(x, z) {
      const scale = FOCAL / (FOCAL + Math.max(0, z));
      return {
        x: WIDTH / 2 + x * PX_PER_WORLD * scale,
        y: HORIZON_Y + scale * (HEIGHT - HORIZON_Y),
        scale,
      };
    }

    function drawBackground() {
      const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      grad.addColorStop(0, "#0a0f1a");
      grad.addColorStop(1, "#0d1420");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      const glow = ctx.createRadialGradient(WIDTH / 2, HORIZON_Y, 10, WIDTH / 2, HORIZON_Y, WIDTH * 0.6);
      glow.addColorStop(0, "rgba(46, 232, 127, .16)");
      glow.addColorStop(1, "rgba(46, 232, 127, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    function drawTrack() {
      const currentIndex = Math.floor(distance / SEGMENT_LEN);
      // Tegnes bakfra og fremover (lengst unna først), slik at nære fliser
      // dekker over de fjerne der de overlapper i projeksjonen.
      for (let i = currentIndex + RENDER_SEGMENTS; i >= currentIndex; i--) {
        const z0 = i * SEGMENT_LEN - distance;
        const z1 = z0 + SEGMENT_LEN;
        if (z1 < 0) continue;
        const near = project(-TRACK_HALF_WIDTH, z0);
        const nearR = project(TRACK_HALF_WIDTH, z0);
        const far = project(-TRACK_HALF_WIDTH, z1);
        const farR = project(TRACK_HALF_WIDTH, z1);
        if (far.y <= HORIZON_Y + 1 && near.y <= HORIZON_Y + 1) continue;

        ctx.beginPath();
        ctx.moveTo(near.x, near.y);
        ctx.lineTo(nearR.x, nearR.y);
        ctx.lineTo(farR.x, farR.y);
        ctx.lineTo(far.x, far.y);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? "#122336" : "#0e1c2c";
        ctx.fill();
        ctx.strokeStyle = "rgba(92, 245, 223, .18)";
        ctx.lineWidth = 1;
        ctx.stroke();

        const obs = obstacles[i];
        if (obs) {
          const oNear = project(obs.x - obs.halfWidth, z0);
          const oNearR = project(obs.x + obs.halfWidth, z0);
          const oFar = project(obs.x - obs.halfWidth, z1);
          const oFarR = project(obs.x + obs.halfWidth, z1);
          ctx.beginPath();
          ctx.moveTo(oNear.x, oNear.y);
          ctx.lineTo(oNearR.x, oNearR.y);
          ctx.lineTo(oFarR.x, oFarR.y);
          ctx.lineTo(oFar.x, oFar.y);
          ctx.closePath();
          ctx.fillStyle = "#e8384f";
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 180, 190, .5)";
          ctx.stroke();
        }
      }
    }

    function drawBall() {
      const bob = over ? 0 : Math.sin(rollPhase * 2) * 3;
      const x = WIDTH / 2 + ballX * PX_PER_WORLD;
      const y = BALL_SCREEN_Y + bob;
      const r = BALL_RADIUS * PX_PER_WORLD;

      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.9, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, .35)";
      ctx.fill();

      const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
      grad.addColorStop(0, "#c9fff0");
      grad.addColorStop(0.55, "#2ee87f");
      grad.addColorStop(1, "#159a55");
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // To buer som roterer med rulle-fasen antyder at kula spinner fremover.
      ctx.strokeStyle = "rgba(13, 30, 20, .4)";
      ctx.lineWidth = Math.max(1, r * 0.12);
      for (const offset of [0, Math.PI]) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.6, rollPhase + offset, rollPhase + offset + Math.PI * 0.55);
        ctx.stroke();
      }
    }

    function render() {
      if (!ctx) return;
      ctx.save();
      ctx.scale(renderScale, renderScale);

      if (over) {
        const elapsed = performance.now() - crashAt;
        const shake = Math.max(0, 1 - elapsed / 300);
        if (shake > 0) {
          ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);
        }
      }

      drawBackground();
      drawTrack();
      drawBall();

      if (over) {
        const elapsed = performance.now() - crashAt;
        const flash = Math.max(0, 1 - elapsed / 380);
        if (flash > 0) {
          ctx.fillStyle = `rgba(232, 56, 79, ${flash * 0.35})`;
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
        }
      }

      ctx.restore();
    }

    function loop(time) {
      const dt = Math.min(0.033, (time - lastTime) / 1000);
      lastTime = time;
      if (!over) update(dt);
      render();
      rafId = requestAnimationFrame(loop);
    }

    const KEY_STEER = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };
    const pressed = { left: false, right: false };

    function updateSteerFromKeys() {
      steerDir = (pressed.right ? 1 : 0) - (pressed.left ? 1 : 0);
    }

    let pointerDown = false;

    function steerFromPointerX(clientX) {
      const rect = canvas.getBoundingClientRect();
      const relX = clientX - rect.left;
      pointerDown = true;
      steerDir = relX < rect.width / 2 ? -1 : 1;
    }

    function attachControls() {
      document.addEventListener("keydown", (e) => {
        const dir = KEY_STEER[e.key];
        if (dir === undefined) return;
        e.preventDefault();
        if (dir < 0) pressed.left = true; else pressed.right = true;
        if (!pointerDown) updateSteerFromKeys();
      });
      document.addEventListener("keyup", (e) => {
        const dir = KEY_STEER[e.key];
        if (dir === undefined) return;
        if (dir < 0) pressed.left = false; else pressed.right = false;
        if (!pointerDown) updateSteerFromKeys();
      });

      canvas.addEventListener("mousedown", (e) => steerFromPointerX(e.clientX));
      canvas.addEventListener("mousemove", (e) => {
        if (pointerDown) steerFromPointerX(e.clientX);
      });
      window.addEventListener("mouseup", () => {
        if (!pointerDown) return;
        pointerDown = false;
        updateSteerFromKeys();
      });

      canvas.addEventListener(
        "touchstart",
        (e) => {
          steerFromPointerX(e.touches[0].clientX);
          e.preventDefault();
        },
        { passive: false }
      );
      canvas.addEventListener(
        "touchmove",
        (e) => {
          steerFromPointerX(e.touches[0].clientX);
          e.preventDefault();
        },
        { passive: false }
      );
      canvas.addEventListener("touchend", (e) => {
        pointerDown = false;
        updateSteerFromKeys();
        e.preventDefault();
      });
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
