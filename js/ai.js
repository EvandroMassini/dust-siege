// ═══════════════════════════════════════════════════════════
// IA DOS INIMIGOS
//  • percepção: cone de visão + linha de visão (raycast em paredes) + audição de tiros/passos/explosões
//  • navegação: A* em grade (sem atravessar paredes), suavização de caminho, separação entre inimigos
//  • estados: PATROL → INVESTIGATE → COMBAT ⇄ COVER; reposicionamento (peek/flanco), strafe, recuo
//  • tiro com precisão dependente de distância/movimento, rajadas, recarga, traçantes e som posicional
//  • 4 tipos: grunt (fuzil), rusher (SMG), marksman (sniper), heavy (lançador de foguetes)
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const S = { PATROL: 0, INVESTIGATE: 1, COMBAT: 2, COVER: 3, DEAD: 4 };

const TYPES = {
  grunt:    { key: 'rifle',    wIdx: 2, grip: 'rifle',  hp: 100, speed: 3.4, run: 5.4, acc: 0.45, range: 40, prefMin: 8,  prefMax: 22, rate: 5.5, burst: [2, 4], pause: [0.8, 1.8], dmg: 7,  react: 0.55, mag: 30, tint: { Tops: 0x8fa06a, Bottoms: 0x6f7058, Hats: 0x66774a }, flank: 0.6 },
  rusher:   { model: 'alt', key: 'smg',      wIdx: 1, grip: 'rifle',  hp: 75,  speed: 4.4, run: 6.8, acc: 0.36, range: 22, prefMin: 3,  prefMax: 11, rate: 9,  burst: [3, 6], pause: [0.6, 1.4], dmg: 5,  react: 0.4,  mag: 40, tint: { Tops: 0xc9604a, Bottoms: 0x5a4a44, Hats: 0xa03a30, vanguard: 0x8a8f86 }, flank: 0.8 },
  marksman: { model: 'alt', key: 'sniper',   wIdx: 4, grip: 'rifle',  hp: 70,  speed: 2.8, run: 4.4, acc: 0.7, range: 80, prefMin: 26, prefMax: 60, rate: 1,   burst: [1, 1], pause: [2.0, 3.2], dmg: 30, react: 0.9,  mag: 5,  tint: { Tops: 0x6a7a8a, Bottoms: 0x444c58, Hats: 0x333a44, vanguard: 0x707a86 }, flank: 0.1 },
  heavy:    { key: 'launcher', wIdx: 5, grip: 'heavy',  hp: 260, speed: 2.4, run: 3.4, acc: 0.8,  range: 50, prefMin: 14, prefMax: 36, rate: 1,   burst: [1, 1], pause: [2.4, 3.4], dmg: 0,  react: 0.8,  mag: 99, tint: { Tops: 0x5a6a9a, Bottoms: 0x40465e, Hats: 0x30384e }, flank: 0.1, rocket: true },
};
const GRIP = {
  rifle: { idle: ['idle_rifle', 'idle'], walk: ['walk_rifle', 'walk'], run: ['run_rifle', 'run'], fire: ['fire_rifle', 'fire'], aim: ['aim_rifle', 'aim'] },
  heavy: { idle: ['idle_heavy', 'idle'], walk: ['walk_heavy', 'walk'], run: ['walk_heavy', 'run'], fire: ['fire_heavy', 'fire'], aim: ['fire_heavy', 'aim'] },
};

class EnemyManager {
  constructor(scene, template, gunTemplates, world, arena, onDamagePlayer, altTemplate) {
    this.scene = scene; this.template = template; this.alt = altTemplate || null; this.guns = gunTemplates || {}; this.world = world; this.arena = arena;
    this.onDamagePlayer = onDamagePlayer;
    this.enemies = []; this.waveNumber = 0; this.respawnTimer = 0; this.respawnDelay = 6;
    this.diff = { hp: 1, spd: 1, dmg: 1, acc: 1, react: 1, shooters: 3 };
    this.player = null; this.t = 0;
    this.onWave = null; this.onKill = null; this.onDrop = null;
    this._tmpA = new THREE.Vector3();
  }
  setDifficulty(d) { this.diff = d; }

