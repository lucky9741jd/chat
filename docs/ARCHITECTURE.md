# Architecture

## Overview

The app is a single Node.js service that serves both the browser client and the real-time chat backend.

```text
Browser client
  |
  | HTTP: static files, auth APIs, health check
  | WebSocket: real-time messages and presence
  v
Node.js server
  |
  v
Local JSON files under data/
```

## Runtime Components

- `server.js`: HTTP server, auth API, WebSocket server, persistence, message retention.
- `public/index.html`: browser UI structure.
- `public/app.js`: client state, auth flow, room switching, private chat, voice recording, WebSocket handling.
- `public/styles.css`: responsive desktop and mobile layout.
- `data/`: local runtime data, ignored by Git.

## HTTP Endpoints

- `GET /`: serves the web client.
- `GET /health`: service status and counts.
- `POST /api/register`: creates a local account and session.
- `POST /api/login`: validates credentials and creates a session.
- `GET /api/session`: validates a session token and returns app bootstrap data.

## WebSocket

The WebSocket endpoint is:

```text
/ws?token=<session-token>
```

The token is required. Unauthenticated connections are closed.

Main client-to-server events:

- `history`: request group or private chat history.
- `room:create`: create a group chat.
- `message`: send text or voice message.

Main server-to-client events:

- `ready`: authenticated bootstrap state.
- `history`: requested message history.
- `message`: new visible message.
- `presence`: online user IDs.
- `rooms`: updated room list.

## Data Files

The server writes local JSON files:

- `data/users.json`: user records with salted password hashes.
- `data/sessions.json`: active login sessions.
- `data/rooms.json`: group chat metadata.
- `data/messages.json`: retained messages.

Message records include a `context`:

- Group: `{ "type": "room", "roomId": "general" }`
- Private chat: `{ "type": "dm", "key": "...", "participants": ["...", "..."] }`

## Retention

`server.js` keeps messages for seven days:

```text
RETENTION_MS = 7 * 24 * 60 * 60 * 1000
```

Cleanup runs on startup and then once per hour.

## Security Notes

- Passwords are hashed with PBKDF2 and per-user salts.
- Session tokens are random server-generated values.
- Runtime data is stored locally, so server filesystem access must be protected.
- HTTPS is needed before treating the app as safe for real external use.
- There is no rate limiting, account lockout, moderation, or audit log yet.
