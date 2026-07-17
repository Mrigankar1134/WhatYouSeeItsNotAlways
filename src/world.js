// The world: terrain, sky, gate, garden, pond, bench, bridge, meadow,
// instanced grass with wind, particles, a calm camera on a spline,
// a full time-of-day cycle, and plantable soil spots.
import * as THREE from 'three';
import { createFlower, setBloom, animateFlower } from './flowers.js';
import { ZONES } from './config.js';

const TMP = new THREE.Vector3();

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.reducedMotion = false;
    this.quality = 'cinematic';
    this.wind = 0.4;
    this.travel = 0;            // 0..1 along the path
    this.targetTravel = 0;
    this.travelVel = 0;
    this.timeMs = 6 * 60 * 1000; // start near sunrise (of a 24-min day)
    this.dayLength = 24 * 60 * 1000;
    this.nightAmount = 0;
    this.pointer = new THREE.Vector2(0, 0);
    this.parallax = new THREE.Vector2(0, 0);
    this.clock = new THREE.Clock();
    this.flowers = new Map();   // id -> flower group
    this.spots = [];            // {pos, occupied, mesh, glow}
    this.hovered = null;
    this.benchOn = false;
    this.callbacks = {};
    this._raycaster = new THREE.Raycaster();
    this._initRenderer();
    this._initScene();
    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildGrass();
    this._buildGate();
    this._buildPropsAndZones();
    this._buildPond();
    this._buildParticles();
    this._buildPath();
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  on(name, fn) { this.callbacks[name] = fn; }
  emit(name, ...a) { if (this.callbacks[name]) this.callbacks[name](...a); }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x1a241d, 0.028);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.camera.position.set(0, 1.6, 8);
    this.camGroup = new THREE.Group();
    this.camGroup.add(this.camera);
    this.scene.add(this.camGroup);
  }

  // ---------- SKY ----------
  _buildSky() {
    const geo = new THREE.SphereGeometry(240, 32, 24);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x1a2c3a) },
        mid: { value: new THREE.Color(0xd7a98a) },
        bot: { value: new THREE.Color(0x2a2420) },
        sunDir: { value: new THREE.Vector3(0, 0.3, -1) },
        sunColor: { value: new THREE.Color(0xffe6b8) },
        sunI: { value: 1.0 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 top,mid,bot,sunColor,sunDir; uniform float sunI;
        void main(){
          float h = vP.y;
          vec3 col = mix(mid, top, smoothstep(0.0, 0.55, h));
          col = mix(bot, col, smoothstep(-0.25, 0.02, h));
          float s = max(dot(normalize(vP), normalize(sunDir)), 0.0);
          col += sunColor * pow(s, 64.0) * sunI * 1.4;         // sun disc glow
          col += sunColor * pow(s, 4.0) * sunI * 0.18;          // horizon wash
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.sky);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbfd4e0, 0x2c3326, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffdca8, 2.0);
    this.sun.position.set(6, 10, -4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 80;
    const d = 30;
    Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0x404838, 0.35);
    this.scene.add(this.ambient);
  }

  // ---------- TERRAIN ----------
  _buildTerrain() {
    const size = 220, seg = 128;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = Math.sin(x * 0.06) * Math.cos(z * 0.05) * 0.6
            + Math.sin(x * 0.19 + 1.3) * 0.25
            + Math.cos(z * 0.13) * 0.3;
      // flatten a walkable corridor near x≈0
      const corridor = Math.exp(-(x * x) / 40);
      h *= (1 - corridor * 0.8);
      // raise distant rim
      const dist = Math.hypot(x, z);
      if (dist > 60) h += (dist - 60) * 0.12;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3d5238, roughness: 1.0, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      // subtle vertex-colour variation without textures
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float n = fract(sin(dot(vViewPosition.xz, vec2(12.9,78.2)))*43758.5);
         diffuseColor.rgb *= 0.86 + n*0.16;`
      );
    };
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this._groundGeo = geo;
  }

  groundHeight(x, z) {
    let h = Math.sin(x * 0.06) * Math.cos(z * 0.05) * 0.6
          + Math.sin(x * 0.19 + 1.3) * 0.25 + Math.cos(z * 0.13) * 0.3;
    const corridor = Math.exp(-(x * x) / 40);
    h *= (1 - corridor * 0.8);
    return h;
  }

  // ---------- GRASS ----------
  _buildGrass() {
    const blade = new THREE.PlaneGeometry(0.05, 0.5, 1, 4);
    blade.translate(0, 0.25, 0);
    const pos = blade.attributes.position;
    for (let i = 0; i < pos.count; i++) {           // taper to a tip
      const y = pos.getY(i);
      pos.setX(i, pos.getX(i) * (1 - y / 0.5) * 0.9);
    }
    blade.computeVertexNormals();

    const count = this.quality === 'gentle' ? 5000 : (this.quality === 'balanced' ? 14000 : 26000);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f8a4a, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uWind = { value: this.wind };
      this._grassUniforms = sh.uniforms;
      sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float bend = position.y / 0.5;
         float w = sin(uTime*1.3 + instanceMatrix[3][0]*0.6 + instanceMatrix[3][2]*0.5);
         transformed.x += bend*bend * w * (0.06 + uWind*0.18);
         transformed.z += bend*bend * cos(uTime*0.9 + instanceMatrix[3][2]) * (0.03 + uWind*0.08);`
      );
      // tip lighter, base darker for depth
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.rgb *= mix(0.6, 1.15, clamp(vViewPosition.y*0.0+0.5,0.0,1.0));`
      );
    };
    this.grass = new THREE.InstancedMesh(blade, mat, count);
    this.grass.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let placed = 0;
    for (let i = 0; i < count * 2 && placed < count; i++) {
      const x = (Math.random() - 0.5) * 120;
      const z = 20 - Math.random() * 110;
      if (Math.abs(x) < 1.4 && z > -80) continue; // keep the path clear-ish
      const y = this.groundHeight(x, z);
      q.setFromAxisAngle(up, Math.random() * Math.PI);
      const sc = 0.6 + Math.random() * 1.1;
      s.set(sc, sc * (0.7 + Math.random() * 0.7), sc);
      m.compose(new THREE.Vector3(x, y, z), q, s);
      this.grass.setMatrixAt(placed++, m);
    }
    this.grass.count = placed;
    this.grass.instanceMatrix.needsUpdate = true;
    this.scene.add(this.grass);
  }

  // ---------- GATE ----------
  _buildGate() {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x20261f, roughness: 0.6, metalness: 0.7 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x555049, roughness: 0.95 });
    // two pillars
    for (const sx of [-1.6, 1.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, 0.6), stone);
      p.position.set(sx, 2.1, 2);
      p.castShadow = true; g.add(p);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), stone);
      cap.position.set(sx, 4.4, 2); g.add(cap);
    }
    // gate leaves (two swinging halves)
    this.gateLeaves = [];
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group();
      leaf.position.set(side * 1.3, 0, 2);
      const barMat = iron;
      for (let i = 0; i < 5; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6), barMat);
        bar.position.set(side * (0.12 + i * 0.24), 1.9, 0);
        leaf.add(bar);
      }
      for (const yy of [0.6, 1.9, 3.2]) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.05), barMat);
        h.position.set(side * 0.62, yy, 0); leaf.add(h);
      }
      // a decorative curl at top
      const curl = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 16, Math.PI), barMat);
      curl.position.set(side * 0.6, 3.5, 0); curl.rotation.z = side > 0 ? 0 : Math.PI;
      leaf.add(curl);
      g.add(leaf);
      this.gateLeaves.push({ group: leaf, side });
    }
    // ivy hint (green boxes) on pillars
    const ivyMat = new THREE.MeshStandardMaterial({ color: 0x33482f, roughness: 1 });
    for (let i = 0; i < 40; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), ivyMat);
      const sx = (Math.random() > 0.5 ? 1.6 : -1.6) + (Math.random() - 0.5) * 0.6;
      leaf.position.set(sx, Math.random() * 4, 2 + (Math.random() - 0.5) * 0.6);
      leaf.scale.setScalar(0.6 + Math.random());
      g.add(leaf);
    }
    this.gate = g;
    this.scene.add(g);
  }

  setGateOpen(v) { // v 0 closed .. 1 open
    for (const l of this.gateLeaves) {
      l.group.rotation.y = -l.side * v * 1.15;
    }
  }

  // ---------- TREES / BENCH / BRIDGE / MEADOW ----------
  _tree(x, z, scale = 1, bare = false) {
    const g = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * scale, 0.32 * scale, 3.2 * scale, 7), trunkMat);
    trunk.position.y = 1.6 * scale; trunk.castShadow = true; g.add(trunk);
    if (!bare) {
      const foliMat = new THREE.MeshStandardMaterial({ color: 0x3f5c34, roughness: 1 });
      for (let i = 0; i < 4; i++) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 * scale, 1), foliMat);
        blob.position.set((Math.random() - 0.5) * 1.4 * scale, (3 + Math.random() * 1.4) * scale, (Math.random() - 0.5) * 1.4 * scale);
        blob.scale.set(1, 0.85, 1); blob.castShadow = true;
        g.add(blob);
      }
    } else {
      const branchMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
      for (let i = 0; i < 6; i++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, 1.6 * scale, 5), branchMat);
        br.position.set(0, (3 + i * 0.2) * scale, 0);
        br.rotation.z = (Math.random() - 0.5) * 1.6; br.rotation.x = (Math.random() - 0.5) * 1.6;
        g.add(br);
      }
    }
    g.position.set(x, this.groundHeight(x, z), z);
    g.userData.sway = Math.random() * 6;
    this.scene.add(g);
    (this._trees ||= []).push(g);
    return g;
  }

  _buildPropsAndZones() {
    // ancient tree (hero) beside the garden
    this.ancientTree = this._tree(-9, -26, 2.4);
    // scattered trees framing the path
    const spots = [[-14, -6], [13, -10], [-16, -18], [16, -22], [-13, -40], [15, -44], [-18, -58], [14, -60], [-20, -74], [18, -70]];
    spots.forEach(([x, z]) => this._tree(x, z, 1 + Math.random() * 0.8));

    // Quiet bench near the pond
    this._buildBench(4.2, -50);

    // Forgotten bridge
    this._buildBridge(0, -64);

    // Exit meadow: a luminous gate of light
    this._buildMeadowGate(0, -82);

    // Fern / wildflower clusters (non-memory decoration)
    const fernMat = new THREE.MeshStandardMaterial({ color: 0x4f6b3c, roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() - 0.5) * 60;
      const z = 6 - Math.random() * 84;
      if (Math.abs(x) < 2 && z > -78) continue;
      const fern = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 5, 1, true), fernMat);
      fern.position.set(x, this.groundHeight(x, z) + 0.35, z);
      fern.rotation.y = Math.random() * 6;
      this.scene.add(fern);
    }
  }

  _buildBench(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a4736, roughness: 0.9 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.6), wood);
    seat.position.y = 0.5; seat.castShadow = true; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.08), wood);
    back.position.set(0, 0.78, -0.26); g.add(back);
    for (const lx of [-0.85, 0.85]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), wood);
      leg.position.set(lx, 0.25, 0); g.add(leg);
    }
    g.position.set(x, this.groundHeight(x, z), z);
    g.rotation.y = -0.5;
    this.bench = g;
    this.benchPos = new THREE.Vector3(x, 1.2, z);
    this.scene.add(g);
  }

  _buildBridge(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 });
    // near half of the bridge, then it breaks into mist
    for (let i = 0; i < 6; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.5), wood);
      plank.position.set(0, 0.4 - i * 0.02, z + 3 - i * 0.7);
      plank.rotation.z = (Math.random() - 0.5) * 0.05;
      if (i > 3) plank.rotation.x = (i - 3) * 0.15; // sagging
      g.add(plank);
    }
    for (const sx of [-1.1, 1.1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 4.2), wood);
      rail.position.set(sx, 0.7, z + 1); g.add(rail);
    }
    g.position.set(x, this.groundHeight(x, z) + 0.2, 0);
    this.scene.add(g);
  }

  _softGlowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  _buildMeadowGate(x, z) {
    const g = new THREE.Group();
    // a soft radial bloom of light rather than a hard plane
    this.meadowGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 12),
      new THREE.MeshBasicMaterial({ map: this._softGlowTexture(), color: 0xf4e6c8, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.meadowGlow.position.set(x, 4, z);
    g.add(this.meadowGlow);
    this.scene.add(g);
  }

  // ---------- POND ----------
  _buildPond() {
    const px = 6, pz = -50, r = 6;
    this.pondCenter = new THREE.Vector3(px, this.groundHeight(px, pz) + 0.02, pz);
    const geo = new THREE.CircleGeometry(r, 48);
    geo.rotateX(-Math.PI / 2);
    this.pondMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uColorDeep: { value: new THREE.Color(0x263d43) },
        uColorShallow: { value: new THREE.Color(0x79969c) },
        uSky: { value: new THREE.Color(0x9fb7c0) },
        uRipple: { value: new THREE.Vector3(0, 0, -1) }, // x,z,age
        uNight: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
          gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        varying vec2 vUv; varying vec3 vW; uniform float uTime,uNight;
        uniform vec3 uColorDeep,uColorShallow,uSky,uRipple;
        void main(){
          vec2 c = vUv - 0.5;
          float d = length(c);
          float ripples = sin(d*40.0 - uTime*2.0) * 0.5 + 0.5;
          ripples *= smoothstep(0.5,0.0,d);
          // interactive ripple
          vec2 rp = uRipple.xy;
          float rd = length(vW.xz - rp);
          float rw = sin(rd*6.0 - uRipple.z*8.0) * exp(-rd*0.6) * exp(-uRipple.z*1.2);
          vec3 col = mix(uColorShallow, uColorDeep, smoothstep(0.0,0.5,d));
          col += uSky * (0.18 + ripples*0.12 + rw*0.5);
          col = mix(col, col*0.4 + vec3(0.05,0.08,0.09), uNight*0.6);
          float alpha = 0.86;
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.pond = new THREE.Mesh(geo, this.pondMat);
    this.pond.position.copy(this.pondCenter);
    this.scene.add(this.pond);
    this._rippleAge = 999;
    this._ripplePos = new THREE.Vector2(px, pz);

    // reeds + lily pads
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3f6440, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.35 + Math.random() * 0.2, 12), padMat);
      pad.rotation.x = -Math.PI / 2;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * (r - 1);
      pad.position.set(px + Math.cos(a) * rr, this.pondCenter.y + 0.03, pz + Math.sin(a) * rr);
      this.scene.add(pad);
    }
  }

  pondRipple(worldX, worldZ) {
    this._rippleAge = 0;
    this._ripplePos.set(worldX, worldZ);
    this.pondMat.uniforms.uRipple.value.set(worldX, worldZ, 0);
  }

  // ---------- PARTICLES ----------
  _buildParticles() {
    const mkPoints = (n, spread, y, size, color, opacity) => {
      const g = new THREE.BufferGeometry();
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = (Math.random() - 0.5) * spread;
        arr[i * 3 + 1] = Math.random() * y;
        arr[i * 3 + 2] = 10 - Math.random() * 90;
      }
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      const p = new THREE.Points(g, m);
      this.scene.add(p);
      return p;
    };
    const pollenN = this.quality === 'gentle' ? 120 : (this.quality === 'balanced' ? 300 : 600);
    this.pollen = mkPoints(pollenN, 80, 8, 0.06, 0xf2d8ae, 0.5);
    this.pollen.userData.base = this.pollen.geometry.attributes.position.array.slice();
    // fireflies (only shown at night)
    this.fireflies = mkPoints(90, 60, 4, 0.11, 0xf5e6a0, 0.0);
    this.fireflies.userData.base = this.fireflies.geometry.attributes.position.array.slice();

    // falling petals
    this._buildPetals();
  }

  _petalTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    // a soft, asymmetric petal shape with a feathered edge
    const grd = ctx.createRadialGradient(32, 26, 2, 32, 30, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(32, 30, 16, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  _buildPetals() {
    const n = this.quality === 'gentle' ? 24 : 64;
    const g = new THREE.PlaneGeometry(0.09, 0.055);
    const mat = new THREE.MeshBasicMaterial({ map: this._petalTexture(), color: 0xe9b2b7, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false });
    this.petals = new THREE.InstancedMesh(g, mat, n);
    this._petalData = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const d = {
        x: (Math.random() - 0.5) * 60, y: Math.random() * 12, z: 10 - Math.random() * 80,
        vy: 0.2 + Math.random() * 0.3, rot: Math.random() * 6, rs: (Math.random() - 0.5) * 2,
        sway: Math.random() * 6,
      };
      this._petalData.push(d);
      m.makeTranslation(d.x, d.y, d.z);
      this.petals.setMatrixAt(i, m);
    }
    this.scene.add(this.petals);
  }

  // ---------- CAMERA PATH ----------
  _buildPath() {
    // a gentle S-curve walking forward (−z), drifting toward the pond then meadow
    this.pathCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.6, 8),
      new THREE.Vector3(0.4, 1.6, 0),
      new THREE.Vector3(-0.6, 1.6, -10),
      new THREE.Vector3(0.5, 1.6, -22),
      new THREE.Vector3(2.5, 1.55, -36),
      new THREE.Vector3(3.6, 1.5, -48),   // near pond/bench
      new THREE.Vector3(1.0, 1.55, -60),  // toward bridge
      new THREE.Vector3(0, 1.6, -74),
      new THREE.Vector3(0, 1.7, -86),     // meadow
    ]);
  }

  // ---------- PLANT SPOTS ----------
  _soilTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    // earthy speckle
    ctx.fillStyle = '#3a2c20'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const g = 30 + Math.random() * 40;
      ctx.fillStyle = `rgba(${g + 20},${g},${g - 8},${Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    // feather the circular edge into transparency so it melts into the grass
    const grd = ctx.createRadialGradient(64, 64, 30, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.fill();
    return new THREE.CanvasTexture(c);
  }

  ensureSpots() {
    // create bare-soil planting spots in the garden zone if not already present
    if (this.spots.length) return;
    const soilTex = this._soilTexture();
    const soilMat = new THREE.MeshStandardMaterial({ map: soilTex, color: 0x6a5842, roughness: 1, transparent: true, opacity: 0.75, depthWrite: false });
    const layout = [
      [-3, -18], [-1.5, -22], [1.6, -20], [3.2, -24], [-2.4, -26],
      [0.5, -28], [2.4, -30], [-3.4, -31], [1.2, -33], [-1.2, -34],
      [3.6, -35], [-2.8, -37], [0.2, -38], [2.0, -40], [-1.8, -41],
    ];
    for (const [x, z] of layout) {
      const y = this.groundHeight(x, z);
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), soilMat.clone());
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, y + 0.015, z);
      disc.receiveShadow = true;
      // glow ring under the soil
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(0.6, 24),
        new THREE.MeshBasicMaterial({ color: 0x6b4934, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, y + 0.015, z);
      this.scene.add(disc); this.scene.add(glow);
      const spot = { pos: new THREE.Vector3(x, y, z), occupied: false, mesh: disc, glow };
      disc.userData.spot = spot;
      this.spots.push(spot);
    }
  }

  // find nearest free spot to the camera focus (for a fresh planting)
  freeSpot() {
    const focus = this._focusPoint();
    let best = null, bd = Infinity;
    for (const s of this.spots) {
      if (s.occupied) continue;
      const d = s.pos.distanceTo(focus);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  addFlowerFromRecord(rec, opts = {}) {
    const flower = createFlower(rec.emotion, rec.flowerVariant || 0, opts);
    const p = rec.worldPosition;
    flower.position.set(p.x, this.groundHeight(p.x, p.z), p.z);
    flower.userData.record = rec;
    flower.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(flower);
    this.flowers.set(rec.id, flower);
    // mark spot occupied
    const s = this.spots.find((sp) => sp.pos.distanceTo(flower.position) < 0.8);
    if (s) s.occupied = true;
    return flower;
  }

  removeFlower(id) {
    const f = this.flowers.get(id);
    if (!f) return;
    const s = this.spots.find((sp) => sp.pos.distanceTo(f.position) < 0.8);
    if (s) s.occupied = false;
    this.scene.remove(f);
    f.traverse((o) => { o.geometry?.dispose?.(); });
    this.flowers.delete(id);
  }

  // ---------- interaction ----------
  updatePointer(nx, ny) { this.pointer.set(nx, ny); }

  _focusPoint() {
    // a point ~6m ahead of the camera along the ground
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const cp = new THREE.Vector3();
    this.camera.getWorldPosition(cp);
    return cp.add(dir.multiplyScalar(6)).setY(0);
  }

  pick() {
    this._raycaster.setFromCamera(this.pointer, this.camera);
    // flowers first
    const flowerMeshes = [];
    this.flowers.forEach((f) => f.traverse((o) => { if (o.isMesh) { o.userData._flower = f; flowerMeshes.push(o); } }));
    let hit = this._raycaster.intersectObjects(flowerMeshes, false)[0];
    if (hit && hit.distance < 30) return { type: 'flower', flower: hit.object.userData._flower, record: hit.object.userData._flower.userData.record };
    // plant spots
    const discs = this.spots.filter((s) => !s.occupied).map((s) => s.mesh);
    hit = this._raycaster.intersectObjects(discs, false)[0];
    if (hit && hit.distance < 24) return { type: 'spot', spot: hit.object.userData.spot };
    // pond
    hit = this._raycaster.intersectObject(this.pond, false)[0];
    if (hit) return { type: 'pond', point: hit.point };
    // bench
    if (this.bench) {
      hit = this._raycaster.intersectObject(this.bench, true)[0];
      if (hit && hit.distance < 18) return { type: 'bench' };
    }
    return { type: 'none' };
  }

  setHover(result) {
    // reset previous
    if (this.hovered && this.hovered.type === 'spot') this.hovered.spot._hover = false;
    this.hovered = result && (result.type === 'spot' || result.type === 'flower') ? result : null;
    if (result && result.type === 'spot') result.spot._hover = true;
  }

  // ---------- planting ceremony ----------
  plantMemory(rec, onDone) {
    const flower = this.addFlowerFromRecord(rec, { startClosed: true });
    this.emit('cue', 'seed');
    const start = performance.now();
    const dur = this.reducedMotion ? 3200 : 12000;
    const spot = this.spots.find((s) => s.pos.distanceTo(flower.position) < 0.8);
    const animate = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      // phases: seed(0-.15) soil glow, sprout(.2-.6), bloom(.6-1)
      if (spot) spot.glow.material.opacity = Math.sin(Math.min(t, 0.6) / 0.6 * Math.PI) * 0.5;
      const bloom = t < 0.2 ? 0 : Math.min(1, (t - 0.2) / 0.8);
      const eased = bloom < 0.5 ? 2 * bloom * bloom : 1 - Math.pow(-2 * bloom + 2, 2) / 2;
      setBloom(flower, eased);
      if (t > 0.6 && !flower.userData._chord) { flower.userData._chord = true; this.emit('cue', 'bloom'); }
      if (t < 1) requestAnimationFrame(animate);
      else { if (spot) spot.glow.material.opacity = 0; onDone && onDone(flower); }
    };
    animate();
    return flower;
  }

  // ---------- time of day ----------
  setTimeMs(ms) { this.timeMs = ms % this.dayLength; }

  _updateTimeOfDay() {
    const dayFrac = this.timeMs / this.dayLength; // 0..1
    const sunAngle = (dayFrac - 0.25) * Math.PI * 2; // sunrise at 0.25
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle);
    this.sun.position.set(sunX * 20, Math.max(-0.3, sunY) * 24 + 2, -6 + sunX * 6);
    this.sun.target.position.set(0, 0, -30);

    this.nightAmount = THREE.MathUtils.clamp((-sunY + 0.15) * 1.6, 0, 1);
    const day = 1 - this.nightAmount;

    // colour keyframes
    const cDawn = new THREE.Color(0xf2d8ae), cNoon = new THREE.Color(0xfff4e0);
    const cDusk = new THREE.Color(0xd99755), cNight = new THREE.Color(0x2a3550);
    const horizonDawn = new THREE.Color(0xe0a878), horizonNoon = new THREE.Color(0xcfe0e6);
    const horizonNight = new THREE.Color(0x24303f);

    const nearHorizon = Math.pow(1 - Math.abs(sunY), 2); // 1 at horizon
    const sunColor = new THREE.Color().copy(cNoon).lerp(cDusk, nearHorizon * 0.8).lerp(cNight, this.nightAmount);
    const topCol = new THREE.Color(0x24405a).lerp(new THREE.Color(0x0c1420), this.nightAmount);
    const midCol = new THREE.Color().copy(horizonNoon).lerp(horizonDawn, nearHorizon).lerp(horizonNight, this.nightAmount);
    const botCol = new THREE.Color(0x2a2420).lerp(new THREE.Color(0x0a1016), this.nightAmount);

    this.skyMat.uniforms.top.value.copy(topCol);
    this.skyMat.uniforms.mid.value.copy(midCol);
    this.skyMat.uniforms.bot.value.copy(botCol);
    this.skyMat.uniforms.sunColor.value.copy(sunColor);
    this.skyMat.uniforms.sunDir.value.copy(this.sun.position).normalize();
    this.skyMat.uniforms.sunI.value = 0.4 + day * 0.9;

    this.sun.color.copy(sunColor);
    this.sun.intensity = 0.15 + day * 2.2;
    this.hemi.intensity = 0.25 + day * 0.7;
    this.hemi.color.copy(midCol);
    this.ambient.intensity = 0.2 + day * 0.25;

    // fog + water tone
    this.scene.fog.color.copy(midCol).multiplyScalar(0.55).lerp(new THREE.Color(0x0c1414), this.nightAmount * 0.6);
    this.scene.fog.density = 0.015 + this.nightAmount * 0.012 + this._weatherFog;
    this.pondMat.uniforms.uNight.value = this.nightAmount;
    this.pondMat.uniforms.uSky.value.copy(midCol);

    // fireflies + firefly-glow flowers at night
    this.fireflies.material.opacity = this.nightAmount * 0.9;
    this.meadowGlow.material.opacity = 0.05 + day * 0.05;

    this.emit('grade', { night: this.nightAmount, horizon: midCol });
  }

  // ---------- weather ----------
  _weatherFog = 0;
  setWeather(kind) {
    // simple, gentle: adjusts fog + wind
    this._weather = kind;
    if (kind === 'mist') { this._weatherFog = 0.013; this.setWind(0.25); }
    else if (kind === 'rain') { this._weatherFog = 0.012; this.setWind(0.7); }
    else if (kind === 'wind') { this._weatherFog = 0; this.setWind(0.85); }
    else { this._weatherFog = 0; this.setWind(0.4); }
  }
  setWind(w) { this._targetWind = w; }

  // ---------- quality / motion ----------
  setReducedMotion(on) { this.reducedMotion = on; }

  benchFocus(on) {
    this.benchOn = on;
  }

  // ease the camera to the point on the path nearest a world position
  approach(pos) {
    let bestT = this.travel, bd = Infinity;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const p = this.pathCurve.getPointAt(t);
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bd) { bd = d; bestT = t; }
    }
    this.setTargetTravel(bestT);
  }

  // ---------- travel ----------
  setTargetTravel(t) { this.targetTravel = THREE.MathUtils.clamp(t, 0, 1); }
  nudgeTravel(dt) { this.setTargetTravel(this.targetTravel + dt); }

  currentZoneId() {
    let id = ZONES[0].id;
    for (const z of ZONES) if (this.travel >= z.t - 0.02) id = z.id;
    return id;
  }

  // ---------- main update ----------
  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;

    // advance world time
    if (!this.reducedMotion || true) this.timeMs = (this.timeMs + dt * 1000) % this.dayLength;
    this._updateTimeOfDay();

    // wind easing
    this._targetWind ??= this.wind;
    this.wind += (this._targetWind - this.wind) * dt * 0.6;
    if (this._grassUniforms) { this._grassUniforms.uTime.value = time; this._grassUniforms.uWind.value = this.wind; }

    // travel damping
    const prevZone = this.currentZoneId();
    if (this.benchOn) {
      // hold near the bench viewpoint
    } else {
      const diff = this.targetTravel - this.travel;
      this.travelVel += diff * dt * 2.4;
      this.travelVel *= 0.86;
      this.travel = THREE.MathUtils.clamp(this.travel + this.travelVel * dt * 3, 0, 1);
    }
    const nowZone = this.currentZoneId();
    if (nowZone !== prevZone) this.emit('zone', nowZone);

    // position camera
    if (this.benchOn && this.benchPos) {
      this.camera.parent.position.lerp(new THREE.Vector3(0, 0, 0), 0.02);
      const look = new THREE.Vector3(this.pondCenter.x, 1.0, this.pondCenter.z);
      this.camGroup.position.lerp(this.benchPos, 0.03);
      this.camera.position.set(0, 0, 0);
      this._camLookAt(look);
    } else {
      const p = this.pathCurve.getPointAt(this.travel);
      this.camGroup.position.lerp(p, 0.08);
      // look a little further along the path
      const ahead = this.pathCurve.getPointAt(Math.min(1, this.travel + 0.04));
      this.camera.position.set(0, 0, 0);
      this._camLookAt(new THREE.Vector3(ahead.x, ahead.y - 0.2, ahead.z));
    }

    // subtle mouse parallax (max ~1.5°)
    if (!this.reducedMotion) {
      this.parallax.x += (this.pointer.x * 0.026 - this.parallax.x) * 0.04;
      this.parallax.y += (this.pointer.y * 0.018 - this.parallax.y) * 0.04;
      this.camera.rotation.y += this.parallax.x;
      this.camera.rotation.x += this.parallax.y;
    }

    // gate breeze on the leaves before opening handled externally

    // trees sway
    if (this._trees) for (const t of this._trees) t.rotation.z = Math.sin(time * 0.5 + t.userData.sway) * 0.01 * (1 + this.wind);

    // flowers
    this.flowers.forEach((f) => animateFlower(f, time, this.wind, this.nightAmount));

    // spot glow on hover
    for (const s of this.spots) {
      const target = s._hover ? 0.5 : 0;
      s.glow.material.opacity += (target - s.glow.material.opacity) * 0.15;
      s.mesh.position.y = s.pos.y + 0.02 + (s._hover ? 0.005 : 0);
    }

    // particles
    this._updateParticles(time, dt);

    // pond
    this.pondMat.uniforms.uTime.value = time;
    this._rippleAge += dt;
    this.pondMat.uniforms.uRipple.value.set(this._ripplePos.x, this._ripplePos.y, this._rippleAge);

    this.renderer.render(this.scene, this.camera);
  }

  _camLookAt(target) {
    const wp = new THREE.Vector3();
    this.camGroup.getWorldPosition(wp);
    // orient the group toward target, keep camera local rotation for parallax
    const m = new THREE.Matrix4().lookAt(wp, target, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.camGroup.quaternion.slerp(q, this.benchOn ? 0.05 : 0.09);
    this.camera.rotation.set(0, 0, 0);
  }

  _updateParticles(time, dt) {
    // pollen drift
    const pp = this.pollen.geometry.attributes.position;
    const base = this.pollen.userData.base;
    for (let i = 0; i < pp.count; i++) {
      pp.array[i * 3] = base[i * 3] + Math.sin(time * 0.3 + i) * 0.6;
      pp.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(time * 0.2 + i * 1.3) * 0.4;
    }
    pp.needsUpdate = true;

    if (this.nightAmount > 0.3) {
      const fp = this.fireflies.geometry.attributes.position;
      const fb = this.fireflies.userData.base;
      for (let i = 0; i < fp.count; i++) {
        fp.array[i * 3] = fb[i * 3] + Math.sin(time * 0.5 + i) * 1.5;
        fp.array[i * 3 + 1] = fb[i * 3 + 1] + Math.sin(time * 0.7 + i * 2) * 0.8 + Math.abs(Math.sin(time * 0.3 + i)) * 1.5;
      }
      fp.needsUpdate = true;
      this.fireflies.material.opacity = this.nightAmount * (0.4 + Math.abs(Math.sin(time * 2)) * 0.5);
    }

    // petals fall + reset
    if (this.petals && !this.reducedMotion) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
      const up = new THREE.Vector3(0, 0, 1);
      for (let i = 0; i < this._petalData.length; i++) {
        const d = this._petalData[i];
        d.y -= d.vy * dt * (0.5 + this.wind);
        d.x += Math.sin(time + d.sway) * dt * (0.4 + this.wind * 0.6);
        d.rot += d.rs * dt;
        if (d.y < 0) { d.y = 10 + Math.random() * 3; d.x = (Math.random() - 0.5) * 60; d.z = 10 - Math.random() * 80; }
        pos.set(d.x, d.y, d.z);
        q.setFromAxisAngle(up, d.rot);
        m.compose(pos, q, s);
        this.petals.setMatrixAt(i, m);
      }
      this.petals.instanceMatrix.needsUpdate = true;
    }
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
