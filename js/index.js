// indexの左右に出す立ち絵をランダムで選ぶスクリプト
document.addEventListener("DOMContentLoaded", () => {
  const characterImages = [
    "img/Battler/B01.png","img/Battler/B02.png","img/Battler/B03.png","img/Battler/B04.png",
    "img/Battler/B05.png","img/Battler/B06.png","img/Battler/B07.png","img/Battler/B08.png",
    "img/Battler/B09.png","img/Battler/B10.png","img/Battler/B11.png","img/Battler/B12.png",
    "img/Battler/B13.png","img/Battler/B14.png","img/Battler/B15.png","img/Battler/B16.png",
    "img/Battler/B17.png","img/Battler/B18.png","img/Battler/B19.png","img/Battler/B20.png",
    "img/Battler/B21.png","img/Battler/B22.png","img/Battler/B23.png","img/Battler/B24.png",
    "img/Battler/B25.png","img/Battler/B26.png",
  ];

  const leftIds  = ["left-1", "left-2", "left-3"];
  const rightIds = ["right-1", "right-2", "right-3"];
  const needCount = leftIds.length + rightIds.length;

  const pool = characterImages.slice();

  // シャッフル（Fisher-Yates）
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // 表示する6枚
  const picked = [];
  for (let i = 0; i < needCount; i++) {
    picked.push(pool[i]);
  }
  // ロゴを先に出し始める（2秒）
  const startLogoFade = () => {
  const logo = document.querySelector(".logo");
  if (!logo) return;

  // bfcache等で残っている可能性があるので毎回リセット
  logo.classList.remove("is-visible");

  // 次フレームで付与して「透明→表示」を必ず踏ませる
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      logo.classList.add("is-visible");
    });
  });
};

// 初回
startLogoFade();

// 戻る/進むで復元された時もやり直す
window.addEventListener("pageshow", (e) => {
  if (e.persisted) startLogoFade();
});

const charaMinDelay = 1500;  // 立ち絵は最短1.5秒
const step = 200;

const preloads = picked.map(
  (src) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = src;
    })
);

const show = (id, src, delay = 0) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.src = src;
  setTimeout(() => el.classList.add("is-visible"), delay);
};

const waitCharaMin = new Promise((resolve) => setTimeout(resolve, charaMinDelay));
const waitImgs = Promise.all(preloads);

Promise.all([waitCharaMin, waitImgs]).then(() => {
  show("left-3",  picked[2], step * 0);
  show("right-3", picked[5], step * 0);

  show("left-2",  picked[1], step * 1);
  show("right-2", picked[4], step * 1);

  show("left-1",  picked[0], step * 2);
  show("right-1", picked[3], step * 2);
});
});
