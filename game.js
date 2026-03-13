const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// ─── Shields toggle button ────────────────────────────────────────────────────
let shieldsEnabled = true;
const shieldBtn = document.getElementById('shieldToggle');
shieldBtn.addEventListener('click', () => {
  shieldsEnabled = !shieldsEnabled;
  shieldBtn.textContent = shieldsEnabled ? 'ON' : 'OFF';
  shieldBtn.style.background = shieldsEnabled ? '' : '#440000';
  shieldBtn.style.color = shieldsEnabled ? '' : '#ff4444';
  shieldBtn.style.borderColor = shieldsEnabled ? '' : '#ff4444';
  // Rebuild shields immediately if turning on
  if (shieldsEnabled) shields = createShields();
});

// ─── Input ────────────────────────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ─── Level config ─────────────────────────────────────────────────────────────
// stepInterval: ms between each swarm step at FULL formation (scales down as aliens die)
// dropDy: pixels dropped per wall reversal
// startY: formation top — increases each level so enemies start closer to player
function getLevelConfig(level) {
  const configs = [
    { rows: 3, cols: 7,  stepInterval: 500, fireInterval: 1800, dropDy: 8,  startY: 80  }, // 1
    { rows: 3, cols: 8,  stepInterval: 440, fireInterval: 1650, dropDy: 8,  startY: 88  }, // 2
    { rows: 3, cols: 9,  stepInterval: 390, fireInterval: 1500, dropDy: 10, startY: 96  }, // 3
    { rows: 4, cols: 9,  stepInterval: 345, fireInterval: 1400, dropDy: 10, startY: 100 }, // 4
    { rows: 4, cols: 10, stepInterval: 305, fireInterval: 1300, dropDy: 12, startY: 104 }, // 5
    { rows: 4, cols: 11, stepInterval: 270, fireInterval: 1200, dropDy: 12, startY: 108 }, // 6
    { rows: 5, cols: 10, stepInterval: 240, fireInterval: 1100, dropDy: 14, startY: 112 }, // 7
    { rows: 5, cols: 11, stepInterval: 210, fireInterval: 1000, dropDy: 14, startY: 116 }, // 8
  ];
  if (level <= configs.length) return configs[level - 1];
  const extra = level - configs.length;
  return {
    rows: 5, cols: 11,
    stepInterval: Math.max(60, 210 - extra * 25),
    fireInterval: Math.max(500, 1000 - extra * 70),
    dropDy: Math.min(20, 14 + extra * 2),
    startY: Math.min(150, 116 + extra * 8),
  };
}

// ─── Player ───────────────────────────────────────────────────────────────────
const player = {
  x: WIDTH / 2 - 20,
  y: HEIGHT - 60,
  width: 40,
  height: 24,
  speed: 300,
  color: '#e0e8ff',
};

// ─── Player bullets (array for rapid fire) ────────────────────────────────────
let bullets = [];
let fireCooldown = 0;
const FIRE_COOLDOWN = 380; // ms between shots when holding space

// ─── Starfield ────────────────────────────────────────────────────────────────
const STARS = Array.from({ length: 120 }, () => ({
  x: Math.random() * 800,
  y: Math.random() * 600,
  r: Math.random() * 1.5 + 0.3,
  brightness: Math.random(),
  twinkleSpeed: Math.random() * 2 + 0.5,
  twinkleOffset: Math.random() * Math.PI * 2,
}));

