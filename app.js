import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MAT, box, loadRollouts, loadRobot, makeRig } from "./assets/lab/core.js";
import { loadModel, mountViewer } from "./assets/lab/cad.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SIG = "#ffb020";

// ---------- content ----------
// view: camera [x, y, z] and target [x, y, z] relative to the chapter's stage
const MEDIA = "assets/media/";
const CHAPTERS = {
  robotics: [
    {
      id: "stairs", short: "Stair climbing", stage: "stairs", view: [[3.8, 2.1, 4.6], [-0.2, 0.75, 0]],
      kick: "Foundation Robotics · 2026", title: "Stair-climbing policy",
      lede: "Animator-style RL: keyframe the motion with whole-body IK, then train one policy to imitate it across 24 staircases.",
      spec: [["Clean climbs (sim)", "21 / 24"], ["Reference clips", "24, up and down"], ["Stair range", "rise 10–19 cm × tread 25–35 cm"], ["Training runs", "16, across 3 GPU hosts"], ["Failure mode found", "10–40 ms sensor latency"]],
      notes: ["A locomotion curriculum learned to descend but never climbed: inherited reward overrides zeroed every climbing reward.", "Randomized terrain, approach, COM, link mass and friction; sim-to-sim harness for noise, delay, gains and pushes."],
      media: { video: "policies/stairs.mp4", cap: "Sim rollouts on four staircases (run v11)" },
      caption: "Recorded rollout · policy v11 · 16 cm rise, 30 cm tread · Mk1.1 kinematics, simplified geometry",
    },
    {
      id: "catch", short: "Throw & catch", stage: "catch", view: [[0.4, 2.7, 8.6], [0, 1.05, 0]],
      kick: "Foundation Robotics · 2026", title: "Throw & catch",
      lede: "Head cameras track and predict a thrown box; an arm policy brings both palms to it at the right moment.",
      spec: [["Prediction error at catch", "~2 cm"], ["Throw distance", "3.9–4 m"], ["Search", "CEM, 96 throws per candidate"], ["Status", "Deployed on robot"]],
      notes: ["Arm-pose tables found by overnight CEM search on 3 GPUs, 7-hour runs.", "In the full software-in-the-loop chain, the first throw was caught."],
      media: { video: "policies/catch.mp4", cap: "Catch rollout, run r15 (held)" },
      caption: "Recorded rollouts · catch policy · two 4 m throws, both caught · throw wind-up animated",
    },
    {
      id: "pick", short: "Box pick", stage: "pick", view: [[2.3, 1.75, 2.7], [0.15, 0.9, 0]],
      kick: "Foundation Robotics · 2026", title: "Box pick",
      lede: "Walk to a table and lift a box with a two-palm squeeze. Pure PPO never reached the box; IK demonstrations did.",
      spec: [["Boxes lifted (b5)", "72.5%"], ["Boxes picked (b5)", "50%"], ["Eval set", "512 randomized tables"], ["Tests", "21 passing"]],
      notes: ["IK keyframe demonstrations with gravity-compensation offsets, used to train the staged policy.", "Walker and robot side built and tested."],
      media: { video: "policies/pick.mp4", cap: "New vs old pick policy" },
      caption: "Recorded rollout · staged pick policy · 0.72 m table",
    },
    {
      id: "nav", short: "Navigation", stage: "nav", follow: true, view: [[3.4, 3.2, 4.4], [0, 0.85, 0]],
      kick: "Foundation Robotics · 2026", title: "Vision navigation",
      lede: "The humanoid walks to targets using only its head cameras: stereo occupancy map, optional VLM targeting, velocity commands to the walking policy.",
      spec: [["Camera-tilt error found", "38°"], ["Stereo baseline fix", "×1.43"], ["Pace", "76 commits in 8 days"], ["Safety", "Dead-man switch + watchdog"]],
      notes: ["Root-caused the planner seeing walls everywhere: tilt off by 38°, baseline 1.43× short.", "Scored software-in-the-loop simulator; NN-free VIO branch (OKVIS2). Rejected neural stereo: floor read 2–3× too near."],
      media: { img: "policies/nav.png", cap: "SITL mission: through a door, planned path in orange", dark: true },
      caption: "Recorded commands from a real navigation run · walking policy · 2.5× speed",
    },
    {
      id: "diag", short: "Fleet diagnostics", stage: "diag", view: [[0.2, 2.1, 6.6], [0, 1.4, -0.8]],
      kick: "Foundation Robotics · 2026", title: "Fleet diagnostics",
      lede: "Tools so the next fault takes minutes instead of days: replay a log, see what failed, get a ranked verdict.",
      spec: [["Faults root-caused", "20, across 8+ robots"], ["Overwatch", "Live per-actuator fault cards, bus health"], ["recall", "Log replay on the URDF, per-joint charts"], ["robot-triage", "Ranked verdict in ~6 s"]],
      notes: ["Faults included EtherCAT dropouts, an encoder failing 43% of bring-ups, harness chafe and a 3.4× knee-gain regression.", "/triage runs six subsystem lenses with adversarial verification, ending in one verdict."],
      media: { shots: ["tools/overwatch-overview.jpg", "tools/recall-loaded.jpg", "tools/robot-triage-terminal.jpg"], cap: "Overwatch · recall · robot-triage (internal details blurred)" },
      caption: "Real recordings on the monitors: recall, Overwatch, robot-triage · click a monitor to open it · internal details blurred",
    },
    {
      id: "boat", short: "Autonomous boat", stage: "boat", explode: true, view: [[2.0, 1.6, 2.6], [0.05, 0.9, 0]],
      kick: "ASNE · Aug 2025 — Jan 2026", title: "Autonomous boat",
      lede: "Owned the full autonomy and AI stack. A printed test boat carries it on the water before it runs on the 6 ft fiberglass race hull.",
      spec: [["Autonomy", "ROS + ArduPilot, onboard control + navigation"], ["State estimation", "GPS + IMU + vision, filtered in real time"], ["Test boat", "0.92 m, printed PLA sealed in epoxy"], ["Sensors", "Here3 GPS on a mast, forward camera"], ["Race hull", "6 ft fiberglass planing V-hull, 40 kn"]],
      notes: ["The printed boat exists to test the autonomy policy on the water: cheap to build, cheap to rebuild.", "The planing V-hull beat the team's earlier displacement hulls to reach 40 knots."],
      media: [
        { img: "boat/boat-printed-cutout.jpg", cap: "Printed test boat, assembled", paper: true },
        { img: "boat/hull-fiberglass.jpg", cap: "6 ft fiberglass planing V-hull, after layup" },
      ],
      caption: "Onshape assembly of the test boat, true scale · slide to explode",
    },
  ],
};

