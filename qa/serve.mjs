import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/mobile/dist/", import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
createServer(async (req, res) => {
  const pathname = decodeURIComponent(
    new URL(req.url ?? "/", "http://localhost").pathname,
  );
  const target = path.resolve(
    root,
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  if (!target.startsWith(path.resolve(root) + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] ?? "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(4173, "0.0.0.0", () =>
  console.log("MiniLedger preview: http://localhost:4173"),
);
