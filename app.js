/* Ball Drop Raffle — FIXED (no edge free-falls, single finish system, world-size course)
   Requires: Matter.js loaded, and these elements exist:
   #c, #ui, #names, #buildBtn, #startBtn, #resetBtn, #shakeBtn,
   #stagger, #followLeader, #status, #countdown, #top5, #musicUrl, #musicBtn
*/

const {
  Engine,
  Render,
  Runner,
  Bodies,
  Body,
  Composite,
  Events,
  World,
  Constraint
} = Matter;

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

const WORLD_CFG = {
  width: 1100,
  height: 12000,
  margin: 80,
  startY: 180,
  finishY: 11500
};

const COURSE = {
  wallThick: 80,

  // PEGS: fill the ENTIRE height (fixes empty edge/straight-fall lanes)
  pegR: 10,
  pegMarginX: 70,          // tighter to cover edges
  pegTopY: 140,
  pegBottomPad: 420,       // stop before finish zone
  pegRowsGap: 120,         // vertical spacing between peg rows
  pegCols: 13,             // more columns => better width coverage

  // Edge kickers: deterministic inward ramps along BOTH sides
  edgeKickerInset: 95,
  edgeKickerLen: 420,
  edgeKickerThick: 18,
  edgeKickerStep: 520,
  edgeKickerAngleA: 38,
  edgeKickerAngleB: 46,

  // Mid deflectors (short, angled): extra randomness
  deflectCount: 22,
  deflectLenMin: 90,
  deflectLenMax: 150,
  deflectThick: 16,
  deflectAngleMin: 0.40, // rad
  deflectAngleMax: 0.95, // rad
  deflectEdgePad: 140,

  // Spinner
  spinnerY: 2100,
  spinnerHubR: 34,
  spinnerSpokeLen: 220,
  spinnerSpokeThick: 18,
  spinnerSpokeCount: 6,
  spinnerOmega: 0.12,

  // Finish sensor
  finishWPad: 180,
  finishH: 30,

  // Ball
  ballR: 13,
};

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function setPanelRunning(on) {
  if (!panelEl) return;
  if (on) panelEl.classList.add("running");
  else panelEl.classList.remove("running");
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

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
  const lines = (namesEl?.value || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const names = lines.map((line, i) => {
    const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();
    return cleaned || `Player ${i + 1}`;
  });

  return names.slice(0, 55);
}

/* =========================
   ENGINE / WORLD LIFECYCLE
========================= */

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
    Composite.clear(engine.world, false);
    Engine.clear(engine);
  }

  balls = [];
  finishers = [];
  confetti = [];
  bigWinText = null;

  courseBuilt = false;
  isRunning = false;

  if (top5El) top5El.innerHTML = "";
  if (startBtn) startBtn.disabled = true;

  setPanelRunning(false);
}

function boot() {
  resizeCanvasToCSS();
  initEngine();
  setupCamera();
  setupFinishCollision();
  setupCustomOverlayDrawing();
  setStatus("Paste names → Build Course → Start");
}

/* =========================
   COURSE BUILDING (FIXED)
========================= */