function drawStars(time) {
  for (const s of STARS) {
    const alpha = 0.4 + 0.6 * Math.abs(Math.sin(time * s.twinkleSpeed * 0.001 + s.twinkleOffset));
    ctx.fillStyle = `rgba(255,255,255,${(alpha * s.brightness).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Explosions ───────────────────────────────────────────────────────────────
const explosions = [];

function addExplosion(x, y) {
  const particles = Array.from({ length: 14 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 80 + 30;
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 500 + Math.random() * 300,
      maxLife: 800,
      r: Math.random() * 3 + 1,
      hue: Math.random() < 0.6 ? 25 : 45, // orange or yellow
    };
  });
  explosions.push(...particles);
}

function updateExplosions(delta) {
  const dt = delta / 1000;
  for (let i = explosions.length - 1; i >= 0; i--) {
    const p = explosions[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= delta;
    if (p.life <= 0) explosions.splice(i, 1);
  }
}

function drawExplosions() {
  for (const p of explosions) {
    const alpha = p.life / p.maxLife;
    ctx.fillStyle = `hsla(${p.hue}, 100%, 60%, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * alpha + 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Enemy constants ──────────────────────────────────────────────────────────
const ENEMY_W = 36;
const ENEMY_H = 24;
const ENEMY_PAD_X = 16;
const ENEMY_PAD_Y = 14;
// Blue/purple palette matching the screenshot
// Row colors: cyber eagles (gold), war eagles (dark gold), chainsaw humans (orange-red)
const ENEMY_COLORS = ['#ffcc00', '#ffcc00', '#ff8800', '#ff8800', '#ff3300'];
const ENEMY_POINTS = [30, 30, 20, 20, 10];

function createEnemies(rows, cols, startY, xOffset) {
  const enemies = [];
  const baseX = (WIDTH - (cols * (ENEMY_W + ENEMY_PAD_X))) / 2 + xOffset;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      enemies.push({
        x: baseX + col * (ENEMY_W + ENEMY_PAD_X),
        y: startY + row * (ENEMY_H + ENEMY_PAD_Y),
        width: ENEMY_W, height: ENEMY_H,
        row, alive: true,
        points: ENEMY_POINTS[Math.min(row, ENEMY_POINTS.length - 1)],
        color: ENEMY_COLORS[Math.min(row, ENEMY_COLORS.length - 1)],
      });
    }
  }
  return enemies;
}

let enemies = [];

// ─── Swarm (step-based movement, authentic to the original) ───────────────────
// stepInterval scales with alive count: fewer aliens = faster steps
const swarm = {
  direction: 1,       // 1 = right, -1 = left
  stepPx: 4,          // pixels moved per step
  dy: 8,              // pixels dropped per wall reversal
  stepTimer: 0,       // ms until next step
  baseInterval: 500,  // full-formation step interval (ms)
  dropPending: false,
  burstSteps: 0,      // remaining steps at boosted speed after a reversal
};

// ─── Shields ──────────────────────────────────────────────────────────────────
const SHIELD_BLOCK = 8;
const SHIELD_COLS = 6;
const SHIELD_ROWS = 4;
const SHIELD_COUNT = 4;
const SHIELD_COLORS = ['', '#1a4466', '#2266aa', '#44aaff'];

function createShields() {
  const shields = [];
  const totalWidth = SHIELD_COUNT * (SHIELD_COLS * SHIELD_BLOCK) + (SHIELD_COUNT - 1) * 60;
  const startX = (WIDTH - totalWidth) / 2;
  const shieldY = player.y - 70;
  for (let s = 0; s < SHIELD_COUNT; s++) {
    const baseX = startX + s * (SHIELD_COLS * SHIELD_BLOCK + 60);
    for (let row = 0; row < SHIELD_ROWS; row++) {
      for (let col = 0; col < SHIELD_COLS; col++) {
        if (row >= 2 && col >= 2 && col <= 3) continue;
        shields.push({ x: baseX + col * SHIELD_BLOCK, y: shieldY + row * SHIELD_BLOCK, health: 3 });
      }
    }
  }
  return shields;
}

let shields = createShields();

// ─── Enemy bullets ────────────────────────────────────────────────────────────
let enemyBullets = [];
let enemyFireTimer = 0;

// ─── UFO ──────────────────────────────────────────────────────────────────────
const UFO_POINTS = [50, 100, 150, 100, 50, 300, 100, 50];
const ufo = {
  x: 0, y: 36, width: 48, height: 20,
  speed: 140, active: false, direction: 1, color: '#ff00ff',
};
let ufoTimer = 20000;
let ufoPointIndex = 0;

// ─── Score popups ─────────────────────────────────────────────────────────────
const popups = [];

// ─── Game state ───────────────────────────────────────────────────────────────
let playerInvincible = 0;
const game = {
  state: 'start', // 'start' | 'playing' | 'levelup' | 'over' | 'won'
  score: 0,
  lives: 3,
  level: 1,
  highScore: parseInt(localStorage.getItem('siHighScore') || '0'),
  lastTime: 0,
  levelUpTimer: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function getAliveEnemies() { return enemies.filter(e => e.alive); }
function addPopup(x, y, text) { popups.push({ x, y, text, life: 900 }); }
function saveHighScore() {
  if (game.score > game.highScore) {
    game.highScore = game.score;
    localStorage.setItem('siHighScore', game.highScore);
  }
}

function startLevel(level) {
  const cfg = getLevelConfig(level);
  // Randomize formation X offset slightly each wave (±20px), clamped so it fits
  const maxOffset = Math.floor((WIDTH - cfg.cols * (ENEMY_W + ENEMY_PAD_X)) / 2) - 10;
  const xOffset = Math.floor((Math.random() * 2 - 1) * Math.min(20, maxOffset));
  enemies = createEnemies(cfg.rows, cfg.cols, cfg.startY, xOffset);
  shields = shieldsEnabled ? createShields() : [];
  enemyBullets = [];
  popups.length = 0;
  bullets = [];
  fireCooldown = 0;
  swarm.direction = 1;
  swarm.dy = cfg.dropDy;
  swarm.dropPending = false;
  swarm.baseInterval = cfg.stepInterval;
  swarm.stepTimer = cfg.stepInterval;
  swarm.burstSteps = 0;
  ufo.active = false;
  ufoTimer = 20000;
  playerInvincible = 0;
  player.x = WIDTH / 2 - player.width / 2;
  game.levelFireInterval = cfg.fireInterval;
  enemyFireTimer = cfg.fireInterval;
}

function resetGame() {
  game.score = 0;
  game.lives = 3;
  game.level = 1;
  game.state = 'playing';
  startLevel(1);
}

// ─── Shoot ────────────────────────────────────────────────────────────────────
function shoot() {
  bullets.push({
    x: player.x + player.width / 2 - 1.5,
    y: player.y,
    width: 3, height: 18, speed: 520,
  });
  fireCooldown = FIRE_COOLDOWN;
}

// ─── UFO ──────────────────────────────────────────────────────────────────────
function updateUFO(delta, dt) {
  if (!ufo.active) {
    ufoTimer -= delta;
    if (ufoTimer <= 0) {
      ufoTimer = 20000 + Math.random() * 10000;
      ufo.active = true;
      ufo.direction = Math.random() < 0.5 ? 1 : -1;
      ufo.x = ufo.direction === 1 ? -ufo.width : WIDTH;
    }
    return;
  }
  ufo.x += ufo.speed * ufo.direction * dt;
  if (ufo.x > WIDTH + ufo.width || ufo.x < -ufo.width * 2) ufo.active = false;
}

// ─── Enemy movement (step-based like the original) ───────────────────────────
function updateEnemies(delta) {
  const alive = getAliveEnemies();
  if (alive.length === 0) return;

  // Base interval scales down as enemies are killed (authentic mechanic)
  const aliveRatio = alive.length / enemies.length;
  let currentInterval = Math.max(50, swarm.baseInterval * aliveRatio);

  // Speed burst for a few steps after each wall reversal
  if (swarm.burstSteps > 0) {
    currentInterval *= 0.55;
  }

  swarm.stepTimer -= delta;
  if (swarm.stepTimer > 0) return;
  swarm.stepTimer = currentInterval;
  if (swarm.burstSteps > 0) swarm.burstSteps--;

  if (swarm.dropPending) {
    for (const e of alive) e.y += swarm.dy;
    swarm.direction = -swarm.direction;
    swarm.dropPending = false;
    swarm.burstSteps = 5; // 5 fast steps after each reversal
  } else {
    for (const e of alive) e.x += swarm.stepPx * swarm.direction;
    const leftmost  = Math.min(...alive.map(e => e.x));
    const rightmost = Math.max(...alive.map(e => e.x + e.width));
    if (leftmost <= 2 || rightmost >= WIDTH - 2) swarm.dropPending = true;
  }
}

// ─── Enemy shooting ───────────────────────────────────────────────────────────
function enemyShoot(dt) {
  enemyFireTimer -= dt * 1000;
  if (enemyFireTimer > 0) return;
  enemyFireTimer = game.levelFireInterval;
  const alive = getAliveEnemies();
  if (alive.length === 0) return;
  const cols = {};
  for (const e of alive) {
    if (!cols[e.x] || e.y > cols[e.x].y) cols[e.x] = e;
  }
  const shooters = Object.values(cols);
  const s = shooters[Math.floor(Math.random() * shooters.length)];
  enemyBullets.push({ x: s.x + s.width / 2 - 2, y: s.y + s.height, width: 4, height: 10 });
}

// ─── Collisions ───────────────────────────────────────────────────────────────
function checkCollisions() {
  // Player bullets vs shields, UFO, enemies
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    let hit = false;

    // vs shields
    if (shieldsEnabled) {
      for (const block of shields) {
        if (block.health <= 0) continue;
        if (rectsOverlap(b.x, b.y, b.width, b.height, block.x, block.y, SHIELD_BLOCK, SHIELD_BLOCK)) {
          block.health--;
          hit = true;
          break;
        }
      }
    }

    // vs UFO
    if (!hit && ufo.active) {
      if (rectsOverlap(b.x, b.y, b.width, b.height, ufo.x, ufo.y, ufo.width, ufo.height)) {
        const pts = UFO_POINTS[ufoPointIndex++ % UFO_POINTS.length];
        game.score += pts;
        addPopup(ufo.x + ufo.width / 2, ufo.y, `+${pts}`);
        addExplosion(ufo.x + ufo.width / 2, ufo.y + ufo.height / 2);
        ufo.active = false;
        hit = true;
      }
    }

    // vs enemies
    if (!hit) {
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (rectsOverlap(b.x, b.y, b.width, b.height, enemy.x, enemy.y, enemy.width, enemy.height)) {
          enemy.alive = false;
          game.score += enemy.points;
          addPopup(enemy.x + enemy.width / 2, enemy.y, `+${enemy.points}`);
          addExplosion(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2);
          hit = true;
          break;
        }
      }
    }

    if (hit) bullets.splice(bi, 1);
  }

  // Enemy bullets vs shields
  if (shieldsEnabled) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const eb = enemyBullets[i];
      let hit = false;
      for (const block of shields) {
        if (block.health <= 0) continue;
        if (rectsOverlap(eb.x, eb.y, eb.width, eb.height, block.x, block.y, SHIELD_BLOCK, SHIELD_BLOCK)) {
          block.health--;
          hit = true;
          break;
        }
      }
      if (hit) { enemyBullets.splice(i, 1); }
    }
  }

  // Enemy bullets vs player
  if (playerInvincible <= 0) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const eb = enemyBullets[i];
      if (rectsOverlap(eb.x, eb.y, eb.width, eb.height,
                       player.x, player.y, player.width, player.height)) {
        enemyBullets.splice(i, 1);
        game.lives--;
        playerInvincible = 2000;
        if (game.lives <= 0) { saveHighScore(); game.state = 'over'; }
      }
    }
  }

  // Enemies reaching bottom
  for (const e of enemies) {
    if (e.alive && e.y + e.height >= player.y) {
      saveHighScore();
      game.state = 'over';
    }
  }

  // Level clear
  if (getAliveEnemies().length === 0 && game.state === 'playing') {
    saveHighScore();
    game.state = 'levelup';
    game.levelUpTimer = 2500;
  }
}

