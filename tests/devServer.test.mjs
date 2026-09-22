import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("ローカルserverはA/B/Cと依存JS/CSSを配信しwhitelist外を拒否", { timeout: 20000 }, async t => {
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/serve-a-skill-test.mjs", import.meta.url)), String(port)], { windowsHide: true });
  t.after(() => { child.kill(); });
  await Promise.race([once(child.stdout, "data"), once(child, "exit").then(([code]) => { throw new Error(`server exit ${code}`); })]);
  const base = `http://127.0.0.1:${port}`, queue = ["/a-skill-test.html", "/b-skill-test.html", "/c-skill-test.html"], visited = new Set();
  while (queue.length) {
    const path = queue.shift(); if (visited.has(path)) continue; visited.add(path);
    const response = await fetch(base + path); assert.equal(response.status, 200, path);
    const text = await response.text();
    const refs = path.endsWith(".html") ? [...text.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
      : path.endsWith(".js") ? [...text.matchAll(/from\s+"([^"]+)"/g)] : [...text.matchAll(/url\("([^"]+)"\)/g)];
    for (const [, ref] of refs) queue.push(new URL(ref, base + path).pathname);
  }
  assert.ok(visited.has("/js/bSkillTestHarness.js") && visited.has("/js/battleEngine.js") && visited.has("/css/b-skill-test.css"));
  for (const path of ["/.git/config", "/docs/b-skill-building.md", "/package.json", "/js/%2e%2e%2fREADME.md"])
    assert.equal((await fetch(base + path)).status, 404, path);
  assert.equal((await fetch(base + "/b-skill-test.html", { method: "POST" })).status, 405);
  const head = await fetch(base + "/b-skill-test.html", { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
});
