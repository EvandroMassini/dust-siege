// Retarget de clipes entre dois rigs Mixamo (figure.glb -> vanguard.glb): copia as rotações locais por nome de osso.
(function () {
'use strict';
const strip = (n) => n.replace(/_\d+(?=\.)/, '');
function boneMap(root) { const m = {}; root.traverse(o => { if (o.isBone) m[o.name] = o; }); return m; }
window.retargetClips = function (src, dst, mode) {
  src.scene.updateMatrixWorld(true); dst.scene.updateMatrixWorld(true);
  const sb = boneMap(src.scene), db = boneMap(dst.scene);
  const sByClean = {}; for (const k in sb) sByClean[k.replace(/:/g, '').replace(/_\d+$/, '')] = sb[k];
  const dByClean = {}; for (const k in db) dByClean[k] = db[k];
  const sh = sByClean.mixamorigHips, dh = dByClean.mixamorigHips;
  const qsP = new THREE.Quaternion(), qdP = new THREE.Quaternion();
  sh.parent.getWorldQuaternion(qsP); dh.parent.getWorldQuaternion(qdP);
  const hipConv = qdP.clone().invert().multiply(qsP); // frame do pai figure -> frame do pai soldier
  const hipScale = dh.position.length() / (sh.position.length() || 1);
  const out = [];
  for (const clip of src.animations) {
    const tracks = [];
    for (const t of clip.tracks) {
      const nm = strip(t.name), dot = nm.indexOf('.'), bone = nm.slice(0, dot).replace(/:/g, ''), prop = nm.slice(dot + 1);
      const d = dByClean[bone], s = sByClean[bone];
      if (!d || !s) continue;
      if (prop === 'quaternion') {
        const v = Float32Array.from(t.values), q = new THREE.Quaternion();
        const restInv = s.quaternion.clone().invert();
        for (let i = 0; i < v.length; i += 4) {
          q.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
          if (bone === 'mixamorigHips') q.premultiply(hipConv);
          else if (mode === 'delta') q.premultiply(d.quaternion.clone().multiply(restInv));
          v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w;
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(d.name + '.quaternion', t.times, v));
      } else if (prop === 'position' && bone === 'mixamorigHips') {
        const v = Float32Array.from(t.values), p = new THREE.Vector3();
        for (let i = 0; i < v.length; i += 3) { p.set(v[i], v[i + 1], v[i + 2]).applyQuaternion(hipConv).multiplyScalar(hipScale); v[i] = p.x; v[i + 1] = p.y; v[i + 2] = p.z; }
        tracks.push(new THREE.VectorKeyframeTrack(d.name + '.position', t.times, v));
      }
    }
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return out;
};
})();
