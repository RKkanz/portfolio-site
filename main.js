// Live SF clock in the nav
const clock = document.getElementById("clock");
const tick = () => {
  clock.textContent = new Date().toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false,
  });
};
tick();
setInterval(tick, 15000);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Scroll reveal
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((el) => {
  if (reduceMotion) el.classList.add("in"); else io.observe(el);
});

// Nav: underline the section currently on screen
const navLinks = [...document.querySelectorAll(".nav nav a")];
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    navLinks.forEach((a) => a.classList.toggle("on", a.hash === "#" + e.target.id));
  }
}, { rootMargin: "-45% 0px -50% 0px" });
navLinks.forEach((a) => { const s = document.querySelector(a.hash); if (s) spy.observe(s); });

// Hero: 2-link planar arm, analytic IK, target smoothed with a critically-damped spring
const canvas = document.getElementById("arm");
const ctx = canvas.getContext("2d");
const readout = document.getElementById("readout");
const css = getComputedStyle(document.documentElement);
const INK = css.getPropertyValue("--ink").trim();
const INK3 = css.getPropertyValue("--ink-3").trim();
const ACCENT = css.getPropertyValue("--accent").trim();
const PAPER = css.getPropertyValue("--paper").trim();

let W, H, base, L1, L2;
let pointer = null, lastMove = 0;
const tip = { x: 0, y: 0, vx: 0, vy: 0 };
const trail = [];

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  W = r.width; H = r.height;
  base = { x: W * 0.5, y: H * 0.78 };
  L1 = H * 0.30; L2 = H * 0.25;
  if (!tip.x) { tip.x = base.x + L1 * 0.6; tip.y = base.y - L1; }
}
window.addEventListener("resize", () => { resize(); if (reduceMotion) frame(0); });
resize();

const setPointer = (e) => {
  const r = canvas.getBoundingClientRect();
  pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  lastMove = performance.now();
};
if (!reduceMotion) {
  window.addEventListener("pointermove", setPointer);
  canvas.addEventListener("pointerdown", setPointer);
}

function solveIK(tx, ty) {
  let dx = tx - base.x, dy = ty - base.y;
  let d = Math.hypot(dx, dy);
  const maxR = (L1 + L2) * 0.999, minR = Math.abs(L1 - L2) + 1;
  if (d > maxR) { dx *= maxR / d; dy *= maxR / d; d = maxR; }
  if (d < minR) { dx *= minR / d; dy *= minR / d; d = minR; }
  const c2 = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const q2 = -Math.acos(Math.max(-1, Math.min(1, c2))); // elbow-up
  const q1 = Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
  return { q1, q2 };
}

function link(x1, y1, x2, y2, w) {
  const a = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
  ctx.save();
  ctx.translate(x1, y1); ctx.rotate(a);
  ctx.beginPath(); ctx.roundRect(-w / 2, -w / 2, len + w, w, w / 2);
  ctx.fillStyle = PAPER; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.6, 0); ctx.lineTo(len - w * 0.6, 0);
  ctx.setLineDash([3, 4]); ctx.strokeStyle = INK3; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}

function joint(x, y, r, fill) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill || PAPER; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
}

// Drafting centerline cross through a joint
function centerCross(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  ctx.setLineDash([6, 2, 1.5, 2]); ctx.strokeStyle = INK3; ctx.lineWidth = 0.8; ctx.stroke(); ctx.setLineDash([]);
}

// Link-length label, offset to the outside of the link (away from the elbow bend)
function linkLabel(x1, y1, x2, y2, text, side) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const mx = (x1 + x2) / 2 + Math.cos(a + side * Math.PI / 2) * 22;
  const my = (y1 + y2) / 2 + Math.sin(a + side * Math.PI / 2) * 22;
  ctx.fillStyle = INK3; ctx.font = "500 11px JetBrains Mono, monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, mx, my);
  ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
}

