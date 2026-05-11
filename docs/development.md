# Development Guide

## Project Structure

```
claude-ui-poc/
├── src/
│   ├── server.ts           # Main backend (Bun/Hono)
│   └── types.ts            # TypeScript interfaces
├── bin/
│   ├── create-user         # CLI tool for creating users
│   └── claude-ui-poc       # Daemon management script
├── docs/
│   ├── authentication.md   # User & project management
│   ├── deployment.md       # Production setup
│   ├── development.md      # This file
│   └── api.md              # API reference
├── .agents/
│   └── skills/             # Agent-optimized documentation
├── package.json            # Bun dependencies
├── tsconfig.json           # TypeScript config
├── README.md               # Main documentation
└── claude-sessions.db      # SQLite database (auto-created)
```

## Local Development Setup

### Prerequisites

- Bun 1.0+ or Node.js 20+
- Claude CLI: `bun install -g @anthropic-ai/claude-code`
- Claude credentials: `~/.claude/.credentials.json`
- Text editor or IDE with TypeScript support

### Initial Setup

```bash
# Clone/navigate to project
cd claude-ui-poc

# Install dependencies
bun install

# Start dev server
bun run dev
```

Server runs at `http://localhost:3000` with file watching.

## Code Organization

### `src/server.ts` (Main Backend)

**Size**: ~2500 lines (monolithic, can be split into modules)

**Main Sections**:

1. **Imports & Logging** (lines 1-20)
   - Hono framework, SQLite, Node modules
   - `log()` function for file + console output

2. **Password Hashing** (lines 22-35)
   - `hashPassword()` - SHA-256 with salt
   - `verifyPassword()` - Compare hashes

3. **Database Setup** (lines 49-120)
   - SQLite initialization
   - Schema creation: `users`, `user_project_access`, `projects`, `session_history`
   - Default admin user creation

4. **User Management** (lines 130-250)
   - `getUserByUsername()` - Fetch user from DB
   - `getUserById()` - Fetch by ID
   - `createUser()` - Insert new user
   - `listUsers()` - Get all users
   - `grantProjectAccess()` - Many-to-many relationship
   - `revokeProjectAccess()` - Delete relationship
   - `getUserProjects()` - List user's accessible projects
   - `getProjectUsers()` - List users with project access
   - `deleteUser()` - Soft delete
   - `updateLastLogin()` - Audit trail

5. **Session Management** (lines 250-350)
   - `serverSessions` - In-memory Map
   - `createServerSession()` - Create + store
   - `getServerSession()` - Retrieve + refresh expiration
   - `destroyServerSession()` - Remove
   - `getSessionIdFromCookie()` - Parse from HTTP header
   - `getCurrentUser()` - Get from session
   - Middleware helpers: `requireAuth()`, `requireAdmin()`, `hasProjectAccess()`

6. **Event Parsing** (lines 350-400)
   - `parseJsonlStream()` - Parse Claude CLI output line-by-line
   - Error handling for malformed JSON

7. **Kanban Converter** (lines 400-650)
   - `KanbanConverter` class
   - `convert()` - Transform stream events to Kanban cards
   - Event type handling: thinking, tool_use, tool_result, text, result

8. **Project Management** (lines 650-800)
   - `getProjects()` - List all
   - `createProject()` - Create new
   - `updateProject()` - Modify name/cwd
   - `deleteProject()` - Remove

9. **API Endpoints** (lines 800-2000)
   - Authentication: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
   - Projects: `/api/projects` (GET, POST), `/api/projects/:id` (PUT, DELETE)
   - Execution: `/api/execute`, `/api/plan`
   - Sessions: `/api/sessions`, `/api/session/:id`
   - WebSocket: `/ws/:sessionId`

10. **React Components** (lines 2000-2500)
    - `LoginScreen` - Authentication UI
    - `App` - Main layout
    - `KanbanBoard` - Card visualization
    - `ProjectSelector` - Project list & switching
    - `SessionSidebar` - Session history

11. **Server Startup** (lines 2500-end)
    - Export Hono app for Bun
    - Startup logging

### `src/types.ts` (Type Definitions)

Key interfaces:

```typescript
// Stream events from Claude CLI
interface StreamEvent {
  type: 'system' | 'assistant' | 'user' | 'result' | 'thinking';
}

// Kanban card data
interface KanbanCard {
  id: string;
  column: 'THINKING' | 'ACTIONS' | 'FEEDBACK' | 'COMPLETE';
  title: string;
  content: string;
  status: 'pending' | 'in-progress' | 'success' | 'error';
}

// Server-side session
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

### `bin/create-user` (CLI Tool)

Interactive tool for creating users:

1. Parse CLI arguments or prompt interactively
2. Hash password (SHA-256 with salt)
3. Insert into `users` table
4. Insert many-to-many relationships in `user_project_access`
5. Output credentials for sharing

## Database Schema

### `users` Table

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

### `user_project_access` Table

```sql
CREATE TABLE user_project_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  UNIQUE(user_id, project_id)
);
```

### `projects` Table

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  cwd TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
```

### `session_history` Table

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
```

## Common Development Tasks

### Adding a New API Endpoint

1. **Define route in `src/server.ts`**:

```typescript
app.post('/api/myendpoint', async (c) => {
  // Check authentication
  const session = getCurrentUser(c);
  if (!session) {
    c.status(401);
    return c.json({ error: 'Not authenticated' });
  }

  // Parse request
  const { data } = await c.req.json();

  // Process
  // ...

  // Return response
  return c.json({ result: 'success' });
});
```

2. **Add TypeScript interface to `src/types.ts`** (if needed)

3. **Test with curl**:

```bash
curl -X POST http://localhost:3000/api/myendpoint \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<sessionId>" \
  -d '{"data":"value"}'
