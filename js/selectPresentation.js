import { FIXED_IMAGES } from "./fixedImages.js";

/** A display-only image loader shared by both sides. Does not modify build or battle data. */
export function createPresentationImage(container, fallback, className, onChange = () => {}) {
  let currentUrl;
  let image;
  let version = 0;
  return value => {
    const url = typeof value === "string" ? value.trim() : "";
    if (url === currentUrl) return;
    currentUrl = url;
    const request = ++version;
    image?.remove();
    fallback.hidden = false;
    onChange();
    if (!url) return;
    const next = container.ownerDocument.createElement("img");
    next.className = className; next.alt = ""; next.hidden = true;
    next.onload = () => {
      if (request !== version) return;
      next.hidden = false; fallback.hidden = true; onChange();
    };
    next.onerror = () => {
      if (request !== version) return;
      next.hidden = true; fallback.hidden = false; onChange();
    };
    image = next; container.insertBefore(next, fallback); next.src = url;
  };
}

// Adapted from base/select.js: reset scale, measure center distance, shrink from bottom center.
export function battlerSize(width, height, maxWidth, maxHeight) {
  if (!width || !height) return { width: 0, height: 0 };
  const scale = Math.max(0, Math.min(1, maxWidth / width, maxHeight / height));
  return { width: width * scale, height: height * scale };
}

export function fitBattlersToAvoidOverlap(images) {
  for (const img of images) img.closest(".silhouette").style.setProperty("--battlerScale", "1");
  if (images.length !== 2) return;
  const [r1, r2] = images.map(img => img.getBoundingClientRect());
  const distance = (r2.left + r2.right - r1.left - r1.right) / 2;
  const halfWidths = (r1.width + r2.width) / 2;
  if (!halfWidths || halfWidths + 16 <= distance) return;
  // Unlike base's 0.55 lower bound, allow smaller images on narrow screens to avoid overlap.
  const scale = Math.max(0, Math.min(1, (distance - 16) / halfWidths));
  for (const img of images) img.closest(".silhouette").style.setProperty("--battlerScale", String(scale));
}

// Base's measured image height -> --topH, with room for main's labels and central controls.
export function updateRowSplitByBattlerHeight(grid, images, midStack, availableHeight = grid.getBoundingClientRect().height) {
  const height = Math.max(0, ...images.map(img => img.getBoundingClientRect().height));
  if (!height) return;
  const gridHeight = availableHeight;
  const required = Math.max(height + 180, midStack.getBoundingClientRect().height + 150);
  const top = Math.max(220, gridHeight * .4, Math.min(gridHeight * .85, required));
  grid.style.setProperty("--topH", `${Math.round(top)}px`);
}

export function createSelectPresentation(root = document, viewport = window) {
  const grid = root.querySelector(".selectGrid");
  let frame;
  const requestLayout = () => {
    viewport.cancelAnimationFrame(frame);
    frame = viewport.requestAnimationFrame(() => {
      grid.style.removeProperty("--topH");
      // Reserve labels and the lower information row, using the actual grid height.
      const rect = grid.getBoundingClientRect();
      const availableHeight = Math.max(0, Math.min(rect.height, (viewport.visualViewport?.height ?? viewport.innerHeight) - rect.top - 15));
      const maxHeight = Math.max(0, availableHeight * .85 - 180);
      grid.style.setProperty("--battlerMaxHeight", `${maxHeight}px`);
      const images = [...grid.querySelectorAll(".silhouette__img")].filter(img => !img.hidden);
      for (const img of images) {
        const size = battlerSize(img.naturalWidth, img.naturalHeight, img.closest(".silhouette").clientWidth, maxHeight);
        img.style.width = `${size.width}px`;
        img.style.height = `${size.height}px`;
      }
      fitBattlersToAvoidOverlap(images);
      updateRowSplitByBattlerHeight(grid, images, root.querySelector(".midStack"), availableHeight);
    });
  };
  const displays = {};
  for (const side of ["p1", "p2"]) {
    const battler = root.querySelector(`#${side}-battler-slot`);
    const duck = root.querySelector(`#${side}-duck-slot`);
    for (const [slot, selector, className, src] of [
      [battler, ".figure", "silhouette__img", FIXED_IMAGES.battlerStanding],
      [duck, ".duckPlaceholder", "duckPick__img", FIXED_IMAGES.duckIcon],
    ]) {
      const fallback = slot.querySelector(selector);
      fallback.className = `${selector.slice(1)} ${className}`;
      fallback.onload = requestLayout;
      fallback.src = src;
    }
    displays[side] = {
      standing: createPresentationImage(battler, battler.querySelector(".figure"), "silhouette__img", requestLayout),
      duck: createPresentationImage(duck, duck.querySelector(".duckPlaceholder"), "duckPick__img", requestLayout),
    };
  }
  viewport.addEventListener("resize", requestLayout);
  viewport.visualViewport?.addEventListener("resize", requestLayout);
  return (side, presentation, duckId) => {
    displays[side].standing(presentation?.battler?.standingImageUrl);
    displays[side].duck(presentation?.ducks?.[duckId]?.iconUrl);
  };
}
