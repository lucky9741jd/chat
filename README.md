# Chat

A cross-platform real-time chat app served from the current host.

## Features

- Browser client for desktop and mobile
- Local account registration and login
- Multiple group chats
- Private one-to-one chats
- Text and voice messages
- Online user presence
- Seven-day message retention
- Local JSON persistence in `data/`

## Run

```bash
npm install
npm start
```

The server listens on `0.0.0.0:3000` by default.

Open from the host:

```text
http://localhost:3000
```

Open from another device on the same network:

```text
http://<server-ip>:3000
```

Use `PORT=8080 npm start` to change the port.

Health check:

```text
http://<server-ip>:3000/health
```

## Data

The server stores local data under `data/`:

- `users.json`
- `sessions.json`
- `rooms.json`
- `messages.json`

Messages older than seven days are removed automatically.
