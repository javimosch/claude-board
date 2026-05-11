import { randomUUID } from 'crypto';
import { db } from '../lib/db';
import type { Project } from '../types';

export function createProject(name: string, cwd: string): Project {
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO projects (id, name, cwd, created_at, last_used)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, name, cwd, now, now);

  createDefaultStatuses(id);
  return { id, name, cwd, created_at: now, last_used: now };
}

export function getProjects(): Project[] {
  const stmt = db.prepare(`
    SELECT id, name, cwd, created_at, last_used
    FROM projects
    ORDER BY last_used DESC
  `);
  return stmt.all() as Project[];
}

export function getProject(projectId: string): Project | null {
  const stmt = db.prepare(`
    SELECT id, name, cwd, created_at, last_used
    FROM projects
    WHERE id = ?
  `);
  return (stmt.get(projectId) as Project) || null;
}

export function updateProject(projectId: string, name?: string, cwd?: string): Project | null {
  const existing = getProject(projectId);
  if (!existing) return null;

  const newName = name !== undefined ? name : existing.name;
  const newCwd = cwd !== undefined ? cwd : existing.cwd;
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE projects
    SET name = ?, cwd = ?, last_used = ?
    WHERE id = ?
  `);
  stmt.run(newName, newCwd, now, projectId);

  return { id: projectId, name: newName, cwd: newCwd, created_at: existing.created_at, last_used: now };
}

export function deleteProject(projectId: string) {
  const deleteStmt = db.prepare(`DELETE FROM projects WHERE id = ?`);
  deleteStmt.run(projectId);
}

// Status management
export interface ProjectStatus {
  id: string;
  project_id: string;
  name: string;
  position: number;
  created_at: number;
}

export function getProjectStatuses(projectId: string): ProjectStatus[] {
  const stmt = db.prepare(`
    SELECT id, project_id, name, position, created_at
    FROM project_statuses
    WHERE project_id = ?
    ORDER BY position
  `);
  const statuses = (stmt.all(projectId) as ProjectStatus[]) || [];

  if (statuses.length === 0) {
    return [
      { id: 'default-0', project_id: projectId, name: 'Backlog', position: 0, created_at: Date.now() },
      { id: 'default-1', project_id: projectId, name: 'In Progress', position: 1, created_at: Date.now() },
      { id: 'default-2', project_id: projectId, name: 'Completed', position: 2, created_at: Date.now() }
    ];
  }

  return statuses;
}

function createDefaultStatuses(projectId: string): void {
  const now = Date.now();
  const defaultStatuses = ['Backlog', 'In Progress', 'Completed'];

  defaultStatuses.forEach((status, idx) => {
    db.prepare(`
      INSERT INTO project_statuses (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), projectId, status, idx, now);
  });
}

export function updateSessionStatus(sessionId: string, newStatus: string, projectId: string): boolean {
  const statusExists = db.prepare(
    'SELECT COUNT(*) as count FROM project_statuses WHERE project_id = ? AND name = ?'
  ).get(projectId, newStatus) as any;

  if (statusExists.count === 0) {
    return false;
  }

  const stmt = db.prepare(`
    UPDATE session_history
    SET session_status = ?, last_accessed = ?
    WHERE id = ?
  `);
  stmt.run(newStatus, Date.now(), sessionId);

  return true;
}

export function createProjectStatus(projectId: string, name: string): ProjectStatus {
  const project = getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const existing = db.prepare(
    'SELECT COUNT(*) as count FROM project_statuses WHERE project_id = ? AND name = ?'
  ).get(projectId, name) as any;

  if (existing.count > 0) {
    throw new Error(`Status "${name}" already exists for this project`);
  }

  const maxPos = db.prepare(
    'SELECT MAX(position) as maxPos FROM project_statuses WHERE project_id = ?'
  ).get(projectId) as any;

  const newPosition = (maxPos.maxPos || -1) + 1;
  const statusId = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO project_statuses (id, project_id, name, position, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(statusId, projectId, name, newPosition, now);

  return { id: statusId, project_id: projectId, name, position: newPosition, created_at: now };
}

export function renameProjectStatus(projectId: string, statusId: string, newName: string): ProjectStatus {
  const project = getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const existing = db.prepare(
    'SELECT COUNT(*) as count FROM project_statuses WHERE project_id = ? AND name = ? AND id != ?'
  ).get(projectId, newName, statusId) as any;

  if (existing.count > 0) {
    throw new Error(`Status "${newName}" already exists for this project`);
  }

  const status = db.prepare(
    'SELECT * FROM project_statuses WHERE id = ? AND project_id = ?'
  ).get(statusId, projectId) as ProjectStatus;

  if (!status) {
    throw new Error('Status not found');
  }

  const oldName = status.name;

  db.prepare(`
    UPDATE project_statuses
    SET name = ?
    WHERE id = ? AND project_id = ?
  `).run(newName, statusId, projectId);

  db.prepare(`
    UPDATE session_history
    SET session_status = ?
    WHERE project_id = ? AND session_status = ?
  `).run(newName, projectId, oldName);

  return { ...status, name: newName };
}

export function updateStatusPositions(projectId: string, statusIds: string[]): void {
  statusIds.forEach((statusId, idx) => {
    db.prepare('UPDATE project_statuses SET position = ? WHERE id = ? AND project_id = ?')
      .run(idx, statusId, projectId);
  });
}

export function deleteProjectStatusWithMigration(projectId: string, statusId: string, targetStatusName: string): void {
  const project = getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const status = db.prepare(
    'SELECT * FROM project_statuses WHERE id = ? AND project_id = ?'
  ).get(statusId, projectId) as ProjectStatus;

  if (!status) {
    throw new Error('Status not found');
  }

  const statusCount = db.prepare(
    'SELECT COUNT(*) as count FROM project_statuses WHERE project_id = ?'
  ).get(projectId) as any;

  if (statusCount.count <= 1) {
    throw new Error('Cannot delete the last status. A project must have at least one status.');
  }

  const targetStatus = db.prepare(
    'SELECT * FROM project_statuses WHERE project_id = ? AND name = ?'
  ).get(projectId, targetStatusName) as ProjectStatus;

  if (!targetStatus) {
    throw new Error('Target status not found');
  }

  db.prepare(`
    UPDATE session_history
    SET session_status = ?
    WHERE project_id = ? AND session_status = ?
  `).run(targetStatusName, projectId, status.name);

  db.prepare(`
    DELETE FROM project_statuses
    WHERE id = ? AND project_id = ?
  `).run(statusId, projectId);

  const remaining = db.prepare(
    'SELECT id FROM project_statuses WHERE project_id = ? ORDER BY position'
  ).all(projectId) as any[];

  remaining.forEach((s, idx) => {
    db.prepare('UPDATE project_statuses SET position = ? WHERE id = ?').run(idx, s.id);
  });
}

export function getSessionsByProjectAndStatus(projectId: string, status?: string): any[] {
  let query = `
    SELECT id, name, model, initial_prompt, created_at, last_accessed,
           total_cost, status, cards, conversation_history, events,
           project_id, cwd, user_id, session_status
    FROM session_history
    WHERE project_id = ?
  `;

  const params: any[] = [projectId];

  if (status) {
    query += ` AND session_status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC`;

  const stmt = db.prepare(query);
  return stmt.all(...params) as any[];
}
