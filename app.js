const { Engine, Render, Runner, Bodies, Body, Composite, Events } = Matter;

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

const WORLD = {
  width: 1100,
  height: 12000,
  margin: 80,
  startY: 180,
  finishY: 11500
};

let confetti = [];
let bigWinText = null;

// --- twitch bars controlled in beforeUpdate (no setInterval leaks)
let twitchBars = [];
let beforeUpdateHooked = false;

function setStatus(msg) { statusEl.textContent = msg; }

function setPanelRunning(on) {
  if (!panelEl) return;
  if (on) panelEl.classList.add("running");
  else panelEl.classList.remove("running");
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

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

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

const COURSE = {
  WALL_THICK: 80,
  PEG_R: 10,
  PEG_MARGIN_X: 80,
  PEG_TOP_Y: 140,
  PEG_ROWS: 14,
  PEG_COLS: 13,
  PEG_ROW_GAP: 86,

  DEFLECT_LEN_MIN: 90,
  DEFLECT_LEN_MAX: 170,
  DEFLECT_THICK: 16,
  DEFLECT_ANGLE_MIN: 0.40,
  DEFLECT_ANGLE_MAX: 1.00,
  DEFLECT_COUNT: 18,

  FINISH_H: 30
};

function rand_(a, b) { return a + Math.random() * (b - a); }
function clamp_(v, a, b) { return Math.max(a, Math.min(b, v)); }

function addWalls_(world, W, H) {
  const t = COURSE.WALL_THICK;

  const walls = [
    Bodies.rectangle(W / 2, -t / 2, W + t * 2, t, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(-t / 2, H / 2, t, H + t * 2, { isStatic: true, render: { fillStyle: "#1b1b22" } }),
    Bodies.rectangle(W + t / 2, H / 2, t, H + t * 2, { isStatic: true, render: { fillStyle: "#1b1b22" } })
  ];

  Composite.add(world, walls);
  return walls;
}

function addPegField_(world, W) {
  const pegs = [];
  const marginX = COURSE.PEG_MARGIN_X;

  const cols = COURSE.PEG_COLS;
  const usableW = Math.max(240, W - marginX * 2);
  const colGap = usableW / (cols - 1);

  const rows = COURSE.PEG_ROWS;
  const rowGap = COURSE.PEG_ROW_GAP;

  let y = COURSE.PEG_TOP_Y;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2 === 0) ? 0 : colGap / 2;
    for (let c = 0; c < cols; c++) {
      let x = marginX + c * colGap + offset;
      x = clamp_(x, COURSE.PEG_R + 26, W - COURSE.PEG_R - 26);

      const peg = Bodies.circle(x, y, COURSE.PEG_R, {
        isStatic: true,
        restitution: 0.2,
        friction: 0.25,
        render: { fillStyle: "#2a2f3a" }
      });
      pegs.push(peg);
    }
    y += rowGap;
  }

  Composite.add(world, pegs);
  return pegs;
}

function addEdgeKickers_(world, W, H) {
  // Forces edge lanes back inward over the full course.
  const thk = 18;
  const len = 360;
  const inset = 110;

  const y0 = 700;
  const y1 = H - 1400;
  const step = 700;

  let flip = false;
  for (let y = y0; y <= y1; y += step) {
    const leftAngle = (flip ? 44 : 36) * Math.PI / 180;
    const rightAngle = (flip ? -44 : -36) * Math.PI / 180;

    const left = Bodies.rectangle(inset, y, len, thk, {
      isStatic: true,
      angle: leftAngle,
      friction: 0.5,
      restitution: 0.05,
      render: { fillStyle: "#242432" }
    });

    const right = Bodies.rectangle(W - inset, y + step / 2, len, thk, {
      isStatic: true,
      angle: rightAngle,
      friction: 0.5,
      restitution: 0.05,
      render: { fillStyle: "#242432" }
    });

    Composite.add(world, [left, right]);
    flip = !flip;
  }
}

function addShortDeflectors_(world, W, H) {
  const deflectors = [];
  const top = 900;
  const bottom = H - 1600;

  for (let i = 0; i < COURSE.DEFLECT_COUNT; i++) {
    const len = rand_(COURSE.DEFLECT_LEN_MIN, COURSE.DEFLECT_LEN_MAX);
    const thick = COURSE.DEFLECT_THICK;

    const x = rand_(140, W - 140);
    const y = rand_(top, bottom);

    const sign = Math.random() < 0.5 ? -1 : 1;
    const angle = sign * rand_(COURSE.DEFLECT_ANGLE_MIN, COURSE.DEFLECT_ANGLE_MAX);

    const bar = Bodies.rectangle(x, y, len, thick, {
      isStatic: true,
      angle,
      restitution: 0.05,
      friction: 0.55,
      render: { fillStyle: "#1d2230" }
    });

    deflectors.push(bar);
  }

  Composite.add(world, deflectors);
  return deflectors;
}

