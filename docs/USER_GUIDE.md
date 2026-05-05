# User Guide

## Access

Open the app in a browser:

```text
http://<server-ip>:3000
```

For the current host:

```text
http://43.228.79.171:3000
```

## Accounts

New users can register with:

- Username: 3-32 characters, using lowercase letters, numbers, and `_`
- Display name: the name shown in chats
- Password: at least 6 characters

After login, the browser stores a local session token. If the session expires or is removed, the login dialog appears again.

## Group Chats

The default group is `General`.

To create another group:

1. Click the `+` button in the Groups section.
2. Enter a group name.
3. Send messages in the new group.

Messages are separated by group, so each room has its own history.

## Private Chats

The People list shows registered users except the current user.

Click a user to open a private one-to-one chat. Private messages are only delivered to the two participants.

## Voice Messages

Use `Hold Voice` to record and send a voice message.

Mobile browsers commonly require HTTPS before allowing microphone access. If recording fails on a phone, configure HTTPS for the server and retry.

## Message Retention

Messages are retained for seven days. The server automatically removes older records.

## Health Check

Open:

```text
http://<server-ip>:3000/health
```

The response includes service status, online count, user count, room count, message count, and retention days.
