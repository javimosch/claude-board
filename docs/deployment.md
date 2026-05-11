# Deployment Guide

## Overview

This guide covers deploying the Claude Streaming Mode PoC in production environments.

## Requirements

- **Node.js/Bun**: Bun 1.0+ or Node.js 20+
- **Claude CLI**: `@anthropic-ai/claude-code` installed globally
- **Claude Credentials**: `~/.claude/.credentials.json` with valid API key
- **Database**: SQLite (bundled, no external DB needed)
- **Port**: 3000 (or configured via `PORT` env var)

## Environment Variables

```bash
PORT=3000                    # Server port (default: 3000)
NODE_ENV=production         # Set to "production" for optimizations
CLAUDE_MODEL=opus-4-6       # Claude model to use (default: sonnet)
LOG_LEVEL=info              # Logging level: debug, info, warn, error
```

Create `.env` file:

```bash
cat > .env << 'EOF'
PORT=3002
NODE_ENV=production
LOG_LEVEL=info
EOF
```

## Installation

```bash
cd /path/to/claude-ui-poc

# Install dependencies
bun install

# Verify Claude CLI
claude --version
```

## Starting the Server

### Development

```bash
bun run dev
```

Watches for file changes and reloads automatically. Logs to console + `server.log`.

### Production

```bash
bun run start
# or
bun src/server.ts
```

Runs without file watching. For persistent daemon, see [Systemd Daemon](#systemd-daemon).

### Systemd User Service (Recommended)

Install as auto-starting systemd service:

```bash
# From project root
bin/claude-ui-poc install

# Start the service
bin/claude-ui-poc start

# Check status
bin/claude-ui-poc status

# View logs
bin/claude-ui-poc logs -f

# Stop
bin/claude-ui-poc stop

# Uninstall
bin/claude-ui-poc uninstall
```

See `DAEMON.md` for full daemon management documentation.

## Database Initialization

On first startup, the server automatically:

1. Creates `claude-sessions.db` (SQLite)
2. Creates tables: `users`, `user_project_access`, `projects`, `session_history`
3. Creates default admin user: `admin` / `admin`

### Custom Database Path

Currently hardcoded to `claude-sessions.db` in project root. To change:

1. Edit `src/server.ts` line 53:
   ```typescript
   const db = new Database('/custom/path/database.db');
   ```
2. Rebuild and restart

## Security Checklist

### Before Production

- [ ] Change default admin password immediately
- [ ] Enable HTTPS (via reverse proxy)
- [ ] Set `NODE_ENV=production`
- [ ] Use strong passwords for admin accounts
- [ ] Configure proper logging and monitoring
- [ ] Set up database backups
- [ ] Review and disable unnecessary API endpoints
- [ ] Implement rate limiting (use reverse proxy)
- [ ] Enable CORS restrictions (configure origin)
- [ ] Use environment variables for secrets

### Reverse Proxy Setup (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # Reverse proxy to Bun server
    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://localhost:3002;
        # ... same headers as above
    }
}
```

## Database Backups

### Manual Backup

```bash
sqlite3 claude-sessions.db ".backup /path/to/backup.db"
# or
cp claude-sessions.db ./backups/claude-sessions-$(date +%s).db
```

### Automated Backup (Cron)

```bash
# Add to crontab -e (daily at 2 AM)
0 2 * * * cd /path/to/claude-ui-poc && sqlite3 claude-sessions.db ".backup ./backups/claude-sessions-\$(date +\%Y-\%m-\%d).db"
```

### Backup Retention

```bash
# Keep last 30 days of backups
find ./backups -name "claude-sessions-*.db" -mtime +30 -delete
```

## Logging

### Log Files

- **Console**: Real-time logs when running in foreground
- **File**: `server.log` (appended, all API calls + auth events)

Example log entry:
```
[2026-05-06T17:14:57.890Z] [LOGIN] Attempting login for username: admin
[2026-05-06T17:14:57.900Z] [SESSION] Created session c3e59f24-2cc9-44b1-b173-5f60ec42ce38 for user admin (admin)
```

### Log Rotation (Logrotate)

Create `/etc/logrotate.d/claude-ui-poc`:

```
/path/to/claude-ui-poc/server.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 jarancibia jarancibia
}
```

Run: `sudo logrotate -f /etc/logrotate.d/claude-ui-poc`

## Monitoring

### Health Check

```bash
curl http://localhost:3000/
# Returns: HTML (not 404)

