# Chat

A small cross-platform real-time chat app served from the current host.

## Features

- Browser-based client for desktop and mobile
- Node.js backend with WebSocket real-time messaging
- Online user count
- Local message history persisted in `data/messages.json`

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
