// Local mock only. No credentials, remote API calls or disk-backed player data.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { player, da, db } from "../tests/onlineSelectFixture.mjs";
const root = new URL("../", import.meta.url);
const ids = { "88": "88888888-8888-4888-8888-888888888888", "89": "99999999-9999-4999-8999-999999999999" };
let eno = "88", mode = "normal", saveCalls = 0;
const rows = new Map(Object.entries(ids).map(([eno, id]) => [id, { gameAccountId: id, eno, revision: "0",
  battler: { build: {}, presentation: { name: `モックDB名${eno}` } }, ducks: [], publicDuckId: null }]));
const sdk = `
const json = async (path, data) => (await fetch(path, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : undefined)).json();
// Any accidental use of the previous local storage adapters fails immediately.
for(const method of ['getItem','setItem','removeItem']) {
 const original=Storage.prototype[method];
 Storage.prototype[method]=function(key,...args){if(!/^diesDuckBattle:battle-result(-index)?:v1/.test(key))throw Error('Local player storage forbidden in online mock');return original.call(this,key,...args);};
}
export function createClient() {
 const listeners = new Set(), channel = new BroadcastChannel('online-editor-mock');
 const session = async () => (await json('/mock/state')).session;
 channel.onmessage = async () => {const value = await session(); for(const cb of listeners) cb(value?'SIGNED_IN':'SIGNED_OUT',value);};
 return { auth: {
  getSession: async()=>({data:{session:await session()}}),
  onAuthStateChange: cb=>{listeners.add(cb); void session().then(s=>cb('INITIAL_SESSION',s));return{data:{subscription:{unsubscribe(){listeners.delete(cb);}}}};},
  signOut: async()=>{await json('/mock/control',{action:'logout'});for(const cb of listeners)cb('SIGNED_OUT',null);channel.postMessage('change');return{};},
  signInWithPassword: async()=>({error:{message:'Not used by this editor mock'}})
 }, from:()=>({select:()=>({eq:async()=>json('/mock/access')})}),
 rpc:async(name,params)=>{const response=await fetch('/mock/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,params})});if(!response.ok)throw Error('Mock connection lost');return response.json();}
 };
}
`;
const controls = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>オンライン編集モック</title>
<h1>ローカル専用モック操作</h1><p>本番Supabaseには接続しません。ENo.88 / 89 はメモリ内の架空データです。</p>
<a href="/setting.html">戦闘設定</a> <a href="/character.html">表示設定</a> <a href="/select.html">キャラクター選択</a>
<p><button data-action="battle-ready">メモリ内に完成buildを用意</button><button data-action="unpublish">相手89を公開解除</button></p>
<p><button data-action="88">ENo.88へ変更</button><button data-action="89">ENo.89へ変更</button><button data-action="logout">ログアウト状態</button><button data-action="multiple">複数アクセス</button><button data-action="zero">アクセス0件</button></p>
<p><button data-action="normal">通信を正常に戻す</button><button data-action="lost-after">次回保存は成立後に応答喪失</button><button data-action="lost-before">次回保存は通信断</button><button data-action="load-failed">読込失敗</button></p>
<p id="status" role="status"></p><script src="/mock-controls.js"></script></html>`;
const security = { "Content-Security-Policy": "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:", "Cache-Control": "no-store" };
const session = () => eno === "logout" ? null : { user: { id: `mock-auth-${["multiple", "zero"].includes(eno) ? "88" : eno}` } };
const accountIds = () => eno === "multiple" ? Object.values(ids) : eno === "zero" || eno === "logout" ? [] : [ids[eno]];
const server = createServer(async (req, res) => {
  const json = (value, status = 200) => { res.writeHead(status, { ...security, "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    let body = {};
    if (req.method === "POST") { let text = ""; for await (const part of req) { text += part; if (text.length > 1000000) throw Error(); } body = JSON.parse(text); }
    if (path === "/mock/state") return json({ session: session(), eno, mode, saveCalls });
    if (path === "/mock/access") return json(mode === "load-failed" ? { error: { code: "MOCK" } } : { data: accountIds().map(id => ({ game_account_id: id, game_accounts: { eno: rows.get(id).eno, battlers: { presentation: { name: rows.get(id).battler.presentation.name } } } })) });
    if (path === "/mock/control" && req.method === "POST") {
      if (["88", "89", "logout", "multiple", "zero"].includes(body.action)) eno = body.action;
      else if (["normal", "lost-after", "lost-before", "load-failed"].includes(body.action)) mode = body.action;
      else if(body.action === "battle-ready") { for(const [number,duck] of [["88",da],["89",db]]) rows.set(ids[number],(await player(ids[number],number,duck)).snapshot); eno="88"; mode="normal"; }
      else if(body.action === "unpublish") rows.get(ids["89"]).publicDuckId=null;
      return json({ eno, mode, saveCalls });
    }
    if (path === "/mock/rpc" && req.method === "POST") {
      const { name, params } = body, id = params.p_game_account_id;
      const projection=accountId=>{const row=structuredClone(rows.get(accountId));if(!row?.publicDuckId||accountIds().includes(accountId)||accountIds().length!==1)return null;
        row.ducks=row.ducks.filter(d=>d.id===row.publicDuckId);row.battler.presentation.detachedDuckPresentation={};return row;};
      if(name==="list_online_opponents")return json({data:[...rows.keys()].map(projection).filter(Boolean).map(r=>({id:r.gameAccountId,eno:r.eno,name:r.battler.presentation.name,publicDuckId:r.publicDuckId}))});
      if(name==="get_online_opponent")return json({data:projection(id)});
      if(name==="prepare_online_battle") {const opponent=projection(params.p_opponent_account_id);return json({data:accountIds().includes(id)&&opponent?.publicDuckId===params.p_opponent_duck_id?{self:rows.get(id),opponent}:null});}
      if (!accountIds().includes(id)) return json({ error: { code: "42501" } });
      const old = rows.get(id);
      if (name === "load_online_player") return json({ data: old });
      if (name !== "save_online_player") return json({}, 400);
      saveCalls++;
      if (mode === "lost-before") { mode = "normal"; return json({}, 503); }
      if (params.p_expected_revision !== old.revision) return json({ error: { code: "40001" } });
      const next = { ...old, ...params.p_payload, revision: String(BigInt(old.revision) + 1n) }; rows.set(id, next);
      if (mode === "lost-after") { mode = "normal"; return json({}, 503); }
      return json({ data: { revision: next.revision } });
    }
    if (req.method !== "GET") return json({}, 405);
    let content, type = "text/javascript";
    if (path === "/mock-sdk.js") content = sdk;
    else if (path === "/mock-controls.js") content = `const channel=new BroadcastChannel('online-editor-mock');for(const b of document.querySelectorAll('button'))b.onclick=async()=>{const r=await fetch('/mock/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:b.dataset.action})});document.getElementById('status').textContent=JSON.stringify(await r.json());channel.postMessage('change');};`;
    else if (path === "/" || path === "/mock.html") { content = controls; type = "text/html"; }
    else {
      if (!/^\/(setting\.html|character\.html|select\.html|result\.html|js\/[\w-]+\.js|css\/[\w-]+\.css|supabase\/functions\/_shared\/(internal-email|registration-password)\.mjs)$/.test(path)) return json({}, 404);
      content = await readFile(new URL(path.slice(1), root), "utf8");
      if (path === "/js/authRuntime.js") content = content.replace("https://esm.sh/@supabase/supabase-js@2.117.2?bundle", "/mock-sdk.js");
      type = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "text/javascript";
    }
    res.writeHead(200, { ...security, "Content-Type": `${type}; charset=utf-8` }); res.end(content);
  } catch { json({}, 400); }
});
server.listen(Number(process.argv[2] ?? 4188), "127.0.0.1", () => console.log(`Mock only: http://127.0.0.1:${server.address().port}/mock.html`));
