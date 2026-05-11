import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import { createInterface } from 'readline';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

// Import from new modular structure
import { db, initializeDatabase, saveSessionToDb, loadSessionFromDb, getSessionHistory, updateSessionName, deleteSessionFromDb, initializeProjectStatuses } from './lib/db';
import { log } from './lib/logger';
import { hashPassword, verifyPassword } from './lib/auth';
import { createUser, getUserByUsername, getUserById, listUsers, getUserProjects, grantProjectAccess, revokeProjectAccess, getProjectUsers, deleteUser, updateLastLogin } from './services/user';
import { createServerSession, getServerSession, destroyServerSession, getSessionIdFromCookie, getCurrentUser, requireAuth, requireAdmin, hasProjectAccess } from './services/session';
import { createProject, getProjects, getProject, updateProject, deleteProject, getProjectStatuses, createProjectStatus, renameProjectStatus, updateStatusPositions, deleteProjectStatusWithMigration, getSessionsByProjectAndStatus, updateSessionStatus } from './services/project';
import { parseJsonlStream } from './services/parser';
import { KanbanConverter } from './services/kanban';
import { registerAuthRoutes } from './api/auth';
import { registerProjectRoutes, registerSessionRoutes } from './api/routes';
import { registerExecutionRoutes } from './api/execution';
import { registerWebSocketRoute } from './ws/handlers';
import { executeClaudeWithStreaming, createBroadcaster } from './services/claude';

const execAsync = promisify(exec);
import type {
  StreamEvent,
  AssistantMessage,
  KanbanCard,
  KanbanEvent,
  ExecutionSession,
  Project,
} from './types';

const app = new Hono();

// Initialize database
initializeDatabase();

// Initialize default admin user if no users exist
async function initializeDefaultUser() {
  const users = listUsers();
  if (users.length === 0) {
    console.log('👤 Creating default admin user (admin/admin)...');
    await createUser('admin', 'admin', 'admin');
    console.log('✅ Default admin user created. Use bin/create-user to add developers.');
  }
}

// Call initialization
initializeDefaultUser().catch(console.error);
initializeProjectStatuses();

// Project and Status management now imported from services/project.ts

// User and Session management now imported from services/user.ts and services/session.ts
const sessions = new Map<string, ExecutionSession>();
const wsClients = new Map<string, Set<any>>();

// Event parsing and Kanban conversion now imported from services/
const converter = new KanbanConverter();

// Claude executor imported from services/claude.ts
// Broadcaster function for WebSocket clients

// ============================================================================
// WebSocket & Broadcasting
// ============================================================================

function broadcastToSession(sessionId: string, event: KanbanEvent) {
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
}

// ============================================================================
// Register Modular Routes
// ============================================================================

// Wrapper that provides converter and broadcaster to executeClaudeWithStreaming
const executeWithContext = (prompt: string, sessionId: string, _sessions: any, _converter: any, _broadcaster: any, mode: string, model: string, projectId: string) => {
  return executeClaudeWithStreaming(prompt, sessionId, sessions, converter, broadcastToSession, mode, model, projectId);
};

registerAuthRoutes(app);
registerProjectRoutes(app, sessions, executeWithContext, getIndexHtml);
registerSessionRoutes(app, sessions);
registerWebSocketRoute(app, sessions, wsClients);
registerExecutionRoutes(app, sessions, wsClients, executeWithContext);

// ============================================================================
// [DEPRECATED - Phase 4 Cleanup] OLD Endpoint Definitions Removed
// ============================================================================
// Previously defined endpoints (now handled by modular registration functions):
// - /ws/:sessionId → src/ws/handlers.ts (registerWebSocketRoute)
// - /api/auth/* → src/api/auth.ts (registerAuthRoutes)
// - /api/plan, /api/execute, /api/session/:id/followup → src/api/execution.ts (registerExecutionRoutes)
// - /api/sessions/* → src/api/routes.ts (registerSessionRoutes)
// - /api/projects/* → src/api/routes.ts (registerProjectRoutes)
//
// All route handlers have been extracted to modular files above.
// Server.ts now contains only: Claude executor, broadcaster, React components, and initialization logic.
// ============================================================================


// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Serve static frontend
app.get('/', (c) => c.html(getIndexHtml()));

// ============================================================================
// Static HTML
// ============================================================================

function getIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Streaming Mode</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --bg-primary: #FBFBFA;
      --bg-secondary: #FFFFFF;
      --text-primary: #111111;
      --text-secondary: #787774;
      --border-color: #EAEAEA;
      --accent-blue: #E1F3FE;
      --accent-blue-text: #1F6C9F;
      --accent-green: #EDF3EC;
      --accent-green-text: #346538;
    }

    body { background: var(--bg-primary); color: var(--text-primary); }
    .card { border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); }
    .border-line { border-color: var(--border-color); }
    .text-muted { color: var(--text-secondary); }
    .btn-primary { background: #111111; color: white; border-radius: 5px; padding: 10px 16px; border: none; cursor: pointer; transition: all 200ms; }
    .btn-primary:hover { background: #2F3437; transform: scale(0.98); }
    .tag { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; }
  </style>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body style="background: #FBFBFA; color: #111111; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6;">
  <div id="root"></div>

  <script type="text/babel">
    const { useState, useEffect, useRef } = React;

    function KanbanCard({ card, onClick }) {
      const statusColors = {
        pending: { bg: '#F7F6F3', label: 'Pending' },
        'in-progress': { bg: '#E1F3FE', label: 'In Progress' },
        success: { bg: '#EDF3EC', label: 'Done' },
        error: { bg: '#FDEBEC', label: 'Error' },
        warning: { bg: '#FBF3DB', label: 'Warning' },
      };

      const statusStyle = statusColors[card.status] || statusColors.pending;

      return (
        <div
          onClick={onClick}
          style={{ background: statusStyle.bg, border: '1px solid #EAEAEA', borderRadius: '8px', padding: '16px', marginBottom: '12px', cursor: 'pointer', transition: 'all 200ms' }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
        >
          <h4 style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '8px', color: '#111111' }}>{card.title}</h4>
          <p style={{ fontSize: '0.75rem', color: '#787774', maxHeight: '128px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {card.content}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #EAEAEA' }}>
            <span style={{ fontSize: '0.7rem', color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {statusStyle.label}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#787774' }}>{new Date(card.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
      );
    }

    function CardModal({ card, onClose }) {
      const [copied, setCopied] = useState(false);
      const [fullscreen, setFullscreen] = useState(false);

      const handleCopy = async () => {
        try {
          await navigator.clipboard.writeText(card.content);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          alert('Failed to copy');
        }
      };

      return (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: fullscreen ? 0 : '16px' }}
          onClick={onClose}
        >
          <div
            style={{ background: '#FFFFFF', borderRadius: fullscreen ? 0 : '8px', maxWidth: fullscreen ? '100%' : '640px', width: '100%', maxHeight: fullscreen ? '100vh' : '80vh', height: fullscreen ? '100vh' : 'auto', overflow: 'auto', border: '1px solid #EAEAEA' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ position: 'sticky', top: 0, background: '#FFFFFF', borderBottom: '1px solid #EAEAEA', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111111', wordBreak: 'break-word', flex: 1 }}>{card.title}</h2>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  onClick={() => setFullscreen(!fullscreen)}
                  style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#787774', padding: '4px 8px', transition: 'color 200ms' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#111111'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#787774'}
                  title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {fullscreen ? '✕' : '⛶'}
                </button>
                <button
                  onClick={onClose}
                  style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#787774', padding: '0 4px', transition: 'color 200ms' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#111111'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#787774'}
                >
                  ×
                </button>
              </div>
            </div>
            <div style={{ padding: fullscreen ? '32px' : '24px', maxWidth: fullscreen ? '900px' : 'none', margin: fullscreen ? '0 auto' : 'auto' }}>
              <p style={{ fontSize: fullscreen ? '1rem' : '0.875rem', color: '#111111', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '16px', lineHeight: fullscreen ? 1.7 : 1.6 }}>
                {card.content}
              </p>
              <p style={{ fontSize: '0.75rem', color: '#787774', marginBottom: '24px' }}>
                {new Date(card.timestamp).toLocaleString()}
              </p>
              <button
                onClick={handleCopy}
                style={{ width: fullscreen ? 'auto' : '100%', padding: '12px 16px', background: copied ? '#EDF3EC' : '#111111', color: copied ? '#346538' : '#FFFFFF', border: 'none', borderRadius: '5px', fontWeight: 600, cursor: 'pointer', transition: 'all 200ms' }}
                onMouseEnter={(e) => { if (!copied) e.currentTarget.style.background = '#2F3437'; }}
                onMouseLeave={(e) => { if (!copied) e.currentTarget.style.background = '#111111'; }}
              >
                {copied ? '✓ Copied' : 'Copy to clipboard'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    function KanbanBoard({ sessionId, onReset, model = 'sonnet', sessions = [], onSessionClick, onSessionRename, onSessionDelete, sidebarOpen, onToggleSidebar, projects = [], selectedProjectId, onProjectClick, onProjectCreate, onProjectEdit, onProjectDelete, onNewSession }) {
      const [session, setSession] = useState(null);
      const [cards, setCards] = useState({ THINKING: [], ACTIONS: [], FEEDBACK: [], COMPLETE: [] });
      const [followupPrompt, setFollowupPrompt] = useState('');
      const [isFollowupLoading, setIsFollowupLoading] = useState(false);
      const [expandedCard, setExpandedCard] = useState(null);
      const wsRef = useRef(null);
      const pollRef = useRef(null);

      useEffect(() => {
        // Immediately load session data (important for resumed sessions after refresh)
        const loadSessionData = async () => {
          try {
            const resp = await fetch(\`/api/session/\${sessionId}\`);
            const data = await resp.json();
            setSession(data);

            // Convert cards from API response to grouped by column
            if (data.cards && data.cards.length > 0) {
              const grouped = { THINKING: [], ACTIONS: [], FEEDBACK: [], COMPLETE: [] };
              for (const card of data.cards) {
                grouped[card.column].push(card);
              }
              setCards(grouped);
            }
          } catch (e) {
            console.error('Failed to load session:', e);
          }
        };

        loadSessionData();

        // WebSocket connection
        const ws = new WebSocket(\`ws://\${window.location.host}/ws/\${sessionId}\`);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          const kanbanEvent = JSON.parse(event.data);

          if (kanbanEvent.type === 'card:add' && kanbanEvent.card) {
            setCards((prev) => ({
              ...prev,
              [kanbanEvent.card.column]: [
                ...prev[kanbanEvent.card.column],
                kanbanEvent.card,
              ],
            }));
          } else if (kanbanEvent.type === 'session:end') {
            setSession((prev) => ({
              ...prev,
              status: 'completed',
              totalCost: kanbanEvent.cost || 0,
            }));
          }
        };

        // Poll for session state (keep polling for follow-ups)
        const poll = setInterval(async () => {
          const resp = await fetch(\`/api/session/\${sessionId}\`);
          const data = await resp.json();
          setSession(data);

          // Convert cards from API response to grouped by column
          if (data.cards && data.cards.length > 0) {
            const grouped = { THINKING: [], ACTIONS: [], FEEDBACK: [], COMPLETE: [] };
            for (const card of data.cards) {
              grouped[card.column].push(card);
            }
            setCards(grouped);
          }

          // Keep polling even after completion to support follow-ups
          // Don't clear the interval
        }, 500);

        pollRef.current = poll;

        return () => {
          ws.close();
          clearInterval(poll);
        };
      }, [sessionId]);

      const handleFollowup = async () => {
        if (!followupPrompt.trim()) return;
        setIsFollowupLoading(true);

        try {
          const resp = await fetch(\`/api/session/\${sessionId}/followup\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: followupPrompt, model }),
          });
          const data = await resp.json();
          if (data.sessionId) {
            setFollowupPrompt('');
          }
        } catch (e) {
          alert('Error: ' + e.message);
        } finally {
          setIsFollowupLoading(false);
        }
      };

      return (
        <div style={{ display: 'flex', minHeight: '100vh', background: '#FBFBFA' }}>
          <SessionSidebar
            sessions={sessions}
            projects={projects}
            selectedProjectId={selectedProjectId}
            activeSessionId={sessionId}
            onSessionClick={onSessionClick}
            onSessionRename={onSessionRename}
            onSessionDelete={onSessionDelete}
            onNewSession={onNewSession}
            isOpen={sidebarOpen}
            onToggle={onToggleSidebar}
            onProjectClick={onProjectClick}
            onProjectCreate={onProjectCreate}
            onProjectEdit={onProjectEdit}
            onProjectDelete={onProjectDelete}
          />
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#FBFBFA', width: '100%' }}>
              <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
              <div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px', color: '#111111' }}>Streaming Session</h1>
                <button onClick={onReset} style={{ marginTop: '8px', padding: '6px 12px', background: '#EAEAEA', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#111111' }}>← Back to Project</button>
                {session && (
                  <div style={{ fontSize: '0.875rem', color: '#787774', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <p>Project: <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#111111' }}>{projects.find(p => p.id === session.project_id)?.name || 'Unknown'}</span></p>
                    <p>Session: <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#111111' }}>{sessionId.substring(0, 8)}...</span></p>
                    <p>Status: <span style={{ textTransform: 'capitalize', fontWeight: 600, color: '#111111' }}>{session.status}</span></p>
                    <p>Cost: <span style={{ color: '#111111', fontWeight: 600 }}>{'$' + (session.totalCost?.toFixed(4) || '0.0000')}</span></p>
                    <p>Duration: <span style={{ color: '#111111', fontWeight: 600 }}>{Math.round(session.duration / 1000)}s</span></p>
                    {session.hasFollowups && <p style={{ color: '#1F6C9F', marginTop: '8px' }}>↳ {session.conversationCount} conversation{session.conversationCount !== 1 ? 's' : ''}</p>}
                  </div>
                )}
              </div>
            </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {['THINKING', 'ACTIONS', 'FEEDBACK', 'COMPLETE'].map((col) => (
              <div key={col}>
                <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '12px', color: '#111111', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: '8px', borderBottom: '1px solid #EAEAEA' }}>
                  {col}
                </h2>
                <div>
                  {cards[col]?.map((card) => (
                    <KanbanCard
                      key={card.id}
                      card={card}
                      onClick={() => setExpandedCard(card)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {session?.status === 'completed' && (
            <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '8px', border: '1px solid #EAEAEA' }}>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '12px', color: '#111111' }}>Follow-up</h3>
              <textarea
                value={followupPrompt}
                onChange={(e) => setFollowupPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    handleFollowup();
                  }
                }}
                placeholder="Ask a follow-up question..."
                style={{ width: '100%', height: '80px', background: '#F7F6F3', border: '1px solid #EAEAEA', borderRadius: '5px', padding: '12px', fontSize: '1rem', color: '#111111', fontFamily: 'inherit', marginBottom: '12px', resize: 'vertical' }}
              />
              <button
                onClick={handleFollowup}
                disabled={isFollowupLoading || !followupPrompt.trim()}
                style={{ width: '100%', background: isFollowupLoading || !followupPrompt.trim() ? '#EAEAEA' : '#111111', color: isFollowupLoading || !followupPrompt.trim() ? '#787774' : '#FFFFFF', fontWeight: 600, padding: '10px 16px', borderRadius: '5px', border: 'none', cursor: isFollowupLoading || !followupPrompt.trim() ? 'not-allowed' : 'pointer', fontSize: '0.875rem', transition: 'all 200ms' }}
                onMouseEnter={(e) => { if (!isFollowupLoading && followupPrompt.trim()) e.currentTarget.style.background = '#2F3437'; }}
                onMouseLeave={(e) => { if (!isFollowupLoading && followupPrompt.trim()) e.currentTarget.style.background = '#111111'; }}
              >
                {isFollowupLoading ? 'Sending...' : 'Send'}
              </button>
            </div>
          )}

          {expandedCard && (
            <CardModal
              card={expandedCard}
              onClose={() => setExpandedCard(null)}
            />
          )}
          </div>
        </div>
      );
    }

    function LoginScreen({ onLogin }) {
      const [username, setUsername] = useState('');
      const [password, setPassword] = useState('');
      const [error, setError] = useState('');

      const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });

          const data = await response.json();

          if (response.ok) {
            onLogin();
          } else {
            setError(data.error || 'Login failed');
            setPassword('');
          }
        } catch (e) {
          setError('Login error: ' + (e instanceof Error ? e.message : String(e)));
          setPassword('');
        }
      };

      return (
        <div style={{ position: 'fixed', inset: 0, background: '#FBFBFA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '8px', padding: '32px', border: '1px solid #EAEAEA', width: '100%', maxWidth: '384px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '8px', color: '#111111' }}>
              Claude Streaming
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#787774', marginBottom: '24px' }}>Session-based conversation interface with real-time Kanban visualization</p>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: '#111111' }}>
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{ width: '100%', background: '#F7F6F3', border: '1px solid #EAEAEA', borderRadius: '5px', padding: '10px 12px', color: '#111111', fontSize: '1rem', fontFamily: 'inherit' }}
                  placeholder="admin"
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: '#111111' }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', background: '#F7F6F3', border: '1px solid #EAEAEA', borderRadius: '5px', padding: '10px 12px', color: '#111111', fontSize: '1rem', fontFamily: 'inherit' }}
                  placeholder="admin"
                />
              </div>
              {error && <p style={{ color: '#9F2F2D', fontSize: '0.875rem' }}>{error}</p>}
              <button
                type="submit"
                style={{ width: '100%', background: '#111111', color: '#FFFFFF', fontWeight: 600, padding: '12px 16px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '1rem', transition: 'all 200ms', marginTop: '8px' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#2F3437'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#111111'}
              >
                Sign in
              </button>
            </form>

            <p style={{ fontSize: '0.75rem', color: '#787774', marginTop: '16px', textAlign: 'center' }}>
              Demo credentials: admin / admin
            </p>
          </div>
        </div>
      );
    }

    function ProjectSelector({ projects = [], selectedProjectId, onProjectClick, onProjectCreate, onProjectEdit, onProjectDelete }) {
      const [isCreating, setIsCreating] = useState(false);
      const [newProjectName, setNewProjectName] = useState('');
      const [newProjectCwd, setNewProjectCwd] = useState('');
      const [editingId, setEditingId] = useState(null);
      const [editingName, setEditingName] = useState('');
      const [editingCwd, setEditingCwd] = useState('');
      const [error, setError] = useState('');
      const [isExpanded, setIsExpanded] = useState(false);
      const [searchQuery, setSearchQuery] = useState('');

      const handleCreate = async () => {
        if (!newProjectName.trim() || !newProjectCwd.trim()) {
          setError('Name and path are required');
          return;
        }
        try {
          await onProjectCreate(newProjectName.trim(), newProjectCwd.trim());
          setNewProjectName('');
          setNewProjectCwd('');
          setIsCreating(false);
          setError('');
        } catch (e) {
          setError('Failed to create project: ' + e.message);
        }
      };

      const handleEdit = async (projectId) => {
        try {
          await onProjectEdit(projectId, editingName.trim() || undefined, editingCwd.trim() || undefined);
          setEditingId(null);
          setError('');
        } catch (e) {
          setError('Failed to update project: ' + e.message);
        }
      };

      const handleProjectSelect = (projectId) => {
        onProjectClick(projectId);
        setIsExpanded(false);
        setSearchQuery('');
      };

      const sortedProjects = [...projects].sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
      const filteredProjects = sortedProjects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

      const selectedProject = projects.find(p => p.id === selectedProjectId);

      return (
        <div style={{ padding: '12px', borderBottom: '1px solid #EAEAEA', background: '#FBFBFA' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isExpanded ? '12px' : (selectedProject ? '8px' : 0) }}>
            {!isExpanded && (
              <div>
                <h3 style={{ fontSize: '0.75rem', fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                  Projects
                </h3>
                {selectedProject && (
                  <p style={{ fontSize: '0.7rem', color: '#111111', fontWeight: 600, margin: '4px 0 0 0' }}>
                    {selectedProject.name}
                  </p>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', marginLeft: isExpanded ? 'auto' : 'auto' }}>
              <button
                onClick={() => {
                  setIsExpanded(!isExpanded);
                  if (!isExpanded) {
                    setTimeout(() => {
                      const searchInput = document.querySelector('input[placeholder="Search projects"]');
                      if (searchInput) searchInput.focus();
                    }, 0);
                  }
                }}
                style={{ background: '#111111', color: '#FFFFFF', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, minWidth: '30px' }}
                title="Search projects"
              >
                🔍
              </button>
              <button
                onClick={() => setIsCreating(!isCreating)}
                style={{ background: '#111111', color: '#FFFFFF', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
              >
                {isCreating ? '✕' : '+ New'}
              </button>
            </div>
          </div>

          {isExpanded && (
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Search projects"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: '#FFFFFF', color: '#111111', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #EAEAEA', marginBottom: '8px' }}
              />
            </div>
          )}

          {isCreating && (
            <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', marginBottom: '12px', border: '1px solid #EAEAEA' }}>
              <input
                type="text"
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                style={{ width: '100%', marginBottom: '8px', padding: '6px 8px', background: '#F7F6F3', color: '#111111', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #EAEAEA' }}
              />
              <input
                type="text"
                placeholder="Working directory"
                value={newProjectCwd}
                onChange={(e) => setNewProjectCwd(e.target.value)}
                style={{ width: '100%', marginBottom: '8px', padding: '6px 8px', background: '#F7F6F3', color: '#111111', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #EAEAEA' }}
              />
              {error && <p style={{ fontSize: '0.7rem', color: '#9F2F2D', marginBottom: '8px' }}>{error}</p>}
              <button
                onClick={handleCreate}
                style={{ width: '100%', background: '#EDF3EC', color: '#346538', border: 'none', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
              >
                Create
              </button>
            </div>
          )}

          {isExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredProjects.length === 0 ? (
                <p style={{ fontSize: '0.75rem', color: '#787774' }}>No projects found</p>
              ) : (
                filteredProjects.map((project) => (
              <div
                key={project.id}
                style={{
                  background: selectedProjectId === project.id ? '#E1F3FE' : '#FFFFFF',
                  borderRadius: '6px',
                  padding: '8px',
                  border: selectedProjectId === project.id ? '1px solid #1F6C9F' : '1px solid #EAEAEA',
                  cursor: 'pointer',
                  transition: 'all 200ms',
                }}
                onMouseEnter={(e) => { if (selectedProjectId !== project.id) e.currentTarget.style.borderColor = '#111111'; }}
                onMouseLeave={(e) => { if (selectedProjectId !== project.id) e.currentTarget.style.borderColor = '#EAEAEA'; }}
              >
                {editingId === project.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      style={{ background: '#F7F6F3', color: '#111111', fontSize: '0.7rem', borderRadius: '4px', padding: '4px 6px', border: '1px solid #EAEAEA' }}
                      placeholder="Project name"
                    />
                    <input
                      type="text"
                      value={editingCwd}
                      onChange={(e) => setEditingCwd(e.target.value)}
                      style={{ background: '#F7F6F3', color: '#111111', fontSize: '0.7rem', borderRadius: '4px', padding: '4px 6px', border: '1px solid #EAEAEA' }}
                      placeholder="Working directory"
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => handleEdit(project.id)}
                        style={{ flex: 1, background: '#EDF3EC', color: '#346538', border: 'none', fontSize: '0.7rem', padding: '4px 6px', borderRadius: '3px', cursor: 'pointer' }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        style={{ flex: 1, background: '#F7F6F3', color: '#111111', border: '1px solid #EAEAEA', fontSize: '0.7rem', padding: '4px 6px', borderRadius: '3px', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handleProjectSelect(project.id)}
                      style={{ textAlign: 'left', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '4px' }}
                    >
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#111111' }}>{project.name}</div>
                      <div style={{ fontSize: '0.7rem', color: '#787774', wordBreak: 'break-all' }}>{project.cwd}</div>
                    </button>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                      <button
                        onClick={() => {
                          setEditingId(project.id);
                          setEditingName(project.name);
                          setEditingCwd(project.cwd);
                        }}
                        style={{ flex: 1, background: '#F7F6F3', color: '#111111', border: '1px solid #EAEAEA', fontSize: '0.7rem', padding: '3px 4px', borderRadius: '3px', cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onProjectDelete(project.id)}
                        style={{ flex: 1, background: '#FDEBEC', color: '#9F2F2D', border: '1px solid #EAEAEA', fontSize: '0.7rem', padding: '3px 4px', borderRadius: '3px', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
            )}
          </div>
        )}
      </div>
    );
  }

    function SessionSidebar({ sessions, projects, selectedProjectId, activeSessionId, onSessionClick, onSessionRename, onSessionDelete, onNewSession = null, isOpen, onToggle, onProjectClick, onProjectCreate, onProjectEdit, onProjectDelete, projectStatuses = [] }) {
      const [editingId, setEditingId] = useState(null);
      const [editingName, setEditingName] = useState('');
      const [statusFilter, setStatusFilter] = useState({});

      // Load filter from localStorage when project changes
      useEffect(() => {
        if (selectedProjectId && projectStatuses.length > 0) {
          const saved = localStorage.getItem('sessionStatusFilter_' + selectedProjectId);
          if (saved) {
            try {
              setStatusFilter(JSON.parse(saved));
            } catch (e) {
              // Initialize with all statuses checked
              const allChecked = {};
              projectStatuses.forEach(status => {
                allChecked[status.name] = true;
              });
              setStatusFilter(allChecked);
            }
          } else {
            // Initialize with all statuses checked
            const allChecked = {};
            projectStatuses.forEach(status => {
              allChecked[status.name] = true;
            });
            setStatusFilter(allChecked);
          }
        }
      }, [selectedProjectId, projectStatuses]);

      // Save filter to localStorage when it changes
      useEffect(() => {
        if (selectedProjectId && Object.keys(statusFilter).length > 0) {
          localStorage.setItem('sessionStatusFilter_' + selectedProjectId, JSON.stringify(statusFilter));
        }
      }, [statusFilter, selectedProjectId]);

      const handleStatusFilterToggle = (statusName) => {
        setStatusFilter(prev => ({
          ...prev,
          [statusName]: !prev[statusName]
        }));
      };

      const handleRename = async (id) => {
        if (editingName.trim()) {
          await onSessionRename(id, editingName);
          setEditingId(null);
        }
      };

      return (
        <>
          {/* Toggle button */}
          <button
            onClick={onToggle}
            style={{ position: 'fixed', top: '16px', left: '16px', zIndex: 40, background: '#111111', color: '#FFFFFF', padding: '8px 12px', borderRadius: '5px', border: 'none', cursor: 'pointer', transition: 'all 200ms', display: 'none' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#2F3437'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#111111'}
            title="Toggle sidebar"
            className="md:hidden"
          >
            ≡
          </button>

          {/* Sidebar overlay (mobile) */}
          {isOpen && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.1)', zIndex: 30, display: 'none' }}
              onClick={onToggle}
              className="md:hidden"
            />
          )}

          {/* Sidebar */}
          <div
            style={{
              position: window.innerWidth < 768 ? 'fixed' : 'relative',
              left: window.innerWidth < 768 ? 0 : 'auto',
              top: window.innerWidth < 768 ? 0 : 'auto',
              height: window.innerWidth < 768 ? '100vh' : 'auto',
              width: window.innerWidth < 768 ? '256px' : '256px',
              background: '#FFFFFF',
              borderRight: '1px solid #EAEAEA',
              zIndex: 35,
              transform: window.innerWidth < 768 ? (isOpen ? 'translateX(0)' : '-100%') : 'none',
              transition: 'transform 300ms',
              display: window.innerWidth < 768 ? (isOpen ? 'block' : 'block') : 'block',
              minHeight: window.innerWidth >= 768 ? '100vh' : 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Project Selector */}
            <ProjectSelector
              projects={projects}
              selectedProjectId={selectedProjectId}
              onProjectClick={onProjectClick}
              onProjectCreate={onProjectCreate}
              onProjectEdit={onProjectEdit}
              onProjectDelete={onProjectDelete}
            />

            {/* Sessions */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
              {(() => {
                const filteredCount = sessions.filter(s => s.project_id === selectedProjectId).length;
                const countStr = selectedProjectId && filteredCount > 0 ? ' (' + filteredCount + ')' : '';
                return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '0.75rem', fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                      {'Sessions' + countStr}
                    </h3>
                    <button
                      onClick={() => {
                        if (!selectedProjectId) {
                          alert('Please select a project first');
                          return;
                        }
                        onNewSession && onNewSession();
                      }}
                      style={{ background: '#111111', color: '#FFFFFF', border: 'none', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#2F3437'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#111111'}
                      title="New session"
                    >
                      + New
                    </button>
                  </div>
                );
              })()}

              {/* Status Filter */}
              {projectStatuses.length > 0 && (
                <div style={{ marginBottom: '12px', padding: '8px', background: '#F9F9F9', borderRadius: '6px', border: '1px solid #EAEAEA' }}>
                  <p style={{ fontSize: '0.7rem', fontWeight: 600, color: '#787774', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter by Status</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {projectStatuses.map(status => (
                      <label key={status.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.75rem' }}>
                        <input
                          type="checkbox"
                          checked={statusFilter[status.name] || false}
                          onChange={() => handleStatusFilterToggle(status.name)}
                          style={{ cursor: 'pointer', accentColor: '#111111' }}
                        />
                        <span style={{ color: '#111111', userSelect: 'none' }}>
                          {status.name} ({sessions.filter(s => s.project_id === selectedProjectId && s.session_status === status.name).length})
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const filteredSessions = sessions.filter(s => {
                  if (s.project_id !== selectedProjectId) return false;
                  // Check if this session's status is enabled in the filter
                  const status = s.session_status || projectStatuses[0]?.name || 'Backlog';
                  return statusFilter[status] !== false; // Show if status is not explicitly unchecked
                });
                return filteredSessions.length === 0 ? (
                  <p style={{ fontSize: '0.75rem', color: '#787774' }}>No sessions matching filter</p>
                ) : (
                  filteredSessions.map((session, idx) => (
                  <div
                    key={session.id}
                    style={{
                      background: activeSessionId === session.id ? '#E1F3FE' : '#FBFBFA',
                      borderRadius: '8px',
                      padding: '12px',
                      border: activeSessionId === session.id ? '1px solid #1F6C9F' : '1px solid #EAEAEA',
                      marginBottom: '12px',
                      transition: 'all 200ms',
                      cursor: 'pointer',
                      group: 'true',
                      boxShadow: activeSessionId === session.id ? '0 2px 8px rgba(31, 108, 159, 0.1)' : 'none'
                    }}
                    onMouseEnter={(e) => { if (activeSessionId !== session.id) { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = '#111111'; } }}
                    onMouseLeave={(e) => { if (activeSessionId !== session.id) { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#EAEAEA'; } }}
                  >
                    {editingId === session.id ? (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          style={{ flex: 1, background: '#F7F6F3', color: '#111111', fontSize: '0.75rem', borderRadius: '5px', padding: '6px 8px', border: '1px solid #EAEAEA' }}
                          autoFocus
                        />
                        <button
                          onClick={() => handleRename(session.id)}
                          style={{ background: '#EDF3EC', color: '#346538', border: 'none', fontSize: '0.75rem', padding: '6px 8px', borderRadius: '5px', cursor: 'pointer' }}
                        >
                          OK
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => onSessionClick(session.id)}
                          style={{ fontSize: '0.75rem', fontWeight: 600, color: activeSessionId === session.id ? '#1F6C9F' : '#111111', textAlign: 'left', width: '100%', marginBottom: '4px', background: 'none', border: 'none', cursor: 'pointer', wordBreak: 'break-word' }}
                        >
                          {activeSessionId === session.id && '▶ '}{session.name}
                        </button>
                        <p style={{ fontSize: '0.7rem', color: '#787774' }}>
                          {new Date(session.created_at).toLocaleDateString()}
                        </p>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                          <button
                            onClick={() => {
                              setEditingId(session.id);
                              setEditingName(session.name);
                            }}
                            style={{ flex: 1, background: '#F7F6F3', color: '#111111', border: '1px solid #EAEAEA', fontSize: '0.7rem', padding: '4px 6px', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onSessionDelete(session.id)}
                            style={{ flex: 1, background: '#FDEBEC', color: '#9F2F2D', border: '1px solid #EAEAEA', fontSize: '0.7rem', padding: '4px 6px', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  ))
                );
              })()}
            </div>
          </div>
        </>
      );
    }

    // Project-level Kanban View: Sessions organized by workflow status
    function ProjectKanbanView({ projectId, projectName, sessions, statuses, onSessionClick, onStatusChange, onStatusCreated, onStatusRenamed, onStatusDeleted, onStatusesReordered }) {
      const [draggedSession, setDraggedSession] = useState(null);
      const [editingStatusId, setEditingStatusId] = useState(null);
      const [editingStatusName, setEditingStatusName] = useState('');
      const [newStatusName, setNewStatusName] = useState('');
      const [showAddStatus, setShowAddStatus] = useState(false);
      const [draggedStatus, setDraggedStatus] = useState(null);
      const [reorderedStatuses, setReorderedStatuses] = useState(statuses);
      const [deleteModalStatus, setDeleteModalStatus] = useState(null);
      const [targetStatusForMigration, setTargetStatusForMigration] = useState(null);

      // Sync reorderedStatuses with statuses prop when it changes
      useEffect(() => {
        setReorderedStatuses(statuses);
      }, [statuses]);

      const handleCreateStatus = async () => {
        if (!newStatusName.trim()) return;
        try {
          const resp = await fetch('/api/projects/' + projectId + '/statuses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newStatusName.trim() })
          });
          if (resp.ok) {
            const newStatus = await resp.json();
            setNewStatusName('');
            setShowAddStatus(false);
            setReorderedStatuses(prev => [...prev, newStatus]);
            onStatusCreated?.(newStatus);
          } else {
            const data = await resp.json();
            alert('Error: ' + (data.error || 'Failed to create status'));
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };

      const handleRenameStatus = async (statusId, statusName) => {
        if (!editingStatusName.trim()) return;
        try {
          const resp = await fetch('/api/projects/' + projectId + '/statuses/' + statusId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editingStatusName.trim() })
          });
          if (resp.ok) {
            const updatedStatus = await resp.json();
            setEditingStatusId(null);
            setEditingStatusName('');
            setReorderedStatuses(prev =>
              prev.map(s => s.id === statusId ? updatedStatus : s)
            );
            onStatusRenamed?.(statusId, updatedStatus);
          } else {
            const data = await resp.json();
            alert('Error: ' + (data.error || 'Failed to rename status'));
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };

      const handleDeleteStatus = async (statusId, statusName) => {
        const sessionCount = sessions.filter(s => s.session_status === statusName).length;
        if (sessionCount > 0) {
          // Show modal to choose target status
          setDeleteModalStatus({ statusId, statusName, sessionCount });
          setTargetStatusForMigration(null);
        } else {
          // No sessions, just delete
          if (!confirm('Delete this status?')) return;
          try {
            const resp = await fetch('/api/projects/' + projectId + '/statuses/' + statusId, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' }
            });
            if (resp.ok) {
              setReorderedStatuses(prev => prev.filter(s => s.id !== statusId));
              onStatusDeleted?.(statusId);
            } else {
              const data = await resp.json();
              alert('Error: ' + (data.error || 'Failed to delete status'));
            }
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }
      };

      const confirmDeleteWithMigration = async () => {
        if (!targetStatusForMigration) {
          alert('Please select a status to move sessions to');
          return;
        }

        try {
          const resp = await fetch('/api/projects/' + projectId + '/statuses/' + deleteModalStatus.statusId, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetStatus: targetStatusForMigration })
          });
          if (resp.ok) {
            setReorderedStatuses(prev => prev.filter(s => s.id !== deleteModalStatus.statusId));
            setDeleteModalStatus(null);
            setTargetStatusForMigration(null);
            onStatusDeleted?.(deleteModalStatus.statusId);
          } else {
            const data = await resp.json();
            alert('Error: ' + (data.error || 'Failed to delete status'));
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };

      const handleStatusDragStart = (e, status) => {
        setDraggedStatus(status);
        e.dataTransfer.effectAllowed = 'move';
      };

      const handleStatusDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      };

      const handleStatusDrop = async (e, targetStatus) => {
        e.preventDefault();
        if (!draggedStatus || draggedStatus.id === targetStatus.id) {
          setDraggedStatus(null);
          return;
        }

        // Create new order
        const newOrder = reorderedStatuses.map(s => s.id);
        const draggedIdx = newOrder.indexOf(draggedStatus.id);
        const targetIdx = newOrder.indexOf(targetStatus.id);

        if (draggedIdx > -1 && targetIdx > -1) {
          // Swap positions
          [newOrder[draggedIdx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[draggedIdx]];

          const reordered = newOrder.map(id => reorderedStatuses.find(s => s.id === id)).filter(Boolean);
          setReorderedStatuses(reordered);

          // Call API to save new positions
          try {
            const resp = await fetch('/api/projects/' + projectId + '/statuses/reorder', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ statusIds: newOrder })
            });
            if (resp.ok) {
              onStatusesReordered?.(reordered);
            } else {
              alert('Failed to reorder statuses');
            }
          } catch (e) {
            alert('Error: ' + e.message);
          }
        }

        setDraggedStatus(null);
      };

      const sessionsByStatus = {};
      statuses.forEach(status => {
        sessionsByStatus[status.name] = sessions.filter(s => {
          // Handle null/undefined session_status by putting in first (Backlog) status
          const sessionStatus = s.session_status || statuses[0]?.name;
          return sessionStatus === status.name;
        });
      });

      const handleDragStart = (e, sessionId) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', sessionId);
        setDraggedSession(sessionId);
      };

      const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
      };

      const handleDrop = (e, statusName) => {
        e.preventDefault();
        e.stopPropagation();
        const sessionId = e.dataTransfer.getData('text/plain');

        // Optimistic update
        const sessionToMove = sessions.find(s => s.id === sessionId);
        if (sessionToMove && sessionToMove.session_status !== statusName) {
          onStatusChange(sessionId, statusName);
        }

        setDraggedSession(null);
      };

      return (
        <div className="flex flex-col gap-6 p-6">
          {/* Header */}
          <div className="border-b border-gray-200 pb-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{projectName}</h2>
                <p className="text-sm text-gray-600 mt-1">Total sessions: {sessions.length}</p>
              </div>
              {!showAddStatus && (
                <button
                  onClick={() => setShowAddStatus(true)}
                  style={{ padding: '8px 12px', background: '#111111', color: '#FFFFFF', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#2F3437'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#111111'}
                  title="Add new status"
                >
                  + Status
                </button>
              )}
            </div>
            {showAddStatus && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <input
                  type="text"
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  placeholder="New status name..."
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid #EAEAEA', borderRadius: '5px', fontSize: '12px' }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateStatus();
                    if (e.key === 'Escape') { setShowAddStatus(false); setNewStatusName(''); }
                  }}
                />
                <button
                  onClick={handleCreateStatus}
                  style={{ padding: '8px 12px', background: '#EDF3EC', color: '#346538', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                >
                  Create
                </button>
                <button
                  onClick={() => { setShowAddStatus(false); setNewStatusName(''); }}
                  style={{ padding: '8px 12px', background: '#F7F6F3', color: '#111111', border: '1px solid #EAEAEA', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Kanban Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
            minHeight: '400px'
          }}>
            {reorderedStatuses.map(status => (
              <div
                key={status.id}
                draggable
                onDragStart={(e) => handleStatusDragStart(e, status)}
                onDragOver={handleStatusDragOver}
                onDrop={(e) => handleStatusDrop(e, status)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#f9f9f9',
                  border: draggedStatus?.id === status.id ? '2px solid #1F6C9F' : '1px solid #e0e0e0',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  opacity: draggedStatus?.id === status.id ? 0.6 : 1,
                  cursor: draggedStatus ? 'grabbing' : 'grab',
                  transition: 'all 200ms'
                }}
              >
                {/* Column Header */}
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: '#f5f5f5',
                  borderBottom: '1px solid #e0e0e0',
                  fontWeight: '600',
                  fontSize: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  userSelect: 'none'
                }}>
                  {editingStatusId === status.id ? (
                    <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                      <input
                        type="text"
                        value={editingStatusName}
                        onChange={(e) => setEditingStatusName(e.target.value)}
                        style={{ flex: 1, padding: '4px 6px', fontSize: '12px', border: '1px solid #ddd', borderRadius: '4px' }}
                        autoFocus
                      />
                      <button
                        onClick={() => handleRenameStatus(status.id, status.name)}
                        style={{ padding: '4px 8px', fontSize: '11px', background: '#EDF3EC', color: '#346538', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => { setEditingStatusId(null); setEditingStatusName(''); }}
                        style={{ padding: '4px 8px', fontSize: '11px', background: '#FDEBEC', color: '#9F2F2D', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <span>{status.name} ({sessionsByStatus[status.name]?.length || 0})</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => { setEditingStatusId(status.id); setEditingStatusName(status.name); }}
                          style={{ padding: '3px 6px', fontSize: '11px', background: '#E1F3FE', color: '#1F6C9F', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                          title="Rename"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeleteStatus(status.id, status.name)}
                          style={{ padding: '3px 6px', fontSize: '11px', background: '#FDEBEC', color: '#9F2F2D', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Drop Zone */}
                <div
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, status.name)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    minHeight: '300px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    overflow: 'auto'
                  }}
                >
                  {sessionsByStatus[status.name]?.map(session => (
                    <div
                      key={session.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, session.id)}
                      onClick={() => onSessionClick(session.id)}
                      style={{
                        padding: '12px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        cursor: 'grab',
                        opacity: draggedSession === session.id ? 0.5 : 1,
                        transition: 'opacity 0.2s',
                        userSelect: 'none',
                        fontSize: '13px'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
                    >
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                        {session.name.substring(0, 30)}...
                      </div>
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        {session.total_cost?.toFixed(4) || '0.0000'} • {new Date(session.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {sessions.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
              <p>No sessions yet. Create one using the prompt form below.</p>
            </div>
          )}

          {/* Delete Modal */}
          {deleteModalStatus && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }} onClick={() => { setDeleteModalStatus(null); setTargetStatusForMigration(null); }}>
              <div style={{
                background: '#FFFFFF',
                borderRadius: '8px',
                padding: '24px',
                maxWidth: '400px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.1)'
              }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '12px', color: '#111111' }}>
                  Delete Status: {deleteModalStatus.statusName}
                </h3>
                <p style={{ fontSize: '14px', color: '#787774', marginBottom: '16px' }}>
                  This status has {deleteModalStatus.sessionCount} session(s). Where should they be moved?
                </p>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#111111', display: 'block', marginBottom: '8px' }}>
                    Select target status:
                  </label>
                  <select
                    value={targetStatusForMigration || ''}
                    onChange={(e) => setTargetStatusForMigration(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #EAEAEA',
                      borderRadius: '5px',
                      fontSize: '14px',
                      background: '#FFFFFF',
                      color: '#111111',
                      fontFamily: 'inherit',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="">-- Select a status --</option>
                    {reorderedStatuses
                      .filter(s => s.name !== deleteModalStatus.statusName)
                      .map(status => (
                        <option key={status.id} value={status.name}>
                          {status.name}
                        </option>
                      ))
                    }
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={confirmDeleteWithMigration}
                    disabled={!targetStatusForMigration}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: targetStatusForMigration ? '#FDEBEC' : '#EAEAEA',
                      color: targetStatusForMigration ? '#9F2F2D' : '#787774',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: targetStatusForMigration ? 'pointer' : 'not-allowed',
                      fontSize: '14px',
                      fontWeight: 600
                    }}
                  >
                    Delete & Move
                  </button>
                  <button
                    onClick={() => { setDeleteModalStatus(null); setTargetStatusForMigration(null); }}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#F7F6F3',
                      color: '#111111',
                      border: '1px solid #EAEAEA',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 600
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    function App() {
      const [prompt, setPrompt] = useState('');
      const [sessionId, setSessionId] = useState(null);
      const [isLoading, setIsLoading] = useState(false);
      const [model, setModel] = useState('sonnet');
      const [isAuthenticated, setIsAuthenticated] = useState(false);
      const [currentUser, setCurrentUser] = useState(null);
      const [sidebarOpen, setSidebarOpen] = useState(false);
      const [sessions, setSessions] = useState([]);
      const [projects, setProjects] = useState([]);
      const [selectedProjectId, setSelectedProjectId] = useState(null);
      const [viewMode, setViewMode] = useState('prompt'); // 'prompt', 'project-kanban', 'execution'
      const [projectStatuses, setProjectStatuses] = useState([]);

      const models = [
        { id: 'opus', name: '🚀 Opus 4.7', description: 'Most capable for complex tasks' },
        { id: 'sonnet', name: '⚡ Sonnet 4.6', description: 'Balanced speed & capability (default)' },
        { id: 'haiku', name: '💨 Haiku 4.5', description: 'Fast & cost-effective' },
      ];

      // Check authentication and load sessions/projects on mount
      useEffect(() => {
        checkAuth();
        loadSessions();
        loadProjects();
        const interval = setInterval(() => {
          loadSessions();
          loadProjects();
        }, 5000); // Refresh every 5 seconds
        return () => clearInterval(interval);
      }, []);

      // Load project statuses when project is selected
      useEffect(() => {
        if (selectedProjectId) {
          loadProjectStatuses(selectedProjectId);
          setViewMode('project-kanban');
        }
      }, [selectedProjectId]);

      const loadProjectStatuses = async (projectId) => {
        try {
          const resp = await fetch('/api/projects/' + projectId + '/statuses');
          if (resp.ok) {
            const data = await resp.json();
            setProjectStatuses(data.statuses || []);
          }
        } catch (e) {
          console.error('Failed to load project statuses:', e);
        }
      };

      const handleStatusChange = async (sessionId, newStatus) => {
        try {
          const resp = await fetch('/api/sessions/' + sessionId + '/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
          });
          if (resp.ok) {
            // Update local sessions state
            setSessions(prev =>
              prev.map(s => s.id === sessionId ? { ...s, session_status: newStatus } : s)
            );
          } else {
            console.error('Failed to update session status');
            // Reload sessions to refresh
            loadSessions();
          }
        } catch (e) {
          console.error('Error updating status:', e);
          loadSessions();
        }
      };

      const checkAuth = async () => {
        try {
          const resp = await fetch('/api/auth/me');
          if (resp.ok) {
            const data = await resp.json();
            setCurrentUser(data);
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
          }
        } catch (e) {
          console.error('Auth check failed:', e);
          setIsAuthenticated(false);
        }
      };

      const loadSessions = async () => {
        try {
          const resp = await fetch('/api/sessions');
          const data = await resp.json();
          setSessions(data.sessions || []);
        } catch (e) {
          console.error('Failed to load sessions:', e);
        }
      };

      const loadProjects = async () => {
        try {
          const resp = await fetch('/api/projects');
          const data = await resp.json();
          const projectsList = data.projects || [];
          setProjects(projectsList);

          // Auto-select first project if current selection is null and projects exist
          if (!selectedProjectId && projectsList.length > 0) {
            setSelectedProjectId(projectsList[0].id);
          }
        } catch (e) {
          console.error('Failed to load projects:', e);
        }
      };

      const handleProjectClick = async (projectId) => {
        setSelectedProjectId(projectId);
        // Update last_used timestamp on backend (PUT with empty object updates last_used to current time)
        try {
          await fetch('/api/projects/' + projectId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
        } catch (e) {
          console.error('Failed to update project last_used:', e);
        }
      };

      const handleProjectCreate = async (name, cwd) => {
        try {
          const resp = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, cwd }),
          });
          if (!resp.ok) {
            const error = await resp.json();
            throw new Error(error.error || 'Failed to create project');
          }
          await loadProjects();
        } catch (e) {
          alert('Error: ' + e.message);
          throw e;
        }
      };

      const handleProjectEdit = async (projectId, name, cwd) => {
        try {
          const resp = await fetch(\`/api/projects/\${projectId}\`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, cwd }),
          });
          if (!resp.ok) {
            const error = await resp.json();
            throw new Error(error.error || 'Failed to update project');
          }
          await loadProjects();
        } catch (e) {
          alert('Error: ' + e.message);
          throw e;
        }
      };

      const handleProjectDelete = async (projectId) => {
        if (confirm('Delete this project? Sessions will be moved to Default.')) {
          try {
            await fetch(\`/api/projects/\${projectId}\`, { method: 'DELETE' });
            await loadProjects();
          } catch (e) {
            alert('Failed to delete project');
          }
        }
      };

      const handleResumeSession = async (resumeSessionId) => {
        setSessionId(resumeSessionId);
        setSidebarOpen(false);
      };

      const handleSessionRename = async (id, name) => {
        try {
          await fetch(\`/api/sessions/\${id}/rename\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          await loadSessions();
        } catch (e) {
          alert('Failed to rename session');
        }
      };

      const handleSessionDelete = async (id) => {
        if (confirm('Delete this session?')) {
          try {
            await fetch(\`/api/sessions/\${id}\`, { method: 'DELETE' });
            await loadSessions();
          } catch (e) {
            alert('Failed to delete session');
          }
        }
      };

      const handleExecute = async () => {
        if (!prompt.trim()) return;

        if (!selectedProjectId) {
          alert('Please select or create a project first');
          return;
        }

        setIsLoading(true);

        try {
          const resp = await fetch('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, model, projectId: selectedProjectId }),
          });
          const data = await resp.json();
          if (!resp.ok) {
            throw new Error(data.error || 'Execution failed');
          }
          // Load sessions immediately so new session appears in sidebar
          await loadSessions();
          setSessionId(data.sessionId);
        } catch (e) {
          alert('Error: ' + e.message);
        } finally {
          setIsLoading(false);
        }
      };

      const handleReset = () => {
        setSessionId(null);
        setPrompt('');
        setSidebarOpen(false);
        loadSessions();
      };

      const handleNewSession = () => {
        // Close current session if one is open
        if (sessionId) {
          setSessionId(null);
        }
        // Clear prompt and focus textarea
        setPrompt('');
        // Focus textarea on next render
        setTimeout(() => {
          const textarea = document.querySelector('textarea[placeholder*="Describe"]');
          if (textarea) textarea.focus();
        }, 0);
      };

      if (!isAuthenticated) {
        return <LoginScreen onLogin={() => {
          setIsAuthenticated(true);
          checkAuth();
        }} />;
      }

      // Show execution kanban if a session is being executed
      if (sessionId) {
        return (
          <KanbanBoard
            sessionId={sessionId}
            onReset={handleReset}
            model={model}
            sessions={sessions}
            onSessionClick={handleResumeSession}
            onSessionRename={handleSessionRename}
            onSessionDelete={handleSessionDelete}
            onNewSession={handleNewSession}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onProjectClick={handleProjectClick}
            onProjectCreate={handleProjectCreate}
            onProjectEdit={handleProjectEdit}
            onProjectDelete={handleProjectDelete}
          />
        );
      }

      // Show project kanban view if a project is selected
      if (selectedProjectId && viewMode === 'project-kanban') {
        const selectedProject = projects.find(p => p.id === selectedProjectId);
        const projectSessions = sessions.filter(s => s.project_id === selectedProjectId);

        return (
          <div style={{ display: 'flex', minHeight: '100vh', background: '#FBFBFA' }}>
            <SessionSidebar
              sessions={sessions}
              projects={projects}
              selectedProjectId={selectedProjectId}
              activeSessionId={null}
              onSessionClick={handleResumeSession}
              onSessionRename={handleSessionRename}
              onSessionDelete={handleSessionDelete}
              onNewSession={handleNewSession}
              isOpen={sidebarOpen}
              onToggle={() => setSidebarOpen(!sidebarOpen)}
              onProjectClick={handleProjectClick}
              onProjectCreate={handleProjectCreate}
              onProjectEdit={handleProjectEdit}
              onProjectDelete={handleProjectDelete}
              projectStatuses={projectStatuses}
            />
            <div style={{ flex: 1, minHeight: '100vh', background: '#FBFBFA', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <ProjectKanbanView
                  projectId={selectedProjectId}
                  projectName={selectedProject?.name || 'Project'}
                  sessions={projectSessions}
                  statuses={projectStatuses}
                  onSessionClick={(sid) => {
                    setSessionId(sid);
                  }}
                  onStatusChange={handleStatusChange}
                  onStatusCreated={(newStatus) => {
                    setProjectStatuses(prev => [...prev, newStatus]);
                  }}
                  onStatusRenamed={(statusId, newStatus) => {
                    setProjectStatuses(prev =>
                      prev.map(s => s.id === statusId ? { ...s, name: newStatus.name, position: newStatus.position } : s)
                    );
                  }}
                  onStatusDeleted={(statusId) => {
                    setProjectStatuses(prev => prev.filter(s => s.id !== statusId));
                  }}
                  onStatusesReordered={(newStatuses) => {
                    setProjectStatuses(newStatuses);
                  }}
                />
              </div>

              {/* New Session Form */}
              <div style={{ padding: '24px', background: '#FFFFFF', borderTop: '1px solid #EAEAEA', minHeight: '300px' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '16px', color: '#111111' }}>New Session</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: '#111111' }}>Model</label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #EAEAEA', borderRadius: '5px', fontSize: '0.875rem', background: '#FFFFFF', color: '#111111', fontFamily: 'inherit', cursor: 'pointer' }}
                    >
                      {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: '#111111' }}>Prompt</label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          handleExecute();
                        }
                      }}
                      placeholder="Describe what you'd like Claude to do..."
                      style={{ width: '100%', height: '120px', padding: '12px', border: '1px solid #EAEAEA', borderRadius: '5px', fontSize: '0.875rem', background: '#F7F6F3', color: '#111111', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <button
                    onClick={handleExecute}
                    disabled={isLoading || !prompt.trim()}
                    style={{ width: '100%', padding: '12px 16px', background: isLoading || !prompt.trim() ? '#EAEAEA' : '#111111', color: isLoading || !prompt.trim() ? '#787774' : '#FFFFFF', fontWeight: 600, border: 'none', borderRadius: '5px', cursor: isLoading || !prompt.trim() ? 'not-allowed' : 'pointer', fontSize: '0.875rem', transition: 'all 200ms' }}
                    onMouseEnter={(e) => { if (!isLoading && prompt.trim()) e.currentTarget.style.background = '#2F3437'; }}
                    onMouseLeave={(e) => { if (!isLoading && prompt.trim()) e.currentTarget.style.background = '#111111'; }}
                  >
                    {isLoading ? 'Executing...' : 'Execute'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div style={{ display: 'flex', minHeight: '100vh', background: '#FBFBFA' }}>
          <SessionSidebar
            sessions={sessions}
            projects={projects}
            selectedProjectId={selectedProjectId}
            activeSessionId={null}
            onSessionClick={handleResumeSession}
            onSessionRename={handleSessionRename}
            onSessionDelete={handleSessionDelete}
            onNewSession={handleNewSession}
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
            onProjectClick={handleProjectClick}
            onProjectCreate={handleProjectCreate}
            onProjectEdit={handleProjectEdit}
            onProjectDelete={handleProjectDelete}
            projectStatuses={projectStatuses}
          />
          <div style={{ flex: 1, minHeight: '100vh', background: '#FBFBFA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', width: '100%' }}>
          <div style={{ width: '100%', maxWidth: '640px' }}>
            <div style={{ background: '#FFFFFF', borderRadius: '8px', padding: '32px', border: '1px solid #EAEAEA' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '24px' }}>
                <div>
                  <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '12px', color: '#111111' }}>
                    Claude Streaming
                  </h1>
                  <p style={{ fontSize: '0.875rem', color: '#787774', lineHeight: 1.6 }}>
                    Real-time conversation interface with Kanban visualization of Claude CLI streaming mode.
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {currentUser && (
                    <div style={{ marginBottom: '12px' }}>
                      <p style={{ fontSize: '0.75rem', color: '#787774', margin: '0 0 4px 0' }}>Logged in as</p>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111111', margin: 0 }}>{currentUser.username}</p>
                      <p style={{ fontSize: '0.7rem', color: '#787774', margin: '2px 0 0 0', textTransform: 'capitalize' }}>{currentUser.role}</p>
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      await fetch('/api/auth/logout', { method: 'POST' });
                      setIsAuthenticated(false);
                      setCurrentUser(null);
                      setPrompt('');
                      setSessionId(null);
                    }}
                    style={{ background: '#FDEBEC', color: '#9F2F2D', border: '1px solid #EAEAEA', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#F9D5D7'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#FDEBEC'}
                  >
                    Logout
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '12px', color: '#111111', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Model
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                  {models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '5px',
                        border: '1px solid #EAEAEA',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 200ms',
                        background: model === m.id ? '#E1F3FE' : '#F7F6F3',
                        borderColor: model === m.id ? '#1F6C9F' : '#EAEAEA'
                      }}
                      onMouseEnter={(e) => { if (model !== m.id) e.currentTarget.style.borderColor = '#111111'; }}
                      onMouseLeave={(e) => { if (model !== m.id) e.currentTarget.style.borderColor = '#EAEAEA'; }}
                    >
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: model === m.id ? '#1F6C9F' : '#111111' }}>{m.name.replace(/^[^A-Za-z]*/, '')}</p>
                      <p style={{ fontSize: '0.7rem', color: '#787774', marginTop: '4px' }}>{m.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: '#111111' }}>
                  Project
                </label>
                {projects.length === 0 ? (
                  <div style={{ padding: '12px', background: '#FBF3DB', border: '1px solid #F0DC9F', borderRadius: '5px', color: '#7A6A00', fontSize: '0.875rem' }}>
                    📁 No projects created yet. Use the <strong>+ New</strong> button in the sidebar to create one.
                  </div>
                ) : (
                  <select
                    value={selectedProjectId || ''}
                    onChange={(e) => setSelectedProjectId(e.target.value || null)}
                    style={{ width: '100%', background: '#F7F6F3', border: '1px solid #EAEAEA', borderRadius: '5px', padding: '10px 12px', fontSize: '0.875rem', color: '#111111', cursor: 'pointer' }}
                  >
                    <option value="">-- Select a project --</option>
                    {(projects || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.cwd})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: '#111111' }}>
                  Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      handleExecute();
                    }
                  }}
                  placeholder="Describe what you'd like Claude to do..."
                  style={{ width: '100%', height: '120px', background: '#F7F6F3', border: '1px solid #EAEAEA', borderRadius: '5px', padding: '12px', fontSize: '1rem', color: '#111111', fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              <button
                onClick={handleExecute}
                disabled={isLoading || !selectedProjectId}
                style={{ width: '100%', background: (isLoading || !selectedProjectId) ? '#EAEAEA' : '#111111', color: (isLoading || !selectedProjectId) ? '#787774' : '#FFFFFF', fontWeight: 600, padding: '12px 16px', borderRadius: '5px', border: 'none', cursor: (isLoading || !selectedProjectId) ? 'not-allowed' : 'pointer', fontSize: '1rem', transition: 'all 200ms' }}
                onMouseEnter={(e) => { if (!isLoading && selectedProjectId) e.currentTarget.style.background = '#2F3437'; }}
                onMouseLeave={(e) => { if (!isLoading && selectedProjectId) e.currentTarget.style.background = '#111111'; }}
              >
                {isLoading ? 'Running...' : 'Execute'}
              </button>

              <div style={{ marginTop: '32px', padding: '20px', background: '#FBFBFA', borderRadius: '8px', border: '1px solid #EAEAEA', fontSize: '0.875rem', color: '#787774' }}>
                <p style={{ fontWeight: 600, marginBottom: '12px', color: '#111111' }}>System Architecture</p>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <li>• Invokes Claude CLI with streaming JSON output</li>
                  <li>• Processes events in real-time via WebSocket</li>
                  <li>• Organizes tasks in Kanban workflow</li>
                  <li>• Tracks thinking, actions, feedback, completion</li>
                  <li>• Persists sessions to SQLite database</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        </div>
      );
    }

    ReactDOM.render(<App />, document.getElementById('root'));
  </script>
</body>
</html>`;
}

// ============================================================================
// Server Start
// ============================================================================

const PORT = parseInt(process.env.PORT || '3000', 10);

// Note: Default project removed. All sessions must be linked to user-created projects.

// Export app for Bun with WebSocket support
export default {
  port: PORT,
  fetch: app.fetch.bind(app),
  websocket: {
    open(ws: any) {},
    message(ws: any, message: any) {},
    close(ws: any) {},
    drain(ws: any) {},
  },
};

// Log startup info
setTimeout(() => {
  const startupMsg = `
╔════════════════════════════════════════════════════════════╗
║     Claude Streaming Mode PoC - Backend Server             ║
║     Using Claude CLI as ACP Replacement                    ║
╚════════════════════════════════════════════════════════════╝

🚀 Server starting on http://localhost:${PORT}
📡 WebSocket: ws://localhost:${PORT}/ws/:sessionId
🧠 Claude CLI: Streaming mode with real-time Kanban updates

Try this prompt:
  "Create a simple todo app in ~/test-app/index.html with HTML, CSS, and JS"

Streaming events flow:
  system → thinking → tool_use → tool_result → ... → result

Kanban columns:
  THINKING → ACTIONS → FEEDBACK → COMPLETE
`;
  console.log(startupMsg);
  log('[STARTUP] Server ready on port ' + PORT);
}, 100);
