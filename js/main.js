// ═══════════════════════════════════════════════════════════
// MAIN — renderer, iluminação, carregamento de assets, loop do jogo, HUD, ondas
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
let renderer, scene, camera, clock, sun, hemi;
let world, arena, player, weaponSys, enemies;
let soldierTemplate = null, altTemplate = null; const gunTemplates = {}, propTemplates = {};
let paused = false, running = false, score = 0, kills = 0, assetsLoaded = false, fxReady = false;
let mouseSens = 1, diffName = 'normal', texLoader;
const ASSET_V = '3';
const DIFF = {
  easy:   { hp: 0.7, spd: 0.85, dmg: 0.55, acc: 0.6, react: 1.5, shooters: 1 },
  normal: { hp: 1,   spd: 1,    dmg: 1,    acc: 1,   react: 1,   shooters: 2 },
  hard:   { hp: 1.5, spd: 1.15, dmg: 1.3,  acc: 1.2, react: 0.75, shooters: 3 },
  god:    { hp: 1,   spd: 1.1,  dmg: 1.2,  acc: 1.1, react: 0.8, shooters: 3, invincible: true },
};

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('game-container').prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfd8e0);
  scene.fog = new THREE.FogExp2(0xd9d2c3, 0.0062);
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 700);
  clock = new THREE.Clock();
  texLoader = new THREE.TextureLoader();

  hemi = new THREE.HemisphereLight(0xbcd8f5, 0xc9a77a, 0.75); scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xfff0dc, 0.12));
  sun = new THREE.DirectionalLight(0xfff0d2, 2.1);
  sun.position.set(-34, 52, 26); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 5; sc.far = 140;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(sun); scene.add(sun.target);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}


// O GLB do soldado usa KHR_materials_pbrSpecularGlossiness (não suportado no r147): aplica a textura difusa manualmente
async function fixSpecGloss(gltf) {
  const json = gltf.parser.json, mats = json.materials || [], maps = {};
  for (const md of mats) {
    const sg = md.extensions && md.extensions.KHR_materials_pbrSpecularGlossiness;
    if (sg && sg.diffuseTexture) {
      const tex = await gltf.parser.getDependency('texture', sg.diffuseTexture.index);
      tex.encoding = THREE.sRGBEncoding; maps[md.name] = tex;
    }
  }
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      const t = maps[m.name];
      if (t) { m.map = t; m.color.setHex(0xffffff); m.transparent = false; m.alphaTest = 0.4; m.depthWrite = true; m.roughness = 0.85; m.metalness = 0; m.needsUpdate = true; }
    });
  });
}

function loadAssets() {
  if (assetsLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    const loader = new THREE.GLTFLoader();
    const jobs = [];
    jobs.push(['assets/soldiers/figure.glb', (g) => { soldierTemplate = g; return fixSpecGloss(g); }]);
    jobs.push(['assets/soldiers/vanguard.glb', (g) => { altTemplate = g; }]);
    for (const w of window.WEAPONS) { const k = w.file.replace('weapon_', '').replace('.glb', ''); jobs.push([`assets/guns/${w.file}`, (g) => { gunTemplates[k] = g; }]); }
    for (const n of ['barrel', 'sandbags', 'generator', 'rock', 'lamp', 'pipes', 'fence', 'sign']) jobs.push([`assets/props/prop_${n}.glb`, (g) => { propTemplates['prop_' + n] = g; }]);
    let done = 0;
    const fin = () => { done++; $('loading').textContent = `Carregando assets... ${done}/${jobs.length}`; if (done >= jobs.length) { assetsLoaded = true; resolve(); } };
    for (const [url, cb] of jobs) loader.load(`${url}?v=${ASSET_V}`, (g) => { Promise.resolve(cb(g)).catch(e => console.warn(e)).then(fin); }, undefined, () => { console.warn('falhou:', url); fin(); });
  });
}

// ───────── dano / efeitos no jogador ─────────
function damagePlayer(dmg, from) {
  window.GameAudio.playHit();
  const fl = $('dmg-flash'); if (fl) { fl.style.opacity = '1'; setTimeout(() => { fl.style.opacity = '0'; }, 180); }
  if (from) {
    const dx = from.x - player.position.x, dz = from.z - player.position.z, L = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const a = Math.atan2((dx * rx + dz * rz) / L, (dx * fx + dz * fz) / L);
    const el = $('dmg-dir'); if (el) { el.style.transform = `translate(-50%,-50%) rotate(${a}rad)`; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 700); }
  }
  player.kick += 0.02;
  if (DIFF[diffName].invincible) return;
  player.takeDamage(dmg);
}

function showBanner(text, ms) {
  const b = $('banner'); if (!b) return;
  b.textContent = text; b.style.opacity = '1'; clearTimeout(b._t); b._t = setTimeout(() => { b.style.opacity = '0'; }, ms || 2800);
}
window.__addKillFeed = (msg) => {
  const d = document.createElement('div'); d.textContent = msg; $('kill-feed').prepend(d);
  setTimeout(() => { d.style.opacity = '0'; }, 3000); setTimeout(() => d.remove(), 3500);
};

