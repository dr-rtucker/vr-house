// The house itself: geometry, materials, lighting, and the collision/floor
// queries that go with it. Extracted from house.html so the walkthrough and the
// psych study (study.html) render byte-identical scenes — if the two ever drift,
// any difference between conditions stops being interpretable.
//
// buildHouse() is called once. It returns everything a page needs to drive it.
import * as THREE from 'three';

// Book colours and widths were Math.random(), which meant a different bookshelf
// on every load. Harmless in the walkthrough, a real (if small) confound in a
// study, so the scene is now deterministic.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function buildHouse() {
const rand = mulberry32(0x5EED1);
let screenUniforms;

// ================================================================ layout
// Ground floor:  x -5..5, z -4..4, floor 0, ceiling 2.5
//   living room  x -5..0.5, z 0..4      kitchen  x -5..0.5, z -4..0
//   hall+stairs  x 0.5..5,  z -4..4     front door in the z=+4 wall at x≈2.5
// Slab 2.5..2.7, stairwell hole at x 3.7..5, z -2.4..1.6
// Upper floor:  floor 2.7, ceiling 5.1
//   bedroom  x -5..0.5      landing  x 0.5..5
const F0 = 0.0, CEIL0 = 2.5, SLAB_TOP = 2.7, F1 = SLAB_TOP, CEIL1 = 5.1;
const WALL_H0 = CEIL0 - F0, WALL_H1 = CEIL1 - F1;
const MINX = -5, MAXX = 5, MINZ = -4, MAXZ = 4;
const DOOR_TOP = 2.05, WT = 0.12;             // door head height, wall thickness
const EYE = 1.62, WALK = 1.9, PR = 0.26;      // eye height, speed, player radius

const STAIR_X0 = 3.5, STAIR_X1 = 5.0;         // stair run, descending in z
const STAIR_Z0 = 1.6, STAIR_Z1 = -2.4;
const STEPS = 14;
const RISE = (SLAB_TOP - F0) / STEPS;
const GOING = (STAIR_Z0 - STAIR_Z1) / STEPS;

const scene = new THREE.Scene();

// ================================================================ helpers
function roundedBox(w, h, d, r, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), dir = new THREE.Vector3();
  const ix = Math.max(w / 2 - r, 0), iy = Math.max(h / 2 - r, 0), iz = Math.max(d / 2 - r, 0);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -ix, ix),
          THREE.MathUtils.clamp(v.y, -iy, iy),
          THREE.MathUtils.clamp(v.z, -iz, iz));
    dir.subVectors(v, c);
    if (dir.lengthSq() > 1e-9) v.copy(c).addScaledVector(dir.normalize(), r);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

