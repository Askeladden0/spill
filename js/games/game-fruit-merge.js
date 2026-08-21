/**
 * PixelPlay – Fruktfusjon.
 * Klassisk "fruit merge"-spill: slipp frukt ned i krukken, og når to like
 * frukter treffer hverandre slås de sammen til neste frukt i kjeden. Krukken
 * ser ut som i andre fruktfusjon-spill (rund frukt, tegneserieaktig look) –
 * det er kun poeng-HUDen rundt selve krukken som følger sidens stil, via den
 * delte spill-kjøretiden (js/game-runtime.js).
 */
(function () {
  "use strict";

  const GAME_ID = "fruktfusjon";

  const FRUITS = [
    { name: "Kirsebær", radius: 16, color: "#e63950" },
    { name: "Drue", radius: 22, color: "#7e57c2" },
    { name: "Aprikos", radius: 29, color: "#ff9f43" },
    { name: "Klementin", radius: 37, color: "#ff7f11" },
    { name: "Eple", radius: 46, color: "#ff4d4d" },
    { name: "Pære", radius: 55, color: "#c6e26b" },
    { name: "Fersken", radius: 65, color: "#ffb0a3" },
    { name: "Ananas", radius: 76, color: "#ffd93d" },
    { name: "Melon", radius: 88, color: "#8bd45c" },
    { name: "Vannmelon", radius: 102, color: "#2fae5e" },
  ];

  const DROPPABLE_MAX_INDEX = 4; // Kun de 5 minste fruktene faller ned i starten.
  const WIDTH = 380;
  const HEIGHT = 520;
  const WALL_THICKNESS = 16;
  const DROP_Y = 46;
  const DANGER_Y = 96;
  const DANGER_HOLD_MS = 1500;

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
    let dangerSince = null;
    let bodySeq = 1;
    let mergeEffects = [];

    window.PixelPlayGameRuntime.mount(container, GAME_ID).then((s) => {
      session = s;
      session.playArea.innerHTML = `
        <p class="fruit-merge-hint">Flytt musen (eller dra fingeren) for å sikte, og klikk/trykk for å slippe frukten. Like frukter som treffer hverandre blir til neste frukt!</p>
        <div class="fruit-merge-stage">
          <div class="fruit-merge-next">
            <span class="fruit-merge-next-label">Neste</span>
            <span class="fruit-merge-next-fruit" data-fruit-next></span>
          </div>
          <div class="fruit-merge-canvas-wrap" data-fruit-canvas-wrap></div>
        </div>
      `;
      session.onRestart(() => initGame());
      initGame();
    });

    function randomDropIndex() {
      return Math.floor(Math.random() * (DROPPABLE_MAX_INDEX + 1));
    }

    function initGame() {
      if (render) {
        Matter.Render.stop(render);
        render.canvas.remove();
      }
      if (runner) Matter.Runner.stop(runner);

      score = 0;
      over = false;
      dangerSince = null;
      mergeEffects = [];
      nextFruitIndex = randomDropIndex();
      currentDropX = WIDTH / 2;
      canDrop = true;

      engine = Matter.Engine.create();
      world = engine.world;
      world.gravity.y = 1.1;

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
    }

    function makeFruit(index, x, y) {
      const spec = FRUITS[index];
      const body = Matter.Bodies.circle(x, y, spec.radius, {
        restitution: 0.15,
        friction: 0.6,
        frictionStatic: 0.6,
        render: { fillStyle: spec.color },
      });
      body.fruitIndex = index;
      body.fruitSeq = bodySeq++;
      return body;
    }

    function dropFruit() {
      if (!canDrop || over) return;
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
    }

    function handleCollisions(event) {
      const merged = new Set();
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        if (merged.has(bodyA.id) || merged.has(bodyB.id)) continue;
        if (bodyA.fruitIndex === undefined || bodyB.fruitIndex === undefined) continue;
        if (bodyA.fruitIndex !== bodyB.fruitIndex) continue;
        if (bodyA.fruitIndex >= FRUITS.length - 1) continue;

        merged.add(bodyA.id);
        merged.add(bodyB.id);

        const nextIndex = bodyA.fruitIndex + 1;
        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;

        Matter.World.remove(world, bodyA);
        Matter.World.remove(world, bodyB);
        const grown = makeFruit(nextIndex, midX, midY);
        Matter.World.add(world, grown);

        score += (nextIndex + 1) * 4;
        session.setScore(score);
        mergeEffects.push({ x: midX, y: midY, color: FRUITS[nextIndex].color, start: performance.now() });
      }
    }

    function checkDanger() {
      if (over) return;
      const bodies = Matter.Composite.allBodies(world).filter((b) => b.fruitIndex !== undefined);
      const settled = bodies.some((b) => b.position.y - FRUITS[b.fruitIndex].radius < DANGER_Y && Math.abs(b.velocity.y) < 0.5);

      if (settled) {
        if (dangerSince === null) dangerSince = Date.now();
        else if (Date.now() - dangerSince > DANGER_HOLD_MS) {
          endGame();
        }
      } else {
        dangerSince = null;
      }
    }

    function endGame() {
      if (over) return;
      over = true;
      canDrop = false;
      Matter.Runner.stop(runner);
      session.finish(score, { title: "Krukken rant over!" });
    }

    function drawOverlay() {
      const ctx = render.context;
      ctx.save();

      const now = performance.now();
      const MERGE_EFFECT_MS = 380;
      mergeEffects = mergeEffects.filter((e) => now - e.start < MERGE_EFFECT_MS);
      for (const e of mergeEffects) {
        const t = (now - e.start) / MERGE_EFFECT_MS;
        ctx.globalAlpha = 1 - t;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 10 + t * 46, 0, Math.PI * 2);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 4 * (1 - t) + 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Fareindikator: en stiplet linje som viser "over kanten"-grensen.
      ctx.strokeStyle = dangerSince ? "rgba(230,57,80,0.55)" : "rgba(0,0,0,0.15)";
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
      el.textContent = spec.name;
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

  window.PIXELPLAY_GAME_MODULES = window.PIXELPLAY_GAME_MODULES || {};
  window.PIXELPLAY_GAME_MODULES[GAME_ID] = { start };
})();
