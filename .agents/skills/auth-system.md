# Authentication System (Agent Reference)

## System Architecture

```
User Login
  ↓
POST /api/auth/login {username, password}
  ↓
[Server: Hash password (SHA-256 + salt)]
[Server: Verify against DB hash]
  ↓
[Create session in serverSessions Map]
  ↓
[Set HTTP-only session cookie]
  ↓
Response + Cookie: session=<uuid>
  ↓
Browser stores cookie, auto-sends on future requests
  ↓
[Server validates session on each request]
```

## Session Flow

### 1. Create Session
```typescript
// In memory
const session = {
  sessionId: uuid(),
  userId: user.id,
  username: user.username,
  role: user.role, // 'admin' | 'developer'
  accessibleProjectIds: [project1, project2, ...],
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000 // 24 hours
};
serverSessions.set(sessionId, session);
```

### 2. Send to Client
```
Set-Cookie: session=<sessionId>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400
```

### 3. Validate on Request
```
Request with Cookie: session=<sessionId>
  ↓
Extract sessionId from cookie header
  ↓
serverSessions.get(sessionId)
  ↓
If found && !expired: Allow request
If not found || expired: Return 401
```

### 4. Auto-Refresh
```
On each valid request:
  expiresAt = Date.now() + 86400000 // Reset timer
  // No response to client, sliding window
```

## Database Schema

### Users Table
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
```

### User-Project Access
```sql
CREATE TABLE user_project_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  UNIQUE(user_id, project_id)
);
```

## Password Hashing

**Algorithm**: SHA-256 + salt

```typescript
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Hash Properties**:
- Input: password + 'salt' (fixed salt)
- Output: 64-character hex string
- Deterministic: Same input = Same hash

**Verification**:
```typescript
async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(plaintext);
  return computed === hash;
}
```

## Access Control Matrix

| Resource | Admin | Developer (Grant) | Developer (No Grant) |
|----------|-------|-------------------|----------------------|
| `/api/projects` | All | Accessible only | None |
| `/api/projects/:id` (PUT/DELETE) | ✓ | ✗ | ✗ |
| `/api/execute` | Own + all | Own | ✗ |
| `/api/sessions` | All | Own | ✗ |

## Access Control Checks

### Per-Endpoint

**GET /api/projects**:
```
if (role === 'admin') return ALL projects
if (role === 'developer') return projects WHERE id IN accessibleProjectIds
```

**POST /api/execute**:
```
if (!session) return 401
if (!hasProjectAccess(session, projectId)) return 403
allow execution
```

**GET /api/sessions**:
```
if (role === 'admin') return ALL sessions
if (role === 'developer') return sessions WHERE user_id === session.userId
```

## User Creation Flow

```
bun bin/create-user [username] [password] [role] [projectNumbers]
  ↓
[Generate random password if not provided]
[Hash password]
  ↓
INSERT INTO users (id, username, password_hash, role, ...)
  ↓
FOR EACH projectNumber:
  INSERT INTO user_project_access (user_id, project_id, ...)
  ↓
OUTPUT: username, password (plaintext), role, projects
```

## Session Lookup Details

```typescript
function getServerSession(sessionId: string): ServerSession | null {
  // 1. Get from Map
  const session = serverSessions.get(sessionId);

  // 2. Check exists
  if (!session) {
    log('[SESSION] Session NOT FOUND');
    return null;
  }

  // 3. Check expiration
  if (Date.now() > session.expiresAt) {
    log('[SESSION] Session EXPIRED');
    serverSessions.delete(sessionId); // Cleanup
    return null;
  }

  // 4. Refresh expiration (sliding window)
  session.expiresAt = Date.now() + SESSION_DURATION;

  // 5. Return valid session
  return session;
}
```

## Cookie Parsing from Request

```typescript
function getSessionIdFromCookie(c: any): string | null {
  // Get raw cookie header
  const cookieHeader = c.req.header('cookie');
  // Example: "pb_session=xxx; session=yyy; other=zzz"

  // Extract session cookie only (avoid substring matches)
  const match = cookieHeader.match(/(^|;\s*)session=([^;]+)/);

  if (!match) return null;
  // match[2] is the session ID
  return match[2]; // 'yyy'
}
```

