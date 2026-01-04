/* app.js — Ball Drop Raffle (CANVAS LABELS FIX + CLEAN TOP 5 + WORKS WITH EXISTING UI)
   Requires matter.min.js loaded before this file.
*/

(() => {
  if (!window.Matter) {
    console.error("Matter.js not found. Load matter.min.js before app.js");
    return;
  }

  const { Engine, Render, Runner, World, Bodies, Body, Events } = Matter;

  const CFG = {
    BALL_COUNT_DEFAULT: 50,
    BALL_RADIUS: 14,
    BALL_RESTITUTION: 0.45,
    BALL_FRICTION: 0.04,
    BALL_FRICTION_AIR: 0.012,
    BALL_DENSITY: 0.002,

    GRAVITY_Y: 1.05,
    WALL_THICKNESS: 80,

    PEG_ROWS: 14,
    PEG_COLS: 14,
    PEG_RADIUS: 6,
    PEG_SPACING: 60,
    PEG_OFFSET_X: 160,
    PEG_OFFSET_Y: 130,

    FINISH_Y_PADDING: 140,
    FINISH_SCAN_MS: 150,

    FOLLOW_LERP: 0.14,

    LIVE_COUNT: 5,
    FINAL_COUNT: 5,

    FLIPPER_W: 110,
    FLIPPER_H: 16,
    FLIPPER_KICK_ANGVEL: 0.60,
    FLIPPER_RETURN_ANGVEL: -0.45,
    FLIPPER_MAX_DELTA: 0.90,
    FLIPPER_TWITCH_MIN: 450,
    FLIPPER_TWITCH_MAX: 1100
  };

  // -------------------------
  // DOM helpers (NO sidebar rewrite)
  // -------------------------
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));

  function findButtonByText(txt) {
    const t = txt.trim().toLowerCase();
    const btns = qsa("button, input[type='button'], input[type='submit']");
    for (const b of btns) {
      const label = (b.tagName === "INPUT" ? (b.value || "") : (b.textContent || "")).trim().toLowerCase();
      if (label === t) return b;
    }
    return null;
  }

  function getEl() {
    // Try common ids first (safe)
    const btnBuild = qs("#btnBuild") || qs("#buildBtn") || findButtonByText("Build Course");
    const btnStart = qs("#btnStart") || qs("#startBtn") || findButtonByText("Start");
    const btnReset = qs("#btnReset") || qs("#resetBtn") || findButtonByText("Reset");
    const btnShake = qs("#btnShake") || qs("#shakeBtn") || findButtonByText("Shake");

    const chkFollow = qs("#followLeader") || qs("#chkFollow") || qsa("input[type='checkbox']").find(x => (x.id || "").toLowerCase().includes("follow"));
    const chkStagger = qs("#staggerRelease") || qs("#chkStagger") || qsa("input[type='checkbox']").find(x => (x.id || "").toLowerCase().includes("stagger"));

    const namesInput =
      qs("#namesInput") ||
      qs("#participants") ||
      qs("textarea") ||
      null;

    // Score container: try ids, otherwise the first box that contains "Top" text
    const scoreRoot =
      qs("#scoreboard") ||
      qs("#results") ||
      qsa("div").find(d => (d.textContent || "").includes("Top 5")) ||
      null;

    // Stage container
    const stage =
      qs("#stage") ||
      qs("#canvas") ||
      qs("#game") ||
      qs("main") ||
      document.body;

    return { btnBuild, btnStart, btnReset, btnShake, chkFollow, chkStagger, namesInput, scoreRoot, stage };
  }

  const UI = getEl();

  // If you have a dedicated stage div, we will render into it.
  // If not, we render into body, but we do NOT touch your sidebar.
  let engine = null;
  let render = null;
  let runner = null;
  let balls = [];
  let flippers = [];
  let finishY = 0;
  let worldW = 0;
  let worldH = 0;

  let started = false;
  let finishedIds = new Set();
  let finishOrder = [];
  let lastFinishScan = 0;

  // -------------------------
  // Scoreboard (clean)
  // -------------------------
  let scoreBox = null;
  let liveList = null;
  let finalList = null;

  function ensureScoreboardUI_() {
    if (!UI.scoreRoot) return;

    // Create a clean sub-box inside your existing sidebar section
    if (!scoreBox) {
      scoreBox = document.createElement("div");
      scoreBox.style.cssText = "margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.10);";

      const h = document.createElement("div");
      h.textContent = "Results";
      h.style.cssText = "font-weight:800; margin-bottom:6px;";

      const liveH = document.createElement("div");
      liveH.textContent = "Live Top 5";
      liveH.style.cssText = "font-weight:700; margin:8px 0 4px;";

      liveList = document.createElement("ol");
      liveList.style.cssText = "margin:0 0 10px 18px; padding:0;";

      const finalH = document.createElement("div");
      finalH.textContent = "Final Top 5";
      finalH.style.cssText = "font-weight:700; margin:8px 0 4px;";

      finalList = document.createElement("ol");
      finalList.style.cssText = "margin:0 0 0 18px; padding:0;";

      scoreBox.appendChild(h);
      scoreBox.appendChild(liveH);
      scoreBox.appendChild(liveList);
      scoreBox.appendChild(finalH);
      scoreBox.appendChild(finalList);

      UI.scoreRoot.appendChild(scoreBox);
    }

    renderScore_();
  }

  function renderScore_() {
    if (!liveList || !finalList) return;

    // Live = closest to finish among NOT finished
    const live = balls
      .filter(b => !finishedIds.has(b.id))
      .map(b => ({
        y: b.position.y,
        num: b.plugin && b.plugin.raffle ? b.plugin.raffle.num : 0,
        name: b.plugin && b.plugin.raffle ? b.plugin.raffle.name : ""
      }))
      .sort((a, b) => b.y - a.y)
      .slice(0, CFG.LIVE_COUNT);

    // Final = finish order
    const final = finishOrder.slice(0, CFG.FINAL_COUNT);

    liveList.innerHTML = "";
    if (live.length === 0) {
      const li = document.createElement("li");
      li.textContent = "(waiting...)";
      liveList.appendChild(li);
    } else {
      for (let i = 0; i < live.length; i++) {
        const li = document.createElement("li");
        li.textContent = `${ordinal_(i + 1)} ${live[i].name} (#${live[i].num})`;
        liveList.appendChild(li);
      }
    }

    finalList.innerHTML = "";
    if (final.length === 0) {
      const li = document.createElement("li");
      li.textContent = "(no finishers yet)";
      finalList.appendChild(li);
    } else {
      for (let i = 0; i < final.length; i++) {
        const li = document.createElement("li");
        li.textContent = `${ordinal_(i + 1)} ${final[i].name} (#${final[i].num})`;
        finalList.appendChild(li);
      }
    }
  }

  function ordinal_(n) {
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return `${n}th`;
  }

  // -------------------------
  // Names parsing
  // -------------------------
  function parseNames_() {
    const raw = UI.namesInput ? (UI.namesInput.value || "").trim() : "";
    const lines = raw
      .split(/\r?\n/g)
      .map(s => s.trim())
      .filter(Boolean);

    // If empty, fallback to Player 1..N but DO NOT auto-start anything
    if (lines.length === 0) {
      const n = CFG.BALL_COUNT_DEFAULT;
      return Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
    }

    // Allow "1. Name" or "1) Name"
    const cleaned = lines.map(line => line.replace(/^\s*\d+\s*[\.\)]\s*/, "").trim()).filter(Boolean);
    return cleaned;
  }

  // -------------------------
  // Build / Destroy
  // -------------------------
  function destroyWorld_() {
    if (render) {
      try { Render.stop(render); } catch (e) {}
      if (render.canvas && render.canvas.parentNode) render.canvas.parentNode.removeChild(render.canvas);
      render.textures = {};
    }
    if (runner) {
      try { Runner.stop(runner); } catch (e) {}
    }
    engine = null;
    render = null;
    runner = null;
    balls = [];
    flippers = [];
    started = false;
    finishedIds = new Set();
    finishOrder = [];
    lastFinishScan = 0;
  }

  function buildCourse_() {
    destroyWorld_();

    const names = parseNames_();
    const ballCount = Math.min(200, Math.max(1, names.length));

    engine = Engine.create();
    engine.world.gravity.y = CFG.GRAVITY_Y;

    const w = window.innerWidth;
    const h = window.innerHeight;

    worldW = Math.max(1200, w);
    worldH = Math.max(2600, h * 2.2);

    const floorY = worldH - 120;
    finishY = floorY - CFG.FINISH_Y_PADDING;

    // Walls + Floor
    const wallL = Bodies.rectangle(-CFG.WALL_THICKNESS / 2, worldH / 2, CFG.WALL_THICKNESS, worldH * 2, { isStatic: true });
    const wallR = Bodies.rectangle(worldW + CFG.WALL_THICKNESS / 2, worldH / 2, CFG.WALL_THICKNESS, worldH * 2, { isStatic: true });
    const floor = Bodies.rectangle(worldW / 2, floorY + CFG.WALL_THICKNESS / 2, worldW * 2, CFG.WALL_THICKNESS, { isStatic: true });
    World.add(engine.world, [wallL, wallR, floor]);

    // Pegs
    const pegs = [];
    for (let r = 0; r < CFG.PEG_ROWS; r++) {
      for (let c = 0; c < CFG.PEG_COLS; c++) {
        const x = CFG.PEG_OFFSET_X + c * CFG.PEG_SPACING + (r % 2 ? CFG.PEG_SPACING / 2 : 0);
        const y = CFG.PEG_OFFSET_Y + r * CFG.PEG_SPACING;
        pegs.push(Bodies.circle(x, y, CFG.PEG_RADIUS, {
          isStatic: true,
          render: { fillStyle: "rgba(140,160,190,0.22)" }
        }));
      }
    }
    World.add(engine.world, pegs);

    // Bars (your diagonal stuff)
    const bars = [];
    const addBar = (x, y, length, angle) => {
      bars.push(Bodies.rectangle(x, y, length, 14, {
        isStatic: true,
        angle,
        render: { fillStyle: "rgba(80,100,140,0.28)" }
      }));
    };
    addBar(220, 520, 520, 0.85);
    addBar(980, 380, 420, -0.85);
    addBar(820, 980, 380, 0.65);
    addBar(360, 1220, 520, -0.75);
    addBar(980, 1520, 520, 0.70);
    addBar(280, 1780, 520, -0.70);
    addBar(980, 2080, 520, 0.70);
    World.add(engine.world, bars);

    // Twitch flippers (3 left + 3 right)
    flippers = buildFlippers_(worldW, worldH);
    World.add(engine.world, flippers.map(f => f.body));

    // Balls (spawn held above view until Start)
    balls = [];
    for (let i = 0; i < ballCount; i++) {
      const x = worldW / 2 + (Math.random() * 220 - 110);
      const y = -2000 - i * 40; // kept offscreen until Start
      const b = Bodies.circle(x, y, CFG.BALL_RADIUS, {
        restitution: CFG.BALL_RESTITUTION,
        friction: CFG.BALL_FRICTION,
        frictionAir: CFG.BALL_FRICTION_AIR,
        density: CFG.BALL_DENSITY,
        render: { fillStyle: pickColor_(i) }
      });
      b.plugin = b.plugin || {};
      b.plugin.raffle = { num: i + 1, name: names[i] || `Player ${i + 1}` };
      balls.push(b);
    }
    World.add(engine.world, balls);

    // Render
    render = Render.create({
      element: UI.stage || document.body,
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

    // Canvas labels that NEVER detach
    Events.on(render, "afterRender", () => {
      drawBallNumbers_();
      drawFinishLine_();
    });

    Events.on(engine, "beforeUpdate", () => {
      if (UI.chkFollow && UI.chkFollow.checked) followLeader_();
      if (started) {
        scanFinishers_();
        twitchFlippers_();
        ensureScoreboardUI_();
      }
    });

    window.addEventListener("resize", onResize_);

    // Reset scoreboard UI
    ensureScoreboardUI_();

    console.log("Course built.");
  }

  // -------------------------
  // Start / Reset / Shake
  // -------------------------
  function start_() {
    if (!engine || balls.length === 0) {
      console.warn("Build Course first.");
      return;
    }
    if (started) return;

    started = true;

    const stagger = UI.chkStagger ? !!UI.chkStagger.checked : true;
    const dropXCenter = worldW / 2;
    const baseY = 40;

    // Move balls into the top of the world only when Start is pressed
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const x = dropXCenter + (Math.random() * 220 - 110);
      const y = baseY + (stagger ? i * 10 : 0);
      Body.setPosition(b, { x, y });
      Body.setVelocity(b, { x: 0, y: 0 });
      Body.setAngularVelocity(b, 0);
    }

    ensureScoreboardUI_();
    console.log("Drop started.");
  }

  function reset_() {
    // Rebuild course from current names input
    buildCourse_();
  }

  function shake_() {
    if (!engine) return;
    for (const b of balls) {
      const fx = (Math.random() - 0.5) * 0.03 * b.mass;
      const fy = (Math.random() - 0.5) * 0.03 * b.mass;
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }
  }

  // -------------------------
  // Finish detection + scoreboard
  // -------------------------
  function scanFinishers_() {
    const now = performance.now();
    if (now - lastFinishScan < CFG.FINISH_SCAN_MS) return;
    lastFinishScan = now;

    for (const b of balls) {
      if (finishedIds.has(b.id)) continue;
      if (b.position.y >= finishY) {
        finishedIds.add(b.id);
        const meta = b.plugin && b.plugin.raffle ? b.plugin.raffle : { num: 0, name: "" };
        finishOrder.push({ id: b.id, num: meta.num, name: meta.name, t: Date.now() });
        if (finishOrder.length >= CFG.FINAL_COUNT) {
          // lock after top 5
          // we keep sim running visually, but scoreboard stays top 5
        }
      }
    }
  }

  // -------------------------
  // Camera follow
  // -------------------------
  function followLeader_() {
    if (!render || balls.length === 0) return;

    let leader = balls[0];
    for (const b of balls) {
      if (b.position.y > leader.position.y) leader = b;
    }

    const bounds = render.bounds;
    const viewW = bounds.max.x - bounds.min.x;
    const viewH = bounds.max.y - bounds.min.y;

    const desiredMinX = leader.position.x - viewW / 2;
    const desiredMinY = leader.position.y - viewH / 2;

    const desiredMaxX = desiredMinX + viewW;
    const desiredMaxY = desiredMinY + viewH;

    bounds.min.x += (desiredMinX - bounds.min.x) * CFG.FOLLOW_LERP;
    bounds.min.y += (desiredMinY - bounds.min.y) * CFG.FOLLOW_LERP;
    bounds.max.x += (desiredMaxX - bounds.max.x) * CFG.FOLLOW_LERP;
    bounds.max.y += (desiredMaxY - bounds.max.y) * CFG.FOLLOW_LERP;
  }

  // -------------------------
  // Flippers
  // -------------------------
  function buildFlippers_(w, h) {
    const out = [];
    const leftX = Math.round(w * 0.18);
    const rightX = Math.round(w * 0.82);

    const ys = [Math.round(h * 0.33), Math.round(h * 0.52), Math.round(h * 0.70)];

    for (let i = 0; i < ys.length; i++) {
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
        nextAt: performance.now() + rand_(CFG.FLIPPER_TWITCH_MIN, CFG.FLIPPER_TWITCH_MAX),
        mode: "idle"
      };
    }
  }

  function twitchFlippers_() {
    const now = performance.now();
    for (const f of flippers) {
      if (f.mode === "idle" && now >= f.nextAt) {
        f.mode = "kick";
        f.targetAngle = f.baseAngle + f.dir * CFG.FLIPPER_MAX_DELTA;
      }

      if (f.mode === "kick") {
        Body.setAngularVelocity(f.body, f.dir * CFG.FLIPPER_KICK_ANGVEL);
        if (Math.abs(f.body.angle - f.targetAngle) < 0.10) {
          f.mode = "return";
          f.targetAngle = f.baseAngle;
        }
      } else if (f.mode === "return") {
        Body.setAngularVelocity(f.body, f.dir * CFG.FLIPPER_RETURN_ANGVEL);
        if (Math.abs(f.body.angle - f.targetAngle) < 0.10) {
          Body.setAngle(f.body, f.baseAngle);
          Body.setAngularVelocity(f.body, 0);
          f.mode = "idle";
          f.nextAt = now + rand_(CFG.FLIPPER_TWITCH_MIN, CFG.FLIPPER_TWITCH_MAX);
        }
      }
    }
  }

  // -------------------------
  // Canvas labels (THIS fixes “numbers falling off”)
  // -------------------------
  function drawBallNumbers_() {
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

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    for (const b of balls) {
      const meta = b.plugin && b.plugin.raffle;
      if (!meta) continue;

      const x = b.position.x;
      const y = b.position.y;

      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(String(meta.num), x, y);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
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

    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bounds.min.x, finishY);
    ctx.lineTo(bounds.max.x, finishY);
    ctx.stroke();

    ctx.restore();
  }

  // -------------------------
  // Resize
  // -------------------------
  function onResize_() {
    if (!render) return;
    render.options.width = window.innerWidth;
    render.options.height = window.innerHeight;

    const dpr = window.devicePixelRatio || 1;
    render.canvas.width = window.innerWidth * dpr;
    render.canvas.height = window.innerHeight * dpr;
    render.canvas.style.width = window.innerWidth + "px";
    render.canvas.style.height = window.innerHeight + "px";
  }

  // -------------------------
  // Helpers
  // -------------------------
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

  // -------------------------
  // Wire your existing buttons (THIS is the key)
  // -------------------------
  function wireUI_() {
    if (UI.btnBuild) UI.btnBuild.addEventListener("click", buildCourse_);
    if (UI.btnStart) UI.btnStart.addEventListener("click", start_);
    if (UI.btnReset) UI.btnReset.addEventListener("click", reset_);
    if (UI.btnShake) UI.btnShake.addEventListener("click", shake_);

    // If any are missing, log it so you can fix ids fast
    const missing = [];
    if (!UI.btnBuild) missing.push("Build Course");
    if (!UI.btnStart) missing.push("Start");
    if (!UI.btnReset) missing.push("Reset");
    if (!UI.btnShake) missing.push("Shake");
    if (missing.length) {
      console.warn("Could not find buttons:", missing.join(", "));
      console.warn("Tip: add ids like #btnBuild #btnStart #btnReset #btnShake and reload.");
    }
  }

  // -------------------------
  // INIT (NO auto start)
  // -------------------------
  wireUI_();
  ensureScoreboardUI_();

  // Do NOT auto-build. You press Build Course.
  // If you want auto-build only when names exist, uncomment:
  // if (UI.namesInput && UI.namesInput.value.trim()) buildCourse_();

})();
