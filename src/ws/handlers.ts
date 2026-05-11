import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { ExecutionSession } from '../types';

export function registerWebSocketRoute(
  app: Hono,
  sessions: Map<string, ExecutionSession>,
  wsClients: Map<string, Set<any>>
) {
  app.get(
    '/ws/:sessionId',
    upgradeWebSocket((c) => {
      const sessionId = c.req.param('sessionId');

      return {
        onOpen() {
          if (!wsClients.has(sessionId)) {
            wsClients.set(sessionId, new Set());
          }
          wsClients.get(sessionId)!.add(this);
          console.log(`[${sessionId}] Client connected`);
        },
        onMessage(event, ws) {
          const data = JSON.parse(event.data as string);
          console.log(`[${sessionId}] Message from client:`, data);

          if (data.type === 'approval') {
            const session = sessions.get(sessionId);
            if (session) {
              session.approvalPending = false;
            }
          }
        },
        onClose() {
          wsClients.get(sessionId)?.delete(this);
          console.log(`[${sessionId}] Client disconnected`);
        },
      };
    })
  );
}