```

### Adding Access Control

Require authentication + admin role:

```typescript
const session = getCurrentUser(c);
if (!requireAdmin(session, c)) {
  return c.json({ error: 'Admin only' }, 403);
}
```

Require project access:

```typescript
const projectId = c.req.param('projectId');
if (!hasProjectAccess(session, projectId)) {
  c.status(403);
  return c.json({ error: 'No access to project' });
}
```

### Querying the Database

```typescript
// Get a single record
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

// Get multiple records
const projects = db.prepare('SELECT * FROM projects').all();

// Insert
db.prepare('INSERT INTO users (id, username, ...) VALUES (?, ?, ...)')
  .run(userId, username, ...);

// Update
db.prepare('UPDATE users SET last_login = ? WHERE id = ?')
  .run(Date.now(), userId);

// Delete
db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
```

### Adding Logging

Use the `log()` function for both console + file output:

```typescript
log('[MYFEATURE] Something important happened');
```

Appears in console AND `server.log`:

```
[2026-05-06T17:14:57.890Z] [MYFEATURE] Something important happened
```

### Testing Authentication Flow

```bash
# 1. Login
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# 2. Check session
curl -b cookies.txt http://localhost:3000/api/auth/me

# 3. Call protected endpoint
curl -b cookies.txt http://localhost:3000/api/projects

# 4. Logout
curl -b cookies.txt -X POST http://localhost:3000/api/auth/logout
```

### Creating Test Users

```bash
# Interactive
bun bin/create-user

# Or directly
bun bin/create-user testuser testpass developer 1 2
```

Then login in browser or via curl.

## Debugging

### Check Logs

```bash
# View real-time logs
tail -f server.log

# Filter by type
grep '\[LOGIN\]' server.log
grep '\[SESSION\]' server.log
grep '\[ERROR\]' server.log
```

### Browser DevTools

1. Open DevTools (F12)
2. **Network tab**: See API calls, cookies, response status
3. **Application tab**: View session cookie details
4. **Console tab**: See JavaScript errors

### Database Inspection

```bash
# Query users
sqlite3 claude-sessions.db "SELECT username, role FROM users;"

# Check sessions
sqlite3 claude-sessions.db "SELECT sessionId, username FROM serverSessions LIMIT 10;"

# View project access
sqlite3 claude-sessions.db \
  "SELECT u.username, p.name FROM users u \
   LEFT JOIN user_project_access upa ON u.id = upa.user_id \
   LEFT JOIN projects p ON upa.project_id = p.id;"
```

### Testing with cURL

```bash
# Create user
bun bin/create-user alice alice123 developer 1

# Login (get session cookie)
COOKIE=$(curl -c /tmp/c.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"alice123"}' \
  | jq -r '.sessionId')

# Use session
curl -b /tmp/c.txt http://localhost:3000/api/auth/me

# Check projects (should be filtered)
curl -b /tmp/c.txt http://localhost:3000/api/projects | jq '.'
```

## Performance Profiling

### Startup Time

```bash
time bun run dev
```

### Memory Usage

```bash
# While server is running
top -p $(pgrep -f "bun run")
```

### API Response Time

```bash
curl -w '\nTime: %{time_total}s\n' http://localhost:3000/api/projects
```

### Database Query Performance

Enable logging in SQLite:

```typescript
db.exec("PRAGMA query_only = 1;"); // Read-only mode for testing
```

## Code Style

- **Language**: TypeScript (strict mode)
- **Framework**: Bun (Hono web framework)
- **Formatting**: No enforced formatter (keep consistent)
- **Error Handling**: Try-catch around async operations
- **Logging**: Use `log()` function for important events
- **Comments**: Add for complex logic, not obvious code

## Testing

### Unit Tests (Future)

No tests currently implemented. Consider adding:

```typescript
import { describe, it, expect } from 'bun:test';

describe('authentication', () => {
  it('should hash passwords consistently', () => {
    const hash1 = await hashPassword('test');
    const hash2 = await hashPassword('test');
    expect(hash1).toBe(hash2);
  });
});
```

Run with: `bun test`

### Integration Tests (Manual)

See [Deployment Guide - Testing](./deployment.md#testing) for manual test cases.

## Known Issues

1. **Monolithic server.ts**: All code in one file (~2500 lines). Split into modules for better maintainability.
2. **No async transaction support**: SQLite sync API; add async wrapper for better concurrency.
3. **No query caching**: Frequent lookups re-query DB. Add Redis cache layer.
4. **Session only in-memory**: Lost on restart. Add DB persistence.
5. **No rate limiting**: Implement at reverse proxy level or in middleware.

## Future Improvements

- [ ] Split `src/server.ts` into modules: `auth.ts`, `projects.ts`, `sessions.ts`, etc.
- [ ] Add async database layer (better concurrency)
- [ ] Add Redis session store for multi-server deployments
- [ ] Implement comprehensive unit tests
- [ ] Add type validation for API requests (Zod/Valibot)
- [ ] Add GraphQL API alternative to REST
- [ ] Implement WebSocket authentication
- [ ] Add CORS configuration
- [ ] Add OpenAPI/Swagger documentation

## Getting Help

- **Bun Docs**: https://bun.sh
- **Hono Docs**: https://hono.dev
- **SQLite Docs**: https://www.sqlite.org/docs.html
- **TypeScript Docs**: https://www.typescriptlang.org/docs/
