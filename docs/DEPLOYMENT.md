# Deployment

## Environment Variables

The server can be configured without code changes:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `3000` | Listen port |
| `DATA_DIR` | `./data` | Runtime SQLite data directory |
| `RETENTION_DAYS` | `7` | Message retention window |
| `SESSION_DAYS` | `30` | Login session lifetime |
| `MAX_TEXT_LENGTH` | `2000` | Maximum text message length |
| `MAX_VOICE_DATA_LENGTH` | `2000000` | Maximum voice data URL length |
| `MAX_VOICE_SECONDS` | `600` | Maximum voice duration stored on a message |

Example:

```bash
cd /home/hejindong/code/chat
PORT=3000 RETENTION_DAYS=7 SESSION_DAYS=30 npm start
```

## Systemd Service

Create `/etc/systemd/system/chat.service`:

```ini
[Unit]
Description=Chat web service
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/hejindong/code/chat
Environment=HOST=0.0.0.0
Environment=PORT=3000
Environment=DATA_DIR=/home/hejindong/code/chat/data
Environment=RETENTION_DAYS=7
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then run:

```bash
systemctl daemon-reload
systemctl enable --now chat
systemctl status chat
```

## Nginx HTTPS Proxy

Voice recording on mobile browsers usually requires HTTPS. Put Nginx in front of the Node service:

```nginx
server {
  listen 80;
  server_name chat.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name chat.example.com;

  ssl_certificate /etc/letsencrypt/live/chat.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## Backup

Back up the configured `DATA_DIR`. It contains `chat.sqlite` and SQLite WAL files. For the default deployment:

```bash
tar -czf chat-data-$(date +%F).tar.gz /home/hejindong/code/chat/data
```