const mat = (color, roughness = 0.85, metalness = 0.0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const blockers = [];   // {x,z,hw,hd,y0,y1}
const walkables = [];  // meshes the floor-height ray can land on

function box(geo, material, x, y, z, parent = scene) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Furniture: solid, blocks the player, doesn't need to be stood on.
function prop(w, h, d, material, x, y, z, r = 0.015, parent = scene) {
  const m = box(roundedBox(w, h, d, r), material, x, y, z, parent);
  return m;
}
function blockAt(x, z, hw, hd, y0, y1) { blockers.push({ x, z, hw, hd, y0, y1 }); }

// ================================================================ materials
const MAT = {
  floorWood: mat(0x7a5a3c, 0.7),
  floorTile: mat(0xa8a49c, 0.5),
  floorUp:   mat(0x8a6a48, 0.72),
  wall:      mat(0xcabeac, 0.95),
  wallKit:   mat(0xd6d8d2, 0.9),
  wallBed:   mat(0xc3c0cc, 0.95),
  ceil:      mat(0xe0dad0, 1.0),
  trim:      mat(0xece6dc, 0.85),
  wood:      mat(0x5a4028, 0.65),
  woodLight: mat(0x9a7a56, 0.7),
  metal:     mat(0xb8bcc0, 0.35, 0.75),
  dark:      mat(0x18191b, 0.5, 0.2),
  brick:     mat(0x8d6f5e, 0.95)
};

// ================================================================ wall builder
// A wall is emitted as solid segments around its openings, plus a header over each.
// Only the solid segments become blockers, so you can walk through a doorway.
function buildWall({ axis, at, from, to, y0, height, openings = [], material = MAT.wall, thickness = WT }) {
  const ops = openings.slice().sort((a, b) => a.from - b.from);
  let cursor = from;
  const solids = [];
  for (const op of ops) {
    if (op.from > cursor) solids.push([cursor, op.from]);
    cursor = op.to;
  }
  if (cursor < to) solids.push([cursor, to]);

  for (const [a, b] of solids) {
    if (b - a < 1e-4) continue;
    const len = b - a, mid = (a + b) / 2;
    const geo = axis === 'x'
      ? new THREE.BoxGeometry(len, height, thickness)
      : new THREE.BoxGeometry(thickness, height, len);
    const m = box(geo, material, axis === 'x' ? mid : at, y0 + height / 2, axis === 'x' ? at : mid);
    m.castShadow = false;                       // walls don't cast; interiors go black otherwise
    if (axis === 'x') blockAt(mid, at, len / 2, thickness / 2, y0, y0 + height);
    else              blockAt(at, mid, thickness / 2, len / 2, y0, y0 + height);
  }

  // Sill below and header above each opening. Both heights are measured from the
  // wall's own base: treating them as absolute walls up every upper-storey doorway,
  // because a 2.05 door head is below a floor that starts at 2.7.
  for (const op of ops) {
    const len = op.to - op.from, mid = (op.from + op.to) / 2;
    const bot = y0 + (op.bottom ?? 0);
    const top = y0 + (op.top ?? DOOR_TOP);
    const piece = (yLo, yHi, blocks) => {
      const hh = yHi - yLo;
      if (hh <= 1e-4) return;
      const geo = axis === 'x' ? new THREE.BoxGeometry(len, hh, thickness)
                               : new THREE.BoxGeometry(thickness, hh, len);
      const m = box(geo, material, axis === 'x' ? mid : at, yLo + hh / 2, axis === 'x' ? at : mid);
      m.castShadow = false;
      if (blocks) {
        if (axis === 'x') blockAt(mid, at, len / 2, thickness / 2, yLo, yHi);
        else              blockAt(at, mid, thickness / 2, len / 2, yLo, yHi);
      }
    };
    piece(y0, bot, true);              // sill under a window — solid, blocks you
    piece(top, y0 + height, false);    // header over a door — you walk under it
  }
}

// ================================================================ exterior
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(140, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { lo: { value: new THREE.Color('#cfd8dc') }, hi: { value: new THREE.Color('#5b7fa6') } },
      vertexShader: `varying float vH; void main(){ vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vH; uniform vec3 lo, hi;
        void main(){ gl_FragColor = vec4(mix(lo, hi, smoothstep(-0.1, 0.65, vH)), 1.0); }`
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);

  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(160, 160, 24, 24).rotateX(-Math.PI / 2),
                              mat(0x53603a, 0.95));
  lawn.position.y = -0.08;   // clear of the interior floors, which sit at 0
  lawn.receiveShadow = true;
  scene.add(lawn);
  walkables.push(lawn);

  const path = box(new THREE.BoxGeometry(1.6, 0.04, 4.0), mat(0x9a958c, 0.9), 2.5, 0.0, 6.2);
  path.castShadow = false;
  walkables.push(path);
}

// foundation band: the lawn sits below floor level, which would otherwise leave the
// floor-slab edge showing as a stripe round the base of the house
{
  const fmat = mat(0x7a736a, 0.95), t = 0.20, yb = -0.28, hh = 0.28;
  for (const [w, d, x, z] of [[MAXX - MINX + 0.24, t, 0, MAXZ], [MAXX - MINX + 0.24, t, 0, MINZ],
                              [t, MAXZ - MINZ + 0.24, MINX, 0], [t, MAXZ - MINZ + 0.24, MAXX, 0]]) {
    const m = box(new THREE.BoxGeometry(w, hh, d), fmat, x, yb + hh / 2, z);
    m.castShadow = false;
  }
}

// ================================================================ floors & ceilings
function slab(x0, x1, z0, z1, y, material, thickness = 0.2, walk = true, ceilBelow = false) {
  const m = box(new THREE.BoxGeometry(x1 - x0, thickness, z1 - z0), material,
                (x0 + x1) / 2, y - thickness / 2, (z0 + z1) / 2);
  m.castShadow = false;
  if (walk) walkables.push(m);
  if (ceilBelow) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(Math.PI / 2), MAT.ceil);
    c.position.set((x0 + x1) / 2, y - thickness - 0.02, (z0 + z1) / 2);
    c.receiveShadow = true;
    scene.add(c);
  }
  return m;
}

// ground floor
slab(MINX, 0.5, 0, MAXZ, F0, MAT.floorWood);        // living
slab(MINX, 0.5, MINZ, 0, F0, MAT.floorTile);        // kitchen
slab(0.5, MAXX, MINZ, MAXZ, F0, MAT.floorWood);     // hall

// upper slab: three pieces around the stairwell hole
slab(MINX, STAIR_X0, MINZ, MAXZ, SLAB_TOP, MAT.floorUp, 0.2, true, true);
slab(STAIR_X0, MAXX, MINZ, STAIR_Z1, SLAB_TOP, MAT.floorUp, 0.2, true, true);
slab(STAIR_X0, MAXX, STAIR_Z0, MAXZ, SLAB_TOP, MAT.floorUp, 0.2, true, true);

// upstairs ceiling / roof
slab(MINX - 0.45, MAXX + 0.45, MINZ - 0.45, MAXZ + 0.45, CEIL1 + 0.30, mat(0x4a4540, 0.9), 0.3, false);
{
  const c = new THREE.Mesh(new THREE.PlaneGeometry(MAXX - MINX + 0.3, MAXZ - MINZ + 0.3).rotateX(Math.PI / 2), MAT.ceil);
  c.position.set(0, CEIL1 - 0.02, 0);
  c.receiveShadow = true;
  scene.add(c);
}

