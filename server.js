const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const RETENTION_DAYS = Math.max(1, Number(process.env.RETENTION_DAYS || 7));
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 30));
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = Math.max(1, Number(process.env.MAX_TEXT_LENGTH || 2000));
const MAX_VOICE_DATA_LENGTH = Math.max(1000, Number(process.env.MAX_VOICE_DATA_LENGTH || 2_000_000));
const MAX_VOICE_SECONDS = Math.max(1, Number(process.env.MAX_VOICE_SECONDS || 600));

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function safeText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function slug(value) {
  return safeText(value, 48)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate.hash, "hex"), Buffer.from(user.hash, "hex"));
}

let users = readJson(USERS_FILE, []);
let rooms = readJson(ROOMS_FILE, [
  { id: "general", name: "General", createdAt: new Date().toISOString() }
]);
let messages = readJson(MESSAGES_FILE, []);
let sessions = readJson(SESSIONS_FILE, []);

function normalizeMessage(message) {
  if (message.context) return message;
  return {
    id: message.id || crypto.randomUUID(),
    senderId: message.senderId || message.userId || "legacy",
    senderName: message.senderName || message.name || "Guest",
    context: { type: "room", roomId: "general" },
    text: safeText(message.text, MAX_TEXT_LENGTH),
    voice: null,
    at: message.at || new Date().toISOString()
  };
}

function pruneData() {
  const cutoff = Date.now() - RETENTION_MS;
  messages = messages
    .map(normalizeMessage)
    .filter((message) => message.context && new Date(message.at).getTime() >= cutoff);
  sessions = sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now());
  writeJson(MESSAGES_FILE, messages);
  writeJson(SESSIONS_FILE, sessions);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt
  };
}

function findSession(token) {
  if (!token) return null;
  const session = sessions.find((item) => item.token === token);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = users.find((item) => item.id === session.userId);
  return user ? { session, user } : null;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    token,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_MS).toISOString()
  };
  sessions.push(session);
  writeJson(SESSIONS_FILE, sessions);
  return session;
}

function roomExists(roomId) {
  return rooms.some((room) => room.id === roomId);
}

function dmKey(a, b) {
  return [a, b].sort().join(":");
}

function getHistory(context) {
  return messages.filter((message) => {
    if (context.type === "room") return message.context.type === "room" && message.context.roomId === context.roomId;
    return message.context.type === "dm" && message.context.key === dmKey(context.withUserId, context.selfUserId);
  });
}

function canSee(userId, message) {
  if (message.context.type === "room") return true;
  return message.context.participants.includes(userId);
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function connectedUsers() {
  const seen = new Set();
  const online = [];
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN || !client.user || seen.has(client.user.id)) continue;
    seen.add(client.user.id);
    online.push(client.user.id);
  }
  return online;
}

function broadcastPresence() {
  const online = connectedUsers();
  for (const client of wss.clients) {
    if (client.user) sendJson(client, { type: "presence", online });
  }
}

