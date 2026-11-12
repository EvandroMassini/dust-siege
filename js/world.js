// ═══════════════════════════════════════════════════════════
// WORLD — colisão (AABBs + rampas), alturas de piso, raycast, linha de visão e navegação (grid + A*)
// Tudo em escopo global (scripts clássicos) via window.World.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const STEP = 0.6;        // altura máxima que se sobe andando
const EYE_CLEAR = 1.7;   // altura do corpo (colisão com tetos/vergas)

class World {
  constructor() {
    this.solids = [];
    this.ramps = [];
    this.bounds = { minX: -51, maxX: 51, minZ: -47, maxZ: 47 };
    this.STEP = STEP;
    // navegação
    this.cell = 1; this.ox = -52; this.oz = -48; this.gx = 104; this.gz = 96;
    this.walk = null; this.hgt = null;
  }

  // walk:true => piso caminhável (plataforma/degrau) — não bloqueia a navegação da IA
  addSolid(minX, minY, minZ, maxX, maxY, maxZ, opts) {
    const s = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], walk: !!(opts && opts.walk), noRay: !!(opts && opts.noRay) };
    this.solids.push(s);
    return s;
  }
  // axis 'x' ou 'z': altura vai de hA (em x0/z0) até hB (em x1/z1)
  addRamp(x0, z0, x1, z1, axis, hA, hB) {
    this.ramps.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), axis, a: axis === 'x' ? x0 : z0, b: axis === 'x' ? x1 : z1, hA, hB });
  }
  // degraus: n degraus sobem na direção 'dir' ('+x','-x','+z','-z') partindo do lado baixo
  addStairs(x0, z0, x1, z1, dir, h, n) {
    const horiz = dir[1] === 'x';
    const len = horiz ? (x1 - x0) : (z1 - z0);
    const run = len / n;
    for (let j = 1; j <= n; j++) {
      const top = h * j / n;
      let a, b, c, d;
      if (dir === '+x') { a = x0 + (j - 1) * run; b = x1; c = z0; d = z1; }
      else if (dir === '-x') { a = x0; b = x1 - (j - 1) * run; c = z0; d = z1; }
      else if (dir === '+z') { a = x0; b = x1; c = z0 + (j - 1) * run; d = z1; }
      else { a = x0; b = x1; c = z0; d = z1 - (j - 1) * run; }
      this.addSolid(a, 0, c, b, top, d, { walk: true });
    }
  }

  rampH(r, x, z) {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return -1;
    const v = r.axis === 'x' ? x : z;
    let t = (v - r.a) / (r.b - r.a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return r.hA + (r.hB - r.hA) * t;
  }

  // altura do piso sob (x,z) alcançável a partir de feetY
  groundAt(x, z, feetY) {
    const lim = feetY + STEP + 0.001;
    let g = 0;
    const S = this.solids;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (x < s.min[0] || x > s.max[0] || z < s.min[2] || z > s.max[2]) continue;
      const t = s.max[1];
      if (t <= lim && t > g) g = t;
    }
    for (let i = 0; i < this.ramps.length; i++) {
      const h = this.rampH(this.ramps[i], x, z);
      if (h >= 0 && h <= lim && h > g) g = h;
    }
    return g;
  }

  // piso "natural" (só superfícies caminháveis) — usado pela navegação e spawns
  surfaceAt(x, z) {
    let g = 0;
    for (const s of this.solids) {
      if (!s.walk) continue;
      if (x < s.min[0] || x > s.max[0] || z < s.min[2] || z > s.max[2]) continue;
      if (s.max[1] > g) g = s.max[1];
    }
    for (const r of this.ramps) { const h = this.rampH(r, x, z); if (h > g) g = h; }
    return g;
  }

  // empurra pos (x,z) para fora das paredes. feetY = altura dos pés
  resolve(pos, r, feetY) {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const s of this.solids) {
        if (s.max[1] <= feetY + STEP + 0.001) continue;
        if (s.min[1] >= feetY + EYE_CLEAR) continue;
        const cx = pos.x < s.min[0] ? s.min[0] : pos.x > s.max[0] ? s.max[0] : pos.x;
        const cz = pos.z < s.min[2] ? s.min[2] : pos.z > s.max[2] ? s.max[2] : pos.z;
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        moved = true;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
        else {
          const pl = pos.x - s.min[0] + r, pr = s.max[0] - pos.x + r, pu = pos.z - s.min[2] + r, pd = s.max[2] - pos.z + r;
          const m = Math.min(pl, pr, pu, pd);
          if (m === pl) pos.x -= pl; else if (m === pr) pos.x += pr; else if (m === pu) pos.z -= pu; else pos.z += pd;
        }
      }
      if (!moved) break;
    }
    const b = this.bounds;
    pos.x = Math.max(b.minX, Math.min(b.maxX, pos.x));
    pos.z = Math.max(b.minZ, Math.min(b.maxZ, pos.z));
  }

  // raio contra sólidos + plano do chão. Retorna {t, nx,ny,nz} ou null
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT, nx = 0, ny = 0, nz = 0, hit = false;
    const S = this.solids;
    const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s.noRay) continue;
      let t1 = (s.min[0] - ox) * ix, t2 = (s.max[0] - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0, sg = t1 < t2 ? -1 : 1;
      t1 = (s.min[1] - oy) * iy; t2 = (s.max[1] - oy) * iy;
      let a = Math.min(t1, t2), b = Math.max(t1, t2);
      if (a > tmin) { tmin = a; ax = 1; sg = t1 < t2 ? -1 : 1; }
      if (b < tmax) tmax = b;
      t1 = (s.min[2] - oz) * iz; t2 = (s.max[2] - oz) * iz;
      a = Math.min(t1, t2); b = Math.max(t1, t2);
      if (a > tmin) { tmin = a; ax = 2; sg = t1 < t2 ? -1 : 1; }
      if (b < tmax) tmax = b;
      if (tmax < 0 || tmin > tmax || tmin >= best) continue;
      if (tmin < 0) continue; // origem dentro do sólido
      best = tmin; hit = true;
      nx = ax === 0 ? sg : 0; ny = ax === 1 ? sg : 0; nz = ax === 2 ? sg : 0;
    }
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t > 0 && t < best) { best = t; hit = true; nx = 0; ny = 1; nz = 0; }
    }
    return hit ? { t: best, nx, ny, nz } : null;
  }

  // linha de visão entre dois pontos (sem paredes no meio)
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.01) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.15);
    return !h;
  }

  // ───────────── NAVEGAÇÃO ─────────────
  buildNav() {
    const { gx, gz, cell, ox, oz } = this;
    this.walk = new Uint8Array(gx * gz);
    this.hgt = new Float32Array(gx * gz);
    const R = 0.58;
    const blockers = this.solids.filter(s => !s.walk && (s.max[1] - s.min[1]) > STEP && s.min[1] < EYE_CLEAR);
    for (let z = 0; z < gz; z++) {
      for (let x = 0; x < gx; x++) {
        const cx = ox + (x + 0.5) * cell, cz = oz + (z + 0.5) * cell;
        let ok = 1;
        for (const s of blockers) {
          const px = cx < s.min[0] ? s.min[0] : cx > s.max[0] ? s.max[0] : cx;
          const pz = cz < s.min[2] ? s.min[2] : cz > s.max[2] ? s.max[2] : cz;
          const dx = cx - px, dz = cz - pz;
          if (dx * dx + dz * dz < R * R) { ok = 0; break; }
        }
        const i = z * gx + x;
        this.walk[i] = ok;
        this.hgt[i] = this.surfaceAt(cx, cz);
      }
    }
  }
  cellOf(x, z) {
    return { cx: Math.floor((x - this.ox) / this.cell), cz: Math.floor((z - this.oz) / this.cell) };
  }
  isWalkable(x, z) {
    const cx = Math.floor((x - this.ox) / this.cell), cz = Math.floor((z - this.oz) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.gx || cz >= this.gz) return false;
    return !!this.walk[cz * this.gx + cx];
  }
  nearestWalkable(x, z) {
    let { cx, cz } = this.cellOf(x, z);
    cx = Math.max(0, Math.min(this.gx - 1, cx)); cz = Math.max(0, Math.min(this.gz - 1, cz));
    if (this.walk[cz * this.gx + cx]) return { x: this.ox + (cx + 0.5) * this.cell, z: this.oz + (cz + 0.5) * this.cell };
    for (let r = 1; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x2 = cx + dx, z2 = cz + dz;
        if (x2 < 0 || z2 < 0 || x2 >= this.gx || z2 >= this.gz) continue;
        if (this.walk[z2 * this.gx + x2]) return { x: this.ox + (x2 + 0.5) * this.cell, z: this.oz + (z2 + 0.5) * this.cell };
      }
    }
    return null;
  }
  lineClear(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(d / 0.4));
    let lastH = null;
    for (let i = 0; i <= n; i++) {
      const x = x0 + dx * i / n, z = z0 + dz * i / n;
      const cx = Math.floor((x - this.ox) / this.cell), cz = Math.floor((z - this.oz) / this.cell);
      if (cx < 0 || cz < 0 || cx >= this.gx || cz >= this.gz) return false;
      const k = cz * this.gx + cx;
      if (!this.walk[k]) return false;
      const h = this.hgt[k];
      if (lastH !== null && Math.abs(h - lastH) > 0.45) return false;
      lastH = h;
    }
    return true;
  }

  // A* em grade 8-vizinhos. Retorna lista de waypoints [{x,z}] (já suavizada) ou null
  findPath(sx, sz, tx, tz) {
    const gx = this.gx, gz = this.gz, walk = this.walk, hgt = this.hgt;
    const s = this.nearestWalkable(sx, sz), t = this.nearestWalkable(tx, tz);
    if (!s || !t) return null;
    const sc = this.cellOf(s.x, s.z), tc = this.cellOf(t.x, t.z);
    const start = sc.cz * gx + sc.cx, goal = tc.cz * gx + tc.cx;
    if (start === goal) return [{ x: t.x, z: t.z }];
    const N = gx * gz;
    if (!this._g) { this._g = new Float32Array(N); this._f = new Float32Array(N); this._par = new Int32Array(N); this._st = new Uint32Array(N); this._stamp = 0; }
    const G = this._g, F = this._f, P = this._par, ST = this._st;
    const stamp = ++this._stamp;
    const heap = [];
    const push = (i) => { heap.push(i); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (F[heap[p]] <= F[heap[k]]) break; const tmp = heap[p]; heap[p] = heap[k]; heap[k] = tmp; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && F[heap[l]] < F[heap[m]]) m = l; if (r < heap.length && F[heap[r]] < F[heap[m]]) m = r; if (m === k) break; const tmp = heap[m]; heap[m] = heap[k]; heap[k] = tmp; k = m; } } return top; };
    const gxc = goal % gx, gzc = (goal / gx) | 0;
    const hf = (i) => { const x = i % gx, z = (i / gx) | 0; const dx = Math.abs(x - gxc), dz = Math.abs(z - gzc); return (dx + dz) + (1.414 - 2) * Math.min(dx, dz); };
    G[start] = 0; F[start] = hf(start); P[start] = -1; ST[start] = stamp; push(start);
    const closed = new Uint8Array(N);
    let found = false, iter = 0;
    while (heap.length && iter++ < 14000) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) { found = true; break; }
      const cx = cur % gx, cz = (cur / gx) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= gx || nz >= gz) continue;
        const ni = nz * gx + nx;
        if (!walk[ni] || closed[ni]) continue;
        if (dx && dz && (!walk[cz * gx + nx] || !walk[nz * gx + cx])) continue; // sem cortar quina
        if (Math.abs(hgt[ni] - hgt[cur]) > 0.7) continue;
        const ng = G[cur] + (dx && dz ? 1.414 : 1);
        if (ST[ni] !== stamp || ng < G[ni]) { G[ni] = ng; F[ni] = ng + hf(ni); P[ni] = cur; ST[ni] = stamp; push(ni); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = P[i]) cells.push({ x: this.ox + ((i % gx) + 0.5) * this.cell, z: this.oz + (((i / gx) | 0) + 0.5) * this.cell });
    cells.reverse();
    // suavização (string pulling)
    const out = [];
    let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !this.lineClear(cells[a].x, cells[a].z, cells[b].x, cells[b].z)) b--;
      out.push(cells[b]);
      a = b;
    }
    return out;
  }

  randomWalkable(cx, cz, rMin, rMax, tries) {
    for (let i = 0; i < (tries || 20); i++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (this.isWalkable(x, z)) return { x, z };
    }
    return null;
  }
}

window.World = World;
})();