function startGame() {
  score = 0; kills = 0; paused = false; { const pe = $('pause-ind'); if (pe) pe.style.display = 'none'; }
  $('score').textContent = 'Score: 0'; $('kill-feed').innerHTML = ''; $('wave-info').textContent = '';
  $('game-over').style.display = 'none'; $('start-screen').style.display = 'none'; const sb = $('start-bg'); if (sb) sb.style.display = 'none';

  if (player) player.dispose();
  if (weaponSys) weaponSys.dispose();
  if (enemies) enemies.clear();
  if (arena) arena.dispose();
  for (const c of [...camera.children]) camera.remove(c);

  world = new window.World();
  arena = new window.Arena(scene, world, texLoader, propTemplates, renderer);
  player = new window.Player(camera, scene, world, () => mouseSens);
  const sp = arena.playerSpawn;
  player.setPosition(sp.x, world.surfaceAt(sp.x, sp.z), sp.z); player.yaw = sp.yaw;
  weaponSys = new window.WeaponSystem(camera, scene, gunTemplates, player, world);
  let alt = null;
  try { if (altTemplate && soldierTemplate && window.retargetClips) {
    alt = { scene: altTemplate.scene, animations: window.retargetClips(soldierTemplate, altTemplate, 'abs') };
    let hand = null; altTemplate.scene.traverse(o => { if (o.isBone && o.name === 'mixamorigRightHand') hand = o; });
    let fs = null; soldierTemplate.scene.traverse(o => { if (o.name === 'Socket_Hand_R') fs = o; });
    if (hand && fs && !hand.getObjectByName('Socket_Hand_R')) { const so = new THREE.Object3D(); so.name = 'Socket_Hand_R'; so.position.copy(fs.position); so.quaternion.copy(fs.parent.quaternion).multiply(fs.quaternion); hand.add(so); }
  } } catch (e) { console.warn('alt model', e); alt = null; }
  enemies = new window.EnemyManager(scene, soldierTemplate, gunTemplates, world, arena, (dmg, from) => damagePlayer(dmg, from), alt);
  enemies.setDifficulty(DIFF[diffName]);
  weaponSys.enemies = enemies;
  weaponSys.onNoise = player.onNoise = (pos, r) => enemies.noise(pos, r);

  const FX = window.FX;
  if (!fxReady) { FX.init(scene, camera, world); fxReady = true; } else { FX.world = world; FX.clear(); }
  FX.rocketCheck = (pos, owner) => {
    if (owner === 'player') return enemies.rocketHit(pos);
    const p = player.position; return Math.hypot(p.x - pos.x, p.z - pos.z) < 0.6 && pos.y > p.y - 0.2 && pos.y < p.y + 2.0;
  };
  FX.onExplosion = (pt, radius, owner, dmg) => {
    if (owner === 'player') enemies.explosionDamage(pt, radius, dmg);
    const d = Math.hypot(player.position.x - pt.x, player.position.y + 1 - pt.y, player.position.z - pt.z);
    if (d < radius) damagePlayer(Math.round((dmg || 60) * (1 - d / radius) * (owner === 'player' ? 0.35 : 1) * (DIFF[diffName].dmg > 1 ? 1.0 : 0.8)), pt);
    enemies.noise(pt, 85);
  };
  FX.onPickup = (type) => {
    if (type === 'health') { if (player.health >= player.maxHealth) return false; player.health = Math.min(player.maxHealth, player.health + 35); window.GameAudio.pickup(); window.__addKillFeed('+35 vida'); return true; }
    if (weaponSys.addAmmo()) { window.GameAudio.pickup(); window.__addKillFeed('+ munição'); return true; }
    return false;
  };
  enemies.onKill = (e, pts, head) => { score += pts; kills++; $('score').textContent = `Score: ${score}`; window.__addKillFeed(`${head ? 'HEADSHOT! ' : ''}Inimigo eliminado +${pts}`); };
  enemies.onWave = (n, count, info) => {
    $('wave-info').textContent = `ONDA ${n}`;
    showBanner(`ONDA ${n} — ${count} inimigos${info.heavies ? ' (inclui pesado)' : ''}`, 3200);
    if (n > 1 && player.health > 0) player.health = Math.min(player.maxHealth, player.health + 25);
  };
  enemies.spawnWave();
  running = true; window.__gameRunning = true;
  clock.start();
  if (!window.__loopOn) { window.__loopOn = true; animate(); }
}

function updateHUD() {
  const hp = Math.max(0, player.health);
  $('health-bar').style.width = (hp / player.maxHealth * 100) + '%';
  $('health-text').textContent = `HP: ${Math.ceil(hp)}`;
  const s = weaponSys.slot;
  $('ammo').textContent = s.reloading ? 'RECARREGANDO...' : `${s.ammo} / ${s.reserve}`;
  $('score').textContent = `Score: ${score}`;
}

