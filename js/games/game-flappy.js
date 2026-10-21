/**
 * Studilla – Flappy.
 * Trykk (mellomrom, pil opp, klikk eller berøring) for å la fuglen flakse,
 * og fly gjennom åpningene mellom rørene uten å treffe dem, bakken eller
 * taket. Tegnes på canvas med fast tidssteg, og i skjermens faktiske
 * oppløsning via session.onScale(). Bruker den delte spill-kjøretiden
 * (js/game-runtime.js) for poeng-HUD, rekord og game-over.
 */
(function () {
  "use strict";

  const GAME_ID = "flappy";
  const W = 360;
  const H = 540;
  const GROUND_H = 64;
  const PLAY_H = H - GROUND_H;

  const GRAVITY = 1500;       // px/s²
  const FLAP_V = -430;        // px/s
  const MAX_FALL = 620;
  const PIPE_W = 62;
  const PIPE_GAP = 150;
  const PIPE_SPACING = 200;   // avstand mellom rør (px)
  const SPEED = 130;          // px/s
  const BIRD_X = 96;
  const BIRD_R = 13;
  const PIPE_POINTS = 10;
  const STEP = 1 / 120;

  function start(container) {
    let session = null;
    let canvas = null;
    let ctx = null;
    let pxScale = 1;

    let state = "ready"; // ready | playing | dead
    let birdY = PLAY_H / 2;
    let birdV = 0;
    let pipes = [];
    let score = 0;
    let groundX = 0;
    let time = 0;
    let acc = 0;
    let last = 0;
    let raf = 0;
    let deadFlash = 0;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `<canvas class="flappy-canvas" data-flappy width="${W}" height="${H}"></canvas>`;
      canvas = session.playArea.querySelector("[data-flappy]");
      ctx = canvas.getContext("2d");
      // Tegn i faktisk skjermoppløsning så brettet ikke blir uskarpt når
      // spillet skaleres opp for å fylle skjermen.
      session.onScale((scale) => {
        pxScale = Math.max(1, scale * (window.devicePixelRatio || 1));
        canvas.width = Math.round(W * pxScale);
        canvas.height = Math.round(H * pxScale);
        draw();
      });
      session.onRestart(() => initGame());
      attachControls();
      initGame();
      raf = requestAnimationFrame(loop);
    });

    function initGame() {
      state = "ready";
      birdY = PLAY_H / 2;
      birdV = 0;
      pipes = [];
      score = 0;
      groundX = 0;
      deadFlash = 0;
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      draw();
    }

    function flap() {
      if (!session) return;
      if (state === "ready") {
        state = "playing";
        // Første rør kommer med litt avstand fra fuglen.
        pipes.push(makePipe(W + 120));
      }
      if (state === "playing") birdV = FLAP_V;
    }

    function makePipe(x) {
      const margin = 50;
      const gapTop = margin + Math.random() * (PLAY_H - PIPE_GAP - margin * 2);
      return { x, gapTop, passed: false };
    }

    function die() {
      if (state === "dead") return;
      state = "dead";
      deadFlash = 1;
      session.finish(score);
    }

    function update(dt) {
      time += dt;
      if (state === "ready") {
        // Fuglen svever rolig opp og ned før første trykk.
        birdY = PLAY_H / 2 + Math.sin(time * 4) * 8;
        groundX = (groundX + SPEED * dt) % 24;
        return;
      }
      if (state === "dead") {
        // Fuglen faller til bakken etter krasj.
        birdV = Math.min(MAX_FALL, birdV + GRAVITY * dt);
        birdY = Math.min(PLAY_H - BIRD_R, birdY + birdV * dt);
        deadFlash = Math.max(0, deadFlash - dt * 3);
        return;
      }

      birdV = Math.min(MAX_FALL, birdV + GRAVITY * dt);
      birdY += birdV * dt;
      groundX = (groundX + SPEED * dt) % 24;

      for (const p of pipes) p.x -= SPEED * dt;
      if (pipes.length && pipes[0].x + PIPE_W < -4) pipes.shift();
      const lastPipe = pipes[pipes.length - 1];
      if (!lastPipe || lastPipe.x < W - PIPE_SPACING) pipes.push(makePipe(W + 10));

      for (const p of pipes) {
        if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
          p.passed = true;
          score += PIPE_POINTS;
          session.setScore(score);
        }
        // Sirkel mot to rektangler (øvre og nedre rør).
        const hitX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
        if (hitX && (birdY - BIRD_R < p.gapTop || birdY + BIRD_R > p.gapTop + PIPE_GAP)) {
          return die();
        }
      }
      if (birdY + BIRD_R >= PLAY_H || birdY - BIRD_R <= 0) {
        birdY = Math.max(BIRD_R, Math.min(PLAY_H - BIRD_R, birdY));
        die();
      }
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (!last) last = now;
      // Begrens dt så en pause i fanen ikke gir et enormt hopp.
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        update(STEP);
        acc -= STEP;
      }
      draw();
    }

    // ---------- Tegning ----------

    function draw() {
      if (!ctx) return;
      ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);

      const sky = ctx.createLinearGradient(0, 0, 0, PLAY_H);
      sky.addColorStop(0, "#6dc7f5");
      sky.addColorStop(1, "#bfe8fb");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      drawClouds();
      pipes.forEach(drawPipe);
      drawGround();
      drawBird();

      if (state === "ready") {
        ctx.fillStyle = "rgba(20, 30, 50, .72)";
        roundRect(W / 2 - 112, 120, 224, 70, 14);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "700 20px Figtree, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Trykk for å flakse", W / 2, 150);
        ctx.font = "500 14px Figtree, system-ui, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.fillText("Mellomrom, klikk eller berøring", W / 2, 174);
      } else if (state === "playing") {
        drawScore();
      }
      if (deadFlash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${deadFlash * 0.7})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawClouds() {
      ctx.fillStyle = "rgba(255,255,255,.65)";
      const offset = (time * 8) % (W + 120);
      [[60, 90, 1], [220, 150, 0.8], [330, 60, 0.6]].forEach(([x, y, s]) => {
        const cx = ((x - offset) % (W + 120) + (W + 120)) % (W + 120) - 60;
        ctx.beginPath();
        ctx.arc(cx, y, 20 * s, 0, Math.PI * 2);
        ctx.arc(cx + 20 * s, y + 6 * s, 16 * s, 0, Math.PI * 2);
        ctx.arc(cx - 20 * s, y + 6 * s, 15 * s, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function drawPipe(p) {
      const capH = 24;
      const body = ctx.createLinearGradient(p.x, 0, p.x + PIPE_W, 0);
      body.addColorStop(0, "#58b333");
      body.addColorStop(0.5, "#86e05a");
      body.addColorStop(1, "#4a9a2a");
      const bottomTop = p.gapTop + PIPE_GAP;

      ctx.fillStyle = body;
      ctx.fillRect(p.x + 4, 0, PIPE_W - 8, p.gapTop);
      ctx.fillRect(p.x + 4, bottomTop, PIPE_W - 8, PLAY_H - bottomTop);
      ctx.fillRect(p.x - 2, p.gapTop - capH, PIPE_W + 4, capH);
      ctx.fillRect(p.x - 2, bottomTop, PIPE_W + 4, capH);

      ctx.strokeStyle = "#2f6b19";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 4, -2, PIPE_W - 8, p.gapTop + 2);
      ctx.strokeRect(p.x + 4, bottomTop, PIPE_W - 8, PLAY_H - bottomTop + 2);
      ctx.strokeRect(p.x - 2, p.gapTop - capH, PIPE_W + 4, capH);
      ctx.strokeRect(p.x - 2, bottomTop, PIPE_W + 4, capH);
    }

    function drawGround() {
      ctx.fillStyle = "#ded895";
      ctx.fillRect(0, PLAY_H, W, GROUND_H);
      ctx.fillStyle = "#73bf2e";
      ctx.fillRect(0, PLAY_H, W, 12);
      ctx.fillStyle = "#5fa023";
      for (let x = -24 + (24 - groundX); x < W; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, PLAY_H);
        ctx.lineTo(x + 12, PLAY_H);
        ctx.lineTo(x + 6, PLAY_H + 12);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "#c9c07a";
      ctx.fillRect(0, PLAY_H + 12, W, 3);
    }

    function drawBird() {
      // Vippen følger fallhastigheten.
      const tilt = state === "ready" ? 0 : Math.max(-0.45, Math.min(1.2, birdV / 520));
      ctx.save();
      ctx.translate(BIRD_X, birdY);
      ctx.rotate(tilt);

      ctx.fillStyle = "#f7c531";
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_R + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8a5a00";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Vinge som slår raskt mens fuglen stiger.
      const flapPhase = state === "dead" ? 0.4 : Math.sin(time * (birdV < 0 ? 40 : 12));
      ctx.fillStyle = "#e8a61c";
      ctx.beginPath();
      ctx.ellipse(-4, 3 + flapPhase * 3, 8, 5, -0.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(6, -5, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(8, -5, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#f2682d";
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(24, 3);
      ctx.lineTo(12, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawScore() {
      ctx.textAlign = "center";
      ctx.font = "800 44px Figtree, system-ui, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.strokeText(String(score / PIPE_POINTS), W / 2, 76);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(score / PIPE_POINTS), W / 2, 76);
    }

    // ---------- Styring ----------

    function attachControls() {
      document.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
          // Mellomrom skal ikke trykke på «Spill igjen»-knappen med fokus
          // eller scrolle siden mens man spiller.
          if (state === "dead") return;
          e.preventDefault();
          if (!e.repeat) flap();
        }
      });
      canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        flap();
      });
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