// ================================================================ walls
// --- ground floor exterior
buildWall({ axis: 'x', at: MAXZ, from: MINX, to: MAXX, y0: F0, height: SLAB_TOP - F0,
            openings: [{ from: 2.0, to: 3.0 }] });                       // front door
buildWall({ axis: 'x', at: MINZ, from: MINX, to: MAXX, y0: F0, height: SLAB_TOP - F0,
            openings: [{ from: -3.6, to: -2.0, bottom: 0.9, top: 2.0 }] }); // kitchen window
buildWall({ axis: 'z', at: MINX, from: MINZ, to: MAXZ, y0: F0, height: SLAB_TOP - F0,
            openings: [{ from: 1.0, to: 2.8, bottom: 0.85, top: 2.05 }] }); // living window
buildWall({ axis: 'z', at: MAXX, from: MINZ, to: MAXZ, y0: F0, height: SLAB_TOP - F0 });

// --- ground floor interior
buildWall({ axis: 'z', at: 0.5, from: MINZ, to: MAXZ, y0: F0, height: WALL_H0,
            openings: [{ from: 1.4, to: 2.4 }] });                        // hall -> living
buildWall({ axis: 'x', at: 0, from: MINX, to: 0.5, y0: F0, height: WALL_H0,
            openings: [{ from: -0.7, to: 0.3 }] });                       // living -> kitchen

// --- upper floor exterior
buildWall({ axis: 'x', at: MAXZ, from: MINX, to: MAXX, y0: F1, height: WALL_H1,
            openings: [{ from: -3.0, to: -1.4, bottom: 0.9, top: 2.1 }] }); // bedroom window
buildWall({ axis: 'x', at: MINZ, from: MINX, to: MAXX, y0: F1, height: WALL_H1 });
buildWall({ axis: 'z', at: MINX, from: MINZ, to: MAXZ, y0: F1, height: WALL_H1,
            openings: [{ from: -1.0, to: 0.6, bottom: 0.9, top: 2.1 }] });  // bedroom window
buildWall({ axis: 'z', at: MAXX, from: MINZ, to: MAXZ, y0: F1, height: WALL_H1 });

// --- upper floor interior: bedroom door off the landing
buildWall({ axis: 'z', at: 0.5, from: MINZ, to: MAXZ, y0: F1, height: WALL_H1,
            openings: [{ from: 0.4, to: 1.4 }] });

// window glass (bright, unaffected by tone mapping so it clips like a real window)
const glassMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
function glass(axis, at, from, to, bottom, top) {
  const w = to - from, h = top - bottom, th = WT + 0.02;
  const g = axis === 'x' ? new THREE.BoxGeometry(w, h, th) : new THREE.BoxGeometry(th, h, w);
  const m = new THREE.Mesh(g, glassMat);
  m.position.set(axis === 'x' ? (from + to) / 2 : at,
                 (bottom + top) / 2,
                 axis === 'x' ? at : (from + to) / 2);
  scene.add(m);
}
glass('x', MINZ, -3.6, -2.0, 0.9, 2.0);
glass('z', MINX, 1.0, 2.8, 0.85, 2.05);
glass('x', MAXZ, -3.0, -1.4, F1 + 0.9, F1 + 2.1);
glass('z', MINX, -1.0, 0.6, F1 + 0.9, F1 + 2.1);

// ================================================================ front door
const doorPivot = new THREE.Group();
doorPivot.position.set(2.0, 0, MAXZ);          // hinge on the left jamb
scene.add(doorPivot);
{
  const d = box(roundedBox(0.98, 2.03, 0.06, 0.01), MAT.wood, 0.49, 1.015, 0, doorPivot);
  d.castShadow = false;
  box(new THREE.SphereGeometry(0.045, 12, 10), MAT.metal, 0.88, 1.02, 0.07, doorPivot);
  // panel detail
  for (const y of [0.62, 1.42]) {
    const p = box(roundedBox(0.62, 0.62, 0.02, 0.01), mat(0x6a4c30, 0.6), 0.49, y, 0.04, doorPivot);
    p.castShadow = false;
  }
}
// step up to the threshold
box(new THREE.BoxGeometry(1.8, 0.12, 0.7), mat(0x9a958c, 0.9), 2.5, 0.06, MAXZ + 0.42).castShadow = false;