function addSpinnerInPath_(world, W) {
  const cx = W * 0.5;
  const cy = 1900;

  const hubR = 32;
  const spokeLen = 230;
  const spokeThick = 18;
  const spokeCount = 6;

  const hub = Bodies.circle(cx, cy, hubR, {
    frictionAir: 0.02,
    render: { fillStyle: "#2a2f3a" }
  });

  const parts = [hub];
  for (let i = 0; i < spokeCount; i++) {
    const a = (Math.PI * 2 * i) / spokeCount;
    const spoke = Bodies.rectangle(cx, cy, spokeLen, spokeThick, {
      angle: a,
      render: { fillStyle: "#2a2f3a" }
    });
    parts.push(spoke);
  }

  const spinner = Body.create({ parts, frictionAir: 0.02 });
  Body.setAngularVelocity(spinner, 0.12);

  const pin = Matter.Constraint.create({
    pointA: { x: cx, y: cy },
    bodyB: spinner,
    pointB: { x: 0, y: 0 },
    stiffness: 1,
    length: 0
  });

  Composite.add(world, [spinner, pin]);
  return spinner;
}

function addFinishSensorAtY_(world, W, finishY) {
  const sensor = Bodies.rectangle(W / 2, finishY, W - 160, COURSE.FINISH_H, {
    isStatic: true,
    isSensor: true,
    label: "finishSensor",
    render: { fillStyle: "rgba(120,100,255,0.35)" }
  });

  const floor = Bodies.rectangle(W / 2, WORLD.height + 200, W + 400, 80, {
    isStatic: true,
    render: { visible: false }
  });

  Composite.add(world, [sensor, floor]);

  Events.off(engine, "collisionStart", onFinishCollision_);
  Events.on(engine, "collisionStart", onFinishCollision_);

  return sensor;
}

function onFinishCollision_(evt) {
  for (const pair of evt.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;

    const ball = (a.label === "ball") ? a : (b.label === "ball") ? b : null;
    const hitSensor = (a.label === "finishSensor" || b.label === "finishSensor");
    if (!ball || !hitSensor) continue;

    if (!ball.plugin || ball.plugin.finished || ball.plugin.removed) continue;

    ball.plugin.finished = true;

    if (finishers.length < 10) {
      finishers.push({ idx: ball.plugin.idx, name: ball.plugin.name, y: ball.position.y });
      celebrateFinisher(ball, finishers.length);
      if (finishers.length === 10) setStatus("Top 10 decided!");
    }

    setTimeout(() => removeBallFromWorld_(ball), 250);
  }
}

function addTwitchBars_(world, W, H) {
  // 3 bars on left 1/3, 3 bars on right 1/3
  // They “flick” by oscillating angle each frame (beforeUpdate).
  twitchBars = [];

  const leftX = W * 0.22;
  const rightX = W * 0.78;

  const ys = [
    H * 0.28,
    H * 0.48,
    H * 0.68
  ];

  const thk = 18;
  const len = 520;

  function makeBar(x, y, baseDeg, ampDeg, speed) {
    const base = baseDeg * Math.PI / 180;
    const amp = ampDeg * Math.PI / 180;

    const bar = Bodies.rectangle(x, y, len, thk, {
      isStatic: true,
      angle: base,
      friction: 0.65,
      restitution: 0.05,
      render: { fillStyle: "#40405a" }
    });

    bar._twitch = {
      base,
      amp,
      speed,
      phase: rand_(0, Math.PI * 2)
    };

    twitchBars.push(bar);
    return bar;
  }

  for (let i = 0; i < ys.length; i++) {
    makeBar(leftX, ys[i], 18 + i * 4, 22 + i * 3, 0.055 + i * 0.01);
    makeBar(rightX, ys[i] + 180, -18 - i * 4, 22 + i * 3, 0.06 + i * 0.01);
  }

  Composite.add(world, twitchBars);
}

function hookBeforeUpdateOnce_() {
  if (beforeUpdateHooked) return;
  beforeUpdateHooked = true;

  Events.on(engine, "beforeUpdate", () => {
    const t = engine.timing.timestamp || performance.now();

    for (const bar of twitchBars) {
      if (!bar || !bar._twitch) continue;
      const tw = bar._twitch;

      // “Flick” feel: sin + a tiny extra harmonic
      const s1 = Math.sin(tw.phase + t * tw.speed);
      const s2 = Math.sin(tw.phase * 0.7 + t * (tw.speed * 1.9)) * 0.35;

      const ang = tw.base + (s1 + s2) * tw.amp;
      Body.setAngle(bar, ang);
    }
  });
}

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

  hookBeforeUpdateOnce_();
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
  twitchBars = [];
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
  setupLiveBoard();
  setStatus("Paste names → Build Course → Start");
}

