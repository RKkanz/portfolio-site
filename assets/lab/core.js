// Shared 3D pieces for the lab (app.js): a pill-shaped Mk1.1 built from its kinematic tree (mk11.json: joint frames,
// axes and limits, plus one bounding box per link; no meshes), the recorded policy rollouts, and the replay scenes.
// The rollouts were recorded on this robot, so joint angles and root poses play back exactly, with no retargeting.
import * as THREE from "three";

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

const json = (p) => fetch(here(p)).then((r) => { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); });
export const loadRollouts = () => json("rollouts.json");

// ---------- the robot: pills on the Mk1.1 kinematic tree ----------
export const ROBOT_MAT = {
  shell: new THREE.MeshPhysicalMaterial({ color: "#e9e7e2", roughness: 0.38, metalness: 0.02, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
  dark: new THREE.MeshStandardMaterial({ color: "#2a2c30", roughness: 0.5, metalness: 0.15 }),
  accent: new THREE.MeshStandardMaterial({ color: "#ffb020", roughness: 0.45 }),
};
const DARK_LINKS = /base_link|Head|NeckYaw/;

// A capsule along the longest axis of a link's bounding box; its radius is half the box's smallest side, so soles and
// palms sit where the real robot's do.
function pillFor(b) {
  const lo = new THREE.Vector3(b[0], b[1], b[2]), hi = new THREE.Vector3(b[3], b[4], b[5]);
  const size = hi.clone().sub(lo), c = lo.clone().add(hi).multiplyScalar(0.5);
  const dims = [size.x, size.y, size.z], ax = dims.indexOf(Math.max(...dims));
  const others = dims.filter((_, i) => i !== ax);
  const r = Math.max(0.012, Math.min(...others) / 2);
  const len = Math.max(0, dims[ax] - 2 * r);
  const g = new THREE.CapsuleGeometry(r, len, 8, 20);             // along +y
  if (ax === 0) g.rotateZ(Math.PI / 2);
  if (ax === 2) g.rotateX(Math.PI / 2);
  g.translate(c.x, c.y, c.z);
  return g;
}

export async function loadRobot() {
  const data = await json("mk11.json");
  const geo = {};
  for (const [name, b] of Object.entries(data.boxes)) geo[name] = pillFor(b);
  const jointBall = new THREE.SphereGeometry(0.03, 20, 14);
  const neck = new THREE.CapsuleGeometry(0.035, 0.12, 6, 16).rotateX(Math.PI / 2).translate(0.01, 0, 0.09);

  // a fresh robot each call (geometry shared)
  return function makeRobot() {
    const robot = new THREE.Group();
    const links = {}, joints = {};
    const linkObj = (name) => {
      const o = new THREE.Group(); o.name = name; links[name] = o;
      if (geo[name]) {
        const m = new THREE.Mesh(geo[name], DARK_LINKS.test(name) ? ROBOT_MAT.dark : ROBOT_MAT.shell);
        m.castShadow = m.receiveShadow = true; o.add(m);
      }
      if (name === "NeckYawLink") { const m = new THREE.Mesh(neck, ROBOT_MAT.dark); m.castShadow = true; o.add(m); }
      return o;
    };
    robot.add(linkObj(data.root));
    const pending = data.joints.slice();
    while (pending.length) {
      const i = pending.findIndex((j) => links[j.parent]);
      if (i < 0) break;
      const j = pending.splice(i, 1)[0];
      const frame = new THREE.Group();
      frame.position.fromArray(j.xyz);
      frame.quaternion.setFromEuler(new THREE.Euler(j.rpy[0], j.rpy[1], j.rpy[2], "ZYX"));   // URDF rpy = Rz Ry Rx
      links[j.parent].add(frame);
      const child = linkObj(j.child); frame.add(child);
      if (j.type === "revolute" || j.type === "continuous") {
        const axis = new THREE.Vector3().fromArray(j.axis).normalize();
        joints[j.name] = {
          angle: 0,
          setJointValue(v) {
            if (j.lower != null && j.upper != null && j.type === "revolute") v = Math.min(j.upper, Math.max(j.lower, v));
            this.angle = v; child.quaternion.setFromAxisAngle(axis, v);
          },
        };
        if (!/thumb|index|middle|ring|little/.test(j.name)) {
          const ball = new THREE.Mesh(jointBall, ROBOT_MAT.dark); ball.castShadow = true; frame.add(ball);
        }
      }
    }
    robot.links = links; robot.joints = joints;
    return robot;
  };
}

const S = THREE.MathUtils.smoothstep;
const lerpArr = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// Everything that depends on the recorded data. Each build* adds its props to `sim` (a z-up group) and pushes a
// (t) => void ticker.
export function makeRig(ROLL) {
  const LEG = ROLL.legJoints, ARM = ROLL.armJoints;
  const STAND = ROLL.loco.j[0];
  // the locomotion policy drives legs + spine only; on the robot the arms belong to the upper-body controller, so those
  // scenes hold the arms in the pick policy's start pose
  const LOWER = LEG.map((n, i) => [n, i]).filter(([n]) => !/Shoulder|Elbow|Wrist|Gripper|Neck/.test(n));
  const LOWER_N = LOWER.map(([n]) => n);
  const ARM_REST = ROLL.pick.j[0];

  // the neck isn't actuated by these policies (the real robot commands it separately): hold it level
  const setJoints = (r, names, vals) => { for (let i = 0; i < names.length; i++) r.joints[names[i]]?.setJointValue(names[i].startsWith("Neck") ? 0 : vals[i]); };
  const setRoot = (r, p, q) => { r.position.set(p[0], p[1], p[2]); r.quaternion.set(q[1], q[2], q[3], q[0]); };
  const setLoco = (r, vals) => { setJoints(r, LOWER_N, LOWER.map(([, i]) => vals[i])); setJoints(r, ARM, ARM_REST); };

  function buildStairs(sim, rUp, rDown, tickers) {
    const clips = [["r016_d030", rUp, -0.95], ["r016_d030_down", rDown, 0.95]];
    const holder = new THREE.Group(); holder.position.x = -0.7; sim.add(holder);
    for (const [name, r, yo] of clips) {
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
      const n = c.p.length, dt = ROLL.stairs.dt, hold = 60;
      tickers.push((t) => {
        const k = Math.min(n - 1, Math.floor(t / dt) % (n + hold));
        setRoot(r, c.p[k], c.q[k]); setJoints(r, LEG, c.j[k]);
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
    const half = r1.half;
    const cargo = box(half[0] * 2, half[1] * 2, half[2] * 2, MAT.card); world.add(cargo);
    const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: "#ffb020", dashSize: 0.12, gapSize: 0.08 }));
    world.add(trail);
    const flip = (p) => [GAP - p[0], -p[1], p[2]];
    const qz = new THREE.Quaternion(0, 0, 1, 0);
    const qOf = (q, mirror) => { const o = new THREE.Quaternion(q[1], q[2], q[3], q[0]); return mirror ? qz.clone().multiply(o) : o; };
    for (const r of [r1, r2]) {                                 // first frame the box is within 0.3 m of where it ends up (caught)
      const e = r.box[r.box.length - 1];
      r.arrive = r.box.findIndex((b, i) => i > 3 && Math.hypot(b[0] - e[0], b[1] - e[1], b[2] - e[2]) < 0.3);
    }
    // short wind-up, then the recorded flight and catch, then a hold on the caught box
    const PRE = 0.9, MAIN = Math.max(r1.t[r1.t.length - 1], r2.t[r2.t.length - 1]) + 1.1, HALF = PRE + MAIN;
    // where the box will be caught, marked while it is in the air; `state` is read by the head-camera view in app.js
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 40), new THREE.MeshBasicMaterial({ color: "#ffb020" }));
    mark.rotation.y = Math.PI / 2; mark.visible = false; world.add(mark);
    const state = { catcher: A, thrower: B, box: cargo, phase: "wind", dist: 0, since: 0, rate: 1 };
    // the scene keeps its own clock so it can slow down for the catch: 0.3x from ~1.3 m out until just after the palms close
    const SLOW = 0.3;
    let clock = 0, last = null;
    world.state = state;
    const frameAt = (r, tt) => { let k = 0; while (k + 1 < r.t.length && r.t[k + 1] <= tt) k++; return k; };
    const idx = (n) => ARM.indexOf(n);
    const wind = (p) => { const o = p.slice(); for (const s of ["Left", "Right"]) { o[idx(s + "ShoulderPitch")] += 0.5; o[idx(s + "ElbowPitch")] = -1.05; } return o; };
    const release = (p) => { const o = p.slice(); for (const s of ["Left", "Right"]) { o[idx(s + "ShoulderPitch")] = -1.3; o[idx(s + "ElbowPitch")] = -0.3; } return o; };
    const hands = (r) => {
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      r.links.L_l_base_link.getWorldPosition(v); r.links.R_r_base_link.getWorldPosition(w); v.add(w).multiplyScalar(0.5);
      return world.worldToLocal(v);
    };
    const tmp = new THREE.Vector3();
    tickers.push((t) => {
      const dt = last === null ? null : t - last; last = t;
      if (dt === null || dt < 0 || dt > 0.5) clock = t;          // first frame, a frozen ?t= frame, or a jump: no slow-down
      else {
        state.rate = (state.phase === "flight" && state.dist < 1.3) || (state.phase === "caught" && state.since < 0.9) ? SLOW : 1;
        clock += dt * state.rate;
      }
      const n = Math.floor(clock / HALF), c = clock - n * HALF;
      const aCatches = n % 2 === 0;
      const R = aCatches ? r1 : r2, other = aCatches ? r2 : r1;
      const catcher = aCatches ? A : B, thrower = aCatches ? B : A;
      const mirror = !aCatches;
      const held = other.j[other.j.length - 1];                 // the thrower still holds what it caught last time
      if (c < PRE) {
        const u = c / PRE;
        setJoints(thrower, ARM, u < 0.6 ? lerpArr(held, wind(held), S(u, 0, 0.6)) : wind(held));
        setJoints(catcher, ARM, R.j[0]);
        thrower.updateWorldMatrix(true, true);
        const hm = hands(thrower).add(new THREE.Vector3(mirror ? -0.06 : 0.06, 0, -0.02));
        const st = mirror ? flip(R.box[0]) : R.box[0];
        tmp.set(st[0], st[1], st[2]);
        cargo.position.copy(hm.lerp(tmp, S(u, 0.75, 1)));
        cargo.quaternion.copy(qOf([1, 0, 0, 0], mirror));
        trail.visible = false; mark.visible = false;
        Object.assign(state, { catcher, thrower, phase: "wind" });
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
        const ga = mirror ? flip(R.box[R.arrive]) : R.box[R.arrive];
        mark.position.set(ga[0], ga[1], ga[2]); mark.visible = flying;
        Object.assign(state, { catcher, thrower, phase: k < R.arrive ? (tt > 0.3 ? "flight" : "release") : "caught", dist: Math.hypot(ga[0] - bp[0], ga[1] - bp[1], ga[2] - bp[2]), since: tt - R.t[R.arrive] });
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
    // lift, hold, set it back down (the recorded lift played in reverse), pause, repeat
    const n = P.j.length, hold = 40, rest = 30, cycle = 2 * n + hold + rest;
    tickers.push((t) => {
      const f = Math.floor(t / P.dt) % cycle;
      const k = f < n ? f : f < n + hold ? n - 1 : f < 2 * n + hold ? 2 * n + hold - 1 - f : 0;
      setJoints(r, ARM, P.j[k]);
      cargo.position.set(...P.boxp[k]); cargo.quaternion.set(P.boxq[k][1], P.boxq[k][2], P.boxq[k][3], P.boxq[k][0]);
    });
    return world;
  }

  // The real walk is slow (~0.3 m/s), so it plays at 2.5x.
  function buildNav(sim, r, tickers, speed = 2.5) {
    const Lo = ROLL.loco;
    const xs = Lo.p.map((p) => p[0]), ys = Lo.p.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const world = new THREE.Group(); world.position.set(-cx, -cy, 0); sim.add(world);
    world.add(r);
    // the walked path, and obstacles either side of it (the corridor the walker steered through)
    const pts = Lo.p.map((p) => new THREE.Vector3(p[0], p[1], 0.04));   // just above the dais (0.03)
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: "#8a8f98", dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.5 }));
    line.computeLineDistances(); world.add(line);
    const done = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#ffb020" })); world.add(done);
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
    const goal = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.035, 12, 48), new THREE.MeshBasicMaterial({ color: "#ffb020" }));
    goal.position.copy(pts[pts.length - 1]).setZ(0.05); world.add(goal);
    // The walker follows the recorded route with an animated gait (the raw replay looked off at speed): a smoothed copy
    // of the path, walked at constant speed, heading along the path. Gait is built on the stand crouch, where
    // hip + knee + ankle = 0 keeps the foot flat.
    const W = 12, sm = pts.map((_, i) => {
      const a = Math.max(0, i - W), b = Math.min(pts.length - 1, i + W), v = new THREE.Vector3();
      for (let j = a; j <= b; j++) v.add(pts[j]);
      return v.multiplyScalar(1 / (b - a + 1));
    });
    const s = [0]; for (let i = 1; i < sm.length; i++) s.push(s[i - 1] + sm[i].distanceTo(sm[i - 1]));
    const L = s[s.length - 1], V = 0.62, T = 1.05, HOLD = 1.6, LOOP = L / V + HOLD;   // m/s, s per stride
    const z0 = Lo.p[0][2], st = (n) => STAND[LEG.indexOf(n)];
    const leg = { hip: st("LeftHipPitch"), knee: st("LeftKneePitch"), ankle: st("LeftAnklePitch") };
    const ARMS = ARM_REST.slice(), iL = ARM.indexOf("LeftShoulderPitch"), iR = ARM.indexOf("RightShoulderPitch");
    const at = (d) => { let i = 1; while (i < s.length - 1 && s[i] < d) i++; const u = (d - s[i - 1]) / (s[i] - s[i - 1] || 1); return [sm[i - 1].clone().lerp(sm[i], u), sm[i].clone().sub(sm[i - 1])]; };
    const gait = (ph, amp) => {                                 // ph 0..0.5 stance (leg sweeps back), 0.5..1 swing (lifts forward)
      const hip = leg.hip - 0.24 * amp * Math.cos(2 * Math.PI * ph);
      const knee = leg.knee + (ph > 0.5 ? 0.6 * amp * Math.sin(2 * Math.PI * (ph - 0.5)) : 0.05 * amp * Math.sin(2 * Math.PI * ph));
      return [hip, knee, -(hip + knee) + (ph > 0.5 ? 0.08 * amp * Math.sin(2 * Math.PI * (ph - 0.5)) : 0)];
    };
    tickers.push((t) => {
      const tl = (t * speed / 2.5) % LOOP, walking = tl < L / V;
      const d = Math.min(L, tl * V), [p, dir] = at(d);
      const amp = walking ? Math.min(1, tl / 0.6, (L / V - tl) / 0.6) : 0;   // ease in and out of the stride
      const ph = (tl / T) % 1;
      const [lh, lk, la] = gait(ph, amp), [rh, rk, ra] = gait((ph + 0.5) % 1, amp);
      const yaw = Math.atan2(dir.y, dir.x);
      const bob = 0.012 * amp * Math.cos(4 * Math.PI * ph);
      setRoot(r, [p.x, p.y, z0 + bob], [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)]);
      setJoints(r, LOWER_N, LOWER.map(([n, i]) => STAND[i]));
      setJoints(r, ["LeftHipPitch", "LeftKneePitch", "LeftAnklePitch", "RightHipPitch", "RightKneePitch", "RightAnklePitch"], [lh, lk, la, rh, rk, ra]);
      const arms = ARMS.slice(), sw = 0.22 * amp * Math.cos(2 * Math.PI * ph);   // arms swing against the legs
      arms[iL] += sw; arms[iR] -= sw;
      setJoints(r, ARM, arms);
      done.geometry.setFromPoints(sm.slice(0, s.findIndex((v) => v >= d) + 1 || sm.length));
    });
    return world;
  }

  return { setJoints, setRoot, setLoco, buildStairs, buildCatch, buildPick, buildNav, STAND };
}
