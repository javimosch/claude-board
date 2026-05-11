# Claude Board

A clean web UI for Claude CLI with real-time Kanban visualization, multi-user authentication, and role-based project access control.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Authentication](#authentication)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Documentation](#documentation)
- [Configuration](#configuration)

## Quick Start

### Prerequisites

- Bun 1.0+ (or Node.js 20+)
- Claude CLI installed: `bun install -g @anthropic-ai/claude-code`
- Claude credentials: `~/.claude/.credentials.json`

### Installation & Run

```bash
cd claude-board
bun install
bun run dev
# Server: http://localhost:3000 (or your configured port)
```

### First Time Setup

**Default admin user:** `admin` / `admin`

Create additional users via CLI:

```bash
bun bin/create-user
# Interactive mode: prompts for username, role, password, projects

# Or directly:
bun bin/create-user alice developer myPassword 1 2
# Creates user "alice" (developer role) with access to projects 1 and 2
```

Then open browser to `http://localhost:3000` and login.

## Architecture

```
Frontend (React + Tailwind)
    ↓ HTTP/WebSocket
Bun Server (Hono)
    ├─ Event Parser (JSONL stream)
    ├─ Kanban Converter (stream → cards)
    └─ Claude Executor (spawns CLI process)
    ↓
Claude CLI (--verbose --output-format stream-json)
```

## Authentication

✅ **Multi-User Support**
- Admin account creation via CLI tool (`bin/create-user`)
- Role-based access control (Admin, Developer)
- HTTP-only secure cookies with 24-hour expiration
- Password hashing with SHA-256 + salt

🔐 **Project Access Control**
- Developers see only projects they're granted access to
- Admins see all projects
- Many-to-many user ↔ project relationships
- Per-project session filtering

📝 **Session Management**
- Server-side session store (in-memory with DB persistence)
- Automatic session refresh on each request
- Session expiration handling
- Per-user session history

## Features

✨ **Real-time Streaming**
- Claude CLI output parsed as JSONL
- WebSocket broadcasts events to frontend
- Millisecond-level latency

🎨 **Kanban Board Visualization**
- 4-column layout: THINKING → ACTIONS → FEEDBACK → COMPLETE
- Live card updates as agent executes
- Color-coded status (pending, in-progress, success, error)

💰 **Cost Tracking**
- Total USD cost calculated from stream events
- Per-model token breakdown
- Cache efficiency metrics

🧠 **Explicit Thinking**
- Visible thinking events with signatures
- Tool execution tracking
- Result feedback in real-time


### Run as System Daemon

The application can also be installed and managed as a systemd user service:

```bash
# Install as daemon (auto-start on login)
claude-board install

# Start the service
claude-board start

# Check service status
claude-board status

# Stop the service
claude-board stop

# Restart the service
claude-board restart

# View service logs
claude-board logs -f

# Uninstall the service
claude-board uninstall
```

See [DAEMON.md](DAEMON.md) for complete daemon management documentation.

## Usage

### Login

1. Open `http://localhost:3000` in your browser
2. Login with:
   - **Admin**: `admin` / `admin` (default on first run)
   - **Developer**: Ask admin to create account via CLI

### Execute Claude

1. **Select a project**: Choose from projects you have access to
2. **Enter a prompt**: Try something like:
   ```
   Create a simple todo app in ~/test-app/index.html with HTML, CSS, and JS
   ```
3. **Watch in real-time**: The Kanban board updates live as Claude executes
4. **Monitor cost**: See total USD cost and timing in the session info

### Manage Users (Admin only)

Create a new developer account:

```bash
bun bin/create-user alice developer password 1
# Creates alice with access to project 1
```

See [docs/authentication.md](docs/authentication.md) for detailed user management.

## API Endpoints

### Authentication

**POST `/api/auth/login`** - Login with username/password
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
# Returns: {success, username, role, projects}
# Sets HTTP-only session cookie
```

**POST `/api/auth/logout`** - Logout (clears session)
```bash
curl -X POST http://localhost:3000/api/auth/logout
```

**GET `/api/auth/me`** - Check authentication & user info
```bash
curl http://localhost:3000/api/auth/me
# Returns: {authenticated, userId, username, role, projects}
```

### Execution

### POST `/api/execute`
Execute Claude with full permissions.

```bash
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a file at ~/test.txt with content hello"}'
```

Response:
```json
{
  "sessionId": "uuid-here",
  "status": "executing"
}
```

### POST `/api/plan`
Plan execution without running tools (approval workflow).

```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a file at ~/test.txt"}'
```

### GET `/api/session/:sessionId`
Get current session state and cards.

```bash
curl http://localhost:3000/api/session/uuid-here
```

Response:
```json
{
  "id": "uuid-here",
  "status": "executing",
  "prompt": "...",
  "cards": [...],
  "totalCost": 0.0897,
  "duration": 5200,
  "requiresApproval": false,
  "approvalPending": false
}
```

### WebSocket `/ws/:sessionId`
Real-time Kanban card updates via WebSocket.

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/session-id');

ws.onmessage = (event) => {
  const kanbanEvent = JSON.parse(event.data);
  // {
  //   type: "card:add",
  //   card: { id, column, title, content, status, timestamp }
  // }
};
```

## Stream Events

The Claude CLI outputs these event types:

| Event | Column | Example |
|-------|--------|---------|
| `thinking` | THINKING | 🧠 Agent thinking... (signature proof) |
| `tool_use` | ACTIONS | 🔧 Write, 🔧 Bash, etc. |
| `tool_result` | FEEDBACK | ✅ Success, ❌ Error |
| `text` | FEEDBACK | 💬 Response (explicit thinking) |
| `result` | COMPLETE | ✨ Complete (cost + duration) |

## Implementation Details

### Event Parser

```typescript
async function* parseJsonlStream(stream: NodeJS.ReadableStream) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as StreamEvent;
  }
}
```

Parses JSONL line-by-line with proper error handling.

### Kanban Converter

Transforms stream events into card updates:

```typescript
class KanbanConverter {
  convert(event: StreamEvent, sessionId: string): KanbanEvent[] {
    // thinking → { column: THINKING, status: in-progress }
    // tool_use → { column: ACTIONS, status: in-progress }
    // tool_result → { column: FEEDBACK, status: success|error }
    // result → { column: COMPLETE, status: success }
  }
}
```

### Session Manager

Tracks execution state and broadcasts to WebSocket clients:

```typescript
const sessions = new Map<string, ExecutionSession>();
const wsClients = new Map<string, Set<WebSocket>>();

function broadcastToSession(sessionId: string, event: KanbanEvent) {
  for (const client of wsClients.get(sessionId) || []) {
    client.send(JSON.stringify(event));
  }
}
```

### Claude Executor

Spawns Claude CLI and streams events:

```typescript
const proc = spawn('claude', [
  '-p',
  '--verbose',
  '--output-format', 'stream-json',
  '--permission-mode', 'bypassPermissions', // Auto-approve tools
  prompt
]);

for await (const event of parseJsonlStream(proc.stdout)) {
  const kanbanEvents = converter.convert(event, sessionId);
  broadcastToSession(sessionId, ...kanbanEvents);
}
```

## Two-Phase Approval Workflow (Future)

For HITL (Human-in-the-Loop) approval:

```
Phase 1: Plan (--permission-mode dontAsk)
  └─ Shows planned tools without executing
  └─ User reviews in UI

Phase 2: Execute (--permission-mode bypassPermissions)
  └─ Runs approved tools
  └─ Streams results to Kanban board
```

Update `/api/plan` endpoint to capture planned tools and wait for approval.

## Debugging

### View Raw Stream Events

```bash
# See event sequence
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "echo test"}' | jq '.sessionId' | xargs -I {} curl http://localhost:3000/api/session/{} | jq '.cards'
```

### Monitor WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/session-id');
ws.onmessage = (e) => console.log('Event:', JSON.parse(e.data));
```

### Check Claude CLI

```bash
# Verify Claude is working
claude --version
claude -p --verbose --output-format stream-json "echo test"
```

## Cost Calculation

Total USD cost = sum of `modelUsage[model].costUSD` from result event.

Example from a real execution:
```json
{
  "type": "result",
  "total_cost_usd": 0.0897,
  "modelUsage": {
    "claude-opus-4-7": {
      "costUSD": 0.0897,
      "inputTokens": 8,
      "outputTokens": 398
    }
  }
}
```

## Prompt Caching

The stream includes cache metrics:

```json
{
  "type": "assistant",
  "message": {
    "usage": {
      "input_tokens": 6,
      "output_tokens": 398,
      "cache_read_input_tokens": 64137,
      "cache_creation_input_tokens": 7147
    }
  }
}
```

**Cache efficiency** = `cache_read / (input + cache_read)` = 99.99% reuse possible!

This means warm calls cost 40x less than cold calls.

## Error Handling

Stream events may include tool execution errors:

```json
{
  "type": "user",
  "message": {
    "content": [{
      "type": "tool_result",
      "content": "Error: mkdir was blocked",
      "is_error": true
    }]
  }
}
```

These render as red cards in the FEEDBACK column.

## Configuration

### Environment Variables

```bash
PORT=3000                    # Server port (default: 3000)
CLAUDE_PERMISSION_MODE=...   # Override permission mode
```

### Permission Modes

- `bypassPermissions` (default) - Auto-approve all tools
- `dontAsk` - Silent deny (for planning phase)
- `default` - Wait for stdin approval (blocks in non-interactive)

## Performance

**Metrics from testing:**

- **Startup**: ~2-3 seconds
- **Stream latency**: Milliseconds
- **Per-card overhead**: <10ms
- **Total execution**: 5-15 seconds (including tool execution)

## Known Limitations

1. **No explicit thinking content** - The stream includes `thinking` events with signatures, but actual thinking text is not exposed (by design for safety)
2. **Tool execution in subprocess** - Limited to Bash, Write, Edit, Read (same as Claude CLI)
3. **Single session per client** - One WebSocket per session (scale with multiple servers)
4. **No persistent storage** - Sessions stored in memory (add database for production)

## Future Enhancements

- [ ] Two-phase approval workflow (plan + execute)
- [ ] Database persistence (PostgreSQL)
- [ ] Multi-user sessions with auth
- [ ] Cost budgeting and alerts
- [ ] Cache reuse analytics
- [ ] Reasoning pattern analysis
- [ ] Audit trail export (JSONL)
- [ ] Custom tool integration

## Files

```
claude-board/
├── src/
│   ├── server.ts          # Bun/Hono backend with WebSocket
│   ├── types.ts           # TypeScript type definitions
│   ├── lib/               # Core utilities
│   ├── services/          # Business logic
│   ├── api/               # API route handlers
│   ├── ws/                # WebSocket handlers
│   └── components/        # React components
├── bin/                   # CLI scripts
├── package.json           # Bun dependencies
└── README.md             # This file
```

## Documentation

### For Humans

- **[docs/authentication.md](docs/authentication.md)** - User & project management, CLI tool usage
- **[docs/deployment.md](docs/deployment.md)** - Production deployment, environment setup
- **[docs/development.md](docs/development.md)** - Local development, architecture internals
- **[docs/api.md](docs/api.md)** - Complete API reference with examples

### For Agents

See `.agents/skills/` for agent-optimized documentation:

- **`api-endpoints.md`** - All endpoints with request/response formats
- **`auth-system.md`** - Authentication flow for agent troubleshooting
- **`deployment-troubleshooting.md`** - Common issues and fixes
- **`schema.md`** - Database schema reference

## Testing

### Test 1: Simple Echo

```
Prompt: "Say hello"
Expected: 1-2 cards in FEEDBACK column
Cost: ~$0.0001
```

### Test 2: File Creation

```
Prompt: "Create a file at ~/test-poc.txt with content: Hello from PoC"
Expected: 3-4 cards (thinking + action + result + complete)
Cost: ~$0.001
```

### Test 3: Script Execution

```
Prompt: "Create a shell script that prints the date, save it to ~/test-script.sh, then run it"
Expected: 5-6 cards showing plan → write → execute → feedback → complete
Cost: ~$0.005
```

## Support

If Claude CLI is not found:
1. Install: `bun install -g @anthropic-ai/claude-code`
2. Verify: `claude --version`
3. Check credentials: `ls -la ~/.claude/.credentials.json`

If WebSocket connection fails:
1. Check server is running: `curl http://localhost:3000/health`
2. Check browser console for errors
3. Verify sessionId is correct in URL

## License

MIT - See [LICENSE](LICENSE) file for details.
