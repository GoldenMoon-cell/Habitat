import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const DIST = path.join(process.cwd(), "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const srv = http.createServer((req, res) => {
  let rel = (req.url || "/").split("?")[0];
  if (rel === "/") rel = "/index.html";
  const full = path.join(DIST, rel);
  fs.readFile(full, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, "index.html"), (e2, html) => {
        if (e2) return res.writeHead(404).end("no index");
        res.writeHead(200, { "Content-Type": MIME[".html"] }).end(html);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" }).end(data);
  });
});

await new Promise((ok, no) => {
  srv.once("error", no);
  srv.listen(1420, "127.0.0.1", ok);
});
console.log("✅ 静态服务已起 :1420");

const get = (p) =>
  new Promise((ok) =>
    http.get({ host: "127.0.0.1", port: 1420, path: p }, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => ok({ status: r.statusCode, type: r.headers["content-type"], len: b.length }));
    })
  );

console.log("  /              →", JSON.stringify(await get("/")));
const js = fs.readdirSync(path.join(DIST, "assets")).find((f) => f.endsWith(".js"));
console.log(`  /assets/${js}  →`, JSON.stringify(await get(`/assets/${js}`)));
console.log("  /unknown-route →", JSON.stringify(await get("/unknown-route")));

srv.close();
