/**
 * Studilla – Fruktfusjon.
 * Klassisk "fruit merge"-spill (à la Suika Game): slipp frukt ned i krukken,
 * og når to like frukter treffer hverandre slås de sammen til neste frukt i
 * kjeden. Spill-logikken (frukt-progresjon, poeng, fysikk-følelse og
 * game over-regelen) er portert fra det åpne referanseprosjektet subak-game
 * (github.com/takempf/subak-game, CC BY-NC 4.0). Grafikk og lyd er egne,
 * enkle implementasjoner laget for denne siden – subak-game sine bilder og
 * lydfiler er ikke NonCommercial-lisensiert for et poeng/premie-nettsted som
 * dette, så de er ikke kopiert inn. Poeng-HUDen rundt selve krukken følger
 * sidens stil via den delte spill-kjøretiden (js/game-runtime.js).
 */
(function () {
  "use strict";

  const GAME_ID = "fruktfusjon";

  // Frukt-progresjonen (11 frukter) og radius-forholdene er hentet direkte
  // fra subak-game sine konstanter (GAME_WIDTH = 0.6, FRUIT_SIZES), skalert
  // om til piksler for vår WIDTH. Fargene er omtrentlig samme fargetone som
  // referansens CSS-variabler (--color-blueberry osv.).
  const FRUITS = [
    { name: "Blåbær", radius: 14, color: "#5265ff", emoji: "🫐", points: 2 },
    { name: "Drue", radius: 18, color: "#7fb544", emoji: "🍇", points: 4 },
    { name: "Sitron", radius: 23, color: "#ffb020", emoji: "🍋", points: 6 },
    { name: "Appelsin", radius: 29, color: "#ff6a1f", emoji: "🍊", points: 8 },
    { name: "Eple", radius: 38, color: "#d81e05", emoji: "🍎", points: 10 },
    { name: "Drakefrukt", radius: 47, color: "#f22e6d", emoji: "🐉", points: 12 },
    { name: "Pære", radius: 57, color: "#d6dd6b", emoji: "🍐", points: 14 },
    { name: "Fersken", radius: 70, color: "#ff9c73", emoji: "🍑", points: 16 },
    { name: "Ananas", radius: 79, color: "#ffc61a", emoji: "🍍", points: 18 },
    { name: "Honningmelon", radius: 97, color: "#a4d654", emoji: "🍈", points: 20 },
    { name: "Vannmelon", radius: 116, color: "#7cb518", emoji: "🍉", points: 22 },
  ];

  const WATERMELON_MERGE_BONUS = 100;
  const DROPPABLE_MAX_INDEX = 4; // Kun de 5 minste fruktene faller ned i starten.
  // 2:3-forhold på spillflaten, som i referansen (0.6m x 0.9m).
  const WIDTH = 400;
  const HEIGHT = 600;
  const WALL_THICKNESS = 20;
  const DROP_Y = 50;
  const DANGER_Y = 100; // Tilsvarer GAME_OVER_HEIGHT (høyde/6) i referansen.
  const DANGER_HOLD_MS = 1000;
  const MERGE_EFFECT_MS = 1000;
  // Pitch stiger for hver mindre frukt, samme idé som DROP_PITCH_RATES i
  // referansen (minste frukt = høyest tone).
  const PITCH_RATES = [1.9, 1.7, 1.5, 1.34, 1.19, 1.06, 0.94, 0.84, 0.75, 0.67, 0.6];

  function start(container) {
    const Matter = window.Matter;
    if (!Matter) {
      container.innerHTML = '<p class="section-sub">Kunne ikke laste fysikkmotoren. Prøv å laste siden på nytt.</p>';
      return;
    }

    let session = null;
    let engine, world, render, runner;
    let canvas;
    let score = 0;
    let over = false;
    let nextFruitIndex = randomDropIndex();
    let currentDropX = WIDTH / 2;
    let canDrop = true;
    let bodySeq = 1;
    let mergeEffects = [];
    let particles = [];
    let autosaveTimer = null;
    let muted = readMuted();
    let audioCtx = null;

    window.StudillaGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <div class="fruit-merge-stage">
          <div class="fruit-merge-next">
            <span class="fruit-merge-next-label">Neste</span>
            <span class="fruit-merge-next-fruit" data-fruit-next></span>
            <button type="button" class="fruit-merge-mute" data-fruit-mute aria-label="Skru av/på lyd"></button>
          </div>
          <div class="fruit-merge-canvas-wrap" data-fruit-canvas-wrap></div>
        </div>
      `;
      session.onRestart(() => initGame());

      const muteBtn = session.playArea.querySelector("[data-fruit-mute]");
      updateMuteButton(muteBtn);
      muteBtn.addEventListener("click", () => {
        muted = !muted;
        writeMuted(muted);
        updateMuteButton(muteBtn);
      });

      // Fortsett en påbegynt runde hvis den ligger lagret, ellers ny runde.
      const saved = session.savedState();
      initGame(validSavedGame(saved) ? saved : null);
    });

    function readMuted() {
      try {
        return window.localStorage.getItem("studilla_sound_muted") === "1";
      } catch (e) {
        return false;
      }
    }
    function writeMuted(v) {
      try {
        window.localStorage.setItem("studilla_sound_muted", v ? "1" : "0");
      } catch (e) {
        // ignorer – lyd-preferansen er ikke kritisk.
      }
    }
    function updateMuteButton(btn) {
      if (!btn) return;
      btn.textContent = muted ? "🔇" : "🔊";
      btn.classList.toggle("is-muted", muted);
    }

    // Enkel, selvlaget lydmotor via Web Audio API (ingen eksterne lydfiler):
    // et kort "pop" ved fusjon og et mykt "bump" ved kollisjon, med tonehøyde
    // og volum styrt av hvilken frukt / hvor hardt det smeller – samme idé
    // som AudioManager i referansen, bare syntetisert i stedet for avspilte
    // wav-filer.
    function ensureAudio() {
      if (audioCtx || muted) return audioCtx;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        audioCtx = null;
      }
      return audioCtx;
    }

    function playPop(fruitIndex) {
      if (muted) return;
      const ctx = ensureAudio();
      if (!ctx) return;
      const rate = PITCH_RATES[fruitIndex] || 1;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520 * rate, now);
      osc.frequency.exponentialRampToValueAtTime(720 * rate, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    }

    function playBump(volume, fruitIndex) {
      if (muted) return;
      const ctx = ensureAudio();
      if (!ctx) return;
      const rate = PITCH_RATES[fruitIndex] || 1;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(140 * rate, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.02, volume * 0.25), now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    }

    // Stillingen som lagres mellom økter: hver frukt i krukken med posisjon,
    // vinkel og fart, pluss skåren og hvilken frukt som er neste ut. Fysikken
    // settes opp på nytt fra disse tallene, så krukken ser lik ut når man
    // kommer tilbake.
    function snapshotFruits() {
      return Matter.Composite.allBodies(world)
        .filter((b) => b.fruitIndex !== undefined)
        .map((b) => ({
          i: b.fruitIndex,
          x: Math.round(b.position.x * 100) / 100,
          y: Math.round(b.position.y * 100) / 100,
          a: Math.round(b.angle * 1000) / 1000,
          vx: Math.round(b.velocity.x * 1000) / 1000,
          vy: Math.round(b.velocity.y * 1000) / 1000,
          av: Math.round(b.angularVelocity * 1000) / 1000,
        }));
    }

    function saveGame() {
      if (!session || over || !world) return;
      session.saveState({ fruits: snapshotFruits(), score, nextFruitIndex });
    }

    function validSavedGame(saved) {
      return saved
        && Array.isArray(saved.fruits)
        && saved.fruits.length > 0
        && saved.fruits.every((f) => f && FRUITS[f.i] && Number.isFinite(f.x) && Number.isFinite(f.y));
    }

    function restoreFruits(saved) {
      saved.fruits.forEach((f) => {
        const body = makeFruit(f.i, f.x, f.y);
        Matter.Body.setAngle(body, Number.isFinite(f.a) ? f.a : 0);
        Matter.Body.setVelocity(body, { x: Number.isFinite(f.vx) ? f.vx : 0, y: Number.isFinite(f.vy) ? f.vy : 0 });
        Matter.Body.setAngularVelocity(body, Number.isFinite(f.av) ? f.av : 0);
        Matter.World.add(world, body);
      });
      score = Number(saved.score) || 0;
      if (FRUITS[saved.nextFruitIndex] && saved.nextFruitIndex <= DROPPABLE_MAX_INDEX) {
        nextFruitIndex = saved.nextFruitIndex;
      }
      updateNextLabel();
      session.setScore(score);
    }

    function randomDropIndex() {
      return Math.floor(Math.random() * (DROPPABLE_MAX_INDEX + 1));
    }

    function initGame(saved) {
      if (render) {
        Matter.Render.stop(render);
        render.canvas.remove();
      }
      if (runner) Matter.Runner.stop(runner);

      score = 0;
      over = false;
      mergeEffects = [];
      particles = [];
      nextFruitIndex = randomDropIndex();
      currentDropX = WIDTH / 2;
      canDrop = true;

      engine = Matter.Engine.create();
      world = engine.world;
      // Justert for å gi samme "vekt"-følelse som Rapier-fysikken i
      // referansen (lav tyngdekraft + litt luftmotstand på fruktene).
      world.gravity.y = 1.15;

      const wrap = session.playArea.querySelector("[data-fruit-canvas-wrap]");
      wrap.innerHTML = "";

      render = Matter.Render.create({
        element: wrap,
        engine,
        options: {
          width: WIDTH,
          height: HEIGHT,
          wireframes: false,
          background: "#fff6e5",
        },
      });
      canvas = render.canvas;
      canvas.classList.add("fruit-merge-canvas");

      const wallOptions = { isStatic: true, render: { fillStyle: "#c98a4b" } };
      Matter.World.add(world, [
        Matter.Bodies.rectangle(WIDTH / 2, HEIGHT + WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, wallOptions),
        Matter.Bodies.rectangle(-WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, wallOptions),
        Matter.Bodies.rectangle(WIDTH + WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, wallOptions),
      ]);

      Matter.Render.run(render);
      runner = Matter.Runner.create();
      Matter.Runner.run(runner, engine);

      Matter.Events.on(engine, "collisionStart", handleCollisions);
      Matter.Events.on(engine, "afterUpdate", checkDanger);
      Matter.Events.on(render, "afterRender", drawOverlay);

      attachControls();
      updateNextLabel();
      session.setScore(0);
      session.hideOverlay();

      if (saved) {
        restoreFruits(saved);
      } else {
        session.clearState();
      }

      // Fysikken beveger seg hele tiden, så stillingen lagres jevnlig (i
      // tillegg til ved hvert slipp og hver fusjon) i stedet for bare ved
      // trekk slik de rutenettbaserte spillene gjør.
      if (autosaveTimer) clearInterval(autosaveTimer);
      autosaveTimer = setInterval(saveGame, 2000);
    }

    function makeFruit(index, x, y) {
      const spec = FRUITS[index];
      const body = Matter.Bodies.circle(x, y, spec.radius, {
        restitution: 0.25,
        friction: 0.35,
        frictionStatic: 0.4,
        frictionAir: 0.012,
        render: { fillStyle: spec.color },
      });
      body.fruitIndex = index;
      body.fruitSeq = bodySeq++;
      body.dangerSince = null;
      return body;
    }

    function dropFruit() {
      if (!canDrop || over) return;
      ensureAudio();
      const spec = FRUITS[nextFruitIndex];
      const x = Math.max(spec.radius + WALL_THICKNESS / 2, Math.min(WIDTH - spec.radius - WALL_THICKNESS / 2, currentDropX));
      const body = makeFruit(nextFruitIndex, x, DROP_Y);
      Matter.World.add(world, body);
      canDrop = false;
      setTimeout(() => {
        canDrop = true;
      }, 420);
      nextFruitIndex = randomDropIndex();
      updateNextLabel();
      saveGame();
      spawnParticles(x, DROP_Y, spec.color, 6);
    }

    // Liten partikkelsprut brukt både ved slipp og fusjon – ren pynt, ingen
    // poeng er knyttet til dette.
    function spawnParticles(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          life: 0.9,
          decay: 0.03 + Math.random() * 0.04,
          radius: 2 + Math.random() * 4,
          color,
        });
      }
    }

    function handleCollisions(event) {
      const merged = new Set();
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        if (bodyA.fruitIndex === undefined || bodyB.fruitIndex === undefined) {
          // Slag mot veggen – et mykt dunk, samme idé som "bump"-lyden i
          // referansen (volum styrt av hvor hardt det traff).
          const fruitBody = bodyA.fruitIndex !== undefined ? bodyA : (bodyB.fruitIndex !== undefined ? bodyB : null);
          if (fruitBody) {
            const speed = Math.hypot(fruitBody.velocity.x, fruitBody.velocity.y);
            if (speed > 1.5) playBump(Math.min(1, speed / 12), fruitBody.fruitIndex);
          }
          continue;
        }
        if (merged.has(bodyA.id) || merged.has(bodyB.id)) continue;
        if (bodyA.fruitIndex !== bodyB.fruitIndex) {
          const relSpeed = Math.hypot(bodyA.velocity.x - bodyB.velocity.x, bodyA.velocity.y - bodyB.velocity.y);
          if (relSpeed > 1.5) {
            const dominant = bodyA.fruitIndex >= bodyB.fruitIndex ? bodyA : bodyB;
            playBump(Math.min(1, relSpeed / 12), dominant.fruitIndex);
          }
          continue;
        }

        merged.add(bodyA.id);
        merged.add(bodyB.id);

        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;
        const isWatermelonMerge = bodyA.fruitIndex >= FRUITS.length - 1;
        const nextIndex = bodyA.fruitIndex + 1;

        Matter.World.remove(world, bodyA);
        Matter.World.remove(world, bodyB);

        let effectColor;
        let effectRadius;
        if (isWatermelonMerge) {
          // To vannmeloner smelter sammen til en flat bonus – ingen frukt
          // igjen, akkurat som i referansen.
          effectColor = FRUITS[FRUITS.length - 1].color;
          effectRadius = FRUITS[FRUITS.length - 1].radius;
          score += WATERMELON_MERGE_BONUS;
        } else {
          const grown = makeFruit(nextIndex, midX, midY);
          Matter.World.add(world, grown);
          effectColor = FRUITS[nextIndex].color;
          effectRadius = FRUITS[nextIndex].radius;
          score += FRUITS[nextIndex].points;
        }

        session.setScore(score);
        mergeEffects.push({ x: midX, y: midY, color: effectColor, radius: effectRadius, start: performance.now() });
        spawnParticles(midX, midY, effectColor, 14);
        playPop(isWatermelonMerge ? FRUITS.length - 1 : nextIndex);
      }
    }

    // Portert fra referansens Fruit.isOutOfBounds(): sjekker hver frukt for
    // seg, uavhengig av fart – toppen av frukten må ligge over faregrensen i
    // mer enn DANGER_HOLD_MS sammenhengende for at runden skal ende. Dette
    // fanger opp en høy, stillestående haug uten å avslutte for tidlig når
    // en frukt bare passerer linjen på vei ned.
    function checkDanger() {
      if (over) return;
      const bodies = Matter.Composite.allBodies(world).filter((b) => b.fruitIndex !== undefined);
      const now = Date.now();
      for (const b of bodies) {
        const topY = b.position.y - FRUITS[b.fruitIndex].radius;
        if (topY < DANGER_Y) {
          if (b.dangerSince == null) b.dangerSince = now;
          else if (now - b.dangerSince > DANGER_HOLD_MS) {
            endGame();
            return;
          }
        } else {
          b.dangerSince = null;
        }
      }
    }

    function endGame() {
      if (over) return;
      over = true;
      canDrop = false;
      if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
      Matter.Runner.stop(runner);
      session.finish(score, { title: "Krukken rant over!" });
    }

    // Tegner fruktens emoji oppå Matter sin egen sirkel-rendering, slik at
    // fruktene ser ut som ekte frukt i stedet for bare fargede sirkler.
    function drawFruitEmoji(ctx) {
      const bodies = Matter.Composite.allBodies(world).filter((b) => b.fruitIndex !== undefined);
      for (const b of bodies) {
        const spec = FRUITS[b.fruitIndex];
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        ctx.font = `${spec.radius * 1.15}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(spec.emoji, 0, 1);
        ctx.restore();

        // Fare-ring rundt en frukt som holder på å utløse game over –
        // samme idé som den rosa ringen i referansen.
        if (b.dangerSince != null) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(b.position.x, b.position.y, spec.radius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(230,57,80,0.75)";
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    function drawParticles(ctx) {
      for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * Math.max(0, p.life), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.restore();
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.life -= p.decay;
      }
      particles = particles.filter((p) => p.life > 0);
    }

    // Fusjonsringen bruker samme kvintiske ease-out-kurve som
    // MergeEffectData/renderCanvas i referansen (t = 1 - (1-progress)^5),
    // slik at ringen sprer seg raskt først og deretter roer seg av.
    function drawMergeEffects(ctx) {
      const now = performance.now();
      mergeEffects = mergeEffects.filter((e) => now - e.start < MERGE_EFFECT_MS);
      for (const e of mergeEffects) {
        const progress = (now - e.start) / MERGE_EFFECT_MS;
        const t = 1 - Math.pow(1 - progress, 5);
        const radius = e.radius * (1 + t * 4);
        const opacity = 1 - t;
        ctx.save();
        ctx.beginPath();
        ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = opacity * 0.6;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    }

    function drawOverlay() {
      const ctx = render.context;
      ctx.save();
      drawFruitEmoji(ctx);
      drawParticles(ctx);
      drawMergeEffects(ctx);

      // Fareindikator: en stiplet linje som viser "over kanten"-grensen.
      const anyDanger = Matter.Composite.allBodies(world).some((b) => b.dangerSince != null);
      ctx.strokeStyle = anyDanger ? "rgba(230,57,80,0.55)" : "rgba(0,0,0,0.15)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(WALL_THICKNESS, DANGER_Y);
      ctx.lineTo(WIDTH - WALL_THICKNESS, DANGER_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (canDrop && !over) {
        const spec = FRUITS[nextFruitIndex];
        const x = Math.max(spec.radius + WALL_THICKNESS / 2, Math.min(WIDTH - spec.radius - WALL_THICKNESS / 2, currentDropX));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = spec.color;
        ctx.beginPath();
        ctx.arc(x, DROP_Y, spec.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${spec.radius * 1.15}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(spec.emoji, x, DROP_Y + 1);
        ctx.globalAlpha = 1;

        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, DROP_Y + spec.radius);
        ctx.lineTo(x, HEIGHT);
        ctx.stroke();
      }

      ctx.restore();
    }

    function updateNextLabel() {
      const el = session.playArea.querySelector("[data-fruit-next]");
      if (!el) return;
      const spec = FRUITS[nextFruitIndex];
      el.innerHTML = `<span class="fruit-merge-next-emoji">${spec.emoji}</span> ${spec.name}`;
      el.style.color = spec.color;
    }

    function pointerX(clientX) {
      const rect = canvas.getBoundingClientRect();
      const scale = WIDTH / rect.width;
      return (clientX - rect.left) * scale;
    }

    function attachControls() {
      canvas.addEventListener("mousemove", (e) => {
        currentDropX = pointerX(e.clientX);
      });
      canvas.addEventListener("click", () => dropFruit());

      canvas.addEventListener(
        "touchmove",
        (e) => {
          const t = e.touches[0];
          if (t) currentDropX = pointerX(t.clientX);
          e.preventDefault();
        },
        { passive: false }
      );
      canvas.addEventListener("touchend", (e) => {
        dropFruit();
        e.preventDefault();
      });
    }
  }

  window.STUDILLA_GAME_MODULES = window.STUDILLA_GAME_MODULES || {};
  window.STUDILLA_GAME_MODULES[GAME_ID] = { start };
})();
