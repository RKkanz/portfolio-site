// Humanoid hardware on the mechanical page: the Mk1.1 from its URDF (mk11/robot.urdf + GLB meshes, zero pose) with the
// areas I designed as selectable zones. Clicking a zone button or the robot itself lights that zone amber, turns the camera to it and
// shows its notes (the notes live in index.html as [data-zone] blocks).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ROBOT_MAT } from "./core.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
// meshes per zone (matched on the URDF mesh filename); az/el: camera direction (deg, az 90 = robot's front, +x), y: target height as a fraction of the robot,
// d: camera distance as a fraction of the full-body framing
const ZONES = {
  forearm: { re: /(Left|Right)WristRollLink_|wristcam_mount|hand_/, az: 140, el: 8, y: 0.47, d: 0.78 },
  torso: { re: /Torso_Front|Torso_Back\.glb|Torso_Shell\.glb#front/, az: 115, el: 12, y: 0.66, d: 0.72 },
  back: { re: /Torso_Shell\.glb#back/, az: 295, el: 14, y: 0.66, d: 0.72 },
  ankle: { re: /AnklePitchLink\.glb/, az: 125, el: 24, y: 0.05, d: 0.42 },
};

// Minimal URDF reader: link/joint tree at the zero pose, visual meshes only. URDF rpy = Rz Ry Rx (fixed axes).
const origin = (o, el) => {
  if (!el) return;
  const n = (a) => (el.getAttribute(a) || "0 0 0").trim().split(/\s+/).map(Number);
  o.position.fromArray(n("xyz"));
  const [r, p, y] = n("rpy"); o.quaternion.setFromEuler(new THREE.Euler(r, p, y, "ZYX"));
};
// The torso shell is one mesh; split it at mid-depth so the back cover can be lit on its own.
function splitShell(scene, file, xs = -0.04) {
  const meshes = []; scene.traverse((o) => o.isMesh && meshes.push(o));
  for (const m of meshes) {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, p = g.attributes.position;
    const keep = { front: [], back: [] };
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      keep[cx > xs ? "front" : "back"].push(i);
    }
    for (const side of ["front", "back"]) {
      const out = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) {
        const a = new Float32Array(keep[side].length * 3 * attr.itemSize);
        const n = attr.itemSize, get = ["getX", "getY", "getZ", "getW"];        // accessors: GLB attributes may be interleaved
        keep[side].forEach((i, k) => { for (let t = 0; t < 3; t++) for (let j = 0; j < n; j++) a[(k * 3 + t) * n + j] = attr[get[j]](i + t); });
        out.setAttribute(name, new THREE.BufferAttribute(a, attr.itemSize));
      }
      const half = new THREE.Mesh(out, m.material); half.castShadow = true; half.userData.file = file + "#" + side;
      half.position.copy(m.position); half.quaternion.copy(m.quaternion); half.scale.copy(m.scale);
      m.parent.add(half);
    }
    m.removeFromParent();
  }
}
async function loadURDF(url) {
  const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/xml");
  const robotEl = xml.querySelector("robot"), kids = (el, tag) => [...el.children].filter((c) => c.tagName === tag);
  const colors = {}, links = {}, files = new Map(), visuals = [];
  for (const m of xml.querySelectorAll("material")) { const c = m.querySelector("color"); if (c) colors[m.getAttribute("name")] = c.getAttribute("rgba"); }
  for (const L of kids(robotEl, "link")) {
    const g = new THREE.Group(); g.name = L.getAttribute("name"); links[g.name] = g;
    for (const V of kids(L, "visual")) {
      const mesh = V.querySelector("geometry > mesh");
      if (!mesh) continue;
      const file = mesh.getAttribute("filename"), mat = V.querySelector("material");
      const rgba = (mat && (mat.querySelector("color")?.getAttribute("rgba") || colors[mat.getAttribute("name")])) || "0.75 0.77 0.8 1";
      const holder = new THREE.Group(); origin(holder, V.querySelector("origin")); g.add(holder);
      visuals.push({ holder, file, rgba });
      if (!files.has(file)) files.set(file, null);
    }
  }
  const children = new Set();
  for (const J of kids(robotEl, "joint")) {
    const p = links[J.querySelector("parent").getAttribute("link")], c = links[J.querySelector("child").getAttribute("link")];
    if (!p || !c) continue;
    const f = new THREE.Group(); origin(f, J.querySelector("origin")); p.add(f); f.add(c); children.add(c.name);
  }
  const loader = new GLTFLoader();
  await Promise.all([...files.keys()].map((f) => loader.loadAsync(new URL(f, url).href).then((g) => files.set(f, g.scene))));
  const mats = {};
  for (const v of visuals) {
    const scene = files.get(v.file).clone(true);
    const [r, g, b] = v.rgba.split(/\s+/).map(Number);
    mats[v.rgba] ||= new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), roughness: 0.42, metalness: 0.05, clearcoat: 0.35 });
    scene.traverse((o) => { if (o.isMesh) { o.material = mats[v.rgba]; o.castShadow = true; o.userData.file = v.file; } });
    v.holder.add(scene);
    if (/Torso_Shell/.test(v.file)) splitShell(scene, v.file);
  }
  return links[Object.keys(links).find((n) => !children.has(n))];
}

