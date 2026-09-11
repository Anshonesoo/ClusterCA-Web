import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.CLUSTERCA_PORT ?? "4173", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CLUSTERCA_PORT 必须是 1..65535 的整数");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".map", "application/json; charset=utf-8"],
]);

const resolveRequest = (requestUrl) => {
  const pathname = decodeURIComponent(new URL(requestUrl ?? "/", `http://${host}`).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return undefined;
  return candidate;
};

const server = createServer(async (request, response) => {
  try {
    let target = resolveRequest(request.url);
    if (!target) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const targetStat = await stat(target);
    if (targetStat.isDirectory()) target = path.join(target, "index.html");
    const data = await readFile(target);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(target).toLowerCase()) ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
});

server.listen(port, host, () => {
  console.log(`ClusterCA Web V2: http://${host}:${port}/`);
  console.log("按 Ctrl+C 停止本地服务器。");
});
