const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DB_FILE = path.join(DATA_DIR, "chat.sqlite");
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
const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS friendships (
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
  );
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    context_type TEXT NOT NULL,
    group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    dm_key TEXT,
    participants_json TEXT,
    text TEXT,
    voice_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON group_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(context_type, group_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(context_type, dm_key, created_at);
`);

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

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate.hash, "hex"), Buffer.from(user.hash, "hex"));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.display_name,
    createdAt: user.createdAt || user.created_at
  };
}

function rowUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    salt: row.salt,
    hash: row.hash,
    createdAt: row.created_at
  };
}

function rowGroup(row) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at
  };
}

function dmKey(a, b) {
  return [a, b].sort().join(":");
}

function friendshipPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function areFriends(a, b) {
  const [userA, userB] = friendshipPair(a, b);
  return Boolean(db.prepare("SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?").get(userA, userB));
}

function addFriendship(a, b) {
  if (a === b) return false;
  const [userA, userB] = friendshipPair(a, b);
  db.prepare("INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)").run(userA, userB, now());
  return true;
}

function getUserByUsername(username) {
  return rowUser(db.prepare("SELECT * FROM users WHERE username = ?").get(username));
}

function getUserById(id) {
  return rowUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, now());
  return rowUser(row);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now(), new Date(Date.now() + SESSION_MS).toISOString());
  return token;
}

function ensureGeneralGroup(userId) {
  const existing = db.prepare("SELECT * FROM groups WHERE id = 'general'").get();
  if (!existing) {
    db.prepare("INSERT INTO groups (id, name, owner_id, created_at) VALUES ('general', 'General', ?, ?)").run(userId, now());
  }
  db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES ('general', ?, 'member', ?)")
    .run(userId, now());
}

function ensureDefaultGroup() {
  const existing = db.prepare("SELECT 1 FROM groups WHERE id = 'general'").get();
  if (!existing) {
    db.prepare("INSERT INTO groups (id, name, owner_id, created_at) VALUES ('general', 'General', NULL, ?)").run(now());
  }
}

function isGroupMember(groupId, userId) {
  return Boolean(db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, userId));
}

function getVisibleGroups(userId) {
  return db.prepare(`
    SELECT groups.*
    FROM groups
    JOIN group_members ON group_members.group_id = groups.id
    WHERE group_members.user_id = ?
    ORDER BY groups.created_at ASC
  `).all(userId).map(rowGroup);
}

function getFriends(userId) {
  return db.prepare(`
    SELECT users.*
    FROM friendships
    JOIN users ON users.id = CASE WHEN friendships.user_a = ? THEN friendships.user_b ELSE friendships.user_a END
    WHERE friendships.user_a = ? OR friendships.user_b = ?
    ORDER BY users.display_name COLLATE NOCASE ASC
  `).all(userId, userId, userId).map(rowUser).map(publicUser);
}

function getBootstrap(user) {
  return {
    user: publicUser(user),
    users: getFriends(user.id),
    rooms: getVisibleGroups(user.id),
    online: connectedUsers()
  };
}

function rowMessage(row) {
  const voice = row.voice_json ? JSON.parse(row.voice_json) : null;
  const participants = row.participants_json ? JSON.parse(row.participants_json) : null;
  const context = row.context_type === "room"
    ? { type: "room", roomId: row.group_id }
    : { type: "dm", key: row.dm_key, participants };
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    context,
    text: row.text || "",
    voice,
    at: row.created_at
  };
}

function getHistory(userId, context) {
  if (context.type === "room") {
    if (!isGroupMember(context.roomId, userId)) return [];
    return db.prepare(`
      SELECT * FROM messages
      WHERE context_type = 'room' AND group_id = ?
      ORDER BY created_at ASC
    `).all(context.roomId).map(rowMessage);
  }
  if (!areFriends(userId, context.withUserId)) return [];
  return db.prepare(`
    SELECT * FROM messages
    WHERE context_type = 'dm' AND dm_key = ?
    ORDER BY created_at ASC
  `).all(dmKey(userId, context.withUserId)).map(rowMessage);
}

function canSee(userId, message) {
  if (message.context.type === "room") return isGroupMember(message.context.roomId, userId);
  return message.context.participants.includes(userId);
}

function pruneData() {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  db.prepare("DELETE FROM messages WHERE created_at < ?").run(cutoff);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function connectedUsers() {
  const seen = new Set();
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.user) seen.add(client.user.id);
  }
  return [...seen];
}

function broadcastPresence() {
  const online = connectedUsers();
  for (const client of wss.clients) {
    if (client.user) sendJson(client, { type: "presence", online });
  }
}

function broadcastBootstrap(userId) {
  for (const client of wss.clients) {
    if (client.user?.id === userId) sendJson(client, { type: "bootstrap", ...getBootstrap(client.user) });
  }
}

function broadcastRooms(groupId) {
  const memberRows = db.prepare("SELECT user_id FROM group_members WHERE group_id = ?").all(groupId);
  for (const row of memberRows) broadcastBootstrap(row.user_id);
}

function broadcastMessage(message) {
  for (const client of wss.clients) {
    if (client.user && canSee(client.user.id, message)) sendJson(client, { type: "message", message });
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
      if (getUserByUsername(username)) return send(res, 409, { error: "Username already exists." });

      const passwordHash = hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        username,
        displayName: displayName || username,
        salt: passwordHash.salt,
        hash: passwordHash.hash,
        createdAt: now()
      };
      db.prepare("INSERT INTO users (id, username, display_name, salt, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(user.id, user.username, user.displayName, user.salt, user.hash, user.createdAt);
      ensureGeneralGroup(user.id);
      const token = createSession(user.id);
      return send(res, 201, { token, ...getBootstrap(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const user = getUserByUsername(safeText(body.username, 32).toLowerCase());
      if (!user || !verifyPassword(body.password || "", user)) return send(res, 401, { error: "Invalid username or password." });
      ensureGeneralGroup(user.id);
      const token = createSession(user.id);
      return send(res, 200, { token, ...getBootstrap(user) });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const user = getSessionUser(token);
      if (!user) return send(res, 401, { error: "Session expired." });
      ensureGeneralGroup(user.id);
      return send(res, 200, getBootstrap(user));
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/friends/add") {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const user = getSessionUser(token);
      if (!user) return send(res, 401, { error: "Session expired." });
      const body = await readBody(req);
      const friend = getUserByUsername(safeText(body.username, 32).toLowerCase());
      if (!friend) return send(res, 404, { error: "User not found." });
      if (friend.id === user.id) return send(res, 400, { error: "You cannot add yourself." });
      addFriendship(user.id, friend.id);
      broadcastBootstrap(user.id);
      broadcastBootstrap(friend.id);
      return send(res, 200, getBootstrap(user));
    }

    if (req.method === "POST" && url.pathname === "/api/groups/invite") {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const user = getSessionUser(token);
      if (!user) return send(res, 401, { error: "Session expired." });
      const body = await readBody(req);
      const groupId = safeText(body.groupId, 80);
      const friend = getUserByUsername(safeText(body.username, 32).toLowerCase());
      if (!friend) return send(res, 404, { error: "User not found." });
      if (!isGroupMember(groupId, user.id)) return send(res, 403, { error: "You are not in this group." });
      if (!areFriends(user.id, friend.id)) return send(res, 403, { error: "Add this user as a friend before inviting them." });
      db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
        .run(groupId, friend.id, now());
      broadcastRooms(groupId);
      return send(res, 200, getBootstrap(user));
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
      users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      groups: db.prepare("SELECT COUNT(*) AS count FROM groups").get().count,
      friendships: db.prepare("SELECT COUNT(*) AS count FROM friendships").get().count,
      messages: db.prepare("SELECT COUNT(*) AS count FROM messages").get().count,
      retentionDays: RETENTION_DAYS,
      sessionDays: SESSION_DAYS,
      maxTextLength: MAX_TEXT_LENGTH,
      maxVoiceSeconds: MAX_VOICE_SECONDS,
      dataDir: DATA_DIR,
      database: DB_FILE
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
  const user = getSessionUser(url.searchParams.get("token"));
  if (!user) {
    ws.close(1008, "Unauthorized");
    return;
  }

  ws.user = user;
  sendJson(ws, {
    type: "ready",
    ...getBootstrap(user),
    history: getHistory(user.id, { type: "room", roomId: "general" })
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
        const roomId = safeText(payload.context.roomId, 80);
        sendJson(ws, { type: "history", context: { type: "room", roomId }, messages: getHistory(ws.user.id, { type: "room", roomId }) });
      }
      if (payload.context?.type === "dm") {
        const withUserId = safeText(payload.context.withUserId, 80);
        sendJson(ws, { type: "history", context: { type: "dm", withUserId }, messages: getHistory(ws.user.id, { type: "dm", withUserId }) });
      }
      return;
    }

    if (payload.type === "room:create") {
      const name = safeText(payload.name, 40);
      const id = slug(name) || crypto.randomUUID().slice(0, 8);
      if (!name) return;
      const groupId = db.prepare("SELECT 1 FROM groups WHERE id = ?").get(id) ? `${id}-${crypto.randomUUID().slice(0, 6)}` : id;
      db.prepare("INSERT INTO groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)").run(groupId, name, ws.user.id, now());
      db.prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(groupId, ws.user.id, now());
      broadcastBootstrap(ws.user.id);
      return;
    }

    if (payload.type === "message") {
      let contextType;
      let groupId = null;
      let key = null;
      let participants = null;

      if (payload.context?.type === "dm") {
        const withUserId = safeText(payload.context.withUserId, 80);
        if (!areFriends(ws.user.id, withUserId)) return;
        contextType = "dm";
        key = dmKey(ws.user.id, withUserId);
        participants = [ws.user.id, withUserId];
      } else {
        groupId = safeText(payload.context?.roomId || "general", 80);
        if (!isGroupMember(groupId, ws.user.id)) return;
        contextType = "room";
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

      const id = crypto.randomUUID();
      const createdAt = now();
      db.prepare(`
        INSERT INTO messages (id, sender_id, sender_name, context_type, group_id, dm_key, participants_json, text, voice_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ws.user.id, ws.user.displayName, contextType, groupId, key, participants ? JSON.stringify(participants) : null, text, voice ? JSON.stringify(voice) : null, createdAt);
      pruneData();
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
      broadcastMessage(rowMessage(row));
    }
  });

  ws.on("close", broadcastPresence);
});

ensureDefaultGroup();
pruneData();
setInterval(pruneData, 60 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`Chat server listening on http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DB_FILE}`);
});
