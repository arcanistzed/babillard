// Scroll drives the story phone: which scene shows, how far the top card has swiped, and how far the seat tab has torn.

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const narrow = matchMedia("(max-width: 860px)");
const clamp = (v) => Math.min(1, Math.max(0, v));

function init() {
  const bar = document.querySelector(".bar");
  const story = document.querySelector(".story");
  const texts = [...document.querySelectorAll(".steptext")];
  const columns = [...document.querySelectorAll(".col")];
  const depths = [0.06, 0.2, 0.12];
  let queued = false;

  function update() {
    queued = false;
    const vh = innerHeight;
    bar.classList.toggle("solid", scrollY > 24);

    // The board's columns drift upward at different rates.
    if (!reduce.matches && scrollY < vh * 1.5) {
      columns.forEach((el, i) => el.style.setProperty("--lift", `${(-scrollY * depths[i]).toFixed(1)}px`));
    }

    // A step takes over the phone once its text is readable: below the pinned phone on narrow
    // screens, beside it on wide ones. Progress then runs from 0 to 1 while
    // the text crosses the space it has.
    const [line, run] = narrow.matches ? [0.92, 0.28] : [0.74, 0.5];
    const [s1, s2, s3, s4] = texts.map((text) => {
      const r = text.getBoundingClientRect();
      return clamp((vh * line - (r.top + r.height / 2)) / (vh * run));
    });
    const swipe = clamp((s1 - 0.35) / 0.55);
    story.style.setProperty("--s1", swipe.toFixed(3));
    story.style.setProperty("--s2", clamp((s2 - 0.05) / 0.35).toFixed(3));

    let scene = "deck";
    if (s4 > 0) scene = "meet";
    else if (s3 > 0) scene = "pair";
    else if (s2 > 0.45) scene = "group";
    else if (swipe >= 1 || s2 > 0) scene = "tear";
    if (story.dataset.scene !== scene) story.dataset.scene = scene;
    story.classList.toggle("confirmed", s4 > 0.4);
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
    columns.forEach((el) => el.style.removeProperty("--lift"));
    queue();
  });
  update();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
