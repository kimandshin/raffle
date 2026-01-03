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

let twitchTimers = [];
let confetti = [];
let bigWinText = null;

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

function initEngine() {
  engine = Engine.create();
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
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

  for (const t of twitchTimers) clearInterval(t);
  twitchTimers = [];

  top5El.innerHTML = "";
  startBtn.disabled = true;

  setPanelRunning(false);
}

function boot() {
  resizeCanvasToCSS();
  initEngine();
  setupCamera();
  setupFinisherDetection();
  setupCustomOverlayDrawing();
  setStatus("Paste names → Build Course → Start");
}

function addWalls() {
  const t = 80;
  const left = Bodies.rectangle(-t / 2, WORLD.height / 2, t, WORLD.height + 2000, {
    isStatic: true,
    render: { fillStyle: "#1b1b22" }
  });
  const right = Bodies.rectangle(WORLD.width + t / 2, WORLD.height / 2, t, WORLD.height + 2000, {
    isStatic: true,
    render: { fillStyle: "#1b1b22" }
  });
  Composite.add(engine.world, [left, right]);
}

function addSlope(x, y, w, h, deg, style = "#2a2a36") {
  const angle = deg * Math.PI / 180;
  const body = Bodies.rectangle(x, y, w, h, {
    isStatic: true,
    angle,
    render: { fillStyle: style }
  });
  Composite.add(engine.world, body);
  return body;
}

