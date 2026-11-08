// Scroll drives the story phone: which scene shows, how far the top card has swiped, and how far the seat tab has torn.

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v) => Math.min(1, Math.max(0, v));

function init() {
  const bar = document.querySelector(".bar");
  const story = document.querySelector(".story");
  const steps = [...document.querySelectorAll(".step")];
  const pinned = [...document.querySelectorAll(".pinned")];
  const depths = [0.12, 0.22, 0.08, 0.18, 0.3, 0.1, 0.24, 0.14, 0.28];
  let queued = false;

  function update() {
    queued = false;
    const vh = innerHeight;
    bar.classList.toggle("solid", scrollY > 24);

    // Flyers on the board drift upward at different rates.
    if (!reduce.matches && scrollY < vh * 1.5) {
      pinned.forEach((el, i) => el.style.setProperty("--lift", `${(-scrollY * depths[i]).toFixed(1)}px`));
    }

    // Each step's progress runs from 0 as it reaches the middle of the screen to 1 as it leaves.
    const progress = steps.map((step) => {
      const r = step.getBoundingClientRect();
      return clamp((vh * 0.6 - r.top) / r.height);
    });
    const [s1, s2, s3, s4] = progress;
    story.style.setProperty("--s1", (s1 / 0.55 > 1 ? 1 : s1 / 0.55).toFixed(3));
    story.style.setProperty("--s2", clamp((s2 - 0.05) / 0.4).toFixed(3));

    let scene = "deck";
    if (s4 > 0) scene = "meet";
    else if (s3 > 0) scene = "pair";
    else if (s2 > 0.5) scene = "group";
    else if (s1 >= 0.55) scene = "tear";
    if (story.dataset.scene !== scene) story.dataset.scene = scene;
    story.classList.toggle("confirmed", s4 > 0.35);
  }

  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  reduce.addEventListener("change", () => {
    pinned.forEach((el) => el.style.removeProperty("--lift"));
    queue();
  });
  update();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
