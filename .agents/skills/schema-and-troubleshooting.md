# Database Schema & Troubleshooting (Agent Reference)

## Complete Database Schema

### users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'developer',
  created_at INTEGER NOT NULL,
  created_by TEXT,
  last_login INTEGER,
  is_active INTEGER DEFAULT 1
);

CREATE UNIQUE INDEX idx_users_username ON users(username);
```

**Fields**:
- `id`: UUID primary key
- `username`: Unique username (required)
- `password_hash`: SHA-256 hash (required)
- `role`: 'admin' or 'developer' (default: 'developer')
- `created_at`: Unix timestamp (required)
- `created_by`: Who created this user (optional)
- `last_login`: Unix timestamp (optional, updated on login)
- `is_active`: 1=active, 0=soft-deleted (default: 1)

**Sample Query**:
```sql
SELECT id, username, role FROM users WHERE is_active = 1;
```

### user_project_access

```sql
CREATE TABLE user_project_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  UNIQUE(user_id, project_id)
);

CREATE INDEX idx_access_user ON user_project_access(user_id);
CREATE INDEX idx_access_project ON user_project_access(project_id);
```

**Fields**:
- `id`: UUID primary key
- `user_id`: References users.id (required)
- `project_id`: References projects.id (required)
- `granted_at`: Unix timestamp (required)
- `granted_by`: Who granted (usually 'admin')
- Constraint: Unique per (user_id, project_id) pair

**Sample Query**:
```sql
-- Get all projects for a user
SELECT p.id, p.name FROM projects p
JOIN user_project_access upa ON p.id = upa.project_id
WHERE upa.user_id = '<user-id>';

-- Get all users for a project
SELECT u.username FROM users u
JOIN user_project_access upa ON u.id = upa.user_id
WHERE upa.project_id = '<project-id>';
```

### projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  cwd TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_projects_name ON projects(name);
```

**Fields**:
- `id`: UUID primary key
- `name`: Project name (unique, required)
- `cwd`: Working directory path (required)
- `created_at`: Unix timestamp
- `last_used`: Unix timestamp (updated on project access)

**Sample Query**:
```sql
-- List all projects with usage
SELECT name, cwd, last_used FROM projects ORDER BY last_used DESC;
```

### session_history

```sql
CREATE TABLE session_history (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'sonnet',
  initial_prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  total_cost REAL DEFAULT 0,
  status TEXT DEFAULT 'completed',
  cards TEXT,
  conversation_history TEXT,
  events TEXT,
  project_id TEXT DEFAULT 'default',
  cwd TEXT,
  user_id TEXT
);

CREATE INDEX idx_sessions_project ON session_history(project_id);
CREATE INDEX idx_sessions_user ON session_history(user_id);
CREATE INDEX idx_sessions_created ON session_history(created_at DESC);
```

**Fields**:
- `id`: Session UUID
- `name`: Session name
- `model`: Claude model used (e.g., 'opus-4-6', 'sonnet')
- `initial_prompt`: Original user prompt
- `created_at`: Unix timestamp
- `last_accessed`: Unix timestamp
- `total_cost`: Cost in USD
- `status`: 'executing', 'completed', 'error'
- `cards`: JSON array of Kanban cards (stored as string)
- `conversation_history`: JSON array (stored as string)
- `events`: JSON array of stream events (stored as string)
- `project_id`: Which project executed this
- `cwd`: Working directory snapshot
- `user_id`: Who created session

**Sample Query**:
```sql
-- Get sessions for user
SELECT id, name, total_cost FROM session_history WHERE user_id = '<user-id>';

-- Get sessions by project
SELECT id, name, status FROM session_history WHERE project_id = '<project-id>';

-- Most expensive sessions
SELECT name, total_cost FROM session_history ORDER BY total_cost DESC LIMIT 10;
```

## Common Database Operations

### Count Records

```bash
# Total users
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM users;"

# Active users
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM users WHERE is_active = 1;"

# Projects
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM projects;"

# User-project assignments
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM user_project_access;"

# Sessions
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM session_history;"
```

### Query Examples

