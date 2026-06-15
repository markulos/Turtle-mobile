import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useServer } from './ServerContext';
import { useAuth } from './AuthContext';

// ── Claude task queue ────────────────────────────────────────────────────
//
// Lets the to-do lists (Tasks/Notes tabs) hand tasks off to the Claude session
// to be worked through one at a time. The queue is now SERVER-SIDE: enqueueing
// POSTs to /api/claude/queue, and the server feeds the next task to the live
// session itself whenever a turn finishes. So:
//   • Tasks/Notes screens call enqueueTask/enqueueNote → server queue.
//   • The server drains it on idle (one per turn, in order) — which means
//     queued work keeps going even with the app closed.
//   • TurtleScreen just DISPLAYS the queue (mirrored over sockets via
//     useClaudeSession) and offers Start/Clear.
// This replaces the old in-memory, client-drained queue that was lost on reload.

// Must match useClaudeSession's DEFAULT_SESSION_ID (the socket room the live
// session + its queue live under).
const SESSION_ID = 'turtle-default';

/**
 * Render a task object into a clear, self-contained prompt for Claude. Only
 * the fields that are present are included, so a bare title-only task stays
 * terse. Subtasks become a checkbox list so Claude can see what's done.
 */
export function formatTaskForClaude(task) {
  const lines = [];
  lines.push('Please work on this to-do task from my Turtle list:');
  lines.push('');
  lines.push(`Title: ${task.title || '(untitled)'}`);
  if (task.project) lines.push(`Project: ${task.project}`);
  if (task.priority) lines.push(`Priority: ${task.priority}`);
  if (task.dueDate) lines.push(`Due: ${task.dueDate}${task.time ? ` at ${task.time}` : ''}`);
  const tags = Array.isArray(task.tags) ? task.tags : [];
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  if (task.description && String(task.description).trim()) {
    lines.push('');
    lines.push('Description:');
    lines.push(String(task.description).trim());
  }
  const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (subs.length) {
    lines.push('');
    lines.push('Subtasks:');
    for (const s of subs) lines.push(`- [${s.completed ? 'x' : ' '}] ${s.title}`);
  }
  return lines.join('\n');
}

/**
 * Render a Notes-page todo/note into a prompt. Notes use `content` (not
 * `title`) and carry far fewer fields than a task, so this stays terse.
 */
export function formatNoteForClaude(note) {
  const lines = [];
  lines.push('Please work on this to-do from my Turtle notes:');
  lines.push('');
  lines.push(`Task: ${note.content || '(untitled)'}`);
  const tags = Array.isArray(note.tags) ? note.tags : [];
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  if (note.description && String(note.description).trim()) {
    lines.push('');
    lines.push('Details:');
    lines.push(String(note.description).trim());
  }
  return lines.join('\n');
}

const ClaudeQueueContext = createContext(null);

export function ClaudeQueueProvider({ children }) {
  const { api } = useServer();
  const { token } = useAuth();

  // POST one item onto the server-side queue. Returns the server result (or
  // throws on failure so callers can surface it). The endpoint is JWT-gated
  // (the queue feeds a session that can edit files / run commands).
  const enqueue = useCallback(async ({ label, text }) => {
    if (!text || !text.trim()) return { ok: false };
    if (!token) throw new Error('Not signed in.');
    return api.post(
      '/claude/queue',
      { sessionId: SESSION_ID, label, text },
      { Authorization: `Bearer ${token}` },
    );
  }, [api, token]);

  const enqueueTask = useCallback((task) => {
    if (!task) return Promise.resolve({ ok: false });
    return enqueue({ label: task.title || 'Task', text: formatTaskForClaude(task) });
  }, [enqueue]);

  // Same, for a Notes-page todo/note (uses `content`, not `title`).
  const enqueueNote = useCallback((note) => {
    if (!note) return Promise.resolve({ ok: false });
    return enqueue({ label: note.content || 'Todo', text: formatNoteForClaude(note) });
  }, [enqueue]);

  const value = useMemo(() => ({ enqueueTask, enqueueNote }), [enqueueTask, enqueueNote]);

  return (
    <ClaudeQueueContext.Provider value={value}>
      {children}
    </ClaudeQueueContext.Provider>
  );
}

export function useClaudeQueue() {
  const ctx = useContext(ClaudeQueueContext);
  if (!ctx) throw new Error('useClaudeQueue must be used within a ClaudeQueueProvider');
  return ctx;
}
