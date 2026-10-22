/**
 * Studilla – Papirkomet (Flappy i rommet).
 * Trykk (mellomrom, pil opp, klikk eller berøring) for å tenne rakettmotoren
 * og fly romskipet Polaris gjennom åpningene mellom asteroidesøylene uten å
 * treffe dem eller bakken. Alt er tegnet som utklipte papirbiter på canvas
 * med fast tidssteg, og i skjermens faktiske oppløsning via session.onScale().
 * Bruker den delte spill-kjøretiden (js/game-runtime.js) for poeng-HUD, rekord
 * og game-over, så poengene går inn i nivåsystemet som vanlig.
 */
(function () {
  "use strict";

  const GAME_ID = "flappy";
  const W = 420;
  const H = 680;
  const G = 96;               // bakkehøyde
  const FLOOR = H - G;

  const GRAVITY = 1400;       // px/s²
  const FLAP_V = -420;        // px/s
  const GAP = 168;
  const SPEED = 170;          // px/s
  const SHIP_X = W * 0.3;
  const SHIP_R = 12;
  const OBSTACLE_POINTS = 10;
  const OBSTACLE_SPACING = 230;
  const STEP = 1 / 120;

  const POLARIS = { body: "#3f9c94", nose: "#f0b43c", fin: "#f0b43c", stripe: "#efe6d2", glass: "#1f2b45" };
  const ROCK_COLORS = ["#8d8174", "#7b7069", "#9b8d7b", "#726c7c", "#857a8c"];
  const ROCK_RADII = [30, 44, 36, 40, 33, 42, 38];

  // ---------- Papirutklipp-hjelpere ----------

  let sk = 1; // skyggeskala (sprites tegnes i 2x)
  let grainCanvas = null;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function rough(pts, amt, r, step) {
    step = step || 5;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push([x1 + (x2 - x1) * t + (r() - 0.5) * amt, y1 + (y2 - y1) * t + (r() - 0.5) * amt]);
      }
    }
    return out;
  }

  function blob(cx, cy, rx, ry, n, amt, r) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + (r() - 0.5) * 2 / n;
      const k = 1 + (r() - 0.5) * 2 * amt;
      out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return out;
  }

  function star4(cx, cy, s, r) {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 - Math.PI / 2;
      const d = (i % 2 ? s * 0.34 : s) * (1 + (r() - 0.5) * 0.2);
      out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
    }
    return out;
  }

  function ring(ax, ay, bx, by, a0, a1, r) {
    const out = [], n = 18;
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([Math.cos(a) * ax + (r() - 0.5), Math.sin(a) * ay + (r() - 0.5)]); }
    for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n; out.push([Math.cos(a) * bx + (r() - 0.5), Math.sin(a) * by + (r() - 0.5)]); }
    return out;
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, v + amt));
    return "#" + [f(n >> 16), f(n >> 8 & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function tracePath(x, pts) {
    x.beginPath();
    pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.closePath();
  }

  function grain(x) {
    if (!grainCanvas) {
      grainCanvas = document.createElement("canvas");
      grainCanvas.width = grainCanvas.height = 96;
      const g = grainCanvas.getContext("2d");
      const id = g.createImageData(96, 96);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = Math.random() < 0.5 ? 0 : 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = Math.random() * 90;
      }
      g.putImageData(id, 0, 0);
    }
    if (!x.__grain) x.__grain = x.createPattern(grainCanvas, "repeat");
    return x.__grain;
  }

  function cut(x, pts, fill, o) {
    o = o || {};
    x.save();
    tracePath(x, pts);
    x.shadowColor = "rgba(8,6,20,.5)";
    x.shadowBlur = (o.blur != null ? o.blur : 5) * sk;
    x.shadowOffsetX = (o.lift != null ? o.lift : 3) * 0.4 * sk;
    x.shadowOffsetY = (o.lift != null ? o.lift : 3) * sk;
    x.lineJoin = "round";
    const ew = o.edgeW != null ? o.edgeW : 3;
    if (ew > 0) { x.strokeStyle = o.edge || "#f3ead8"; x.lineWidth = ew; x.stroke(); }
    x.fillStyle = fill;
    x.fill();
    x.shadowColor = "transparent";
    const gr = o.grain != null ? o.grain : 0.16;
    if (gr > 0) {
      x.clip();
      x.globalAlpha = gr;
      x.fillStyle = grain(x);
      x.fillRect(-2000, -2000, 4000, 4000);
    }
    x.restore();
  }

  function sprite(w, h, fn) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * 2);
    c.height = Math.ceil(h * 2);
    const x = c.getContext("2d");
    x.scale(2, 2);
    fn(x);
    return { c, w, h };
  }

  function drawRocket(x, v, L, seed) {
    const r = rng(seed), f = rng(seed * 7 + L);
    if (L > 0) {
      cut(x, rough([[-19, -8], [-19 - L * 0.5, -7], [-19 - L * 0.35, -3.5], [-19 - L, 0], [-19 - L * 0.35, 3.5], [-19 - L * 0.5, 7], [-19, 8]], 1.4, f, 4), "#ef7a2f", { lift: 1, edgeW: 2 });
      const l = L * 0.6;
      cut(x, rough([[-19, -4.5], [-19 - l * 0.6, -3], [-19 - l, 0], [-19 - l * 0.6, 3], [-19, 4.5]], 1, f, 4), "#f6d04d", { lift: 1, edgeW: 0 });
    }
    const fin = [[-8, -10], [-24, -24], [-31, -22], [-22, -9]];
    cut(x, rough(fin, 1.4, r, 4), v.fin);
    cut(x, rough(fin.map(([a, b]) => [a, -b]).reverse(), 1.4, r, 4), v.fin);
    cut(x, rough([[-26, -6], [-21, -7.5], [-21, 7.5], [-26, 6]], 0.8, r, 3), "#3a3550", { lift: 1 });
    cut(x, rough([[-23, -10], [4, -12], [16, -9.5], [16, 9.5], [4, 12], [-23, 10]], 1.2, r, 4), v.body);
    cut(x, rough([[-12, -11.2], [-6, -11.6], [-6, 11.6], [-12, 11.2]], 0.8, r, 3), v.stripe, { lift: 1, edgeW: 0, blur: 2 });
    cut(x, rough([[15, -9.5], [22, -6.5], [30, 0], [22, 6.5], [15, 9.5]], 1, r, 3), v.nose, { lift: 2 });
    cut(x, blob(4, 0, 7, 7, 14, 0.1, r), "#efe6d2", { lift: 2, edgeW: 1.5, edge: "#ffffff" });
    cut(x, blob(4, 0, 4.6, 4.6, 12, 0.1, r), v.glass, { lift: 1, edgeW: 0, blur: 1 });
    cut(x, blob(2.4, -1.8, 1.4, 1.1, 8, 0.1, r), "#ffffff", { lift: 0, edgeW: 0, blur: 0, grain: 0 });
  }

  function drawRock(x, R, col, r) {
    cut(x, blob(0, 0, R, R * (0.88 + r() * 0.12), 11, 0.13, r), col, { lift: 3, edgeW: 3 });
    cut(x, blob(-R * 0.25, -R * 0.3, R * 0.42, R * 0.28, 9, 0.18, r), shade(col, 18), { lift: 0.5, edgeW: 0, blur: 1 });
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = r() * R * 0.5, cr = R * (0.12 + r() * 0.14);
      cut(x, blob(Math.cos(a) * d, Math.sin(a) * d, cr, cr * 0.85, 9, 0.15, r), shade(col, -24), { lift: -1.2, edgeW: 0, blur: 1, grain: 0.25 });
    }
  }

  function buildSprites() {
    const S = {};
    sk = 1;
    // Polaris: 4 flammeframes (tomgang 1, tomgang 2, boost, boost ut) + krasj.
    S.ship = [7, 11, 28, 18, 0].map((L) => sprite(120, 64, (x) => {
      x.translate(60, 32);
      drawRocket(x, POLARIS, L, 11 + 31);
    }));
    S.rocks = ROCK_RADII.map((rad, i) => {
      const s = sprite(rad * 2 + 24, rad * 2 + 24, (x) => {
        x.translate(rad + 12, rad + 12);
        drawRock(x, rad, ROCK_COLORS[i % ROCK_COLORS.length], rng(100 + i));
      });
      s.r = rad;
      return s;
    });

    S.stars = sprite(W, H, (x) => {
      const r = rng(7);
      x.fillStyle = "#efe6d2";
      for (let i = 0; i < 90; i++) {
        const px = r() * W, py = r() * (H - G), s = 0.6 + r() * 1.3;
        x.globalAlpha = 0.3 + r() * 0.5;
        for (const o of [-W, 0, W]) { x.beginPath(); x.arc(px + o, py, s, 0, 7); x.fill(); }
      }
      x.globalAlpha = 1;
      for (let i = 0; i < 14; i++) {
        const px = r() * W, py = r() * (H - G - 140), s = 4 + r() * 6;
        const col = r() < 0.5 ? "#f3d77a" : "#efe6d2", pts = star4(0, 0, s, r);
        for (const o of [-W, 0, W]) cut(x, pts.map(([a, b]) => [a + px + o, b + py]), col, { lift: 2, edgeW: 1.5, blur: 3 });
      }
    });

    S.planet = sprite(Math.round(W * 1.6), H, (x) => {
      const r = rng(21), R = 56;
      x.save(); x.translate(W * 0.95, 170); x.rotate(-0.35);
      cut(x, ring(R * 1.75, R * 0.5, R * 1.35, R * 0.36, Math.PI, Math.PI * 2, r), "#e3c98a", { lift: 2 });
      const pp = blob(0, 0, R, R, 22, 0.03, r);
      cut(x, pp, "#d9824a", { lift: 4 });
      x.save(); tracePath(x, pp); x.clip();
      [[-R * 0.45, 10, "#c26b3c"], [R * 0.1, 14, "#e69a62"], [R * 0.55, 8, "#c26b3c"]].forEach(([y, h, c]) =>
        cut(x, rough([[-R - 5, y], [R + 5, y - 3], [R + 5, y + h], [-R - 5, y + h + 3]], 1.5, r, 6), c, { lift: 1, edgeW: 0, blur: 2 }));
      x.restore();
      cut(x, ring(R * 1.75, R * 0.5, R * 1.35, R * 0.36, 0, Math.PI, r), "#e3c98a", { lift: 2 });
      x.restore();
      cut(x, blob(W * 1.35, 300, 15, 15, 14, 0.05, r), "#a9a3c4", { lift: 3 });
      cut(x, blob(W * 1.35 - 4, 296, 4, 3.4, 8, 0.1, r), "#8c86aa", { lift: -1, edgeW: 0, blur: 1 });
    });

    const hills = (seed, base, amp, f, col, edge) => sprite(W, H, (x) => {
      const r = rng(seed), p1 = r() * 6, p2 = r() * 6, pts = [];
      for (let px = -24; px <= W + 24; px += 6) {
        const t = px / W * Math.PI * 2;
        pts.push([px, base + amp * Math.sin(t * f[0] + p1) + amp * 0.45 * Math.sin(t * f[1] + p2) + (px > 0 && px < W ? (r() - 0.5) * 1.6 : 0)]);
      }
      pts.push([W + 24, H + 20], [-24, H + 20]);
      cut(x, pts, col, { lift: 0, blur: 10, edge, edgeW: 2 });
    });
    S.hillsA = hills(31, H - G - 150, 22, [2, 5], "#2a2750", "#433f72");
    S.hillsB = hills(47, H - G - 62, 16, [3, 7], "#37335f", "#524d85");

    S.ground = sprite(W, G + 20, (x) => {
      const r = rng(55);
      const band = (base, amp, f, col, ph, edge) => {
        const pts = [];
        for (let px = -24; px <= W + 24; px += 5) {
          const t = px / W * Math.PI * 2;
          pts.push([px, base + amp * Math.sin(t * f + ph) + amp * 0.5 * Math.sin(t * (f * 2 + 1) + ph * 2) + (px > 0 && px < W ? (r() - 0.5) * 1.2 : 0)]);
        }
        pts.push([W + 24, G + 60], [-24, G + 60]);
        cut(x, pts, col, { lift: -2, blur: 5, edge, edgeW: 2.5 });
      };
      band(14, 4, 3, "#d3c6a7", 0.5, "#f3ead8");
      for (let i = 0; i < 6; i++) {
        const rx = 10 + r() * 12, cx = 30 + rx + (W - 60 - rx * 2) * (i + r() * 0.6) / 6, cy = 28 + r() * 14;
        cut(x, blob(cx, cy, rx, rx * 0.35, 14, 0.08, r), "#b3a586", { lift: -1.5, edgeW: 1.5, edge: "#ebe2cb", blur: 2 });
      }
      band(54, 3, 4, "#bcae8e", 1.3, "#d8ccb0");
      band(82, 2.5, 5, "#a6987a", 2.1, "#c4b799");
      for (let i = 0; i < 14; i++) {
        const s = 2 + r() * 2.5;
        cut(x, blob(20 + r() * (W - 40), 64 + r() * 40, s, s * 0.8, 7, 0.2, r), "#8f8268", { lift: 1, edgeW: 1, edge: "#c4b799", blur: 1 });
      }
    });
    return S;
  }

  // ---------- Spill ----------

  function start(container) {
    let session = null;
    let canvas = null;
    let ctx = null;
    let pxScale = 1;
    let S = null;

    let state = "ready"; // ready | playing | dead
    let shipY = H * 0.42;
    let shipV = 0;
    let rot = 0;
    let obstacles = [];
    let score = 0;
    let dist = 0;
    let time = 0;
    let flameT = 0;
    let acc = 0;
    let last = 0;
    let raf = 0;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `<canvas class="flappy-canvas" data-flappy width="${W}" height="${H}"></canvas>`;
      canvas = session.playArea.querySelector("[data-flappy]");
      ctx = canvas.getContext("2d");
      S = buildSprites();
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
      shipY = H * 0.42;
      shipV = 0;
      rot = 0;
      obstacles = [];
      score = 0;
      flameT = 0;
      session.setScore(0);
      session.hideOverlay();
      session.clearState();
      draw();
    }

    function flap() {
      if (!session) return;
      if (state === "ready") state = "playing";
      if (state === "playing") { shipV = FLAP_V; flameT = 0.32; }
    }

    function makeObstacle(x) {
      const minY = 110 + GAP / 2;
      const maxY = FLOOR - 80 - GAP / 2;
      const cy = minY + Math.random() * (maxY - minY);
      const rocks = [];
      const add = (c, dir) => {
        const i = Math.floor(Math.random() * S.rocks.length);
        const r = S.rocks[i].r;
        return { i, r, y: c + dir * r, dx: (Math.random() - 0.5) * 16, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.6 };
      };
      // Stable asteroider oppover og nedover fra åpningen.
      let edge = cy - GAP / 2;
      for (;;) {
        const k = add(edge, -1);
        rocks.push(k);
        edge = k.y - k.r * 0.35;
        if (k.y < -k.r) break;
      }
      edge = cy + GAP / 2;
      for (;;) {
        const k = add(edge, 1);
        rocks.push(k);
        edge = k.y + k.r * 0.35;
        if (k.y - k.r > FLOOR) break;
      }
      return { x, rocks, passed: false };
    }

    function die() {
      if (state === "dead") return;
      state = "dead";
      shipV = -220;
      flameT = 0;
      session.finish(score);
    }

    function update(dt) {
      time += dt;
      flameT = Math.max(0, flameT - dt);
      obstacles.forEach((o) => o.rocks.forEach((r) => { r.rot += r.spin * dt; }));

      if (state === "ready") {
        dist += SPEED * dt * 0.6;
        shipY = H * 0.42 + Math.sin(time * 3) * 8;
        rot = Math.sin(time * 3 + 1) * 0.08;
        return;
      }
      if (state === "dead") {
        // Skipet faller til bakken etter krasj.
        if (shipY < FLOOR - 8) {
          shipV += GRAVITY * dt;
          shipY = Math.min(FLOOR - 8, shipY + shipV * dt);
          rot += dt * 7;
        }
        return;
      }

      dist += SPEED * dt;
      shipV += GRAVITY * dt;
      shipY += shipV * dt;
      if (shipY < -20) { shipY = -20; shipV = 0; }
      const target = Math.max(-0.45, Math.min(1.1, shipV / 650));
      rot += (target - rot) * Math.min(1, dt * 10);

      obstacles.forEach((o) => { o.x -= SPEED * dt; });
      obstacles = obstacles.filter((o) => o.x > -120);
      const lastO = obstacles[obstacles.length - 1];
      if (!lastO || lastO.x < W - OBSTACLE_SPACING) obstacles.push(makeObstacle(W + 60));

      for (const o of obstacles) {
        if (!o.passed && o.x + 20 < SHIP_X) {
          o.passed = true;
          score += OBSTACLE_POINTS;
          session.setScore(score);
        }
        for (const r of o.rocks) {
          const dx = o.x + r.dx - SHIP_X, dy = r.y - shipY, rr = r.r * 0.8 + SHIP_R;
          if (dx * dx + dy * dy < rr * rr) return die();
        }
      }
      if (shipY + SHIP_R > FLOOR + 4) die();
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

    function tile(s, off, y) {
      const o = ((off % s.w) + s.w) % s.w;
      for (let x = -o; x < W; x += s.w) ctx.drawImage(s.c, x, y || 0, s.w, s.h);
    }

    function text(str, x, y, size, col, stroke) {
      ctx.save();
      ctx.font = `800 ${size}px Figtree, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      if (stroke !== null) {
        ctx.lineWidth = size / 6;
        ctx.strokeStyle = stroke || "#1c1a35";
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = col || "#f3ead8";
      ctx.fillText(str, x, y);
      ctx.restore();
    }

    function draw() {
      if (!ctx || !S) return;
      ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);
      ctx.fillStyle = "#1c1a35";
      ctx.fillRect(0, 0, W, H);

      tile(S.stars, dist * 0.06);
      tile(S.planet, dist * 0.14);
      tile(S.hillsA, dist * 0.28);
      tile(S.hillsB, dist * 0.5);

      for (const o of obstacles) {
        for (const r of o.rocks) {
          const s = S.rocks[r.i], px = o.x + r.dx;
          if (px < -80 || px > W + 80) continue;
          ctx.save();
          ctx.translate(px, r.y);
          ctx.rotate(r.rot);
          ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h);
          ctx.restore();
        }
      }

      let fr;
      if (state === "dead") fr = 4;
      else if (flameT > 0.2) fr = 2;
      else if (flameT > 0.06) fr = 3;
      else fr = Math.floor(time * 14) % 2;
      const s = S.ship[fr];
      ctx.save();
      ctx.translate(SHIP_X, shipY);
      ctx.rotate(rot);
      ctx.drawImage(s.c, -60, -32, 120, 64);
      ctx.restore();

      tile(S.ground, dist, FLOOR - 14);

      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = grain(ctx);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      if (state === "ready") {
        text("Papirkomet", W / 2, H * 0.22, 52);
        text("Trykk for å fly", W / 2, H * 0.58, 28);
      } else {
        text(String(score / OBSTACLE_POINTS), W / 2, 66, 60);
      }
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
