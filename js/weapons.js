// ═══════════════════════════════════════════════════════════
// ARMAS — hitscan com cone de dispersão, recuo na câmera, mira (botão direito / scope do sniper),
// munição de reserva, animações de view-model (sway, bob, recarga, troca), foguetes do lançador
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const WEAPONS = [
  { name: 'PISTOL',   key: '1', file: 'weapon_pistol.glb',   mag: 12, reserve: 72,  rate: 5.5, spread: 0.010, dmg: 36, recoil: 0.014, auto: false, zoom: 0.85, reload: 1.3 },
  { name: 'SMG',      key: '2', file: 'weapon_smg.glb',      mag: 30, reserve: 180, rate: 13,  spread: 0.018, dmg: 19, recoil: 0.007, auto: true,  zoom: 0.85, reload: 1.5 },
  { name: 'RIFLE',    key: '3', file: 'weapon_rifle.glb',    mag: 30, reserve: 120, rate: 9,   spread: 0.007, dmg: 30, recoil: 0.011, auto: true,  zoom: 0.78, reload: 1.9 },
  { name: 'SHOTGUN',  key: '4', file: 'weapon_shotgun.glb',  mag: 6,  reserve: 36,  rate: 1.3, spread: 0.050, dmg: 15, recoil: 0.060, auto: false, zoom: 0.9,  reload: 2.4, pellets: 9 },
  { name: 'SNIPER',   key: '5', file: 'weapon_sniper.glb',   mag: 5,  reserve: 25,  rate: 0.9, spread: 0.050, dmg: 130, recoil: 0.050, auto: false, zoom: 0.20, reload: 2.8, scope: true },
  { name: 'LAUNCHER', key: '6', file: 'weapon_launcher.glb', mag: 2,  reserve: 8,   rate: 0.9, spread: 0.004, dmg: 150, recoil: 0.045, auto: false, zoom: 0.9,  reload: 3.0, rocket: true },
];
const HEAD_MULT = 2.5;

class WeaponSystem {
  constructor(camera, scene, gunTemplates, player, world) {
    this.camera = camera; this.scene = scene; this.player = player; this.world = world;
    this.enemies = null;
    this.templates = gunTemplates || {};
    this.cur = 1; this.last = 2;
    this.slots = WEAPONS.map(c => ({ cfg: c, ammo: c.mag, reserve: c.reserve, reloading: false, rt: 0, cd: 0, heat: 0, view: null, muzzle: new THREE.Vector3(0, 0, -0.5) }));
    this.shooting = false; this.fireQueued = false; this.ads = false;
    this.switchT = 0; this.kickZ = 0; this.rkick = 0; this.sway = { x: 0, y: 0 }; this.lastYaw = 0; this.lastPitch = 0;
    this.muzzleLight = new THREE.PointLight(0xffaa44, 0, 7, 2);
    this.muzzleLight.position.set(0.3, -0.2, -0.9); camera.add(this.muzzleLight);
    scene.add(camera);
    for (let i = 0; i < WEAPONS.length; i++) this._build(i);

    this._md = (e) => { if (!document.pointerLockElement) return; if (e.button === 0) { this.shooting = true; this.fireQueued = true; } else if (e.button === 2) this._setAds(true); };
    this._mu = (e) => { if (e.button === 0) this.shooting = false; else if (e.button === 2) this._setAds(false); };
    this._cm = (e) => e.preventDefault();
    this._kd = (e) => {
      if (e.code === 'KeyR') this.reload();
      const n = parseInt(e.key); if (n >= 1 && n <= 6) this.switchTo(n - 1);
      if (e.code === 'KeyQ') this.switchTo(this.last);
    };
    this._wh = (e) => { if (!document.pointerLockElement) return; this.switchTo(((this.cur + (e.deltaY > 0 ? 1 : -1)) % 6 + 6) % 6); };
    document.addEventListener('mousedown', this._md); document.addEventListener('mouseup', this._mu);
    document.addEventListener('contextmenu', this._cm); document.addEventListener('keydown', this._kd);
    document.addEventListener('wheel', this._wh, { passive: true });
    this._bar();
    this._show();
  }

