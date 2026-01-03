const {
  Engine, Render, Runner, Bodies, Body, Composite, Events
} = Matter;

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

let music = new Audio();
music.loop = true;
let musicPlaying = false;

const WORLD = {
  width: 1100,
  height: 12000,
  startY: 180,
  finishY: 11500
};

let twitchTimers = [];
let confetti = [];
let bigWinText = null;

function hidePanel() {
  if (!panelEl) return;
  panelEl.classList.add("fadeout");
}
function showPanel() {
  if (!panelEl) return;
  panelEl.classList.remove("fadeout");
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

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
  const lines = (namesEl ? namesEl.value : "")
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
  resizeCanvasToCSS();
  initEngine();
  setupCamera();
  setupFinisherDetection();
  setupCustomOverlayDrawing();
  showPanel();
  setStatus("Paste names → Build Course → Start");
}

function addWalls() {
  const t = 90;
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

function addGateBottleneck(y, gapWidth = 170) {
  const plateLen = 520;
  const plateThk = 18;

  addSlope((WORLD.width / 2) - 260, y - 120, plateLen, plateThk, 30);
  addSlope((WORLD.width / 2) + 260, y - 120, plateLen, plateThk, -30);

  const wallThk = 30;
  const wallH = 280;
  const leftX = (WORLD.width - gapWidth) / 2 - wallThk / 2;
  const rightX = (WORLD.width + gapWidth) / 2 + wallThk / 2;

  const leftWall = Bodies.rectangle(leftX, y + 60, wallThk, wallH, {
    isStatic: true, render: { fillStyle: "#2a2a36" }
  });
  const rightWall = Bodies.rectangle(rightX, y + 60, wallThk, wallH, {
    isStatic: true, render: { fillStyle: "#2a2a36" }
  });

  Composite.add(engine.world, [leftWall, rightWall]);

  for (let i = 0; i < 9; i++) addBumper(150 + i * 110, y + 280, 13);
}

function addSpinner(x, y, radius = 90, spokeCount = 8) {
  const hub = Bodies.circle(x, y, radius, {
    isStatic: true,
    render: { fillStyle: "#1c1c28" }
  });

  const spokes = [];
  const spokeLen = radius * 3.0;
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
    const a = (Math.random() * 1.1 + 0.55) * (Math.random() < 0.5 ? -1 : 1);
    Body.rotate(stick, a);
    setTimeout(() => Body.rotate(stick, -a * 0.92), 90);
  }, 1200);

  twitchTimers.push(t);
  return stick;
}

function addReturnRails(yStart, yEnd, step = 420) {
  // Keeps side balls from free-falling straight down the edges
  // Alternating inward deflectors near left/right walls
  const leftX = 110;
  const rightX = WORLD.width - 110;
  for (let y = yStart; y <= yEnd; y += step) {
    const dir = ((y / step) | 0) % 2 === 0 ? 1 : -1;
    // Left: tilt to push right (positive angle)
    addSlope(leftX, y, 420, 16, 30 * dir, "#242432");
    // Right: tilt to push left (negative angle)
    addSlope(rightX, y + step / 2, 420, 16, -30 * dir, "#242432");

    // Small bumpers near the walls
    addBumper(70, y + 80, 12, "#2f2f3e");
    addBumper(WORLD.width - 70, y + 200, 12, "#2f2f3e");
  }
}

