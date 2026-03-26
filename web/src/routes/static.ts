import path from "path";
import fs from "fs";

const STATIC_DIR = path.join(import.meta.dir, "../../static");

const MIME: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function serveStatic(req: Request, params: Record<string, string>): Response {
  const file = params["*"] ?? params.file ?? "";
  const filePath = path.join(STATIC_DIR, file);

  // Prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return new Response("Not Found", { status: 404 });
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
  });
}
