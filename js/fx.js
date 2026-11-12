// ═══════════════════════════════════════════════════════════
// FX — partículas em pool, traçantes, marcas de bala, clarões, explosões, foguetes e pickups
// (tudo pré-alocado: sem criar geometria/material a cada tiro)
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const V = () => new THREE.Vector3();
const FX = {
  shake: 0,
  onExplosion: null,       // (point, radius, owner, damage)
  rocketCheck: null,       // (pos, owner) -> true se atingiu um personagem
  onPickup: null,

  init(scene, camera, world) {
    this.scene = scene; this.camera = camera; this.world = world;
    this.t = 0;
    // textura macia
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.softTex = new THREE.CanvasTexture(c);
    // partículas
    this.parts = []; this.pi = 0;
    for (let i = 0; i < 260; i++) {
      const m = new THREE.SpriteMaterial({ map: this.softTex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; s.userData.isFx = true; scene.add(s);
      this.parts.push({ s, v: V(), life: 0, max: 1, s0: 1, s1: 1, o: 1, grav: 0, drag: 0 });
    }
    // traçantes
    this.tracers = []; this.ti = 0;
    const tg = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true); tg.translate(0, 0.5, 0);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(tg, m); mesh.visible = false; mesh.userData.isFx = true; mesh.frustumCulled = false; scene.add(mesh);
      this.tracers.push({ mesh, life: 0, max: 0.08 });
    }
    // marcas de bala
    const dc = document.createElement('canvas'); dc.width = dc.height = 32;
    const dg = dc.getContext('2d'); const dr = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    dr.addColorStop(0, 'rgba(10,8,6,0.95)'); dr.addColorStop(0.5, 'rgba(25,20,15,0.6)'); dr.addColorStop(1, 'rgba(30,25,20,0)');
    dg.fillStyle = dr; dg.fillRect(0, 0, 32, 32);
    const dtex = new THREE.CanvasTexture(dc);
    this.decals = []; this.di = 0;
    const dgeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 70; i++) {
      const m = new THREE.MeshBasicMaterial({ map: dtex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(dgeo, m); mesh.visible = false; mesh.userData.isFx = true; scene.add(mesh);
      this.decals.push(mesh);
    }
    // luz de explosão / clarão
    this.flashLight = new THREE.PointLight(0xffa040, 0, 30, 2); this.flashLight.userData.isFx = true; scene.add(this.flashLight);
    this.flashT = 0;
    this.rockets = []; this.pickups = [];
    this._pickupTex();
  },

  clear() {
    for (const p of this.parts) { p.life = 0; p.s.visible = false; }
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const d of this.decals) d.visible = false;
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets = [];
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = []; this.shake = 0;
  },

  particle(pos, vel, life, s0, s1, color, opacity, grav, additive, drag) {
    const p = this.parts[this.pi]; this.pi = (this.pi + 1) % this.parts.length;
    p.s.position.copy(pos); p.v.copy(vel); p.life = p.max = life; p.s0 = s0; p.s1 = s1; p.o = opacity; p.grav = grav || 0; p.drag = drag || 0;
    p.s.material.color.setHex(color); p.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.s.material.opacity = opacity; p.s.scale.set(s0, s0, 1); p.s.visible = true;
  },

  tracer(from, to, color, r, life) {
    const t = this.tracers[this.ti]; this.ti = (this.ti + 1) % this.tracers.length;
    const d = to.clone().sub(from), len = d.length(); if (len < 0.05) return;
    d.multiplyScalar(1 / len);
    t.mesh.position.copy(from); t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    t.mesh.scale.set(r || 0.012, len, r || 0.012);
    t.mesh.material.color.setHex(color || 0xffe9a0); t.mesh.material.opacity = 0.9;
    t.life = t.max = life || 0.07; t.mesh.visible = true;
  },

  muzzle(pos, size) {
    this.particle(pos, V(), 0.05, size || 0.5, (size || 0.5) * 1.3, 0xffcc66, 1, 0, true);
    this.particle(pos, V(), 0.035, (size || 0.5) * 0.55, (size || 0.5) * 0.7, 0xffffff, 1, 0, true);
  },

  impact(point, n, kind) {
    // kind: 'world' | 'flesh'
    const col = kind === 'flesh' ? 0xaa2018 : 0xc9b08a;
    for (let i = 0; i < 5; i++) {
      const v = new THREE.Vector3(n.x + (Math.random() - 0.5) * 1.2, n.y + 0.2 + Math.random() * 0.8, n.z + (Math.random() - 0.5) * 1.2).multiplyScalar(1.5 + Math.random() * 2.5);
      this.particle(point, v, 0.35 + Math.random() * 0.3, 0.07, 0.03, kind === 'flesh' ? 0xcc2a20 : 0xffe0a0, 1, -9, kind !== 'flesh');
    }
    this.particle(point, new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(0.5), 0.55, 0.25, 0.8, col, 0.45, 0, false, 2);
    if (kind !== 'flesh') {
      const d = this.decals[this.di]; this.di = (this.di + 1) % this.decals.length;
      d.position.set(point.x + n.x * 0.02, point.y + n.y * 0.02, point.z + n.z * 0.02);
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, n.y, n.z));
      d.rotateZ(Math.random() * 6.28); const s = 0.16 + Math.random() * 0.1; d.scale.set(s, s, 1); d.visible = true;
    }
  },

  explosion(pos, radius, owner, damage) {
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6);
      this.particle(pos, v, 0.5 + Math.random() * 0.4, 1.4, 4.2, 0xff8a30, 0.9, 0, true, 2.5);
    }
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3);
      this.particle(pos, v, 1.6 + Math.random() * 1.2, 1.5, 6, 0x4a4540, 0.65, 0.5, false, 1.2);
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.28, up = Math.random() * 0.8;
      const v = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).multiplyScalar(6 + Math.random() * 10);
      this.particle(pos, v, 0.5 + Math.random() * 0.4, 0.12, 0.05, 0xffcc66, 1, -12, true);
    }
    this.flashLight.position.copy(pos); this.flashLight.position.y += 1; this.flashLight.intensity = 9; this.flashT = 0.35;
    const d = pos.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, Math.min(1, 14 / (d + 2)));
    if (window.GameAudio) window.GameAudio.explosion(pos);
    if (this.onExplosion) this.onExplosion(pos, radius, owner, damage);
  },

  rocket(from, dir, owner, speed, damage, radius) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x556655, metalness: 0.4, roughness: 0.5 }));
    body.rotation.x = Math.PI / 2; g.add(body);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0xffaa44, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(0.7, 0.7, 1); glow.position.z = 0.3; g.add(glow);
    g.position.copy(from); g.lookAt(from.clone().add(dir)); g.userData.isFx = true;
    this.scene.add(g);
    this.rockets.push({ mesh: g, pos: from.clone(), dir: dir.clone(), speed: speed || 26, life: 6, owner, damage: damage || 120, radius: radius || 5 });
  },

  _pickupTex() {
    const mk = (bg, draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 64, 64); draw(g); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; };
    this.pickupTex = {
      health: mk('#f4f4f4', g => { g.fillStyle = '#d62a2a'; g.fillRect(24, 10, 16, 44); g.fillRect(10, 24, 44, 16); }),
      ammo: mk('#4a5a2a', g => { g.fillStyle = '#e6c24a'; for (let i = 0; i < 4; i++) g.fillRect(10 + i * 12, 14, 8, 36); }),
    };
  },
  spawnPickup(type, pos) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), new THREE.MeshStandardMaterial({ map: this.pickupTex[type], emissive: type === 'health' ? 0x331111 : 0x222211, roughness: 0.6 }));
    m.position.set(pos.x, pos.y + 0.5, pos.z); m.castShadow = true; m.userData.isFx = true;
    this.scene.add(m);
    this.pickups.push({ mesh: m, type, base: pos.y + 0.5, life: 40 });
  },

  update(dt, playerPos) {
    this.t += dt;
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const k = 1 - p.life / p.max;
      if (p.drag) p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.v.y += p.grav * dt;
      p.s.position.addScaledVector(p.v, dt);
      const s = p.s0 + (p.s1 - p.s0) * k; p.s.scale.set(s, s, 1);
      p.s.material.opacity = p.o * (1 - k * k);
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = 0.9 * (t.life / t.max);
    }
    if (this.flashT > 0) { this.flashT -= dt; this.flashLight.intensity = Math.max(0, 9 * this.flashT / 0.35); }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    // foguetes
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const step = r.speed * dt;
      const h = this.world.raycast(r.pos.x, r.pos.y, r.pos.z, r.dir.x, r.dir.y, r.dir.z, step + 0.1);
      let boom = false, at = null;
      if (h) { boom = true; at = r.pos.clone().addScaledVector(r.dir, Math.max(0, h.t - 0.15)); }
      else {
        r.pos.addScaledVector(r.dir, step);
        if (this.rocketCheck && this.rocketCheck(r.pos, r.owner)) { boom = true; at = r.pos.clone(); }
      }
      if (r.life <= 0) { boom = true; at = r.pos.clone(); }
      r.mesh.position.copy(r.pos);
      this.particle(r.pos, V(), 0.45, 0.3, 0.9, 0x888078, 0.5, 0.4, false);
      this.particle(r.pos, V(), 0.12, 0.35, 0.1, 0xffaa44, 0.9, 0, true);
      if (boom) { this.scene.remove(r.mesh); this.rockets.splice(i, 1); this.explosion(at, r.radius, r.owner, r.damage); }
    }
    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt; p.mesh.rotation.y += dt * 1.8; p.mesh.position.y = p.base + Math.sin(this.t * 3 + i) * 0.08;
      let take = false;
      if (playerPos) { const dx = playerPos.x - p.mesh.position.x, dz = playerPos.z - p.mesh.position.z; if (dx * dx + dz * dz < 1.4 && Math.abs(playerPos.y - p.base) < 2.2) take = true; }
      if (take && this.onPickup && this.onPickup(p.type)) { this.scene.remove(p.mesh); this.pickups.splice(i, 1); }
      else if (p.life <= 0) { this.scene.remove(p.mesh); this.pickups.splice(i, 1); }
    }
  },
};
window.FX = FX;
})();
