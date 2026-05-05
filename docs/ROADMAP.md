# Improvement Roadmap

## Near-Term

1. Add HTTPS

   Configure a domain and TLS certificate. This is important for mobile microphone access and safer login sessions.

2. Run as a system service

   Use `systemd` or a process manager so the server restarts automatically after crashes or machine reboot.

3. Add logout and password change

   Users should be able to revoke their current session and rotate credentials.

4. Improve mobile recording

   Show microphone permission errors clearly and add tap-to-start/tap-to-stop recording for mobile ergonomics.

5. Add unread indicators

   Show unread counts for groups and private chats when messages arrive outside the active conversation.

## Reliability

1. Move from JSON files to SQLite

   JSON is simple and works for small deployments, but SQLite will handle concurrent writes, indexes, and safer persistence better.

2. Add automated tests

   Cover auth, session validation, room creation, private message visibility, retention cleanup, and WebSocket delivery.

3. Add structured logs

   Log startup, auth events, WebSocket connection counts, persistence errors, and unexpected exceptions.

4. Add backups

   Periodically back up user, room, and message data.

## Security

1. Add HTTPS-only cookies

   Move session storage from localStorage toward secure cookies once HTTPS is enabled.

2. Add rate limiting

   Protect login, register, and message send paths from abuse.

3. Add stronger account policy

   Include password reset, password change, optional invite codes, and account disablement.

4. Add authorization checks for rooms

   Support private groups, membership lists, and room-level permissions.

5. Add content limits

   Enforce stricter voice duration, file size, and message rate limits.

## Product Features

1. Room management

   Rename rooms, delete rooms, pin rooms, and invite users.

2. Message actions

   Edit, delete, reply, copy, and react to messages.

3. Search

   Search messages by room, user, and time range.

4. Media attachments

   Add image and file uploads with size limits and preview support.

5. Notifications

   Browser notifications and sound alerts for mentions or private messages.

6. User profiles

   Avatars, status text, and presence state such as online, idle, or do not disturb.

## Deployment

1. Add production configuration

   Use environment variables for port, host, retention days, session lifetime, and data path.

2. Add reverse proxy config

   Provide Nginx examples for HTTPS and WebSocket proxying.

3. Add Docker support

   Package the app with a persistent volume for `data/`.

4. Add monitoring

   Expose operational metrics such as online users, message rate, error count, and storage size.
