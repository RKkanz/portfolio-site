// Shared 3D pieces for the hero (hero3d.js) and the 3D lab (lab.js):
// the Unitree G1 model, the retarget from the recorded rollouts, and the replay scenes.
import * as THREE from "three";
import URDFLoader from "urdf-loader";

export const INK = "#121212", ACCENT = "#ff4f00", PAPER = "#f3f1ec";
const here = (p) => new URL(p, import.meta.url).href;

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.02, ...o });
export const MAT = {
  floor: mat("#ebe8e1", { roughness: 0.95 }),
  plat: mat("#f7f6f2", { roughness: 0.8 }),
  prop: mat("#cfc9bd"),
  propLight: mat("#e2ddd2"),
  concrete: mat("#bdb7ab", { roughness: 0.9 }),
  nosing: mat(ACCENT, { roughness: 0.5 }),
  wood: mat("#b89470"),
  card: mat("#c8a46e", { roughness: 0.85 }),
};
export const box = (w, h, d, m = MAT.prop) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.castShadow = b.receiveShadow = true; return b; };

export const loadRollouts = () => fetch(here("rollouts.json")).then((r) => { if (!r.ok) throw new Error("rollouts.json " + r.status); return r.json(); });

// ---------- robot: Unitree G1 (open source, BSD-3) ----------
// The rollouts were recorded on a larger humanoid; the G1 is scaled so its pelvis-to-ankle length matches (0.89 m vs 0.752 m)
const G1_SCALE = 0.89 / 0.752;
// Single-axis joints map by name: rollout joint -> [G1 joint, sign, offset]. The G1 elbow's zero pose is bent 90°, and
// the forearm twist is the G1 wrist roll (opposite sign) while the side-to-side wrist bend is the G1 wrist yaw.
const MAP = { SpineYaw: ["waist_yaw_joint", 1, 0] };
for (const [s, g] of [["Left", "left"], ["Right", "right"]]) {
  Object.assign(MAP, {
    [s + "ElbowPitch"]: [g + "_elbow_joint", 1, Math.PI / 2],
    [s + "WristYaw"]: [g + "_wrist_roll_joint", -1, 0],
    [s + "WristRoll"]: [g + "_wrist_yaw_joint", 1, 0],
    [s + "KneePitch"]: [g + "_knee_joint", 1, 0],
    [s + "AnklePitch"]: [g + "_ankle_pitch_joint", 1, 0],
    [s + "AnkleRoll"]: [g + "_ankle_roll_joint", 1, 0],
  });
}

// Shoulders and hips are 3-DoF groups whose axis order and mounting tilt differ between the two robots, so copying angles
// swings the limbs into the body. Instead rebuild the source rotation and decompose it in the G1's order (Y-X-Z), which
// reproduces the upper-arm and thigh orientation exactly.
//   source shoulder: Rx(a) Ry(p) Rx(-a) Rx(r) Rz(y), pitch axis tilted a = ±40°;  G1: Rx(b) Ry(p') Rx(-b) Rx(r') Rz(y'), b = ±16°
//   source hip:      Rx(r) Rz(y) Ry(p);  G1: Ry(p') Ry(-c) Rx(r') Rz(y') Ry(c), with the G1's fixed c = 0.1749 thigh pitch offset
const SRC_TILT = 0.698132, G1_TILT = 0.27931, G1_HIP_C = 0.1749;
const _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const rx = (t) => new THREE.Matrix4().makeRotationX(t), ry = (t) => new THREE.Matrix4().makeRotationY(t), rz = (t) => new THREE.Matrix4().makeRotationZ(t);
function shoulder(side, p, r, y) {
  const a = side === "left" ? SRC_TILT : -SRC_TILT, b = side === "left" ? G1_TILT : -G1_TILT;
  _m.copy(rx(a)).multiply(ry(p)).multiply(rx(-a)).multiply(rx(r)).multiply(rz(y));
  _b.copy(rx(-b)).multiply(_m);
  _e.setFromRotationMatrix(_b, "YXZ");
  return [_e.y, _e.x + b, _e.z];
}
function hip(r, y, p) {
  _m.copy(rx(r)).multiply(rz(y)).multiply(ry(p)).multiply(_a.makeRotationY(-G1_HIP_C));
  _e.setFromRotationMatrix(_m, "YXZ");
  return [_e.y + G1_HIP_C, _e.x, _e.z];
}

