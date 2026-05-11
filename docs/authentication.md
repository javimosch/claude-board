# Authentication & User Management

## Overview

The application uses a multi-user authentication system with role-based access control (RBAC) and project-level permissions.

## Roles

### Admin
- Full access to all projects
- Can create and manage developer accounts
- Can grant/revoke project access
- Can view all user sessions

### Developer
- Access only to projects explicitly granted by admin
- Can create and manage sessions within accessible projects
- Cannot create other users or manage project access
- Sessions filtered to show only own activity

## User Management

### Default Admin Account

On first startup, a default admin account is created:
- **Username**: `admin`
- **Password**: `admin`

⚠️ **For production**: Change this password immediately after first login.

### Creating Users

Use the `bin/create-user` CLI tool (admin only):

#### Interactive Mode

```bash
bun bin/create-user
```

Prompts:
1. Username (required, unique)
2. Role (admin or developer, default: developer)
3. Password (optional, generates secure 24-char password if skipped)
4. Project selection (number list, e.g., "1,3,5")

Example:
```
🔐 Create New User

Username: alice
Role (admin/developer) [developer]: developer
Password (press Enter for random):
Available projects:
  1. supercli (/home/user/projects/supercli)
  2. javika (/home/user/javika)

Select project numbers (comma-separated, or press Enter to skip): 1,2

✓ User created: alice
✓ Password: aBcDeFgHiJkLmNoPqRsT1234
✓ Projects: supercli, javika
```

#### Command Line Mode

```bash
bun bin/create-user <username> [password] [role] [projectNumbers...]
```

Examples:

```bash
# Create with random password
bun bin/create-user bob

# Create with specific password
bun bin/create-user bob SecurePass123 developer

# Create with specific password and project access (project numbers)
bun bin/create-user alice MyPassword123 developer 1 2 3

# Create admin user
bun bin/create-user charlie AdminPass456 admin
```

Parameters:
- `username` - Unique username (required)
- `password` - Custom password or leave empty for random (optional)
- `role` - `admin` or `developer` (default: developer)
- `projectNumbers` - Space-separated project numbers (default: none)

Projects are numbered 1..N based on creation order (see interactive mode for list).

### Deleting Users

Currently via database only:

```bash
sqlite3 claude-sessions.db "UPDATE users SET is_active = 0 WHERE username = 'alice';"
```

User accounts are soft-deleted (is_active = 0) to preserve audit history.

## Project Access Control

### Granting Access

Use the CLI tool during user creation (see above), or modify the database:

```bash
sqlite3 claude-sessions.db << 'EOF'
-- Get user and project IDs
SELECT id FROM users WHERE username = 'alice';
SELECT id, name FROM projects;

-- Grant access
INSERT INTO user_project_access (id, user_id, project_id, granted_at, granted_by)
VALUES ('uuid', 'user-id-here', 'project-id-here', datetime('now'), 'admin');
EOF
```

### Revoking Access

```bash
sqlite3 claude-sessions.db \
  "DELETE FROM user_project_access WHERE user_id = 'user-id' AND project_id = 'project-id';"
```

### Viewing User Permissions

```bash
sqlite3 claude-sessions.db << 'EOF'
SELECT u.username, u.role, p.name, p.id
FROM users u
LEFT JOIN user_project_access upa ON u.id = upa.user_id
LEFT JOIN projects p ON upa.project_id = p.id
ORDER BY u.username;
EOF
```

## Password Security

### Hashing Algorithm

Passwords are hashed using **SHA-256 with salt**:

```typescript
const encoder = new TextEncoder();
const data = encoder.encode(password + 'salt');
const hashBuffer = await crypto.subtle.digest('SHA-256', data);
```

⚠️ **Production Note**: For production, use bcrypt (cost 10+). SHA-256 is acceptable for PoC but not recommended for production.

### Password Requirements

Currently: No enforced requirements (accept any password).

For production, consider:
- Minimum 8 characters
- Mix of uppercase, lowercase, numbers, special chars
- Password history (prevent reuse)
- Forced change on first login

