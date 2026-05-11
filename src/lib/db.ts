import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { ExecutionSession } from '../types';

export const db = new Database('claude-sessions.db');

// Initialize all database tables
export function initializeDatabase() {
  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      cwd TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL
    );
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_history (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'sonnet',
      initial_prompt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      total_cost REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      cards TEXT,
      conversation_history TEXT,
      events TEXT,
      project_id TEXT DEFAULT 'default',
      cwd TEXT
    );
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      created_at INTEGER NOT NULL,
      created_by TEXT,
      last_login INTEGER,
      is_active INTEGER DEFAULT 1
    );
  `);

  // User-project access table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_project_access (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      granted_at INTEGER NOT NULL,
      granted_by TEXT NOT NULL,
      UNIQUE(user_id, project_id)
    );
  `);

  // Project statuses table
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id, name)
    );
  `);

  // Schema migrations
  runMigrations();

  console.log('✅ Database initialized');
}

function runMigrations() {
  try {
    const checkProjectId = db.prepare(`PRAGMA table_info(session_history);`).all() as any[];
    const hasProjectId = checkProjectId.some((col) => col.name === 'project_id');
    const hasCwd = checkProjectId.some((col) => col.name === 'cwd');
    const hasUserId = checkProjectId.some((col) => col.name === 'user_id');
    const hasSessionStatus = checkProjectId.some((col) => col.name === 'session_status');

    if (!hasProjectId) {
      console.log('🔄 Migrating: Adding project_id column...');
      db.exec(`ALTER TABLE session_history ADD COLUMN project_id TEXT DEFAULT 'default';`);
    }

    if (!hasCwd) {
      console.log('🔄 Migrating: Adding cwd column...');
      db.exec(`ALTER TABLE session_history ADD COLUMN cwd TEXT;`);
    }

    if (!hasUserId) {
      console.log('🔄 Migrating: Adding user_id column...');
      db.exec(`ALTER TABLE session_history ADD COLUMN user_id TEXT;`);
    }

    if (!hasSessionStatus) {
      console.log('🔄 Migrating: Adding session_status column...');
      db.exec(`ALTER TABLE session_history ADD COLUMN session_status TEXT DEFAULT 'Backlog';`);
    }
  } catch (e) {
    console.log('✅ Database schema up to date');
  }
}

// Session persistence
export function saveSessionToDb(sessionId: string, session: ExecutionSession) {
  const now = Date.now();
  const name = session.prompt.substring(0, 50) + (session.prompt.length > 50 ? '...' : '');

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO session_history
    (id, name, model, initial_prompt, created_at, last_accessed, total_cost, status, cards, conversation_history, events, project_id, cwd, session_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const cardsArray = Array.from(session.cards.values());
  const sessionStatus = (session as any).session_status || 'Backlog';

  stmt.run(
    sessionId,
    name,
    'sonnet',
    session.prompt,
    now,
    now,
    session.totalCost,
    session.status,
    JSON.stringify(cardsArray),
    JSON.stringify(session.conversationHistory),
    JSON.stringify(session.events),
    session.projectId || 'default',
    session.cwd || '',
    sessionStatus
  );
}

export function loadSessionFromDb(sessionId: string): ExecutionSession | null {
  const stmt = db.prepare(`
    SELECT id, name, model, initial_prompt, created_at, last_accessed, total_cost, status, cards, conversation_history, events, project_id, cwd, session_status
    FROM session_history
    WHERE id = ?
  `);
  const row = stmt.get(sessionId) as any;

  if (!row) return null;

  return {
    id: row.id,
    prompt: row.initial_prompt,
    cards: new Map(JSON.parse(row.cards || '[]').map((c: any) => [c.id, c])),
    conversationHistory: JSON.parse(row.conversation_history || '[]'),
    events: JSON.parse(row.events || '[]'),
    totalCost: row.total_cost,
    status: row.status,
    projectId: row.project_id,
    cwd: row.cwd,
    session_status: row.session_status,
  } as any;
}

export function getSessionHistory() {
  const stmt = db.prepare(`
    SELECT id, name, model, initial_prompt, created_at, last_accessed, total_cost, project_id, cwd, session_status
    FROM session_history
    ORDER BY last_accessed DESC
    LIMIT 50
  `);
  return stmt.all() as any[];
}

export function updateSessionName(sessionId: string, name: string) {
  const stmt = db.prepare(`UPDATE session_history SET name = ? WHERE id = ?`);
  stmt.run(name, sessionId);
}

export function deleteSessionFromDb(sessionId: string) {
  const stmt = db.prepare(`DELETE FROM session_history WHERE id = ?`);
  stmt.run(sessionId);
}

// Project status initialization
export function initializeProjectStatuses() {
  const projects = db.prepare('SELECT id FROM projects').all() as any[];
  const now = Date.now();
  const defaultStatuses = ['Backlog', 'In Progress', 'Completed'];

  projects.forEach((p: any) => {
    const existing = db.prepare(
      'SELECT COUNT(*) as count FROM project_statuses WHERE project_id = ?'
    ).get(p.id) as any;

    if (existing.count === 0) {
      defaultStatuses.forEach((status, idx) => {
        db.prepare(`
          INSERT INTO project_statuses (id, project_id, name, position, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(randomUUID(), p.id, status, idx, now);
      });
      console.log(`✅ Created default statuses for project ${p.id}`);
    }
  });
}