// ---------- renderer / scene ----------
const canvas = $("stage");
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch { document.body.classList.add("no3d"); }
const scene = new THREE.Scene();
const BG = new THREE.Color("#0c0d0f");
scene.background = BG;
scene.fog = new THREE.Fog(BG, 14, 46);
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.05, 200);
const labels = new CSS2DRenderer();
Object.assign(labels.domElement.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: 5 });
document.body.appendChild(labels.domElement);

let controls;
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 1.2, maxDistance: 14, maxPolarAngle: Math.PI * 0.49 });
}

// dark studio palette for the shared props
MAT.floor.color.set("#101215"); MAT.plat.color.set("#15171a"); MAT.prop.color.set("#2b2e34"); MAT.propLight.color.set("#3a3e45");
MAT.concrete.color.set("#7f8388"); MAT.nosing.color.set(SIG); MAT.wood.color.set("#6a5440"); MAT.card.color.set("#b08d5a");

scene.add(new THREE.HemisphereLight(0xb8c2d0, 0x0c0d0f, 0.55));
const key = new THREE.DirectionalLight(0xfff3e4, 2.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 40 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x8fb4ff, 1.1);
scene.add(rim, rim.target);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), MAT.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(400, 400, 0x23262b, 0x1a1c20);
grid.position.y = 0.002; scene.add(grid);

