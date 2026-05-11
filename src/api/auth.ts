import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { log } from '../lib/logger';
import { verifyPassword } from '../lib/auth';
import { getUserByUsername, getUserProjects, updateLastLogin } from '../services/user';
import { createServerSession, getSessionIdFromCookie, destroyServerSession, getServerSession } from '../services/session';

const SESSION_DURATION = 24 * 60 * 60 * 1000;

export function registerAuthRoutes(app: Hono) {
  // Login endpoint
  app.post('/api/auth/login', async (c) => {
    try {
      let body;
      try {
        body = await c.req.json<{ username: string; password: string }>();
      } catch (e) {
        log(`[LOGIN] JSON parse error: ${e}`);
        return c.json({ error: 'Invalid JSON' }, 400);
      }

      const { username, password } = body;
      log(`[LOGIN] Attempting login for username: ${username}`);

      if (!username || !password) {
        log('[LOGIN] Missing username or password');
        return c.json({ error: 'Username and password are required' }, 400);
      }

      const user = getUserByUsername(username);
      if (!user) {
        log(`[LOGIN] User not found: ${username}`);
        return c.json({ error: 'Invalid username or password' }, 401);
      }

      log(`[LOGIN] User found: ${username}, verifying password...`);
      const passwordMatch = await verifyPassword(password, user.password_hash);
      log(`[LOGIN] Password match result: ${passwordMatch}`);

      if (!passwordMatch) {
        log(`[LOGIN] Password mismatch for user: ${username}`);
        return c.json({ error: 'Invalid username or password' }, 401);
      }

      const projects = getUserProjects(user.id);
      const projectIds = projects.map((p) => p.id);

      const session = createServerSession(user.id, user.username, user.role, projectIds);
      updateLastLogin(user.id);

      const maxAge = Math.floor(SESSION_DURATION / 1000);
      const cookieValue = `session=${session.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
      c.header('Set-Cookie', cookieValue);
      log(`[LOGIN] Cookie set: ${cookieValue}`);

      log(`[LOGIN] Login successful for user: ${username}`);
      return c.json({
        success: true,
        username: user.username,
        role: user.role,
        projects: projectIds,
      });
    } catch (e) {
      log(`[LOGIN] Unexpected error: ${e}`);
      return c.json({ error: 'Login error: ' + (e instanceof Error ? e.message : String(e)) }, 500);
    }
  });

  // Logout endpoint
  app.post('/api/auth/logout', async (c) => {
    const sessionId = getSessionIdFromCookie(c);
    if (sessionId) {
      log(`[LOGOUT] Destroying session ${sessionId}`);
      destroyServerSession(sessionId);
    } else {
      log('[LOGOUT] No session ID found in cookie');
    }

    c.header('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    log('[LOGOUT] Logout successful');

    return c.json({ success: true });
  });

  // Get current user
  app.get('/api/auth/me', async (c) => {
    const cookieHeader = c.req.header('cookie');
    log(`[AUTH/ME] Cookie header: ${cookieHeader || 'NONE'}`);

    const sessionId = getSessionIdFromCookie(c);
    log(`[AUTH/ME] Extracted sessionId: ${sessionId || 'NONE'}`);

    if (!sessionId) {
      log('[AUTH/ME] No session ID found in cookie');
      return c.json({ authenticated: false }, 401);
    }

    const session = getServerSession(sessionId);
    log(`[AUTH/ME] Session lookup result: ${session ? 'FOUND' : 'NOT FOUND'}`);

    if (!session) {
      log('[AUTH/ME] Session not found or expired');
      return c.json({ authenticated: false }, 401);
    }

    log(`[AUTH/ME] Authentication successful for: ${session.username}`);
    return c.json({
      authenticated: true,
      userId: session.userId,
      username: session.username,
      role: session.role,
      projects: session.accessibleProjectIds,
    });
  });
}