```bash
# Find user by username
sqlite3 claude-sessions.db "SELECT id, role FROM users WHERE username = 'alice';"

# List all users with their projects
sqlite3 claude-sessions.db << 'EOF'
SELECT u.username, u.role, p.name
FROM users u
LEFT JOIN user_project_access upa ON u.id = upa.user_id
LEFT JOIN projects p ON upa.project_id = p.id
ORDER BY u.username;
EOF

# Find expensive sessions
sqlite3 claude-sessions.db "SELECT name, total_cost FROM session_history WHERE total_cost > 0.01 ORDER BY total_cost DESC;"

# Sessions by user
sqlite3 claude-sessions.db "SELECT user_id, COUNT(*) FROM session_history GROUP BY user_id;"
```

### Data Modifications

```bash
# Update user role
sqlite3 claude-sessions.db "UPDATE users SET role = 'admin' WHERE username = 'alice';"

# Grant project access
sqlite3 claude-sessions.db << 'EOF'
INSERT INTO user_project_access (id, user_id, project_id, granted_at, granted_by)
VALUES ('new-uuid', 'user-uuid', 'project-uuid', strftime('%s000', 'now'), 'admin');
EOF

# Revoke project access
sqlite3 claude-sessions.db "DELETE FROM user_project_access WHERE user_id = 'user-uuid' AND project_id = 'project-uuid';"

# Deactivate user (soft delete)
sqlite3 claude-sessions.db "UPDATE users SET is_active = 0 WHERE username = 'alice';"

# Delete old sessions (older than 90 days)
sqlite3 claude-sessions.db "DELETE FROM session_history WHERE created_at < strftime('%s000', 'now', '-90 days');"
```

## Troubleshooting Procedures

### Problem: User Can't Login

**Step 1: Verify User Exists**
```bash
sqlite3 claude-sessions.db "SELECT username, is_active, role FROM users WHERE username = 'alice';"
```

**Step 2: Check is_active Flag**
```bash
# If is_active = 0, user is deactivated
# Re-activate:
sqlite3 claude-sessions.db "UPDATE users SET is_active = 1 WHERE username = 'alice';"
```

**Step 3: Check Server Logs**
```bash
tail -f server.log | grep LOGIN
# Should see: [LOGIN] User found: alice, verifying password...
# If NOT, user doesn't exist in DB
```

**Step 4: Verify Password Hash**
```bash
# Can't reverse hash, but can test:
bun bin/create-user test_verify test_pass123 developer
# Try login with test_verify / test_pass123
# If works: hash algorithm is correct
# If fails: mismatch in hashing implementation
```

### Problem: 401 "Session not found" on Every Request

**Step 1: Check Server Logs**
```bash
tail -f server.log | grep SESSION
# Should see: [SESSION] Looking up session <uuid>. Store has N sessions
# If "NOT FOUND": Session not in serverSessions Map
```

**Step 2: Verify Cookie Format**
```bash
curl -v http://localhost:3000/api/auth/me
# Check response headers for Set-Cookie
# Check request headers for Cookie being sent
```

**Step 3: Check Session Expiration**
```bash
# Sessions expire after 24 hours
# Current time - session creation time > 86400000 ms ?
# If yes: Session expired, login again
```

**Step 4: Check Server Time Sync**
```bash
# Server uses Date.now() for expiration
# If server time is wrong, sessions may instantly expire
date
# Compare with server logs [TIMESTAMP]
```

### Problem: User Sees Projects They Shouldn't

**Step 1: Check Database Access**
```bash
sqlite3 claude-sessions.db << 'EOF'
SELECT u.username, p.name, upa.id
FROM users u
LEFT JOIN user_project_access upa ON u.id = upa.user_id
LEFT JOIN projects p ON upa.project_id = p.id
WHERE u.username = 'alice';
EOF
# Should only show alice's granted projects
```

**Step 2: Check API Response**
```bash
curl -b cookies.txt http://localhost:3000/api/projects | jq '.projects[].name'
# Should only show accessible projects
```

**Step 3: Check Server-Side Filtering**
```bash
# In logs, search for:
grep '\[AUTH/ME\]' server.log | tail -1
# Should show: projects: [<only-accessible-ids>]
```

**Step 4: Clear Browser Cache**
```bash
# Frontend may cache all projects
# Clear localStorage: DevTools → Application → Local Storage → Clear All
# Refresh page
```

### Problem: High Database Size

**Step 1: Check Size**
```bash
ls -lh claude-sessions.db
# If > 100MB, time to cleanup
```