// stage origins, spaced so the camera travels between them
const STAGES = {
  stairs: new THREE.Vector3(0, 0, 0), catch: new THREE.Vector3(16, 0, 0), pick: new THREE.Vector3(32, 0, 0),
  nav: new THREE.Vector3(48, 0, 0), diag: new THREE.Vector3(64, 0, 0), boat: new THREE.Vector3(80, 0, 0),
};
const stage = {};
for (const [k, p] of Object.entries(STAGES)) {
  const g = new THREE.Group(); g.position.copy(p); scene.add(g);
  const sim = new THREE.Group(); sim.rotation.x = -Math.PI / 2; g.add(sim);     // the simulator's z-up frame
  stage[k] = { g, sim, tickers: [] };
}
// a low dais under each stage
for (const k of Object.keys(STAGES)) {
  const d = new THREE.Mesh(new THREE.CylinderGeometry(k === "nav" ? 6 : 3.6, k === "nav" ? 6.05 : 3.65, 0.03, 96), MAT.plat);
  d.position.y = 0.015; d.receiveShadow = true; stage[k].g.add(d);
}

// ---------- diagnostics stage: three monitors playing the real tool recordings (internal details blurred) ----------
const diagVideos = [], diagScreens = [];
function buildDiag() {
  const g = stage.diag.g, loader = new THREE.TextureLoader();
  const W = 1.9, H = 1.1;
  const fit = (t, w, h) => { const vis = (w / h) / (W / H); if (vis < 1) { t.repeat.set(1, vis); t.offset.set(0, 1 - vis); } else t.repeat.set(1 / vis, 1); };
  const screens = [
    { video: "tools/recall.mp4", name: "recall · log replay on the URDF" },
    { video: "tools/overwatch.mp4", name: "Overwatch · live per-actuator fault cards" },
    { img: "tools/robot-triage-terminal.jpg", scroll: true, name: "robot-triage · ranked verdict" },   // tall report: scroll it slowly
  ];
  screens.forEach((sc, i) => {
    let tex;
    if (sc.video) {
      const v = document.createElement("video");
      Object.assign(v, { src: MEDIA + sc.video, muted: true, loop: true, playsInline: true, preload: "auto", crossOrigin: "anonymous" });
      tex = new THREE.VideoTexture(v);
      v.addEventListener("loadedmetadata", () => fit(tex, v.videoWidth, v.videoHeight));
      diagVideos.push(v);
    } else {
      tex = loader.load(MEDIA + sc.img, (t) => {
        const vis = (t.image.width / t.image.height) / (W / H);
        if (vis < 1) {
          t.repeat.set(1, vis);
          stage.diag.tickers.push((tt) => { t.offset.y = (1 - vis) * (0.5 + 0.5 * Math.cos(tt * 0.18)); });
        } else fit(t, t.image.width, t.image.height);
      });
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    const grp = new THREE.Group();
    const a = (i - 1) * 0.62;                                     // spread on a wide arc behind the robot
    grp.position.set(Math.sin(a) * 4.2, 0, -Math.cos(a) * 4.2 + 1.8);
    grp.rotation.y = -a;
    const frame = box(W + 0.1, H + 0.1, 0.05, MAT.prop); frame.position.y = 1.75;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 1.75, 0.03);
    scr.userData.view = sc; diagScreens.push(scr);
    const post = box(0.06, 1.2, 0.06, MAT.prop); post.position.y = 0.6;
    const foot = box(0.5, 0.03, 0.32, MAT.prop); foot.position.y = 0.015;
    grp.add(frame, scr, post, foot); g.add(grp);
  });
}
// the recordings only play while the camera is at the diagnostics stage
let diagOn = false;
function playDiag(on) { diagOn = on; for (const v of diagVideos) { if (on) v.play().catch(() => {}); else v.pause(); } }

// click a monitor to open its recording full size (a drag that orbits the camera doesn't count as a click)
const shot = $("shot"), shotIn = $("shotIn"), shotCap = $("shotCap");
const ptr = new THREE.Vector2(), ray = new THREE.Raycaster();
function screenAt(e) {
  if (!diagOn || !renderer) return null;
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  return ray.intersectObjects(diagScreens, false)[0]?.object || null;
}
function openShot(sc) {
  shotIn.innerHTML = sc.video
    ? `<video src="${MEDIA + sc.video}" controls autoplay muted loop playsinline></video>`
    : `<img src="${MEDIA + sc.img}" alt="${esc(sc.name)}">`;
  shotCap.textContent = sc.name + " · internal details blurred";
  shot.hidden = false;
}
function closeShot() { shot.hidden = true; shotIn.innerHTML = ""; }
let downAt = null;
canvas.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const s = screenAt(e); if (s) openShot(s.userData.view);
});
canvas.addEventListener("pointermove", (e) => { if (!e.buttons) canvas.style.cursor = screenAt(e) ? "pointer" : ""; });
$("shotClose").onclick = closeShot;
shot.addEventListener("click", (e) => { if (e.target === shot) closeShot(); });

