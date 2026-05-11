import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { db } from '../lib/db';
import { getCurrentUser } from '../services/session';
import { getProject, getProjects, createProject, updateProject, deleteProject, getProjectStatuses, createProjectStatus, renameProjectStatus, updateStatusPositions, deleteProjectStatusWithMigration, updateSessionStatus, getSessionsByProjectAndStatus } from '../services/project';
import { saveSessionToDb, loadSessionFromDb, updateSessionName, deleteSessionFromDb, getSessionHistory } from '../lib/db';

// Re-exported from server.ts context (sessions map and claude executor)
export function registerProjectRoutes(app: Hono, sessions: Map<any, any>, executeClaudeWithStreaming: Function, getIndexHtml: () => string) {
  // Get all projects
  app.get('/api/projects', (c) => {
    const session = getCurrentUser(c);
    let projects = getProjects();
    if (session && session.role === 'developer') {
      projects = projects.filter(p => session.accessibleProjectIds.includes(p.id));
    }
    return c.json({ projects });
  });

  // Create project
  app.post('/api/projects', async (c) => {
    const { name, cwd } = await c.req.json<{ name: string; cwd: string }>();
    if (!name?.trim() || !cwd?.trim()) {
      return c.json({ error: 'Project name and working directory are required' }, 400);
    }
    try {
      const project = createProject(name.trim(), cwd.trim());
      return c.json(project);
    } catch (e) {
      return c.json({ error: `Failed to create project: ${e}` }, 400);
    }
  });

  // Update project
  app.put('/api/projects/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    const { name, cwd } = await c.req.json<{ name?: string; cwd?: string }>();
    try {
      const project = updateProject(projectId, name, cwd);
      return project ? c.json(project) : c.json({ error: 'Project not found' }, 404);
    } catch (e) {
      return c.json({ error: `Failed to update project: ${e}` }, 400);
    }
  });

  // Delete project
  app.delete('/api/projects/:projectId', (c) => {
    const projectId = c.req.param('projectId');
    try {
      deleteProject(projectId);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: `Failed to delete project: ${e}` }, 400);
    }
  });

  // Get project statuses
  app.get('/api/projects/:projectId/statuses', (c) => {
    const projectId = c.req.param('projectId');
    const project = getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    try {
      const statuses = getProjectStatuses(projectId);
      return c.json({ statuses });
    } catch (e) {
      return c.json({ error: `Failed to get statuses: ${e}` }, 400);
    }
  });

  // Create status
  app.post('/api/projects/:projectId/statuses', async (c) => {
    const projectId = c.req.param('projectId');
    const { name } = await c.req.json<{ name: string }>();
    if (!name?.trim()) {
      return c.json({ error: 'Status name is required' }, 400);
    }
    try {
      const status = createProjectStatus(projectId, name.trim());
      return c.json(status);
    } catch (e) {
      return c.json({ error: `${e}` }, 400);
    }
  });

  // Rename status
  app.put('/api/projects/:projectId/statuses/:statusId', async (c) => {
    const { projectId, statusId } = c.req.param();
    const { name } = await c.req.json<{ name: string }>();
    if (!name?.trim()) {
      return c.json({ error: 'Status name is required' }, 400);
    }
    try {
      const status = renameProjectStatus(projectId, statusId, name.trim());
      return c.json(status);
    } catch (e) {
      return c.json({ error: `${e}` }, 400);
    }
  });

  // Delete status
  app.delete('/api/projects/:projectId/statuses/:statusId', async (c) => {
    const { projectId, statusId } = c.req.param();
    let body: any = {};
    try {
      body = await c.req.json();
    } catch (e) {
      // Empty body is OK for this endpoint
    }
    try {
      const targetStatus = body?.targetStatus;
      if (targetStatus) {
        deleteProjectStatusWithMigration(projectId, statusId, targetStatus);
      } else {
        // Delete without migration (will throw error if sessions exist)
        const statusData = db.prepare('SELECT name FROM project_statuses WHERE id = ? AND project_id = ?').get(statusId, projectId) as any;
        if (!statusData) {
          return c.json({ error: 'Status not found' }, 404);
        }
        const sessionCount = db.prepare('SELECT COUNT(*) as count FROM session_history WHERE project_id = ? AND session_status = ?').get(projectId, statusData.name) as any;
        if (sessionCount.count > 0) {
          return c.json({ error: `Cannot delete status with ${sessionCount.count} sessions. Please provide targetStatus parameter.` }, 400);
        }
        db.prepare('DELETE FROM project_statuses WHERE id = ? AND project_id = ?').run(statusId, projectId);
      }
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: `${e}` }, 400);
    }
  });

  // Reorder statuses
  app.patch('/api/projects/:projectId/statuses/reorder', async (c) => {
    const projectId = c.req.param('projectId');
    const { statusIds } = await c.req.json<{ statusIds: string[] }>();
    if (!Array.isArray(statusIds) || statusIds.length === 0) {
      return c.json({ error: 'statusIds array is required' }, 400);
    }
    try {
      updateStatusPositions(projectId, statusIds);
      const statuses = getProjectStatuses(projectId);
      return c.json({ statuses });
    } catch (e) {
      return c.json({ error: `${e}` }, 400);
    }
  });
}

