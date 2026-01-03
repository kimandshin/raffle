/* =========================================================
   Ball Drop Raffle — FIXED (no trap ledges, real spinner, clean finish)
   - ONE finish system (sensor collision only)
   - NO long flat bars / ridges that trap balls
   - Deflectors are short, steep, spaced out, low-friction
   - Spinner is truly dynamic, pinned, and forced to keep spinning
   - Camera clamping fixed (no bounds glitches)
   ========================================================= */

const { Engine, Render, Runner, Bodies, Body, Composite, Events, Constraint } = Matter;

const canvas = document.getElementById("c");
const panelEl = document.getElementById("ui");

const namesEl = document.getElementById("names");
const buildBtn = document.getElementById("buildBtn");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const shakeBtn = document.getElementById("shakeBtn");

const staggerEl = document.getElementById("stagger");
const followLeaderEl = document.getElementById("followLeader");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const top5El = document.getElementById("top5");
const musicUrlEl = document.getElementById("musicUrl");
const musicBtn = document.getElementById("musicBtn");

let engine, runner, render;
let balls = [];
let finishers = [];
let courseBuilt = false;
let resizeHandlerBound = false;
let isRunning = false;

let music = new Audio();
music.loop = true;
let musicPlaying = false;

let confetti = [];
let bigWinText = null;

const WORLD = {
  width: 1100,
  height: 12000,
  startY: 180,
  finishY: 11500
};

const COURSE = {
  WALL_THICK: 80,

  // Peg field near the top
  PEG_R: 10,
  PEG_MARGIN_X: 90,
  PEG_TOP_Y: 140,
  PEG_ROWS: 11,
  PEG_COLS: 12,
  PEG_ROW_GAP: 80,

  // Deflectors (NO RIDGES)
  DEFLECT_COUNT: 18,
  DEFLECT_LEN_MIN: 70,
  DEFLECT_LEN_MAX: 130,
  DEFLECT_THICK: 14,
  DEFLECT_ANGLE_MIN: 0.55, // ~31.5 deg (steeper)
  DEFLECT_ANGLE_MAX: 1.10, // ~63 deg
  DEFLECT_MIN_DIST: 220,   // spacing so two deflectors don’t create a pocket

  // Finish sensor
  FINISH_SENSOR_W_PAD: 160,
  FINISH_SENSOR_H: 28,

  // Spinner
  SPINNER_Y: 5200,
  SPINNER_HUB_R: 30,
  SPINNER_SPOKE_LEN: 240,
  SPINNER_SPOKE_THICK: 16,
  SPINNER_SPOKES: 6,
  SPINNER_TARGET_AV: 0.14, // target angular velocity (kept constant)
};

let spinnerRef = null;
let keepSpinHandler = null;
let finishCollisionHandler = null;

function setStatus(msg) { statusEl.textContent = msg; }

function setPanelRunning(on) {
  if (!panelEl) return;
  if (on) panelEl.classList.add("running");
  else panelEl.classList.remove("running");
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand_(a, b) { return a + Math.random() * (b - a); }

function resizeCanvasToCSS() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  if (render) {
    render.options.pixelRatio = dpr;
    render.options.width = canvas.width;
    render.options.height = canvas.height;
  }
}

function parseNames() {
  const lines = namesEl.value
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const names = lines.map((line, i) => {
    const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();
    return cleaned || `Player ${i + 1}`;
  });

  return names.slice(0, 55);
}

/* ---------- Engine / Renderer ---------- */

function initEngine() {
  engine = Engine.create();
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  engine.gravity.y = 1.0;
  engine.gravity.x = 0.0;

  render = Render.create({
    canvas,
    engine,
    options: {
      width: canvas.width,
      height: canvas.height,
      wireframes: false,
      background: "#0f0f12",
      hasBounds: true
    }
  });

  runner = Runner.create();
  Runner.run(runner, engine);
  Render.run(render);

  if (!resizeHandlerBound) {
    window.addEventListener("resize", () => resizeCanvasToCSS());
    resizeHandlerBound = true;
  }
}

