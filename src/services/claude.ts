import { randomUUID } from 'crypto';
import { getProject } from './project';
import { saveSessionToDb } from '../lib/db';
import type { StreamEvent, KanbanEvent, ExecutionSession } from '../types';

export function createBroadcaster(wsClients: Map<string, Set<any>>) {
  return function broadcastToSession(sessionId: string, event: KanbanEvent) {
    const clients = wsClients.get(sessionId);
    if (!clients) return;

    const message = JSON.stringify(event);
    for (const client of clients) {
      try {
        client.send(message);
      } catch (e) {
        console.error('Failed to send to client:', e);
      }
    }
  };
}

export async function executeClaudeWithStreaming(
  prompt: string,
  sessionId: string,
  sessions: Map<string, ExecutionSession>,
  converter: any,
  broadcastToSession: (sessionId: string, event: KanbanEvent) => void,
  permissionMode: 'plan' | 'execute' = 'execute',
  model: string = 'sonnet',
  projectId: string = 'default'
) {
  return new Promise<void>(async (resolve, reject) => {
    const mode = permissionMode === 'plan' ? 'dontAsk' : 'bypassPermissions';

    console.log(`[${sessionId}] ✨ Starting Claude execution`);
    console.log(`[${sessionId}] Model: ${model}`);
    console.log(`[${sessionId}] Project: ${projectId}`);
    console.log(`[${sessionId}] Prompt: "${prompt.substring(0, 60)}..."`);

    try {
      const project = getProject(projectId);
      const workingDir = project?.cwd || process.cwd();
      console.log(`[${sessionId}] Working directory: ${workingDir}`);

      const command = `unset CLAUDECODE; cd "${workingDir.replace(/"/g, '\\"')}" && claude -p --model ${model} --verbose --output-format stream-json --permission-mode ${mode} "${prompt.replace(/"/g, '\\"')}"`;

      const proc = Bun.spawn({
        cmd: ['bash', '-c', command],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';

      // Read stdout
      (async () => {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            stdoutBuffer += chunk;

            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                const event = JSON.parse(line) as StreamEvent;
                const session = sessions.get(sessionId);

                if (!session) continue;

                session.events.push(event);
                console.log(`[${sessionId}] 📥 ${event.type}`);

                const kanbanEvents = converter.convert(event, sessionId);
                for (const ke of kanbanEvents) {
                  broadcastToSession(sessionId, ke);

                  if (ke.type === 'card:add' && ke.card) {
                    session.cards.set(ke.card.id, ke.card);
                    console.log(`[${sessionId}] 📌 Card stored: ${ke.card.id}`);
                  }

                  if (ke.type === 'session:end' && ke.cost !== undefined) {
                    session.totalCost += ke.cost;

                    if (event.type === 'result') {
                      const resultEvent = event as any;
                      const response = resultEvent.result || '';
                      if (response) {
                        session.conversationHistory.push(
                          { role: 'user', content: prompt },
                          { role: 'assistant', content: response }
                        );
                        console.log(`[${sessionId}] 💾 Conversation history updated`);
                      }
                    }
                  }
                }
              } catch (e) {
                console.error(`[${sessionId}] Parse error: ${e}`);
              }
            }
          }
        } catch (err) {
          console.error(`[${sessionId}] stdout read error: ${err}`);
        }
      })();

      // Read stderr
      (async () => {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            stderrBuffer += chunk;

            if (chunk.includes('Error') || chunk.includes('error')) {
              console.error(`[${sessionId}] stderr: ${chunk.substring(0, 100)}`);
            }
          }
        } catch (err) {
          console.error(`[${sessionId}] stderr read error: ${err}`);
        }
      })();

      const exitCode = await proc.exited;
      console.log(`[${sessionId}] ✨ Process exited with code ${exitCode}`);

      const session = sessions.get(sessionId);
      if (session) {
        session.status = 'completed';
        session.endTime = Date.now();
        saveSessionToDb(sessionId, session);
        console.log(`[${sessionId}] 💾 Session saved to database`);
      }

      resolve();
    } catch (err) {
      console.error(`[${sessionId}] ❌ Fatal error: ${err}`);
      const session = sessions.get(sessionId);
      if (session) {
        session.status = 'error';
      }
      reject(err);
    }
  });
}
