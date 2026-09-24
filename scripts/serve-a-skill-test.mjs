// ローカル開発確認専用。追加依存なし。公開サーバーとして使用しない。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError("port must be an integer from 1024 to 65535");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "a-skill-test.html" : pathname.slice(1);
    // 必要な静的ファイルだけを提供。.gitや任意のローカルファイルは提供しない。
    if (!/^(select\.html|result\.html|storage\.html|setting\.html|character\.html|[abcd]-skill-test\.html|js\/[\w-]+\.js|css\/[\w-]+\.css)$/.test(relative)) {
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
server.listen(port, "127.0.0.1", () => console.log(`開発確認: http://127.0.0.1:${port}/a-skill-test.html / http://127.0.0.1:${port}/b-skill-test.html / http://127.0.0.1:${port}/c-skill-test.html / http://127.0.0.1:${port}/d-skill-test.html (Ctrl+Cで停止)`));
