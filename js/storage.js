// storage.js
// localStorage に戦闘履歴を保存/取得/削除するユーティリティ
// 仕様：battleId は連番、date は表示用（ISO文字列）
// 履歴（一覧）は軽量保存、events（詳細ログ）は battleId ごとに別キー保存
// 上限は「未保護のみ最新100件」（保護は自動削除しない）

const KEY_HISTORY = "duck_battle_history_v1";
const KEY_NEXT_ID = "duck_battle_next_id_v1";
const KEY_EVENTS_PREFIX = "duck_battle_events_v1:";
const MAX_HISTORY = 20;

/*
 * @typedef {Object} BattleRecord
 * @property {number} battleId
 * @property {string} dateISO
 * @property {{ battlerId: string, duckId: string }} p1
 * @property {{ battlerId: string, duckId: string }} p2
 * @property {"P1_win"|"P2_win"|"draw"} result
 * @property {Array=} events
 * @property {boolean=} protected
 * @property {boolean=} _eventsTruncated
 */

/** 安全にJSONを読む */
function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** events用キー */
function eventsKey(battleId) {
  return `${KEY_EVENTS_PREFIX}${battleId}`;
}

function saveEvents(battleId, events) {
  localStorage.setItem(eventsKey(battleId), JSON.stringify(Array.isArray(events) ? events : []));
}

function loadEvents(battleId) {
  const raw = localStorage.getItem(eventsKey(battleId));
  return safeParse(raw, []);
}

function deleteEvents(battleId) {
  localStorage.removeItem(eventsKey(battleId));
}

/** 履歴配列を読む（新しい順） */
export function loadHistory() {
  const raw = localStorage.getItem(KEY_HISTORY);
  const arr = safeParse(raw, []);
  if (!Array.isArray(arr)) return [];
  arr.sort((a, b) => (b.battleId ?? 0) - (a.battleId ?? 0));
  return arr;
}

/* 容量超過エラー判定 */
function isQuotaExceededError(e) {
  if (!e) return false;
  if (e.name === "QuotaExceededError") return true;
  if (e.code === 22) return true;
  if (e.code === 1014 && String(e.name).includes("NS_ERROR_DOM_QUOTA_REACHED")) return true;
  const msg = String(e.message ?? "");
  return msg.includes("quota") || msg.includes("QuotaExceeded");
}

/* 履歴の上限を守る（保護は自動削除しない／未保護のみMAX件）
   さらに、落とした未保護の events も削除する */
function enforceLimit(history) {
  const h = Array.isArray(history) ? history : [];
  let unprotectedCount = 0;
  const removedIds = [];

  const kept = h.filter((r) => {
    if (r?.protected) return true;

    if (unprotectedCount < MAX_HISTORY) {
      unprotectedCount++;
      return true;
    }

    removedIds.push(Number(r?.battleId));
    return false;
  });

  // 落とした未保護のeventsも消す（容量回復）
  for (const id of removedIds) {
    if (Number.isFinite(id)) deleteEvents(id);
  }

  return kept;
}

/*
 * 履歴配列を書き込む（内部用）
 * - 容量超過なら、古い履歴から削って再トライ（まず未保護から落とす）
 * - 最悪でも「戦闘が止まらない」ようにする
 * @returns {Array} 実際に保存できた履歴
 */
function saveHistory(history) {
  let h = Array.isArray(history) ? [...history] : [];

  // まず件数上限は守る（ただし容量的に足りない場合はさらに削る）
  h = enforceLimit(h);

  while (true) {
    try {
      localStorage.setItem(KEY_HISTORY, JSON.stringify(h));
      return h;
    } catch (e) {
      if (!isQuotaExceededError(e)) throw e;

      // 1) 古い履歴を1件ずつ落として再トライ（まず未保護から落とす）
      if (h.length > 1) {
        let removed = false;

        // 末尾（古い）側から未保護を探して消す
        for (let i = h.length - 1; i >= 0; i--) {
          if (!h[i]?.protected) {
            const id = Number(h[i]?.battleId);
            h.splice(i, 1);
            if (Number.isFinite(id)) deleteEvents(id); // eventsも一緒に消す
            removed = true;
            break;
          }
        }

        // 未保護が無い＝全部保護なら、最後の手段として末尾を落とす（容量が限界）
        if (!removed) {
          const last = h[h.length - 1];
          const id = Number(last?.battleId);
          h.pop();
          if (Number.isFinite(id)) deleteEvents(id); // 最後の手段なので保護でも消える可能性あり
        }
        continue;
      }

      // 2) 最新1件すら入らない＝履歴自体が大きすぎる（基本起きにくい）
      //    events は別保存なので、ここではダミーの軽量版にして保存を試す
      if (h.length === 1) {
        const r = h[0];
        const slim = [{
          ...r,
          _eventsTruncated: true,
        }];

        try {
          localStorage.setItem(KEY_HISTORY, JSON.stringify(slim));
          return slim;
        } catch (e2) {
          console.warn("[storage] History save failed even after truncation:", e2);
          return [];
        }
      }

      return [];
    }
  }
}

/* 次のbattleId（連番）を取得してインクリメント */
export function allocateBattleId() {
  const raw = localStorage.getItem(KEY_NEXT_ID);
  const current = raw ? Number(raw) : 1;
  const next = Number.isFinite(current) && current > 0 ? current : 1;
  localStorage.setItem(KEY_NEXT_ID, String(next + 1));
  return next;
}

