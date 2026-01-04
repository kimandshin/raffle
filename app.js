/* app.js — Ball Drop Raffle (FULL FIX)
   - No auto-start (gravity OFF until Start)
   - Numbers stay ON the balls (canvas draw, not DOM labels)
   - Clean scoreboard: 1st Name (#), 2nd Name (#), ...
   - Finish line is visible + sensor-based finishing
   - Build Course / Start / Reset / Shake all work

   Requires Matter.js loaded first (matter.min.js)
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

  // =========================
  // CONFIG
  // =========================
  const CFG = {
    // Balls
    BALL_COUNT: 50,
    BALL_RADIUS: 14,
    BALL_RESTITUTION: 0.45,
    BALL_FRICTION: 0.04,
    BALL_FRICTION_AIR: 0.012,
    BALL_DENSITY: 0.002,

    // World
    GRAVITY_Y: 1.05,
    WALL_THICKNESS: 80,

    // Course
    PEG_ROWS: 14,
    PEG_COLS: 14,
    PEG_RADIUS: 6,
    PEG_SPACING: 60,
    PEG_OFFSET_X: 160,
    PEG_OFFSET_Y: 130,

    // Finish
    FINISH_Y_PADDING: 160,
    FINISH_BAR_H: 22,
    FINISH_BAR_FILL: "rgba(255,255,255,0.08)",
    FINISH_BAR_STROKE: "rgba(255,255,255,0.14)",

    // Camera follow
    FOLLOW_LEADER_DEFAULT: true,
    CAMERA_LERP: 0.14,

    // UI
    FINAL_RESULTS_COUNT: 10, // what you show
    TOP5_COUNT: 5,

    // Flippers ("twitch bars")
    FLIPPER_COUNT_PER_SIDE: 3,
    FLIPPER_W: 110,
    FLIPPER_H: 16,
    FLIPPER_TWITCH_INTERVAL_MS_MIN: 450,
    FLIPPER_TWITCH_INTERVAL_MS_MAX: 1100,
    FLIPPER_KICK_ANGULAR_VEL: 0.55,
    FLIPPER_RETURN_ANGULAR_VEL: -0.40,
    FLIPPER_MAX_ANGLE: 0.90
  };

  // =========================
  // DOM HELPERS
  // =========================
  function qs(sel) { return document.querySelector(sel); }
  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(c));
    return n;
  }

  // =========================
  // ENSURE ROOT + UI
  // =========================
  let root = qs("#app");
  if (!root) {
    root = el("div", { id: "app", style: "position:fixed; inset:0; background:#0b0d10;" });
    document.body.appendChild(root);
  }

  let sidebar = qs("#sidebar");
  if (!sidebar) {
    sidebar = el("div", {
      id: "sidebar",
      style: [
        "position:absolute",
        "left:16px",
        "top:16px",
        "width:380px",
        "max-width:calc(100vw - 32px)",
        "background:rgba(18,22,28,0.82)",
        "border:1px solid rgba(255,255,255,0.08)",
        "backdrop-filter:blur(10px)",
        "border-radius:14px",
        "padding:14px",
        "color:#e9eef7",
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif",
        "font-size:13px",
        "line-height:1.35",
        "z-index:5"
      ].join(";")
    });
    root.appendChild(sidebar);
  }

  let stage = qs("#stage");
  if (!stage) {
    stage = el("div", { id: "stage", style: "position:absolute; inset:0;" });
    root.appendChild(stage);
  }

  sidebar.innerHTML = "";

  const title = el("div", { style: "font-weight:900; font-size:16px; margin-bottom:10px;", text: "Ball Drop Raffle" });

  const namesBox = el("textarea", {
    id: "namesBox",
    placeholder: "One participant per line\n1. Alice\n2. Bob\n3. Chris",
    style: [
      "width:100%",
      "height:120px",
      "resize:vertical",
      "background:rgba(255,255,255,0.06)",
      "border:1px solid rgba(255,255,255,0.14)",
      "color:#e9eef7",
      "border-radius:10px",
      "padding:10px",
      "outline:none",
      "font-weight:600"
    ].join(";")
  });

  const btnRow1 = el("div", { style: "display:flex; gap:8px; flex-wrap:wrap; margin:10px 0;" });
  const btnBuild = el("button", { type: "button" }); btnBuild.textContent = "Build Course";
  const btnStart = el("button", { type: "button" }); btnStart.textContent = "Start";
  const btnReset = el("button", { type: "button" }); btnReset.textContent = "Reset";
  const btnShake = el("button", { type: "button" }); btnShake.textContent = "Shake";

  [btnBuild, btnStart, btnReset, btnShake].forEach(b => {
    b.style.cssText = [
      "background:rgba(255,255,255,0.06)",
      "border:1px solid rgba(255,255,255,0.14)",
      "color:#e9eef7",
      "padding:7px 10px",
      "border-radius:10px",
      "cursor:pointer",
      "font-weight:800"
    ].join(";");
  });

  btnRow1.append(btnBuild, btnStart, btnReset, btnShake);

  const optRow = el("div", { style: "display:flex; gap:10px; align-items:center; margin-bottom:8px; flex-wrap:wrap;" });
  const chkFollow = el("input", { type: "checkbox", id: "followLeader" });
  chkFollow.checked = CFG.FOLLOW_LEADER_DEFAULT;
  const lblFollow = el("label", { for: "followLeader", style: "cursor:pointer; user-select:none; font-weight:700;" });
  lblFollow.textContent = "Follow leader";
  optRow.append(chkFollow, lblFollow);

  const status = el("div", { style: "opacity:0.95; margin:8px 0 10px 0; font-weight:700;" });
  status.textContent = "Paste names → Build Course → Start";

  const hr = el("div", { style: "height:1px; background:rgba(255,255,255,0.10); margin:10px 0;" });

  const scoreTitle = el("div", { style: "font-weight:900; margin-bottom:6px;", text: "Scoreboard" });

  const top5Title = el("div", { style: "font-weight:800; margin:8px 0 4px;", text: "Top 5 (Finish Order)" });
  const top5List = el("ol", { style: "margin:0 0 10px 18px; padding:0;" });

  const finalTitle = el("div", { style: "font-weight:800; margin:8px 0 4px;", text: "Winners (Finish Order)" });
  const finalList = el("ol", { style: "margin:0 0 0 18px; padding:0;" });

  sidebar.append(title, namesBox, btnRow1, optRow, status, hr, scoreTitle, top5Title, top5List, finalTitle, finalList);

  // =========================
  // STATE
  // =========================
  let engine, world, render, runner;
  let balls = [];
  let pegs = [];
  let flippers = [];
  let finishSensor = null;

  let worldW = 0;
  let worldH = 0;
  let floorY = 0;
  let finishY = 0;

  let built = false;
  let started = false;

  let finishedIds = new Set();
  let finishOrder = []; // {id, num, name, ms}

  // Kill any old DOM labels from previous versions if they exist
  function cleanupLegacyLabels_() {
    const olds = document.querySelectorAll(".ball-label, .ballLabel, [data-ball-label]");
    olds.forEach(n => n.remove());
  }

  // =========================
  // PARSE NAMES
  // =========================
  function parseNames_() {
    const raw = (namesBox.value || "").trim();
    if (!raw) return [];
    const lines = raw.split("\n").map(s => s.trim()).filter(Boolean);
    return lines.map((line, idx) => {
      // allow "1. Name" or "Name"
      const m = line.match(/^\s*\d+\s*[\.\)]\s*(.+)$/);
      return (m ? m[1].trim() : line) || `Player ${idx + 1}`;
    });
  }

  // =========================
  // DESTROY WORLD
  // =========================
  function destroyWorld() {
    cleanupLegacyLabels_();

    if (render) {
      Render.stop(render);
      try { render.canvas.remove(); } catch (_) {}
      render.textures = {};
    }
    if (runner) Runner.stop(runner);

    engine = null;
    world = null;
    render = null;
    runner = null;

    balls = [];
    pegs = [];
    flippers = [];
    finishSensor = null;

    built = false;
    started = false;

    finishedIds = new Set();
    finishOrder = [];

    top5List.innerHTML = "";
    finalList.innerHTML = "";
  }

  // =========================
  // BUILD WORLD (NO AUTO START)
  // =========================
  function buildWorld() {
    destroyWorld();

    const names = parseNames_();
    if (names.length === 0) {
      status.textContent = "Paste at least 1 name first.";
      return;
    }

    engine = Engine.create();
    world = engine.world;

    // IMPORTANT: gravity OFF until Start
    world.gravity.y = 0;

    const w = window.innerWidth;
    const h = window.innerHeight;

    worldW = Math.max(1200, w);
    worldH = Math.max(2600, Math.floor(h * 2.2));

    floorY = worldH - 120;
    finishY = floorY - CFG.FINISH_Y_PADDING;

    // Walls
    const wallL = Bodies.rectangle(-CFG.WALL_THICKNESS / 2, worldH / 2, CFG.WALL_THICKNESS, worldH * 2, { isStatic: true });
    const wallR = Bodies.rectangle(worldW + CFG.WALL_THICKNESS / 2, worldH / 2, CFG.WALL_THICKNESS, worldH * 2, { isStatic: true });
    const floor = Bodies.rectangle(worldW / 2, floorY + CFG.WALL_THICKNESS / 2, worldW * 2, CFG.WALL_THICKNESS, { isStatic: true });

    World.add(world, [wallL, wallR, floor]);

    // Finish sensor (thin, full width)
    finishSensor = Bodies.rectangle(worldW / 2, finishY, worldW * 2, CFG.FINISH_BAR_H, {
      isStatic: true,
      isSensor: true,
      render: { visible: false }
    });
    World.add(world, finishSensor);

    // Peg grid
    pegs = [];
    const startX = CFG.PEG_OFFSET_X;
    const startY = CFG.PEG_OFFSET_Y;
    for (let r = 0; r < CFG.PEG_ROWS; r++) {
      for (let c = 0; c < CFG.PEG_COLS; c++) {
        const x = startX + c * CFG.PEG_SPACING + (r % 2 ? CFG.PEG_SPACING / 2 : 0);
        const y = startY + r * CFG.PEG_SPACING;
        const peg = Bodies.circle(x, y, CFG.PEG_RADIUS, {
          isStatic: true,
          render: { fillStyle: "rgba(140,160,190,0.22)" }
        });
        pegs.push(peg);
      }
    }
    World.add(world, pegs);

    // Diagonal bars (your existing style)
    const bars = [];
    function addBar(x, y, length, angle) {
      bars.push(Bodies.rectangle(x, y, length, 14, {
        isStatic: true,
        angle,
        render: { fillStyle: "rgba(80,100,140,0.28)" }
      }));
    }
    addBar(220, 520, 520, 0.85);
    addBar(980, 380, 420, -0.85);
    addBar(820, 980, 380, 0.65);
    addBar(360, 1220, 520, -0.75);
    addBar(980, 1520, 520, 0.70);
    addBar(280, 1780, 520, -0.70);
    addBar(980, 2080, 520, 0.70);
    World.add(world, bars);

    // Twitch flippers
    flippers = buildTwitchFlippers_(worldW, worldH);
    World.add(world, flippers.map(f => f.body));

    // Balls (created but "held" until Start)
    balls = [];
    const count = Math.min(CFG.BALL_COUNT, names.length);
    for (let i = 0; i < count; i++) {
      const x = worldW / 2 + (Math.random() * 220 - 110);
      const y = 60 + i * 26; // staged stack
      const b = Bodies.circle(x, y, CFG.BALL_RADIUS, {
        restitution: CFG.BALL_RESTITUTION,
        friction: CFG.BALL_FRICTION,
        frictionAir: CFG.BALL_FRICTION_AIR,
        density: CFG.BALL_DENSITY,
        // start "frozen"
        isSleeping: true,
        render: { fillStyle: pickColor_(i) }
      });

      b.plugin = b.plugin || {};
      b.plugin.raffle = { num: i + 1, name: names[i] };

      balls.push(b);
    }
    World.add(world, balls);

    // Render
    render = Render.create({
      element: stage,
      engine,
      options: {
        width: w,
        height: h,
        wireframes: false,
        background: "#0b0d10",
        hasBounds: true,
        pixelRatio: window.devicePixelRatio || 1
      }
    });

    Render.run(render);

    runner = Runner.create();
    Runner.run(runner, engine);

    // Finish detection via collision with sensor
    Events.on(engine, "collisionStart", (evt) => {
      if (!started) return;
      for (const pair of evt.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        const ball = (a === finishSensor) ? b : (b === finishSensor ? a : null);
        if (!ball) continue;
        if (!ball.plugin || !ball.plugin.raffle) continue;
        if (finishedIds.has(ball.id)) continue;

        finishedIds.add(ball.id);
        finishOrder.push({
          id: ball.id,
          num: ball.plugin.raffle.num,
          name: ball.plugin.raffle.name,
          ms: Date.now()
        });

        // optional: dampen it after finish
        Body.setVelocity(ball, { x: 0, y: 0 });
        Body.setAngularVelocity(ball, 0);
      }
    });

    // Draw labels & finish line
    Events.on(render, "afterRender", () => {
      drawFinishLine_();
      drawBallLabels_();
    });

    // Tick (camera + flippers + scoreboard)
    Events.on(engine, "beforeUpdate", () => {
      if (chkFollow.checked) updateCameraFollow_();
      if (started) twitchFlippers_();
      updateScoreboard_();
    });

    window.addEventListener("resize", onResize_);

    built = true;
    started = false;
    status.textContent = "Course built. Click Start.";
    top5List.innerHTML = "";
    finalList.innerHTML = "";
  }

  // =========================
  // START / RESET / SHAKE
  // =========================
  function startRace() {
    if (!built) {
      status.textContent = "Build Course first.";
      return;
    }
    if (started) {
      status.textContent = "Already started.";
      return;
    }

    // Clear finishes
    finishedIds = new Set();
    finishOrder = [];
    top5List.innerHTML = "";
    finalList.innerHTML = "";

    // Release balls + enable gravity
    world.gravity.y = CFG.GRAVITY_Y;
    started = true;

    for (const b of balls) {
      Body.setSleeping(b, false);
      // tiny random nudge so they don’t stack perfectly
      Body.applyForce(b, b.position, { x: (Math.random() - 0.5) * 0.0006, y: 0 });
    }

    status.textContent = "Drop started!";
  }

  function resetAll() {
    // same as "Build Course" but keeps names text
    buildWorld();
  }

  function shake() {
    if (!built) return;
    for (const b of balls) {
      const fx = (Math.random() - 0.5) * 0.0015;
      const fy = (Math.random() - 0.5) * 0.0015;
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }
    status.textContent = "Shaken.";
  }

  // =========================
  // SCOREBOARD (CLEAN)
  // =========================
  function updateScoreboard_() {
    // Finish order only. (This is what you wanted.)
    const winners = finishOrder.slice(0, CFG.FINAL_RESULTS_COUNT);

    // Top 5 = first 5 winners
    const top5 = winners.slice(0, CFG.TOP5_COUNT);

    top5List.innerHTML = "";
    if (top5.length === 0) {
      top5List.appendChild(el("li", { text: "(no finishers yet)" }));
    } else {
      for (let i = 0; i < top5.length; i++) {
        const p = top5[i];
        top5List.appendChild(el("li", { text: `${ordinal_(i + 1)} ${p.name} (#${p.num})` }));
      }
    }

    finalList.innerHTML = "";
    if (winners.length === 0) {
      finalList.appendChild(el("li", { text: "(no finishers yet)" }));
    } else {
      for (let i = 0; i < winners.length; i++) {
        const p = winners[i];
        finalList.appendChild(el("li", { text: `${ordinal_(i + 1)} ${p.name} (#${p.num})` }));
      }
    }

    if (started && winners.length >= CFG.FINAL_RESULTS_COUNT) {
      status.textContent = `Top ${CFG.FINAL_RESULTS_COUNT} decided.`;
      // keep running visually, but you could set started=false if you want to “freeze”
    }
  }

  // =========================
  // CANVAS LABELS (ALWAYS STUCK TO BALLS)
  // =========================
  function drawBallLabels_() {
    if (!render) return;

    const ctx = render.context;
    ctx.save();

    const bounds = render.bounds;
    const w = render.options.width;
    const h = render.options.height;

    const scaleX = w / (bounds.max.x - bounds.min.x);
    const scaleY = h / (bounds.max.y - bounds.min.y);

    ctx.scale(scaleX, scaleY);
    ctx.translate(-bounds.min.x, -bounds.min.y);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    for (const b of balls) {
      const meta = b.plugin && b.plugin.raffle;
      if (!meta) continue;

      const x = b.position.x;
      const y = b.position.y;

      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.60)";
      ctx.strokeText(String(meta.num), x, y);

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(String(meta.num), x, y);
    }

    ctx.restore();
  }

  function drawFinishLine_() {
    if (!render) return;

    const ctx = render.context;
    const bounds = render.bounds;
    const w = render.options.width;
    const h = render.options.height;

    const scaleX = w / (bounds.max.x - bounds.min.x);
    const scaleY = h / (bounds.max.y - bounds.min.y);

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.translate(-bounds.min.x, -bounds.min.y);

    // big visible bar
    const barY = finishY - CFG.FINISH_BAR_H / 2;
    ctx.fillStyle = CFG.FINISH_BAR_FILL;
    ctx.strokeStyle = CFG.FINISH_BAR_STROKE;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.rect(bounds.min.x, barY, (bounds.max.x - bounds.min.x), CFG.FINISH_BAR_H);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // =========================
  // CAMERA FOLLOW
  // =========================
  function updateCameraFollow_() {
    if (!render || balls.length === 0) return;

    // leader = highest Y (lowest on screen)
    let leader = balls[0];
    for (const b of balls) if (b.position.y > leader.position.y) leader = b;

    const bounds = render.bounds;
    const viewW = bounds.max.x - bounds.min.x;
    const viewH = bounds.max.y - bounds.min.y;

    const targetMin = {
      x: leader.position.x - viewW / 2,
      y: leader.position.y - viewH / 2
    };
    const targetMax = {
      x: targetMin.x + viewW,
      y: targetMin.y + viewH
    };

    bounds.min.x += (targetMin.x - bounds.min.x) * CFG.CAMERA_LERP;
    bounds.min.y += (targetMin.y - bounds.min.y) * CFG.CAMERA_LERP;
    bounds.max.x += (targetMax.x - bounds.max.x) * CFG.CAMERA_LERP;
    bounds.max.y += (targetMax.y - bounds.max.y) * CFG.CAMERA_LERP;
  }

  // =========================
  // FLIPPERS
  // =========================
  function buildTwitchFlippers_(wW, wH) {
    const out = [];
    const leftX = Math.round(wW * 0.18);
    const rightX = Math.round(wW * 0.82);

    const ys = [
      Math.round(wH * 0.33),
      Math.round(wH * 0.52),
      Math.round(wH * 0.70)
    ];

    for (let i = 0; i < CFG.FLIPPER_COUNT_PER_SIDE; i++) {
      out.push(makeFlipper_(leftX, ys[i], +1));
      out.push(makeFlipper_(rightX, ys[i], -1));
    }
    return out;

    function makeFlipper_(x, y, dir) {
      const body = Bodies.rectangle(x, y, CFG.FLIPPER_W, CFG.FLIPPER_H, {
        isStatic: true,
        angle: dir * 0.35,
        render: { fillStyle: "rgba(90,110,150,0.32)" }
      });

      return {
        body,
        dir,
        baseAngle: body.angle,
        targetAngle: body.angle,
        nextTwitchAt: performance.now() + rand_(CFG.FLIPPER_TWITCH_INTERVAL_MS_MIN, CFG.FLIPPER_TWITCH_INTERVAL_MS_MAX),
        mode: "idle"
      };
    }
  }

  function twitchFlippers_() {
    const now = performance.now();
    for (const f of flippers) {
      if (now >= f.nextTwitchAt && f.mode === "idle") {
        f.mode = "kick";
        f.targetAngle = clamp_(f.baseAngle + f.dir * CFG.FLIPPER_MAX_ANGLE, -Math.PI, Math.PI);
      }

      if (f.mode === "kick") {
        Body.setAngularVelocity(f.body, f.dir * CFG.FLIPPER_KICK_ANGULAR_VEL);
        if (Math.abs(f.body.angle - f.targetAngle) < 0.10) {
          f.mode = "return";
          f.targetAngle = f.baseAngle;
        }
      } else if (f.mode === "return") {
        Body.setAngularVelocity(f.body, f.dir * CFG.FLIPPER_RETURN_ANGULAR_VEL);
        if (Math.abs(f.body.angle - f.targetAngle) < 0.10) {
          Body.setAngle(f.body, f.baseAngle);
          Body.setAngularVelocity(f.body, 0);
          f.mode = "idle";
          f.nextTwitchAt = now + rand_(CFG.FLIPPER_TWITCH_INTERVAL_MS_MIN, CFG.FLIPPER_TWITCH_INTERVAL_MS_MAX);
        }
      }
    }
  }

  // =========================
  // RESIZE
  // =========================
  function onResize_() {
    if (!render) return;
    render.options.width = window.innerWidth;
    render.options.height = window.innerHeight;
    render.canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    render.canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    render.canvas.style.width = window.innerWidth + "px";
    render.canvas.style.height = window.innerHeight + "px";
  }

  // =========================
  // HELPERS
  // =========================
  function pickColor_(i) {
    const palette = [
      "#63D471", "#FFD166", "#EF476F", "#06D6A0", "#118AB2",
      "#F78C6B", "#C792EA", "#82AAFF", "#FFCB6B", "#A3F7BF"
    ];
    return palette[i % palette.length];
  }
  function rand_(min, max) { return min + Math.random() * (max - min); }
  function clamp_(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ordinal_(n) {
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return `${n}th`;
  }

  // =========================
  // BUTTONS
  // =========================
  btnBuild.addEventListener("click", () => {
    try { buildWorld(); } catch (e) { status.textContent = "Build failed: " + (e && e.message ? e.message : String(e)); }
  });

  btnStart.addEventListener("click", () => {
    try { startRace(); } catch (e) { status.textContent = "Start failed: " + (e && e.message ? e.message : String(e)); }
  });

  btnReset.addEventListener("click", () => {
    try { resetAll(); } catch (e) { status.textContent = "Reset failed: " + (e && e.message ? e.message : String(e)); }
  });

  btnShake.addEventListener("click", () => {
    try { shake(); } catch (e) { status.textContent = "Shake failed: " + (e && e.message ? e.message : String(e)); }
  });

  // =========================
  // INIT (do NOT auto-start)
  // =========================
  cleanupLegacyLabels_();
  status.textContent = "Paste names → Build Course → Start";
})();
