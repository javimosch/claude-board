import { randomUUID } from 'crypto';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import type { Project } from '../types';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'developer';
  created_at: number;
  created_by?: string;
  last_login?: number;
  is_active: number;
}

export async function createUser(
  username: string,
  password: string,
  role: 'admin' | 'developer' = 'developer',
  createdBy?: string
): Promise<User> {
  const id = randomUUID();
  const now = Date.now();
  const passwordHash = await hashPassword(password);

  const stmt = db.prepare(`
    INSERT INTO users (id, username, password_hash, role, created_at, created_by, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  stmt.run(id, username, passwordHash, role, now, createdBy || null);

  return { id, username, password_hash: passwordHash, role, created_at: now, created_by: createdBy, is_active: 1 };
}

export function getUserByUsername(username: string): User | null {
  const stmt = db.prepare(`
    SELECT id, username, password_hash, role, created_at, created_by, last_login, is_active
    FROM users
    WHERE username = ? AND is_active = 1
  `);
  return (stmt.get(username) as User) || null;
}

export function getUserById(userId: string): User | null {
  const stmt = db.prepare(`
    SELECT id, username, password_hash, role, created_at, created_by, last_login, is_active
    FROM users
    WHERE id = ? AND is_active = 1
  `);
  return (stmt.get(userId) as User) || null;
}

export function listUsers(): User[] {
  const stmt = db.prepare(`
    SELECT id, username, password_hash, role, created_at, created_by, last_login, is_active
    FROM users
    WHERE is_active = 1
    ORDER BY created_at DESC
  `);
  return stmt.all() as User[];
}

export function grantProjectAccess(userId: string, projectId: string, grantedBy: string): void {
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO user_project_access (id, user_id, project_id, granted_at, granted_by)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, userId, projectId, now, grantedBy);
}

export function revokeProjectAccess(userId: string, projectId: string): void {
  const stmt = db.prepare(`
    DELETE FROM user_project_access
    WHERE user_id = ? AND project_id = ?
  `);
  stmt.run(userId, projectId);
}

export function getUserProjects(userId: string): Project[] {
  const user = getUserById(userId);
  if (!user) return [];

  // Admins see all projects
  if (user.role === 'admin') {
    const stmt = db.prepare(`
      SELECT id, name, cwd, created_at, last_used
      FROM projects
      ORDER BY last_used DESC
    `);
    return stmt.all() as Project[];
  }

  // Developers only see their granted projects
  const stmt = db.prepare(`
    SELECT p.id, p.name, p.cwd, p.created_at, p.last_used
    FROM projects p
    INNER JOIN user_project_access upa ON p.id = upa.project_id
    WHERE upa.user_id = ?
    ORDER BY p.last_used DESC
  `);
  return stmt.all(userId) as Project[];
}

export function getProjectUsers(projectId: string): User[] {
  const stmt = db.prepare(`
    SELECT DISTINCT u.id, u.username, u.password_hash, u.role, u.created_at, u.created_by, u.last_login, u.is_active
    FROM users u
    INNER JOIN user_project_access upa ON u.id = upa.user_id
    WHERE upa.project_id = ? AND u.is_active = 1
  `);
  return stmt.all(projectId) as User[];
}

export function deleteUser(userId: string): void {
  const stmt = db.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`);
  stmt.run(userId);
}

export function updateLastLogin(userId: string): void {
  const stmt = db.prepare(`UPDATE users SET last_login = ? WHERE id = ?`);
  stmt.run(Date.now(), userId);
}
