# Chat

A cross-platform real-time chat app served from the current host.

## Status

This project is a self-hosted web chat application. The backend runs on the current server and the client runs in a browser, so it works across desktop and mobile platforms without installing native apps.

## Features

- Browser client for desktop and mobile
- Local account registration and login
- Multiple group chats
- Group membership and group invites
- Friend system for one-to-one private chats
- Private one-to-one chats
- Text and voice messages
- Online user presence
- Seven-day message retention
- SQLite persistence in `data/chat.sqlite`

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
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

The server stores local data in SQLite:

- `data/chat.sqlite`
- `data/chat.sqlite-wal`
- `data/chat.sqlite-shm`

Messages older than `RETENTION_DAYS` are removed automatically. The default is seven days.

## Current Limitations

- Voice recording may require HTTPS on mobile browsers.
- SQLite is suitable for a small private deployment, but larger deployments should add backups, monitoring, and migration tooling.
- There is no admin UI yet for user, room, or moderation management.