export function mountHardware(root) {
  const viewer = root.querySelector(".viewer"), canvas = viewer.querySelector("canvas"), readout = viewer.querySelector("[data-part]");
  const buttons = [...root.querySelectorAll("button[data-zone]")], notes = [...root.querySelectorAll("div[data-zone]")];
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch { viewer.classList.add("no3d"); }
  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  const scene = new THREE.Scene();
  if (renderer) { scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45; }
  scene.add(new THREE.HemisphereLight(0xc8d2e0, 0x101215, 0.7));
  const key = new THREE.DirectionalLight(0xfff3e4, 2.2); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 0.9); rim.position.set(-4, 2, -5); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const controls = renderer && new OrbitControls(camera, canvas);
  if (controls) Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, enableZoom: false, minPolarAngle: 0.3, maxPolarAngle: Math.PI * 0.62 });

  const meshes = [];                                            // { mesh, zone, base }
  let H = 1.7, fly = null, visible = false, dirty = true, zone = null;
  const dim = new THREE.MeshPhysicalMaterial({ color: "#b9b7b2", roughness: 0.45, metalness: 0.02, clearcoat: 0.3 });

  // camera placement for a zone (or the whole robot when z is null)
  function shot(z) {
    const Z = ZONES[z] || { az: 120, el: 10, y: 0.52, d: 1 };
    const vf = THREE.MathUtils.degToRad(camera.fov / 2), hf = Math.atan(Math.tan(vf) * camera.aspect);
    const full = (H * 0.56) / Math.tan(Math.min(vf, hf));
    const az = THREE.MathUtils.degToRad(Z.az), el = THREE.MathUtils.degToRad(Z.el), d = full * Z.d;
    const target = new THREE.Vector3(0, H * Z.y, 0);
    return { target, pos: target.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d)) };
  }
  function select(z, instant) {
    zone = z;
    for (const m of meshes) m.mesh.material = m.zone === z ? ROBOT_MAT.accent : z ? dim : m.base;
    buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.zone === z)));
    notes.forEach((n) => (n.hidden = n.dataset.zone !== z));
    const s = shot(z);
    if (instant || reduceMotion || !controls) { camera.position.copy(s.pos); controls?.target.copy(s.target); fly = null; }
    else fly = { t: 0, at: performance.now(), p0: camera.position.clone(), t0: controls.target.clone(), p1: s.pos, t1: s.target };
    dirty = true;
  }
  buttons.forEach((b) => b.addEventListener("click", () => select(b.dataset.zone)));

  loadURDF(new URL("mk11/robot.urdf", import.meta.url).href).then((robot) => {
    const holder = new THREE.Group(); holder.rotation.x = -Math.PI / 2; holder.add(robot); scene.add(holder);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(robot);
    holder.position.y = -box.min.y; H = box.max.y - box.min.y;
    holder.position.x = -(box.min.x + box.max.x) / 2; holder.position.z = -(box.min.z + box.max.z) / 2;
    robot.traverse((o) => {
      if (!o.isMesh) return;
      const z = Object.keys(ZONES).find((k) => ZONES[k].re.test(o.userData.file || "")) || null;
      meshes.push({ mesh: o, zone: z, base: o.material });
    });
    size();
    select(buttons.find((b) => b.getAttribute("aria-selected") === "true")?.dataset.zone || "forearm", true);
    viewer.classList.add("ready");
  }).catch((e) => { console.warn("hardware viewer:", e); viewer.classList.add("no3d"); });

  // hover names the zone under the cursor; click selects it
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const label = (z) => buttons.find((b) => b.dataset.zone === z)?.textContent || "";
  function hit(e) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const h = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0];
    return h ? meshes.find((m) => m.mesh === h.object).zone : null;
  }
  canvas.addEventListener("pointermove", (e) => {
    const z = hit(e);
    canvas.style.cursor = z ? "pointer" : "";
    if (readout) readout.textContent = z ? label(z) : readout.dataset.part;
  });
  let down = null;
  canvas.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener("pointerup", (e) => {                 // a click, not the end of an orbit drag
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const z = hit(e); if (z) select(z); }
    down = null;
  });

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || !renderer) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    dirty = true;
  }
  new ResizeObserver(() => { size(); if (meshes.length) select(zone, true); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(viewer);
  controls?.addEventListener("start", () => { fly = null; });
  controls?.addEventListener("change", () => (dirty = true));

  renderer?.setAnimationLoop(() => {
    if (!visible || document.hidden || !meshes.length) return;
    if (fly) {
      fly.t = Math.min(1, (performance.now() - fly.at) / 900);
      const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
      // swing around the robot (spherical, shortest way round) rather than cutting through it
      const a = new THREE.Spherical().setFromVector3(fly.p0.clone().sub(fly.t0)), b = new THREE.Spherical().setFromVector3(fly.p1.clone().sub(fly.t1));
      let dt = b.theta - a.theta; dt -= Math.round(dt / (2 * Math.PI)) * 2 * Math.PI;
      controls.target.lerpVectors(fly.t0, fly.t1, e);
      camera.position.setFromSpherical(new THREE.Spherical(a.radius + (b.radius - a.radius) * e, a.phi + (b.phi - a.phi) * e, a.theta + dt * e)).add(controls.target);
      if (fly.t >= 1) fly = null;
      dirty = true;
    }
    controls.update();
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
  });
}
