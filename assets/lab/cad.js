// CAD models converted offline from Onshape STEP exports (assets/models/*.json + .bin): one mesh per body, in metres,
// z-up, each with an explode offset. loadModel() builds them as a THREE.Group; mountViewer() is the standalone spin
// view used on the mechanical page (orbit, assembled ↔ exploded slider, hover to name a part).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const here = (p) => new URL(p, import.meta.url).href;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EDGE = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 });

export async function loadModel(name) {
  const [man, bin] = await Promise.all([
    fetch(here(`../models/${name}.json`)).then((r) => r.json()),
    fetch(here(`../models/${name}.bin`)).then((r) => r.arrayBuffer()),
  ]);
  const group = new THREE.Group(), mats = {};
  const parts = man.parts.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bin, p.pos[0], p.pos[1]), 3));
    const I = p.idx[2] === 2 ? Uint16Array : Uint32Array;
    g.setIndex(new THREE.BufferAttribute(new I(bin, p.idx[0], p.idx[1]), 1));
    g.computeVertexNormals();
    const metal = /bearing|Shaft hardware|Connector/.test(p.label);
    mats[p.color] ||= new THREE.MeshStandardMaterial({ color: p.color, roughness: metal ? 0.35 : 0.62, metalness: metal ? 0.55 : 0.04 });
    const mesh = new THREE.Mesh(g, mats[p.color]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), EDGE));
    const holder = new THREE.Group(); holder.add(mesh); group.add(holder);
    mesh.userData.part = p;
    return { ...p, holder, mesh, off: new THREE.Vector3(...p.explode) };
  });
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
  // bounds of the model at explode fraction t (from the per-part boxes, cheap enough to call every frame)
  const bounds = (t) => {
    lo.set(Infinity, Infinity, Infinity); hi.set(-Infinity, -Infinity, -Infinity);
    for (const p of parts) for (let k = 0; k < 3; k++) {
      const c = p.center[k] + p.explode[k] * t;
      lo.setComponent(k, Math.min(lo.getComponent(k), c - p.size[k] / 2));
      hi.setComponent(k, Math.max(hi.getComponent(k), c + p.size[k] / 2));
    }
    return new THREE.Box3(lo.clone(), hi.clone());
  };
  let t = 0;
  const setExplode = (v) => { t = v; for (const p of parts) p.holder.position.copy(p.off).multiplyScalar(v); };
  return { group, parts, bounds, setExplode, get t() { return t; } };
}

// opts: { model, tilt: Euler applied to the z-up model, view: [az, el] in degrees, explode: initial fraction }
export function mountViewer(root, opts) {
  const canvas = root.querySelector("canvas"), slider = root.querySelector("input[type=range]"), readout = root.querySelector("[data-part]");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch { root.classList.add("no3d"); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight(0xc8d2e0, 0x101215, 0.7));
  const key = new THREE.DirectionalLight(0xfff3e4, 2.2); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 0.9); rim.position.set(-4, 2, -5); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, enableZoom: false, autoRotate: !reduceMotion, autoRotateSpeed: 1.1 });
  let idle;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idle); });
  controls.addEventListener("end", () => { if (!reduceMotion) idle = setTimeout(() => (controls.autoRotate = true), 6000); });

  let M = null, dist = 1, want = 1, visible = false, dirty = true;
  const pivot = new THREE.Group(); scene.add(pivot);
  const [az, el] = (opts.view || [35, 22]).map(THREE.MathUtils.degToRad);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

  loadModel(opts.model).then((m) => {
    M = m;
    const holder = new THREE.Group();
    holder.rotation.set(-Math.PI / 2, 0, 0);                    // z-up CAD frame → y-up
    if (opts.tilt) m.group.rotation.set(...opts.tilt);
    holder.add(m.group); pivot.add(holder);
    // pivot about the assembled centre so the spin doesn't wobble
    pivot.updateMatrixWorld(true);
    const c = m.bounds(0).getCenter(new THREE.Vector3()).applyMatrix4(m.group.matrixWorld);
    holder.position.sub(c);
    set(opts.explode ?? 0);
    dist = want; camera.position.copy(dir).multiplyScalar(dist);
    root.classList.add("ready");
  }).catch((e) => { console.warn("viewer:", e); root.classList.add("no3d"); });

  function frameDist() {
    pivot.updateMatrixWorld(true);
    const s = M.bounds(M.t).applyMatrix4(M.group.matrixWorld).getBoundingSphere(new THREE.Sphere());
    const vf = THREE.MathUtils.degToRad(camera.fov / 2), hf = Math.atan(Math.tan(vf) * camera.aspect);
    return (s.radius / Math.sin(Math.min(vf, hf))) * 0.84 + s.center.length();  // a sphere overstates a long assembly
  }
  function set(v) { M.setExplode(v); want = frameDist(); dirty = true; if (slider) slider.value = String(Math.round(v * 1000)); }
  slider?.addEventListener("input", () => M && set(slider.value / 1000));

  // hover: name the part under the cursor
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let hot = null, hotMat = null;
  const name = (p) => (p ? p.label : "");
  function pick(e) {
    if (!M) return;
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(M.parts.map((p) => p.mesh), false)[0];
    const mesh = hit ? hit.object : null;
    if (mesh === hot) return;
    if (hot) hot.material = hotMat;
    hot = mesh;
    if (hot) { hotMat = hot.material; hot.material = hotMat.clone(); hot.material.emissive.set(0xffb020); hot.material.emissiveIntensity = 0.35; }
    if (readout) readout.textContent = hot ? name(hot.userData.part) : readout.dataset.part;
    dirty = true;
  }
  canvas.addEventListener("pointermove", pick);
  canvas.addEventListener("pointerleave", () => pick({ clientX: -1e5, clientY: -1e5 }));

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (M) want = frameDist();
    dirty = true;
  }
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(root);
  controls.addEventListener("change", () => (dirty = true));

  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden || !M) return;
    if (Math.abs(want - dist) > 1e-4) { dist += (want - dist) * 0.12; dirty = true; }
    camera.position.setLength(dist);
    controls.update();
    if (!dirty && !controls.autoRotate) return;
    dirty = false;
    renderer.render(scene, camera);
  });
  return { set };
}