function addWideBumperField(yStart, yEnd, yStep = 140, xStep = 130) {
  // Covers full width so there are no “empty lanes”
  for (let y = yStart; y <= yEnd; y += yStep) {
    const offset = ((y / yStep) | 0) % 2 === 0 ? 0 : xStep / 2;
    for (let x = 120; x <= WORLD.width - 120; x += xStep) {
      addBumper(x + offset, y, 13);
    }
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

  // Start chute: NO V cradle. Vertical channel then one committed ramp.
  const chuteLeft = Bodies.rectangle(330, 330, 26, 520, { isStatic: true, render: { fillStyle: "#2a2a36" } });
  const chuteRight = Bodies.rectangle(770, 330, 26, 520, { isStatic: true, render: { fillStyle: "#2a2a36" } });
  Composite.add(engine.world, [chuteLeft, chuteRight]);

  addSlope(560, 620, 980, 18, 45, "#2a2a36");
  addBumper(560, 760, 18);

  // Rails to prevent edge free-fall (whole course)
  addReturnRails(900, 10800, 420);

  // Field #1 (wide coverage)
  addWideBumperField(950, 1850, 140, 150);

  // Ramp + spinner
  addSlope(560, 2200, 900, 18, 45);
  const s1 = addSpinner(560, 2600, 95, 8);
  spinConstant(s1, 0.06);

  // Bottleneck #1 + flick
  addGateBottleneck(3200, 170);
  addTwitchStick(560, 3550, 620, 18);

  // Shallow drama ramp (still >= 30°)
  addSlope(560, 3950, 980, 18, 30);

  // Separators that span wider
  for (let i = 0; i < 10; i++) {
    const deg = i % 2 === 0 ? 30 : -30;
    addSlope(200 + i * 90, 4450 + i * 95, 240, 14, deg, "#2d2d3d");
    addSlope(900 - i * 90, 4450 + i * 95, 240, 14, -deg, "#2d2d3d");
  }

  // Spinner spread zone
  const s2 = addSpinner(300, 5400, 85, 7);
  spinConstant(s2, -0.07);
  const s3 = addSpinner(820, 5600, 95, 7);
  spinConstant(s3, 0.06);

  // Twitch wheel chaos
  const s4 = addSpinner(560, 6200, 120, 9);
  spinConstant(s4, 0.03);
  twitchEvery(s4, 2000);

  // Bottleneck #2
  addGateBottleneck(7000, 160);

  // Redirect ramps (keeps motion)
  addSlope(560, 7600, 980, 18, -45);
  addSlope(560, 8050, 980, 18, 45);

  // De-clump stick
  addTwitchStick(560, 8450, 620, 18);

  // Field #2 (full width)
  addWideBumperField(8800, 10100, 140, 140);

  // End drama
  addSlope(560, 10550, 980, 18, -30);

  // Final funnel (inward)
  addSlope(330, 11180, 700, 18, 35);
  addSlope(790, 11180, 700, 18, -35);

  const finishBar = Bodies.rectangle(WORLD.width / 2, WORLD.finishY, WORLD.width - 180, 20, {
    isStatic: true,
    isSensor: true,
    render: { fillStyle: "#6a5acd" }
  });
  Composite.add(engine.world, finishBar);

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
  const spacing = 28;

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

    b.plugin = { idx: i + 1, name: names[i] };
    balls.push(b);
  }

  if (staggerEl && staggerEl.checked) {
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

function setupCamera() {
  Events.on(engine, "afterUpdate", () => {
    if (!render) return;

    const viewW = canvas.width / (render.options.pixelRatio || 1);
    const viewH = canvas.height / (render.options.pixelRatio || 1);

    let targetY = WORLD.startY;
    let targetX = WORLD.width / 2;

    if (balls.length) {
      let leader = balls[0];
      for (const b of balls) {
        if (b.position.y > leader.position.y) leader = b;
      }
      targetY = leader.position.y;
      targetX = (followLeaderEl && followLeaderEl.checked) ? leader.position.x : WORLD.width / 2;
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

function setupFinisherDetection() {
  Events.on(engine, "afterUpdate", () => {
    if (!balls.length) return;
    if (finishers.length >= 5) return;

    for (const b of balls) {
      if (b.plugin && !b.plugin.finished && b.position.y >= WORLD.finishY + 40) {
        b.plugin.finished = true;
        finishers.push(b);
        updateTop5UI();
        celebrateFinisher(b, finishers.length);
        if (finishers.length === 5) setStatus("Top 5 decided! See scoreboard.");
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
  bigWinText = { text: `#${ball.plugin.idx}`, untilMs: performance.now() + 2200 };
  spawnConfetti(ball.position.x, ball.position.y - 120, 180 + rank * 30);
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
  if (!countdownEl) return;
  countdownEl.classList.remove("hidden");
  const seq = ["3", "2", "1", "GO!"];
  for (const s of seq) {
    countdownEl.textContent = s;
    await new Promise(r => setTimeout(r, 900));
  }
  countdownEl.classList.add("hidden");
}

function tryPlayMusic() {
  const url = (musicUrlEl ? musicUrlEl.value : "").trim();
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
      engine.gravity.x = baseGx;
      engine.gravity.y = baseGy;
    }
  }, 55);
}

// --- UI wiring (bind once) ---
buildBtn.addEventListener("click", () => {
  const names = parseNames();
  if (!names.length) { setStatus("Add at least 1 participant name."); return; }
  buildCourse();
});

shakeBtn.addEventListener("click", () => {
  shakeWorld();
});

startBtn.addEventListener("click", async () => {
  if (!courseBuilt) return;

  const names = parseNames();
  if (!names.length) { setStatus("Add at least 1 participant name."); return; }

  finishers = [];
  updateTop5UI();
  confetti = [];
  bigWinText = null;

  hidePanel();
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

// Boot
resizeCanvasToCSS();
boot();