function clearWorld() {
  if (runner) Runner.stop(runner);
  if (render) Render.stop(render);

  if (engine) {
    // remove event handlers safely
    if (keepSpinHandler) Events.off(engine, "beforeUpdate", keepSpinHandler);
    if (finishCollisionHandler) Events.off(engine, "collisionStart", finishCollisionHandler);

    Composite.clear(engine.world, false);
    Engine.clear(engine);
  }

  balls = [];
  finishers = [];
  confetti = [];
  bigWinText = null;

  spinnerRef = null;
  keepSpinHandler = null;
  finishCollisionHandler = null;

  courseBuilt = false;
  isRunning = false;

  top5El.innerHTML = "";
  startBtn.disabled = true;

  setPanelRunning(false);
}

function boot() {
  resizeCanvasToCSS();
  initEngine();
  setupCamera();
  setupCustomOverlayDrawing();
  setStatus("Paste names → Build Course → Start");
}

/* ---------- Course Pieces (NO TRAPS) ---------- */

function addWalls_(world, W, H) {
  const t = COURSE.WALL_THICK;
  const walls = [
    Bodies.rectangle(W / 2, -t / 2, W + t * 2, t, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(-t / 2, H / 2, t, H + t * 2, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(W + t / 2, H / 2, t, H + t * 2, { isStatic: true, render: { visible: false } }),
  ];
  Composite.add(world, walls);
  return walls;
}

function addPegField_(world, W) {
  const pegs = [];
  const marginX = COURSE.PEG_MARGIN_X;

  const cols = COURSE.PEG_COLS;
  const usableW = Math.max(200, W - marginX * 2);
  const colGap = usableW / (cols - 1);

  const rows = COURSE.PEG_ROWS;
  const rowGap = COURSE.PEG_ROW_GAP;
  let y = COURSE.PEG_TOP_Y;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2 === 0) ? 0 : colGap / 2;
    for (let c = 0; c < cols; c++) {
      let x = marginX + c * colGap + offset;
      x = clamp(x, COURSE.PEG_R + 20, W - COURSE.PEG_R - 20);

      const peg = Bodies.circle(x, y, COURSE.PEG_R, {
        isStatic: true,
        restitution: 0.15,
        friction: 0.15,
        render: { fillStyle: "#2a2f3a" }
      });
      pegs.push(peg);
    }
    y += rowGap;
  }

  Composite.add(world, pegs);
  return pegs;
}

function tooClose_(x, y, placed) {
  const minD2 = COURSE.DEFLECT_MIN_DIST * COURSE.DEFLECT_MIN_DIST;
  for (const p of placed) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < minD2) return true;
  }
  return false;
}

function addShortDeflectors_(world, W, H) {
  const deflectors = [];
  const placed = [];

  const top = COURSE.PEG_TOP_Y + COURSE.PEG_ROW_GAP * 1.2;
  const bottom = WORLD.finishY - 420;

  let tries = 0;
  while (deflectors.length < COURSE.DEFLECT_COUNT && tries < 600) {
    tries++;

    const len = rand_(COURSE.DEFLECT_LEN_MIN, COURSE.DEFLECT_LEN_MAX);
    const thick = COURSE.DEFLECT_THICK;

    const x = rand_(140, W - 140);
    const y = rand_(top, bottom);

    if (tooClose_(x, y, placed)) continue;

    const sign = Math.random() < 0.5 ? -1 : 1;
    const angle = sign * rand_(COURSE.DEFLECT_ANGLE_MIN, COURSE.DEFLECT_ANGLE_MAX);

    const bar = Bodies.rectangle(x, y, len, thick, {
      isStatic: true,
      angle,
      restitution: 0.05,
      friction: 0.12,     // low friction = no “resting” on ledges
      frictionStatic: 0.0,
      render: { fillStyle: "#1d2230" }
    });

    deflectors.push(bar);
    placed.push({ x, y });
  }

  Composite.add(world, deflectors);
  return deflectors;
}

