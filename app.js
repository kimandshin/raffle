/* app.js — Ball Drop Raffle (FIXED LABELS + CLEAN SCOREBOARD + TWITCH FLIPPERS)
   - Matter.js required (matter.min.js loaded before this file)
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
    Bounds,
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
    FINISH_Y_PADDING: 140, // finish line is near bottom of world
    FINISH_SNAPSHOT_EVERY_MS: 200,

    // Camera follow
    FOLLOW_LEADER_DEFAULT: true,
    CAMERA_LERP: 0.14,
    CAMERA_PADDING_X: 260,
    CAMERA_PADDING_Y: 220,

    // UI
    LIVE_LEADERS_COUNT: 5,
    FINAL_RESULTS_COUNT: 10,

    // Flippers ("twitch bars")
    FLIPPER_COUNT_PER_SIDE: 3,
    FLIPPER_W: 110,
    FLIPPER_H: 16,
    FLIPPER_TWITCH_INTERVAL_MS_MIN: 450,
    FLIPPER_TWITCH_INTERVAL_MS_MAX: 1100,
    FLIPPER_KICK_ANGULAR_VEL: 0.55, // kick strength
    FLIPPER_RETURN_ANGULAR_VEL: -0.40,
    FLIPPER_MAX_ANGLE: 0.90, // radians
  };

  // =========================
  // DOM HELPERS (works even if your HTML differs)
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

  // Ensure container
  let root = qs("#app");
  if (!root) {
    root = el("div", { id: "app", style: "position:fixed; inset:0; background:#0b0d10;" });
    document.body.appendChild(root);
  }

  // Ensure sidebar
  let sidebar = qs("#sidebar");
  if (!sidebar) {
    sidebar = el("div", {
      id: "sidebar",
      style: [
        "position:absolute",
        "left:16px",
        "top:16px",
        "width:360px",
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

  // Ensure canvas holder
  let stage = qs("#stage");
  if (!stage) {
    stage = el("div", { id: "stage", style: "position:absolute; inset:0;" });
    root.appendChild(stage);
  }

  // Sidebar UI
  sidebar.innerHTML = "";
  const title = el("div", { style: "font-weight:800; font-size:16px; margin-bottom:10px;", text: "Ball Drop Raffle" });

  const btnRow = el("div", { style: "display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;" });
  const btnReset = el("button", { type: "button" });
  btnReset.textContent = "Reset";
  const btnStart = el("button", { type: "button" });
  btnStart.textContent = "Start";
  const btnShake = el("button", { type: "button" });
  btnShake.textContent = "Shake";

  [btnReset, btnStart, btnShake].forEach(b => {
    b.style.cssText = [
      "background:rgba(255,255,255,0.06)",
      "border:1px solid rgba(255,255,255,0.14)",
      "color:#e9eef7",
      "padding:7px 10px",
      "border-radius:10px",
      "cursor:pointer",
      "font-weight:700"
    ].join(";");
  });

  btnRow.append(btnReset, btnStart, btnShake);

  const optRow = el("div", { style: "display:flex; gap:12px; align-items:center; margin-bottom:8px; flex-wrap:wrap;" });
  const chkFollow = el("input", { type: "checkbox", id: "followLeader" });
  chkFollow.checked = CFG.FOLLOW_LEADER_DEFAULT;
  const lblFollow = el("label", { for: "followLeader", style: "cursor:pointer; user-select:none;" });
  lblFollow.textContent = "Follow leader";
  optRow.append(chkFollow, lblFollow);

  const status = el("div", { style: "opacity:0.9; margin:8px 0 10px 0;" });
  status.textContent = "Ready.";

  const hr = el("div", { style: "height:1px; background:rgba(255,255,255,0.10); margin:10px 0;" });

  const scoreBox = el("div");
  const scoreTitle = el("div", { style: "font-weight:900; margin-bottom:6px;" });
  scoreTitle.textContent = "Results";

  const liveTitle = el("div", { style: "font-weight:800; margin:8px 0 4px;" });
  liveTitle.textContent = "Live Leaders (Top 5)";

  const liveList = el("ol", { style: "margin:0 0 10px 18px; padding:0;" });

  const finalTitle = el("div", { style: "font-weight:800; margin:8px 0 4px;" });
  finalTitle.textContent = "Final Results (Top 10)";

  const finalList = el("ol", { style: "margin:0 0 0 18px; padding:0;" });

  scoreBox.append(scoreTitle, liveTitle, liveList, finalTitle, finalList);

  sidebar.append(title, btnRow, optRow, status, hr, scoreBox);

  // =========================
  // STATE
  // =========================
  let engine, world, render, runner;
  let balls = [];
  let pegs = [];
  let flippers = [];
  let floorY = 0;
  let finishY = 0;

  let running = false;
  let finishedIds = new Set();
  let finishOrder = []; // {id, name, num, t}
  let lastFinishScan = 0;

  // Example "names" (replace with your actual list if you want)
  // If you already load names elsewhere, just set window.RAFFLE_NAMES = [...]
  const names = Array.isArray(window.RAFFLE_NAMES) && window.RAFFLE_NAMES.length
    ? window.RAFFLE_NAMES.slice()
    : Array.from({ length: CFG.BALL_COUNT }, (_, i) => `Player ${i + 1}`);

  // =========================
  // BUILD WORLD
  // =========================
  function destroyWorld() {
    if (render) {
      Render.stop(render);
      render.canvas.remove();
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
    running = false;
    finishedIds.clear();
    finishOrder = [];
    lastFinishScan = 0;
    liveList.innerHTML = "";
    finalList.innerHTML = "";
  }

  function buildWorld() {
    destroyWorld();

    engine = Engine.create();
    world = engine.world;
    world.gravity.y = CFG.GRAVITY_Y;

    const w = window.innerWidth;
    const h = window.innerHeight;

    // World height big enough for long fall
    const worldW = Math.max(1200, w);
    const worldH = Math.max(2600, h * 2.2);

    floorY = worldH - 120;
    finishY = floorY - CFG.FINISH_Y_PADDING;

    // Walls
    const wallL = Bodies.rectangle(-CFG.WALL_THICKNESS / 2, worldH / 2, CFG.WALL_THICKNESS, worldH * 2, { isStatic: true });
    const wallR = Bodies.rectangle(worldW + CFG.WALL_THICKNESS / 2, worldH / 2, CFG.WALL_THICKNESS, worldH * 2, { isStatic: true });
    const floor = Bodies.rectangle(worldW / 2, floorY + CFG.WALL_THICKNESS / 2, worldW * 2, CFG.WALL_THICKNESS, { isStatic: true });

    World.add(world, [wallL, wallR, floor]);

    // Peg grid
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

    // Random diagonal bars (keep what you already liked)
    const bars = [];
    function addBar(x, y, length, angle) {
      const bar = Bodies.rectangle(x, y, length, 14, {
        isStatic: true,
        angle,
        render: { fillStyle: "rgba(80,100,140,0.28)" }
      });
      bars.push(bar);
    }
    addBar(220, 520, 520, 0.85);
    addBar(980, 380, 420, -0.85);
    addBar(820, 980, 380, 0.65);
    addBar(360, 1220, 520, -0.75);
    addBar(980, 1520, 520, 0.70);
    addBar(280, 1780, 520, -0.70);
    addBar(980, 2080, 520, 0.70);
    World.add(world, bars);

    // Twitch flippers: 3 left + 3 right at 1/3 and 2/3 height zones
    flippers = buildTwitchFlippers_(worldW, worldH);
    World.add(world, flippers.map(f => f.body));

    // Balls (stagger spawn at top)
    balls = [];
    for (let i = 0; i < CFG.BALL_COUNT; i++) {
      const x = worldW / 2 + (Math.random() * 220 - 110);
      const y = 40 + i * 10; // stagger
      const b = Bodies.circle(x, y, CFG.BALL_RADIUS, {
        restitution: CFG.BALL_RESTITUTION,
        friction: CFG.BALL_FRICTION,
        frictionAir: CFG.BALL_FRICTION_AIR,
        density: CFG.BALL_DENSITY,
        render: { fillStyle: pickColor_(i) }
      });

      // IMPORTANT: store id/num/name on the body itself
      b.plugin = b.plugin || {};
      b.plugin.raffle = {
        num: i + 1,
        name: names[i] || `Player ${i + 1}`
      };

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

    // Draw labels INSIDE the canvas (this is the core fix)
    Events.on(render, "afterRender", () => {
      drawBallLabels_();
      drawFinishLine_();
    });

    // Tick logic (camera follow + finish detection + flipper twitch)
    Events.on(engine, "beforeUpdate", () => {
      if (chkFollow.checked) updateCameraFollow_();
      scanFinishers_();
      twitchFlippers_();
      updateScoreboard_();
    });

    // Resize
    window.addEventListener("resize", onResize_);

    status.textContent = "Course built. Click Start.";
  }

  // =========================
  // FLIPPERS
  // =========================
  function buildTwitchFlippers_(worldW, worldH) {
    const out = [];
    const leftX = Math.round(worldW * 0.18);
    const rightX = Math.round(worldW * 0.82);

    const y1 = Math.round(worldH * 0.33);
    const y2 = Math.round(worldH * 0.52);
    const y3 = Math.round(worldH * 0.70);

    const ys = [y1, y2, y3];

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
        // twitch: quickly rotate a bit to kick
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
          // settle
          Body.setAngle(f.body, f.baseAngle);
          Body.setAngularVelocity(f.body, 0);
          f.mode = "idle";
          f.nextTwitchAt = now + rand_(CFG.FLIPPER_TWITCH_INTERVAL_MS_MIN, CFG.FLIPPER_TWITCH_INTERVAL_MS_MAX);
        }
      }
    }
  }

  // =========================
  // LABELS — FIXED (draw in canvas)
  // =========================
  function drawBallLabels_() {
    const ctx = render.context;
    ctx.save();

    // Match Matter.Render view transform
    const bounds = render.bounds;
    const w = render.options.width;
    const h = render.options.height;

    const scaleX = w / (bounds.max.x - bounds.min.x);
    const scaleY = h / (bounds.max.y - bounds.min.y);

    ctx.scale(scaleX, scaleY);
    ctx.translate(-bounds.min.x, -bounds.min.y);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    for (const b of balls) {
      const meta = b.plugin && b.plugin.raffle;
      if (!meta) continue;

      // Draw number centered ON the ball every frame
      const x = b.position.x;
      const y = b.position.y;

      // subtle outline for readability
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(String(meta.num), x, y);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(String(meta.num), x, y);
    }

    ctx.restore();
  }

  function drawFinishLine_() {
    const ctx = render.context;
    const bounds = render.bounds;
    const w = render.options.width;
    const h = render.options.height;

    const scaleX = w / (bounds.max.x - bounds.min.x);
    const scaleY = h / (bounds.max.y - bounds.min.y);

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.translate(-bounds.min.x, -bounds.min.y);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bounds.min.x, finishY);
    ctx.lineTo(bounds.max.x, finishY);
    ctx.stroke();

    ctx.restore();
  }

  // =========================
  // SCOREBOARD (clean)
  // =========================
  function scanFinishers_() {
    const now = performance.now();
    if (now - lastFinishScan < CFG.FINISH_SNAPSHOT_EVERY_MS) return;
    lastFinishScan = now;

    for (const b of balls) {
      const meta = b.plugin && b.plugin.raffle;
      if (!meta) continue;

      if (finishedIds.has(b.id)) continue;

      if (b.position.y >= finishY) {
        finishedIds.add(b.id);
        finishOrder.push({
          id: b.id,
          num: meta.num,
          name: meta.name,
          t: Date.now()
        });
      }
    }
  }

  function updateScoreboard_() {
    // Live leaders: closest to finish (largest y), excluding finished
    const live = balls
      .filter(b => !finishedIds.has(b.id))
      .map(b => {
        const meta = b.plugin.raffle;
        return {
          id: b.id,
          num: meta.num,
          name: meta.name,
          y: b.position.y
        };
      })
      .sort((a, b) => b.y - a.y)
      .slice(0, CFG.LIVE_LEADERS_COUNT);

    // Final results (finish order)
    const final = finishOrder.slice(0, CFG.FINAL_RESULTS_COUNT);

    // Render lists
    liveList.innerHTML = "";
    if (live.length === 0) {
      liveList.appendChild(el("li", { text: "(waiting for balls...)" }));
    } else {
      for (const p of live) {
        liveList.appendChild(el("li", { text: `${p.name} (#${p.num})` }));
      }
    }

    finalList.innerHTML = "";
    if (final.length === 0) {
      finalList.appendChild(el("li", { text: "(no finishers yet)" }));
    } else {
      for (const p of final) {
        finalList.appendChild(el("li", { text: `${p.name} (#${p.num})` }));
      }
    }

    // Status message
    if (running && final.length >= CFG.FINAL_RESULTS_COUNT) {
      status.textContent = `Top ${CFG.FINAL_RESULTS_COUNT} decided.`;
      running = false;
    }
  }

  // =========================
  // CAMERA FOLLOW
  // =========================
  function updateCameraFollow_() {
    // Follow "leader" = highest y (closest to finish), regardless of finished state
    let leader = balls[0];
    for (const b of balls) {
      if (b.position.y > leader.position.y) leader = b;
    }

    const bounds = render.bounds;

    const viewW = bounds.max.x - bounds.min.x;
    const viewH = bounds.max.y - bounds.min.y;

    const targetCenter = {
      x: leader.position.x,
      y: leader.position.y
    };

    // clamp camera so it doesn't go beyond world-ish ranges
    const desiredMin = {
      x: targetCenter.x - viewW / 2,
      y: targetCenter.y - viewH / 2
    };

    const desiredMax = {
      x: desiredMin.x + viewW,
      y: desiredMin.y + viewH
    };

    // lerp
    bounds.min.x += (desiredMin.x - bounds.min.x) * CFG.CAMERA_LERP;
    bounds.min.y += (desiredMin.y - bounds.min.y) * CFG.CAMERA_LERP;
    bounds.max.x += (desiredMax.x - bounds.max.x) * CFG.CAMERA_LERP;
    bounds.max.y += (desiredMax.y - bounds.max.y) * CFG.CAMERA_LERP;
  }

  // =========================
  // ACTIONS
  // =========================
  function startRace() {
    running = true;
    status.textContent = "Drop started. Recording finishers...";
  }

  function shake() {
    for (const b of balls) {
      const fx = (Math.random() - 0.5) * 0.03 * b.mass;
      const fy = (Math.random() - 0.5) * 0.03 * b.mass;
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }
    status.textContent = "Shaken.";
  }

  // =========================
  // EVENTS
  // =========================
  btnReset.addEventListener("click", () => buildWorld());
  btnStart.addEventListener("click", () => startRace());
  btnShake.addEventListener("click", () => shake());

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

  function rand_(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp_(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  // =========================
  // INIT
  // =========================
  buildWorld();
})();
