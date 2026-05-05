const tokenKey = "chat:token";
const messagesEl = document.querySelector("#messages");
const composer = document.querySelector("#composer");
const input = document.querySelector("#messageInput");
const statusEl = document.querySelector("#status");
const onlineEl = document.querySelector("#onlineCount");
const accountNameEl = document.querySelector("#accountName");
const conversationTitleEl = document.querySelector("#conversationTitle");
const roomListEl = document.querySelector("#roomList");
const userListEl = document.querySelector("#userList");
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const usernameInput = document.querySelector("#usernameInput");
const displayNameInput = document.querySelector("#displayNameInput");
const passwordInput = document.querySelector("#passwordInput");
const authError = document.querySelector("#authError");
const registerButton = document.querySelector("#registerButton");
const roomDialog = document.querySelector("#roomDialog");
const roomForm = document.querySelector("#roomForm");
const roomNameInput = document.querySelector("#roomNameInput");
const newRoomButton = document.querySelector("#newRoomButton");
const cancelRoomButton = document.querySelector("#cancelRoomButton");
const recordButton = document.querySelector("#recordButton");
const menuButton = document.querySelector("#menuButton");
const sidebar = document.querySelector("#sidebar");

let token = localStorage.getItem(tokenKey) || "";
let socket;
let currentUser;
let rooms = [];
let users = [];
let online = [];
let currentContext = { type: "room", roomId: "general" };
let recorder;
let voiceChunks = [];
let recordStartedAt = 0;

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  });
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function setComposerEnabled(enabled) {
  input.disabled = !enabled;
  composer.querySelector("button[type='submit']").disabled = !enabled;
  recordButton.disabled = !enabled || !navigator.mediaDevices || !window.MediaRecorder;
}

function contextMatches(message) {
  if (currentContext.type === "room") return message.context.type === "room" && message.context.roomId === currentContext.roomId;
  return message.context.type === "dm" && message.context.participants.includes(currentUser.id) && message.context.participants.includes(currentContext.withUserId);
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(message) {
  if (!contextMatches(message)) return;
  const el = document.createElement("article");
  el.className = `message${message.senderId === currentUser.id ? " mine" : ""}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = message.senderName;
  const time = document.createElement("time");
  time.dateTime = message.at;
  time.textContent = formatTime(message.at);
  meta.append(name, time);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (message.text) {
    const text = document.createElement("div");
    text.textContent = message.text;
    bubble.append(text);
  }
  if (message.voice) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = message.voice.dataUrl;
    bubble.append(audio);
  }

  el.append(meta, bubble);
  messagesEl.appendChild(el);
  scrollToBottom();
}

function replaceMessages(items) {
  messagesEl.textContent = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No messages yet.";
    messagesEl.appendChild(empty);
    return;
  }
  items.forEach(addMessage);
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function renderRooms() {
  roomListEl.textContent = "";
  rooms.forEach((room) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-item${currentContext.type === "room" && currentContext.roomId === room.id ? " active" : ""}`;
    button.textContent = `# ${room.name}`;
    button.addEventListener("click", () => switchContext({ type: "room", roomId: room.id }));
    roomListEl.appendChild(button);
  });
}

function renderUsers() {
  userListEl.textContent = "";
  users
    .filter((user) => user.id !== currentUser.id)
    .forEach((user) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `nav-item user-item${currentContext.type === "dm" && currentContext.withUserId === user.id ? " active" : ""}`;
      const isOnline = online.includes(user.id);
      button.innerHTML = `<span class="presence ${isOnline ? "on" : ""}"></span><span>${user.displayName}</span>`;
      button.addEventListener("click", () => switchContext({ type: "dm", withUserId: user.id }));
      userListEl.appendChild(button);
    });
}

