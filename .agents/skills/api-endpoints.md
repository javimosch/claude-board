# API Endpoints Reference (Agent-Oriented)

## Endpoint Listing

| Method | Path | Auth | Role | Response |
|--------|------|------|------|----------|
| POST | `/api/auth/login` | No | — | 200: {success, username, role, projects} |
| POST | `/api/auth/logout` | Yes | — | 200: {success} |
| GET | `/api/auth/me` | Yes | — | 200: {authenticated, userId, username, role, projects} |
| GET | `/api/projects` | Yes | Both | 200: {projects[]} |
| POST | `/api/projects` | Yes | Admin | 201: {id, name, cwd, created_at, last_used} |
| PUT | `/api/projects/:id` | Yes | Admin | 200: {id, name, cwd, created_at, last_used} |
| DELETE | `/api/projects/:id` | Yes | Admin | 200: {success} |
| POST | `/api/execute` | Yes | Both | 200: {sessionId, status} |
| POST | `/api/plan` | Yes | Both | 200: {sessionId, status, plannedTools[]} |
| GET | `/api/sessions` | Yes | Both | 200: {sessions[]} |
| GET | `/api/session/:id` | Yes | Both | 200: {id, status, prompt, cards[], totalCost, ...} |
| WS | `/ws/:sessionId` | Yes | Both | Streaming: {type, card, ...} |

## Endpoint Details

### Authentication Endpoints

**POST /api/auth/login**
- **Input**: {username, password}
- **Output**: {success, username, role, projects}
- **Cookies**: Sets `session` (HttpOnly, Secure, SameSite=Lax, Max-Age=86400)
- **Error**: 401 on invalid credentials

**POST /api/auth/logout**
- **Input**: —
- **Output**: {success}
- **Cookies**: Clears `session`
- **Auth Required**: Yes

**GET /api/auth/me**
- **Input**: Cookie session
- **Output**: {authenticated, userId, username, role, projects[]}
- **Auth Required**: Yes
- **Error**: 401 if session invalid/expired

### Project Endpoints

**GET /api/projects**
- **Input**: Cookie session
- **Output**: {projects[{id, name, cwd, created_at, last_used}]}
- **Access**: Admin sees all; Developer sees only accessible
- **Auth Required**: Yes

**POST /api/projects**
- **Input**: {name, cwd}
- **Output**: {id, name, cwd, created_at, last_used}
- **Auth Required**: Yes (Admin only)
- **Error**: 400 if missing fields, 403 if not admin

**PUT /api/projects/:id**
- **Input**: {name?, cwd?}
- **Output**: {id, name, cwd, created_at, last_used}
- **Auth Required**: Yes (Admin only)
- **Error**: 404 if not found, 403 if not admin

**DELETE /api/projects/:id**
- **Input**: —
- **Output**: {success}
- **Auth Required**: Yes (Admin only)
- **Error**: 403 if default project, 404 if not found

### Execution Endpoints

**POST /api/execute**
- **Input**: {prompt, projectId}
- **Output**: {sessionId, status}
- **Auth Required**: Yes
- **Access Check**: User must have access to projectId
- **Status**: "executing"
- **Error**: 403 if no project access

**POST /api/plan**
- **Input**: {prompt, projectId}
- **Output**: {sessionId, status, plannedTools[]}
- **Auth Required**: Yes
- **Status**: "planning"
- **plannedTools**: Array of {id, name, description, input}

### Session Endpoints

**GET /api/sessions**
- **Input**: ?projectId (optional)
- **Output**: {sessions[{id, name, status, prompt, created_at, totalCost, projectId}]}
- **Auth Required**: Yes
- **Filtering**: Admin sees all; Developer sees own sessions
- **Query Params**:
  - `projectId`: Filter by project (optional)

**GET /api/session/:id**
- **Input**: :id path param
- **Output**: {id, status, prompt, cards[], totalCost, startTime, endTime?, projectId, ...}
- **Auth Required**: Yes
- **Access Check**: Admin can see all; Developer can only see own
- **Error**: 404 if not found, 403 if no access

### WebSocket Endpoints

**WS /ws/:sessionId**
- **Input**: :sessionId path param
- **Messages**: {type, card?, cardId?, session_id?, ...}
- **Auth Required**: Yes (via session cookie)
- **Message Types**:
  - `card:add` - payload: {card}
  - `card:update` - payload: {card}
  - `card:move` - payload: {cardId, column}
  - `card:remove` - payload: {cardId}
  - `session:start` - payload: {session_id}
  - `session:end` - payload: {session_id, totalCost}
  - `approval:required` - payload: {planned_tools[]}

## Error Codes

| Code | Message | Cause | Fix |
|------|---------|-------|-----|
| 400 | Invalid JSON/missing field | Malformed request | Check request body |
| 401 | Not authenticated/Session expired | No valid session | Login with /api/auth/login |
| 403 | Insufficient permissions | User lacks role/access | Request admin grant access |
| 404 | Not found | Resource doesn't exist | Check IDs are correct |
| 500 | Server error | Internal issue | Check server logs |

## Cookie Format

**session cookie**:
```
session=<uuid>
Secure: true (HTTPS only)
HttpOnly: true (JavaScript blocked)
SameSite: Lax (CSRF protection)
Max-Age: 86400 (24 hours)
Path: /
```

## Request/Response Content-Type

- **Requests**: `application/json` (for POST/PUT)
- **Responses**: `application/json`
- **WebSocket**: Raw JSON messages (no Content-Type)

## Rate Limiting

Not built-in. Recommended: 10 req/s per IP at reverse proxy.

## Pagination

Not supported in current version.

## CORS

Not enabled by default. Configure in `src/server.ts` if needed.

## Examples (Curl)

**Login**:
```bash
curl -c /tmp/c.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

**Get Projects**:
```bash
curl -b /tmp/c.txt http://localhost:3000/api/projects
```

**Execute**:
```bash
curl -b /tmp/c.txt -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt":"hello","projectId":"<uuid>"}'
```

**WebSocket (JavaScript)**:
```javascript
const ws = new WebSocket('ws://localhost:3000/ws/<sessionId>');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```