  get slot() { return this.slots[this.cur]; }
  get ammo() { return this.slot.ammo; }
  get reserve() { return this.slot.reserve; }

  _build(i) {
    const key = WEAPONS[i].file.replace('weapon_', '').replace('.glb', '');
    let model;
    const t = this.templates[key];
    if (t && t.scene) {
      model = t.scene.clone(true);
      model.rotation.set(0, Math.PI / 2, 0);
      model.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      model.updateMatrixWorld(true);
      const b0 = new THREE.Box3().setFromObject(model), c0 = b0.getCenter(new THREE.Vector3()), s0 = b0.getSize(new THREE.Vector3());
      model.position.sub(c0);
      model.scale.multiplyScalar(0.62 / Math.max(s0.x, s0.y, s0.z, 0.001));
      // clona materiais para não compartilhar com o inimigo
      model.traverse(o => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); o.castShadow = false; o.frustumCulled = false; if (o.material.color) { o.material.color.multiplyScalar(1.7); } if ('roughness' in o.material) { o.material.roughness = 0.55; o.material.metalness = 0.35; } } });
    } else {
      model = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.45), new THREE.MeshStandardMaterial({ color: 0x333344 }));
    }
    const pivot = new THREE.Group(); pivot.add(model);
    pivot.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(pivot);
    this._arms(pivot, bb, i);
    this.slots[i].muzzle.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2 + 0.01, bb.min.z - 0.02);
    pivot.userData.isViewModel = true; pivot.visible = false;
    this.camera.add(pivot); this.slots[i].view = pivot;
  }
  // Braços/mãos do jogador (geometria simples) — mão direita na empunhadura, esquerda sob o cano
  _arms(pivot, bb, i) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2c3720, roughness: 0.9 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x0e1012, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x80573f, roughness: 0.8 });
    const arm = (hand, dirx, len) => {
      const g = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, len), sleeve);
      fore.position.z = len / 2 + 0.05;
      const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.05), skin); wrist.position.z = 0.04;
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.13), glove); palm.position.z = -0.01;
      g.add(fore, wrist, palm);
      g.position.copy(hand); g.rotation.set(0.12, dirx, 0, 'YXZ');
      g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      return g;
    };
    const cx = (bb.min.x + bb.max.x) / 2, zr = bb.max.z - (bb.max.z - bb.min.z) * 0.28, y0 = bb.min.y + 0.04;
    const right = arm(new THREE.Vector3(cx, y0, zr), -0.35, 0.55);
    pivot.add(right);
    if (i !== 0) { const left = arm(new THREE.Vector3(cx, bb.min.y + 0.08, bb.min.z + (bb.max.z - bb.min.z) * 0.38), 0.55, 0.65); pivot.add(left); }
  }
  _show() { this.slots.forEach((s, i) => { s.view.visible = i === this.cur; }); }

  _bar() {
    const bar = document.getElementById('weapon-bar'); if (!bar) return;
    bar.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const el = document.createElement('div'); el.className = 'wpn-slot' + (i === this.cur ? ' active' : '');
      el.innerHTML = `<span class="key">${w.key}</span><span class="name">${w.name}</span>`;
      el.addEventListener('click', () => this.switchTo(i)); bar.appendChild(el);
    });
    const wn = document.getElementById('weapon-name'); if (wn) wn.textContent = WEAPONS[this.cur].name;
  }

  _setAds(on) {
    this.ads = on;
    this.player.zoomTarget = on ? this.slot.cfg.zoom : 1;
  }

  switchTo(i) {
    if (i === this.cur || i < 0 || i >= WEAPONS.length) return;
    this.last = this.cur; this.slot.reloading = false;
    this.cur = i; this.switchT = 0.28; this._show();
    this._setAds(this.ads);
    document.querySelectorAll('.wpn-slot').forEach((el, k) => el.classList.toggle('active', k === i));
    const wn = document.getElementById('weapon-name'); if (wn) wn.textContent = WEAPONS[i].name;
    window.GameAudio && window.GameAudio.switchWeapon();
  }

  reload() {
    const s = this.slot;
    if (s.reloading || s.ammo >= s.cfg.mag || s.reserve <= 0) return;
    s.reloading = true; s.rt = s.cfg.reload; this._setAds(false);
    window.GameAudio && window.GameAudio.reload(this.cur, s.cfg.reload);
  }

  addAmmo() {
    let any = false;
    this.slots.forEach(s => { const max = s.cfg.reserve; if (s.reserve < max) { s.reserve = Math.min(max, s.reserve + Math.ceil(max * 0.5)); any = true; } });
    return any;
  }

  _muzzleWorld() { return this.camera.localToWorld(this.slot.muzzle.clone().add(this.slot.view.position)); }

  fire() {
    const s = this.slot, c = s.cfg, p = this.player;
    const origin = this.camera.position.clone();
    const scoped = c.scope && this.ads && p.zoom < 0.4;
    let spread = c.spread;
    if (c.scope) spread = scoped ? 0.0015 : 0.06;
    if (this.ads && !c.scope) spread *= 0.55;
    spread *= 1 + Math.min(1.6, p.speed2D / 5) + (p.onGround ? 0 : 2.5) + s.heat;
    if (p.crouching) spread *= 0.65;
    const mz = this._muzzleWorld();
    const n = c.pellets || 1;
    const quat = this.camera.quaternion;
    let hitEnemy = false, hitHead = false;
    for (let i = 0; i < n; i++) {
      const r = spread * Math.sqrt(Math.random()), th = Math.random() * 6.2832;
      const dir = new THREE.Vector3(r * Math.cos(th), r * Math.sin(th), -1).normalize().applyQuaternion(quat);
      if (c.rocket) { window.FX.rocket(mz.clone(), dir, 'player', 30, c.dmg, 6); continue; }
      const maxT = 160;
      const wh = this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxT);
      const eh = this.enemies ? this.enemies.hitscan(origin, dir, wh ? wh.t : maxT) : null;
      let end, normal = null, kind = 'world';
      if (eh) {
        end = origin.clone().addScaledVector(dir, eh.t); kind = 'flesh'; normal = { x: -dir.x, y: 0.3, z: -dir.z };
        eh.enemy.takeDamage(c.dmg * (eh.head ? HEAD_MULT : 1), { head: eh.head, from: origin, point: end });
        hitEnemy = true; hitHead = hitHead || eh.head;
        window.FX.impact(end, normal, 'flesh');
      } else if (wh) {
        end = origin.clone().addScaledVector(dir, wh.t); normal = { x: wh.nx, y: wh.ny, z: wh.nz };
        window.FX.impact(end, normal, 'world');
        if (i === 0) window.GameAudio.impact(end);
      } else end = origin.clone().addScaledVector(dir, 120);
      if (i < 3) window.FX.tracer(mz, end, 0xffe9a0, c.scope ? 0.02 : 0.012, 0.07);
    }
    // clarão no cano + luz
    this.muzzleLight.intensity = c.rocket ? 5 : 7; this._mfT = 0.05;
    window.FX.muzzle(mz, c.rocket ? 0.9 : c.pellets ? 0.8 : 0.5);
    // recuo
    p.addRecoil(c.recoil * (this.ads ? 0.7 : 1), (Math.random() - 0.5) * c.recoil * 0.7);
    this.kickZ += c.rocket ? 0.14 : c.pellets ? 0.12 : 0.05 + c.recoil * 2;
    this.rkick += c.recoil * 3;
    s.heat = Math.min(1.8, s.heat + (c.auto ? 0.12 : 0.25));
    window.GameAudio.weaponShot(this.cur, null);
    if (this.onNoise) this.onNoise(origin, c.rocket ? 70 : 62);
    if (hitEnemy) {
      const hm = document.getElementById('hit-marker');
      if (hm) { hm.style.opacity = '1'; hm.style.borderColor = hitHead ? '#ffd23a' : ''; hm.classList.toggle('head', hitHead); clearTimeout(this._hmT); this._hmT = setTimeout(() => { hm.style.opacity = '0'; }, 130); }
      window.GameAudio.hitMarker(hitHead);
    }
    s.ammo--;
    s.cd = 1 / c.rate;
    if (c.scope || c.rocket) this._setAds(false);
    this.fireQueued = false;
  }

  update(dt) {
    const s = this.slot, c = s.cfg, p = this.player;
    s.heat = Math.max(0, s.heat - dt * 1.6);
    if (this._mfT > 0) { this._mfT -= dt; if (this._mfT <= 0) this.muzzleLight.intensity = 0; }
    if (s.reloading) {
      s.rt -= dt;
      if (s.rt <= 0) { const need = c.mag - s.ammo, take = Math.min(need, s.reserve); s.ammo += take; s.reserve -= take; s.reloading = false; }
    } else {
      s.cd -= dt;
      const want = c.auto ? this.shooting : this.fireQueued;
      if (want && s.cd <= 0 && this.switchT <= 0) {
        if (s.ammo > 0) this.fire();
        else { this.fireQueued = false; s.cd = 0.25; window.GameAudio.dry(); if (s.reserve > 0) this.reload(); }
      }
      if (!c.auto && !this.shooting) this.fireQueued = false;
    }
    this.switchT = Math.max(0, this.switchT - dt);

    // ── view model ──
    const v = s.view;
    const scopedNow = c.scope && this.ads && p.zoom < 0.5;
    v.visible = !scopedNow;
    const so = document.getElementById('scope'); if (so) so.style.display = scopedNow ? 'block' : 'none';
    const adsK = this.ads && !c.scope ? 1 : 0;
    const bx = 0.25 * (1 - adsK), by = -0.23 + 0.045 * adsK, bz = -0.55;
    // sway pelo movimento do mouse
    const dy = p.yaw - this.lastYaw, dp = p.pitch - this.lastPitch; this.lastYaw = p.yaw; this.lastPitch = p.pitch;
    this.sway.x += (Math.max(-0.06, Math.min(0.06, -dy * 0.8)) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (Math.max(-0.05, Math.min(0.05, -dp * 0.8)) - this.sway.y) * Math.min(1, dt * 8);
    const bob = p.onGround ? Math.sin(p.bobT * 2) * 0.008 * (1 - adsK * 0.8) : 0, bobx = p.onGround ? Math.cos(p.bobT) * 0.008 * (1 - adsK * 0.8) : 0;
    this.kickZ *= Math.pow(0.0005, dt); this.rkick *= Math.pow(0.001, dt);
    const sw = this.switchT / 0.28;
    let rl = 0; if (s.reloading) { const t = 1 - s.rt / c.reload; rl = Math.sin(Math.min(1, t) * Math.PI); }
    v.position.set(bx + this.sway.x + bobx, by + this.sway.y + bob - sw * 0.35 - rl * 0.22, bz + this.kickZ);
    v.rotation.set(this.rkick - rl * 0.5 + sw * 0.6, -this.sway.x * 1.5, rl * 0.45 - this.sway.x * 0.8);
  }

  dispose() {
    document.removeEventListener('mousedown', this._md); document.removeEventListener('mouseup', this._mu);
    document.removeEventListener('contextmenu', this._cm); document.removeEventListener('keydown', this._kd);
    document.removeEventListener('wheel', this._wh);
    for (const s of this.slots) if (s.view && s.view.parent) s.view.parent.remove(s.view);
    if (this.muzzleLight.parent) this.muzzleLight.parent.remove(this.muzzleLight);
  }
}
window.WeaponSystem = WeaponSystem;
window.WEAPONS = WEAPONS;
})();
