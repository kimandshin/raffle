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

let engine, runner, render;
let balls = [];
let finishers = []; // store ball objects in order
let courseBuilt = false;

let music = new Audio();
music.loop = true;
let musicPlaying = false;

// Course dimensions (vertical)
const WORLD = {
  width: 1100,
  height: 12000,     // long drop to ensure 30+ sec
  margin: 80,
  startY: 250,
  finishY: 11500
};

// Twitchers/wheels scheduled impulses
let twitchTimers = [];

// Confetti particles (drawn in afterRender)
let confetti = [];
let bigWinText = null; // {text, untilMs}

// --- Utilities ---
function setStatus(msg) { statusEl.textContent = msg; }

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

  return names.slice(0, 55); // hard cap per your spec
}

function initEngine() {
  engine = Engine.create();
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

  window.addEventListener("resize", () => resizeCanvasToCSS());
}

function clearWorld() {
  if (!engine) return;
  Composite.clear(engine.world, false);
  Engine.clear(engine);
  balls = [];
  finishers = [];
  courseBuilt = false;
  confetti = [];
  bigWinText = null;

  for (const t of twitchTimers) clearInterval(t);
  twitchTimers = [];

  top5El.innerHTML = "";
  startBtn.disabled = true;
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
  const left = Bodies.rectangle(-t/2, WORLD.height/2, t, WORLD.height + 1000, {
    isStatic: true, render: { fillStyle: "#1b1b22" }
  });
  const right = Bodies.rectangle(WORLD.width + t/2, WORLD.height/2, t, WORLD.height + 1000, {
    isStatic: true, render: { fillStyle: "#1b1b22" }
  });
  Composite.add(engine.world, [left, right]);
}

function addSlope(x, y, w, h, deg, style="#2a2a36") {
  const angle = deg * Math.PI / 180;
  const body = Bodies.rectangle(x, y, w, h, {
    isStatic: true,
    angle,
    render: { fillStyle: style }
  });
  Composite.add(engine.world, body);
  return body;
}

function addBumper(x, y, r=18) {
  const b = Bodies.circle(x, y, r, {
    isStatic: true,
    render: { fillStyle: "#3a3a4a" }
  });
  Composite.add(engine.world, b);
  return b;
}

function addGateBottleneck(y, gapWidth=160) {
  // Two lanes funnel: walls squeeze into a narrow gap
  const w = (WORLD.width - gapWidth) / 2;
  const left = Bodies.rectangle(w/2, y, w, 30, { isStatic: true, render:{fillStyle:"#2a2a36"} });
  const right = Bodies.rectangle(WORLD.width - w/2, y, w, 30, { isStatic: true, render:{fillStyle:"#2a2a36"} });
  Composite.add(engine.world, [left, right]);

  // Add a few bumpers right after the gate to separate balls
  for (let i = 0; i < 6; i++) addBumper(200 + i*140, y + 180, 14);
}