function addBumper(x, y, r = 18, style = "#3a3a4a") {
  const b = Bodies.circle(x, y, r, {
    isStatic: true,
    render: { fillStyle: style }
  });
  Composite.add(engine.world, b);
  return b;
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

function addGateBottleneck(y, gapWidth = 170) {
  const plateLen = 520;
  const plateThk = 18;

  addSlope((WORLD.width / 2) - 260, y - 120, plateLen, plateThk, 30, "#2a2a36");
  addSlope((WORLD.width / 2) + 260, y - 120, plateLen, plateThk, -30, "#2a2a36");

  const wallThk = 30;
  const wallH = 260;
  const leftX = (WORLD.width - gapWidth) / 2 - wallThk / 2;
  const rightX = (WORLD.width + gapWidth) / 2 + wallThk / 2;

  const leftWall = Bodies.rectangle(leftX, y + 60, wallThk, wallH, {
    isStatic: true, render: { fillStyle: "#2a2a36" }
  });
  const rightWall = Bodies.rectangle(rightX, y + 60, wallThk, wallH, {
    isStatic: true, render: { fillStyle: "#2a2a36" }
  });

  Composite.add(engine.world, [leftWall, rightWall]);

  for (let i = 0; i < 7; i++) addBumper(170 + i * 130, y + 260, 14);
}

/* --- FIX: Edge lanes get obstacles + inward “kickers” so nobody free-falls --- */
function addEdgeKickers(y0, y1, step = 650) {
  const thk = 18;
  const len = 360;
  const inset = 110;

  let flip = false;
  for (let y = y0; y <= y1; y += step) {
    // left side kicks inward (down-right)
    addSlope(inset, y, len, thk, flip ? 42 : 35, "#242432");
    // right side kicks inward (down-left)
    addSlope(WORLD.width - inset, y + step / 2, len, thk, flip ? -42 : -35, "#242432");
    flip = !flip;
  }
}

function addPegField(y0, y1, x0, x1, dx, dy, r) {
  let row = 0;
  for (let y = y0; y <= y1; y += dy) {
    const offset = (row % 2) ? dx / 2 : 0;
    for (let x = x0; x <= x1; x += dx) {
      addBumper(x + offset, y, r);
    }
    row++;
  }
}

function buildCourse() {
  clearWorld();
  resizeCanvasToCSS();
  initEngine();
  setupCamera();
  setupFinisherDetection();
  setupCustomOverlayDrawing();

  addWalls();

  /* --- START SECTION (FIX: no V-bowl trap) --- */
  // A narrow chute so everything enters the obstacle field, not the edges.
  const chuteW = 520;
  const wallThk = 26;
  const chuteLeft = (WORLD.width - chuteW) / 2;
  const chuteRight = (WORLD.width + chuteW) / 2;

  Composite.add(engine.world, [
    Bodies.rectangle(chuteLeft - wallThk / 2, 420, wallThk, 640, { isStatic: true, render: { fillStyle: "#2a2a36" } }),
    Bodies.rectangle(chuteRight + wallThk / 2, 420, wallThk, 640, { isStatic: true, render: { fillStyle: "#2a2a36" } })
  ]);

  // One strong ramp + a small kicker peg
  addSlope(WORLD.width / 2, 640, 720, 18, 38, "#2a2a36");
  addBumper(WORLD.width / 2 + 90, 770, 16);

  /* --- FIX: prevent edge free-fall everywhere --- */
  addEdgeKickers(1100, 10200, 720);

  // Wide peg field (covers almost full width)
  addPegField(
    980, 2300,
    WORLD.margin + 90, WORLD.width - WORLD.margin - 90,
    130, 150, 13
  );

  // 45° long slide + spinner
  addSlope(560, 2600, 900, 18, 45);
  const s1 = addSpinner(520, 3000, 95, 7);
  spinConstant(s1, 0.06);

  // More pegs (again, wide)
  addPegField(
    3300, 4700,
    WORLD.margin + 80, WORLD.width - WORLD.margin - 80,
    140, 160, 12
  );

  // Bottleneck #1
  addGateBottleneck(5200, 170);
  addTwitchStick(560, 5600, 560, 18);

  // 30° slow drama
  addSlope(540, 6100, 980, 18, 30);

  // Separators across width (not just center)
  for (let i = 0; i < 10; i++) {
    const x = WORLD.margin + 140 + i * 95;
    const y = 6650 + i * 95;
    addSlope(x, y, 220, 14, i % 2 === 0 ? 30 : -30, "#2d2d3d");
  }

  // Spinner field spread (left/center/right)
  const s2 = addSpinner(260, 7700, 85, 6);
  spinConstant(s2, -0.07);
  const s3 = addSpinner(560, 7900, 95, 6);
  spinConstant(s3, 0.06);
  const s4 = addSpinner(860, 7700, 85, 6);
  spinConstant(s4, 0.07);
  twitchEvery(s3, 1900);

  // Bottleneck #2
  addGateBottleneck(8800, 160);
  addTwitchStick(560, 9300, 560, 18);

  // Chaos canyon (FULL WIDTH)
  addPegField(
    9600, 10850,
    WORLD.margin + 70, WORLD.width - WORLD.margin - 70,
    120, 135, 12
  );

  // Final redirect slopes (push toward center, no “catch tray”)
  addSlope(320, 11180, 680, 18, 35);
  addSlope(780, 11180, 680, 18, -35);

  // --- FINISH SENSOR (FIX: it must NEVER catch balls) ---
  const finishSensor = Bodies.rectangle(WORLD.width / 2, WORLD.finishY, WORLD.width - 160, 16, {
    isStatic: true,
    isSensor: true,
    collisionFilter: { category: 0x0002, mask: 0x0000 },
    render: { fillStyle: "#6a5acd" }
  });
  Composite.add(engine.world, finishSensor);

  // A “drain” below the finish so balls don’t accumulate
  addSlope(220, WORLD.finishY + 260, 700, 18, -35, "#222233");
  addSlope(880, WORLD.finishY + 260, 700, 18, 35, "#222233");

  courseBuilt = true;
  startBtn.disabled = false;
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

    // leader = greatest y among active (not removed) balls
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

    const bx0 = clamp(targetX - viewW / 2, minX, maxX - viewW);
    const by0 = clamp(targetY - viewH / 2, minY, maxY - viewH);

    render.bounds.min.x = bx0;
    render.bounds.min.y = by0;
    render.bounds.max.x = bx0 + viewW;
    render.bounds.max.y = by0 + viewH;

    Render.lookAt(render, { min: render.bounds.min, max: render.bounds.max });
  });
}

/* --- FINISH DETECTION (FIX: remove balls so finish doesn’t pile up) --- */
function removeBallFromWorld_(b) {
  if (!b || (b.plugin && b.plugin.removed)) return;
  Composite.remove(engine.world, b);
  if (b.plugin) b.plugin.removed = true;
}

function setupFinisherDetection() {
  Events.on(engine, "afterUpdate", () => {
    if (!balls.length) return;

    for (const b of balls) {
      if (!b || !b.plugin || b.plugin.removed) continue;

      // Record finishers
      if (!b.plugin.finished && b.position.y >= WORLD.finishY + 40) {
        b.plugin.finished = true;

        if (finishers.length < 5) {
          finishers.push({ idx: b.plugin.idx, name: b.plugin.name, y: b.position.y });
          updateTop5UI();
          celebrateFinisher(b, finishers.length);
          if (finishers.length === 5) setStatus("Top 5 decided! See scoreboard.");
        }

        // Remove to prevent end pileups
        setTimeout(() => removeBallFromWorld_(b), 400);
      }

      // Safety: if any ball goes way below, delete it
      if (b.position.y >= WORLD.finishY + 1500) {
        removeBallFromWorld_(b);
      }
    }
  });
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

/* --- CONFETTI / OVERLAY --- */
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

/* --- Boot --- */
resizeCanvasToCSS();
boot();