function buildCourseFixed_() {
  const world = engine.world;
  const W = WORLD.width;
  const H = WORLD.height;

  Composite.clear(world, false);

  addWalls_(world, W, H);
  addPegField_(world, W);
  addEdgeKickers_(world, W, H);
  addShortDeflectors_(world, W, H);
  addTwitchBars_(world, W, H);
  addSpinnerInPath_(world, W);
  addFinishSensorAtY_(world, W, WORLD.finishY);

  engine.gravity.y = 1.0;
  engine.gravity.x = 0.0;

  courseBuilt = true;
  startBtn.disabled = false;
  setStatus("Course built. Click Start.");
}

function buildCourse() {
  buildCourseFixed_();
}

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
        friction: 0.03,
        frictionAir: 0.018,
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

function removeBallFromWorld_(b) {
  if (!b || (b.plugin && b.plugin.removed)) return;
  Composite.remove(engine.world, b);
  if (b.plugin) b.plugin.removed = true;
}

/* --- SHAKE (manual unstuck) --- */
function shakeWorld() {
  if (!engine || !balls.length) return;

  const baseGx = engine.gravity.x || 0;
  const baseGy = engine.gravity.y || 1;

  const bursts = 14;
  let step = 0;

  const iv = setInterval(() => {
    const s = (step % 2 === 0) ? 1 : -1;
    engine.gravity.x = 0.40 * s;
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

/* --- CAMERA --- */
function setupCamera() {
  Events.on(engine, "afterUpdate", () => {
    if (!render) return;

    const viewW = canvas.width / (render.options.pixelRatio || 1);
    const viewH = canvas.height / (render.options.pixelRatio || 1);

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

    const minX = 0, maxX = WORLD.width;
    const minY = 0, maxY = WORLD.height;

    const bx0 = clamp(targetX - viewW / 2, minX, maxX - viewW);
    const by0 = clamp(targetY - viewH / 2, minY, maxY - viewH);

    render.bounds.min.x = bx0;
    render.bounds.min.y = by0;
    render.bounds.max.x = bx0 + viewW;
    render.bounds.max.y = by0 + viewH;

    Render.lookAt(render, { min: render.bounds.min, max: render.bounds.max });
  });
}

/* --- LIVE BOARD (TOP 10 by position) --- */
function setupLiveBoard() {
  Events.on(engine, "afterUpdate", () => {
    updateLiveBoard_();
  });
}

function updateLiveBoard_() {
  if (!top5El) return;

  const active = [];
  for (const b of balls) {
    if (!b || !b.plugin || b.plugin.removed) continue;
    if (b.plugin.finished) continue; // finished handled separately
    active.push(b);
  }

  active.sort((a, b) => b.position.y - a.position.y);

  const topLive = active.slice(0, 10);

  const finishedList = finishers.slice(0, 10);

  let html = "";
  html += `<li style="opacity:.9;font-weight:700;margin-bottom:6px;">Live Top 10 (by position)</li>`;
  if (!topLive.length) {
    html += `<li style="opacity:.7;">(waiting for balls...)</li>`;
  } else {
    for (let i = 0; i < topLive.length; i++) {
      const b = topLive[i];
      html += `<li>#${b.plugin.idx} — ${escapeHtml_(b.plugin.name)} <span style="opacity:.7;">(P${i + 1})</span></li>`;
    }
  }

  html += `<li style="list-style:none;height:10px;"></li>`;
  html += `<li style="opacity:.9;font-weight:700;margin-bottom:6px;">Finish Order</li>`;
  if (!finishedList.length) {
    html += `<li style="opacity:.7;">(no finishers yet)</li>`;
  } else {
    for (let i = 0; i < finishedList.length; i++) {
      const f = finishedList[i];
      html += `<li>${i + 1}. #${f.idx} — ${escapeHtml_(f.name)}</li>`;
    }
  }

  top5El.innerHTML = html;
}

function escapeHtml_(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* --- CONFETTI / OVERLAY --- */
function celebrateFinisher(ball, rank) {
  ball.render.fillStyle = "#ffd54a";
  bigWinText = { text: `#${ball.plugin.idx}`, untilMs: performance.now() + 1700 };
  spawnConfetti(ball.position.x, ball.position.y - 120, 140 + rank * 18);
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

    // Ball labels (bigger + stroke so you can read it)
    for (const b of balls) {
      if (!b || !b.plugin || b.plugin.removed) continue;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);

      const txt = String(b.plugin.idx);
      ctx.font = "900 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(txt, 0, 0);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(txt, 0, 0);

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

/* --- UI wiring --- */
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
  confetti = [];
  bigWinText = null;

  setStatus(`Starting ${names.length} participants...`);
  await runCountdown();

  spawnBalls(names);
  setStatus("Drop started. First 10 finishers recorded!");
});

resetBtn.addEventListener("click", () => {
  clearWorld();
  boot();
});

musicBtn.addEventListener("click", () => {
  tryPlayMusic();
});

/* --- Boot --- */
resizeCanvasToCSS();
boot();