  // ── clonagem do soldado (reamarra skeleton; r147 não tem SkeletonUtils.clone) ──
  _clone(tpl) {
    tpl = tpl || this.template;
    const root = tpl.scene.clone(true);
    const origSMs = []; tpl.scene.traverse(o => { if (o.isSkinnedMesh) origSMs.push(o); });
    if (!origSMs.length) return root;
    const os = origSMs[0].skeleton, byName = {};
    root.traverse(o => { if (o.isBone) byName[o.name] = o; });
    const bones = os.bones.map(b => byName[b.name]);
    const sk = new THREE.Skeleton(bones);
    for (let j = 0; j < sk.boneInverses.length && j < os.boneInverses.length; j++) sk.boneInverses[j].copy(os.boneInverses[j]);
    const cl = []; root.traverse(o => { if (o.isSkinnedMesh) cl.push(o); });
    for (let i = 0; i < cl.length && i < origSMs.length; i++) { cl[i].skeleton = sk; cl[i].bind(sk, origSMs[i].bindMatrix ? origSMs[i].bindMatrix.clone() : new THREE.Matrix4()); }
    root.traverse(o => { if (o.isMesh && o.material) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
    return root;
  }
  _clip(names, tpl) { const a = (tpl || this.template).animations || []; for (const n of names) { const c = a.find(x => x.name === n); if (c) return c; } return null; }

  _spawnOne(x, z, typeName) {
    const cfg = TYPES[typeName];
    let group, mixer = null, socket = null;
    const tpl = (cfg.model === 'alt' && this.alt) ? this.alt : this.template;
    if (tpl && tpl.scene) {
      group = this._clone(tpl);
      const bb = new THREE.Box3().setFromObject(group), h = bb.max.y - bb.min.y;
      const sc = h > 0 ? 1.95 / h : 1;
      group.scale.multiplyScalar(sc * (typeName === 'heavy' ? 1.08 : typeName === 'rusher' ? 0.97 : 1));
      // variações de cor por tipo (mesh por mesh)
      group.traverse(o => {
        if (!o.isMesh) return;
        const t = cfg.tint[(o.name || '').split('_')[0]];
        if (t !== undefined) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.color && m.color.setHex(t));
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      });
      const gt = this.guns[cfg.key];
      socket = group.getObjectByName('Socket_Hand_R');
      if (gt && gt.scene && socket) {
        const gc = gt.scene.clone(true);
        gc.traverse(o => { if (o.isMesh && o.material) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
        socket.add(gc);
      }
      if (tpl.animations && tpl.animations.length) mixer = new THREE.AnimationMixer(group);
    } else {
      group = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 8, 12), new THREE.MeshStandardMaterial({ color: 0xcc2222 })); m.position.y = 0.9; group.add(m);
    }
    const y = this.world.surfaceAt(x, z);
    group.position.set(x, y, z);
    this.scene.add(group);
    const d = this.diff, wv = 1 + 0.07 * (this.waveNumber - 1);
    const e = {
      type: typeName, cfg, tpl, mesh: group, mixer, actions: {}, anim: null, socket,
      hp: Math.round(cfg.hp * d.hp * wv), maxHp: 0, state: S.PATROL, yaw: Math.random() * 6.28, vx: 0, vz: 0,
      dest: null, path: [], pathIdx: 0, pathT: 0, needPath: false, arrived: true, run: false, steer: null,
      lastKnown: null, seenT: 99, canSee: false, perceiveT: Math.random() * 0.2, hadContact: false, react: 0,
      burstLeft: 0, burstCd: 0.5 + Math.random(), shotCd: 0, mag: cfg.mag, reloadT: 0,
      strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: 0, repoT: 4 + Math.random() * 5, repoActive: 0,
      coverT: 0, coverCd: 0, lookT: 0, patrolWait: Math.random() * 2, huntT: 14 + Math.random() * 14,
      stuckT: 0, lastX: x, lastZ: z, flinchT: 0, dead: false, deathT: 0, spd: cfg.speed * d.spd,
    };
    e.maxHp = e.hp;
    e.takeDamage = (amt, info) => this.damage(e, amt, info);
    this.enemies.push(e);
    this._play(e, 'idle');
    return e;
  }

  // ── Ondas ──
  spawnWave() {
    this.waveNumber++;
    const n = this.waveNumber;
    const total = Math.min(4 + n * 2, 16);
    const marks = n >= 3 ? Math.min(3, Math.floor((n - 1) / 2)) : 0;
    const heavies = n >= 4 ? Math.min(2, Math.floor((n - 2) / 3)) : 0;
    const rushers = n >= 2 ? Math.floor(total * 0.3) : 0;
    const list = [];
    for (let i = 0; i < heavies; i++) list.push('heavy');
    for (let i = 0; i < marks; i++) list.push('marksman');
    for (let i = 0; i < rushers; i++) list.push('rusher');
    while (list.length < total) list.push('grunt');
    const pp = this.player ? this.player.position : { x: 0, z: 40 };
    const eye = this.player ? this.player.getPosition() : null;
    let pts = this.arena.enemySpawns.filter(p => Math.hypot(p.x - pp.x, p.z - pp.z) > 32);
    const noLos = pts.filter(p => !eye || !this.world.los(p.x, this.world.surfaceAt(p.x, p.z) + 1.6, p.z, eye.x, eye.y, eye.z));
    if (noLos.length >= 3) pts = noLos;
    if (!pts.length) pts = this.arena.enemySpawns;
    list.forEach((t, i) => {
      const b = pts[(i + Math.floor(Math.random() * pts.length)) % pts.length];
      const q = this.world.nearestWalkable(b.x + (Math.random() - 0.5) * 3, b.z + (Math.random() - 0.5) * 3) || b;
      this._spawnOne(q.x, q.z, t);
    });
    if (this.onWave) this.onWave(n, list.length, { marks, heavies, rushers });
  }

  // ── Animação ──
  _action(e, names) {
    for (const n of names) {
      if (e.actions[n]) return e.actions[n];
      const c = this._clip([n], e.tpl);
      if (c) { e.actions[n] = e.mixer.clipAction(c); return e.actions[n]; }
    }
    return null;
  }
  _play(e, what, ts) {
    if (!e.mixer) return;
    const g = GRIP[e.cfg.grip];
    const names = what === 'die' ? ['die'] : what === 'hit' ? ['hit'] : g[what];
    const next = this._action(e, names || ['idle']);
    if (!next) return;
    if (e.anim === next) { if (ts) next.timeScale = ts; return; }
    next.reset(); next.setEffectiveWeight(1); next.timeScale = ts || 1;
    if (what === 'die' || what === 'hit') { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; } else next.setLoop(THREE.LoopRepeat, Infinity);
    next.fadeIn(what === 'die' ? 0.08 : 0.18).play();
    if (e.anim) e.anim.fadeOut(0.18);
    e.anim = next;
  }

  // ── Colisão de tiros do jogador (cilindro do corpo + esfera da cabeça) ──
  hitscan(o, d, maxT) {
    let best = null;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const p = e.mesh.position;
      // cabeça
      const hx = p.x - o.x, hy = p.y + 1.66 - o.y, hz = p.z - o.z, R = 0.21;
      const tc = hx * d.x + hy * d.y + hz * d.z;
      if (tc > 0 && tc < maxT) {
        const dd = hx * hx + hy * hy + hz * hz - tc * tc;
        if (dd < R * R) { const t = tc - Math.sqrt(R * R - dd); if (t > 0 && (!best || t < best.t)) best = { enemy: e, t, head: true }; }
      }
      // corpo (cilindro vertical)
      const ox = o.x - p.x, oz = o.z - p.z, a = d.x * d.x + d.z * d.z;
      if (a < 1e-8) continue;
      const bq = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - 0.4 * 0.4, disc = bq * bq - 4 * a * c;
      if (disc < 0) continue;
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t < 0 || t > maxT) continue;
      const y = o.y + d.y * t;
      if (y < p.y || y > p.y + 1.9) continue;
      if (!best || t < best.t) best = { enemy: e, t, head: false };
    }
    return best;
  }
  rocketHit(pos) {
    for (const e of this.enemies) { if (e.dead) continue; const p = e.mesh.position; if (Math.hypot(p.x - pos.x, p.z - pos.z) < 0.85 && pos.y > p.y - 0.2 && pos.y < p.y + 2.1) return true; }
    return false;
  }
  explosionDamage(pt, radius, dmg) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const p = e.mesh.position, d = Math.hypot(p.x - pt.x, p.y + 1 - pt.y, p.z - pt.z);
      if (d < radius) e.takeDamage(dmg * (1 - d / radius) + 15, { from: pt, explosion: true });
    }
  }

  damage(e, amt, info) {
    if (e.dead) return;
    e.hp -= amt;
    e.flinchT = 0.28;
    if (info && info.from && !e.canSee) { e.lastKnown = info.from.clone(); e.lastKnown.y = 0; e.hadContact = true; if (e.state !== S.COMBAT && e.state !== S.COVER) { e.state = S.INVESTIGATE; e.react = 0.3; e.needPath = true; } }
    e.mesh.traverse(o => { if (o.isMesh && o.material && o.material.emissive) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.emissive.setHex(0x992200); }); } });
    e.hitFlash = 0.1;
    if (e.hp > 0 && Math.random() < 0.45 && window.GameAudio && window.GameAudio.enemyPain) window.GameAudio.enemyPain(e.mesh.position);
    if (e.hp <= 0) this._kill(e, info);
  }
  _kill(e, info) {
    e.dead = true; e.state = S.DEAD; e.deathT = 7; e.burstLeft = 0;
    this._play(e, 'die');
    window.GameAudio && window.GameAudio.enemyDie(e.mesh.position);
    const head = info && info.head;
    const pts = 100 + this.waveNumber * 15 + (head ? 50 : 0) + (e.type === 'heavy' ? 200 : e.type === 'marksman' ? 80 : 0);
    if (this.onKill) this.onKill(e, pts, head);
    const r = Math.random();
    if (r < 0.3 && window.FX) window.FX.spawnPickup('health', e.mesh.position);
    else if (r < 0.62 && window.FX) window.FX.spawnPickup('ammo', e.mesh.position);
  }

  // ── Eventos sonoros ──
  noise(pos, radius) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.mesh.position.x - pos.x, e.mesh.position.z - pos.z);
      if (d > radius) continue;
      if (e.state === S.COMBAT && e.canSee) continue;
      const err = d * 0.07;
      e.lastKnown = new THREE.Vector3(pos.x + (Math.random() - 0.5) * err, 0, pos.z + (Math.random() - 0.5) * err);
      if (e.state === S.PATROL || e.state === S.INVESTIGATE) { e.state = S.INVESTIGATE; e.hadContact = true; e.react = Math.max(e.react, 0.25); e.needPath = true; e.lookT = 0; }
    }
  }
  _shout(e, pos) {
    for (const o of this.enemies) {
      if (o === e || o.dead) continue;
      if (o.mesh.position.distanceTo(e.mesh.position) < 30 && !(o.state === S.COMBAT && o.canSee)) {
        o.lastKnown = pos.clone(); o.lastKnown.y = 0; if (o.state === S.PATROL || o.state === S.INVESTIGATE) { o.state = S.INVESTIGATE; o.needPath = true; o.hadContact = true; }
      }
    }
  }

  // ── Navegação ──
  _setDest(e, x, z, run, force) {
    if (!force && e.dest && Math.hypot(e.dest.x - x, e.dest.z - z) < 2.5) { e.run = run; return; }
    e.dest = { x, z }; e.run = run; e.needPath = true; e.arrived = false; e.steer = null;
  }
  _clearDest(e) { e.dest = null; e.path = []; e.arrived = true; }

  _repath(e) {
    const p = e.mesh.position;
    const path = this.world.findPath(p.x, p.z, e.dest.x, e.dest.z);
    e.path = path || []; e.pathIdx = 0; e.needPath = false; e.pathT = e.state === S.COMBAT ? 0.9 : 2.5;
    if (!path) { e.arrived = true; e.dest = null; }
  }

  // ── Loop principal ──
  update(dt, player) {
    this.player = player; this.t += dt;
    const pEye = player.getPosition(), pFeet = player.position;
    this._budget = 3;
    let shooters = 0;
    for (const e of this.enemies) if (!e.dead && e.burstLeft > 0) shooters++;
    this._shooters = shooters;

    for (const e of this.enemies) {
      if (e.mixer) e.mixer.update(dt);
      if (e.hitFlash > 0) { e.hitFlash -= dt; if (e.hitFlash <= 0 && !e.dead) e.mesh.traverse(o => { if (o.isMesh && o.material && o.material.emissive) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.emissive.setHex(0x000000)); }); }
      if (e.dead) {
        e.deathT -= dt;
        if (e.deathT < 1.5) e.mesh.traverse(o => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.transparent = true; m.opacity = Math.max(0, e.deathT / 1.5); }); });
        continue;
      }
      this._think(e, dt, pEye, pFeet, player);
      this._move(e, dt);
      this._animate(e);
    }
    // remove corpos
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.deathT <= 0) { this.scene.remove(e.mesh); e.mesh.traverse(o => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }); this.enemies.splice(i, 1); }
    }
    const alive = this.enemies.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
    if (alive === 0) { this.respawnTimer += dt; if (this.respawnTimer >= this.respawnDelay) { this.respawnTimer = 0; this.spawnWave(); } }
    else this.respawnTimer = 0;
    this.alive = alive;
  }

  _think(e, dt, pEye, pFeet, player) {
    const cfg = e.cfg, d = this.diff, p = e.mesh.position;
    e.coverCd -= dt; e.flinchT = Math.max(0, e.flinchT - dt);
    // ── percepção (a cada ~0.15 s) ──
    e.perceiveT -= dt;
    if (e.perceiveT <= 0) {
      e.perceiveT = 0.12 + Math.random() * 0.08; e.acqT = e.canSee ? (e.acqT || 0) + 0.15 : 0;
      const dx = pEye.x - p.x, dz = pEye.z - p.z, dist = Math.hypot(dx, dz);
      let see = false;
      if (dist < 85) {
        const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
        const cosA = (dx * fx + dz * fz) / (dist || 1);
        const alerted = e.hadContact || e.state === S.COMBAT || e.state === S.COVER;
        const inFov = dist < 5 || cosA > (alerted ? -0.3 : 0.45);
        if (inFov) see = this.world.los(p.x, p.y + 1.62, p.z, pEye.x, pEye.y - (player.crouching ? 0.1 : 0.25), pEye.z);
      }
      if (see && !e.canSee && !e.hadContact) { e.react = cfg.react * d.react * (0.75 + Math.random() * 0.6); }
      if (see && !e.canSee && e.state !== S.COMBAT) { e.react = Math.max(e.react, 0.25 * d.react); }
      e.canSee = see;
      if (see) {
        e.seenT = 0; e.hadContact = true;
        e.lastKnown = new THREE.Vector3(pFeet.x, 0, pFeet.z);
        if (e.state !== S.COMBAT && e.state !== S.COVER) { e.state = S.COMBAT; this._shout(e, e.lastKnown); e.repoT = 3 + Math.random() * 3; }
      } else e.seenT += 0.15;
    }
    const dist = Math.hypot(pFeet.x - p.x, pFeet.z - p.z);
    e.huntT -= dt;

    switch (e.state) {
      case S.PATROL: {
        if (e.huntT <= 0) { // "sente" o jogador: vai investigar a região
          e.huntT = 16 + Math.random() * 12;
          e.lastKnown = new THREE.Vector3(pFeet.x + (Math.random() - 0.5) * 14, 0, pFeet.z + (Math.random() - 0.5) * 14);
          e.state = S.INVESTIGATE; e.needPath = true; break;
        }
        if (e.arrived) {
          e.patrolWait -= dt;
          if (e.patrolWait <= 0) {
            const nodes = this.arena.patrolNodes; const n = nodes[Math.floor(Math.random() * nodes.length)];
            if (Math.hypot(n.x - p.x, n.z - p.z) > 8) { this._setDest(e, n.x, n.z, false, true); e.patrolWait = 1 + Math.random() * 3; }
          }
        }
        break;
      }
      case S.INVESTIGATE: {
        if (!e.lastKnown) { e.state = S.PATROL; break; }
        if (e.lookT > 0) { // chegou: olha em volta
          e.lookT -= dt; e.yaw += Math.sin(this.t * 2 + e.strafeDir) * dt * 1.8; this._clearDest(e);
          if (e.lookT <= 0) { e.lastKnown = null; e.hadContact = false; e.state = S.PATROL; e.patrolWait = 0.5; }
        } else {
          this._setDest(e, e.lastKnown.x, e.lastKnown.z, true);
          if (e.arrived || dist < 2 || Math.hypot(e.lastKnown.x - p.x, e.lastKnown.z - p.z) < 2) e.lookT = 2 + Math.random() * 2;
        }
        break;
      }
      case S.COMBAT: {
        if (!e.canSee && e.seenT > 1.2) { e.state = S.INVESTIGATE; e.needPath = true; e.lookT = 0; break; }
        // pouca vida → procura cobertura
        if (e.hp < e.maxHp * 0.3 && e.coverCd <= 0 && cfg !== TYPES.heavy && e.canSee) {
          const nodes = this.arena.patrolNodes; let best = null, bd = 1e9;
          for (const n of nodes) {
            const dd = Math.hypot(n.x - p.x, n.z - p.z);
            if (dd < 4 || dd > 24 || dd >= bd) continue;
            const hy = this.world.surfaceAt(n.x, n.z);
            if (this.world.los(n.x, hy + 1.5, n.z, pEye.x, pEye.y, pEye.z)) continue;
            best = n; bd = dd;
          }
          if (best) { e.state = S.COVER; e.coverT = 3 + Math.random() * 3; this._setDest(e, best.x, best.z, true, true); e.coverCd = 14; break; }
        }
        // posicionamento
        e.repoT -= dt;
        if (e.repoActive > 0) {
          e.repoActive -= dt;
          if (e.arrived || e.repoActive <= 0) { e.repoActive = 0; e.steer = null; }
        } else {
          if (e.repoT <= 0 && Math.random() < cfg.flank) { // peek / flanco: nó com visão do jogador
            e.repoT = 5 + Math.random() * 6;
            const nodes = this.arena.patrolNodes; const cand = [];
            for (const n of nodes) {
              const dd = Math.hypot(n.x - pFeet.x, n.z - pFeet.z);
              if (dd < cfg.prefMin || dd > cfg.prefMax * 1.3) continue;
              if (Math.hypot(n.x - p.x, n.z - p.z) < 6) continue;
              const hy = this.world.surfaceAt(n.x, n.z);
              if (this.world.los(n.x, hy + 1.6, n.z, pEye.x, pEye.y, pEye.z)) cand.push(n);
            }
            if (cand.length) { const n = cand[Math.floor(Math.random() * cand.length)]; this._setDest(e, n.x, n.z, true, true); e.repoActive = 7; break; }
          } else if (e.repoT <= 0) e.repoT = 2 + Math.random() * 3;
          // avanço / recuo / strafe
          if (dist > cfg.prefMax) { this._setDest(e, pFeet.x, pFeet.z, true); }
          else {
            this._clearDest(e);
            let sx = 0, sz = 0, sp = 0;
            const nx = (p.x - pFeet.x) / (dist || 1), nz = (p.z - pFeet.z) / (dist || 1);
            if (dist < cfg.prefMin) { sx = nx; sz = nz; sp = e.spd * 1.1; }
            else {
              e.strafeT -= dt;
              if (e.strafeT <= 0) { e.strafeT = 0.8 + Math.random() * 1.6; e.strafeDir = Math.random() < 0.25 ? 0 : (Math.random() < 0.5 ? -1 : 1); }
              const slow = cfg === TYPES.marksman || cfg === TYPES.heavy ? 0.25 : 0.7;
              sx = -nz * e.strafeDir; sz = nx * e.strafeDir; sp = e.spd * slow * (e.strafeDir ? 1 : 0);
            }
            if (sp > 0) {
              const L = Math.hypot(sx, sz) || 1; sx /= L; sz /= L;
              if (this.world.lineClear(p.x, p.z, p.x + sx * 1.6, p.z + sz * 1.6)) e.steer = { x: sx, z: sz, s: sp };
              else { e.strafeDir = -e.strafeDir; e.steer = null; }
            } else e.steer = null;
          }
        }
        this._combatFire(e, dt, pEye, pFeet, player, dist);
        break;
      }
      case S.COVER: {
        if (e.arrived) {
          e.coverT -= dt;
          if (e.coverT <= 0) { e.state = S.INVESTIGATE; e.needPath = true; e.lookT = 0; e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.15); }
        }
        if (e.canSee && e.arrived) e.state = S.COMBAT;
        break;
      }
    }
  }

  _combatFire(e, dt, pEye, pFeet, player, dist) {
    const cfg = e.cfg;
    if (e.reloadT > 0) { e.reloadT -= dt; if (e.reloadT <= 0) e.mag = cfg.mag; return; }
    if (!e.canSee || dist > cfg.range) { e.burstLeft = 0; return; }
    if (e.react > 0) { e.react -= dt; return; }
    if (e.burstLeft > 0) {
      e.shotCd -= dt;
      if (e.shotCd <= 0) {
        this._shoot(e, pEye, pFeet, player, dist);
        e.burstLeft--; e.mag--; e.shotCd = 1 / cfg.rate;
        if (e.mag <= 0) { e.reloadT = 2.2; e.burstLeft = 0; }
        if (e.burstLeft <= 0) e.burstCd = cfg.pause[0] + Math.random() * (cfg.pause[1] - cfg.pause[0]);
      }
    } else {
      e.burstCd -= dt;
      if (e.burstCd <= 0 && this._shooters < this.diff.shooters) {
        e.burstLeft = cfg.burst[0] + Math.floor(Math.random() * (cfg.burst[1] - cfg.burst[0] + 1)); e.shotCd = 0; this._shooters++;
      } else if (e.burstCd <= 0) e.burstCd = 0.4 + Math.random() * 0.4; // sem "ficha": espera
    }
  }

  _shoot(e, pEye, pFeet, player, dist) {
    const cfg = e.cfg, d = this.diff, W = this.world;
    const mp = this._tmpA;
    if (e.socket) e.socket.getWorldPosition(mp); else mp.set(e.mesh.position.x, e.mesh.position.y + 1.3, e.mesh.position.z);
    const muzzle = mp.clone();
    muzzle.x += Math.sin(e.yaw) * 0.55; muzzle.z += Math.cos(e.yaw) * 0.55; muzzle.y += 0.05;
    const target = new THREE.Vector3(pFeet.x, pFeet.y + (player.crouching ? 0.75 : 1.15), pFeet.z);
    if (cfg.rocket) { // lidera o alvo
      const t = dist / 20; target.x += player.vel.x * t * 0.8; target.z += player.vel.z * t * 0.8;
      const dir = target.clone().sub(muzzle).normalize();
      window.FX.rocket(muzzle, dir, 'enemy', 20, 50 * d.dmg, 4.5);
      window.GameAudio.enemyShot(5, muzzle);
      window.FX.muzzle(muzzle, 0.9);
      return;
    }
    // chance de acerto
    const moveE = Math.hypot(e.vx, e.vz) > 0.8 ? 0.75 : 1, moveP = player.speed2D > 3 ? 0.8 : 1, crouch = player.crouching ? 0.85 : 1;
    let pHit = cfg.acc * d.acc * (1 - Math.min(0.85, dist / (cfg.range * 1.5))) * moveE * moveP * crouch * (e.flinchT > 0 ? 0.5 : 1);
    pHit *= Math.min(1, 0.4 + (e.acqT || 0) * 0.3); pHit = Math.max(0.03, Math.min(0.9, pHit));
    const hit = Math.random() < pHit;
    const aim = target.clone();
    if (hit) { aim.x += (Math.random() - 0.5) * 0.3; aim.y += (Math.random() - 0.5) * 0.5; aim.z += (Math.random() - 0.5) * 0.3; }
    else {
      const a = Math.random() * 6.28, r = 0.5 + Math.random() * 1.4 + dist * 0.01;
      const side = new THREE.Vector3(-(target.z - muzzle.z), 0, target.x - muzzle.x).normalize();
      aim.addScaledVector(side, Math.cos(a) * r); aim.y += Math.sin(a) * r * 0.6;
    }
    const dir = aim.clone().sub(muzzle); const len = dir.length(); dir.multiplyScalar(1 / len);
    const wh = W.raycast(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, len + 20);
    let end, blocked = false;
    const tPlayer = muzzle.distanceTo(target);
    if (wh && wh.t < (hit ? tPlayer : len + 20)) { blocked = true; end = muzzle.clone().addScaledVector(dir, wh.t); window.FX.impact(end, { x: wh.nx, y: wh.ny, z: wh.nz }, 'world'); }
    else end = muzzle.clone().addScaledVector(dir, hit ? tPlayer : len + 20);
    window.FX.tracer(muzzle, end, 0xff9a55, 0.014, 0.08);
    window.FX.muzzle(muzzle, cfg === TYPES.marksman ? 0.7 : 0.45);
    window.GameAudio.enemyShot(cfg.wIdx, muzzle);
    if (hit && !blocked) {
      this.onDamagePlayer(Math.round(cfg.dmg * d.dmg * (0.85 + Math.random() * 0.3)), e.mesh.position);
    } else if (!blocked) {
      // zunido da bala perto do jogador
      const closest = muzzle.clone().addScaledVector(dir, Math.max(0, Math.min(len + 20, pEye.clone().sub(muzzle).dot(dir))));
      if (closest.distanceTo(pEye) < 3.5) window.GameAudio.whiz(closest);
    }
  }

  // ── Movimento ──
  _move(e, dt) {
    const p = e.mesh.position, w = this.world, cfg = e.cfg;
    let tx = 0, tz = 0, sp = 0;
    const stunned = e.flinchT > 0 ? 0.35 : 1;
    // caminho
    if (e.dest) {
      e.pathT -= dt;
      if ((e.needPath || e.pathT <= 0) && this._budget > 0) { this._budget--; this._repath(e); }
      if (e.dest) {
        while (e.pathIdx < e.path.length && Math.hypot(e.path[e.pathIdx].x - p.x, e.path[e.pathIdx].z - p.z) < 0.7) e.pathIdx++;
        if (e.pathIdx < e.path.length) {
          const n = e.path[e.pathIdx], dx = n.x - p.x, dz = n.z - p.z, L = Math.hypot(dx, dz) || 1;
          tx = dx / L; tz = dz / L; sp = e.run ? cfg.run * this.diff.spd : e.spd * 0.55;
          e.arrived = false;
        } else if (!e.needPath && e.path.length) { e.arrived = true; }
        if (!e.needPath && e.path.length === 0) e.arrived = true;
        if (Math.hypot(e.dest.x - p.x, e.dest.z - p.z) < 1.2) { e.arrived = true; tx = tz = sp = 0; }
      }
    } else if (e.steer) { tx = e.steer.x; tz = e.steer.z; sp = e.steer.s; }
    // separação entre inimigos
    let sx = 0, sz = 0;
    for (const o of this.enemies) {
      if (o === e || o.dead) continue;
      const dx = p.x - o.mesh.position.x, dz = p.z - o.mesh.position.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.4 && d2 > 1e-4) { const d = Math.sqrt(d2); sx += dx / d * (1.2 - d); sz += dz / d * (1.2 - d); }
    }
    const wantVx = (tx * sp + sx * 2.2) * stunned, wantVz = (tz * sp + sz * 2.2) * stunned;
    const k = Math.min(1, dt * 9);
    e.vx += (wantVx - e.vx) * k; e.vz += (wantVz - e.vz) * k;
    const ox = p.x, oz = p.z;
    p.x += e.vx * dt; p.z += e.vz * dt;
    w.resolve(p, 0.45, p.y);
    const g = w.groundAt(p.x, p.z, p.y);
    p.y += (g - p.y) * Math.min(1, dt * 14);
    // travado?
    const moved = Math.hypot(p.x - ox, p.z - oz);
    if (sp > 0.5 && moved < sp * dt * 0.2) { e.stuckT += dt; if (e.stuckT > 0.7) { e.stuckT = 0; if (e.dest) e.needPath = true; e.strafeDir = -e.strafeDir; } } else e.stuckT = 0;
    // orientação
    let want = e.yaw;
    if ((e.state === S.COMBAT || e.state === S.COVER) && e.canSee && this.player) want = Math.atan2(this.player.position.x - p.x, this.player.position.z - p.z);
    else if (Math.hypot(e.vx, e.vz) > 0.4) want = Math.atan2(e.vx, e.vz);
    let dy = want - e.yaw; while (dy > Math.PI) dy -= 6.2832; while (dy < -Math.PI) dy += 6.2832;
    const turn = ((e.state === S.COMBAT) ? 9 : 5) * dt;
    e.yaw += Math.max(-turn, Math.min(turn, dy));
    e.mesh.rotation.y = e.yaw;
  }

  _animate(e) {
    if (!e.mixer) return;
    const sp = Math.hypot(e.vx, e.vz);
    if (e.flinchT > 0.12) { this._play(e, 'hit'); return; }
    if (sp > 0.45) {
      if (sp > e.cfg.speed * 1.15) this._play(e, 'run', Math.max(0.8, Math.min(1.4, sp / 4.6)));
      else this._play(e, 'walk', Math.max(0.7, Math.min(1.3, sp / 2.6)));
    } else if (e.burstLeft > 0 || (e.state === S.COMBAT && e.canSee && e.react <= 0)) this._play(e, e.burstLeft > 0 ? 'fire' : 'aim');
    else if (e.state === S.COMBAT || e.state === S.COVER) this._play(e, 'aim');
    else this._play(e, 'idle');
  }

  clear() {
    for (const e of this.enemies) {
      if (e.mixer) e.mixer.stopAllAction();
      if (e.mesh && e.mesh.parent) e.mesh.parent.remove(e.mesh);
      e.mesh && e.mesh.traverse(o => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    }
    this.enemies = []; this.waveNumber = 0; this.respawnTimer = 0;
  }
}
window.EnemyManager = EnemyManager;
})();