function animate() {
  requestAnimationFrame(animate);
  if (!running) return;
  if (paused) { clock.getDelta(); renderer.render(scene, camera); return; }
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);
  weaponSys.update(dt);
  enemies.update(dt, player);
  window.FX.update(dt, { x: player.position.x, y: player.position.y, z: player.position.z });
  window.GameAudio.setListener(camera);
  // sombra segue o jogador (mantém resolução alta perto)
  sun.target.position.set(player.position.x, 0, player.position.z); sun.target.updateMatrixWorld();
  sun.position.set(player.position.x - 34, 52, player.position.z + 26);
  updateHUD();
  if (player.health <= 0 && !DIFF[diffName].invincible) {
    running = false; window.__gameRunning = false;
    const rec = saveBest();
    $('final-score').textContent = `Score final: ${score} — Onda ${enemies.waveNumber} — ${kills} abates` + (rec ? ' — NOVO RECORDE!' : '');
    $('game-over').style.display = 'block'; document.exitPointerLock && document.exitPointerLock();
    const sa = $('scope'); if (sa) sa.style.display = 'none';
  }
  renderer.render(scene, camera);
}

// pausa automática quando o mouse é liberado (Esc / Alt+Tab)
document.addEventListener('pointerlockchange', () => {
  const locked = !!document.pointerLockElement, pe = $('pause-ind');
  if (locked) { paused = false; if (pe) pe.style.display = 'none'; }
  else if (running && player && player.health > 0) { paused = true; if (pe) pe.style.display = 'block'; }
});

// ───────── recorde / descrição de dificuldade ─────────
const DESC = {
  easy: 'Inimigos mais fracos, lentos e imprecisos. Bom para conhecer o mapa.',
  normal: 'Experiência padrão: 2 inimigos atacam ao mesmo tempo, mira razoável.',
  hard: 'Inimigos resistentes, rápidos e precisos; até 3 atacam juntos e reagem mais rápido.',
  god: 'Você não morre. Ideal para explorar o mapa e testar as armas.',
};
function bestKey() { return 'fps_best_' + diffName; }
function readBest() { try { return JSON.parse(localStorage.getItem(bestKey()) || 'null'); } catch (e) { return null; } }
function saveBest() {
  if (DIFF[diffName].invincible) return false;
  const b = readBest();
  if (b && b.score >= score) return false;
  try { localStorage.setItem(bestKey(), JSON.stringify({ score, wave: enemies.waveNumber, kills })); } catch (e) {}
  return true;
}
function refreshStartInfo() {
  const d = $('diff-desc'); if (d) d.textContent = DESC[diffName] || '';
  const el = $('best'); if (!el) return;
  const b = readBest();
  el.textContent = DIFF[diffName].invincible ? '' : (b ? `Recorde (${diffName.toUpperCase()}): ${b.score} pts — Onda ${b.wave} — ${b.kills} abates` : 'Sem recorde ainda nesta dificuldade');
}

// ───────── UI de início ─────────
const LS_D = 'fps_diff', LS_S = 'fps_sens';
const ls = { get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
diffName = ls.get(LS_D, 'normal'); if (!DIFF[diffName]) diffName = 'normal';
document.querySelectorAll('.diff-btn').forEach(b => {
  b.classList.toggle('active', b.dataset.diff === diffName);
  b.addEventListener('click', () => { document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); diffName = b.dataset.diff; ls.set(LS_D, diffName); refreshStartInfo(); });
});
refreshStartInfo();
const slider = $('sens-slider'), sval = $('sens-val');
if (slider) {
  const v = parseInt(ls.get(LS_S, '100'), 10); slider.value = (v >= 20 && v <= 300) ? v : 100; sval.textContent = slider.value + '%';
  slider.addEventListener('input', () => { sval.textContent = slider.value + '%'; ls.set(LS_S, slider.value); });
}
function begin() {
  mouseSens = slider ? parseInt(slider.value, 10) / 100 : 1;
  const ad = document.querySelector('.diff-btn.active'); if (ad) diffName = ad.dataset.diff;
  window.GameAudio.unlock();
  $('loading').style.display = 'block';
  loadAssets().then(() => { $('loading').style.display = 'none'; startGame(); $('game-container').requestPointerLock(); });
}
$('start-btn').addEventListener('click', begin);
$('restart-btn').addEventListener('click', () => { window.GameAudio.unlock(); startGame(); $('game-container').requestPointerLock(); });

init();
window.__game = { get world() { return world; }, get player() { return player; }, get enemies() { return enemies; }, get arena() { return arena; }, get weapons() { return weaponSys; }, scene: () => scene, camera: () => camera, renderer: () => renderer, begin, loadAssets, start: () => { mouseSens = 1; return loadAssets().then(startGame); } };
})();
