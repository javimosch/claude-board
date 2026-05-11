# Project Management Feature - Implementation Summary

## Overview
The Claude UI PoC now supports project management, allowing users to organize Claude CLI sessions by projects. Each project has a name and a working directory (cwd), and Claude CLI executes in that directory.

## What's New

### 1. Projects
- Each project has an isolated working directory
- Default project created automatically on server startup
- Projects persist in SQLite database
- Full CRUD operations via REST API

### 2. Sessions
- Sessions are now linked to projects
- CWD is captured at session creation time
- Claude CLI runs with `cd ${project.cwd} && claude ...`

### 3. Frontend UI
- **Sidebar**: Project selector with create/edit/delete controls
- **Main UI**: Project dropdown to select active project before executing
- **Mobile-friendly**: All buttons are tappable (no hover-only controls)

## Database Schema

### Projects Table
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  cwd TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
```

### Session History Updates
```sql
ALTER TABLE session_history ADD COLUMN project_id TEXT DEFAULT 'default';
ALTER TABLE session_history ADD COLUMN cwd TEXT;
```

## REST API

### Projects Endpoints

**List all projects**
```bash
GET /api/projects
→ { projects: [...] }
```

**Create project**
```bash
POST /api/projects
{ "name": "my-project", "cwd": "/home/user/projects/my-app" }
→ { id, name, cwd, created_at, last_used }
```

**Update project**
```bash
PUT /api/projects/:projectId
{ "name": "updated-name", "cwd": "/new/path" }
→ { id, name, cwd, created_at, last_used }
```

**Delete project**
```bash
DELETE /api/projects/:projectId
→ { success: true }
# Note: Cannot delete 'default' project
# Sessions are moved to default when project is deleted
```

### Execution Endpoints (Updated)

**Execute with project**
```bash
POST /api/execute
{ 
  "prompt": "create a file",
  "model": "sonnet",
  "projectId": "a2575bcb-2f3b-4e1c-951d-40298716e9a7"
}
→ { sessionId, status: "executing" }
```

**Plan with project**
```bash
POST /api/plan
{ 
  "prompt": "plan this task",
  "projectId": "default"
}
→ { sessionId, status: "planning" }
```

## Implementation Details

### Backend Changes (src/server.ts)

**Database Functions**
- `ensureDefaultProject()` - Create default project on startup
- `createProject(name, cwd)` - Create new project
- `getProjects()` - List all projects
- `getProject(projectId)` - Get single project
- `updateProject(projectId, name?, cwd?)` - Update project
- `deleteProject(projectId)` - Delete project

**Execution Changes**
- `executeClaudeWithStreaming()` now accepts `projectId` parameter
- Uses project's cwd to determine working directory
- Passes cwd via: `cd ${workingDir} && claude ...`

**API Endpoints**
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `PUT /api/projects/:projectId` - Update project
- `DELETE /api/projects/:projectId` - Delete project

### Frontend Changes (src/server.ts - React JSX)

**New Components**
- `ProjectSelector` - UI for managing projects in sidebar
- Updated `SessionSidebar` - Integrates project selector
- Updated `App` - Manages projects state, handlers

**State Management**
- `projects` - Array of projects from API
- `selectedProjectId` - Currently selected project
- Project CRUD handlers

**UI Elements**
- Project dropdown in main execution area
- Project list with inline edit/delete buttons in sidebar
- Create project form with name and path inputs

## Migration

### Automatic Schema Migration
The server automatically adds missing columns to existing databases:
```javascript
// Migration check on startup
if (!hasProjectId) {
  ALTER TABLE session_history ADD COLUMN project_id TEXT DEFAULT 'default';
}
if (!hasCwd) {
  ALTER TABLE session_history ADD COLUMN cwd TEXT;
}
```

All existing sessions are assigned to 'default' project automatically.

## Testing

### Verified Functionality
✅ Projects CRUD operations
✅ Session creation with projectId
✅ CWD snapshot storage in database
✅ Project-aware execution
✅ Database migrations
✅ Frontend components rendering
✅ Mobile-friendly UI

### Test Results
```
✓ List projects
✓ Create project with cwd
✓ Execute with projectId
✓ Verify session in database
✓ Update project name/cwd
✓ Delete project
✓ Verify sessions moved to default
```

## Usage Example

```javascript
// 1. Create a project
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"web-app","cwd":"/home/user/projects/web"}'

// 2. Execute in that project
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt":"create index.html","projectId":"...","model":"sonnet"}'

// 3. Claude runs in /home/user/projects/web directory
```

## Backward Compatibility

- Existing sessions default to 'default' project
- `/api/execute` without projectId uses 'default' project
- All changes are transparent to existing clients
- Database schema migration is automatic

## Future Enhancements

- Project templates
- Working directory validation
- Project favorites/pinning
- Project-specific Claude settings
- Git integration for projects
