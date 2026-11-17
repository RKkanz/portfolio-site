import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { INK, ACCENT, MAT, box, loadRollouts, loadG1, makeRig } from "./assets/lab/core.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RING = 26;

// ---------- content ----------
const ZONES = [
  {
    id: "stairs", title: "Stair Climbing", kicker: "Policy · motion imitation", when: "Nov 2026",
    live: "Imitation policy v11 climbing and descending a 16 cm rise, 30 cm tread staircase (sim rollout).",
    metrics: [["21 / 24", "clean climbs in sim (v5)"], ["24", "keyframed clips"], ["16", "training runs"]],
    summary: "My first route was a locomotion curriculum. It learned to descend but never climbed, because inherited reward overrides zeroed every climbing reward. So I switched to an animator-style method: keyframe the motion, then train a policy to imitate it.",
    bullets: [
      "Whole-body IK keyframes: 24 clips, up and down, rise 10–19 cm × tread 25–35 cm.",
      "One combined imitation policy, randomised on terrain, approach, COM, link mass and friction. 13 runs across 3 GPU hosts.",
      "A sim-to-sim robustness harness (noise, delay, gains, pushes) showed that 10–40 ms of latency is what breaks it, so that's next.",
    ],
  },
  {
    id: "catch", title: "Throw & Catch", kicker: "Policy · perception + arms", when: "Oct 2026",
    live: "The catch policy on two 4 m throws, both caught (sim rollouts). The throwing motion itself is animated.",
    metrics: [["~2 cm", "flight prediction error at catch"], ["3.9 m", "first in-the-loop throw caught"], ["96", "throws per candidate"]],
    summary: "The robot catches a thrown box. Head cameras track and predict the flight, and an arm policy brings both palms to the box at the right moment.",
    bullets: [
      "Arm-pose tables found by an overnight CEM search on 3 GPUs: 96 throws per candidate, 7-hour runs.",
      "Robot side built and deployed. In the full software-in-the-loop chain, the first throw was caught.",
    ],
  },
  {
    id: "pick", title: "Box Pick", kicker: "Policy · manipulation", when: "Nov 2026",
    live: "Staged pick policy on a 0.72 m table, box picked (sim rollout).",
    metrics: [["72.5%", "boxes lifted (b5)"], ["512", "random tables in eval"], ["21", "tests passing"]],
    summary: "A follow-on to catch: walk to a table, then lift the box with a two-palm squeeze. Pure PPO never reached the box. What worked was IK keyframe demonstrations with gravity-compensation offsets, used to train the policy.",
    bullets: [
      "Deterministic sim eval on 512 random tables: b6 lifted 64% and picked 39%; b5 lifted 72.5% and picked 50%.",
      "Walker and robot side built and tested.",
    ],
  },
  {
    id: "nav", title: "Vision Navigation", kicker: "Autonomy · VLM walker", when: "Sep — Oct 2026",
    live: "The locomotion policy walking a real recorded command stream from a navigation run.",
    metrics: [["76", "commits in 8 days"], ["38°", "camera-tilt error found & fixed"], ["×1.43", "stereo baseline fix"]],
    summary: "The humanoid walks to targets using only its head cameras. Stereo builds a top-down obstacle map, a Qwen vision-language model (optional) finds targets, and the result is sent as velocity commands to the walking policy. The operator page acts as a dead-man switch, backed by a watchdog.",
    bullets: [
      "Root-caused the planner seeing walls everywhere: camera tilt was off by 38° and the stereo baseline was 1.43× short.",
      "Built a scored software-in-the-loop simulator with headless stacks, plus an NN-free visual-inertial odometry branch (OKVIS2).",
      "Tested neural stereo (S2M2) live and rejected it: the floor read 2–3× too near.",
    ],
  },
  {
    id: "tools", title: "Diagnostic Tooling", kicker: "Software · for the service team", when: "Jul — Nov 2026",
    live: "Real screenshots: Overwatch on a demo robot, recall replaying an mk11 log, and robot-triage's report (internal details blurred).",
    metrics: [["20", "robot faults root-caused"], ["+1,727", "lines in one Overwatch PR"], ["6", "parallel lenses in /triage"]],
    summary: "Tools that make the next diagnosis faster for anyone on the team: replay a log, see what failed, and get a ranked verdict instead of a hunch.",
    bullets: [
      "recall: a browser telemetry visualizer. URDF replay, per-joint charts and a case library, with the robot-triage engine built in.",
      "robot-triage: a deterministic, headless diagnosis engine. On one real log it found a 0.5 s topic stall, recorder sequence gaps and a port clash in 6 s.",
      "Overwatch: live fleet diagnostics. Fault cards per actuator with the reason in plain words, EtherCAT bus health, and a 13-minute at-rest + sweep health check.",
      "/triage: multi-agent diagnosis with six subsystem lenses and adversarial verification, ending in one ranked verdict.",
      "Plus safe robot-config transfer and calibration comparison, allow-listed read-only SSH, live log mirroring, and CastLab, a desktop DFM app for die casting and molding.",
    ],
  },
];

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: 1 });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color("#f3f1ec");
scene.background = BG;
scene.fog = new THREE.Fog(BG, 75, 160);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 400);
const HOME = { pos: new THREE.Vector3(16, 44, 58), target: new THREE.Vector3(7, -2, 4) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 0.8;
controls.maxDistance = 120;
controls.target.copy(HOME.target);

scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.2));
const sun = new THREE.DirectionalLight(0xfff6ec, 2.2);
sun.position.set(24, 40, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, far: 120 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// ---------- world: a drafting-table floor with a ring of zones ----------
const floor = new THREE.Mesh(new THREE.CircleGeometry(64, 128), MAT.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(128, 128, 0xd6d2c8, 0xd6d2c8);
grid.material.transparent = true; grid.material.opacity = 0.55; grid.position.y = 0.002; scene.add(grid);

const zones = {};
ZONES.forEach((z, i) => {
  const a = (i / ZONES.length) * Math.PI * 2 + Math.PI / 2;     // first zone nearest the camera
  const g = new THREE.Group();
  g.position.set(Math.cos(a) * RING, 0, Math.sin(a) * RING);
  g.rotation.y = -a - Math.PI / 2;                                // local +z faces the centre
  scene.add(g);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.75, 0.06, 128), MAT.plat);
  plat.position.y = 0.03; plat.receiveShadow = true; g.add(plat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.68, 0.025, 8, 220), new THREE.MeshBasicMaterial({ color: INK }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.065; g.add(ring);
  const tick = new THREE.Mesh(new THREE.RingGeometry(7.95, 8.03, 160, 1, 0, Math.PI * 0.35), new THREE.MeshBasicMaterial({ color: ACCENT }));
  tick.rotation.x = -Math.PI / 2; tick.position.y = 0.012; g.add(tick);
  const el = document.createElement("div");
  el.className = "label";
  el.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>${esc(z.title)}`;
  el.style.pointerEvents = "auto";
  el.onclick = () => goSlide(i + 1);
  const lab = new CSS2DObject(el); lab.position.set(0, 5.2, 0); g.add(lab);
  // robots and props live in this z-up frame (the simulator's frame), on top of the platform
  const sim = new THREE.Group(); sim.rotation.x = -Math.PI / 2; sim.position.y = 0.06; g.add(sim);
  zones[z.id] = { data: z, group: g, sim, index: i, tick };
});

const tickers = [];
const clickables = [];
const nearTags = [];

// ---------- diagnostic tooling: three monitors showing real screenshots ----------
function buildTools() {
  const g = zones.tools.group;
  const screens = [["recall", "assets/media/tools/recall-loaded.jpg"], ["Overwatch", "assets/media/tools/overwatch-overview.jpg"], ["robot-triage", "assets/media/tools/robot-triage-terminal.jpg"]];
  const loader = new THREE.TextureLoader();
  screens.forEach(([name, src], i) => {
    const tex = loader.load(src, (t) => {                       // cover-fit the shot into the 16:9.4 screen
      const vis = (t.image.width / t.image.height) / (2.6 / 1.52);
      if (vis < 1) { t.repeat.set(1, vis); t.offset.set(0, 1 - vis); } else { t.repeat.set(1 / vis, 1); }
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.52), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const frame = box(2.75, 1.67, 0.06, MAT.prop);
    const stand = box(0.08, 1.3, 0.08, MAT.prop);
    const foot = box(0.7, 0.04, 0.4, MAT.prop);
    const grp = new THREE.Group();
    grp.position.set((i - 1) * 3.1, 0.06, 0.6 + Math.abs(i - 1) * 0.9);
    grp.rotation.y = Math.PI + (i - 1) * 0.4;
    frame.position.y = 2.05; scr.position.set(0, 2.05, 0.035); stand.position.y = 0.65; foot.position.y = 0.02;
    grp.add(frame, scr, stand, foot); g.add(grp);
    const el = document.createElement("div"); el.className = "tag"; el.textContent = name;
    el.style.pointerEvents = "auto"; el.onclick = () => goSlide(zones.tools.index + 1);
    const lab = new CSS2DObject(el); lab.position.set(0, 3.15, 0); grp.add(lab); nearTags.push({ obj: lab, zone: "tools" });
  });
}

// ---------- slides / panel ----------
const slides = [{ kind: "hero" }, ...ZONES.map((z) => ({ kind: "zone", id: z.id }))];
let cur = 0, fly = null, autoplay = null;
const bar = $("bar");
bar.innerHTML = `<button class="nav" id="prev" aria-label="Previous">‹</button>` +
  slides.map((s, i) => `<button class="s" data-i="${i}">${s.kind === "hero" ? "Intro" : esc(zones[s.id].data.title)}</button>`).join("") +
  `<span class="count" id="count"></span><button class="nav" id="next" aria-label="Next">›</button>`;
bar.querySelectorAll("button.s").forEach((b) => (b.onclick = () => { stopAuto(); goSlide(+b.dataset.i); }));
$("prev").onclick = () => { stopAuto(); goSlide(cur - 1); };
$("next").onclick = () => { stopAuto(); goSlide(cur + 1); };
$("start").onclick = () => goSlide(1);
$("close").onclick = () => $("panel").classList.remove("open");
addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); stopAuto(); goSlide(cur + 1); }
  if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); stopAuto(); goSlide(cur - 1); }
  if (e.key === "Escape") goSlide(0);
});
function stopAuto() { if (autoplay) { clearInterval(autoplay); autoplay = null; $("tour").textContent = "▶ Auto-play"; } }
$("tour").onclick = () => {
  if (autoplay) return stopAuto();
  $("tour").textContent = "❚❚ Pause";
  if (cur === 0) goSlide(1);
  autoplay = setInterval(() => goSlide(cur + 1 < slides.length ? cur + 1 : 0), 14000);
};

const panel = $("panel"), body = $("panelBody");
function zoneHTML(z) {
  let h = `<p class="mono kicker">${esc(z.kicker)}</p><h2>${esc(z.title)}</h2><p class="mono when">${esc(z.when)}</p>`;
  if (z.live) h += `<div class="live">${esc(z.live)}</div>`;
  if (z.metrics) h += `<div class="metrics">${z.metrics.map(([b, s]) => `<div><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("")}</div>`;
  h += `<p>${esc(z.summary)}</p>`;
  if (z.bullets?.length) h += `<ul>${z.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  if (z.media?.length) h += z.media.map((m) => `<figure><img src="${esc(m.src)}" alt="${esc(m.caption)}" loading="lazy"><figcaption>${esc(m.caption)}</figcaption></figure>`).join("");
  return h;
}
function setPanel(html) {
  body.innerHTML = html; panel.scrollTop = 0; panel.classList.add("open");
}
const VIEW = { stairs: [8.5, 3.6, 0.9], catch: [9, 3.8, 1.0], pick: [4.6, 2.3, 0.9], nav: [11, 7.5, 0.6], tools: [9.5, 3.6, 1.4] };
function zoneView(id) {
  const [dist, h, ty] = VIEW[id];
  const c = zones[id].group.position.clone();
  const out = c.clone().setY(0).normalize();
  const right = new THREE.Vector3(out.z, 0, -out.x);
  const wide = innerWidth > 900;
  const shift = wide ? right.multiplyScalar(dist * 0.3) : new THREE.Vector3();
  return { pos: c.clone().add(out.clone().multiplyScalar(wide ? dist : dist * 1.35)).add(shift).setY(wide ? h : h * 1.5), target: c.clone().add(shift).setY(wide ? ty : ty - 1.2) };
}
function goSlide(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  cur = i;
  const s = slides[i];
  bar.querySelectorAll("button.s").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
  bar.querySelector("button.s.on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  $("count").textContent = `${i + 1} / ${slides.length}`;
  $("hero").classList.toggle("hide", s.kind !== "hero");
  history.replaceState(null, "", s.kind === "hero" ? location.pathname : "#" + s.id);
  if (s.kind === "hero") { panel.classList.remove("open"); flyTo(HOME.pos, HOME.target); return; }
  setPanel(zoneHTML(zones[s.id].data));
  const v = zoneView(s.id);
  flyTo(v.pos, v.target);
}
function flyTo(pos, target) { fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone() }; }
controls.addEventListener("start", () => { fly = null; stopAuto(); });

const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(clickables.map((c) => c.obj), true);
  if (hits.length) {
    const k = clickables.find((c) => { let o = hits[0].object; while (o) { if (o === c.obj) return true; o = o.parent; } return false; });
    if (k) return k.onClick();
  }
  const g = ray.intersectObject(floor)[0];
  if (!g) return;
  for (const z of Object.values(zones)) if (g.point.distanceTo(z.group.position) < 7.7) return goSlide(z.index + 1);
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
});

// ---------- boot ----------
try {
  const [ROLL, g1] = await Promise.all([loadRollouts(), loadG1((f) => ($("prog").style.width = `${Math.round(f * 100)}%`))]);
  const rig = makeRig(ROLL);
  rig.ground(g1);
  const robots = [g1, ...Array.from({ length: 5 }, () => g1.clone())];
  rig.buildStairs(zones.stairs.sim, robots[0], robots[1], tickers);
  rig.buildCatch(zones.catch.sim, robots[2], robots[3], tickers);
  rig.buildPick(zones.pick.sim, robots[4], tickers);
  const hud = document.createElement("div"); hud.className = "tag hud";
  const hudObj = new CSS2DObject(hud); nearTags.push({ obj: hudObj, zone: "nav" });
  const navWorld = rig.buildNav(zones.nav.sim, robots[5], tickers, (k, p, fwd, cmd) => {
    hudObj.position.set(p[0], p[1], 2.15);
    hud.textContent = `command ${cmd[0].toFixed(2)} m/s · ${cmd[1].toFixed(2)} rad/s`;
  });
  navWorld.add(hudObj);
  buildTools();
  const deep = ZONES.findIndex((z) => "#" + z.id === location.hash);
  goSlide(deep >= 0 ? deep + 1 : 0);
  $("loading").style.opacity = 0; setTimeout(() => $("loading").remove(), 800);
} catch (e) {
  $("err").hidden = false;
  $("err").textContent = "The 3D scene couldn't load (" + e.message + "). Your browser may not support WebGL.";
}

const clock = new THREE.Clock();
let T = 0;
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05);
  T += dt;
  for (const f of tickers) f(T, dt);
  for (const n of nearTags) n.obj.visible = camera.position.distanceTo(zones[n.zone].group.position) < 22;
  if (fly) {
    fly.t = Math.min(1, fly.t + Math.min(raw, 0.5) / 1.6);       // camera moves on wall-clock time, even on slow GPUs
    const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
    camera.position.lerpVectors(fly.p0, fly.p1, k);
    controls.target.lerpVectors(fly.t0, fly.t1, k);
    if (fly.t >= 1) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