function broadcastMessage(message) {
  for (const client of wss.clients) {
    if (client.user && canSee(client.user.id, message)) {
      sendJson(client, { type: "message", message });
    }
  }
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 3_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await readBody(req);
      const username = safeText(body.username, 32).toLowerCase();
      const displayName = safeText(body.displayName || body.username, 32);
      const password = String(body.password || "");
      if (!/^[a-z0-9_]{3,32}$/.test(username)) return send(res, 400, { error: "Username must be 3-32 characters: a-z, 0-9, _." });
      if (password.length < 6) return send(res, 400, { error: "Password must be at least 6 characters." });
      if (users.some((user) => user.username === username)) return send(res, 409, { error: "Username already exists." });

      const passwordHash = hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        username,
        displayName: displayName || username,
        salt: passwordHash.salt,
        hash: passwordHash.hash,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      writeJson(USERS_FILE, users);
      const session = createSession(user.id);
      return send(res, 201, { token: session.token, user: publicUser(user), rooms, users: users.map(publicUser) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const username = safeText(body.username, 32).toLowerCase();
      const user = users.find((item) => item.username === username);
      if (!user || !verifyPassword(body.password || "", user)) return send(res, 401, { error: "Invalid username or password." });
      const session = createSession(user.id);
      return send(res, 200, { token: session.token, user: publicUser(user), rooms, users: users.map(publicUser) });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const found = findSession(token);
      if (!found) return send(res, 401, { error: "Session expired." });
      return send(res, 200, {
        user: publicUser(found.user),
        users: users.map(publicUser),
        rooms,
        online: connectedUsers()
      });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      sessions = sessions.filter((session) => session.token !== token);
      writeJson(SESSIONS_FILE, sessions);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, {
      ok: true,
      online: connectedUsers().length,
      users: users.length,
      rooms: rooms.length,
      messages: messages.length,
      retentionDays: RETENTION_DAYS,
      sessionDays: SESSION_DAYS,
      maxTextLength: MAX_TEXT_LENGTH,
      maxVoiceSeconds: MAX_VOICE_SECONDS,
      dataDir: DATA_DIR
    });
    return;
  }

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

const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const found = findSession(url.searchParams.get("token"));
  if (!found) {
    ws.close(1008, "Unauthorized");
    return;
  }

  ws.user = found.user;
  sendJson(ws, {
    type: "ready",
    user: publicUser(found.user),
    users: users.map(publicUser),
    rooms,
    online: connectedUsers(),
    history: getHistory({ type: "room", roomId: "general" })
  });
  broadcastPresence();

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload.type === "history") {
      if (payload.context?.type === "room") {
        const roomId = safeText(payload.context.roomId, 64);
        if (!roomExists(roomId)) return;
        sendJson(ws, { type: "history", context: { type: "room", roomId }, messages: getHistory({ type: "room", roomId }) });
      }
      if (payload.context?.type === "dm") {
        const withUserId = safeText(payload.context.withUserId, 80);
        if (!users.some((user) => user.id === withUserId)) return;
        const context = { type: "dm", selfUserId: ws.user.id, withUserId };
        sendJson(ws, { type: "history", context: { type: "dm", withUserId }, messages: getHistory(context) });
      }
      return;
    }

    if (payload.type === "room:create") {
      const name = safeText(payload.name, 40);
      const id = slug(name) || crypto.randomUUID().slice(0, 8);
      if (!name || roomExists(id)) return;
      rooms.push({ id, name, createdAt: new Date().toISOString(), createdBy: ws.user.id });
      writeJson(ROOMS_FILE, rooms);
      for (const client of wss.clients) {
        if (client.user) sendJson(client, { type: "rooms", rooms });
      }
      return;
    }

    if (payload.type === "message") {
      let context;
      if (payload.context?.type === "dm") {
        const withUserId = safeText(payload.context.withUserId, 80);
        const recipient = users.find((user) => user.id === withUserId);
        if (!recipient || recipient.id === ws.user.id) return;
        context = { type: "dm", key: dmKey(ws.user.id, recipient.id), participants: [ws.user.id, recipient.id] };
      } else {
        const roomId = safeText(payload.context?.roomId || "general", 64);
        if (!roomExists(roomId)) return;
        context = { type: "room", roomId };
      }

      const text = safeText(payload.text, MAX_TEXT_LENGTH);
      const voice = payload.voice && typeof payload.voice.dataUrl === "string"
        ? {
            dataUrl: payload.voice.dataUrl.slice(0, MAX_VOICE_DATA_LENGTH),
            mimeType: safeText(payload.voice.mimeType, 80) || "audio/webm",
            seconds: Math.max(1, Math.min(MAX_VOICE_SECONDS, Number(payload.voice.seconds || 1)))
          }
        : null;
      if (!text && !voice) return;
      if (voice && !voice.dataUrl.startsWith("data:audio/")) return;

      const message = {
        id: crypto.randomUUID(),
        senderId: ws.user.id,
        senderName: ws.user.displayName,
        context,
        text,
        voice,
        at: new Date().toISOString()
      };

      messages.push(message);
      pruneData();
      broadcastMessage(message);
    }
  });

  ws.on("close", broadcastPresence);
});

pruneData();
setInterval(pruneData, 60 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`Chat server listening on http://${HOST}:${PORT}`);
});