function addSpinnerInPath_(world, W) {
  const cx = W * 0.5;
  const cy = COURSE.SPINNER_Y;

  const hub = Bodies.circle(cx, cy, COURSE.SPINNER_HUB_R, {
    frictionAir: 0.02,
    render: { fillStyle: "#2a2f3a" }
  });

  const parts = [hub];
  for (let i = 0; i < COURSE.SPINNER_SPOKES; i++) {
    const a = (Math.PI * 2 * i) / COURSE.SPINNER_SPOKES;
    const spoke = Bodies.rectangle(cx, cy, COURSE.SPINNER_SPOKE_LEN, COURSE.SPINNER_SPOKE_THICK, {
      angle: a,
      render: { fillStyle: "#2a2f3a" }
    });
    parts.push(spoke);
  }

  const spinner = Body.create({ parts, frictionAir: 0.02 });
  Body.setAngularVelocity(spinner, COURSE.SPINNER_TARGET_AV);

  const pin = Constraint.create({
    pointA: { x: cx, y: cy },
    bodyB: spinner,
    pointB: { x: 0, y: 0 },
    stiffness: 1,
    length: 0
  });

  Composite.add(world, [spinner, pin]);

  // Keep it spinning (Matter will otherwise slow it down)
  keepSpinHandler = () => {
    if (!spinnerRef) return;
    Body.setAngularVelocity(spinnerRef, COURSE.SPINNER_TARGET_AV);
  };
  Events.on(engine, "beforeUpdate", keepSpinHandler);

  spinnerRef = spinner;
  return spinner;
}

function addFinishSensor_(world, W) {
  const sensor = Bodies.rectangle(W / 2, WORLD.finishY, W - COURSE.FINISH_SENSOR_W_PAD, COURSE.FINISH_SENSOR_H, {
    isStatic: true,
    isSensor: true,
    label: "finishSensor",
    render: { fillStyle: "rgba(120,100,255,0.35)" }
  });

  // Hidden floor far below
  const floor = Bodies.rectangle(W / 2, WORLD.height + 240, W + 600, 120, {
    isStatic: true,
    render: { visible: false }
  });

  Composite.add(world, [sensor, floor]);

  finishCollisionHandler = (evt) => {
    for (const pair of evt.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;

      const hitSensor = (a.label === "finishSensor" || b.label === "finishSensor");
      if (!hitSensor) continue;

      const ball = (a.label === "ball") ? a : (b.label === "ball") ? b : null;
      if (!ball || !ball.plugin || ball.plugin.removed || ball.plugin.finished) continue;

      ball.plugin.finished = true;

      if (finishers.length < 5) {
        finishers.push({ idx: ball.plugin.idx, name: ball.plugin.name, y: ball.position.y });
        updateTop5UI();
        celebrateFinisher(ball, finishers.length);
        if (finishers.length === 5) setStatus("Top 5 decided! See scoreboard.");
      }

      setTimeout(() => removeBallFromWorld_(ball), 200);
    }
  };

  Events.on(engine, "collisionStart", finishCollisionHandler);
  return sensor;
}

/* ---------- Build Course ---------- */

function buildCourseFixed_() {
  const world = engine.world;
  const W = WORLD.width;
  const H = WORLD.height;

  // Clear world bodies only (don’t nuke engine/render)
  Composite.clear(world, false);

  // Remove old handlers if rebuilding
  if (keepSpinHandler) Events.off(engine, "beforeUpdate", keepSpinHandler);
  if (finishCollisionHandler) Events.off(engine, "collisionStart", finishCollisionHandler);
  keepSpinHandler = null;
  finishCollisionHandler = null;
  spinnerRef = null;

  addWalls_(world, W, H);
  addPegField_(world, W);
  addShortDeflectors_(world, W, H);
  addSpinnerInPath_(world, W);
  addFinishSensor_(world, W);

  engine.gravity.y = 1.0;
  engine.gravity.x = 0.0;

  courseBuilt = true;
  startBtn.disabled = false;
  setStatus("Course built. Click Start.");
}

