/* app.js — Ball Drop Raffle (fixed labels + clearer scoreboard + twitch kicker bars)
   Requires Matter.js loaded as matter.min.js
*/

(() => {
  const {
    Engine,
    Render,
    Runner,
    World,
    Bodies,
    Body,
    Composite,
    Events,
    Vector
  } = Matter;

  // ---------- DOM ----------
  const canvas = document.getElementById("world");
  const elMsg = document.getElementById("msg");
  const elLive = document.getElementById("liveTop");
  const elFinish = document.getElementById("finishOrder");
  const elBuild = document.getElementById("btnBuild");
  const elStart = document.getElementById("btnStart");
  const elReset = document.getElementById("btnReset");
  const elShake = document.getElementById("btnShake");
  const elFollow = document.getElementById("chkFollow");
  const elStagger = document.getElementById("chkStagger");

  // ---------- CONFIG ----------
  const CFG = {
    width: 1600,
    height: 2400,
    gravity: 1.15,

    ballRadius: 16,
    ballRestitution: 0.25,
    ballFriction: 0.08,
    ballFrictionAir: 0.002,

    pegRadius: 7,
    pegSpacingX: 90,
    pegSpacingY: 85,
    pegMargin: 120,

    wallThickness: 80,
    wallTiltDeg: 28,

    rampThickness: 18,

    finishY: 2200,
    finishSensorHeight: 35,

    cameraPadding: 320,
    cameraLerp: 0.12,

    liveTopN: 10,
    finishTopN: 10,

    // twitch bars (kickers)
    kickerCountPerSide: 3,
    kickerWidth: 160,
    kickerHeight: 16,
    kickerAmplitude: 70,
    kickerSpeedMin: 0.012,
    kickerSpeedMax: 0.022,

    labelFont: "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial",
    labelColor: "rgba(255,255,255,0.92)",
    labelStroke: "rgba(0,0,0,0.45)",
    labelStrokeW: 4
  };

  // ---------- STATE ----------
  let engine, runner, render;
  let balls = [];
  let finishOrder = [];
  let started = false;
  let built = false;
  let followLeader = true;
  let staggerRelease = true;

  let finishSensor = null;
  let kickers = [];

  // Example players: you likely populate this from your list UI
  // Each item: { id:number, name:string }
  let players = [];

  // ---------- UTIL ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function setMsg(s) {
    if (elMsg) elMsg.textContent = s || "";
  }

  function clearUI() {
    if (elLive) elLive.innerHTML = "";
    if (elFinish) elFinish.innerHTML = "";
  }

  function ensurePlayersFallback_() {
    // If your UI populates players elsewhere, remove this fallback.
    if (players.length) return;
    // fallback: 1..50
    for (let i = 1; i <= 50; i++) players.push({ id: i, name: `Player ${i}` });
  }

  function playerById_(id) {
    return players.find(p => p.id === id) || { id, name: "" };
  }

  // ---------- INIT ----------
  function initEngine_() {
    engine = Engine.create();
    engine.gravity.y = CFG.gravity;

    runner = Runner.create();

    render = Render.create({
      canvas,
      engine,
      options: {
        width: canvas.clientWidth || 1000,
        height: canvas.clientHeight || 800,
        wireframes: false,
        background: "rgba(0,0,0,0)",
        hasBounds: true,
        pixelRatio: window.devicePixelRatio || 1
      }
    });

    // Keep canvas sized to container
    resizeCanvas_();
    window.addEventListener("resize", resizeCanvas_);

    // Draw labels AFTER Matter renders bodies so labels stay glued to balls in WORLD coords
    Events.on(render, "afterRender", () => {
      drawBallLabels_();
    });

    // Update scoreboard + camera + kickers
    Events.on(engine, "beforeUpdate", (evt) => {
      if (!built) return;
      updateKickers_(evt.timestamp || performance.now());
      updateScoreboard_();
      if (followLeader) updateCamera_();
    });

    // Finish sensor
    Events.on(engine, "collisionStart", (e) => {
      if (!started || !finishSensor) return;
      for (const pair of e.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        if (a === finishSensor && b.label === "ball") recordFinish_(b);
        if (b === finishSensor && a.label === "ball") recordFinish_(a);
      }
    });
  }

  function resizeCanvas_() {
    if (!render) return;
    const rect = canvas.getBoundingClientRect();
    Render.setSize(render, Math.max(300, Math.floor(rect.width)), Math.max(300, Math.floor(rect.height)));
  }

  // ---------- COURSE BUILD ----------
  function resetAll_() {
    started = false;
    built = false;
    balls = [];
    finishOrder = [];
    kickers = [];
    finishSensor = null;
    clearUI();
    setMsg("");

    if (render) {
      Render.stop(render);
      render.canvas.getContext("2d").setTransform(1, 0, 0, 1, 0, 0);
      render.canvas.getContext("2d").clearRect(0, 0, render.canvas.width, render.canvas.height);
    }
    if (runner) Runner.stop(runner);

    engine = null;
    runner = null;
    render = null;

    initEngine_();
  }

  function buildCourse_() {
    ensurePlayersFallback_();

    // wipe world
    World.clear(engine.world, false);
    Engine.clear(engine);
    balls = [];
    finishOrder = [];
    kickers = [];
    finishSensor = null;
    clearUI();

    const w = CFG.width;
    const h = CFG.height;

    // Outer walls (tilted) + floor
    const thick = CFG.wallThickness;
    const tilt = (CFG.wallTiltDeg * Math.PI) / 180;

    const leftWall = Bodies.rectangle(-thick / 2, h / 2, thick, h * 2, {
      isStatic: true,
      render: { fillStyle: "rgba(40,55,90,0.35)" }
    });
    Body.setAngle(leftWall, tilt);

    const rightWall = Bodies.rectangle(w + thick / 2, h / 2, thick, h * 2, {
      isStatic: true,
      render: { fillStyle: "rgba(40,55,90,0.35)" }
    });
    Body.setAngle(rightWall, -tilt);

    const floor = Bodies.rectangle(w / 2, h + 120, w + 1200, 240, {
      isStatic: true,
      render: { fillStyle: "rgba(30,30,30,0.85)" }
    });

    // Pegs
    const pegs = [];
    const startX = CFG.pegMargin;
    const endX = w - CFG.pegMargin;
    const startY = 140;
    const endY = h - 350;

    let row = 0;
    for (let y = startY; y <= endY; y += CFG.pegSpacingY) {
      const offset = (row % 2) * (CFG.pegSpacingX / 2);
      for (let x = startX + offset; x <= endX; x += CFG.pegSpacingX) {
        pegs.push(
          Bodies.circle(x, y, CFG.pegRadius, {
            isStatic: true,
            render: { fillStyle: "rgba(160,170,190,0.18)" }
          })
        );
      }
      row++;
    }

    // A few diagonal ramps (static)
    const ramps = [
      { x: w * 0.25, y: h * 0.28, len: 320, ang: 0.9 },
      { x: w * 0.72, y: h * 0.18, len: 380, ang: -0.95 },
      { x: w * 0.62, y: h * 0.46, len: 300, ang: 0.55 },
      { x: w * 0.40, y: h * 0.62, len: 260, ang: -0.65 },
      { x: w * 0.78, y: h * 0.74, len: 420, ang: -0.85 }
    ].map(r =>
      Bodies.rectangle(r.x, r.y, r.len, CFG.rampThickness, {
        isStatic: true,
        angle: r.ang,
        render: { fillStyle: "rgba(65,90,145,0.35)" }
      })
    );

    // Finish sensor (invisible)
    finishSensor = Bodies.rectangle(w / 2, CFG.finishY, w * 0.78, CFG.finishSensorHeight, {
      isStatic: true,
      isSensor: true,
      render: { visible: false },
      label: "finishSensor"
    });

    // Twitch kickers (kinematic-ish: isStatic true but we move them each tick)
    buildKickers_();

    World.add(engine.world, [leftWall, rightWall, floor, finishSensor, ...pegs, ...ramps, ...kickers.map(k => k.body)]);

    built = true;
    setMsg("Course built. Ready.");
    updateScoreboard_();
    resetCamera_();
    Render.run(render);
  }

  function buildKickers_() {
    const w = CFG.width;
    const leftX = w * 0.18;
    const rightX = w * 0.82;

    const ys = [
      CFG.height * 0.28,
      CFG.height * 0.48,
      CFG.height * 0.68
    ];

    const makeKicker = (x, y, phase) => {
      const body = Bodies.rectangle(x, y, CFG.kickerWidth, CFG.kickerHeight, {
        isStatic: true,
        friction: 0,
        frictionStatic: 0,
        restitution: 0.9,
        render: { fillStyle: "rgba(90,140,255,0.30)" }
      });

      // slight angle helps “flick” sideways too
      Body.setAngle(body, (Math.random() * 0.5 - 0.25));

      return {
        body,
        base: { x, y },
        phase,
        speed: CFG.kickerSpeedMin + Math.random() * (CFG.kickerSpeedMax - CFG.kickerSpeedMin),
        amp: CFG.kickerAmplitude * (0.7 + Math.random() * 0.6)
      };
    };

    kickers = [];
    for (let i = 0; i < CFG.kickerCountPerSide; i++) {
      kickers.push(makeKicker(leftX, ys[i % ys.length], Math.random() * Math.PI * 2));
      kickers.push(makeKicker(rightX, ys[i % ys.length], Math.random() * Math.PI * 2));
    }
  }

  function updateKickers_(t) {
    if (!kickers.length) return;
    // oscillate vertically (twitch), with a little randomness
    const time = t * 0.001;
    for (const k of kickers) {
      const dy = Math.sin(time / k.speed + k.phase) * k.amp;
      const ny = k.base.y + dy;

      // move static body by setting position
      Body.setPosition(k.body, { x: k.base.x, y: ny });

      // micro “twitch” angle
      const a = k.body.angle;
      const targetA = Math.sin(time / (k.speed * 1.7) + k.phase) * 0.35;
      Body.setAngle(k.body, a + (targetA - a) * 0.08);
    }
  }

  // ---------- BALLS ----------
  function spawnBalls_() {
    balls = [];
    finishOrder = [];
    clearUI();

    const w = CFG.width;

    // spawn near top center with slight spread
    const spawnY = 60;
    const spread = 220;

    // Use your players[] list
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const x = w / 2 + (Math.random() * 2 - 1) * spread;
      const y = spawnY - i * 1.5; // tiny stagger vertically
      const ball = Bodies.circle(x, y, CFG.ballRadius, {
        label: "ball",
        restitution: CFG.ballRestitution,
        friction: CFG.ballFriction,
        frictionAir: CFG.ballFrictionAir,
        render: {
          fillStyle: randomBallColor_(p.id),
          strokeStyle: "rgba(255,255,255,0.15)",
          lineWidth: 1
        }
      });
      ball.__pid = p.id; // store player id on body
      ball.__born = performance.now();
      balls.push(ball);
    }

    World.add(engine.world, balls);
  }

  function randomBallColor_(seed) {
    // deterministic-ish color from id
    const r = (seed * 73) % 255;
    const g = (seed * 151) % 255;
    const b = (seed * 211) % 255;
    return `rgb(${clamp(r, 40, 230)},${clamp(g, 40, 230)},${clamp(b, 40, 230)})`;
  }

  function startRace_() {
    if (!built) return;
    started = true;
    setMsg(`Drop started. First ${CFG.finishTopN} finishers recorded!`);

    // release balls
    spawnBalls_();

    if (staggerRelease) {
      // Freeze them initially then release one by one
      for (const b of balls) Body.setStatic(b, true);
      let idx = 0;
      const timer = setInterval(() => {
        if (!started || idx >= balls.length) {
          clearInterval(timer);
          return;
        }
        Body.setStatic(balls[idx], false);
        idx++;
      }, 60);
    }

    Runner.run(runner, engine);
  }

  function recordFinish_(ball) {
    if (ball.__finished) return;
    ball.__finished = true;

    const pid = ball.__pid;
    finishOrder.push(pid);

    // stop tracking more than finishTopN if you want
    if (finishOrder.length >= CFG.finishTopN) {
      // You can stop the engine here if you want:
      // started = false;
      // Runner.stop(runner);
      setMsg(`Top ${CFG.finishTopN} decided!`);
    }
  }

  // ---------- SCOREBOARD ----------
  function updateScoreboard_() {
    if (!elLive || !elFinish) return;

    // LIVE: rank by "progress" (closest to finish line)
    // Use y distance to finish sensor (lower distance = better)
    const live = balls
      .filter(b => !b.__finished)
      .map(b => {
        const dist = Math.max(0, CFG.finishY - b.position.y);
        return { id: b.__pid, dist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, CFG.liveTopN);

    // FINISH: exact order recorded
    const fin = finishOrder.slice(0, CFG.finishTopN);

    // Render live list
    const liveHtml = [];
    liveHtml.push(`<div><b>Live Top ${CFG.liveTopN}</b> <span style="opacity:.7">(closest to finish)</span></div>`);
    if (live.length === 0) {
      liveHtml.push(`<div style="opacity:.7">Waiting for balls...</div>`);
    } else {
      for (let i = 0; i < live.length; i++) {
        const p = playerById_(live[i].id);
        liveHtml.push(
          `<div>${i + 1}. <b>#${p.id}</b> ${escapeHtml_(p.name)} <span style="opacity:.6">(d=${Math.round(live[i].dist)})</span></div>`
        );
      }
    }
    elLive.innerHTML = liveHtml.join("");

    // Render finish list
    const finHtml = [];
    finHtml.push(`<div style="margin-top:10px"><b>Finish Order</b></div>`);
    if (fin.length === 0) {
      finHtml.push(`<div style="opacity:.7">No finishers yet.</div>`);
    } else {
      for (let i = 0; i < fin.length; i++) {
        const p = playerById_(fin[i]);
        finHtml.push(`<div>${i + 1}. <b>#${p.id}</b> ${escapeHtml_(p.name)}</div>`);
      }
    }
    elFinish.innerHTML = finHtml.join("");
  }

  function escapeHtml_(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- CAMERA ----------
  function resetCamera_() {
    if (!render) return;
    // default bounds show top portion
    render.bounds.min.x = 0;
    render.bounds.min.y = 0;
    render.bounds.max.x = CFG.width;
    render.bounds.max.y = 900;
  }

  function updateCamera_() {
    if (!balls.length) return;

    // Follow the leading ball (closest to finish) OR the lowest (largest y)
    let leader = null;
    let bestDist = Infinity;

    for (const b of balls) {
      if (b.__finished) continue;
      const d = Math.max(0, CFG.finishY - b.position.y);
      if (d < bestDist) {
        bestDist = d;
        leader = b;
      }
    }
    if (!leader) return;

    const pad = CFG.cameraPadding;
    const targetMinX = clamp(leader.position.x - pad, -200, CFG.width - 200);
    const targetMaxX = clamp(leader.position.x + pad, 200, CFG.width + 200);
    const targetMinY = clamp(leader.position.y - pad, -200, CFG.height - 200);
    const targetMaxY = clamp(leader.position.y + pad, 200, CFG.height + 200);

    // Lerp bounds
    const b = render.bounds;
    b.min.x += (targetMinX - b.min.x) * CFG.cameraLerp;
    b.max.x += (targetMaxX - b.max.x) * CFG.cameraLerp;
    b.min.y += (targetMinY - b.min.y) * CFG.cameraLerp;
    b.max.y += (targetMaxY - b.max.y) * CFG.cameraLerp;

    // keep aspect ratio stable
    const viewW = b.max.x - b.min.x;
    const viewH = b.max.y - b.min.y;
    const aspect = render.options.width / render.options.height;

    let newW = viewW;
    let newH = viewH;
    if (viewW / viewH > aspect) {
      newH = viewW / aspect;
    } else {
      newW = viewH * aspect;
    }

    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    b.min.x = cx - newW / 2;
    b.max.x = cx + newW / 2;
    b.min.y = cy - newH / 2;
    b.max.y = cy + newH / 2;
  }

  // ---------- LABEL DRAW (FIXES “DISINTEGRATION”) ----------
  function drawBallLabels_() {
    if (!render || !balls.length) return;
    const ctx = render.context;

    ctx.save();
    ctx.font = CFG.labelFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // IMPORTANT:
    // Matter.Render has already applied the correct transform for bounds/zoom on the context
    // in its own pipeline. Drawing here uses WORLD coordinates automatically.
    for (const b of balls) {
      const id = b.__pid;
      if (!id) continue;

      // Slightly above center looks nicer
      const x = b.position.x;
      const y = b.position.y;

      // stroke + fill for readability
      ctx.lineWidth = CFG.labelStrokeW;
      ctx.strokeStyle = CFG.labelStroke;
      ctx.fillStyle = CFG.labelColor;

      const txt = String(id);

      ctx.strokeText(txt, x, y);
      ctx.fillText(txt, x, y);
    }

    ctx.restore();
  }

  // ---------- SHAKE ----------
  function shake_() {
    if (!balls.length) return;
    for (const b of balls) {
      const fx = (Math.random() * 2 - 1) * 0.012;
      const fy = (Math.random() * 2 - 1) * 0.012;
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }
  }

  // ---------- UI WIREUP ----------
  function hookUI_() {
    if (elBuild) elBuild.addEventListener("click", () => {
      buildCourse_();
    });

    if (elStart) elStart.addEventListener("click", () => {
      if (!built) return;
      started = true;
      staggerRelease = !!(elStagger && elStagger.checked);
      followLeader = !!(elFollow && elFollow.checked);
      startRace_();
    });

    if (elReset) elReset.addEventListener("click", () => {
      resetAll_();
      setMsg("Reset done.");
    });

    if (elShake) elShake.addEventListener("click", () => {
      shake_();
    });

    if (elFollow) elFollow.addEventListener("change", () => {
      followLeader = !!elFollow.checked;
      if (!followLeader) resetCamera_();
    });

    if (elStagger) elStagger.addEventListener("change", () => {
      staggerRelease = !!elStagger.checked;
    });
  }

  // ---------- BOOT ----------
  function boot_() {
    resetAll_();
    hookUI_();
    setMsg("Ready. Click Build Course.");
  }

  boot_();
})();