// ─── Update ───────────────────────────────────────────────────────────────────
function update(delta) {
  if (game.state === 'levelup') {
    game.levelUpTimer -= delta;
    if (game.levelUpTimer <= 0) {
      game.level++;
      game.state = 'playing';
      startLevel(game.level);
    }
    return;
  }

  if (game.state !== 'playing') return;
  const dt = delta / 1000;

  if (keys['ArrowLeft'])  player.x = Math.max(0, player.x - player.speed * dt);
  if (keys['ArrowRight']) player.x = Math.min(WIDTH - player.width, player.x + player.speed * dt);
  if (fireCooldown > 0) fireCooldown -= delta;
  if (keys['Space'] && fireCooldown <= 0) shoot();

  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y -= bullets[i].speed * dt;
    if (bullets[i].y + bullets[i].height < 0) bullets.splice(i, 1);
  }

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    enemyBullets[i].y += 220 * dt;
    if (enemyBullets[i].y > HEIGHT) enemyBullets.splice(i, 1);
  }

  if (playerInvincible > 0) playerInvincible -= delta;

  updateEnemies(delta);
  enemyShoot(dt);
  updateUFO(delta, dt);
  updateExplosions(delta);

  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].life -= delta;
    popups[i].y -= 30 * dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }

  checkCollisions();
}