/* battleId を指定して1件取得（eventsは別キー優先。無ければ旧形式から救済＆移行） */
export function getBattleById(battleId) {
  const idNum = Number(battleId);
  if (!Number.isFinite(idNum)) return null;

  const history = loadHistory();
  const base = history.find(r => Number(r.battleId) === idNum) ?? null;
  if (!base) return null;

  // 1) まず新方式：別キーから読む
  let events = loadEvents(idNum);

  // 2) 別キーが空で、旧方式のeventsが履歴に残っているならそれを使う
  //    ついでに別キーへ保存して「移行」する（次回から安定）
  if ((!Array.isArray(events) || events.length === 0) && Array.isArray(base.events) && base.events.length > 0) {
    events = base.events;
    try {
      saveEvents(idNum, events); // 旧→新へ移行
    } catch (e) {
      console.warn("[storage] migrate events failed:", e);
    }
  }

  return { ...base, events };
}

/* battleId を指定して削除 */
export function deleteBattleById(battleId) {
  const idNum = Number(battleId);
  if (!Number.isFinite(idNum)) return false;

  const history = loadHistory();
  const before = history.length;
  const filtered = history.filter(r => Number(r.battleId) !== idNum);
  saveHistory(filtered);

  // events も消す
  deleteEvents(idNum);

  return filtered.length !== before;
}

/* 全削除（履歴＋events＋連番も初期化） */
export function clearAllBattles() {
  // まず履歴にあるbattleIdのeventsを消す
  const history = loadHistory();
  for (const r of history) {
    const id = Number(r?.battleId);
    if (Number.isFinite(id)) deleteEvents(id);
  }

  localStorage.removeItem(KEY_HISTORY);
  localStorage.removeItem(KEY_NEXT_ID);
}

/*
 * 戦闘結果を保存して battleId を返す
 * - eventsは別キーに保存
 * - 履歴（一覧）は軽量に保存
 */
export function saveBattle(payload) {
  if (!payload || !Array.isArray(payload.events)) {
    throw new Error("saveBattle: payload.events must be an array");
  }

  const battleId = allocateBattleId();


  // ② 履歴（一覧）は軽量（eventsを入れない）
  const record = /** @type {BattleRecord} */ ({
    battleId,
    dateISO: new Date().toISOString(),
    p1: { battlerId: payload.p1.battlerId, duckId: payload.p1.duckId },
    p2: { battlerId: payload.p2.battlerId, duckId: payload.p2.duckId },
    result: payload.result,
    protected: false,
  });

  const history = loadHistory();
  history.unshift(record);

  saveHistory(history);
saveHistory(history);

// ★ events 保存（容量超過なら古い履歴を追加削除して再試行）
while (true) {
  try {
    saveEvents(battleId, payload.events);
    break;
  } catch (e) {
    if (!isQuotaExceededError(e)) throw e;

    // 古い履歴を1件追加削除して容量を空ける
    const h = loadHistory();
    if (h.length <= 1) {
      throw e; // これ以上削れない
    }

    const last = h[h.length - 1];
    deleteBattleById(last.battleId);
  }
}
  return battleId;
}

/*
 * ヒストリー一覧用の軽量情報だけ返す（新しい順）
 */
export function listBattleSummaries() {
  return loadHistory().map(r => ({
    battleId: r.battleId,
    dateISO: r.dateISO,
    p1: r.p1,
    p2: r.p2,
    result: r.result,
    protected: Boolean(r.protected),
  }));
}

/* 表示用の日時 */
export function formatDateJP(isoString) {
  const d = new Date(isoString);

  if (Number.isNaN(d.getTime())) {
    return isoString;
  }

  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");

  return `${m}/${day}\n${hh}:${mm}`;
}

/* battleId を指定して保護フラグを変更 */
export function setBattleProtected(battleId, isProtected) {
  const idNum = Number(battleId);
  if (!Number.isFinite(idNum)) return false;

  const history = loadHistory();
  const idx = history.findIndex(r => Number(r.battleId) === idNum);
  if (idx < 0) return false;

  history[idx] = { ...history[idx], protected: Boolean(isProtected) };
  saveHistory(history);
  return true;
}

/* 複数 battleId をまとめて保護/解除 */
export function setBattlesProtected(battleIds, isProtected) {
  const ids = (Array.isArray(battleIds) ? battleIds : [])
    .map(Number)
    .filter(n => Number.isFinite(n));

  if (ids.length === 0) return { updated: 0 };

  const set = new Set(ids);
  const history = loadHistory();

  let updated = 0;
  const next = history.map(r => {
    if (!set.has(Number(r.battleId))) return r;
    updated++;
    return { ...r, protected: Boolean(isProtected) };
  });

  saveHistory(next);
  return { updated };
}

/* 複数 battleId をまとめて削除（protectedはスキップ） */
export function deleteBattlesByIds(battleIds) {
  const ids = (Array.isArray(battleIds) ? battleIds : [])
    .map(Number)
    .filter(n => Number.isFinite(n));

  if (ids.length === 0) return { deleted: 0, skippedProtected: 0 };

  const set = new Set(ids);
  const history = loadHistory();

  let deleted = 0;
  let skippedProtected = 0;
  const deletedIds = [];

  const filtered = history.filter(r => {
    const id = Number(r.battleId);
    if (!set.has(id)) return true;

    if (r.protected) {
      skippedProtected++;
      return true;
    }

    deleted++;
    deletedIds.push(id);
    return false;
  });

  saveHistory(filtered);

  // eventsも消す
  for (const id of deletedIds) deleteEvents(id);

  return { deleted, skippedProtected };
}
