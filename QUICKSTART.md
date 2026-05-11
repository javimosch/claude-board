# Quick Start Guide

Get the Claude Streaming Mode PoC running in 2 minutes.

## Prerequisites Check

```bash
# Check Claude CLI is installed
claude --version

# Check Bun is installed
bun --version

# Check credentials exist
cat ~/.claude/.credentials.json | grep -q '"token"' && echo "✅ Credentials OK" || echo "❌ No credentials"
```

## Run Server

```bash
# From the claude-ui-poc directory
cd /home/jarancibia/ai/system/claude-ui-poc

# Install dependencies
bun install

# Start dev server with hot reload
bun run dev
```

Server will start at `http://localhost:3000`

## Open UI

```bash
# In another terminal, open browser
open http://localhost:3000

# Or just copy URL to browser manually
```

## Try Your First Prompt

**Simple test:**
```
Create a file at ~/poc-test.txt with content: Hello from Claude PoC
```

**Better test (shows more complexity):**
```
Create a simple todo app in ~/test-app/index.html with HTML, CSS and JS in one file
```

**Task with multiple steps:**
```
Create a shell script at ~/test-script.sh that:
1. Prints the current date
2. Lists files in the current directory
Then run it and show me the output
```

## Watch the Kanban Board

- **THINKING** column - Shows agent reasoning phases
- **ACTIONS** column - Shows tool executions (Write, Bash, Edit, Read)
- **FEEDBACK** column - Shows tool results and responses
- **COMPLETE** column - Shows final summary with cost

## Monitor Execution

The UI shows:
- **Session ID** - Unique identifier for this execution
- **Status** - planning → executing → completed or error
- **Cost** - Total USD spent on this execution
- **Duration** - How long it took

## Common Issues

### "claude: command not found"
Install: `bun install -g @anthropic-ai/claude-code`

### WebSocket connection error
Make sure server is still running in the other terminal.

### No cards appearing
Check browser console (F12) for errors. Claude process might need approval.

## Explanation of What's Happening

```
Your Prompt
  ↓
Server receives → creates session
  ↓
Spawns: claude -p --verbose --output-format stream-json
  ↓
Claude CLI streams JSONL events:
  - system:init (setup)
  - thinking (reasoning)
  - tool_use (action)
  - tool_result (feedback)
  - result (completion + cost)
  ↓
Server converts each event → Kanban card
  ↓
WebSocket broadcasts → Browser updates UI
  ↓
Kanban board shows live execution!
```

## Next Steps

1. ✅ Run the server
2. ✅ Execute a few prompts to understand the flow
3. 📖 Read `README.md` for architecture details
4. 📖 Read `/home/jarancibia/.claude/plans/approval-workflows-guide.md` for HITL workflows
5. 🔧 Customize the converter to handle more event types
6. 🚀 Deploy to production with proper authentication

## Example Prompts to Try

### Echo Test
```
Say hello and explain what you just did
```
*Shows simple text response in Kanban*

### File Creation
```
Create a file at ~/poc-test.txt with the content: "POC Works!"
```
*Shows thinking → action → result flow*

### Multi-Step Task
```
Create a JavaScript file at ~/counter.js that exports a simple counter function,
then create an HTML file at ~/counter.html that uses it
```
*Shows multiple tool executions*

### Error Handling
```
Try to create a file in a directory that doesn't exist and handle the error gracefully
```
*Shows error handling in Kanban*

## API Curl Examples

### Execute Directly
```bash
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a file at ~/test.txt with content: hello"
  }' | jq '.sessionId'
```

### Get Session State
```bash
SESSION_ID=$(curl -s -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "echo test"}' | jq -r '.sessionId')

curl http://localhost:3000/api/session/$SESSION_ID | jq '.'
```

### Watch Stream Live
```bash
# Show all cards as they're created
curl http://localhost:3000/api/session/$SESSION_ID | jq '.cards | length'

# Poll every second
watch -n 1 "curl -s http://localhost:3000/api/session/$SESSION_ID | jq '{status, totalCost, cardCount: (.cards | length)}'"
```

## Performance Notes

- **Cold start**: ~3 seconds
- **Per-card latency**: <10ms
- **WebSocket updates**: Real-time (milliseconds)
- **Total execution**: 5-15 seconds depending on task complexity

## Cost Examples

From actual test runs:

| Task | Cost | Tokens | Duration |
|------|------|--------|----------|
| "Say hello" | $0.00001 | 45 | 2s |
| File creation | $0.0001 | 250 | 3s |
| Todo app | $0.0897 | 406 output | 10s |

Costs are very low for short tasks!

## Storage Notes

Sessions are stored in memory. After restarting the server, old sessions are lost.

For production, add:
```typescript
// Use PostgreSQL instead of Map
const sessions = await db.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
```

## Next: Production Setup

When ready to deploy:

1. Add database (PostgreSQL)
2. Add authentication (JWT/OAuth)
3. Add rate limiting
4. Use production Claude model (opus-4-7 or sonnet-4-6)
5. Add permission approval workflow
6. Deploy to cloud (Railway, Vercel, etc.)

See `README.md` for full details!

---

**Questions?** Check the documentation files in `/home/jarancibia/.claude/plans/`