// ─── Pixel art sprites (9×6 grid at 4px = 36×24) ─────────────────────────────
const S = 4;
const SPRITES = {
  // Top rows (30pts) — Cyber Eagle Scout: wings spread, sharp beak, visor
  A: [
    [1,0,0,0,0,0,0,0,1],
    [1,1,0,0,1,0,0,1,1],
    [1,1,1,0,1,0,1,1,1],
    [0,1,1,1,1,1,1,1,0],
    [0,0,1,0,1,0,1,0,0],
    [0,0,0,1,0,1,0,0,0],
  ],
  // Middle rows (20pts) — War Eagle: armoured chest, laser talons
  B: [
    [1,0,1,0,0,0,1,0,1],
    [1,1,1,0,1,0,1,1,1],
    [1,1,1,1,1,1,1,1,1],
    [0,1,1,0,1,0,1,1,0],
    [0,1,0,1,1,1,0,1,0],
    [1,0,0,1,0,1,0,0,1],
  ],
  // Bottom rows (10pts) — Chainsaw Human on jetpack
  C: [
    [0,0,0,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,0,0],
    [1,1,1,0,1,0,0,0,0],
    [0,1,1,1,1,1,1,1,0],
    [0,0,1,0,1,0,1,0,0],
    [0,1,0,0,0,0,0,1,0],
  ],
};