const shellMat = new THREE.MeshPhysicalMaterial({ color: "#dedbd4", roughness: 0.42, metalness: 0.08, clearcoat: 0.3, clearcoatRoughness: 0.4 });
const darkMat = new THREE.MeshStandardMaterial({ color: "#26272a", roughness: 0.55, metalness: 0.2 });
const accentMat = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5 });
const DARK = /rubber_hand|ankle_roll|head|waist_yaw|waist_roll|wrist|pelvis_contour/;

export function loadG1(onProgress = () => {}) {
  return new Promise((res, rej) => {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_, done, total) => onProgress(done / Math.max(total, 1));
    manager.onError = (u) => rej(new Error("could not load " + u));
    const loader = new URDFLoader(manager);
    let robot;
    loader.load(here("g1/g1_29dof.urdf"), (r) => { robot = r; });
    manager.onLoad = () => {
      if (!robot) return;
      robot.traverse((o) => {
        if (!o.isMesh) return;
        let p = o; while (p && !p.isURDFLink) p = p.parent;
        const ln = p ? p.name : "";
        o.material = ln === "logo_link" ? accentMat : DARK.test(ln) ? darkMat : shellMat;
        o.castShadow = true; o.receiveShadow = true;
      });
      robot.scale.setScalar(G1_SCALE);
      res(robot);
    };
  });
}