function buildCourse() {
  buildCourseFixed_();
}

/* ---------- Balls ---------- */

function spawnBalls(names) {
  const world = engine.world;
  balls = [];

  const startX = WORLD.width / 2;
  const startY = WORLD.startY;

  const cols = 11;
  const spacing = 26;

  for (let i = 0; i < names.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const hue = Math.floor((i * 360) / Math.max(1, names.length));
    const fill = `hsl(${hue} 90% 60%)`;

    const b = Bodies.circle(
      startX - ((cols - 1) / 2) * spacing + col * spacing,
      startY - row * spacing,
      13,
      {
        label: "ball",
        restitution: 0.25,
        friction: 0.02,
        frictionAir: 0.016,
        render: { fillStyle: fill }
      }
    );

    b.plugin = { idx: i + 1, name: names[i], finished: false, removed: false };
    balls.push(b);
  }

  if (staggerEl.checked) {
    let k = 0;
    const iv = setInterval(() => {
      if (k >= balls.length) { clearInterval(iv); return; }
      Composite.add(world, balls[k]);
      k++;
    }, 110);
  } else {
    Composite.add(world, balls);
  }
}

/* ---------- Shake ---------- */

function shakeWorld() {
  if (!engine || !balls.length) return;

  const baseGx = engine.gravity.x || 0;
  const baseGy = engine.gravity.y || 1;

  const bursts = 14;
  let step = 0;

  const iv = setInterval(() => {
    const s = (step % 2 === 0) ? 1 : -1;
    engine.gravity.x = 0.38 * s;
    engine.gravity.y = baseGy + 0.10 * (Math.random() * 2 - 1);

    for (const b of balls) {
      if (!b || b.isStatic || (b.plugin && b.plugin.removed)) continue;
      const fx = (Math.random() * 0.020 - 0.010) * b.mass;
      const fy = (Math.random() * 0.015 - 0.020) * b.mass;
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }

    step++;
    if (step >= bursts) {
      clearInterval(iv);
      engine.gravity.x = baseGx;
      engine.gravity.y = baseGy;
    }
  }, 55);
}

/* ---------- Camera (FIXED clamp) ---------- */

function setupCamera() {
  Events.on(engine, "afterUpdate", () => {
    if (!render) return;

    const pr = (render.options.pixelRatio || 1);
    const viewW = canvas.width / pr;
    const viewH = canvas.height / pr;

    let targetY = WORLD.startY;
    let targetX = WORLD.width / 2;

    if (balls.length) {
      let leader = null;
      for (const b of balls) {
        if (!b || (b.plugin && b.plugin.removed)) continue;
        if (!leader || b.position.y > leader.position.y) leader = b;
      }
      if (leader) {
        targetY = leader.position.y;
        targetX = followLeaderEl.checked ? leader.position.x : WORLD.width / 2;
      }
    }

    if (finishers.length > 0 && followLeaderEl.checked) {
      const last = finishers[finishers.length - 1];
      if (last && last.y != null) targetY = Math.max(targetY, last.y);
    }

    const minX = 0, maxX = WORLD.width;
    const minY = 0, maxY = WORLD.height;

    const maxBX = Math.max(minX, maxX - viewW);
    const maxBY = Math.max(minY, maxY - viewH);

    const bx0 = clamp(targetX - viewW / 2, minX, maxBX);
    const by0 = clamp(targetY - viewH / 2, minY, maxBY);

    render.bounds.min.x = bx0;
    render.bounds.min.y = by0;
    render.bounds.max.x = bx0 + viewW;
    render.bounds.max.y = by0 + viewH;

    Render.lookAt(render, { min: render.bounds.min, max: render.bounds.max });
  });
}

/* ---------- Finishers UI / Removal ---------- */

