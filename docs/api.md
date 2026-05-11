# API Reference

## Overview

Complete API documentation for the Claude Streaming Mode PoC with authentication and project-based access control.

**Base URL**: `http://localhost:3000` (adjust for your deployment)

**Authentication**: Session cookie (HTTP-only) required for most endpoints

## Authentication

### POST `/api/auth/login`

Login with username and password.

**Request**:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

**Body**:
```json
{
  "username": "string (required)",
  "password": "string (required)"
}
```

**Response** (200):
```json
{
  "success": true,
  "username": "admin",
  "role": "admin",
  "projects": [
    "692eb65c-706a-4ebb-b6ac-aad371d71dd1",
    "5f6a1d4d-8df0-4eb8-8365-2bd00db12804"
  ]
}
```

**Response** (401):
```json
{
  "error": "Invalid username or password"
}
```

**Sets Cookie**: `session=<uuid>` (HttpOnly, Secure, SameSite=Lax, Max-Age=86400)

---

### POST `/api/auth/logout`

Logout and clear session.

**Request**:
```bash
curl -X POST http://localhost:3000/api/auth/logout
```

**Response** (200):
```json
{
  "success": true
}
```

**Clears Cookie**: `session`

---

### GET `/api/auth/me`

Get current user information and verify authentication.

**Request**:
```bash
curl http://localhost:3000/api/auth/me
```

**Response** (200, authenticated):
```json
{
  "authenticated": true,
  "userId": "3e532238-79a7-4702-88f1-fc255570824a",
  "username": "admin",
  "role": "admin",
  "projects": [
    "692eb65c-706a-4ebb-b6ac-aad371d71dd1",
    "5f6a1d4d-8df0-4eb8-8365-2bd00db12804"
  ]
}
```

**Response** (401, not authenticated):
```json
{
  "authenticated": false
}
```

---

## Projects

### GET `/api/projects`

List all projects (filtered by access control).

**Access**: Requires authentication

**Behavior**:
- Admin: Returns all projects
- Developer: Returns only accessible projects

**Request**:
```bash
curl http://localhost:3000/api/projects
```

**Response** (200):
```json
{
  "projects": [
    {
      "id": "692eb65c-706a-4ebb-b6ac-aad371d71dd1",
      "name": "supercli",
      "cwd": "/home/user/projects/supercli",
      "created_at": 1714982400000,
      "last_used": 1714982400000
    },
    {
      "id": "5f6a1d4d-8df0-4eb8-8365-2bd00db12804",
      "name": "javika",
      "cwd": "/home/user/javika",
      "created_at": 1714982400000,
      "last_used": 1714982400000
    }
  ]
}
```

---

### POST `/api/projects`

Create a new project.

**Access**: Requires authentication + admin role

**Request**:
```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"myproject","cwd":"/home/user/myproject"}'
```

**Body**:
```json
{
  "name": "string (required, unique)",
  "cwd": "string (required, directory path)"
}
```

**Response** (201):
```json
{
  "id": "new-uuid-here",
  "name": "myproject",
  "cwd": "/home/user/myproject",
  "created_at": 1714982400000,
  "last_used": 1714982400000
}
```

**Response** (400):
```json
{
  "error": "Project name is required"
}
```

---

### PUT `/api/projects/:id`

Update a project (name and/or cwd).

**Access**: Requires authentication + admin role

**Request**:
```bash
curl -X PUT http://localhost:3000/api/projects/692eb65c-706a-4ebb-b6ac-aad371d71dd1 \
  -H "Content-Type: application/json" \
  -d '{"name":"newname","cwd":"/new/path"}'
```

**Body** (both optional):
```json
{
  "name": "string (optional)",
  "cwd": "string (optional)"
}
```

**Response** (200):
```json
{
  "id": "692eb65c-706a-4ebb-b6ac-aad371d71dd1",
  "name": "newname",
  "cwd": "/new/path",
  "created_at": 1714982400000,
  "last_used": 1714982403000
}
```

**Response** (404):
```json
{
  "error": "Project not found"
}
```

---

### DELETE `/api/projects/:id`

Delete a project (and all associated sessions).