const S = THREE.MathUtils.smoothstep;
const lerpArr = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// Everything that depends on the recorded data: the retarget helpers and the replay scenes.
// Each build* adds its props to `sim` (a z-up group) and pushes a (t) => void ticker.
export function makeRig(ROLL) {
  const LEG = ROLL.legJoints, ARM = ROLL.armJoints;
  const STAND = ROLL.loco.j[0];
  // the locomotion policy drives legs + spine only; those scenes hold the arms in the pick policy's start pose
  const LOWER = LEG.map((n, i) => [n, i]).filter(([n]) => !/Shoulder|Elbow|Wrist|Gripper|Neck/.test(n));
  const LOWER_N = LOWER.map(([n]) => n);
  const ARM_REST = ROLL.pick.j[0];
  let zOff = 0;                       // lifts the root so the G1's soles sit on the ground in the standing pose

  const setJoints = (r, names, vals) => {
    const v = {};
    for (let i = 0; i < names.length; i++) {
      v[names[i]] = vals[i];
      const m = MAP[names[i]];
      if (m) r.joints[m[0]]?.setJointValue(m[1] * vals[i] + m[2]);
    }
    for (const [s, g] of [["Left", "left"], ["Right", "right"]]) {
      if (v[s + "ShoulderPitch"] !== undefined) {
        const [p, rl, y] = shoulder(g, v[s + "ShoulderPitch"], v[s + "ShoulderRoll"] ?? 0, v[s + "ShoulderYaw"] ?? 0);
        r.joints[g + "_shoulder_pitch_joint"].setJointValue(p);
        r.joints[g + "_shoulder_roll_joint"].setJointValue(rl);
        r.joints[g + "_shoulder_yaw_joint"].setJointValue(y);
      }
      if (v[s + "HipPitch"] !== undefined) {
        const [p, rl, y] = hip(v[s + "HipRoll"] ?? 0, v[s + "HipYaw"] ?? 0, v[s + "HipPitch"]);
        r.joints[g + "_hip_pitch_joint"].setJointValue(p);
        r.joints[g + "_hip_roll_joint"].setJointValue(rl);
        r.joints[g + "_hip_yaw_joint"].setJointValue(y);
      }
    }
  };
  const setRoot = (r, p, q) => { r.position.set(p[0], p[1], p[2] + zOff); r.quaternion.set(q[1], q[2], q[3], q[0]); };

  // The G1's legs split thigh/shin differently from the robot the policies were trained on, so feet drift slightly off the
  // recorded contacts. Each frame, pin whichever foot is closest to the terrain onto it: no sinking into steps or floor.
  const _box = new THREE.Box3(), _part = new THREE.Box3(), _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4();
  function plant(r, terrain = () => 0) {
    r.updateMatrixWorld(true);
    _inv.copy(r.parent.matrixWorld).invert();
    let gap = Infinity;
    for (const ln of ["left_ankle_roll_link", "right_ankle_roll_link"]) {
      _box.makeEmpty();                                           // the foot's bounds in the robot's parent (z-up) frame
      r.links[ln].traverse((o) => {
        if (!o.isMesh) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        _box.union(_part.copy(o.geometry.boundingBox).applyMatrix4(_rel.multiplyMatrices(_inv, o.matrixWorld)));
      });
      if (!_box.isEmpty()) gap = Math.min(gap, _box.min.z - terrain(_box.min.x, _box.max.x));
    }
    if (Number.isFinite(gap)) { r.position.z -= gap; r.updateMatrixWorld(true); }
  }
  const setLoco = (r, vals) => { setJoints(r, LOWER_N, LOWER.map(([, i]) => vals[i])); setJoints(r, ARM, ARM_REST); };

  // pose the standing frame at the rollout's own pelvis height and measure how far the soles sit off the ground
  function ground(robot) {
    const probe = new THREE.Group(); probe.rotation.x = -Math.PI / 2;
    const parent = robot.parent; probe.add(robot);
    setRoot(robot, [0, 0, ROLL.loco.p[0][2]], [1, 0, 0, 0]); setLoco(robot, STAND);
    probe.updateMatrixWorld(true);
    zOff -= new THREE.Box3().setFromObject(robot).min.y;
    probe.remove(robot); if (parent) parent.add(robot);
  }

  function buildStairs(sim, rUp, rDown, tickers) {
    const clips = [["r016_d030", rUp, -0.95], ["r016_d030_down", rDown, 0.95]];
    const holder = new THREE.Group(); holder.position.x = -0.7; sim.add(holder);
    for (const [name, r, yo] of clips) {
      if (!r) continue;
      const c = ROLL.stairs.clips[name], pr = c.profile;
      const lane = new THREE.Group(); lane.position.y = yo - pr.y; holder.add(lane);
      // rebuild the simulated staircase from the height profile measured under the rollout
      let s = 0;
      for (let i = 1; i <= pr.h.length; i++) {
        if (i < pr.h.length && Math.abs(pr.h[i] - pr.h[s]) < 0.01) continue;
        const h = pr.h[s];
        if (h > 0.01) {
          const len = (i - s) * pr.dx, x = pr.x0 + (s + (i - s) / 2) * pr.dx;
          const st = box(len, 1.3, h, MAT.concrete); st.position.set(x, pr.y, h / 2); lane.add(st);
          const nose = box(0.03, 1.3, 0.012, MAT.nosing); nose.position.set(pr.x0 + s * pr.dx + 0.015, pr.y, h + 0.006); lane.add(nose);
        }
        s = i;
      }
      lane.add(r);
      // highest step under a foot's x-extent (lane frame)
      const terrain = (x0, x1) => {
        let h = 0;
        for (let i = Math.max(0, Math.floor((x0 - pr.x0) / pr.dx)); i <= Math.min(pr.h.length - 1, Math.floor((x1 - pr.x0) / pr.dx)); i++) h = Math.max(h, pr.h[i]);
        return h;
      };
      const n = c.p.length, dt = ROLL.stairs.dt, hold = 60;
      tickers.push((t) => {
        const k = Math.min(n - 1, Math.floor(t / dt) % (n + hold));
        setRoot(r, c.p[k], c.q[k]); setJoints(r, LEG, c.j[k]); plant(r, terrain);
      });
    }
    return holder;
  }

  function buildCatch(sim, A, B, tickers) {
    const [r1, r2] = ROLL.catch.throws;                         // r1: A catches (from B); r2: B catches (from A), mirrored
    const GAP = 4.5;
    const world = new THREE.Group(); world.position.x = -GAP / 2; sim.add(world);
    world.add(A, B);
    const base = r1.base;
    setRoot(A, base, [1, 0, 0, 0]);
    setRoot(B, [GAP - base[0], -base[1], base[2]], [0, 0, 0, 1]);  // yaw 180 deg
    setLoco(A, STAND); setLoco(B, STAND);
    plant(A); plant(B);
    const half = r1.half;
    const cargo = box(half[0] * 2, half[1] * 2, half[2] * 2, MAT.card); world.add(cargo);
    const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.12, gapSize: 0.08 }));
    world.add(trail);
    const flip = (p) => [GAP - p[0], -p[1], p[2]];
    const qz = new THREE.Quaternion(0, 0, 1, 0);
    const qOf = (q, mirror) => { const o = new THREE.Quaternion(q[1], q[2], q[3], q[0]); return mirror ? qz.clone().multiply(o) : o; };
    for (const r of [r1, r2]) {                                 // first frame the box is within 0.3 m of where it ends up (caught)
      const e = r.box[r.box.length - 1];
      r.arrive = r.box.findIndex((b, i) => i > 3 && Math.hypot(b[0] - e[0], b[1] - e[1], b[2] - e[2]) < 0.3);
    }
    const PRE = 1.3, MAIN = Math.max(r1.t[r1.t.length - 1], r2.t[r2.t.length - 1]) + 0.2, HALF = PRE + MAIN;
    const frameAt = (r, tt) => { let k = 0; while (k + 1 < r.t.length && r.t[k + 1] <= tt) k++; return k; };
    const idx = (n) => ARM.indexOf(n);
    const wind = (p) => { const o = p.slice(); for (const s of ["Left", "Right"]) { o[idx(s + "ShoulderPitch")] += 0.5; o[idx(s + "ElbowPitch")] = -1.05; } return o; };
    const release = (p) => { const o = p.slice(); for (const s of ["Left", "Right"]) { o[idx(s + "ShoulderPitch")] = -1.3; o[idx(s + "ElbowPitch")] = -0.3; } return o; };
    const hands = (r) => {
      const a = r.links.left_rubber_hand || r.links.left_wrist_yaw_link, b = r.links.right_rubber_hand || r.links.right_wrist_yaw_link;
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      a.getWorldPosition(v); b.getWorldPosition(w); v.add(w).multiplyScalar(0.5);
      return world.worldToLocal(v);
    };
    const tmp = new THREE.Vector3();
    tickers.push((t) => {
      const n = Math.floor(t / HALF), c = t - n * HALF;
      const aCatches = n % 2 === 0;
      const R = aCatches ? r1 : r2, other = aCatches ? r2 : r1;
      const catcher = aCatches ? A : B, thrower = aCatches ? B : A;
      const mirror = !aCatches;
      const held = other.j[other.j.length - 1];                 // thrower still holds what it caught last time
      if (c < PRE) {
        const u = c / PRE;
        setJoints(thrower, ARM, u < 0.6 ? lerpArr(held, wind(held), S(u, 0, 0.6)) : wind(held));
        setJoints(catcher, ARM, R.j[0]);
        thrower.updateMatrixWorld(true);
        const hm = hands(thrower).add(new THREE.Vector3(mirror ? -0.06 : 0.06, 0, -0.02));
        const st = mirror ? flip(R.box[0]) : R.box[0];
        tmp.set(st[0], st[1], st[2]);
        cargo.position.copy(hm.lerp(tmp, S(u, 0.75, 1)));
        cargo.quaternion.copy(qOf([1, 0, 0, 0], mirror));
        trail.visible = false;
      } else {
        const tt = c - PRE, k = frameAt(R, tt);
        setJoints(catcher, ARM, R.j[k]);
        setJoints(thrower, ARM, lerpArr(lerpArr(wind(held), release(held), S(tt, 0, 0.3)), other.j[0], S(tt, 0.45, 1.6)));
        const bp = mirror ? flip(R.box[k]) : R.box[k];
        cargo.position.set(bp[0], bp[1], bp[2]);
        cargo.quaternion.copy(qOf(R.boxq[k], mirror));
        const flying = tt > 0.3 && k < R.arrive;
        trail.visible = flying;
        if (flying) {
          const pts = []; for (let i = 0; i <= k; i++) { const q = mirror ? flip(R.box[i]) : R.box[i]; pts.push(new THREE.Vector3(q[0], q[1], q[2])); }
          trail.geometry.setFromPoints(pts); trail.computeLineDistances();
        }
      }
    });
    return world;
  }

  function buildPick(sim, r, tickers) {
    const P = ROLL.pick;
    const world = new THREE.Group(); world.position.x = -0.3; sim.add(world);
    const th = P.table_h;
    const top = box(0.7, 1.0, 0.04, MAT.wood); top.position.set(P.table[0] + 0.05, P.table[1], th - 0.02); world.add(top);
    for (const [dx, dy] of [[-0.3, -0.45], [0.3, -0.45], [-0.3, 0.45], [0.3, 0.45]]) {
      const l = box(0.04, 0.04, th - 0.04, MAT.prop); l.position.set(P.table[0] + 0.05 + dx, P.table[1] + dy, (th - 0.04) / 2); world.add(l);
    }
    const cargo = box(P.box[0], P.box[1], P.box[2], MAT.card); world.add(cargo);
    world.add(r);
    setRoot(r, P.base, P.baseq);
    setLoco(r, STAND);
    plant(r);
    const n = P.j.length, hold = 40;
    tickers.push((t) => {
      const k = Math.min(n - 1, Math.floor(t / P.dt) % (n + hold));
      setJoints(r, ARM, P.j[k]);
      cargo.position.set(...P.boxp[k]); cargo.quaternion.set(P.boxq[k][1], P.boxq[k][2], P.boxq[k][3], P.boxq[k][0]);
    });
    return world;
  }

  // onFrame(k, pos, fwd) lets callers attach a HUD or a follow camera. The real walk is slow (~0.3 m/s), so it plays at 2.5×.
  function buildNav(sim, r, tickers, onFrame = () => {}, speed = 2.5) {
    const Lo = ROLL.loco;
    const xs = Lo.p.map((p) => p[0]), ys = Lo.p.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const world = new THREE.Group(); world.position.set(-cx, -cy, 0); sim.add(world);
    world.add(r);
    // the walked path, and obstacles either side of it (the corridor the walker steered through)
    const pts = Lo.p.map((p) => new THREE.Vector3(p[0], p[1], 0.01));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: INK, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.45 }));
    line.computeLineDistances(); world.add(line);
    const done = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: ACCENT })); world.add(done);
    let acc = 0, side = 1;
    for (let i = 10; i < pts.length - 10; i++) {
      acc += pts[i].distanceTo(pts[i - 1]);
      if (acc < 1.3) continue;
      acc = 0; side = -side;
      const d = pts[i + 5].clone().sub(pts[i - 5]).normalize(), nrm = new THREE.Vector3(-d.y, d.x, 0);
      const h = 0.6 + ((i * 37) % 7) / 10, w = 0.5 + ((i * 13) % 5) / 10;
      const ob = box(w, w * 0.8, h); ob.position.copy(pts[i]).addScaledVector(nrm, side * (0.95 + w / 2)).setZ(h / 2); ob.rotation.z = Math.atan2(d.y, d.x);
      world.add(ob);
    }
    const goal = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.035, 12, 48), new THREE.MeshBasicMaterial({ color: ACCENT }));
    goal.position.copy(pts[pts.length - 1]).setZ(0.03); world.add(goal);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.6, 40, 1, true), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    world.add(cone);
    const n = Lo.p.length, hold = 50;
    const fwd = new THREE.Vector3(), q = new THREE.Quaternion();
    tickers.push((t) => {
      const k = Math.min(n - 1, Math.floor((t * speed) / Lo.dt) % (n + hold));
      setRoot(r, Lo.p[k], Lo.q[k]); setLoco(r, Lo.j[k]); plant(r);
      done.geometry.setFromPoints(pts.slice(0, k + 1));
      q.set(Lo.q[k][1], Lo.q[k][2], Lo.q[k][3], Lo.q[k][0]); fwd.set(1, 0, 0).applyQuaternion(q).setZ(0).normalize();
      cone.position.set(Lo.p[k][0], Lo.p[k][1], 1.45).addScaledVector(fwd, 1.35);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), fwd);
      onFrame(k, Lo.p[k], fwd, Lo.cmd[k]);
    });
    return world;
  }

  return { ground, setJoints, setRoot, setLoco, buildStairs, buildCatch, buildPick, buildNav };
}

// a soft paper-studio light rig shared by the small embedded viewers
export function studio(scene, renderer, { shadow = 2048, span = 4 } = {}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.25));
  const sun = new THREE.DirectionalLight(0xfff6ec, 2.0);
  sun.position.set(span * 1.2, span * 2.2, span);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadow, shadow);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: span * 8 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  return sun;
}