export function registerSessionRoutes(app: Hono, sessions: Map<any, any>) {
  // Get all sessions
  app.get('/api/sessions', (c) => {
    const history = getSessionHistory();
    return c.json({ sessions: history });
  });

  // Get single session
  app.get('/api/session/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    let session = sessions.get(sessionId);
    if (!session) {
      session = loadSessionFromDb(sessionId);
      if (session) {
        sessions.set(sessionId, session);
      }
    }
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({
      id: session.id,
      status: session.status,
      prompt: session.prompt,
      eventCount: session.events.length,
      events: session.events.map((e: any) => ({ type: e.type, uuid: e.uuid })),
      cardCount: session.cards.size,
      cards: Array.from(session.cards.values()),
      totalCost: session.totalCost,
      duration: session.endTime ? session.endTime - session.startTime : Date.now() - session.startTime,
      requiresApproval: session.requiresApproval,
      approvalPending: session.approvalPending,
      plannedTools: session.plannedTools,
      conversationCount: session.conversationHistory.length,
      hasFollowups: session.conversationHistory.length > 0,
    });
  });

  // Rename session
  app.post('/api/sessions/:sessionId/rename', async (c) => {
    const sessionId = c.req.param('sessionId');
    const { name } = await c.req.json<{ name: string }>();
    if (!name?.trim()) {
      return c.json({ error: 'Name is required' }, 400);
    }
    updateSessionName(sessionId, name.trim());
    return c.json({ success: true });
  });

  // Delete session
  app.delete('/api/sessions/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    deleteSessionFromDb(sessionId);
    sessions.delete(sessionId);
    return c.json({ success: true });
  });

  // Load session from database
  app.get('/api/sessions/:sessionId/load', (c) => {
    const sessionId = c.req.param('sessionId');
    let session = sessions.get(sessionId);
    if (!session) {
      session = loadSessionFromDb(sessionId);
      if (session) {
        sessions.set(sessionId, session);
      }
    }
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({
      id: session.id,
      status: session.status,
      prompt: session.prompt,
      cards: Array.from(session.cards.values()),
      conversationHistory: session.conversationHistory,
      totalCost: session.totalCost,
    });
  });

  // Move session to different status
  app.patch('/api/sessions/:sessionId/status', async (c) => {
    const sessionId = c.req.param('sessionId');
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    const newStatus = body?.status;
    if (!newStatus) {
      return c.json({ error: 'Status is required' }, 400);
    }
    try {
      const sessionData = db.prepare('SELECT project_id FROM session_history WHERE id = ?').get(sessionId) as any;
      if (!sessionData) {
        return c.json({ error: 'Session not found' }, 404);
      }
      const success = updateSessionStatus(sessionId, newStatus, sessionData.project_id);
      if (!success) {
        return c.json({ error: `Invalid status "${newStatus}" for this project` }, 400);
      }
      return c.json({ success: true, sessionId, newStatus });
    } catch (e) {
      return c.json({ error: `${e}` }, 400);
    }
  });
}
