const { Engine, Render, Runner, Bodies, Body, Composite, Events } = Matter;

const canvas = document.getElementById("c");
const namesEl = document.getElementById("names");
const buildBtn = document.getElementById("buildBtn");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const staggerEl = document.getElementById("stagger");
const followLeaderEl = document.getElementById("followLeader");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const top5El = document.getElementById("top5");
const musicUrlEl = document.getElementById("musicUrl");
const musicBtn = document.getElementById("musicBtn");
const shakeBtn = document.getElementById("shakeBtn");
const panelEl = document.getElementById("panel");

let engine, runner, render;
let balls = [];
let finishers = [];
let courseBuilt = false;
let resizeHandlerBound = false;
let running = false;

let finishSensor = null;

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

let twitchTimers = [];
let confetti = [];
let bigWinText = null;

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function hidePanel() {
  if (!panelEl) return;
  panelEl.classList.add("fadeout");
}

function showPanel() {
  if (!panelEl) return;
  panelEl.classList.remove("fadeout");
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

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function parseNames() {
  const lines = (namesEl?.value || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const names = lines.map((line, i) => {
    const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();
    return cleaned || `Player ${i + 1}`;
  });

  return names.slice(0, 55);
}

function initEngine() {
  engine = Engine.create();
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  engine.gravity.x = 0;
  engine.gravity.y = 1.0;

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
  running = false;
  finishSensor = null;

  for (const t of twitchTimers) clearInterval(t);
  twitchTimers = [];

  confetti = [];
  bigWinText = null;
  balls = [];
  finishers = [];
  courseBuilt = false;

  if (top5El) top5El.innerHTML = "";
  if (startBtn) startBtn.disabled = true;

  if (!engine) return;

  if (runner) Runner.stop(runner);
  if (render) Render.stop(render);

  Composite.clear(engine.world, false);
  Engine.clear(engine);
  engine = null;
  runner = null;
  render = null;
}

function boot() {
  showPanel();
  resizeCanvasToCSS();
  initEngine();
  setupCamera();
  setupFinishSensorDetection();
  setupCustomOverlayDrawing();
  setStatus("Paste names → Build Course → Start");
}

function addWalls() {
  const t = 80;
  const left = Bodies.rectangle(-t / 2, WORLD.height / 2, t, WORLD.height + 1000, {
    isStatic: true,
    render: { fillStyle: "#1b1b22" }
  });
  const right = Bodies.rectangle(WORLD.width + t / 2, WORLD.height / 2, t, WORLD.height + 1000, {
    isStatic: true,
    render: { fillStyle: "#1b1b22" }
  });
  Composite.add(engine.world, [left, right]);
}

function addSlope(x, y, w, h, deg, style = "#2a2a36") {
  const angle = (deg * Math.PI) / 180;
  const body = Bodies.rectangle(x, y, w, h, {
    isStatic: true,
    angle,
    render: { fillStyle: style }
  });
  Composite.add(engine.world, body);
  return body;
}

function addBumper(x, y, r = 18) {
  const b = Bodies.circle(x, y, r, {
    isStatic: true,
    render: { fillStyle: "#3a3a4a" }
  });
  Composite.add(engine.world, b);
  return b;
}

function addGateBottleneck(y, gapWidth = 170) {
  const plateLen = 520;
  const plateThk = 18;

  addSlope(WORLD.width / 2 - 260, y - 120, plateLen, plateThk, 30, "#2a2a36");
  addSlope(WORLD.width / 2 + 260, y - 120, plateLen, plateThk, -30, "#2a2a36");

  const wallThk = 30;
  const wallH = 260;
  const leftX = (WORLD.width - gapWidth) / 2 - wallThk / 2;
  const rightX = (WORLD.width + gapWidth) / 2 + wallThk / 2;

  const leftWall = Bodies.rectangle(leftX, y + 60, wallThk, wallH, {
    isStatic: true,
    render: { fillStyle: "#2a2a36" }
  });
  const rightWall = Bodies.rectangle(rightX, y + 60, wallThk, wallH, {
    isStatic: true,
    render: { fillStyle: "#2a2a36" }
  });

  Composite.add(engine.world, [leftWall, rightWall]);

  for (let i = 0; i < 7; i++) addBumper(170 + i * 130, y + 260, 14);
}

function addSpinner(x, y, radius = 85, spokeCount = 10) {
  const hub = Bodies.circle(x, y, radius, {
    isStatic: true,
    render: { fillStyle: "#1c1c28" }
  });

  const spokes = [];
  const spokeLen = radius * 2.8;
  const spokeThk = 22;

  for (let i = 0; i < spokeCount; i++) {
    const spoke = Bodies.rectangle(x, y, spokeLen, spokeThk, {
      isStatic: true,
      angle: (Math.PI * 2 * i) / spokeCount,
      render: { fillStyle: "#4a4a66" }
    });
    spokes.push(spoke);
  }

  Composite.add(engine.world, [hub, ...spokes]);
  return { hub, spokes };
}

function spinConstant(spinner, angularSpeed) {
  Events.on(engine, "beforeUpdate", () => {
    Body.rotate(spinner.hub, angularSpeed);
    for (const s of spinner.spokes) Body.rotate(s, angularSpeed);
  });
}

function twitchEvery(spinner, ms = 2000) {
  const t = setInterval(() => {
    const amt = (Math.random() * 0.9 + 0.25) * (Math.random() < 0.5 ? -1 : 1);
    Body.rotate(spinner.hub, amt);
    for (const s of spinner.spokes) Body.rotate(s, amt);
  }, ms);
  twitchTimers.push(t);
}

function addTwitchStick(x, y, w = 560, h = 18) {
  const stick = Bodies.rectangle(x, y, w, h, {
    isStatic: true,
    angle: 0,
    render: { fillStyle: "#40405a" }
  });
  Composite.add(engine.world, stick);

  const t = setInterval(() => {
    const a = (Math.random() * 1.25 + 0.55) * (Math.random() < 0.5 ? -1 : 1);
    Body.rotate(stick, a);
    setTimeout(() => Body.rotate(stick, -a * 0.95), 90);
  }, 1200);

  twitchTimers.push(t);
  return stick;
}

function buildCourse() {
  clearWorld();
  showPanel();
  resizeCanvasToCSS();
  initEngine();
  setupCamera();
  setupFinishSensorDetection();
  setupCustomOverlayDrawing();

  addWalls();

  // START CHUTE (fixes “balls don’t go down”)
  Composite.add(engine.world, [
    Bodies.rectangle(160, 320, 24, 380, { isStatic: true, render: { fillStyle: "#2a2a36" } }),
    Bodies.rectangle(940, 320, 24, 380, { isStatic: true, render: { fillStyle: "#2a2a36" } })
  ]);
  addSlope(560, 560, 920, 18, 45, "#2a2a36");
  addBumper(560, 720, 18);

  for (let y = 850; y <= 1700; y += 120) {
    for (let x = 180; x <= 920; x += 140) {
      addBumper(x + ((y / 120) % 2) * 40, y, 14);
    }
  }

  addSlope(560, 2100, 900, 18, 45);
  const s1 = addSpinner(520, 2500, 95, 7);
  spinConstant(s1, 0.06);

  addGateBottleneck(3000, 170);
  addTwitchStick(560, 3320, 560, 18);

  addSlope(540, 3800, 980, 18, 30);

  for (let i = 0; i < 8; i++) {
    addSlope(240 + i * 95, 4300 + i * 90, 180, 14, i % 2 === 0 ? 30 : -30, "#2d2d3d");
  }

  const s2 = addSpinner(300, 5200, 80, 6);
  spinConstant(s2, -0.07);
  const s3 = addSpinner(820, 5400, 90, 6);
  spinConstant(s3, 0.06);

  const s4 = addSpinner(560, 6000, 110, 8);
  spinConstant(s4, 0.03);
  twitchEvery(s4, 2000);

  addGateBottleneck(6800, 160);

  addSlope(560, 7300, 900, 18, -45);
  addSlope(560, 7700, 900, 18, 45);

  addTwitchStick(560, 8200, 560, 18);

  for (let y = 8600; y <= 9900; y += 120) {
    for (let x = 160; x <= 940; x += 130) addBumper(x + ((y / 120) % 2) * 35, y, 13);
  }

  addSlope(560, 10450, 980, 18, -30);

  addSlope(330, 11150, 700, 18, 35);
  addSlope(790, 11150, 700, 18, -35);

  finishSensor = Bodies.rectangle(WORLD.width / 2, WORLD.finishY, WORLD.width - 180, 28, {
    isStatic: true,
    isSensor: true,
    label: "finishSensor",
    render: { fillStyle: "#6a5acd" }
  });
  Composite.add(engine.world, finishSensor);

  courseBuilt = true;
  if (startBtn) startBtn.disabled = false;
  setStatus("Course built. Press Start.");
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
        restitution: 0.25,
        friction: 0.03,
        frictionAir: 0.018,
        render: { fillStyle: fill }
      }
    );

    b.label = "ball";
    b.plugin = { idx: i + 1, name: names[i], finished: false };
    balls.push(b);
  }

  if (staggerEl && staggerEl.checked) {
    let k = 0;
    const iv = setInterval(() => {
      if (!engine || !engine.world) {
        clearInterval(iv);
        return;
      }
      if (k >= balls.length) {
        clearInterval(iv);
        return;
      }
      Composite.add(world, balls[k]);
      k++;
    }, 120);
  } else {
    Composite.add(world, balls);
  }
}

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
        if (!leader || b.position.y > leader.position.y) leader = b;
      }
      if (leader) {
        targetY = leader.position.y;
        targetX = (followLeaderEl && followLeaderEl.checked) ? leader.position.x : WORLD.width / 2;
      }
    }

    if (finishers.length > 0 && followLeaderEl && followLeaderEl.checked) {
      targetY = Math.max(targetY, finishers[finishers.length - 1].position.y);
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

function setupFinishSensorDetection() {
  Events.on(engine, "collisionStart", (evt) => {
    if (!running) return;
    if (!evt || !evt.pairs) return;
    if (finishers.length >= 5) return;

    for (const pair of evt.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;

      const ball = (a.label === "ball") ? a : (b.label === "ball") ? b : null;
      const sensor = (a.label === "finishSensor") ? a : (b.label === "finishSensor") ? b : null;

      if (!ball || !sensor) continue;
      if (!ball.plugin || ball.plugin.finished) continue;

      ball.plugin.finished = true;
      finishers.push(ball);
      updateTop5UI();
      celebrateFinisher(ball, finishers.length);

      if (finishers.length === 5) {
        setStatus("Top 5 decided! See scoreboard.");
        running = false;
        setTimeout(() => showPanel(), 1200);
      }
    }
  });
}

function updateTop5UI() {
  if (!top5El) return;
  top5El.innerHTML = "";
  for (let i = 0; i < finishers.length; i++) {
    const b = finishers[i];
    const li = document.createElement("li");
    li.textContent = `#${b.plugin.idx} — ${b.plugin.name}`;
    top5El.appendChild(li);
  }
}

function celebrateFinisher(ball, rank) {
  ball.render.fillStyle = "#ffd54a";

  bigWinText = {
    text: `#${ball.plugin.idx}`,
    untilMs: performance.now() + 2200
  };

  spawnConfetti(ball.position.x, ball.position.y - 120, 180 + rank * 30);
}

function spawnConfetti(x, y, count) {
  for (let i = 0; i < count; i++) {
    confetti.push({
      x, y,
      vx: Math.random() * 8 - 4,
      vy: Math.random() * -10 - 3,
      life: 140 + Math.random() * 60,
      r: 2 + Math.random() * 3
    });
  }
}

function setupCustomOverlayDrawing() {
  Events.on(render, "afterRender", () => {
    const ctx = render.context;

    // Ball number labels
    for (const b of balls) {
      if (!b.plugin) continue;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.fillStyle = "#0f0f12";
      ctx.font = "bold 11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(b.plugin.idx), 0, 0);
      ctx.restore();
    }

    // Confetti update/draw
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
  if (!countdownEl) return;
  countdownEl.classList.remove("hidden");
  const seq = ["3", "2", "1", "GO!"];
  for (const s of seq) {
    countdownEl.textContent = s;
    await new Promise((r) => setTimeout(r, 900));
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
      setStatus("Music blocked by browser until user interaction. Click Play again.");
    });
  } else {
    music.pause();
    musicPlaying = false;
    if (musicBtn) musicBtn.textContent = "Play";
  }
}

function shakeWorld() {
  if (!engine || !balls.length) return;

  const baseGx = engine.gravity.x || 0;
  const baseGy = engine.gravity.y || 1;

  const bursts = 14;
  let step = 0;

  const iv = setInterval(() => {
    const s = (step % 2 === 0) ? 1 : -1;
    engine.gravity.x = 0.35 * s;
    engine.gravity.y = baseGy + 0.10 * (Math.random() * 2 - 1);

    for (const b of balls) {
      if (!b || b.isStatic) continue;
      const fx = (Math.random() * 0.020 - 0.010) * b.mass;
      const fy = (Math.random() * 0.016 - 0.022) * b.mass;
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }

    step++;
    if (step >= bursts) {
      clearInterval(iv);
      if (engine) {
        engine.gravity.x = baseGx;
        engine.gravity.y = baseGy;
      }
    }
  }, 55);
}

// --- UI wiring ---
if (buildBtn) {
  buildBtn.addEventListener("click", () => {
    const names = parseNames();
    if (!names.length) {
      setStatus("Add at least 1 participant name.");
      return;
    }
    buildCourse();
  });
}

if (shakeBtn) {
  shakeBtn.addEventListener("click", () => {
    shakeWorld();
  });
}

if (startBtn) {
  startBtn.addEventListener("click", async () => {
    if (!courseBuilt || running) return;

    const names = parseNames();
    if (!names.length) {
      setStatus("Add at least 1 participant name.");
      return;
    }

    finishers = [];
    confetti = [];
    bigWinText = null;
    updateTop5UI();

    setStatus(`Starting ${names.length} participants...`);
    await runCountdown();

    running = true;
    hidePanel();
    spawnBalls(names);

    setStatus("Drop started. First 5 finishers win!");
  });
}

if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    clearWorld();
    boot();
  });
}

if (musicBtn) {
  musicBtn.addEventListener("click", () => {
    tryPlayMusic();
  });
}

// Boot
resizeCanvasToCSS();
boot();