**Step 2: Identify Large Tables**
```bash
sqlite3 claude-sessions.db << 'EOF'
SELECT name, (SELECT COUNT(*) FROM
  (SELECT SUBSTR(sql,1,100) FROM sqlite_master WHERE sql LIKE 'CREATE TABLE ' || name)
) as count
FROM sqlite_master
WHERE type='table'
ORDER BY count DESC;
EOF
```

**Step 3: Prune Old Sessions**
```bash
# Delete sessions older than 1 year
sqlite3 claude-sessions.db \
  "DELETE FROM session_history WHERE created_at < strftime('%s000', 'now', '-365 days');"

# Check rows deleted
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM session_history;"
```

**Step 4: Optimize Database**
```bash
# Run VACUUM to reclaim space
sqlite3 claude-sessions.db "VACUUM;"

# Check new size
ls -lh claude-sessions.db
```

### Problem: Slow Queries

**Step 1: Create Indexes**
```bash
sqlite3 claude-sessions.db << 'EOF'
CREATE INDEX IF NOT EXISTS idx_sessions_user ON session_history(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON session_history(project_id);
CREATE INDEX IF NOT EXISTS idx_access_user ON user_project_access(user_id);
CREATE INDEX IF NOT EXISTS idx_access_project ON user_project_access(project_id);
EOF
```

**Step 2: Enable Query Profiling**
```bash
# Add to src/server.ts:
db.exec("PRAGMA query_only = 1;");

# Then run query and check time
time sqlite3 claude-sessions.db "SELECT * FROM session_history LIMIT 1000;"
```

### Problem: Database Locked

**Step 1: Identify Lock Holder**
```bash
# Check what process holds lock
fuser claude-sessions.db

# Get process info
ps aux | grep <PID>
```

**Step 2: Force Release**
```bash
# Forcefully kill the holding process
kill -9 <PID>

# Restart server
```

**Step 3: Verify Database**
```bash
# Check database integrity
sqlite3 claude-sessions.db "PRAGMA integrity_check;"

# If errors, restore from backup
cp ./backups/claude-sessions-<date>.db claude-sessions.db
```

## Backup & Restore

### Backup

```bash
# Manual backup
sqlite3 claude-sessions.db ".backup /path/to/backup.db"

# Or simply copy
cp claude-sessions.db ./backups/claude-sessions-$(date +%Y-%m-%d).db
```

### Restore

```bash
# Stop server
bin/claude-ui-poc stop

# Restore from backup
cp ./backups/claude-sessions-2026-05-06.db claude-sessions.db

# Verify
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM users;"

# Start server
bin/claude-ui-poc start
```

## Health Checks

### Automated Health Check Script

```bash
#!/bin/bash
# Save as check-health.sh

# Check database
if ! sqlite3 claude-sessions.db "SELECT 1;" > /dev/null; then
  echo "ERROR: Database corrupted"
  exit 1
fi

# Check API
if ! curl -s http://localhost:3000/ > /dev/null; then
  echo "ERROR: Server not responding"
  exit 1
fi

# Check users
COUNT=$(sqlite3 claude-sessions.db "SELECT COUNT(*) FROM users WHERE is_active = 1;")
echo "Active users: $COUNT"

# Check sessions
COUNT=$(sqlite3 claude-sessions.db "SELECT COUNT(*) FROM session_history;")
echo "Total sessions: $COUNT"

# Check database size
SIZE=$(ls -lh claude-sessions.db | awk '{print $5}')
echo "Database size: $SIZE"

echo "Health check passed"
exit 0
```

## Monitoring Queries

```bash
# Monitor in real-time
watch -n 5 "sqlite3 claude-sessions.db 'SELECT COUNT(*) as sessions, AVG(total_cost) as avg_cost FROM session_history;'"

# Check top users by session count
sqlite3 claude-sessions.db "SELECT user_id, COUNT(*) as count FROM session_history GROUP BY user_id ORDER BY count DESC LIMIT 5;"

# Check total cost by user
sqlite3 claude-sessions.db "SELECT user_id, SUM(total_cost) as total FROM session_history GROUP BY user_id ORDER BY total DESC LIMIT 5;"

# Check concurrent sessions
sqlite3 claude-sessions.db "SELECT COUNT(*) FROM session_history WHERE status = 'executing';"
```