## Roles and Permissions

### Admin
- Can create/delete users
- Can grant/revoke project access
- Access to all projects
- See all sessions (all users)
- Can modify any project

### Developer
- Cannot manage users
- Cannot manage access
- Access only to granted projects
- See only own sessions
- Cannot modify projects

## Session Expiration

**Duration**: 24 hours (86400000 ms)

**Trigger**:
- On login: Set expiresAt = now + 24h
- On request: Refresh expiresAt = now + 24h

**Cleanup**:
- Automatic when session accessed after expiration
- Manual cleanup: `serverSessions.delete(sessionId)`

**Client Experience**:
- After 24h inactivity: 401 on next request
- User must login again
- No warning before expiration (current implementation)

## Multi-Server Deployment

**Current**: In-memory only (single server)

**For Multiple Servers**: Need shared session store

```typescript
// Option 1: Database
const session = db.prepare('SELECT * FROM sessions WHERE sessionId = ?').get(sessionId);

// Option 2: Redis
const session = await redis.get(`session:${sessionId}`);

// Option 3: Sticky sessions (load balancer)
// Route all requests from same client to same server
```

## Logging

All auth events logged to `server.log`:

```
[TIMESTAMP] [LOGIN] Attempting login for username: admin
[TIMESTAMP] [LOGIN] User found: admin, verifying password...
[TIMESTAMP] [LOGIN] Password match result: true
[TIMESTAMP] [SESSION] Created session <uuid> for user admin (admin)
[TIMESTAMP] [LOGIN] Cookie set: session=<uuid>; ...
[TIMESTAMP] [LOGIN] Login successful for user: admin
[TIMESTAMP] [AUTH/ME] Session lookup result: FOUND
```

## Default User

Created on first startup:
- **Username**: admin
- **Password**: admin
- **Role**: admin
- **Created**: Automatically during db.exec()

**Warning**: Change immediately in production!

## Security Considerations

### Current Implementation
- SHA-256 (acceptable for PoC)
- Fixed salt (weak)
- No password complexity rules
- No rate limiting
- No account lockout
- No 2FA

### Production Recommendations
- Use bcrypt (cost 10+)
- Dynamic salt per user
- Enforce password complexity
- Rate limit login (fail2ban)
- Account lockout after N attempts
- Add 2FA (TOTP, WebAuthn)
- Session revocation on logout
- HTTPS only (Secure flag)
- Audit log of all auth events

## Troubleshooting

### "Session not found" on /api/auth/me
**Cause**:
- Session expired (24h passed)
- Cookie not sent by client
- Session ID malformed

**Check**:
```bash
# Verify cookie is being sent
curl -v -b /tmp/cookies.txt http://localhost:3000/api/auth/me

# Check server logs for session lookup
tail -f server.log | grep SESSION
```

### "Invalid username or password"
**Cause**:
- Wrong password
- User doesn't exist
- Password hash mismatch

**Check**:
```bash
# Verify user exists
sqlite3 claude-sessions.db "SELECT * FROM users WHERE username = 'admin';"

# Check password hash (can't reverse)
# Create test user with known password
bun bin/create-user testuser test123 developer
```

### Cookie not persisting
**Cause**:
- JavaScript clearing cookies
- Browser privacy mode
- Cookie flags incorrect

**Check**:
```bash
# Verify Set-Cookie header
curl -v -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | grep Set-Cookie
```

Expected:
```
Set-Cookie: session=<uuid>; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400
```

## API Contract

| Endpoint | Returns Session? | Sets Cookie? | Requires Auth? |
|----------|------------------|--------------|-----------------|
| POST /login | No | Yes | No |
| POST /logout | No | Yes (clear) | Yes |
| GET /me | No | No | Yes |
| GET /projects | No | No | Yes |
| POST /execute | No | No | Yes |
| WS /ws/:id | No | No | Yes |
