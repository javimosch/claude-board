# Architecture: Claude Streaming Mode as ACP Replacement

## Overview

This PoC demonstrates replacing Anthropic's older ACP protocol with Claude CLI streaming mode, integrated into a Bun backend with real-time Kanban visualization.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser / React UI                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Kanban Board: THINKING → ACTIONS → FEEDBACK → COMPLETE  │   │
│  │ Session info: status, cost, duration, events            │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP + WebSocket
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│           Bun Server (Hono) - Port 3000                         │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ API Routes  │  │ WebSocket    │  │ Session Manager      │   │
│  │             │  │ Broadcaster  │  │ (in-memory store)    │   │
│  │ /api/execute│  │              │  │                      │   │
│  │ /api/plan   │  │ Clients set  │  │ sessions: Map        │   │
│  │ /api/session│  │ wsClients    │  │ wsClients: Map       │   │
│  └──────┬──────┘  └──────────────┘  └──────────────────────┘   │
│         │                                                        │
│         └─────────────────┬──────────────────────────────────┐  │
│                           ↓                                  │  │
│                  ┌─────────────────────┐                    │  │
│                  │ Kanban Converter    │                    │  │
│                  │                     │                    │  │
│                  │ Transforms:         │                    │  │
│                  │ thinking → card     │                    │  │
│                  │ tool_use → card     │                    │  │
│                  │ tool_result → card  │                    │  │
│                  │ result → session    │                    │  │
│                  └──────────┬──────────┘                    │  │
└───────────────────────────────┼────────────────────────────────┘
                                │ JSONL stream
                                ↓
                    ┌──────────────────────┐
                    │ Event Parser         │
                    │                      │
                    │ async* parseJsonl()  │
                    │ Readline + JSON      │
                    │                      │
                    └──────────┬───────────┘
                               │
                               ↓
                    ┌──────────────────────┐
                    │ Claude Executor      │
                    │                      │
                    │ spawn('claude', [...])
                    │ stdio: ['pipe', ...]
                    │                      │
                    └──────────┬───────────┘
                               │ subprocess
                               ↓
                    ┌──────────────────────┐
                    │ Claude CLI           │
                    │                      │
                    │ claude -p \          │
                    │ --verbose \          │
                    │ --output-format \    │
                    │   stream-json \      │
                    │ --permission-mode \ │
                    │   bypassPermissions │
                    │ "your prompt"        │
                    └──────────────────────┘
```

## Data Flow

### Phase 1: User Input
```
User enters prompt → POST /api/execute → Create session + spawn Claude
```

### Phase 2: Streaming
```
Claude outputs JSONL lines:
  Line 1: {"type":"system", "cwd":"...", "tools":[...]}
  Line 2: {"type":"assistant", "message":{"content":[{"type":"thinking",...}]}}
  Line 3: {"type":"assistant", "message":{"content":[{"type":"tool_use",...}]}}
  Line 4: {"type":"user", "message":{"content":[{"type":"tool_result",...}]}}
  ...
  Last:   {"type":"result", "total_cost_usd":0.001, ...}
```

### Phase 3: Conversion
```
Each JSONL line:
  1. Parsed as JSON
  2. Stored in session.events
  3. Converted to KanbanEvent(s)
  4. Broadcast via WebSocket to all connected clients
```

### Phase 4: Visualization
```
Browser receives KanbanEvent:
  {"type":"card:add", "card":{
    "id":"action-123",
    "column":"ACTIONS",
    "title":"🔧 Bash",
    "content":"mkdir -p ~/test",
    "status":"in-progress"
  }}

React updates state → Kanban board re-renders
```

## Key Components

### 1. Event Parser (`src/server.ts`)

```typescript
async function* parseJsonlStream(stream: NodeJS.ReadableStream) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as StreamEvent;
    } catch (e) {
      console.error('Parse error:', e);
    }
  }
}
```

**Purpose**: Convert raw subprocess output into structured events

**Features**:
- Line-based parsing (JSONL format)
- Error handling for malformed JSON
- Async generator for memory efficiency

### 2. Kanban Converter

```typescript
class KanbanConverter {
  convert(event: StreamEvent, sessionId: string): KanbanEvent[] {
    switch (event.type) {
      case 'thinking': // → THINKING column
      case 'tool_use': // → ACTIONS column
      case 'tool_result': // → FEEDBACK column
      case 'result': // → COMPLETE column
    }
  }
}
```

**Purpose**: Transform stream events into UI-ready Kanban cards

**Mapping**:
```
thinking        → card { column: THINKING, status: in-progress }
tool_use        → card { column: ACTIONS, status: in-progress }
tool_result     → card { column: FEEDBACK, status: success|error }
assistant text  → card { column: FEEDBACK, status: success }
result          → card { column: COMPLETE, status: success }
                  + session { status: completed, cost: ... }
