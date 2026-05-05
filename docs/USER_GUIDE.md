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

Use `Logout` in the sidebar to revoke the current browser session.

## Group Chats

The default group is `General`.

To create another group:

1. Click the `+` button in the Groups section.
2. Enter a group name.
3. Send messages in the new group.

Messages are separated by group, so each room has its own history. Users only see groups where they are members.

To invite someone into the current group:

1. Add them as a friend first.
2. Open the group.
3. Enter their username in `Invite friend`.

## Private Chats

The People list shows friends, not every registered user.

To add a friend, enter a username in `Add username`. Click a friend to open a private one-to-one chat. Private messages are only delivered to the two participants.

## Voice Messages

Use `Hold Voice` to record and send a voice message.

Mobile browsers commonly require HTTPS before allowing microphone access. If recording fails on a phone, configure HTTPS for the server and retry.

## Message Retention

Messages are retained for seven days by default. The server operator can change this with `RETENTION_DAYS`.

## Health Check

Open:

```text
http://<server-ip>:3000/health
```

The response includes service status, online count, user count, room count, message count, and retention days.