// ================================================================ stairs
{
  const tread = MAT.wood, riser = MAT.trim;
  for (let i = 0; i < STEPS; i++) {
    const y = (i + 1) * RISE;
    const zc = STAIR_Z0 - (i + 0.5) * GOING;
    const t = box(new THREE.BoxGeometry(STAIR_X1 - STAIR_X0, 0.06, GOING), tread,
                  (STAIR_X0 + STAIR_X1) / 2, y - 0.03, zc);
    t.castShadow = false;
    walkables.push(t);
    const r = box(new THREE.BoxGeometry(STAIR_X1 - STAIR_X0, RISE, 0.04), riser,
                  (STAIR_X0 + STAIR_X1) / 2, y - RISE / 2, zc + GOING / 2);
    r.castShadow = false;
  }
  // Closed soffit under the run: without it you see up between the treads from the
  // hall and the staircase reads as a stack of floating planks.
  const soffit = box(new THREE.BoxGeometry(STAIR_X1 - STAIR_X0, 0.08,
                                           Math.hypot(STAIR_Z0 - STAIR_Z1, SLAB_TOP)),
                     MAT.trim, (STAIR_X0 + STAIR_X1) / 2, SLAB_TOP / 2 - 0.30,
                     (STAIR_Z0 + STAIR_Z1) / 2);
  soffit.rotation.x = Math.atan2(SLAB_TOP, STAIR_Z0 - STAIR_Z1);
  soffit.castShadow = false;

  // closed stringer on the open side, so you can't see into the wedge gaps between
  // the stepped profile and the flat soffit
  const stringer = box(new THREE.BoxGeometry(0.05, 0.46,
                                             Math.hypot(STAIR_Z0 - STAIR_Z1, SLAB_TOP)),
                       MAT.trim, STAIR_X0 + 0.025, SLAB_TOP / 2 - 0.12,
                       (STAIR_Z0 + STAIR_Z1) / 2);
  stringer.rotation.x = Math.atan2(SLAB_TOP, STAIR_Z0 - STAIR_Z1);
  stringer.castShadow = false;

  // --- balustrades ------------------------------------------------
  const post = mat(0x4a3423, 0.6);
  const POSTX = STAIR_X0 + 0.06;   // raked, sitting on the tread edge
  const LANDX = STAIR_X0 - 0.10;   // level, sitting on the landing floor

  for (let i = 0; i <= STEPS; i += 2) {
    const y = i * RISE, zc = STAIR_Z0 - i * GOING;
    box(new THREE.BoxGeometry(0.06, 0.9, 0.06), post, POSTX, y + 0.45, zc);
  }
  const rail = box(new THREE.BoxGeometry(0.09, 0.07, Math.hypot(STAIR_Z0 - STAIR_Z1, SLAB_TOP)),
                   post, POSTX, SLAB_TOP / 2 + 0.9, (STAIR_Z0 + STAIR_Z1) / 2);
  // The run climbs as z decreases, so the rail has to rise toward -z. Negating this
  // tilts it the wrong way and it crosses the hall as a loose diagonal plank.
  rail.rotation.x = Math.atan2(SLAB_TOP, STAIR_Z0 - STAIR_Z1);
  blockAt(POSTX, (STAIR_Z0 + STAIR_Z1) / 2, 0.06, (STAIR_Z0 - STAIR_Z1) / 2, F0, SLAB_TOP + 0.9);

  // level balustrade guarding the landing edge, set back so it doesn't interleave
  // with the raked posts
  for (let z = STAIR_Z1 + 0.25; z <= STAIR_Z0; z += 0.5)
    box(new THREE.BoxGeometry(0.06, 0.9, 0.06), post, LANDX, F1 + 0.45, z);
  box(new THREE.BoxGeometry(0.1, 0.08, STAIR_Z0 - STAIR_Z1 + 0.1), post,
      LANDX, F1 + 0.93, (STAIR_Z0 + STAIR_Z1) / 2);
  blockAt(LANDX, (STAIR_Z0 + STAIR_Z1) / 2, 0.06, (STAIR_Z0 - STAIR_Z1) / 2, F1, F1 + 1.0);

  // guard across the head of the stairwell — with posts under it, not floating
  for (const x of [STAIR_X0 + 0.25, (STAIR_X0 + STAIR_X1) / 2, STAIR_X1 - 0.25])
    box(new THREE.BoxGeometry(0.06, 0.9, 0.06), post, x, F1 + 0.45, STAIR_Z0 + 0.06);
  box(new THREE.BoxGeometry(STAIR_X1 - STAIR_X0, 0.08, 0.1), post,
      (STAIR_X0 + STAIR_X1) / 2, F1 + 0.93, STAIR_Z0 + 0.06);
  blockAt((STAIR_X0 + STAIR_X1) / 2, STAIR_Z0 + 0.06, (STAIR_X1 - STAIR_X0) / 2, 0.06, F1, F1 + 1.0);
}

