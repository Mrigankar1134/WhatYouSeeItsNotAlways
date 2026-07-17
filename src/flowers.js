// Procedural flowers. Each emotion maps to a distinct, hand-tuned bloom.
// Built from primitive geometry so nothing external is loaded.
import * as THREE from 'three';
import { EMOTIONS } from './config.js';

const _c = new THREE.Color();

// per-emotion recipe
const RECIPE = {
  joy:       { petals: 13, len: 0.16, wid: 0.05, layers: 1, droop: 0.05, center: 0.06, centerCol: '#7a5a1e', stem: 0.85, petalShape: 'blade' },
  love:      { petals: 7,  len: 0.12, wid: 0.10, layers: 3, droop: 0.10, center: 0.03, centerCol: '#5e2f38', stem: 0.7,  petalShape: 'cup' },
  comfort:   { petals: 24, len: 0.045,wid: 0.03, layers: 5, droop: 0.02, center: 0.02, centerCol: '#5c4a72', stem: 1.05, petalShape: 'bud' },
  adventure: { petals: 18, len: 0.22, wid: 0.06, layers: 1, droop: 0.03, center: 0.11, centerCol: '#5b3d16', stem: 1.15, petalShape: 'blade' },
  goodbye:   { petals: 9,  len: 0.15, wid: 0.07, layers: 1, droop: 0.22, center: 0.045,centerCol: '#7a4a24', stem: 0.75, petalShape: 'cup' },
  silence:   { petals: 6,  len: 0.19, wid: 0.09, layers: 1, droop: 0.08, center: 0.03, centerCol: '#c9b56a', stem: 0.8,  petalShape: 'trumpet' },
};

function petalGeometry(shape, len, wid) {
  // a curved petal built from a plane, bent along its length
  const seg = 6;
  const geo = new THREE.PlaneGeometry(wid, len, 2, seg);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);              // -len/2 .. len/2
    const ny = (y + len / 2) / len;     // 0 base .. 1 tip
    let curl = 0, taper = 1;
    if (shape === 'cup')      { curl = Math.pow(ny, 2) * 0.10; taper = 1 - ny * 0.3; }
    else if (shape === 'blade'){ curl = Math.sin(ny * Math.PI) * 0.02; taper = 1 - Math.pow(ny, 3) * 0.85; }
    else if (shape === 'bud')  { curl = ny * 0.06; taper = 1 - ny * 0.5; }
    else if (shape === 'trumpet'){ curl = -Math.pow(ny,2) * 0.14; taper = 0.5 + ny * 0.6; }
    pos.setZ(i, curl);
    pos.setX(i, pos.getX(i) * taper);
  }
  geo.computeVertexNormals();
  geo.translate(0, len / 2, 0); // pivot at base
  return geo;
}

export function createFlower(emotion, variant = 0, opts = {}) {
  const e = EMOTIONS[emotion] || EMOTIONS.joy;
  const r = RECIPE[emotion] || RECIPE.joy;
  const group = new THREE.Group();

  const rng = mulberry32(hashStr(emotion) + variant * 7919);
  const stemH = r.stem * (0.9 + rng() * 0.25);

  // --- stem ---
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4e6b45, roughness: 0.85 });
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3((rng() - 0.5) * 0.06, stemH * 0.5, (rng() - 0.5) * 0.06),
    new THREE.Vector3((rng() - 0.5) * 0.05, stemH, 0),
  ]);
  const stemGeo = new THREE.TubeGeometry(stemCurve, 8, 0.012, 5, false);
  const stem = new THREE.Mesh(stemGeo, stemMat);
  group.add(stem);

  // a couple of leaves
  const leafGeo = petalGeometry('cup', 0.14, 0.07);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5a7a4b, roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 2; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.y = stemH * (0.3 + i * 0.22);
    leaf.rotation.y = i * Math.PI + rng();
    leaf.rotation.z = 0.9;
    leaf.scale.setScalar(0.8 + rng() * 0.4);
    group.add(leaf);
  }

  // --- head ---
  const head = new THREE.Group();
  head.position.y = stemH;
  group.add(head);

  const petalGeo = petalGeometry(r.petalShape, r.len, r.wid);
  const petalMat = new THREE.MeshStandardMaterial({
    color: _c.set(e.primary),
    emissive: _c.clone().set(e.glow),
    emissiveIntensity: 0.0,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide,
    flatShading: false,
  });

  const secMat = petalMat.clone();
  secMat.color.set(e.secondary);

  for (let layer = 0; layer < r.layers; layer++) {
    const count = Math.max(3, Math.round(r.petals / (layer * 0.5 + 1)));
    const tilt = r.droop + layer * 0.22;
    const lscale = 1 - layer * 0.16;
    for (let i = 0; i < count; i++) {
      const petal = new THREE.Mesh(petalGeo, layer % 2 ? secMat : petalMat);
      const a = (i / count) * Math.PI * 2 + layer * 0.4;
      petal.rotation.order = 'YXZ';
      petal.rotation.y = a;
      petal.rotation.x = -Math.PI / 2 + tilt;  // lay petals outward then tilt up
      petal.scale.setScalar(lscale * (0.92 + rng() * 0.16));
      petal.position.y = layer * 0.008;
      head.add(petal);
    }
  }

  // center disc
  const centerGeo = new THREE.SphereGeometry(r.center, 12, 10);
  centerGeo.scale(1, 0.55, 1);
  const centerMat = new THREE.MeshStandardMaterial({ color: _c.set(r.centerCol), roughness: 0.9 });
  const center = new THREE.Mesh(centerGeo, centerMat);
  head.add(center);

  group.userData = {
    emotion, head, petalMats: [petalMat, secMat], stemH,
    swayPhase: rng() * Math.PI * 2,
    swaySpeed: 0.6 + rng() * 0.5,
    bloom: 1, // 0 seed .. 1 open (used by planting sequence)
  };

  // scale for planting animation start
  if (opts.startClosed) setBloom(group, 0);

  group.scale.setScalar(opts.scale || 1);
  return group;
}

// drive the open/closed state (0 = seed, 1 = fully bloomed)
export function setBloom(flower, v) {
  const ud = flower.userData;
  ud.bloom = v;
  const head = ud.head;
  head.scale.setScalar(0.02 + v * 0.98);
  // fold petals inward when closed
  head.children.forEach((child) => {
    if (child.geometry && child.geometry.type === 'PlaneGeometry') {
      child.rotation.z = (1 - v) * 1.4;
    }
  });
  // reveal stem gradually
  flower.children.forEach((c) => { if (c.type === 'Mesh') c.visible = v > 0.05 || c.geometry.type !== 'TubeGeometry'; });
}

// gentle wind sway + night glow, called each frame
export function animateFlower(flower, time, wind, nightAmount) {
  const ud = flower.userData;
  const sway = Math.sin(time * ud.swaySpeed + ud.swayPhase) * (0.04 + wind * 0.09);
  flower.rotation.z = sway;
  flower.rotation.x = Math.cos(time * ud.swaySpeed * 0.7 + ud.swayPhase) * (0.02 + wind * 0.05);
  const glow = nightAmount * 0.5 * ud.bloom;
  ud.petalMats.forEach((m) => { m.emissiveIntensity = glow; });
}

// --- tiny deterministic RNG helpers ---
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