function drawSprite(sprite, x, y, color) {
  ctx.fillStyle = color;
  for (let row = 0; row < sprite.length; row++) {
    for (let col = 0; col < sprite[row].length; col++) {
      if (sprite[row][col]) ctx.fillRect(x + col * S, y + row * S, S, S);
    }
  }
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────
function drawPlayer() {
  const { x, y, width: w, height: h } = player;
  const cx = x + w / 2;

  ctx.save();

  // Engine thrust glow (green jungle exhaust)
  const grd = ctx.createRadialGradient(cx, y + h + 2, 0, cx, y + h + 2, 14);
  grd.addColorStop(0,   'rgba(100, 255, 120, 0.95)');
  grd.addColorStop(0.4, 'rgba(30, 180, 60, 0.5)');
  grd.addColorStop(1,   'rgba(0, 100, 0, 0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(cx, y + h + 5, 7, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Long sloth claw-arms as wings (brown)
  ctx.fillStyle = '#6b4c2a';
  // Left claw-arm
  ctx.beginPath();
  ctx.moveTo(cx - 8, y + h * 0.45);
  ctx.lineTo(x - 4,  y + h * 0.6);
  ctx.lineTo(x - 2,  y + h * 0.75);
  ctx.lineTo(cx - 6, y + h);
  ctx.closePath();
  ctx.fill();
  // Right claw-arm
  ctx.beginPath();
  ctx.moveTo(cx + 8, y + h * 0.45);
  ctx.lineTo(x + w + 4, y + h * 0.6);
  ctx.lineTo(x + w + 2, y + h * 0.75);
  ctx.lineTo(cx + 6, y + h);
  ctx.closePath();
  ctx.fill();
  // Claw tips (left)
  ctx.fillStyle = '#3a2010';
  ctx.fillRect(x - 4, y + h * 0.68, 3, 2);
  ctx.fillRect(x - 2, y + h * 0.73, 3, 2);
  // Claw tips (right)
  ctx.fillRect(x + w + 2, y + h * 0.68, 3, 2);
  ctx.fillRect(x + w,     y + h * 0.73, 3, 2);

  // Main rocket body (mossy green)
  ctx.fillStyle = '#4a7a3a';
  ctx.beginPath();
  ctx.moveTo(cx,     y + 2);          // nose tip
  ctx.lineTo(cx + 9, y + h * 0.45);  // right shoulder
  ctx.lineTo(cx + 9, y + h);         // right base
  ctx.lineTo(cx - 9, y + h);         // left base
  ctx.lineTo(cx - 9, y + h * 0.45);  // left shoulder
  ctx.closePath();
  ctx.fill();

  // Body stripe (lighter green)
  ctx.fillStyle = '#6aaa55';
  ctx.beginPath();
  ctx.moveTo(cx,     y + 4);
  ctx.lineTo(cx + 4, y + h * 0.42);
  ctx.lineTo(cx - 4, y + h * 0.42);
  ctx.closePath();
  ctx.fill();

  // Sloth face cockpit (round, cream)
  ctx.fillStyle = '#d4b483';
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.62, 8, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sloth mask (dark patches around eyes)
  ctx.fillStyle = '#7a5535';
  ctx.beginPath(); ctx.ellipse(cx - 3, y + h * 0.58, 3, 2.5, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 3, y + h * 0.58, 3, 2.5,  0.3, 0, Math.PI * 2); ctx.fill();

  // Sleepy half-closed eyes
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.ellipse(cx - 3, y + h * 0.58, 1.8, 1.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 3, y + h * 0.58, 1.8, 1.2, 0, 0, Math.PI * 2); ctx.fill();
  // Eye shine
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx - 2.3, y + h * 0.555, 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.7, y + h * 0.555, 0.6, 0, Math.PI * 2); ctx.fill();

  // Sleepy eyelids (half closed)
  ctx.fillStyle = '#d4b483';
  ctx.fillRect(cx - 5, y + h * 0.555, 4, 1.5);
  ctx.fillRect(cx + 1, y + h * 0.555, 4, 1.5);

  // Big round sloth nose
  ctx.fillStyle = '#8B5E3C';
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.66, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a3520';
  ctx.beginPath(); ctx.arc(cx - 1, y + h * 0.66, 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 1, y + h * 0.66, 0.7, 0, Math.PI * 2); ctx.fill();

  // Contented smile
  ctx.strokeStyle = '#5a3520';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.67, 2.5, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // Engine nozzles
  ctx.fillStyle = '#2a3320';
  ctx.fillRect(cx - 8, y + h - 3, 5, 4);
  ctx.fillRect(cx + 3,  y + h - 3, 5, 4);
  ctx.fillStyle = '#88ff66';
  ctx.fillRect(cx - 7, y + h - 2, 3, 3);
  ctx.fillRect(cx + 4,  y + h - 2, 3, 3);

  ctx.restore();
}

function drawMiniShip(x, y) {
  // Mini sloth ship for lives HUD — tiny sloth hanging from a branch
  // Branch
  ctx.fillStyle = '#6b4c2a';
  ctx.fillRect(x - 2, y + 2, 20, 3);
  // Sloth body hanging down
  ctx.fillStyle = '#7a6040';
  ctx.fillRect(x + 6, y + 4, 6, 8);
  // Sloth face
  ctx.fillStyle = '#d4b483';
  ctx.beginPath(); ctx.arc(x + 9, y + 5, 3, 0, Math.PI * 2); ctx.fill();
  // Claws gripping branch
  ctx.fillStyle = '#3a2010';
  ctx.fillRect(x + 5,  y + 2, 2, 3);
  ctx.fillRect(x + 11, y + 2, 2, 3);
}

function drawEnemies() {
  for (const e of enemies) {
    if (!e.alive) continue;
    let sprite;
    if (e.row <= 1)      sprite = SPRITES.A;
    else if (e.row <= 3) sprite = SPRITES.B;
    else                 sprite = SPRITES.C;
    // Center the 9×6 sprite (36×24) within the enemy cell
    drawSprite(sprite, e.x, e.y, e.color);
  }
}

function drawUFO() {
  // Anaconda — MegaCorp's giant robotic snake slithering across the top
  if (!ufo.active) return;
  const { x, y, width: w, height: h } = ufo;
  const cx = x + w / 2;
  const t = Date.now() * 0.004;

  ctx.save();

  // Body segments (sinuous snake shape)
  const segCount = 6;
  const segW = w * 0.55;
  const segH = h * 0.55;
  for (let i = segCount; i >= 0; i--) {
    const sx = x + (i / segCount) * w * 1.2 - w * 0.1;
    const sy = y + h * 0.5 + Math.sin(t + i * 0.8) * h * 0.35;
    const shade = i % 2 === 0 ? '#2a8a2a' : '#1a6a1a';
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(sx, sy, segW * 0.5, segH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Scale pattern
    ctx.fillStyle = '#3aaa3a';
    ctx.beginPath();
    ctx.ellipse(sx, sy - segH * 0.1, segW * 0.3, segH * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head (at the front depending on direction)
  const hx = ufo.direction === 1 ? x + w : x;
  const hy = y + h * 0.5 + Math.sin(t) * h * 0.35;
  ctx.fillStyle = '#1a5a1a';
  ctx.beginPath();
  ctx.ellipse(hx, hy, w * 0.22, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  // Evil eyes
  const eyeOff = ufo.direction === 1 ? -4 : 4;
  ctx.fillStyle = '#ff4400';
  ctx.beginPath(); ctx.arc(hx + eyeOff - 3, hy - 3, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + eyeOff + 3, hy - 3, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffaa00';
  ctx.beginPath(); ctx.arc(hx + eyeOff - 3, hy - 3, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + eyeOff + 3, hy - 3, 1.2, 0, Math.PI * 2); ctx.fill();
  // Forked tongue
  ctx.strokeStyle = '#ff2222';
  ctx.lineWidth = 1.5;
  const tongueDir = ufo.direction === 1 ? 1 : -1;
  ctx.beginPath(); ctx.moveTo(hx + tongueDir * 8, hy + 2);
  ctx.lineTo(hx + tongueDir * 14, hy);
  ctx.lineTo(hx + tongueDir * 18, hy - 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx + tongueDir * 14, hy);
  ctx.lineTo(hx + tongueDir * 18, hy + 3); ctx.stroke();

  ctx.restore();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(time) {
  // Deep space background
  ctx.fillStyle = '#05050f';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawStars(time);

  if (game.state === 'start') {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#88ff66';
    ctx.font = 'bold 54px monospace';
    ctx.fillText('SLOTH SQUADRON', WIDTH / 2, HEIGHT / 2 - 100);
    ctx.fillStyle = '#ffcc44';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('MegaCorp is destroying the rainforest!', WIDTH / 2, HEIGHT / 2 - 52);
    ctx.fillStyle = '#aaddaa';
    ctx.font = '14px monospace';
    ctx.fillText('Fight off the Cyber Eagles & Chainsaw Humans', WIDTH / 2, HEIGHT / 2 - 26);
    ctx.fillText('before they reach the ground.', WIDTH / 2, HEIGHT / 2 - 4);
    ctx.fillStyle = '#888888';
    ctx.font = '13px monospace';
    ctx.fillText('Arrow keys to move   Space to shoot', WIDTH / 2, HEIGHT / 2 + 28);
    ctx.fillStyle = '#ffaa00';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('Press ENTER to defend the forest!', WIDTH / 2, HEIGHT / 2 + 60);
    ctx.fillStyle = '#aaffaa';
    ctx.font = '13px monospace';
    ctx.fillText(`High Score: ${game.highScore}`, WIDTH / 2, HEIGHT / 2 + 98);
    return;
  }

  // Ground line (jungle floor — green)
  ctx.fillStyle = '#3a6a2a';
  ctx.fillRect(0, player.y + player.height + 6, WIDTH, 2);

  drawUFO();
  drawExplosions();

  if (playerInvincible <= 0 || Math.floor(playerInvincible / 200) % 2 === 0) drawPlayer();

  drawEnemies();

  if (shieldsEnabled) {
    for (const block of shields) {
      if (block.health <= 0) continue;
      ctx.fillStyle = SHIELD_COLORS[block.health];
      ctx.fillRect(block.x, block.y, SHIELD_BLOCK, SHIELD_BLOCK);
    }
  }

  // Player laser beams (jungle green)
  for (const b of bullets) {
    ctx.fillStyle = 'rgba(80, 255, 80, 0.2)';
    ctx.fillRect(b.x - 3, b.y, b.width + 6, b.height);
    ctx.fillStyle = '#66ff66';
    ctx.fillRect(b.x, b.y, b.width, b.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(b.x + 1, b.y, 1, b.height);
  }

  // Enemy bullets (red bolts)
  for (const eb of enemyBullets) {
    ctx.fillStyle = 'rgba(255,50,50,0.3)';
    ctx.fillRect(eb.x - 2, eb.y, eb.width + 4, eb.height);
    ctx.fillStyle = '#ff6666';
    ctx.fillRect(eb.x, eb.y, eb.width, eb.height);
    ctx.fillStyle = '#ffaaaa';
    ctx.fillRect(eb.x + 1, eb.y, 2, eb.height);
  }

  // Score popups
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  for (const p of popups) {
    ctx.fillStyle = `rgba(255,220,0,${Math.min(1, p.life / 400)})`;
    ctx.fillText(p.text, p.x, p.y);
  }

  // HUD
  ctx.fillStyle = '#aaffaa';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${game.score}`, 10, 24);
  ctx.textAlign = 'center';
  ctx.fillText(`HI: ${game.highScore}`, WIDTH / 2, 24);
  ctx.fillStyle = '#ffcc44';
  ctx.fillText(`SECTOR ${game.level}`, WIDTH / 2, 46);
  ctx.fillStyle = '#aaffaa';
  ctx.textAlign = 'right';
  ctx.fillText('SLOTHS:', WIDTH - 14 - game.lives * 22, 24);
  for (let i = 0; i < game.lives; i++) drawMiniShip(WIDTH - 14 - (i + 1) * 22, 10);

  if (ufo.active) {
    ctx.fillStyle = '#88ff44';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ANACONDA!', 10, 46);
  }

  // Level up banner
  if (game.state === 'levelup') {
    ctx.fillStyle = 'rgba(0,20,0,0.75)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#88ff66';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('FOREST DEFENDED!', WIDTH / 2, HEIGHT / 2 - 30);
    ctx.fillStyle = '#ffcc44';
    ctx.font = '18px monospace';
    ctx.fillText('The sloths advance deeper into the jungle...', WIDTH / 2, HEIGHT / 2 + 14);
    ctx.fillStyle = '#aaffaa';
    ctx.font = '15px monospace';
    ctx.fillText(`Preparing Sector ${game.level + 1}...`, WIDTH / 2, HEIGHT / 2 + 44);
  }

  // Game over overlay
  if (game.state === 'over') {
    ctx.fillStyle = 'rgba(10,0,0,0.8)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#ff4422';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('THE FOREST HAS FALLEN', WIDTH / 2, HEIGHT / 2 - 50);
    ctx.fillStyle = '#ffaa44';
    ctx.font = '16px monospace';
    ctx.fillText('MegaCorp wins... the chainsaws roar.', WIDTH / 2, HEIGHT / 2 - 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px monospace';
    ctx.fillText(`Score: ${game.score}   Sector: ${game.level}`, WIDTH / 2, HEIGHT / 2 + 24);
    ctx.fillText(`Best: ${game.highScore}`, WIDTH / 2, HEIGHT / 2 + 52);
    ctx.fillStyle = '#88ff66';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('Press ENTER — the sloths will fight again!', WIDTH / 2, HEIGHT / 2 + 88);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop(timestamp) {
  const delta = Math.min(timestamp - game.lastTime, 50);
  game.lastTime = timestamp;

  if (keys['Enter'] && (game.state === 'start' || game.state === 'over')) {
    keys['Enter'] = false;
    resetGame();
  }

  update(delta);
  render(timestamp);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
