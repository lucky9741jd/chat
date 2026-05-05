const messagesEl = document.querySelector("#messages");
const composer = document.querySelector("#composer");
const input = document.querySelector("#messageInput");
const statusEl = document.querySelector("#status");
const onlineEl = document.querySelector("#onlineCount");
const nameDialog = document.querySelector("#nameDialog");
const nameForm = document.querySelector("#nameForm");
const nameInput = document.querySelector("#nameInput");

const savedName = localStorage.getItem("chat:name") || "";
let clientId = "";
let displayName = savedName;
let socket;

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystem(text) {
  const el = document.createElement("div");
  el.className = "system";
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addMessage(message) {
  const el = document.createElement("article");
  el.className = `message${message.userId === clientId ? " mine" : ""}`;

  const meta = document.createElement("div");
  meta.className = "meta";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = message.name;

  const time = document.createElement("time");
  time.dateTime = message.at;
  time.textContent = formatTime(message.at);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.text;

  meta.append(name, time);
  el.append(meta, bubble);
  messagesEl.appendChild(el);
  scrollToBottom();
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function setConnected(connected) {
  input.disabled = !connected;
  composer.querySelector("button").disabled = !connected;
  statusEl.textContent = connected ? `Signed in as ${displayName}` : "Disconnected. Reconnecting...";
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}`);
  setConnected(false);

  socket.addEventListener("open", () => {
    send({ type: "join", name: displayName });
    setConnected(true);
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "welcome") {
      clientId = payload.id;
      messagesEl.textContent = "";
      payload.history.forEach(addMessage);
      onlineEl.textContent = payload.online;
      return;
    }

    if (payload.type === "message") {
      addMessage(payload.message);
      return;
    }

    if (payload.type === "system") {
      addSystem(payload.text);
      onlineEl.textContent = payload.online;
      return;
    }

    if (payload.type === "presence") {
      onlineEl.textContent = payload.online;
    }
  });

  socket.addEventListener("close", () => {
    setConnected(false);
    window.setTimeout(connect, 1500);
  });
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  send({ type: "message", text });
  input.value = "";
  input.focus();
});

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  displayName = nameInput.value.trim() || "Guest";
  localStorage.setItem("chat:name", displayName);
  nameDialog.close();
  connect();
});

if (displayName) {
  connect();
} else {
  nameDialog.showModal();
}
