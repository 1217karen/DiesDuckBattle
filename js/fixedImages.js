// Display-only defaults. Never write these URLs into character or battle data.
export const FIXED_IMAGES = Object.freeze({
  battlerStanding: "/img/B00.png",
  battlerIcon: "/img/B00_icon.png",
  duckIcon: "/img/D00.png",
});

export const imageOrFallback = (url, fallback) =>
  typeof url === "string" && url.trim() ? url.trim() : fallback;

export function setImageWithFallback(img, url, fallback) {
  img.addEventListener("error", () => { img.src = fallback; }, { once: true });
  img.src = imageOrFallback(url, fallback);
}