function removeBallFromWorld_(b) {
  if (!b || (b.plugin && b.plugin.removed)) return;
  Composite.remove(engine.world, b);
  if (b.plugin) b.plugin.removed = true;
}

function updateTop5UI() {
  top5El.innerHTML = "";
  for (let i = 0; i < finishers.length; i++) {
    const f = finishers[i];
    const li = document.createElement("li");
    li.textContent = `#${f.idx} — ${f.name}`;
    top5El.appendChild(li);
  }
}

/* ---------- Confetti / Overlay ---------- */

function celebrateFinisher(ball, rank) {
  ball.render.fillStyle = "#ffd54a";
  bigWinText = { text: `#${ball.plugin.idx}`, untilMs: performance.now() + 1700 };
  spawnConfetti(ball.position.x, ball.position.y - 120, 160 + rank * 25);
}

function spawnConfetti(x, y, count) {
  for (let i = 0; i < count; i++) {
    confetti.push({
      x, y,
      vx: (Math.random() * 8 - 4),
      vy: (Math.random() * -10 - 3),
      life: 140 + Math.random() * 60,
      r: 2 + Math.random() * 3
    });
  }
}

function setupCustomOverlayDrawing() {
  Events.on(render, "afterRender", () => {
    const ctx = render.context;

    // Ball labels
    for (const b of balls) {
      if (!b || !b.plugin || b.plugin.removed) continue;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.fillStyle = "#0f0f12";
      ctx.font = "bold 11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(b.plugin.idx), 0, 0);
      ctx.restore();
    }

    // Confetti
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      p.vy += 0.22;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;

      ctx.save();
      ctx.globalAlpha = clamp(p.life / 120, 0, 1);
      const hue = Math.floor((i * 13) % 360);
      ctx.fillStyle = `hsl(${hue} 90% 60%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (p.life <= 0) confetti.splice(i, 1);
    }

    // Big winner overlay
    if (bigWinText && performance.now() < bigWinText.untilMs) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      ctx.fillStyle = "#fff";
      ctx.font = "900 140px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bigWinText.text, canvas.clientWidth / 2, canvas.clientHeight / 2);
      ctx.restore();
    } else if (bigWinText) {
      bigWinText = null;
    }
  });
}

/* ---------- Countdown / Music ---------- */

async function runCountdown() {
  countdownEl.classList.remove("hidden");
  const seq = ["3", "2", "1", "GO!"];
  for (const s of seq) {
    countdownEl.textContent = s;
    await new Promise(r => setTimeout(r, 850));
  }
  countdownEl.classList.add("hidden");
}

function tryPlayMusic() {
  const url = musicUrlEl.value.trim();
  if (url) music.src = url;

  if (!musicPlaying) {
    music.play().then(() => {
      musicPlaying = true;
      musicBtn.textContent = "Pause";
    }).catch(() => {
      setStatus("Music blocked by browser until user interaction. Click Play again.");
    });
  } else {
    music.pause();
    musicPlaying = false;
    musicBtn.textContent = "Play";
  }
}

/* ---------- UI wiring ---------- */

buildBtn.addEventListener("click", () => {
  const names = parseNames();
  if (!names.length) { setStatus("Add at least 1 participant name."); return; }
  buildCourse();
});

shakeBtn.addEventListener("click", () => {
  shakeWorld();
});

startBtn.addEventListener("click", async () => {
  if (!courseBuilt || isRunning) return;

  const names = parseNames();
  if (!names.length) { setStatus("Add at least 1 participant name."); return; }

  isRunning = true;
  setPanelRunning(true);

  finishers = [];
  updateTop5UI();
  confetti = [];
  bigWinText = null;

  setStatus(`Starting ${names.length} participants...`);
  await runCountdown();

  spawnBalls(names);
  setStatus("Drop started. First 5 finishers win!");
});

resetBtn.addEventListener("click", () => {
  clearWorld();
  boot();
});

musicBtn.addEventListener("click", () => {
  tryPlayMusic();
});

/* ---------- Boot ---------- */
resizeCanvasToCSS();
boot();