function addSpinner(x, y, radius=85, spokeCount=6) {
  // Static wheel center; rotating "paddles" are separate static bodies we rotate manually
  const hub = Bodies.circle(x, y, radius, {
    isStatic: true,
    render: { fillStyle: "#242432" }
  });

  const spokes = [];
  for (let i=0;i<spokeCount;i++) {
    const spoke = Bodies.rectangle(x, y, radius*1.7, 14, {
      isStatic: true,
      angle: (Math.PI*2*i)/spokeCount,
      render: { fillStyle: "#3b3b52" }
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

function twitchEvery(spinner, ms=2000) {
  // Every ms, apply a random angular “twitch”
  const t = setInterval(() => {
    const amt = (Math.random() * 0.9 + 0.25) * (Math.random() < 0.5 ? -1 : 1);
    Body.rotate(spinner.hub, amt);
    for (const s of spinner.spokes) Body.rotate(s, amt);
  }, ms);
  twitchTimers.push(t);
}

function addTwitchStick(x, y, w=220, h=18) {
  const stick = Bodies.rectangle(x, y, w, h, {
    isStatic: true,
    angle: 0,
    render: { fillStyle: "#40405a" }
  });
  Composite.add(engine.world, stick);

  // Twitch motion every ~2s + small random jitter between
  const t = setInterval(() => {
    const a = (Math.random() * 1.0 + 0.35) * (Math.random() < 0.5 ? -1 : 1);
    Body.rotate(stick, a);

    // Also "flick up" by briefly rotating back quickly
    setTimeout(() => Body.rotate(stick, -a*0.8), 110);
  }, 2000);
  twitchTimers.push(t);

  return stick;
}

function buildCourse() {
  clearWorld();
  initEngine();
  setupCamera();
  setupFinisherDetection();
  setupCustomOverlayDrawing();

  addWalls();

  // The “track” is built from angled plates and bumpers.
  // Mostly vertical with some 45° and a couple 30° sections.

  // Start funnel
  addSlope(WORLD.width/2, 220, 780, 24, 0);
  addSlope(260, 420, 520, 18, 45);
  addSlope(840, 520, 520, 18, -45);

  // Section 1: peg/bumpers to prevent clumps
  for (let y = 850; y <= 1700; y += 120) {
    for (let x = 180; x <= 920; x += 140) {
      addBumper(x + ((y/120)%2)*40, y, 14);
    }
  }

  // 45° long slide + spinner slow-down
  addSlope(560, 2100, 900, 18, 45);
  const s1 = addSpinner(520, 2500, 95, 7);
  spinConstant(s1, 0.06);

  // Bottleneck zone #1 (2-lane)
  addGateBottleneck(3000, 170);

  // Twitch stick after gate (flick up)
  addTwitchStick(560, 3320, 260, 18);

  // 30° shallow section (slower)
  addSlope(540, 3800, 980, 18, 30);

  // “Separators” – small alternating ramps
  for (let i = 0; i < 8; i++) {
    addSlope(240 + i*95, 4300 + i*90, 180, 14, i%2===0 ? 25 : -25, "#2d2d3d");
  }

  // Spinner field (slows + spreads)
  const s2 = addSpinner(300, 5200, 80, 6);
  spinConstant(s2, -0.07);
  const s3 = addSpinner(820, 5400, 90, 6);
  spinConstant(s3, 0.06);

  // Twitch wheel zone (every 2s)
  const s4 = addSpinner(560, 6000, 110, 8);
  spinConstant(s4, 0.03);
  twitchEvery(s4, 2000);

  // Bottleneck zone #2
  addGateBottleneck(6800, 160);

  // Big 45° + a hard redirect
  addSlope(560, 7300, 900, 18, -45);
  addSlope(560, 7700, 900, 18, 45);

  // Another twitch stick to de-clump
  addTwitchStick(560, 8200, 320, 18);

  // Long “chaos canyon” bumpers
  for (let y = 8600; y <= 9900; y += 120) {
    for (let x = 160; x <= 940; x += 130) addBumper(x + ((y/120)%2)*35, y, 13);
  }

  // Another 30° slope near end (slow drama)
  addSlope(560, 10450, 980, 18, -30);

  // Final funnel to finish
  addSlope(330, 11150, 700, 18, 35);
  addSlope(790, 11150, 700, 18, -35);

  // Finish line visual bar
  const finishBar = Bodies.rectangle(WORLD.width/2, WORLD.finishY, WORLD.width - 180, 20, {
    isStatic: true,
    render: { fillStyle: "#6a5acd" }
  });
  Composite.add(engine.world, finishBar);

  courseBuilt = true;
  startBtn.disabled = false;
  setStatus("Course built. Press Start.");
}

function spawnBalls(names) {
  const world = engine.world;
  balls = [];

  // spawn grid near top
  const startX = WORLD.width/2;
  const startY = WORLD.startY;

  const cols = 11; // 55 max = 5 rows
  const spacing = 26;

  for (let i=0;i<names.length;i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const b = Bodies.circle(
      startX - ((cols-1)/2)*spacing + col*spacing,
      startY - row*spacing,
      13,
      {
        restitution: 0.25,
        friction: 0.03,
        frictionAir: 0.018,  // slows down to hit 30+ seconds
        render: { fillStyle: "#f2f2f7" }
      }
    );

    b.plugin = { idx: i+1, name: names[i] };
    balls.push(b);
  }

  if (staggerEl.checked) {
    let k = 0;
    const iv = setInterval(() => {
      if (k >= balls.length) { clearInterval(iv); return; }
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

    // Follow leader (by greatest y)
    let targetY = WORLD.startY;
    let targetX = WORLD.width/2;

    if (balls.length) {
      let leader = balls[0];
      for (const b of balls) {
        if (b.position.y > leader.position.y) leader = b;
      }
      targetY = leader.position.y;
      targetX = followLeaderEl.checked ? leader.position.x : WORLD.width/2;
    }

    // If we have at least one finisher, keep camera near the action but don’t jump to bottom instantly
    if (finishers.length > 0 && followLeaderEl.checked) {
      targetY = Math.max(targetY, finishers[finishers.length-1].position.y);
    }

    // Clamp camera bounds
    const minX = 0, maxX = WORLD.width;
    const minY = 0, maxY = WORLD.height;

    const bx0 = clamp(targetX - viewW/2, minX, maxX - viewW);
    const by0 = clamp(targetY - viewH/2, minY, maxY - viewH);

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

        // Big win text + fireworks/confetti
        celebrateFinisher(b, finishers.length);

        if (finishers.length === 5) {
          setStatus("Top 5 decided! See scoreboard.");
        }
      }
    }
  });
}

function updateTop5UI() {
  top5El.innerHTML = "";
  for (let i=0;i<finishers.length;i++) {
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

  // burst confetti near camera center
  const cx = ball.position.x;
  const cy = ball.position.y - 120;

  spawnConfetti(cx, cy, 180 + rank*30);
}

function spawnConfetti(x, y, count) {
  for (let i=0;i<count;i++) {
    confetti.push({
      x, y,
      vx: (Math.random()*8 - 4),
      vy: (Math.random()*-10 - 3),
      life: 140 + Math.random()*60,
      r: 2 + Math.random()*3
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

    // Confetti update/draw
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      p.vy += 0.22; // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;

      ctx.save();
      ctx.globalAlpha = clamp(p.life / 120, 0, 1);
      // no fixed colors: vary by using HSL via fillStyle string
      const hue = Math.floor((i * 13) % 360);
      ctx.fillStyle = `hsl(${hue} 90% 60%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();

      if (p.life <= 0) confetti.splice(i, 1);
    }

    // Big winner number overlay (screen space)
    if (bigWinText && performance.now() < bigWinText.untilMs) {
      ctx.save();
      ctx.setTransform(1,0,0,1,0,0);
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      ctx.fillStyle = "#fff";
      ctx.font = "900 140px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bigWinText.text, canvas.clientWidth/2, canvas.clientHeight/2);
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
    await new Promise(r => setTimeout(r, 900));
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

// --- UI wiring ---
buildBtn.addEventListener("click", () => {
  const names = parseNames();
  if (!names.length) {
    setStatus("Add at least 1 participant name.");
    return;
  }
  buildCourse();
});

startBtn.addEventListener("click", async () => {
  if (!courseBuilt) return;

  const names = parseNames();
  if (!names.length) { setStatus("Add at least 1 participant name."); return; }

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

// Boot
resizeCanvasToCSS();
boot();
