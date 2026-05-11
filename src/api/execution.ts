import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getProject } from '../services/project';
import { saveSessionToDb } from '../lib/db';
import type { ExecutionSession } from '../types';

export function registerExecutionRoutes(
  app: Hono,
  sessions: Map<string, ExecutionSession>,
  wsClients: Map<string, Set<any>>,
  executeClaudeWithStreaming: Function
) {
  // Plan endpoint (dontAsk mode)
  app.post('/api/plan', async (c) => {
    const { prompt, projectId } = await c.json<{ prompt: string; projectId?: string }>();
    const sessionId = randomUUID();

    if (!projectId) {
      return c.json({ error: 'Project selection is required. Please select or create a project first.' }, 400);
    }

    const project = getProject(projectId);
    if (!project) {
      return c.json({ error: `Project not found: ${projectId}` }, 404);
    }

    const session: ExecutionSession = {
      id: sessionId,
      status: 'planning',
      prompt,
      cards: new Map(),
      events: [],
      totalCost: 0,
      startTime: Date.now(),
      requiresApproval: true,
      approvalPending: true,
      projectId,
      cwd: project.cwd,
      conversationHistory: [],
    } as any;

    sessions.set(sessionId, session);
    wsClients.set(sessionId, new Set());

    executeClaudeWithStreaming(prompt, sessionId, sessions, (session as any)._converter, (sessionId: string, event: any) => {}, 'plan', 'sonnet', projectId).catch((err: Error) => {
      console.error(`[${sessionId}] Execution error:`, err);
      session.status = 'error';
    });

    return c.json({ sessionId, status: 'planning' });
  });

  // Execute endpoint (bypassPermissions mode)
  app.post('/api/execute', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      console.error('JSON parse error:', e);
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const prompt = body?.prompt?.trim?.() || '';
    const model = body?.model || 'sonnet';
    const projectId = body?.projectId;
    const sessionId = randomUUID();

    console.log(`[${sessionId}] POST /api/execute - prompt: "${prompt}"`);
    console.log(`[${sessionId}] POST /api/execute - model: ${model}`);
    console.log(`[${sessionId}] POST /api/execute - projectId: ${projectId}`);

    if (!prompt) {
      console.error(`[${sessionId}] Empty prompt received!`);
      return c.json({ error: 'Prompt is required', received: body }, 400);
    }

    if (!projectId) {
      return c.json({ error: 'Project selection is required. Please select or create a project first.' }, 400);
    }

    const project = getProject(projectId);
    if (!project) {
      return c.json({ error: `Project not found: ${projectId}` }, 404);
    }

    const session: ExecutionSession = {
      id: sessionId,
      status: 'executing',
      prompt,
      cards: new Map(),
      events: [],
      totalCost: 0,
      startTime: Date.now(),
      requiresApproval: false,
      conversationHistory: [],
      projectId,
      cwd: project.cwd,
      session_status: 'Backlog',
    } as any;

    sessions.set(sessionId, session);
    wsClients.set(sessionId, new Set());

    saveSessionToDb(sessionId, session);
    console.log(`[${sessionId}] 💾 Session saved to database immediately`);

    executeClaudeWithStreaming(prompt, sessionId, sessions, (session as any)._converter, (sessionId: string, event: any) => {}, 'execute', model, projectId).catch((err: Error) => {
      console.error(`[${sessionId}] Execution error:`, err);
      session.status = 'error';
    });

    return c.json({ sessionId, status: 'executing' });
  });

  // Follow-up endpoint
  app.post('/api/session/:sessionId/followup', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const followupPrompt = body?.prompt?.trim?.() || '';
    const model = body?.model || 'sonnet';
    if (!followupPrompt) {
      return c.json({ error: 'Prompt is required' }, 400);
    }

    console.log(`[${sessionId}] 💬 Follow-up: "${followupPrompt}"`);
    console.log(`[${sessionId}] Model: ${model}`);

    let context = '';
    for (const msg of session.conversationHistory) {
      context += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n\n`;
    }
    context += `User: ${followupPrompt}`;

    console.log(`[${sessionId}] 📋 Context built with ${session.conversationHistory.length} previous messages`);

    session.status = 'executing';
    session.endTime = undefined;

    executeClaudeWithStreaming(context, sessionId, sessions, (session as any)._converter, (sessionId: string, event: any) => {}, 'execute', model).catch((err: Error) => {
      console.error(`[${sessionId}] Follow-up error:`, err);
      session.status = 'error';
    });

    return c.json({ sessionId, status: 'executing' });
  });
}
