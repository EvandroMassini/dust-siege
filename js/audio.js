// ═══════════════════════════════════════════════════════════
// ÁUDIO — WebAudio: sons posicionais 3D (HRTF), camadas de tiro, reverb de ambiente,
// passos, recarga, explosões, vento. Mistura amostras reais + síntese procedural.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const Audio = {
  ctx: null, master: null, sfx: null, reverbSend: null, buffers: {}, ready: false, wind: null,
  files: {
    ar: 'assets/sounds/564280__keybal__medium-ar-2.wav',
    hvy1: 'assets/sounds/257961__pgi__heavy-weapon-001-single-shot.ogg',
    hvy2: 'assets/sounds/257962__pgi__heavy-weapon-002-single-shot.ogg',
    boom1: 'assets/sounds/47252__deleted_user_364925__bad-explosion.wav',
    boom2: 'assets/sounds/757038__harrisonlace__fx_explosion.wav',
    gs_pistol: 'assets/sounds/gs_pistol.ogg', gs_magnum: 'assets/sounds/gs_magnum.ogg', gs_bp: 'assets/sounds/gs_bp.ogg', gs_unk: 'assets/sounds/gs_unk.ogg',
    rl_ar: 'assets/sounds/rl_ar.ogg', rl_gun: 'assets/sounds/rl_gun.ogg', rl_pistol: 'assets/sounds/rl_pistol.ogg', sg_cock: 'assets/sounds/sg_cock.ogg',
    body: 'assets/sounds/body.ogg', death1: 'assets/sounds/death1.ogg', death2: 'assets/sounds/death2.ogg',
    fs1: 'assets/sounds/fs1.ogg', fs2: 'assets/sounds/fs2.ogg', fs3: 'assets/sounds/fs3.ogg', fs4: 'assets/sounds/fs4.ogg',
    pain1: 'assets/sounds/pain1.ogg', pain2: 'assets/sounds/pain2.ogg', pain3: 'assets/sounds/pain3.ogg',
  },

  // deve ser chamado dentro de um gesto do usuário (clique em INICIAR)
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
    } catch (e) { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    // reverb sintética (ruído com decaimento) — dá "ar livre / eco de rua"
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6), imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 2000 ? i / 2000 : 1); }
    conv.buffer = imp;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(conv); const rg = ctx.createGain(); rg.gain.value = 0.55; conv.connect(rg); rg.connect(this.master);
    this._makeProcedural();
    this._load();
    this._startWind();
    this.ready = true;
  },

  async _load() {
    for (const [k, url] of Object.entries(this.files)) {
      try {
        const r = await fetch(url); const ab = await r.arrayBuffer();
        this.buffers[k] = await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
      } catch (e) { /* mantém só os procedurais */ }
    }
  },

  _noiseBuf(dur, decay, lp) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let y = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; y += (w - y) * lp; d[i] = y * Math.pow(1 - i / n, decay); }
    return b;
  },
  _thump(dur, f0, f1, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / n; const f = f1 + (f0 - f1) * Math.pow(1 - t, 3); ph += 2 * Math.PI * f / ctx.sampleRate; d[i] = Math.sin(ph) * Math.pow(1 - t, decay); }
    return b;
  },
  _mix(a, b, gb) { // soma b em a (novo buffer)
    const ctx = this.ctx, n = Math.max(a.length, b.length), o = ctx.createBuffer(1, n, ctx.sampleRate), d = o.getChannelData(0);
    const da = a.getChannelData(0), db = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (i < a.length ? da[i] : 0) + (i < b.length ? db[i] * gb : 0);
    return o;
  },
  _makeProcedural() {
    const B = this.buffers;
    B.shot_pistol = this._mix(this._noiseBuf(0.18, 3.2, 0.7), this._thump(0.12, 220, 70, 3), 0.9);
    B.shot_smg = this._mix(this._noiseBuf(0.14, 3.0, 0.6), this._thump(0.1, 200, 80, 3), 0.7);
    B.shot_rifle = this._mix(this._noiseBuf(0.28, 2.6, 0.5), this._thump(0.18, 180, 55, 2.5), 1.0);
    B.shot_shotgun = this._mix(this._noiseBuf(0.5, 2.2, 0.35), this._thump(0.3, 140, 40, 2), 1.4);
    B.shot_sniper = this._mix(this._noiseBuf(0.9, 2.0, 0.3), this._thump(0.45, 120, 35, 2), 1.6);
    B.shot_launcher = this._mix(this._noiseBuf(0.7, 1.6, 0.12), this._thump(0.4, 90, 30, 2), 1.2);
    B.click = this._noiseBuf(0.03, 2, 0.9);
    B.metal = this._mix(this._noiseBuf(0.06, 2, 0.95), this._thump(0.05, 1800, 900, 4), 0.25);
    B.step1 = this._noiseBuf(0.12, 3, 0.12); B.step2 = this._noiseBuf(0.14, 3, 0.09);
    B.thud = this._thump(0.2, 120, 40, 3);
    B.whiz = this._noiseBuf(0.14, 1.5, 0.5);
    B.hit = this._mix(this._thump(0.12, 900, 300, 6), this._noiseBuf(0.05, 2, 0.8), 0.5);
    B.explo_syn = this._mix(this._noiseBuf(1.6, 1.8, 0.08), this._thump(0.9, 80, 25, 1.6), 1.6);
    B.pick = this._thump(0.18, 880, 1320, 3);
  },

  // ── Reprodução ──
  _src(buf, rate, vol, dest, filt) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = vol;
    let node = s; node.connect(g); let out = g;
    if (filt) { const f = ctx.createBiquadFilter(); f.type = filt.type; f.frequency.value = filt.freq; f.Q.value = filt.q || 0.7; g.connect(f); out = f; }
    out.connect(dest);
    return { s, g };
  },
  play(name, vol, rate, rv) {
    if (!this.ready) return; const b = this.buffers[name]; if (!b) return;
    const { s, g } = this._src(b, (rate || 1) * (0.96 + Math.random() * 0.08), vol === undefined ? 1 : vol, this.sfx);
    if (rv) { const sg = this.ctx.createGain(); sg.gain.value = rv; g.connect(sg); sg.connect(this.reverbSend); }
    s.start();
  },
  // som posicional. pos = {x,y,z}
  play3D(name, pos, vol, rate, opts) {
    if (!this.ready) return; const b = this.buffers[name]; if (!b) return;
    opts = opts || {};
    const ctx = this.ctx;
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = opts.ref || 6; p.rolloffFactor = opts.roll || 1.2; p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    // distância: abafa agudos e aumenta reverb
    const L = this.listenerPos || { x: 0, y: 0, z: 0 };
    const d = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
    const cut = Math.max(900, 14000 / (1 + d * 0.07));
    const { s, g } = this._src(b, (rate || 1) * (0.95 + Math.random() * 0.1), vol === undefined ? 1 : vol, p, { type: 'lowpass', freq: cut });
    p.connect(this.sfx);
    const rv = Math.min(0.9, 0.15 + d / 90);
    const sg = ctx.createGain(); sg.gain.value = rv; g.connect(sg); sg.connect(this.reverbSend);
    s.start();
  },
  setListener(camera) {
    if (!this.ready) return;
    const L = this.ctx.listener, p = camera.position;
    this.listenerPos = p;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  },

  // ── Sons do jogo ──
  weaponShot(idx, pos3D) {
    // 0 pistol, 1 smg, 2 rifle, 3 shotgun, 4 sniper, 5 launcher
    const names = ['shot_pistol', 'shot_smg', 'shot_rifle', 'shot_shotgun', 'shot_sniper', 'shot_launcher'];
    const layer = [['gs_pistol', 1.0, 0.8], ['ar', 1.15, 0.5], ['ar', 0.92, 0.7], ['hvy1', 0.8, 0.9], ['gs_bp', 0.9, 0.9], ['hvy1', 0.55, 0.5]][idx];
    const vols = [0.8, 0.7, 0.85, 1.0, 1.1, 0.9];
    const rate = [1.1, 1.05, 0.95, 0.85, 0.75, 0.9][idx];
    if (pos3D) {
      this.play3D(names[idx], pos3D, vols[idx] * 0.9, rate, { ref: 8 });
      if (this.buffers[layer[0]]) this.play3D(layer[0], pos3D, layer[2] * 0.7, layer[1], { ref: 8 });
    } else {
      this.play(names[idx], vols[idx], rate, 0.35);
      if (this.buffers[layer[0]]) this.play(layer[0], layer[2] * 0.7, layer[1], 0.3);
    }
  },
  enemyShot(type, pos) { this.weaponShot(type, pos); },
  dry() { this.play('click', 0.6, 0.8); },
  reload(idx, dur) {
    const rb = idx === 0 ? 'rl_pistol' : idx === 3 ? 'sg_cock' : (idx === 4 ? 'rl_gun' : 'rl_ar');
    if (this.buffers[rb]) { this.play(rb, 0.8, idx === 1 ? 1.1 : 1); return; }
    this.play('metal', 0.5, 0.8);
    setTimeout(() => this.play('click', 0.7, 0.7), dur * 380);
    setTimeout(() => this.play('metal', 0.7, 1.1), dur * 760);
  },
  switchWeapon() { this.play('metal', 0.4, 1.2); },
  step(vol) { const k = 'fs' + (1 + Math.floor(Math.random() * 4)); this.play(this.buffers[k] ? k : 'step1', vol * (this.buffers[k] ? 1.6 : 1), 0.92 + Math.random() * 0.2); },
  land() { this.play('thud', 0.7, 1); },
  explosion(pos) {
    const b = Math.random() < 0.5 ? 'boom1' : 'boom2';
    if (pos) { this.play3D('explo_syn', pos, 1.2, 1, { ref: 14 }); if (this.buffers[b]) this.play3D(b, pos, 0.9, 0.9, { ref: 14 }); }
    else { this.play('explo_syn', 1.0); this.play(b, 0.8); }
  },
  enemyDie(pos) {
    this.play3D('thud', pos, 0.6, 0.7);
    const d = Math.random() < 0.5 ? 'death1' : 'death2';
    if (this.buffers[d]) { this.play3D(d, pos, 0.9, 0.95 + Math.random() * 0.1, { ref: 6 }); setTimeout(() => this.buffers.body && this.play3D('body', pos, 0.7, 1, { ref: 5 }), 350); }
  },
  enemyPain(pos) { const k = 'pain' + (1 + Math.floor(Math.random() * 3)); if (this.buffers[k]) this.play3D(k, pos, 0.55, 0.95 + Math.random() * 0.1, { ref: 6 }); },
  impact(pos) { this.play3D('click', pos, 0.5, 0.6 + Math.random() * 0.4, { ref: 4 }); },
  whiz(pos) { this.play3D('whiz', pos, 0.35, 1.2 + Math.random() * 0.8, { ref: 2 }); },
  hitMarker(head) { this.play('hit', head ? 0.9 : 0.5, head ? 1.4 : 1); },
  pickup() { this.play('pick', 0.6, 1); },
  // dano recebido — mantém o "thump" sintetizado do jogo original
  playHit() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.24);
    this.play('hit', 0.7, 0.7);
  },
  _startWind() {
    const ctx = this.ctx, n = ctx.sampleRate * 4, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let y = 0; for (let i = 0; i < n; i++) { y += ((Math.random() * 2 - 1) - y) * 0.02; d[i] = y * 3; } }
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.06; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
    this.wind = g;
  },
};
window.GameAudio = Audio;
})();
