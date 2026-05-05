# Architecture

## Overview

The app is a single Node.js service that serves both the browser client and the real-time chat backend. Runtime data is stored in SQLite.

```text
Browser client
  |
  | HTTP: static files, auth APIs, health check
  | WebSocket: real-time messages and presence
  v
Node.js server
  |
  v
SQLite database under data/
```

## Runtime Components

- `server.js`: HTTP server, auth API, WebSocket server, SQLite persistence, message retention.
- `public/index.html`: browser UI structure.
- `public/app.js`: client state, auth flow, group switching, friend private chat, group invites, voice recording, WebSocket handling.
- `public/styles.css`: responsive desktop and mobile layout.
- `data/chat.sqlite`: local runtime database, ignored by Git.

## HTTP Endpoints

- `GET /`: serves the web client.
- `GET /health`: service status and counts.
- `POST /api/register`: creates a local account and session.
- `POST /api/login`: validates credentials and creates a session.
- `POST /api/logout`: revokes the current session token.
- `GET /api/session`: validates a session token and returns app bootstrap data.
- `POST /api/friends/add`: creates a mutual friend relationship by username.
- `POST /api/groups/invite`: adds a friend to a group where the current user is a member.

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
- `bootstrap`: refreshed user, friend, group, and presence state.

## Database

The server writes to `data/chat.sqlite`. Core tables:

- `users`: user records with salted password hashes.
- `sessions`: active login sessions.
- `friendships`: mutual friend relationships.
- `groups`: group metadata.
- `group_members`: group membership and role.
- `messages`: retained group and private messages.

Message records include a context:

- Group: `context_type = 'room'` with `group_id`.
- Private chat: `context_type = 'dm'` with `dm_key` and participants.

## Visibility Rules

- Users can see only groups where they are members.
- Private messages require an existing friendship.
- Group invites require the target user to be a friend.
- The default `General` group is added to each user at registration or login.

## Retention

`server.js` keeps messages for `RETENTION_DAYS`, defaulting to seven days:

```text
RETENTION_DAYS = 7
```

Cleanup runs on startup and then once per hour.

## Configuration

See [Deployment](DEPLOYMENT.md) for supported environment variables, systemd setup, HTTPS proxying, and backups.

## Security Notes

- Passwords are hashed with PBKDF2 and per-user salts.
- Session tokens are random server-generated values.
- Runtime data is stored locally, so server filesystem access must be protected.
- HTTPS is needed before treating the app as safe for real external use.
- There is no rate limiting, account lockout, moderation, or audit log yet.