**Access**: Requires authentication + admin role

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/projects/692eb65c-706a-4ebb-b6ac-aad371d71dd1
```

**Response** (200):
```json
{
  "success": true
}
```

**Response** (403):
```json
{
  "error": "Cannot delete default project"
}
```

---

## Execution

### POST `/api/execute`

Execute Claude CLI with given prompt and capture streaming output.

**Access**: Requires authentication + project access

**Request**:
```bash
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create a file at ~/test.txt","projectId":"project-uuid-here"}'
```

**Body**:
```json
{
  "prompt": "string (required)",
  "projectId": "string (required, must have access)"
}
```

**Response** (200):
```json
{
  "sessionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "executing"
}
```

**Real-time Updates**: Use WebSocket connection `/ws/:sessionId` to receive Kanban card updates as execution proceeds.

---

### POST `/api/plan`

Plan execution without running tools (approval workflow).

**Access**: Requires authentication + project access

**Request**:
```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create a file","projectId":"project-uuid-here"}'
```

**Body**:
```json
{
  "prompt": "string (required)",
  "projectId": "string (required)"
}
```

**Response** (200):
```json
{
  "sessionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "planning",
  "plannedTools": [
    {
      "id": "tool-1",
      "name": "write",
      "description": "Write file at ~/test.txt",
      "input": { "path": "~/test.txt", "content": "..." }
    }
  ]
}
```

---

## Sessions

### GET `/api/sessions`

List execution sessions.

**Access**: Requires authentication

**Behavior**:
- Admin: Returns all sessions
- Developer: Returns only own sessions

**Request**:
```bash
curl http://localhost:3000/api/sessions
```

**Query Parameters**:
- `projectId` (optional): Filter by project

```bash
curl 'http://localhost:3000/api/sessions?projectId=project-uuid-here'
```

**Response** (200):
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "name": "My Test Session",
      "status": "completed",
      "prompt": "Create a file...",
      "created_at": 1714982400000,
      "totalCost": 0.0897,
      "projectId": "project-uuid"
    }
  ]
}
```

---

### GET `/api/session/:id`

Get detailed session information including Kanban cards and execution history.

**Access**: Requires authentication + project access (if developer)

**Request**:
```bash
curl http://localhost:3000/api/session/session-uuid-here
```

**Response** (200):
```json
{
  "id": "session-uuid",
  "status": "completed",
  "prompt": "Create a file...",
  "cards": [
    {
      "id": "card-1",
      "column": "THINKING",
      "title": "🧠 Agent thinking...",
      "content": "I need to create a file...",
      "status": "success",
      "timestamp": 1714982400000
    },
    {
      "id": "card-2",
      "column": "ACTIONS",
      "title": "🔧 Write: /tmp/test.txt",
      "content": "Writing file...",
      "status": "in-progress",
      "timestamp": 1714982401000
    }
  ],
  "totalCost": 0.0897,
  "startTime": 1714982400000,
  "endTime": 1714982405000,
  "projectId": "project-uuid"
}
```

**Response** (404):
```json
{
  "error": "Session not found"
}
```

**Response** (403):
```json
{
  "error": "No access to this session"
}
```

---

## WebSocket

### WS `/ws/:sessionId`

Real-time Kanban card updates via WebSocket.

**Access**: Requires authentication + session access

**Connect**:
```javascript
const ws = new WebSocket('ws://localhost:3000/ws/session-uuid-here');

ws.onopen = () => {
  console.log('Connected to session stream');
};

ws.onmessage = (event) => {
  const kanbanEvent = JSON.parse(event.data);
  console.log('Card update:', kanbanEvent);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from session');
};
```

**Message Format** (Kanban Event):

```json
{
  "type": "card:add",
  "card": {
    "id": "card-uuid",
    "column": "THINKING",
    "title": "🧠 Agent thinking...",
    "content": "Analyzing prompt...",
    "status": "in-progress",
    "timestamp": 1714982400000
  }
}
```

**Event Types**:
- `card:add` - New card created
- `card:update` - Card updated (content, status)
- `card:move` - Card moved to different column
- `card:remove` - Card deleted
- `session:start` - Session started
- `session:end` - Session completed
- `approval:required` - Human approval needed (planning phase)

---

## Error Responses

