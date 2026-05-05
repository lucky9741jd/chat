const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "messages.json");
const MAX_HISTORY = 200;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function readHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

let messages = readHistory();

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(messages.slice(-MAX_HISTORY), null, 2));
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  const encoded = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

function safeText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  ws.id = crypto.randomUUID();
  ws.name = "Guest";

  sendJson(ws, {
    type: "welcome",
    id: ws.id,
    history: messages,
    online: wss.clients.size
  });
  broadcast({ type: "presence", online: wss.clients.size });

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload.type === "join") {
      ws.name = safeText(payload.name, 32) || "Guest";
      broadcast({
        type: "system",
        text: `${ws.name} joined`,
        at: new Date().toISOString(),
        online: wss.clients.size
      });
      return;
    }

    if (payload.type === "message") {
      const text = safeText(payload.text, 1000);
      if (!text) return;

      const message = {
        id: crypto.randomUUID(),
        userId: ws.id,
        name: ws.name,
        text,
        at: new Date().toISOString()
      };

      messages.push(message);
      messages = messages.slice(-MAX_HISTORY);
      saveHistory();
      broadcast({ type: "message", message });
    }
  });

  ws.on("close", () => {
    broadcast({ type: "presence", online: wss.clients.size });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Chat server listening on http://${HOST}:${PORT}`);
});