```

### 3. Session Manager

```typescript
interface ExecutionSession {
  id: string;
  status: 'planning' | 'executing' | 'completed' | 'error';
  prompt: string;
  cards: Map<string, KanbanCard>;
  events: StreamEvent[];
  totalCost: number;
  startTime: number;
  endTime?: number;
}

const sessions = new Map<string, ExecutionSession>();
```

**Purpose**: Track execution state across HTTP requests

**Features**:
- Unique session ID per execution
- Full event history stored
- Real-time cost tracking
- Card collection for UI

### 4. Claude Executor

```typescript
async function executeClaudeWithStreaming(
  prompt: string,
  sessionId: string,
  permissionMode: 'plan' | 'execute'
) {
  const mode = permissionMode === 'plan' ? 'dontAsk' : 'bypassPermissions';
  const proc = spawn('claude', [
    '-p',
    '--verbose',
    '--output-format', 'stream-json',
    '--permission-mode', mode,
    prompt,
  ]);

  proc.stdout?.on('data', async (data) => {
    // Parse, convert, broadcast
  });
}
```

**Purpose**: Spawn Claude CLI and stream events

**Options**:
- `--permission-mode bypassPermissions` - Auto-approve tools (execution)
- `--permission-mode dontAsk` - Silent deny (planning)

### 5. WebSocket Broadcaster

```typescript
const wsClients = new Map<string, Set<WebSocket>>();

function broadcastToSession(sessionId: string, event: KanbanEvent) {
  const clients = wsClients.get(sessionId);
  for (const client of clients) {
    client.send(JSON.stringify(event));
  }
}
```

**Purpose**: Push Kanban updates to all connected clients

**Features**:
- Per-session client tracking
- Automatic cleanup on disconnect
- Error handling for dead connections

### 6. Hono Server

```typescript
app.get('/ws/:sessionId', upgradeWebSocket(...))
app.post('/api/execute', async (c) => { ... })
app.post('/api/plan', async (c) => { ... })
app.get('/api/session/:sessionId', (c) => { ... })
app.get('/', (c) => c.html(getIndexHtml()))
```

**Routes**:
- `GET /` - Serve React UI
- `GET /ws/:sessionId` - WebSocket for real-time updates
- `POST /api/execute` - Run with full permissions
- `POST /api/plan` - Plan without execution (approval workflow)
- `GET /api/session/:sessionId` - Get session state
- `GET /health` - Health check

## State Transitions

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  START                                                  │
│    │                                                    │
│    ├─→ POST /api/execute                              │
│    │    ├─→ CREATE session (status: executing)        │
│    │    ├─→ SPAWN claude process                       │
│    │    ├─→ STREAM events → convert → broadcast       │
│    │    └─→ ON CLOSE → (status: completed|error)      │
│    │                                                    │
│    └─→ POST /api/plan (HITL approval)                 │
│         ├─→ CREATE session (status: planning)         │
│         ├─→ SPAWN claude (--permission-mode dontAsk)  │
│         ├─→ CAPTURE planned tools                      │
│         ├─→ WAIT for user approval                     │
│         └─→ POST /api/execute with approval            │
│                                                         │
│  GET /api/session/:sessionId                           │
│    └─→ RETURN { status, cards, cost, ... }            │
│                                                         │
│  WebSocket /ws/:sessionId                              │
│    ├─→ ON CONNECT → add to wsClients                  │
│    ├─→ ON MESSAGE → handle approval (future)          │
│    └─→ ON CLOSE → remove from wsClients               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Type System (`src/types.ts`)

```typescript
// Stream events from Claude CLI
interface StreamEvent { type: 'system'|'assistant'|'user'|'result' }
interface AssistantMessage { message: { content, usage } }
interface ToolResultEvent { message: { content: [{type: 'tool_result'}] } }
interface ResultEvent { total_cost_usd, modelUsage, usage }

// Kanban UI
interface KanbanCard {
  id: string;
  column: 'THINKING' | 'ACTIONS' | 'FEEDBACK' | 'COMPLETE';
  title: string;
  content: string;
  status: 'pending' | 'in-progress' | 'success' | 'error';
}

interface KanbanEvent {
  type: 'card:add' | 'card:update' | 'card:move' | 'session:end';
  card?: KanbanCard;
  cost?: number;
}

// Session management
interface ExecutionSession {
  id: string;
  status: 'executing' | 'completed' | 'error';
  prompt: string;
  cards: Map<string, KanbanCard>;
  events: StreamEvent[];
  totalCost: number;
}
```

## Frontend Architecture

```javascript
function App() {
  // Input prompt, submit execution
  // Routes to KanbanBoard component
}

function KanbanBoard({ sessionId }) {
  // Connect WebSocket to /ws/:sessionId
  // Render 4 columns
  // Update cards on socket message
  // Poll /api/session for metadata
}