### 400 Bad Request

```json
{
  "error": "Invalid request: missing required field"
}
```

### 401 Unauthorized

```json
{
  "error": "Not authenticated" or "Session expired"
}
```

**Fix**: Login again with `/api/auth/login`

### 403 Forbidden

```json
{
  "error": "Insufficient permissions" or "No access to project"
}
```

**Fix**: Request admin to grant project access

### 404 Not Found

```json
{
  "error": "Session not found" or "Project not found"
}
```

**Fix**: Check ID is correct and resource exists

### 500 Internal Server Error

```json
{
  "error": "Server error: details here"
}
```

**Fix**: Check server logs, restart server if needed

---

## Rate Limiting

Currently no built-in rate limiting. Recommended setup (reverse proxy):

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://localhost:3000;
}
```

---

## CORS Configuration

Adjust in `src/server.ts` for cross-origin requests (if needed):

```typescript
app.use('*', cors({
  origin: 'https://allowed-domain.com',
  credentials: true
}));
```

---

## Pagination

Not yet implemented. For large result sets, consider:

```bash
# Get sessions with limit
curl 'http://localhost:3000/api/sessions?limit=50&offset=0'
```

Would require API changes.

---

## Pagination & Filtering

**Not implemented in current version.**

Future enhancements:
```bash
# Pagination
curl 'http://localhost:3000/api/sessions?limit=50&offset=100'

# Filtering
curl 'http://localhost:3000/api/sessions?status=completed&costMin=0&costMax=1.00'

# Sorting
curl 'http://localhost:3000/api/sessions?sort=created_at:desc'
```

---

## Health Check

### GET `/`

Simple health check (returns HTML).

**Request**:
```bash
curl http://localhost:3000/
```

**Response** (200):
```html
<!DOCTYPE html>
...
```

---

## Examples

### Complete Login Flow

```bash
# 1. Login
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# 2. Get projects
curl -b cookies.txt http://localhost:3000/api/projects | jq '.'

# 3. Create new project
curl -b cookies.txt -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"test","cwd":"/tmp/test"}'

# 4. Execute prompt
PROJECT_ID=$(curl -s -b cookies.txt http://localhost:3000/api/projects | jq -r '.projects[0].id')

SESSION=$(curl -s -b cookies.txt -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Say hello\",\"projectId\":\"$PROJECT_ID\"}" | jq -r '.sessionId')

# 5. Get session details
curl -b cookies.txt http://localhost:3000/api/session/$SESSION | jq '.'

# 6. Logout
curl -b cookies.txt -X POST http://localhost:3000/api/auth/logout
```

### WebSocket Stream

```javascript
const projectId = 'project-uuid';
const prompt = 'Create a todo app';

// 1. Start execution
fetch('http://localhost:3000/api/execute', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, projectId })
})
.then(r => r.json())
.then(data => {
  const sessionId = data.sessionId;

  // 2. Connect WebSocket for real-time updates
  const ws = new WebSocket(`ws://localhost:3000/ws/${sessionId}`);

  ws.onmessage = (event) => {
    const kanbanEvent = JSON.parse(event.data);

    switch(kanbanEvent.type) {
      case 'card:add':
        console.log('New card:', kanbanEvent.card.title);
        break;
      case 'card:update':
        console.log('Updated card:', kanbanEvent.card.id);
        break;
      case 'session:end':
        console.log('Session complete');
        break;
    }
  };
});
```

---

## Troubleshooting

### "Session cookie not sent"

**Problem**: API returns 401 even after login

**Solution**:
```bash
# Curl needs -b flag to send cookies
curl -b cookies.txt http://localhost:3000/api/auth/me

# Browser automatically sends cookies (verify in DevTools)
```

### "Session expired"

**Problem**: After 24 hours, session no longer valid

**Solution**: Login again

### "No access to project"

**Problem**: Developer can't access project

**Solution**: Ask admin to grant project access via CLI:

```bash
bun bin/create-user <username> <password> developer <projectNumber>
```

Or update database:

```bash
sqlite3 claude-sessions.db \
  "INSERT INTO user_project_access VALUES ('uuid', 'user-id', 'project-id', datetime('now'), 'admin');"
```
