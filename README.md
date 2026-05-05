# Chat

A cross-platform real-time chat app served from the current host.

## Status

This project is a self-hosted web chat application. The backend runs on the current server and the client runs in a browser, so it works across desktop and mobile platforms without installing native apps.

## Features

- Browser client for desktop and mobile
- Local account registration and login
- Multiple group chats
- Private one-to-one chats
- Text and voice messages
- Online user presence
- Seven-day message retention
- Local JSON persistence in `data/`

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Improvement Roadmap](docs/ROADMAP.md)

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

Common configuration:

```bash
PORT=3000 HOST=0.0.0.0 RETENTION_DAYS=7 SESSION_DAYS=30 DATA_DIR=./data npm start
```

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

Messages older than `RETENTION_DAYS` are removed automatically. The default is seven days.

## Current Limitations

- Voice recording may require HTTPS on mobile browsers.
- JSON files are suitable for a small private deployment, not heavy production traffic.
- There is no admin UI yet for user, room, or moderation management.