// ---------- UI state ----------
let track = "home", idx = 0, fly = null, follow = null;
const panel = $("panel"), pBody = $("pBody"), rail = $("rail");
const HOME_VIEW = { stage: "stairs", view: [[5.2, 2.6, 6.4], [-0.6, 0.9, 0]] };

function mediaHTML(m) {
  if (!m) return "";
  if (Array.isArray(m)) return m.map(mediaHTML).join("");
  const cap = `<figcaption>${esc(m.cap)}</figcaption>`;
  if (m.video) return `<figure><video src="${MEDIA + m.video}" muted loop playsinline autoplay preload="metadata"></video>${cap}</figure>`;
  if (m.shots) return `<figure><div class="shots">${m.shots.map((s) => `<a href="${MEDIA + s}" target="_blank" rel="noopener"><img src="${MEDIA + s}" alt="" loading="lazy"></a>`).join("")}</div>${cap}</figure>`;
  return `<figure class="${m.paper ? "paper" : ""}"><a href="${MEDIA + m.img}" target="_blank" rel="noopener"><img src="${MEDIA + m.img}" alt="${esc(m.cap)}" loading="lazy"></a>${cap}</figure>`;
}
function chapterHTML(c) {
  return `<p class="kick">${esc(c.kick)}</p><h2>${esc(c.title)}</h2><p class="lede">${esc(c.lede)}</p>
    ${c.explode ? `<div class="explode"><label><span>Assembled</span><b id="exVal">${Math.round(boatT * 100)}%</b><span>Exploded</span></label><input type="range" id="labExplode" min="0" max="1000" value="${Math.round(boatT * 1000)}" aria-label="Explode the boat assembly"></div>` : ""}
    <table class="spec">${c.spec.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
    ${c.notes.length ? `<ul class="notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${mediaHTML(c.media)}`;
}
function buildRail() {
  const list = CHAPTERS[track] || [];
  rail.innerHTML = list.map((c, i) => `<button type="button" data-i="${i}"><i>${String(i + 1).padStart(2, "0")}</i>${esc(c.short)}</button>`).join("");
  rail.querySelectorAll("button").forEach((b) => (b.onclick = () => go(track, +b.dataset.i)));
}

// ---------- boat stage: the Onshape assembly at true scale on a stand, explodable from the panel ----------
let boat = null, boatT = 0;
async function buildBoat() {
  const m = await loadModel("boat");
  const b = m.bounds(0), c = b.getCenter(new THREE.Vector3());
  const hullLow = Math.min(...m.parts.filter((p) => /^Hull/.test(p.label)).map((p) => p.center[2] - p.size[2] / 2));
  const H = 0.62;                                               // keel height on the stand
  m.group.rotation.z = -Math.PI / 2;                            // bow (+y in CAD) → +x
  m.group.position.set(-c.y, c.x, H - hullLow);
  stage.boat.sim.add(m.group);
  for (const dx of [-0.16, 0.16]) {
    const post = box(0.05, 0.05, H - 0.03, MAT.prop); post.position.set(dx, 0, (H - 0.03) / 2);
    const cradle = box(0.04, 0.2, 0.03, MAT.propLight); cradle.position.set(dx, 0, H - 0.015);
    stage.boat.sim.add(post, cradle);
  }
  const foot = box(0.46, 0.3, 0.03, MAT.prop); foot.position.z = 0.015; stage.boat.sim.add(foot);
  boat = m; m.setExplode(boatT);
}
function wireExplode() {
  const s = $("labExplode");
  if (!s) return;
  s.oninput = () => { boatT = s.value / 1000; boat?.setExplode(boatT); $("exVal").textContent = Math.round(boatT * 100) + "%"; };
}