function addWalls_(world) {
  const W = WORLD_CFG.width;
  const H = WORLD_CFG.height;
  const t = COURSE.wallThick;

  const walls = [
    Bodies.rectangle(W / 2, -t / 2, W + t * 2, t, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(-t / 2, H / 2, t, H + t * 2, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(W + t / 2, H / 2, t, H + t * 2, { isStatic: true, render: { visible: false } })
  ];

  World.add(world, walls);
  return walls;
}

function addPegFieldFull_(world) {
  const W = WORLD_CFG.width;
  const topY = COURSE.pegTopY;
  const bottomY = WORLD_CFG.finishY - COURSE.pegBottomPad;

  const cols = COURSE.pegCols;
  const marginX = COURSE.pegMarginX;

  const usableW = Math.max(200, W - marginX * 2);
  const colGap = usableW / (cols - 1);

  const pegs = [];
  let row = 0;

  for (let y = topY; y <= bottomY; y += COURSE.pegRowsGap) {
    const offset = (row % 2 === 0) ? 0 : colGap / 2;

    for (let c = 0; c < cols; c++) {
      let x = marginX + c * colGap + offset;
      x = clamp(x, COURSE.pegR + 18, W - COURSE.pegR - 18);

      // EXTRA: if we’re near extreme edges, add a second peg slightly inward
      // (prevents clean vertical lanes at the margins)
      const isEdgeCol = (c === 0 || c === cols - 1);

      const peg = Bodies.circle(x, y, COURSE.pegR, {
        isStatic: true,
        restitution: 0.15,
        friction: 0.25,
        render: { fillStyle: "#2a2f3a" }
      });
      pegs.push(peg);

      if (isEdgeCol) {
        const x2 = (c === 0) ? x + 36 : x - 36;
        const peg2 = Bodies.circle(x2, y + COURSE.pegRowsGap * 0.35, COURSE.pegR, {
          isStatic: true,
          restitution: 0.15,
          friction: 0.25,
          render: { fillStyle: "#2a2f3a" }
        });
        pegs.push(peg2);
      }
    }

    row++;
  }

  World.add(world, pegs);
  return pegs;
}

function addEdgeKickers_(world) {
  const W = WORLD_CFG.width;
  const y0 = COURSE.pegTopY + 240;
  const y1 = WORLD_CFG.finishY - 900;

  const inset = COURSE.edgeKickerInset;
  const len = COURSE.edgeKickerLen;
  const thk = COURSE.edgeKickerThick;

  let flip = false;
  const kickers = [];

  for (let y = y0; y <= y1; y += COURSE.edgeKickerStep) {
    const degL = flip ? COURSE.edgeKickerAngleB : COURSE.edgeKickerAngleA;
    const degR = flip ? -COURSE.edgeKickerAngleB : -COURSE.edgeKickerAngleA;

    // left kicker (slants down-right)
    const left = Bodies.rectangle(inset, y, len, thk, {
      isStatic: true,
      angle: (degL * Math.PI) / 180,
      restitution: 0.05,
      friction: 0.50,
      render: { fillStyle: "#202434" }
    });

    // right kicker (slants down-left)
    const right = Bodies.rectangle(W - inset, y + COURSE.edgeKickerStep / 2, len, thk, {
      isStatic: true,
      angle: (degR * Math.PI) / 180,
      restitution: 0.05,
      friction: 0.50,
      render: { fillStyle: "#202434" }
    });

    kickers.push(left, right);
    flip = !flip;
  }

  World.add(world, kickers);
  return kickers;
}

function addShortDeflectors_(world) {
  const W = WORLD_CFG.width;
  const top = COURSE.pegTopY + 600;
  const bottom = WORLD_CFG.finishY - 600;

  const deflectors = [];
  for (let i = 0; i < COURSE.deflectCount; i++) {
    const len = rand(COURSE.deflectLenMin, COURSE.deflectLenMax);
    const x = rand(COURSE.deflectEdgePad, W - COURSE.deflectEdgePad);
    const y = rand(top, bottom);

    const sign = Math.random() < 0.5 ? -1 : 1;
    const angle = sign * rand(COURSE.deflectAngleMin, COURSE.deflectAngleMax);

    const bar = Bodies.rectangle(x, y, len, COURSE.deflectThick, {
      isStatic: true,
      angle,
      restitution: 0.05,
      friction: 0.45,
      render: { fillStyle: "#1d2230" }
    });

    deflectors.push(bar);
  }

  World.add(world, deflectors);
  return deflectors;
}

function addSpinnerInPath_(world) {
  const cx = WORLD_CFG.width * 0.5;
  const cy = COURSE.spinnerY;

  const hub = Bodies.circle(cx, cy, COURSE.spinnerHubR, {
    frictionAir: 0.02,
    render: { fillStyle: "#2a2f3a" }
  });

  const parts = [hub];
  for (let i = 0; i < COURSE.spinnerSpokeCount; i++) {
    const a = (Math.PI * 2 * i) / COURSE.spinnerSpokeCount;
    const spoke = Bodies.rectangle(cx, cy, COURSE.spinnerSpokeLen, COURSE.spinnerSpokeThick, {
      angle: a,
      render: { fillStyle: "#2a2f3a" }
    });
    parts.push(spoke);
  }

  const spinner = Body.create({ parts, frictionAir: 0.02 });
  Body.setAngularVelocity(spinner, COURSE.spinnerOmega);

  const pin = Constraint.create({
    pointA: { x: cx, y: cy },
    bodyB: spinner,
    pointB: { x: 0, y: 0 },
    stiffness: 1,
    length: 0
  });

  World.add(world, [spinner, pin]);
  return spinner;
}

function addFinishSensor_(world) {
  const W = WORLD_CFG.width;
  const y = WORLD_CFG.finishY;

  const sensor = Bodies.rectangle(W / 2, y, W - COURSE.finishWPad, COURSE.finishH, {
    isStatic: true,
    isSensor: true,
    label: "finishSensor",
    render: { fillStyle: "rgba(120,100,255,0.35)" }
  });

  // hidden floor under everything
  const floor = Bodies.rectangle(W / 2, WORLD_CFG.height + 220, W + 600, 100, {
    isStatic: true,
    render: { visible: false }
  });

  World.add(world, [sensor, floor]);
  return sensor;
}

function buildCourse() {
  const world = engine.world;

  // Clear only bodies/constraints; keep engine running + render/camera hooks
  Composite.clear(world, false);

  // Course
  addWalls_(world);
  addPegFieldFull_(world);     // ✅ fills whole course height
  addEdgeKickers_(world);      // ✅ deterministic edge anti-freefall
  addShortDeflectors_(world);  // extra chaos
  addSpinnerInPath_(world);    // spinner in real path
  addFinishSensor_(world);     // ✅ single finish system

  engine.gravity.y = 1.0;
  engine.gravity.x = 0.0004;   // tiny drift to break perfect stacks

  courseBuilt = true;
  isRunning = false;
  if (startBtn) startBtn.disabled = false;

  finishers = [];
  updateTop5UI();
  confetti = [];
  bigWinText = null;

  setStatus("Course built. Click Start.");
}

/* =========================
   BALLS
========================= */

function spawnBalls(names) {
  const world = engine.world;
  balls = [];

  const startX = WORLD_CFG.width / 2;
  const startY = WORLD_CFG.startY;

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
      COURSE.ballR,
      {
        label: "ball",
        restitution: 0.25,
        friction: 0.03,
        frictionAir: 0.018,
        render: { fillStyle: fill }
      }
    );

    b.plugin = { idx: i + 1, name: names[i], finished: false, removed: false };
    balls.push(b);
  }

  if (staggerEl?.checked) {
    let k = 0;
    const iv = setInterval(() => {
      if (k >= balls.length) { clearInterval(iv); return; }
      World.add(world, balls[k]);
      k++;
    }, 110);
  } else {
    World.add(world, balls);
  }
}

