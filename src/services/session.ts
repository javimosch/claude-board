import { randomUUID } from 'crypto';
import { log } from '../lib/logger';

export interface ServerSession {
  sessionId: string;
  userId: string;
  username: string;
  role: 'admin' | 'developer';
  accessibleProjectIds: string[];
  createdAt: number;
  expiresAt: number;
}

const serverSessions = new Map<string, ServerSession>();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export function createServerSession(
  userId: string,
  username: string,
  role: 'admin' | 'developer',
  accessibleProjectIds: string[]
): ServerSession {
  const sessionId = randomUUID();
  const now = Date.now();
  const session: ServerSession = {
    sessionId,
    userId,
    username,
    role,
    accessibleProjectIds,
    createdAt: now,
    expiresAt: now + SESSION_DURATION,
  };
  serverSessions.set(sessionId, session);
  log(`[SESSION] Created session ${sessionId} for user ${username} (${role}) with projects: ${accessibleProjectIds.join(',')}`);
  log(`[SESSION] Store now has ${serverSessions.size} sessions`);
  return session;
}

export function getServerSession(sessionId: string): ServerSession | null {
  log(`[SESSION] Looking up session ${sessionId}. Store has ${serverSessions.size} sessions`);
  const session = serverSessions.get(sessionId);
  if (!session) {
    log(`[SESSION] Session ${sessionId} NOT FOUND`);
    return null;
  }

  if (Date.now() > session.expiresAt) {
    log(`[SESSION] Session ${sessionId} EXPIRED (expires at ${new Date(session.expiresAt).toISOString()})`);
    serverSessions.delete(sessionId);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_DURATION;
  log(`[SESSION] Session ${sessionId} FOUND for user ${session.username}, refreshed expiration`);
  return session;
}

export function destroyServerSession(sessionId: string): void {
  serverSessions.delete(sessionId);
  log(`[SESSION] Destroyed session ${sessionId}. Store now has ${serverSessions.size} sessions`);
}

export function getSessionIdFromCookie(c: any): string | null {
  try {
    const cookieHeader = c.req.header('cookie');
    if (!cookieHeader) return null;
    const sessionMatch = cookieHeader.match(/(^|;\s*)session=([^;]+)/);
    return sessionMatch ? sessionMatch[2] : null;
  } catch (e) {
    return null;
  }
}

export function getCurrentUser(c: any): ServerSession | null {
  const sessionId = getSessionIdFromCookie(c);
  if (!sessionId) return null;
  return getServerSession(sessionId);
}

export function requireAuth(session: ServerSession | null, c: any): boolean {
  if (!session) {
    c.status(401);
    return false;
  }
  return true;
}

export function requireAdmin(session: ServerSession | null, c: any): boolean {
  if (!session || session.role !== 'admin') {
    c.status(403);
    return false;
  }
  return true;
}

export function hasProjectAccess(session: ServerSession, projectId: string): boolean {
  if (session.role === 'admin') return true;
  return session.accessibleProjectIds.includes(projectId);
}