// ---------- mechanical design: a plain page over the lab; its two CAD viewers mount on first visit ----------
const mech = $("mech");
const VIEWERS = { actuator: { model: "actuator", tilt: [0, Math.PI / 2, 0], view: [28, 16] }, boat: { model: "boat", view: [138, 20] },
  gloves: { model: "gloves", view: [16, 12], spin: false } };
let mechMounted = false;
function showMech(id, instant) {
  mech.hidden = false;
  $("loader").classList.add("done");                         // the lab keeps loading behind the page
  if (!mechMounted) { mechMounted = true; mech.querySelectorAll(".viewer").forEach((v) => mountViewer(v, VIEWERS[v.dataset.model])); }
  const el = id && $("m-" + id);
  if (el) el.scrollIntoView({ behavior: instant || reduceMotion ? "auto" : "smooth" }); else mech.scrollTop = 0;
  history.replaceState(null, "", id ? `#mechanical/${id}` : "#mechanical");
}
mech.querySelectorAll('a[href^="#mechanical/"]').forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showMech(a.getAttribute("href").split("/")[1]); }));

function viewFor(c, stageKey) {
  const o = c.follow && stage.nav.robot ? stage.nav.robot.getWorldPosition(new THREE.Vector3()).setY(0) : STAGES[stageKey];
  const [cp, tp] = c.view;
  const target = new THREE.Vector3(...tp).add(o), off = new THREE.Vector3(...cp).sub(new THREE.Vector3(...tp));
  if (innerWidth <= 900) off.multiplyScalar(1.45);                // narrow portrait frustum: step back
  return { pos: target.clone().add(off), target };
}
function flyTo(v, instant) {
  if (!controls) return;
  if (instant || reduceMotion) { camera.position.copy(v.pos); controls.target.copy(v.target); fly = null; return; }
  const d = camera.position.distanceTo(v.pos);
  fly = { t: 0, dur: Math.min(2.6, 0.9 + d / 30), p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos, t1: v.target };
}
function aimLights(stageKey) {
  const o = STAGES[stageKey];
  key.position.copy(o).add(new THREE.Vector3(4, 7.5, 4.5)); key.target.position.copy(o);
  rim.position.copy(o).add(new THREE.Vector3(-5, 4, -6)); rim.target.position.copy(o);
}

let rigReady = false;
function go(t, i = 0, instant = false) {
  track = t; document.body.dataset.track = t;
  if (t === "mechanical") { follow = null; playDiag(false); showMech(typeof i === "string" ? i : null, instant); return; }
  mech.hidden = true;
  const list = CHAPTERS[t];
  if (!list) {
    history.replaceState(null, "", location.pathname + location.search);
    follow = null;
    if (rigReady) { aimLights("stairs"); flyTo(viewFor(HOME_VIEW, "stairs"), instant); playDiag(false); }
    return;
  }
  idx = Math.max(0, Math.min(list.length - 1, i));
  const c = list[idx];
  if (rail.dataset.track !== t) { buildRail(); rail.dataset.track = t; }
  rail.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(+b.dataset.i === idx)));
  rail.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  $("pIndex").textContent = `${String(idx + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}`;
  pBody.innerHTML = chapterHTML(c); pBody.scrollTop = 0; wireExplode();
  $("caption").textContent = c.caption || "";
  history.replaceState(null, "", `#${t}/${c.id}`);
  if (!rigReady) return;
  const sk = c.stage;
  aimLights(sk);
  follow = c.follow ? stage.nav.robot : null;
  playDiag(t === "robotics" && c.stage === "diag");
  flyTo(viewFor(c, sk), instant);
}

// ---------- wiring ----------
document.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.go, 0); }));
$("prev").onclick = () => go(track, idx - 1);
$("next").onclick = () => {
  const list = CHAPTERS[track];
  if (idx < list.length - 1) go(track, idx + 1); else go("mechanical");
};
const profile = $("profile");
const openProfile = () => { profile.hidden = false; $("closeProfile").focus(); };
const closeProfile = () => { profile.hidden = true; };
$("openProfile").onclick = openProfile; $("openProfile2").onclick = openProfile; $("closeProfile").onclick = closeProfile;
profile.addEventListener("click", (e) => { if (e.target === profile) closeProfile(); });
addEventListener("keydown", (e) => {
  if (!shot.hidden) { if (e.key === "Escape") closeShot(); return; }
  if (!profile.hidden) { if (e.key === "Escape") closeProfile(); return; }
  if (track === "home") return;
  if (e.key === "Escape") go("home");
  if (track === "mechanical") return;
  if (e.key === "ArrowRight") go(track, idx + 1);
  if (e.key === "ArrowLeft") go(track, idx - 1);
});