curl http://localhost:3000/api/auth/me
# Returns: 401 (when not logged in, which is expected)
```

### Process Monitoring

With systemd:

```bash
# Check if service is running
systemctl --user status claude-ui-poc

# Auto-restart on failure
bin/claude-ui-poc status
```

### Database Size Monitoring

```bash
# Check DB size
ls -lh claude-sessions.db

# Count records
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM sessions_history;"
```

If DB grows too large, prune old sessions:

```bash
# Delete sessions older than 90 days
sqlite3 claude-sessions.db \
  "DELETE FROM session_history WHERE created_at < datetime('now', '-90 days');"
```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>

# Or use different port
PORT=3002 bun run start
```

### Claude CLI Not Found

```bash
# Install globally
bun install -g @anthropic-ai/claude-code

# Verify
claude --version

# Check credentials
cat ~/.claude/.credentials.json
```

### Database Locked

If you see "database is locked":

```bash
# Stop the server
bin/claude-ui-poc stop

# Check for processes holding lock
fuser claude-sessions.db

# Restart
bin/claude-ui-poc start
```

### High Memory Usage

Monitor with `top` or `htop`. If memory climbs:

1. Check `/api/sessions` endpoint (large response)
2. Prune old sessions from database
3. Restart server to clear in-memory cache

### Slow Sessions Loading

If `/api/sessions` is slow:

```bash
# Create index on project_id
sqlite3 claude-sessions.db "CREATE INDEX idx_session_project ON session_history(project_id);"

# Create index on created_at
sqlite3 claude-sessions.db "CREATE INDEX idx_session_created ON session_history(created_at);"
```

## Performance Tuning

### Bun Runtime Options

```bash
# Increase heap size (default: 512MB)
bun --max-old-space-size=2048 run start

# Enable extra optimizations
bun --production src/server.ts
```

### SQLite Optimizations

Enable in `src/server.ts` after creating database:

```typescript
db.exec("PRAGMA journal_mode = WAL;");      // Write-Ahead Logging
db.exec("PRAGMA synchronous = NORMAL;");     // Faster writes
db.exec("PRAGMA cache_size = -64000;");      // 64MB cache
db.exec("PRAGMA temp_store = MEMORY;");      // Use RAM for temp
```

### WebSocket Optimization

For many concurrent connections:

```bash
# Increase file descriptor limit
ulimit -n 65536

# Or permanent in systemd service:
# [Service]
# LimitNOFILE=65536
```

## Deployment Checklist

- [ ] Install dependencies: `bun install`
- [ ] Set up environment variables: `.env`
- [ ] Verify Claude CLI: `claude --version`
- [ ] Change default admin password
- [ ] Create backup directory: `mkdir backups`
- [ ] Start server: `bin/claude-ui-poc install && start`
- [ ] Test login: `curl -X POST http://localhost:3000/api/auth/login ...`
- [ ] Configure reverse proxy (Nginx)
- [ ] Set up SSL/TLS certificates
- [ ] Configure log rotation
- [ ] Set up database backups
- [ ] Create monitoring/alerting
- [ ] Document any custom configuration
- [ ] Test database restore procedure
- [ ] Plan disaster recovery

## Scaling Considerations

Current implementation stores sessions in-memory (single server only).

For multiple servers:

1. **Database-Backed Sessions**: Save all sessions to SQLite, load on startup
2. **Redis Cache**: Share session store across servers
3. **Load Balancer**: Route users to consistent server (sticky sessions)

Minimal code changes needed; See `src/server.ts` `sessionStore` Map for refactoring points.

## Support

See [troubleshooting](./deployment.md#troubleshooting) for common issues.

For Claude CLI issues: `claude --help` or check [Claude Code docs](https://claude.com/claude-code).