function frame(t) {
  // Idle: trace a lissajous when the user isn't driving the arm
  const idle = reduceMotion || !pointer || t - lastMove > 2500;
  const target = idle
    ? { x: base.x + Math.sin(t / 1400) * L1 * 0.9, y: base.y - L1 * 0.95 + Math.sin(t / 700) * L2 * 0.45 }
    : pointer;

  if (reduceMotion) { tip.x = target.x; tip.y = target.y; }
  // Spring-damper on the tip (k, c chosen near critical damping)
  const k = 0.012, c = 0.2;
  tip.vx += (target.x - tip.x) * k - tip.vx * c;
  tip.vy += (target.y - tip.y) * k - tip.vy * c;
  if (!reduceMotion) { tip.x += tip.vx; tip.y += tip.vy; }

  const { q1, q2 } = solveIK(tip.x, tip.y);
  const ex = base.x + L1 * Math.cos(q1), ey = base.y + L1 * Math.sin(q1);
  const fx = ex + L2 * Math.cos(q1 + q2), fy = ey + L2 * Math.sin(q1 + q2);

  trail.push({ x: fx, y: fy });
  if (trail.length > 60) trail.shift();

  ctx.clearRect(0, 0, W, H);

  // Workspace envelope
  ctx.beginPath(); ctx.arc(base.x, base.y, L1 + L2, Math.PI, 0);
  ctx.setLineDash([2, 6]); ctx.strokeStyle = INK3; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = INK3; ctx.font = "500 10px JetBrains Mono, monospace";
  ctx.fillText("REACH ENVELOPE", 14, 22);

  // Ground + base
  ctx.beginPath(); ctx.moveTo(base.x - 80, base.y + 22); ctx.lineTo(base.x + 80, base.y + 22);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
  for (let i = -80; i < 80; i += 10) {
    ctx.beginPath(); ctx.moveTo(base.x + i, base.y + 30); ctx.lineTo(base.x + i + 8, base.y + 22);
    ctx.strokeStyle = INK3; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.beginPath(); ctx.roundRect(base.x - 30, base.y - 4, 60, 26, 3);
  ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();

  // Trail
  ctx.beginPath();
  trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = ACCENT + "55"; ctx.lineWidth = 1.5; ctx.stroke();

  // Joint angle arc at shoulder
  ctx.beginPath(); ctx.arc(base.x, base.y, 34, 0, q1, q1 < 0);
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2; ctx.stroke();

  link(base.x, base.y, ex, ey, 22);
  link(ex, ey, fx, fy, 16);
  joint(base.x, base.y, 9);
  joint(ex, ey, 7);
  centerCross(base.x, base.y, 18);
  centerCross(ex, ey, 14);
  linkLabel(base.x, base.y, ex, ey, "L1", q2 < 0 ? 1 : -1);
  linkLabel(ex, ey, fx, fy, "L2", q2 < 0 ? 1 : -1);

  // Gripper
  const a = q1 + q2, open = 6 + 3 * Math.sin(t / 300);
  ctx.save(); ctx.translate(fx, fy); ctx.rotate(a);
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -open); ctx.lineTo(14, -open); ctx.moveTo(0, open); ctx.lineTo(14, open);
  ctx.moveTo(0, -open); ctx.lineTo(0, open); ctx.stroke();
  ctx.restore();
  joint(fx, fy, 4, ACCENT);

  // Target crosshair
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(target.x - 10, target.y); ctx.lineTo(target.x - 4, target.y);
  ctx.moveTo(target.x + 4, target.y); ctx.lineTo(target.x + 10, target.y);
  ctx.moveTo(target.x, target.y - 10); ctx.lineTo(target.x, target.y - 4);
  ctx.moveTo(target.x, target.y + 4); ctx.lineTo(target.x, target.y + 10);
  ctx.stroke();

  const deg = (r) => (r * 180 / Math.PI).toFixed(1).padStart(6, " ");
  readout.textContent = `θ₁ ${deg(-q1)}° · θ₂ ${deg(-q2)}°`;

  if (!reduceMotion) requestAnimationFrame(frame);
}
// Reduced motion: draw one static pose and never start the loop
if (reduceMotion) frame(0); else requestAnimationFrame(frame);