// ================================================================ living room
{
  const fabric = mat(0x9d8f78, 0.95), cushion = mat(0xb0a289, 0.95), foot = mat(0x3b2c1e, 0.6);
  const c = new THREE.Group();
  c.position.set(-2.6, 0, 3.3);
  c.rotation.y = Math.PI;                    // faces the TV
  scene.add(c);
  prop(2.10, 0.34, 0.92, fabric, 0, 0.30, 0, 0.06, c);
  prop(2.10, 0.62, 0.20, fabric, 0, 0.75, -0.36, 0.07, c);
  prop(0.22, 0.52, 0.92, fabric, -0.94, 0.58, 0, 0.08, c);
  prop(0.22, 0.52, 0.92, fabric, 0.94, 0.58, 0, 0.08, c);
  for (const x of [-0.42, 0.42]) {
    prop(0.80, 0.16, 0.82, cushion, x, 0.55, 0.02, 0.07, c);
    prop(0.76, 0.46, 0.14, cushion, x, 0.78, -0.28, 0.06, c);
  }
  for (const [x, z] of [[-0.92, 0.38], [0.92, 0.38], [-0.92, -0.38], [0.92, -0.38]])
    box(new THREE.CylinderGeometry(0.035, 0.028, 0.13, 8), foot, x, 0.065, z, c);
  blockAt(-2.6, 3.3, 1.16, 0.52, F0, 1.0);

  // TV stand + TV against the z=0 wall
  const s = new THREE.Group(); s.position.set(-2.6, 0, 0.35); scene.add(s);
  prop(1.85, 0.06, 0.44, MAT.wood, 0, 0.52, 0, 0.02, s);
  prop(1.75, 0.05, 0.40, MAT.wood, 0, 0.26, 0, 0.02, s);
  prop(0.06, 0.52, 0.42, MAT.wood, -0.90, 0.26, 0, 0.02, s);
  prop(0.06, 0.52, 0.42, MAT.wood, 0.90, 0.26, 0, 0.02, s);
  blockAt(-2.6, 0.35, 0.95, 0.24, F0, 0.6);

  const tv = new THREE.Group(); tv.position.set(-2.6, 1.16, 0.28); scene.add(tv);
  prop(1.22, 0.72, 0.05, MAT.dark, 0, 0, 0, 0.012, tv);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.64), null);
  screen.position.z = 0.028;
  tv.add(screen);
  prop(0.34, 0.04, 0.20, MAT.dark, 0, -0.38, 0.02, 0.015, tv);
  prop(0.50, 0.03, 0.28, MAT.dark, 0, -0.405, 0.02, 0.012, tv);

  screenUniforms = { uTime: { value: 0 } };
  screen.material = new THREE.ShaderMaterial({
    uniforms: screenUniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime;
      void main(){ float t = uTime * 0.25;
        float a = sin(vUv.y*6.0 + t*1.7)*0.5+0.5;
        float b = sin(vUv.x*4.0 - t*1.1 + vUv.y*2.0)*0.5+0.5;
        vec3 col = mix(vec3(0.05,0.12,0.32), vec3(0.35,0.62,0.95), a);
        col = mix(col, vec3(0.85,0.45,0.55), b*0.35);
        gl_FragColor = vec4(col, 1.0); }`
  });

  // rug + dresser
  const rug = box(roundedBox(2.8, 0.02, 1.8, 0.05), mat(0x8f8aa3, 1.0), -2.6, 0.012, 1.9);
  rug.castShadow = false;
  const dr = new THREE.Group(); dr.position.set(-0.5, 0, 3.66); dr.rotation.y = Math.PI; scene.add(dr);
  prop(1.50, 0.92, 0.50, MAT.woodLight, 0, 0.52, 0, 0.02, dr);
  prop(1.56, 0.04, 0.54, MAT.woodLight, 0, 1.00, 0, 0.015, dr);
  for (let i = 0; i < 3; i++) {
    const y = 0.28 + i * 0.28;
    prop(1.38, 0.24, 0.03, mat(0xa98a64, 0.65), 0, y, 0.255, 0.012, dr);
    box(new THREE.SphereGeometry(0.028, 10, 8), MAT.dark, -0.32, y, 0.285, dr);
    box(new THREE.SphereGeometry(0.028, 10, 8), MAT.dark, 0.32, y, 0.285, dr);
  }
  blockAt(-0.5, 3.66, 0.78, 0.28, F0, 1.05);
}

// ================================================================ kitchen
{
  const cab = mat(0x5c6b78, 0.7), top = mat(0x3a4046, 0.35, 0.1);
  // counter run along the z=-4 wall
  const RUNZ = MINZ + 0.32;
  prop(4.2, 0.86, 0.62, cab, -2.6, 0.43, RUNZ, 0.02);
  prop(4.3, 0.06, 0.66, top, -2.6, 0.89, RUNZ, 0.015);
  blockAt(-2.6, RUNZ, 2.15, 0.33, F0, 0.95);
  for (let i = 0; i < 5; i++)
    box(new THREE.BoxGeometry(0.02, 0.02, 0.30), MAT.metal, -4.4 + i * 0.86, 0.62, RUNZ + 0.32);

  // sink
  const sink = box(new THREE.BoxGeometry(0.66, 0.12, 0.44), mat(0xc8ccd0, 0.3, 0.6), -3.5, 0.86, RUNZ);
  sink.castShadow = false;
  box(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10), MAT.metal, -3.5, 1.06, RUNZ - 0.2);

  // hob + oven
  const hob = box(new THREE.BoxGeometry(0.72, 0.03, 0.5), MAT.dark, -1.5, 0.925, RUNZ);
  hob.castShadow = false;
  for (const [dx, dz] of [[-0.17, -0.12], [0.17, -0.12], [-0.17, 0.12], [0.17, 0.12]])
    box(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 16), mat(0x111214, 0.4),
        -1.5 + dx, 0.945, RUNZ + dz);
  prop(0.70, 0.60, 0.04, mat(0x35393d, 0.4, 0.3), -1.5, 0.5, RUNZ + 0.32, 0.01);

  // upper cabinets
  prop(1.9, 0.7, 0.34, cab, -3.4, 1.75, MINZ + 0.18, 0.02);
  prop(1.2, 0.7, 0.34, cab, -0.9, 1.75, MINZ + 0.18, 0.02);

  // fridge in the corner
  prop(0.72, 1.78, 0.7, mat(0xd3d7da, 0.35, 0.5), -4.6, 0.89, -1.6, 0.03);
  box(new THREE.BoxGeometry(0.03, 0.5, 0.02), MAT.metal, -4.23, 1.35, -1.32);
  blockAt(-4.6, -1.6, 0.36, 0.35, F0, 1.8);

  // island, with four stools spaced evenly around it
  const ISX = -2.0, ISZ = -1.8;
  prop(1.60, 0.86, 0.88, cab, ISX, 0.43, ISZ, 0.02);
  prop(1.74, 0.06, 1.02, top, ISX, 0.89, ISZ, 0.015);
  blockAt(ISX, ISZ, 0.87, 0.51, F0, 0.95);
  for (const [sx, sz] of [[ISX - 0.42, ISZ + 0.80], [ISX + 0.42, ISZ + 0.80],
                          [ISX - 0.42, ISZ - 0.80], [ISX + 0.42, ISZ - 0.80]]) {
    box(new THREE.CylinderGeometry(0.05, 0.055, 0.62, 10), MAT.metal, sx, 0.31, sz);
    box(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16), MAT.woodLight, sx, 0.65, sz);
    box(new THREE.TorusGeometry(0.13, 0.012, 6, 14).rotateX(Math.PI / 2), MAT.metal, sx, 0.20, sz);
    blockAt(sx, sz, 0.2, 0.2, F0, 0.7);
  }
}

// ================================================================ bedroom (upstairs)
{
  const frame = mat(0x6a4c30, 0.65), duvet = mat(0xb9c4cc, 0.95), pillow = mat(0xeef1f3, 0.95);
  const bx = -2.9, bz = -1.6;
  prop(1.62, 0.36, 2.06, frame, bx, F1 + 0.24, bz, 0.03);          // base
  prop(1.70, 0.12, 0.10, frame, bx, F1 + 0.66, bz - 1.02, 0.03);   // headboard
  prop(1.52, 0.20, 1.86, duvet, bx, F1 + 0.52, bz + 0.06, 0.06);   // duvet
  prop(0.62, 0.14, 0.34, pillow, bx - 0.36, F1 + 0.60, bz - 0.82, 0.06);
  prop(0.62, 0.14, 0.34, pillow, bx + 0.36, F1 + 0.60, bz - 0.82, 0.06);
  blockAt(bx, bz, 0.85, 1.05, F1, F1 + 0.7);

  // bedside table + lamp
  prop(0.44, 0.5, 0.4, MAT.woodLight, bx + 1.2, F1 + 0.25, bz - 0.85, 0.02);
  box(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 10), MAT.dark, bx + 1.2, F1 + 0.61, bz - 0.85);
  box(new THREE.CylinderGeometry(0.13, 0.16, 0.2, 14), mat(0xf2e2c4, 0.9), bx + 1.2, F1 + 0.82, bz - 0.85);
  blockAt(bx + 1.2, bz - 0.85, 0.24, 0.22, F1, F1 + 0.55);

  // wardrobe
  prop(1.3, 2.0, 0.6, MAT.woodLight, -0.4, F1 + 1.0, -3.5, 0.02);
  box(new THREE.BoxGeometry(0.02, 1.8, 0.02), MAT.metal, -0.42, F1 + 1.0, -3.19);
  box(new THREE.BoxGeometry(0.02, 1.8, 0.02), MAT.metal, -0.38, F1 + 1.0, -3.19);
  blockAt(-0.4, -3.5, 0.65, 0.32, F1, F1 + 2.0);

  // rug
  const r = box(roundedBox(2.2, 0.02, 1.5, 0.05), mat(0x9c8f86, 1.0), -2.2, F1 + 0.012, 1.0);
  r.castShadow = false;
}


// ================================================================ upstairs furnishing
function chest(x, z, rotY, w = 1.5) {
  const g = new THREE.Group(); g.position.set(x, F1, z); g.rotation.y = rotY; scene.add(g);
  prop(w, 0.92, 0.50, MAT.woodLight, 0, 0.52, 0, 0.02, g);
  prop(w + 0.06, 0.04, 0.54, MAT.woodLight, 0, 1.00, 0, 0.015, g);
  for (let i = 0; i < 3; i++) {
    const y = 0.28 + i * 0.28;
    prop(w - 0.12, 0.24, 0.03, mat(0xa98a64, 0.65), 0, y, 0.255, 0.012, g);
    box(new THREE.SphereGeometry(0.028, 10, 8), MAT.dark, -0.3, y, 0.285, g);
    box(new THREE.SphereGeometry(0.028, 10, 8), MAT.dark, 0.3, y, 0.285, g);
  }
  const hw = rotY ? 0.28 : w / 2, hd = rotY ? w / 2 : 0.28;
  blockAt(x, z, hw, hd, F1, F1 + 1.05);
  return g;
}

function armchair(x, z, rotY) {
  const g = new THREE.Group(); g.position.set(x, F1, z); g.rotation.y = rotY; scene.add(g);
  const f = mat(0x6f6558, 0.95), c = mat(0x8f8375, 0.95);
  prop(0.82, 0.30, 0.78, f, 0, 0.28, 0, 0.06, g);
  prop(0.82, 0.55, 0.16, f, 0, 0.62, -0.31, 0.06, g);
  prop(0.16, 0.34, 0.78, f, -0.33, 0.50, 0, 0.06, g);
  prop(0.16, 0.34, 0.78, f,  0.33, 0.50, 0, 0.06, g);
  prop(0.60, 0.14, 0.66, c, 0, 0.45, 0.03, 0.06, g);
  for (const [dx, dz] of [[-0.34, 0.32], [0.34, 0.32], [-0.34, -0.32], [0.34, -0.32]])
    box(new THREE.CylinderGeometry(0.03, 0.025, 0.13, 8), mat(0x3b2c1e, 0.6), dx, 0.065, dz, g);
  blockAt(x, z, 0.45, 0.45, F1, F1 + 0.8);
}

function bookshelf(x, z, rotY) {
  const g = new THREE.Group(); g.position.set(x, F1, z); g.rotation.y = rotY; scene.add(g);
  const w = MAT.woodLight;
  prop(0.92, 1.80, 0.05, w, 0, 0.90, -0.16, 0.01, g);
  prop(0.06, 1.80, 0.34, w, -0.43, 0.90, 0, 0.01, g);
  prop(0.06, 1.80, 0.34, w,  0.43, 0.90, 0, 0.01, g);
  const shelfY = [0.03, 0.47, 0.91, 1.35, 1.78];
  for (const y of shelfY) prop(0.86, 0.04, 0.34, w, 0, y, 0, 0.01, g);
  const cols = [0x7a3b34, 0x2f4a5c, 0x4a5c33, 0xa08a4a, 0x5c3a5c, 0x8a4a2a];
  for (const y of shelfY.slice(0, 3)) {
    let bx = -0.40;
    while (bx < 0.30) {
      const bw = 0.035 + rand() * 0.03, bh = 0.20 + rand() * 0.12;
      prop(bw, bh, 0.20, mat(cols[(rand() * cols.length) | 0], 0.85),
           bx + bw / 2, y + 0.02 + bh / 2, 0.03, 0.004, g);
      bx += bw + 0.007;
    }
  }
  blockAt(x, z, rotY ? 0.2 : 0.48, rotY ? 0.48 : 0.2, F1, F1 + 1.85);
}

function picture(x, y, z, rotY, w, h, colr) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
  prop(w + 0.07, h + 0.07, 0.03, mat(0x3a2c20, 0.6), 0, 0, 0, 0.008, g);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(colr, 0.9));
  art.position.z = 0.019;
  g.add(art);
}

function floorLamp(x, z) {
  box(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 16), MAT.dark, x, F1 + 0.015, z);
  box(new THREE.CylinderGeometry(0.022, 0.022, 1.35, 10), MAT.metal, x, F1 + 0.69, z);
  box(new THREE.CylinderGeometry(0.17, 0.21, 0.26, 16), mat(0xf2e2c4, 0.9), x, F1 + 1.48, z);
}

function plant(x, y, z) {
  box(new THREE.CylinderGeometry(0.11, 0.08, 0.2, 12), mat(0x8a5a42, 0.85), x, y + 0.1, z);
  box(new THREE.SphereGeometry(0.2, 10, 8), mat(0x3f6b3a, 0.95), x, y + 0.34, z);
}

// --- bedroom
{
  // second bedside table, mirroring the first across the bed
  prop(0.44, 0.5, 0.4, MAT.woodLight, -4.1, F1 + 0.25, -2.45, 0.02);
  prop(0.16, 0.03, 0.22, mat(0x2f4a5c, 0.8), -4.1, F1 + 0.52, -2.45, 0.006);
  prop(0.15, 0.03, 0.21, mat(0x7a3b34, 0.8), -4.1, F1 + 0.555, -2.44, 0.006);
  blockAt(-4.1, -2.45, 0.24, 0.22, F1, F1 + 0.55);

  chest(-4.7, 2.3, Math.PI / 2);
  plant(-4.55, F1 + 1.04, 2.3);
  armchair(-2.2, 3.05, Math.PI);          // under the front window, facing in
  floorLamp(-4.35, 3.5);
  bookshelf(-4.25, -3.72, 0);

  // door leaf standing open in the bedroom doorway, so the room reads as a room
  const bdoor = new THREE.Group();
  bdoor.position.set(0.5, F1, 0.4);
  bdoor.rotation.y = -1.4;                 // swung back almost flat against the wall
  scene.add(bdoor);
  prop(0.06, 2.03, 0.98, MAT.wood, 0, 1.015, 0.49, 0.01, bdoor);
  box(new THREE.SphereGeometry(0.04, 12, 10), MAT.metal, 0.06, 1.02, 0.88, bdoor);
  blockAt(0.02, 0.44, 0.50, 0.07, F1, F1 + 2.05);

  picture(-1.5, F1 + 1.65, -3.93, 0, 0.55, 0.7, 0x6d7f6a);
  picture(0.40, F1 + 1.6, -1.6, -Math.PI / 2, 0.5, 0.62, 0x8a6f7d);
}

// --- landing
{
  prop(1.05, 0.05, 0.34, MAT.woodLight, 2.0, F1 + 0.76, 3.72, 0.015);
  for (const x of [1.55, 2.45]) {
    box(new THREE.CylinderGeometry(0.032, 0.032, 0.74, 8), MAT.wood, x, F1 + 0.37, 3.65);
    box(new THREE.CylinderGeometry(0.032, 0.032, 0.74, 8), MAT.wood, x, F1 + 0.37, 3.80);
  }
  plant(2.0, F1 + 0.79, 3.72);
  blockAt(2.0, 3.72, 0.55, 0.2, F1, F1 + 0.8);
  picture(2.0, F1 + 1.62, 3.93, Math.PI, 0.6, 0.75, 0x7d7a8c);
}

// ================================================================ lighting
scene.add(new THREE.AmbientLight(0xccd5dd, 0.62));
scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x6a5744, 0.28));

const sun = new THREE.DirectionalLight(0xfff0dc, 2.1);
sun.position.set(14, 16, 12);
sun.target.position.set(-2, 1, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;   sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 1;   sun.shadow.camera.far = 48;
sun.shadow.bias = -0.0012;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const tvLight = new THREE.PointLight(0x88aaff, 1.5, 5, 2);
tvLight.position.set(-2.6, 1.2, 0.7);
scene.add(tvLight);
// Object3D.position is read-only, so it has to be set rather than assigned over.
function roomLight(color, intensity, dist, x, y, z) {
  const l = new THREE.PointLight(color, intensity, dist, 2);
  l.position.set(x, y, z);
  scene.add(l);
  return l;
}
roomLight(0xffe4bd, 2.4, 8, -2.6, 2.25, 2.2);      // living
roomLight(0xfff2e0, 3.2, 9, -2.4, 2.25, -2.0);     // kitchen
roomLight(0xffeede, 2.2, 8, 2.6, 2.25, 1.2);       // hall
roomLight(0xffe8d0, 2.4, 8, -2.6, F1 + 2.1, -1.0); // bedroom
roomLight(0xffeede, 2.0, 7, 2.6, F1 + 2.1, -0.5);  // landing

const ROOMS = [
  { name: 'Front garden', test: p => p.z > MAXZ },
  { name: 'Hall',         test: p => p.y < 1.4 && p.x > 0.5 },
  { name: 'Living room',  test: p => p.y < 1.4 && p.z > 0 },
  { name: 'Kitchen',      test: p => p.y < 1.4 },
  { name: 'Landing',      test: p => p.x > 0.5 },
  { name: 'Bedroom',      test: () => true }
];

// ================================================================ collision & floor
function resolve(pos, feetY) {
  const headY = feetY + 1.7;
  for (const b of blockers) {
    if (feetY >= b.y1 - 0.02 || headY <= b.y0 + 0.02) continue;   // wrong storey
    const dx = pos.x - b.x, dz = pos.z - b.z;
    const ox = b.hw + PR - Math.abs(dx);
    const oz = b.hd + PR - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) pos.x = b.x + Math.sign(dx || 1) * (b.hw + PR);
      else         pos.z = b.z + Math.sign(dz || 1) * (b.hd + PR);
    }
  }
}

const down = new THREE.Raycaster();
down.far = 3.0;
const DOWN = new THREE.Vector3(0, -1, 0);
const rayOrigin = new THREE.Vector3();

function floorHeight(pos, current) {
  // start just above the knee: high enough to mount a step, low enough not to
  // grab the storey above
  rayOrigin.set(pos.x, current + 0.7, pos.z);
  down.set(rayOrigin, DOWN);
  const hits = down.intersectObjects(walkables, false);
  return hits.length ? hits[0].point.y : current;
}

return {
  scene, blockers, walkables, ROOMS,
  doorPivot, tvLight, screenUniforms,
  resolve, floorHeight,
  EYE, WALK, PR, F0, F1, CEIL0, CEIL1, MINX, MAXX, MINZ, MAXZ
};
}
