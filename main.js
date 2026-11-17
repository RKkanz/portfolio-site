const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Work filter: All / Robotics / Mechanical. Shareable as ?for=robotics or ?for=mechanical
const cards = [...document.querySelectorAll(".card[data-role]")];
const buttons = [...document.querySelectorAll(".filter [data-filter]")];
const count = (f) => cards.filter((c) => f === "all" || c.dataset.role.split(" ").includes(f)).length;
buttons.forEach((b) => (b.querySelector("i").textContent = count(b.dataset.filter)));
function setFilter(f, push) {
  document.body.dataset.filter = f;
  buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.filter === f)));
  cards.forEach((c) => (c.hidden = !(f === "all" || c.dataset.role.split(" ").includes(f))));
  if (push) {
    const u = new URL(location.href);
    if (f === "all") u.searchParams.delete("for"); else u.searchParams.set("for", f === "mech" ? "mechanical" : f);
    history.replaceState(null, "", u);
  }
}
buttons.forEach((b) => (b.onclick = () => setFilter(b.dataset.filter, true)));
const want = new URLSearchParams(location.search).get("for");
setFilter(want === "mechanical" ? "mech" : want === "robotics" ? "robotics" : "all", false);

// Sim videos play only while on screen (and never with reduced motion)
const vio = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting && !reduceMotion) e.target.play().catch(() => {});
    else e.target.pause();
  }
}, { threshold: 0.35 });
document.querySelectorAll(".card video").forEach((v) => vio.observe(v));

// Nav: underline the section currently on screen
const navLinks = [...document.querySelectorAll('.nav nav a[href^="#"]')];
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    navLinks.forEach((a) => a.classList.toggle("on", a.hash === "#" + e.target.id));
  }
}, { rootMargin: "-45% 0px -50% 0px" });
navLinks.forEach((a) => { const s = document.querySelector(a.hash); if (s) spy.observe(s); });