function parseHash() {
  const [t, id] = location.hash.replace(/^#/, "").split("/");
  if (t === "mechanical") return [t, id || null];
  if (!CHAPTERS[t]) return ["home", 0];
  return [t, Math.max(0, CHAPTERS[t].findIndex((c) => c.id === id))];
}
go(...parseHash(), true);

// ---------- layout: keep the subject clear of the panel / intro ----------
function resize() {
  const W = innerWidth, H = innerHeight;
  if (renderer) renderer.setSize(W, H, false);
  labels.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  panelW = panel.getBoundingClientRect().width || 400;
}
let panelW = 400;
function frameOffset() {
  const W = innerWidth, H = innerHeight;
  let s = 0, v = 0;
  if (W > 900) s = track === "home" ? -W * 0.2 : (panelW + 16) / 2;
  else v = track === "home" ? H * 0.3 : H * 0.24;              // phones: keep the subject clear of the intro / bottom sheet
  camera.setViewOffset(W, H, s, v, W, H);
}
addEventListener("resize", resize);
resize();

// ---------- boot ----------
async function boot() {
  if (!renderer) { $("loader").classList.add("done"); return; }
  const [ROLL, R] = await Promise.all([loadRollouts(), loadRobot(), buildBoat()]);
  $("loadPct").textContent = "100%";
  const rig = makeRig(ROLL);
  rig.buildStairs(stage.stairs.sim, R(), R(), stage.stairs.tickers);
  rig.buildCatch(stage.catch.sim, R(), R(), stage.catch.tickers);
  rig.buildPick(stage.pick.sim, R(), stage.pick.tickers);
  const walker = R(); rig.buildNav(stage.nav.sim, walker, stage.nav.tickers); stage.nav.robot = walker;
  const stand = (k, pos = [0, 0]) => {
    const r = R(); stage[k].sim.add(r);
    rig.setRoot(r, [pos[0], pos[1], ROLL.loco.p[0][2]], [1, 0, 0, 0]); rig.setLoco(r, ROLL.loco.j[0]);
    return r;
  };
  const diagBot = stand("diag", [0, -0.2]); diagBot.rotation.z = -Math.PI / 2;  // faces the camera, screens behind
  buildDiag();
  for (const s of Object.values(stage)) for (const f of s.tickers) f(0);
  rigReady = true;
  if (track !== "mechanical") go(track, idx, true);
  $("loader").classList.add("done");

  const clock = new THREE.Clock();
  const freeze = parseFloat(new URLSearchParams(location.search).get("t"));   // ?t=3.2 holds every replay at that time
  const still = reduceMotion || Number.isFinite(freeze);
  let T = Number.isFinite(freeze) ? freeze : reduceMotion ? 2.5 : 0;
  if (still) for (const s of Object.values(stage)) for (const f of s.tickers) f(T);
  renderer.setAnimationLoop(() => {
    const raw = clock.getDelta(), dt = Math.min(raw, 0.05);
    if (document.hidden || !profile.hidden || track === "mechanical") return;
    if (!still) {
      T += dt;
      // only the stages near the camera need to move
      for (const [k, s] of Object.entries(stage)) if (camera.position.distanceTo(STAGES[k]) < 30) for (const f of s.tickers) f(T);
    }
    if (fly) {
      fly.t = Math.min(1, fly.t + Math.min(raw, 0.25) / fly.dur);
      const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (fly.t >= 1) fly = null;
    } else if (follow) {
      const p = follow.getWorldPosition(new THREE.Vector3()).setY(0.85);
      const d = p.sub(controls.target);
      controls.target.add(d); camera.position.add(d);
      key.position.add(d); key.target.position.add(d); rim.position.add(d); rim.target.position.add(d);
    }
    frameOffset();
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
}
boot().catch((e) => {
  console.warn("3D lab unavailable:", e);
  document.body.classList.add("no3d");
  $("loader").classList.add("done");
});
controls?.addEventListener("start", () => { fly = null; });
