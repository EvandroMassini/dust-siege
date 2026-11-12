// ═══════════════════════════════════════════════════════════
// PLAYER — movimento com aceleração, pulo, agachar, degraus/rampas (via World), passos, recuo de câmera
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
class Player {
  constructor(camera, scene, world, getSens) {
    this.camera = camera; this.scene = scene; this.world = world; this.getSens = getSens;
    this.health = 100; this.maxHealth = 100;
    this.position = new THREE.Vector3(0, 0, 0); // pés
    this.vel = { x: 0, z: 0 }; this.vy = 0; this.onGround = true;
    this.yaw = 0; this.pitch = 0; this.kick = 0; this.kickYaw = 0;
    this.speed = 7.4; this.jumpForce = 8.2; this.gravity = -22;
    this.radius = 0.4;
    this.crouching = false; this.eyeH = 1.7; this.crouchEyeH = 1.05; this.curEyeH = 1.7;
    this.viewY = 0;           // altura suavizada (degraus)
    this.bobT = 0; this.stepDist = 0;
    this.baseHFov = 92; this.zoom = 1; this.zoomTarget = 1;
    this.landDip = 0;
    this.moving = false; this.speed2D = 0;
    this.keys = {};
    this.onNoise = null; this.onStep = null;

    this._kd = (e) => { this.keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); };
    this._ku = (e) => { this.keys[e.code] = false; };
    this._mm = (e) => {
      if (!document.pointerLockElement) return;
      const s = 0.0022 * this.getSens() * Math.min(1, this.camera.fov / 60 + 0.25);
      this.yaw -= e.movementX * s; this.pitch -= e.movementY * s;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
    };
    this._ck = () => { if (!document.pointerLockElement && window.__gameRunning) document.getElementById('game-container').requestPointerLock(); };
    this._clr = () => { this.keys = {}; };
    window.addEventListener('blur', this._clr);
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this._clr(); });
    document.addEventListener('visibilitychange', this._clr);
    document.addEventListener('keydown', this._kd); document.addEventListener('keyup', this._ku);
    document.addEventListener('mousemove', this._mm); document.addEventListener('click', this._ck);
    this.camera.rotation.order = 'YXZ';
  }

  get eye() { return new THREE.Vector3(this.position.x, this.position.y + this.curEyeH, this.position.z); }
  getPosition() { return new THREE.Vector3(this.position.x, this.position.y + this.curEyeH, this.position.z); }
  setPosition(x, y, z) { this.position.set(x, y, z); this.viewY = y; this.vel.x = this.vel.z = 0; this.vy = 0; this.onGround = true; }
  addRecoil(p, y) { this.pitch += p * 0.55; this.kick += p * 0.9; this.yaw += y; this.kickYaw += y * 0.5; this.pitch = Math.min(Math.PI / 2 - 0.05, this.pitch); }

  takeDamage(amount) { this.health -= amount; }

  update(dt) {
    const k = this.keys, w = this.world;
    this.crouching = !!(k.ShiftLeft || k.ShiftRight || k.KeyC);
    const tEye = this.crouching ? this.crouchEyeH : this.eyeH;
    this.curEyeH += (tEye - this.curEyeH) * Math.min(1, dt * 12);

    // ── horizontal ──
    let ix = 0, iz = 0;
    if (k.KeyW) { ix -= Math.sin(this.yaw); iz -= Math.cos(this.yaw); }
    if (k.KeyS) { ix += Math.sin(this.yaw); iz += Math.cos(this.yaw); }
    if (k.KeyA) { ix -= Math.cos(this.yaw); iz += Math.sin(this.yaw); }
    if (k.KeyD) { ix += Math.cos(this.yaw); iz -= Math.sin(this.yaw); }
    const il = Math.hypot(ix, iz);
    const maxS = this.crouching ? this.speed * 0.45 : this.speed * (this.zoomTarget < 1 ? 0.7 : 1);
    if (il > 0) { ix /= il; iz /= il; }
    const acc = this.onGround ? Math.min(1, dt * 14) : Math.min(1, dt * 2.2);
    this.vel.x += (ix * maxS - this.vel.x) * (il > 0 ? acc : Math.min(1, dt * (this.onGround ? 11 : 0.8)));
    this.vel.z += (iz * maxS - this.vel.z) * (il > 0 ? acc : Math.min(1, dt * (this.onGround ? 11 : 0.8)));
    this.position.x += this.vel.x * dt; this.position.z += this.vel.z * dt;
    w.resolve(this.position, this.radius, this.position.y);
    this.speed2D = Math.hypot(this.vel.x, this.vel.z);
    this.moving = this.speed2D > 0.5;

    // ── vertical (degraus, rampas, plataformas, queda) ──
    if (k.Space && this.onGround) { this.vy = this.jumpForce; this.onGround = false; }
    const g = w.groundAt(this.position.x, this.position.z, this.position.y);
    if (this.onGround) {
      if (g < this.position.y - 0.65) { this.onGround = false; this.vy = 0; }
      else this.position.y = g;
    }
    if (!this.onGround) {
      const vyBefore = this.vy;
      this.vy += this.gravity * dt; this.position.y += this.vy * dt;
      if (this.position.y <= g && this.vy <= 0) {
        this.position.y = g; this.onGround = true;
        if (vyBefore < -5) { this.landDip = Math.min(0.2, -vyBefore * 0.012); if (window.GameAudio) window.GameAudio.land(); }
        this.vy = 0;
      }
      // bater a cabeça em teto baixo (vergas)
      if (this.vy > 0) {
        for (const s of w.solids) {
          if (s.min[1] > this.position.y + 1.0 && s.min[1] < this.position.y + this.curEyeH + 0.2 &&
            this.position.x > s.min[0] - 0.3 && this.position.x < s.max[0] + 0.3 && this.position.z > s.min[2] - 0.3 && this.position.z < s.max[2] + 0.3) { this.vy = -1; break; }
        }
      }
    }
    // suaviza subida de degraus na câmera
    this.viewY += (this.position.y - this.viewY) * Math.min(1, dt * (this.position.y > this.viewY ? 16 : 24));
    if (Math.abs(this.position.y - this.viewY) > 1.2) this.viewY = this.position.y;
    this.landDip *= Math.pow(0.001, dt);

    // ── passos ──
    if (this.onGround && this.moving) {
      this.stepDist += this.speed2D * dt;
      const stride = this.crouching ? 1.6 : 2.3;
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        if (window.GameAudio) window.GameAudio.step(this.crouching ? 0.12 : 0.3);
        if (!this.crouching && this.onNoise) this.onNoise(this.position, 14);
      }
      this.bobT += dt * (this.crouching ? 7 : 10.5) * (this.speed2D / this.speed + 0.2);
    } else this.bobT *= Math.pow(0.02, dt);

    // ── câmera ──
    const bobY = this.onGround ? Math.sin(this.bobT * 2) * 0.035 : 0, bobX = this.onGround ? Math.cos(this.bobT) * 0.025 : 0;
    this.camera.position.set(this.position.x, this.viewY + this.curEyeH + bobY - this.landDip, this.position.z);
    this.kick *= Math.pow(0.0015, dt); this.kickYaw *= Math.pow(0.0015, dt);
    this.camera.rotation.y = this.yaw + this.kickYaw;
    this.camera.rotation.x = this.pitch + this.kick * 0.5;
    this.camera.rotation.z = -bobX * 0.4 - (this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) * 0.0025;
    if (FXshake() > 0) { const s = FXshake(); this.camera.rotation.x += (Math.random() - 0.5) * 0.04 * s; this.camera.rotation.y += (Math.random() - 0.5) * 0.04 * s; }
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 14);
    const aspect = this.camera.aspect || 1.78;
    const vf = 2 * Math.atan(Math.tan(this.baseHFov * Math.PI / 360) / aspect) * 180 / Math.PI;
    const fov = vf * this.zoom;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const ci = document.getElementById('crouch-ind'); if (ci) ci.style.display = this.crouching ? 'block' : 'none';
  }

  dispose() {
    document.removeEventListener('keydown', this._kd); document.removeEventListener('keyup', this._ku);
    document.removeEventListener('mousemove', this._mm); document.removeEventListener('click', this._ck);
  }
}
function FXshake() { return window.FX ? window.FX.shake : 0; }
window.Player = Player;
})();
