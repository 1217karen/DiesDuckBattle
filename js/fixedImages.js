// Display-only defaults. Never write these URLs into character or battle data.
export const FIXED_IMAGES = Object.freeze({
  battlerStanding: "/img/B00.png",
  battlerIcon: "/img/B00_icon.png",
  duckIcon: "/img/D00.png",
  battlerRandomStanding: "/img/B00_random.png",
  duckRandomIcon: "/img/D00_random.png",
});

export const imageOrFallback = (url, fallback) =>
  typeof url === "string" && url.trim() ? url.trim() : fallback;

export function setImageWithFallback(img, url, fallback) {
  img.addEventListener("error", () => { img.src = fallback; }, { once: true });
  img.src = imageOrFallback(url, fallback);
}

/** Quote previews can try the selected slot, the default, then the fixed image. */
export function setImageFromCandidates(img, candidates, fallback) {
  const urls = [...new Set([...candidates.map(url => imageOrFallback(url, fallback)), fallback])];
  let index = 0;
  img.onerror = () => {
    if (index + 1 < urls.length) img.src = urls[++index];
    else img.onerror = null; // The fixed image failing must not cause a retry loop.
  };
  img.src = urls[0];
}
