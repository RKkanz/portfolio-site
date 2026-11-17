// Hero figure: the Unitree G1 replaying recorded policy rollouts, one scene at a time (tabs switch scenes)
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PAPER, MAT, loadRollouts, loadG1, makeRig, studio } from "./assets/lab/core.js";

const root = document.getElementById("hero3d");
const canvas = root.querySelector("canvas");
const cap = document.getElementById("h3dCap"), link = document.getElementById("h3dLink");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const SCENES = {
  stairs: { cap: "STAIR POLICY v11 · 16 CM RISE", hash: "stairs", dir: [0.95, 0.5, 0.75], zoom: 1.05 },
  catch: { cap: "CATCH POLICY · 4 M THROWS", hash: "catch", dir: [0.12, 0.36, 1], zoom: 0.62 },
  pick: { cap: "PICK POLICY · 0.72 M TABLE", hash: "pick", dir: [1, 0.5, 0.75], zoom: 0.6 },
  walk: { cap: "WALKING POLICY · REAL NAV COMMANDS · 2.5×", hash: "nav", dir: [0.7, 0.75, 0.9], zoom: 1, follow: true },
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
const scene = new THREE.Scene();
scene.background = new THREE.Color(PAPER);
const sun = studio(scene, renderer, { shadow: 1024, span: 3.5 });
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, enableZoom: false, enablePan: false, maxPolarAngle: Math.PI * 0.49 });

const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), MAT.floor);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(80, 160, 0xd6d2c8, 0xd6d2c8);
grid.position.y = 0.001; scene.add(grid);

function size() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1); camera.updateProjectionMatrix();
}
new ResizeObserver(size).observe(canvas);

let active = null, T = 0, follow = null;
const built = {};

function frame(name) {
  const s = built[name], spec = SCENES[name];
  const b = new THREE.Box3().setFromObject(s.group);
  const c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
  const target = spec.follow ? new THREE.Vector3(0, 0.8, 0) : c.setY(Math.min(c.y, 0.9));
  const dist = (spec.follow ? 4.6 : r * 2.1) / spec.zoom;
  const d = new THREE.Vector3(...spec.dir).normalize();
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(d, dist);
  controls.update();
}

function show(name) {
  if (!built[name]) return;
  active = name; T = 0;
  for (const [k, s] of Object.entries(built)) s.group.visible = k === name;
  root.querySelectorAll("[data-scene]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.scene === name)));
  cap.textContent = SCENES[name].cap;
  link.href = "lab.html#" + SCENES[name].hash;
  follow = SCENES[name].follow ? built[name].robot : null;
  frame(name);
  if (reduceMotion) render(2.5);
}
root.querySelectorAll("[data-scene]").forEach((b) => (b.onclick = () => show(b.dataset.scene)));

function render(t) {
  for (const f of built[active].tickers) f(t);
  if (follow) {
    const p = follow.getWorldPosition(new THREE.Vector3()).setY(0.8);
    const d = p.clone().sub(controls.target);
    controls.target.add(d); camera.position.add(d);
    sun.position.set(p.x + 4, 7.7, p.z + 3.5); sun.target.position.copy(p); sun.target.updateMatrixWorld();
  } else {
    sun.position.set(4.2, 7.7, 3.5); sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
  }
  controls.update();
  renderer.render(scene, camera);
}

let visible = true;
new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(root);

try {
  const [ROLL, g1] = await Promise.all([
    loadRollouts(),
    loadG1((f) => root.style.setProperty("--load", f.toFixed(2))),
  ]);
  const rig = makeRig(ROLL);
  rig.ground(g1);
  const R = () => g1.clone();
  const mk = (name, build) => {
    const group = new THREE.Group(); group.rotation.x = -Math.PI / 2; scene.add(group);
    const tickers = [];
    const robot = build(group, tickers);
    built[name] = { group, tickers, robot };
  };
  mk("stairs", (g, tk) => { rig.buildStairs(g, g1, R(), tk); return g1; });
  mk("catch", (g, tk) => { rig.buildCatch(g, R(), R(), tk); });
  mk("pick", (g, tk) => { rig.buildPick(g, R(), tk); });
  mk("walk", (g, tk) => { const r = R(); rig.buildNav(g, r, tk); return r; });
  for (const s of Object.values(built)) for (const f of s.tickers) f(0);
  size();
  show("stairs");
  root.classList.add("ready");
  if (!reduceMotion) {
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible || document.hidden) return;
      T += dt;
      render(T);
    });
  }
} catch (e) {
  root.classList.add("failed");
  console.warn("3D hero unavailable:", e);
}
