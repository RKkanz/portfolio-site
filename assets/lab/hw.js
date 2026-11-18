// Humanoid hardware on the mechanical page: Foundation's public front image of the robot with callouts on the areas I
// designed. A callout and its tab select the same zone: the callout lights amber and the zone's notes show. No robot
// geometry is published (no URDF, no meshes).
export function mountHardware(root) {
  const pins = [...root.querySelectorAll(".pin[data-zone]")], tabs = [...root.querySelectorAll("button[data-zone]:not(.pin)")];
  const notes = [...root.querySelectorAll("div[data-zone]")];
  function select(z) {
    pins.forEach((p) => p.classList.toggle("on", p.dataset.zone === z));
    tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.zone === z)));
    notes.forEach((n) => (n.hidden = n.dataset.zone !== z));
  }
  for (const el of [...pins, ...tabs]) el.addEventListener("click", () => select(el.dataset.zone));
  select(tabs.find((b) => b.getAttribute("aria-selected") === "true")?.dataset.zone || "forearm");
}