function renderShell() {
  accountNameEl.textContent = currentUser.displayName;
  onlineEl.textContent = online.length;
  renderRooms();
  renderUsers();
  if (currentContext.type === "room") {
    const room = rooms.find((item) => item.id === currentContext.roomId);
    conversationTitleEl.textContent = room ? `# ${room.name}` : "# Group";
  } else {
    const user = users.find((item) => item.id === currentContext.withUserId);
    conversationTitleEl.textContent = user ? user.displayName : "Private chat";
  }
}

function switchContext(context) {
  currentContext = context;
  renderShell();
  replaceMessages([]);
  send({ type: "history", context });
  sidebar.classList.remove("open");
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  setComposerEnabled(false);
  statusEl.textContent = "Connecting...";

  socket.addEventListener("open", () => {
    setComposerEnabled(true);
    statusEl.textContent = "Connected";
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "ready") {
      currentUser = payload.user;
      users = payload.users;
      rooms = payload.rooms;
      online = payload.online;
      renderShell();
      replaceMessages(payload.history);
      return;
    }
    if (payload.type === "history") {
      replaceMessages(payload.messages);
      return;
    }
    if (payload.type === "message") {
      addMessage(payload.message);
      return;
    }
    if (payload.type === "presence") {
      online = payload.online;
      renderShell();
      return;
    }
    if (payload.type === "rooms") {
      rooms = payload.rooms;
      renderShell();
    }
  });

  socket.addEventListener("close", () => {
    setComposerEnabled(false);
    statusEl.textContent = "Disconnected. Reconnecting...";
    window.setTimeout(connect, 1500);
  });

  socket.addEventListener("error", () => {
    statusEl.textContent = "Disconnected. WebSocket failed.";
  });
}

async function loadSession() {
  if (!token) {
    authDialog.showModal();
    return;
  }
  try {
    const session = await api("/api/session");
    currentUser = session.user;
    users = session.users;
    rooms = session.rooms;
    online = session.online;
    renderShell();
    connect();
  } catch {
    localStorage.removeItem(tokenKey);
    token = "";
    authDialog.showModal();
  }
}

async function authenticate(mode) {
  authError.textContent = "";
  try {
    const payload = await api(`/api/${mode}`, {
      method: "POST",
      body: JSON.stringify({
        username: usernameInput.value,
        displayName: displayNameInput.value,
        password: passwordInput.value
      })
    });
    token = payload.token;
    localStorage.setItem(tokenKey, token);
    currentUser = payload.user;
    users = payload.users;
    rooms = payload.rooms;
    online = [];
    authDialog.close();
    renderShell();
    connect();
  } catch (error) {
    authError.textContent = error.message;
  }
}

async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  voiceChunks = [];
  recorder = new MediaRecorder(stream);
  recordStartedAt = Date.now();
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) voiceChunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(voiceChunks, { type: recorder.mimeType || "audio/webm" });
    const reader = new FileReader();
    reader.onload = () => {
      send({
        type: "message",
        context: currentContext,
        voice: {
          dataUrl: reader.result,
          mimeType: blob.type,
          seconds: Math.round((Date.now() - recordStartedAt) / 1000)
        }
      });
    };
    reader.readAsDataURL(blob);
  });
  recorder.start();
  recordButton.textContent = "Recording...";
}

function stopRecording() {
  if (recorder && recorder.state === "recording") recorder.stop();
  recordButton.textContent = "Hold Voice";
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  authenticate("login");
});

registerButton.addEventListener("click", () => authenticate("register"));

roomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = roomNameInput.value.trim();
  if (name) send({ type: "room:create", name });
  roomNameInput.value = "";
  roomDialog.close();
});

newRoomButton.addEventListener("click", () => roomDialog.showModal());
cancelRoomButton.addEventListener("click", () => roomDialog.close());
menuButton.addEventListener("click", () => sidebar.classList.toggle("open"));

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  send({ type: "message", context: currentContext, text });
  input.value = "";
});

recordButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  startRecording().catch(() => {
    statusEl.textContent = "Microphone permission denied.";
  });
});
recordButton.addEventListener("pointerup", stopRecording);
recordButton.addEventListener("pointerleave", stopRecording);

loadSession();
