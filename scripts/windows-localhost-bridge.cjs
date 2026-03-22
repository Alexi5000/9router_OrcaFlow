const http = require("http");
const fs = require("fs");
const path = require("path");

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 20128;
const TARGET_HOST = process.env.ORCAFLOW_WSL_HOST || "172.25.75.83";
const TARGET_PORT = Number(process.env.ORCAFLOW_WSL_PORT || "20128");
const LOG_PATH = path.join(__dirname, "..", "data", "logs", "windows-localhost-bridge.log");

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  try {
    fs.appendFileSync(LOG_PATH, stamped);
  } catch {}
  process.stdout.write(stamped);
}

const server = http.createServer((req, res) => {
  const upstream = http.request(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    log(`[proxy-error] ${req.method} ${req.url} -> ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Localhost bridge upstream error");
  });

  req.pipe(upstream);
});

server.on("error", (error) => {
  log(`[server-error] ${error.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`[listening] http://${LISTEN_HOST}:${LISTEN_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`);
});