function removeBallFromWorld_(b) {
  if (!b || (b.plugin && b.plugin.removed)) return;
  World.remove(engine.world, b);
  if (b.plugin) b.plugin.removed = true;
}

/* =========================
   FINISH (SINGLE SYSTEM)
   - Uses ONLY sensor collisions.
   - Removes balls immediately to prevent pileups.
========================= */

function setupFinishCollision() {
  // make sure we don’t stack multiple handlers
  Events.off(engine, "collisionStart", onFinishCollision_);
  Events.on(engine, "collisionStart", onFinishCollision_);
}

function onFinishCollision_(evt) {
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

    // remove so it can’t keep colliding
    setTimeout(() => removeBallFromWorld_(ball), 80);
  }
}

/* =========================
   UI / SCOREBOARD
========================= */

function updateTop5UI() {
  if (!top5El) return;
  top5El.innerHTML = "";
  for (let i = 0; i < finishers.length; i++) {
    const f = finishers[i];
    const li = document.createElement("li");
    li.textContent = `#${f.idx} — ${f.name}`;
    top5El.appendChild(li);
  }
}

/* =========================
   SHAKE (unstuck)
========================= */

function shakeWorld() {
  if (!engine || !balls.length) return;

  const baseGx = engine.gravity.x || 0;
  const baseGy = engine.gravity.y || 1;

  const bursts = 14;
  let step = 0;

  const iv = setInterval(() => {
    const s = (step % 2 === 0) ? 1 : -1;
    engine.gravity.x = 0.45 * s;
    engine.gravity.y = baseGy + 0.12 * (Math.random() * 2 - 1);

    for (const b of balls) {
      if (!b || b.isStatic || (b.plugin && b.plugin.removed)) continue;
      const fx = (Math.random() * 0.022 - 0.011) * b.mass;
      const fy = (Math.random() * 0.016 - 0.024) * b.mass;
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

/* =========================
   CAMERA
========================= */

function setupCamera() {
  Events.on(engine, "afterUpdate", () => {
    if (!render) return;

    const pr = render.options.pixelRatio || 1;
    const viewW = canvas.width / pr;
    const viewH = canvas.height / pr;

    let targetY = WORLD_CFG.startY;
    let targetX = WORLD_CFG.width / 2;

    // leader = greatest y among active balls
    if (balls.length) {
      let leader = null;
      for (const b of balls) {
        if (!b || (b.plugin && b.plugin.removed)) continue;
        if (!leader || b.position.y > leader.position.y) leader = b;
      }
      if (leader) {
        targetY = leader.position.y;
        targetX = (followLeaderEl?.checked) ? leader.position.x : WORLD_CFG.width / 2;
      }
    }

    // keep view inside world bounds
    const minX = 0, maxX = WORLD_CFG.width;
    const minY = 0, maxY = WORLD_CFG.height;

    const bx0 = clamp(targetX - viewW / 2, minX, maxX - viewW);
    const by0 = clamp(targetY - viewH / 2, minY, maxY - viewH);

    render.bounds.min.x = bx0;
    render.bounds.min.y = by0;
    render.bounds.max.x = bx0 + viewW;
    render.bounds.max.y = by0 + viewH;

    Render.lookAt(render, { min: render.bounds.min, max: render.bounds.max });
  });
}

/* =========================
   CONFETTI / OVERLAY
========================= */

function celebrateFinisher(ball, rank) {
  if (ball?.render) ball.render.fillStyle = "#ffd54a";
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

/* =========================
   COUNTDOWN + MUSIC
========================= */

async function runCountdown() {
  if (!countdownEl) return;
  countdownEl.classList.remove("hidden");
  const seq = ["3", "2", "1", "GO!"];
  for (const s of seq) {
    countdownEl.textContent = s;
    await new Promise(r => setTimeout(r, 850));
  }
  countdownEl.classList.add("hidden");
}

function tryPlayMusic() {
  const url = (musicUrlEl?.value || "").trim();
  if (url) music.src = url;

  if (!musicPlaying) {
    music.play().then(() => {
      musicPlaying = true;
      if (musicBtn) musicBtn.textContent = "Pause";
    }).catch(() => {
      setStatus("Music blocked until user interaction. Click Play again.");
    });
  } else {
    music.pause();
    musicPlaying = false;
    if (musicBtn) musicBtn.textContent = "Play";
  }
}

/* =========================
   UI WIRING
========================= */

buildBtn?.addEventListener("click", () => {
  const names = parseNames();
  if (!names.length) { setStatus("Add at least 1 participant name."); return; }
  buildCourse();
});

shakeBtn?.addEventListener("click", () => {
  shakeWorld();
});

startBtn?.addEventListener("click", async () => {
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

resetBtn?.addEventListener("click", () => {
  clearWorld();
  boot();
});

musicBtn?.addEventListener("click", () => {
  tryPlayMusic();
});

/* =========================
   BOOT
========================= */

resizeCanvasToCSS();
boot();

// Optional: auto-build once on load so you immediately see obstacles.
// buildCourse();
