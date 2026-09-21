// ローカル開発確認専用。追加依存なし。公開サーバーとして使用しない。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "a-skill-test.html" : pathname.slice(1);
    // 必要な静的ファイルだけを提供。.gitや任意のローカルファイルは提供しない。
    if (!/^(a-skill-test\.html|js\/[\w-]+\.js|css\/[\w-]+\.css)$/.test(relative)) {
      res.writeHead(404).end(); return;
    }
    const path = resolve(root, relative);
    if (!path.startsWith(resolve(root) + sep)) { res.writeHead(404).end(); return; }
    const content = await readFile(path);
    res.writeHead(200, { "Content-Type": `${types[extname(path)]}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch { res.writeHead(404).end(); }
});
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
server.listen(4173, "127.0.0.1", () => console.log("Aスキル開発確認: http://127.0.0.1:4173/a-skill-test.html (Ctrl+Cで停止)"));
