// ═══════════════════════════════════════════════════════════
// MAPA — "Deserto II": traçado inspirado em mapas de bombsite de deserto
// (T spawn ao sul +Z, CT ao norte -Z, Long/A a oeste -X, túneis/B a leste +X)
// Elevações: rampa da Long até o A (1.6 m), escadas, catwalk, plataforma B (1.0 m), janela e portas com vergas.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

class Arena {
  constructor(scene, world, texLoader, props, renderer) {
    this.scene = scene; this.world = world; this.props = props || {};
    this.meshes = []; this.lights = [];
    this.aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    this.mats = {};
    const mk = (path, rough, nrm, nScale) => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0.0, vertexColors: true });
      const prep = (tex, srgb) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = this.aniso; if (srgb) tex.encoding = THREE.sRGBEncoding; return tex; };
      texLoader.load(path, (tex) => { m.map = prep(tex, true); m.needsUpdate = true; });
      if (nrm) texLoader.load(nrm, (t) => { m.normalMap = prep(t, false); const k = nScale || 1; m.normalScale = new THREE.Vector2(k, k); m.needsUpdate = true; });
      return m;
    };
    const P = 'assets/textures/pbr/';
    // Texturas PBR CC0 do Poly Haven (diffuse + normal)
    this.mats.sand = mk(P + 'sand_01_diff_1k.jpg', 1.0, P + 'sand_01_nor_gl_1k.jpg', 0.8);
    this.mats.stone = mk(P + 'sandstone_blocks_04_diff_1k.jpg', 0.95, P + 'sandstone_blocks_04_nor_gl_1k.jpg', 1.0);
    this.mats.stone2 = mk(P + 'cobblestone_floor_01_diff_1k.jpg', 0.95, P + 'cobblestone_floor_01_nor_gl_1k.jpg', 1.0);
    this.mats.brick = mk(P + 'brick_wall_02_diff_1k.jpg', 0.9, P + 'brick_wall_02_nor_gl_1k.jpg', 1.0);
    this.mats.wood = mk(P + 'weathered_planks_diff_1k.jpg', 0.8, P + 'weathered_planks_nor_gl_1k.jpg', 0.9);
    this.mats.wood2 = mk(P + 'brown_planks_03_diff_1k.jpg', 0.8, P + 'brown_planks_03_nor_gl_1k.jpg', 0.9);

    this.patrolNodes = [];
    this.enemySpawns = [];
    this.playerSpawn = { x: 0, z: 40, yaw: 0 };
    this._windows = [];
    this.build();
  }

  _add(mesh) { mesh.userData.isArena = true; this.meshes.push(mesh); this.scene.add(mesh); return mesh; }

  // Caixa com UV em coordenadas de mundo (sem esticar) e sombreamento de base (AO falso)
  box(x0, y0, z0, x1, y1, z1, mat, tile, tint, opts) {
    opts = opts || {};
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color(tint || 0xffffff);
    const ao = opts.ao !== undefined ? opts.ao : 0.62;
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let u, v;
      if (nx > 0.5) { u = z; v = y; } else if (nz > 0.5) { u = x; v = y; } else { u = x; v = z; }
      uv.setXY(i, u / tile, v / tile);
      let sh = ny > 0.5 ? 1.0 : ao + (1 - ao) * Math.min(1, Math.max(0, (y - y0) / 2.2));
      if (nx > 0.5) sh *= 0.92;
      col[i * 3] = c.r * sh; col[i * 3 + 1] = c.g * sh; col[i * 3 + 2] = c.b * sh;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, mat);
    m.castShadow = opts.cast !== false; m.receiveShadow = true;
    this._add(m);
    if (opts.solid !== false) this.world.addSolid(x0, y0, z0, x1, y1, z1, { walk: !!opts.walk, noRay: !!opts.noRay });
    return m;
  }

  rampMesh(x0, z0, x1, z1, axis, hA, hB, mat, tint) {
    // 8 cantos
    const lo = (a, b) => axis === 'z' ? [a, b] : [a, b];
    const ha = hA, hb = hB;
    const X0 = Math.min(x0, x1), X1 = Math.max(x0, x1), Z0 = Math.min(z0, z1), Z1 = Math.max(z0, z1);
    let v;
    if (axis === 'z') v = [[X0, 0, Z0], [X1, 0, Z0], [X1, 0, Z1], [X0, 0, Z1], [X0, ha, Z0], [X1, ha, Z0], [X1, hb, Z1], [X0, hb, Z1]];
    else v = [[X0, 0, Z0], [X1, 0, Z0], [X1, 0, Z1], [X0, 0, Z1], [X0, ha, Z0], [X1, hb, Z0], [X1, hb, Z1], [X0, ha, Z1]];
    const f = [[4, 5, 6], [4, 6, 7], [0, 2, 1], [0, 3, 2], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const pos = [], uvs = [], cols = [];
    const c = new THREE.Color(tint || 0xffffff);
    for (const tri of f) for (const k of [tri[0], tri[2], tri[1]]) { // winding invertido: faces voltadas para fora
      const q = v[k]; pos.push(q[0], q[1], q[2]); uvs.push(q[0] / 4, (axis === 'z' ? q[2] : q[0] * 0 + q[2]) / 4 + q[1] / 4);
      const sh = 0.7 + 0.3 * Math.min(1, q[1] / 1.5); cols.push(c.r * sh, c.g * sh, c.b * sh);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
    this._add(m);
    this.world.addRamp(x0, z0, x1, z1, axis, hA, hB);
  }

  stairs(x0, z0, x1, z1, dir, h, n, mat, tint) {
    const horiz = dir[1] === 'x';
    const run = (horiz ? (x1 - x0) : (z1 - z0)) / n;
    for (let j = 1; j <= n; j++) {
      const top = h * j / n;
      let a, b, c, d;
      if (dir === '+x') { a = x0 + (j - 1) * run; b = x1; c = z0; d = z1; }
      else if (dir === '-x') { a = x0; b = x1 - (j - 1) * run; c = z0; d = z1; }
      else if (dir === '+z') { a = x0; b = x1; c = z0 + (j - 1) * run; d = z1; }
      else { a = x0; b = x1; c = z0; d = z1 - (j - 1) * run; }
      this.box(a, 0, c, b, top, d, mat, 2.5, tint, { walk: true, ao: 0.8 });
    }
  }

  build() {
    const M = this.mats, W = this.world;
    const ST = [0xf3dcbc, 0xe8c9a0, 0xdcbb8e, 0xd1ad82];

    // ── Chão ──
    const gg = new THREE.PlaneGeometry(130, 118);
    gg.rotateX(-Math.PI / 2);
    const gu = gg.attributes.uv, gp = gg.attributes.position;
    const gcol = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
      gu.setXY(i, gp.getX(i) / 7, gp.getZ(i) / 7);
      const n = 0.88 + 0.12 * Math.sin(gp.getX(i) * 0.21) * Math.cos(gp.getZ(i) * 0.17);
      gcol[i * 3] = n; gcol[i * 3 + 1] = n * 0.97; gcol[i * 3 + 2] = n * 0.92;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
    const ground = new THREE.Mesh(gg, M.sand); ground.receiveShadow = true; this._add(ground);

    // ── Muralha externa ──
    const RH = 8;
    this.box(-53, 0, -49, 53, RH, -47, M.brick, 3.5, 0xd8b090, { noRay: false });
    this.box(-53, 0, 47, 53, RH, 49, M.brick, 3.5, 0xd8b090);
    this.box(-53, 0, -47, -51, RH, 47, M.brick, 3.5, 0xd8b090);
    this.box(51, 0, -47, 53, RH, 47, M.brick, 3.5, 0xd8b090);

    // ── Prédios ──
    const bld = [
      [-48, -10, -38, 28, 5.6, ST[1], 'stone'],   // casas oeste da Long
      [-48, -20, -38, -10, 5.6, ST[2], 'stone'],  // fecha o "pit"
      [-24, 4, -5, 24, 5.0, ST[0], 'stone'],      // bloco da Long Doors / lado oeste do mid
      [5, 4, 20, 22, 5.2, ST[2], 'stone'],        // prédio a leste do mid
      [31, -12, 51, 24, 6.2, ST[1], 'stone'],     // apartamentos da B
      [14, 34, 26, 42, 4.0, ST[3], 'stone'],      // barraco do T
      [-34, 35, -24, 43, 3.4, ST[0], 'stone'],    // depósito do T
    ];
    this.buildings = [];
    for (const b of bld) {
      this.box(b[0], 0, b[1], b[2], b[4], b[3], M[b[6]], 4, b[5]);
      // cornija (ledge) no topo
      this.box(b[0] - 0.25, b[4] - 0.05, b[1] - 0.25, b[2] + 0.25, b[4] + 0.35, b[3] + 0.25, M.stone2, 3, 0xb8946c, { solid: false });
      this.buildings.push({ x0: b[0], z0: b[1], x1: b[2], z1: b[3], h: b[4] });
    }
    // Muros (tijolo)
    this.box(-24.5, 0, -20, -23.5, 5.0, -4, M.brick, 3, 0xe3b28c);         // lado leste da Long
    this.box(16, 0, -12, 21, 5.0, 4, M.brick, 3, 0xe3b28c);                // bloco entre mid e túnel B
    this.box(20, 0, 22, 21, 5.0, 28, M.brick, 3, 0xe3b28c);                // parede oeste da boca do túnel
    this.box(-48, 0, -39, -16, 6.2, -37, M.stone, 4, ST[3]);              // fundo do A

    // ── A: plataforma, rampa da Long e escadas ──
    this.box(-48, 0, -37, -16, 1.6, -20, M.stone2, 3, 0xe8d4b4, { walk: true, ao: 0.85 });
    this.rampMesh(-38, -20, -24.5, -12, 'z', 1.6, 0, M.stone2, 0xe8d4b4);
    this.stairs(-16, -32, -11.2, -26, '-x', 1.6, 6, M.stone2, 0xe8d4b4);
    // ── Catwalk (short) ──
    this.box(-23, 0, -9, -8, 1.5, -4, M.stone2, 3, 0xdcc4a0, { walk: true, ao: 0.85 });
    this.stairs(-16, -4, -12, -0.8, '-z', 1.5, 5, M.stone2, 0xdcc4a0);
    // ── B: plataforma, rampa do túnel, porta e janela ──
    this.box(18, 0, -47, 51, 1.0, -12, M.stone2, 3, 0xe8d4b4, { walk: true, ao: 0.85 });
    this.rampMesh(21, -12, 31, -4, 'z', 1.0, 0, M.stone2, 0xe8d4b4);
    this.rampMesh(13, -36, 18, -30, 'x', 0, 1.0, M.stone2, 0xe8d4b4);
    // parede entre yard e B (com porta CT→B z[-36,-30] e janela z[-22,-17.5])
    this.box(16, 0, -47, 18, 5.2, -36, M.brick, 3, 0xe3b28c);
    this.box(16, 0, -30, 18, 5.2, -22, M.brick, 3, 0xe3b28c);
    this.box(16, 0, -17.5, 18, 5.2, -12, M.brick, 3, 0xe3b28c);
    this.box(16, 3.4, -36, 18, 5.2, -30, M.brick, 3, 0xcda37c, { ao: 1 });        // verga da porta
    this.box(16, 0, -22, 18, 1.3, -17.5, M.wood2, 2, 0xc9a77c);                    // peitoril da janela
    this.box(16, 3.2, -22, 18, 5.2, -17.5, M.brick, 3, 0xcda37c, { ao: 1 });      // verga da janela
    // Long doors (vão em x=-24.5, z[-4,4]) — verga
    this.box(-24.5, 3.6, -4, -23.5, 5.0, 4, M.brick, 3, 0xcda37c, { ao: 1 });
    // Mid doors — verga sobre o corredor e sobre o túnel B
    this.box(-5, 3.7, 24, 5, 4.7, 25.4, M.wood2, 2, 0xb99468, { ao: 1 });
    this.box(21, 3.8, 6, 31, 4.6, 16, M.stone, 3, ST[3], { ao: 1 });
    this.box(-38, 4.0, 10, -24.5, 4.7, 11.4, M.wood2, 2, 0xb99468, { ao: 1 });     // cobertura de madeira na Long

    // ── Caixas de madeira [cx, cz, sx, sy, sz, baseY] ──
    const crates = [
      [-2.5, 14, 1.4, 1.4, 1.4, 0], [2.6, 11, 1.2, 1.0, 1.2, 0], [3, 18, 1.3, 1.3, 1.3, 0], [-1, 7, 2.2, 1.1, 1.2, 0],
      [-14, 1.5, 1.5, 1.2, 1.5, 0], [-9, -1.5, 1.2, 1.2, 1.2, 0], [-20, 0, 1.6, 1.0, 1.6, 0],
      [-4, -18, 2.2, 1.4, 2.2, 0], [6, -24, 1.6, 1.2, 1.6, 0], [-10, -26, 1.4, 1.4, 1.4, 0], [0, -14, 1.2, 1.0, 1.2, 0], [0.1, -14, 0.9, 0.9, 0.9, 1.0],
      [-6, -40, 1.5, 1.5, 1.5, 0], [6, -42, 2, 1.2, 2, 0], [11, -34, 1.4, 1.1, 1.4, 0],
      [-32, -30, 3, 2.4, 3, 1.6], [-26, -26, 1.6, 1.2, 1.6, 1.6], [-41, -30, 2, 1.5, 1.5, 1.6], [-21, -35, 1.6, 1.4, 1.6, 1.6], [-44, -24, 1.4, 1.2, 1.4, 1.6],
      [-31, 10, 1.8, 1.4, 1.8, 0], [-34, -2, 1.4, 1.2, 1.4, 0], [-28, 18, 1.6, 1.2, 1.6, 0], [-33, 22, 2, 1, 1.5, 0], [-30, -8, 1.3, 1.1, 1.3, 0],
      [38, -32, 3, 2.2, 3, 1.0], [28, -26, 1.6, 1.2, 1.6, 1.0], [45, -40, 2, 1.6, 2, 1.0], [34, -17, 1.5, 1.3, 1.5, 1.0], [24, -41, 1.6, 1.2, 1.6, 1.0], [44, -22, 1.4, 1.2, 1.4, 1.0],
      [26, 20, 1.4, 1.2, 1.4, 0], [23, 11, 1.3, 1.3, 1.3, 0], [29, 6, 1.5, 1.0, 1.5, 0],
      [-14, 38, 1.6, 1.4, 1.6, 0], [10, 30, 1.5, 1.2, 1.5, 0], [-4, 45, 2, 1.4, 2, 0], [30, 36, 1.8, 1.4, 1.8, 0], [-42, 34, 1.5, 1.2, 1.5, 0],
    ];
    crates.forEach((c, i) => this.box(c[0] - c[2] / 2, c[5], c[1] - c[4] / 2, c[0] + c[2] / 2, c[5] + c[3], c[1] + c[4] / 2, i % 3 ? M.wood : M.wood2, 1.6, i % 2 ? 0xe9d2b0 : 0xffffff, { ao: 0.75 }));

    // ── Sacos de areia / barris / geradores / pedras (GLB do kit) ──
    const P = [
      ['prop_barrel', -36.5, -4.5, 0, 1.15, 0], ['prop_barrel', -35.5, -5.3, 1, 1.15, 0], ['prop_barrel', -37, -6, 0.5, 1.15, 0],
      ['prop_barrel', 22.5, 24, 0, 1.15, 0], ['prop_barrel', 23.4, 24.6, 1, 1.15, 0], ['prop_barrel', 29.5, 2, 0.3, 1.15, 0],
      ['prop_barrel', 40, -15, 0, 1.15, 1.0], ['prop_barrel', 41, -15.6, 1, 1.15, 1.0], ['prop_barrel', -18, -22, 0, 1.15, 1.6], ['prop_barrel', 12, -44, 0, 1.15, 0],
      ['prop_sandbags', -4.4, 2.8, 0.2, 0.9, 0, [2.2, 0.8, 1]], ['prop_sandbags', -36, -16, 1.57, 0.9, 0, [2.2, 0.8, 1]],
      ['prop_sandbags', -22, -28, 1.57, 0.9, 1.6, [2.2, 0.8, 1]], ['prop_sandbags', 21.5, -26, 1.57, 0.9, 1.0, [2.2, 0.8, 1]], ['prop_sandbags', 0, 29, 0, 0.9, 0, [2.2, 0.8, 1]],
      ['prop_generator', 33, -42, 0, 1.4, 1.0], ['prop_generator', -44, 20, 1.57, 1.4, 0], ['prop_generator', 18, 44, 3.14, 1.4, 0],
      ['prop_rock', -45, 2, 0, 1.2, 0], ['prop_rock', 8, -44, 0.7, 1.0, 0], ['prop_rock', 47, 30, 0.4, 1.3, 0], ['prop_rock', -45, 40, 1.1, 1.1, 0], ['prop_rock', 12, 8, 2.1, 0.9, 0],
      ['prop_lamp', -24, 0, 0, 3.6, 0, null, true], ['prop_lamp', 26, 22, 0, 3.6, 0, null, true], ['prop_lamp', 0, -30, 0, 3.6, 0, null, true], ['prop_lamp', -12, 30, 0, 3.6, 0, null, true],
      ['prop_pipes', -5.6, 16, 1.57, 2.2, 0, null, false], ['prop_pipes', 31.6, 0, -1.57, 2.2, 0, null, false],
      ['prop_fence', -20, 36, 0, 1.6, 0, [2, 1.5, 0.3]], ['prop_fence', -17.5, 36, 0, 1.6, 0, [2, 1.5, 0.3]], ['prop_fence', 36, 30, 1.57, 1.6, 0, [0.3, 1.5, 2]],
      ['prop_sign', -4, 28.5, 0.2, 2.2, 0, null, false], ['prop_sign', -26, 30, 1.0, 2.2, 0, null, false],
    ];
    const lampPts = [];
    for (const p of P) {
      const g = this.props[p[0]];
      if (!g || !g.scene) continue;
      const o = g.scene.clone(true);
      const bb = new THREE.Box3().setFromObject(o);
      const sz = bb.getSize(new THREE.Vector3());
      const s = p[4] / Math.max(sz.y, 0.01);
      o.scale.setScalar(s);
      o.rotation.y = p[3];
      o.position.set(p[1], p[5], p[2]);
      o.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(o);
      o.position.y += p[5] - b2.min.y;
      o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.userData.isArena = true; if (p[0] === 'prop_sandbags') { m.material = m.material.clone(); m.material.color.setHex(0x8f7a52); } if (p[0] === 'prop_barrel') { m.material = m.material.clone(); m.material.color.multiplyScalar(0.9); } } });
      o.userData.isArena = true;
      this.meshes.push(o); this.scene.add(o);
      const bx = new THREE.Box3().setFromObject(o);
      const wantCollide = p[6] === undefined ? true : p[6] !== null && p[6] !== false;
      if (p[0] !== 'prop_lamp' && p[0] !== 'prop_pipes' && p[0] !== 'prop_sign' && wantCollide) {
        const shrink = p[0] === 'prop_rock' ? 0.7 : 0.9;
        const cx = (bx.min.x + bx.max.x) / 2, cz = (bx.min.z + bx.max.z) / 2;
        const hx = (bx.max.x - bx.min.x) / 2 * shrink, hz = (bx.max.z - bx.min.z) / 2 * shrink;
        W.addSolid(cx - hx, bx.min.y, cz - hz, cx + hx, bx.max.y, cz + hz);
      } else if (p[0] === 'prop_lamp') {
        W.addSolid(p[1] - 0.2, 0, p[2] - 0.2, p[1] + 0.2, 3.4, p[2] + 0.2);
        lampPts.push([p[1], bx.max.y, p[2]]);
      }
    }
    // Luzes pontuais (poucas, sem sombra): lâmpadas + túnel
    const addLight = (x, y, z, color, intensity, dist) => { const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); this.scene.add(l); l.userData.isArena = true; this.meshes.push(l); };
    for (const lp of lampPts.slice(0, 3)) addLight(lp[0], lp[1] - 0.2, lp[2], 0xffc880, 1.6, 16);
    addLight(26, 3.2, 12, 0xffa860, 2.0, 14);

    // ── Janelas e portas (instanciadas) nas fachadas ──
    this._dressBuildings();
    // ── Manchas de sujeira no chão ──
    this._dirt();
    // ── Horizonte distante ──
    this._skyline();
    this._sky();

    // ── Navegação ──
    W.buildNav();

    // Nós de patrulha/posições-chave
    const nodes = [
      [-31, 20], [-31, 4], [-31, -8], [-30, -27], [-42, -32], [-20, -28], [-15, -6.5], [-14, 1], [-4, -20], [8, -22], [-12, -14],
      [-2, -40], [8, -38], [0, 12], [0, 22], [0, 0], [30, -26], [42, -20], [24, -40], [38, -14], [26, 14], [26, 0], [-10, 38], [18, 30], [0, 28], [10, 8], [-40, 5], [44, -44],
    ];
    for (const n of nodes) { const w = W.nearestWalkable(n[0], n[1]); if (w) this.patrolNodes.push(w); }
    const sp = [[-30, -28], [-42, -34], [34, -28], [44, -40], [0, -42], [-8, -40], [8, -36], [-4, -20], [24, -42], [-20, -26], [40, -20], [-31, -6]];
    for (const n of sp) { const w = W.nearestWalkable(n[0], n[1]); if (w) this.enemySpawns.push(w); }
  }

  _dressBuildings() {
    const geo = new THREE.PlaneGeometry(1.2, 1.7);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.25, metalness: 0.5, emissive: 0x0a1220, emissiveIntensity: 0.6, side: THREE.DoubleSide });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9, side: THREE.DoubleSide });
    const frameGeo = new THREE.PlaneGeometry(1.45, 1.95);
    const inst = [];
    for (const b of this.buildings) {
      const sides = [
        { n: [0, 1], a: b.x0, b: b.x1, fix: b.z1, axis: 'x' }, { n: [0, -1], a: b.x0, b: b.x1, fix: b.z0, axis: 'x' },
        { n: [1, 0], a: b.z0, b: b.z1, fix: b.x1, axis: 'z' }, { n: [-1, 0], a: b.z0, b: b.z1, fix: b.x0, axis: 'z' },
      ];
      for (const s of sides) {
        const len = s.b - s.a;
        if (len < 5) continue;
        const cnt = Math.floor((len - 2) / 4.2);
        for (let i = 0; i < cnt; i++) {
          const t = s.a + 1.6 + (len - 3.2) * (cnt === 1 ? 0.5 : i / (cnt - 1));
          const x = s.axis === 'x' ? t : s.fix + s.n[0] * 0.03;
          const z = s.axis === 'z' ? t : s.fix + s.n[1] * 0.03;
          inst.push([x, b.h > 5.4 ? 3.0 : 2.5, z, Math.atan2(s.n[0], s.n[1])]);
        }
      }
    }
    const im = new THREE.InstancedMesh(geo, mat, inst.length), fm = new THREE.InstancedMesh(frameGeo, frameMat, inst.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    inst.forEach((w, i) => {
      e.set(0, w[3], 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(w[0], w[1], w[2]), q, one); im.setMatrixAt(i, m4);
      const off = new THREE.Vector3(Math.sin(w[3]) * -0.015, 0, Math.cos(w[3]) * -0.015);
      m4.compose(new THREE.Vector3(w[0] + off.x, w[1], w[2] + off.z), q, one); fm.setMatrixAt(i, m4);
    });
    im.userData.isArena = true; fm.userData.isArena = true;
    this.meshes.push(im, fm); this.scene.add(fm); this.scene.add(im);
  }

  _dirt() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const N = 90;
    const g2 = new THREE.PlaneGeometry(1, 1); g2.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(g2, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      const x = -50 + rnd() * 100, z = -46 + rnd() * 92, s = 2 + rnd() * 6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m4.compose(new THREE.Vector3(x, 0.02 + (i % 7) * 0.001, z), q, new THREE.Vector3(s, 1, s * (0.5 + rnd() * 0.6)));
      im.setMatrixAt(i, m4);
      col.setRGB(0.2 + rnd() * 0.3, 0.15 + rnd() * 0.2, 0.1 + rnd() * 0.15); im.setColorAt(i, col);
    }
    im.userData.isArena = true; this.meshes.push(im); this.scene.add(im);
  }

  _skyline() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x9a8461 });
    const mat2 = new THREE.MeshLambertMaterial({ color: 0x8a7656 });
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rnd() * 0.1, r = 95 + rnd() * 40;
      const w = 6 + rnd() * 14, h = 8 + rnd() * 26, d = 6 + rnd() * 14;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), i % 3 ? mat : mat2);
      m.position.set(Math.cos(a) * r * 1.15, h / 2 - 1, Math.sin(a) * r);
      m.rotation.y = rnd() * 3; this._add(m);
      if (i % 4 === 0) { const t = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.2, w * 0.28, h * 0.55, 10), mat2); t.position.set(m.position.x + w * 0.3, h + h * 0.2, m.position.z); this._add(t); }
    }
  }

  _sky() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#2a62a0'); grd.addColorStop(0.4, '#7db9e6'); grd.addColorStop(0.7, '#dbe8f4'); grd.addColorStop(1, '#ecd2a8');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
    { const sg = g.createRadialGradient(300, 250, 10, 300, 250, 150); sg.addColorStop(0, 'rgba(255,240,200,0.55)'); sg.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = sg; g.fillRect(100, 50, 400, 400); }
    g.fillStyle = 'rgba(255,248,225,0.95)'; g.beginPath(); g.arc(300, 250, 32, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    const cloud = (x, y, s) => { g.beginPath(); g.ellipse(x, y, 52 * s, 15 * s, 0, 0, 6.3); g.ellipse(x + 34 * s, y + 4, 34 * s, 12 * s, 0, 0, 6.3); g.ellipse(x - 30 * s, y + 5, 30 * s, 11 * s, 0, 0, 6.3); g.fill(); };
    cloud(160, 110, 1.6); cloud(560, 90, 1.1); cloud(850, 140, 1.4); cloud(420, 170, 0.8); cloud(980, 80, 1.0);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 20), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.position.y = 10; this._add(sky);
  }

  dispose() {
    for (const o of this.meshes) {
      o.parent && o.parent.remove(o);
      o.traverse && o.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    }
    this.meshes = [];
  }
}
window.Arena = Arena;
})();