function KanbanCard({ card }) {
  // Render single card
  // Color based on status
  // Truncate long content
}
```

**Technologies**:
- React 18 (CDN)
- Tailwind CSS (CDN)
- Plain fetch + WebSocket APIs
- No build step (uses Babel standalone)

## Permission Modes (Two-Phase Execution)

### Phase 1: Planning (HITL Approval)
```bash
claude -p --permission-mode dontAsk "Create a file at ~/test.txt"
```

**Behavior**:
- Claude plans but doesn't execute tools
- Stream shows tool_use events but not tool_result
- UI displays: "Claude wants to [Write file], [Run bash]"
- User clicks [Approve] button
- System captures approved tools

### Phase 2: Execution (With Approval)
```bash
claude -p --permission-mode bypassPermissions "Create a file at ~/test.txt"
```

**Behavior**:
- Claude executes tools automatically
- Stream shows tool_use + tool_result pairs
- UI updates in real-time with results
- Cards move from ACTIONS → FEEDBACK

**Implementation**:
```typescript
// See POST /api/plan endpoint for planning phase
// Add approval check + execute with bypassPermissions on approval
```

## Cost Tracking

From each `result` event:

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

**Calculation**:
```
Total USD = sum(modelUsage[model].costUSD for each model)

Cache Efficiency = cache_read_tokens / (input + cache_read)
                 = 64137 / (6 + 64137)
                 = 99.99%
```

## Error Handling

### Stream Parse Errors
```typescript
try {
  yield JSON.parse(line);
} catch (e) {
  console.error('Parse error:', e);
  // Skip malformed line, continue
}
```

### Process Errors
```typescript
proc.on('error', (err) => {
  session.status = 'error';
  // Notify clients via WebSocket
});
```

### Tool Execution Errors
```json
{
  "type": "user",
  "message": {
    "content": [{
      "type": "tool_result",
      "is_error": true,
      "content": "Error: mkdir was blocked"
    }]
  }
}
```

Rendered as red card in FEEDBACK column.

## Scalability Notes

**Current (Single Server)**:
- In-memory session storage
- Per-session WebSocket client sets
- Single process per execution

**For Production**:
1. **Database**: Replace `Map<string, ExecutionSession>` with PostgreSQL
2. **Message Queue**: Use Redis/RabbitMQ for background execution
3. **Load Balancer**: Distribute requests across multiple servers
4. **Session Affinity**: Route same sessionId to same server (or use distributed cache)
5. **Persistence**: Store events as JSONL for replay and audit

```typescript
// Example: PostgreSQL adapter
class SessionManager {
  async save(session: ExecutionSession) {
    await db.query(
      'INSERT INTO sessions (id, status, events, cost) VALUES ($1, $2, $3, $4)',
      [session.id, session.status, JSON.stringify(session.events), session.totalCost]
    );
  }

  async getSession(id: string) {
    const result = await db.query('SELECT * FROM sessions WHERE id = $1', [id]);
    return result.rows[0];
  }
}
```

## Testing Strategy

### 1. Unit Tests (Not included in PoC)
```typescript
// Test KanbanConverter
test('thinking event → THINKING column', () => {
  const event = { type: 'assistant', message: { content: [{ type: 'thinking' }] } };
  const cards = converter.convert(event, 'session-1');
  expect(cards[0].column).toBe('THINKING');
});
```

### 2. Integration Tests (Manual)
```bash
# Test 1: Simple echo
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Say hello"}'

# Test 2: File creation
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a file at ~/test.txt with content: hello"}'

# Test 3: Error handling
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Try to create a file in a non-existent directory"}'
```

### 3. Load Tests (Future)
```bash
# Simulate multiple concurrent sessions
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/execute \
    -H "Content-Type: application/json" \
    -d "{\"prompt\": \"Echo test $i\"}" &
done
wait
```

## Deployment Checklist

- [ ] Test locally with `bun run dev`
- [ ] Verify Claude CLI works: `claude --version`
- [ ] Check credentials exist: `~/.claude/.credentials.json`
- [ ] Build: `bun run build` (optional, for binary)
- [ ] Set `PORT` environment variable
- [ ] Run server: `bun run start`
- [ ] Test endpoints: `curl http://localhost:3000/health`
- [ ] Test WebSocket: Browser DevTools → Network → WS
- [ ] Monitor logs for errors

## Next Steps

1. **Run Locally**: `bun install && bun run dev`
2. **Test Basic Flow**: Use QUICKSTART.md examples
3. **Add Approval Workflow**: Implement `/api/plan` approval handling
4. **Persistence**: Replace in-memory storage with database
5. **Authentication**: Add JWT/OAuth for multi-user
6. **Production Deployment**: Deploy to Heroku, Railway, or cloud provider

See README.md and QUICKSTART.md for detailed instructions!