## Session Management

### Session Cookie

Sessions are managed via HTTP-only cookies:

```
Cookie: session=<uuid>
Flags: HttpOnly, Secure, SameSite=Lax
Expires: 24 hours from creation
```

**Security properties**:
- **HttpOnly**: Prevents JavaScript access (XSS protection)
- **Secure**: HTTPS only (production)
- **SameSite=Lax**: CSRF protection

### Session Expiration

Sessions automatically expire after **24 hours** of creation. Accessing any API endpoint refreshes the expiration (sliding window).

### Server-Side Session Store

Sessions are stored in-memory Map with optional database persistence:

```typescript
const sessionStore = new Map<string, ServerSession>();

interface ServerSession {
  sessionId: string;
  userId: string;
  username: string;
  role: 'admin' | 'developer';
  accessibleProjectIds: string[];
  createdAt: number;
  expiresAt: number;
}
```

**Persistence**: Sessions can optionally be saved to database for:
- Server restarts (load active sessions on startup)
- Multi-server deployments (shared session store)

Current implementation: In-memory only (sessions lost on restart).

## API Authentication

All endpoints except `/api/auth/login` and `/api/auth/logout` require authentication via session cookie.

### Login Flow

```
POST /api/auth/login
  ↓
[Verify username/password]
  ↓
[Create session in serverSessions Map]
  ↓
[Set HTTP-only session cookie]
  ↓
Response: {success, username, role, projects}
```

### Logout Flow

```
POST /api/auth/logout
  ↓
[Remove session from serverSessions Map]
  ↓
[Clear session cookie]
  ↓
Response: {success}
```

### Checking Authentication

```
GET /api/auth/me
  ↓
[Extract session ID from cookie]
  ↓
[Look up session in serverSessions Map]
  ↓
If found: {authenticated: true, userId, username, role, projects}
If not found: {authenticated: false} + 401 status
```

## Access Control Enforcement

### Per-Endpoint Checks

#### `/api/projects` (GET)

Returns different project lists based on role:
- **Admin**: All projects
- **Developer**: Only projects in user's `accessibleProjectIds`

#### `/api/execute`, `/api/plan` (POST)

Requires authentication + valid `projectId`:
- Check session exists
- Check user has access to requested projectId
- Allow execution if both pass

#### Project Modification (PUT, DELETE)

Admin-only endpoints (future implementation):
- `/api/projects/:id/grant/:userId`
- `/api/projects/:id/revoke/:userId`

### Session Data Attached to Requests

Each authenticated request has access to:

```typescript
const session = getCurrentUser(c); // Gets ServerSession from cookie
// session.userId, session.username, session.role, session.accessibleProjectIds
```

This enables per-user filtering and audit logging.

## Troubleshooting

### "Login error: Invalid username or password"

- Username doesn't exist: Create user with `bun bin/create-user`
- Password incorrect: Check password, reset via database if needed
- Hash mismatch: Verify password hashing (SHA-256) matches server implementation

### "Session not found or expired" (401 on API calls)

- Session cookie not sent: Check browser dev tools → Application → Cookies
- Session expired: Login again (24-hour expiration)
- Corrupted session ID in cookie: Clear cookies, login again

### User sees projects they shouldn't have access to

- **Cause**: Frontend displaying all projects (caching issue)
- **Fix**: Clear browser cache, refresh page, check `/api/projects` returns filtered list
- **Verify**: `curl http://localhost:3000/api/projects` with session cookie

### "Password match result: false" in logs

- Check password hash implementation matches between login and create-user
- Verify salt is consistent
- Re-create user account with known password

## Future Enhancements

- [ ] Password reset via email
- [ ] Multi-factor authentication (2FA)
- [ ] OAuth2 / OIDC integration
- [ ] Bcrypt password hashing (production)
- [ ] Password complexity requirements
- [ ] Session revocation on logout
- [ ] Audit log of all user actions
- [ ] Rate limiting on login attempts
- [ ] Account lockout after failed attempts
