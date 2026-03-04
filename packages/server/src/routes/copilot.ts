import { Router } from 'express';
import { copilotManager } from '../services/copilot-manager.js';

const router = Router();

/**
 * POST /api/copilot/:projectId/message
 * Send a message to the copilot. Starts a query in the background.
 */
router.post('/copilot/:projectId/message', async (req, res) => {
  try {
    const { message, maxTurns, maxBudgetUsd, model } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const sessionId = await copilotManager.sendMessage(
      req.params.projectId,
      message,
      { maxTurns, maxBudgetUsd, model },
    );
    const session = copilotManager.getSession(sessionId);
    res.json({ sessionId, eventCount: session?.events.length ?? 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(409).json({ error: msg });
  }
});

/**
 * GET /api/copilot/:sessionId/progress
 * SSE stream of copilot events with replay.
 */
router.get('/copilot/:sessionId/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');

  const unsubscribe = copilotManager.subscribeProgress(req.params.sessionId, res);
  req.on('close', unsubscribe);
});

/**
 * POST /api/copilot/:sessionId/answer-question
 * Answer a pending ask_user question.
 */
router.post('/copilot/:sessionId/answer-question', (req, res) => {
  const { questionId, answer } = req.body;
  if (!questionId || !answer) {
    res.status(400).json({ error: 'questionId and answer are required' });
    return;
  }
  const ok = copilotManager.answerQuestion(req.params.sessionId, questionId, answer);
  res.json({ ok });
});

/**
 * POST /api/copilot/:sessionId/stop
 * Stop the current query.
 */
router.post('/copilot/:sessionId/stop', (req, res) => {
  const ok = copilotManager.stopSession(req.params.sessionId);
  res.json({ ok });
});

/**
 * POST /api/copilot/:sessionId/reset
 * Reset the session (tear down in-memory state).
 */
router.post('/copilot/:sessionId/reset', (req, res) => {
  copilotManager.resetSession(req.params.sessionId);
  res.json({ ok: true });
});

/**
 * GET /api/copilot/:sessionId/state
 * Get current session state.
 */
router.get('/copilot/:sessionId/state', (req, res) => {
  const session = copilotManager.getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    sessionId: session.sessionId,
    projectId: session.projectId,
    activeQuery: session.activeQuery,
    eventCount: session.events.length,
    totalCostUsd: session.totalCostUsd,
    hasPendingQuestion: !!session.pendingQuestion,
  });
});

/**
 * GET /api/copilot/:projectId/active-session
 * Check if there's an active copilot session for this project.
 */
router.get('/copilot/:projectId/active-session', (req, res) => {
  const session = copilotManager.getSessionByProject(req.params.projectId);
  const chatId = copilotManager.getActiveChatId(req.params.projectId);
  if (!session) {
    res.json({ active: false, chatId });
    return;
  }
  res.json({
    active: true,
    sessionId: session.sessionId,
    activeQuery: session.activeQuery,
    hasPendingQuestion: !!session.pendingQuestion,
    eventCount: session.events.length,
    chatId,
  });
});

/**
 * GET /api/copilot/:projectId/history
 * Load past copilot events from disk for the active chat.
 */
router.get('/copilot/:projectId/history', (req, res) => {
  const events = copilotManager.loadHistory(req.params.projectId);
  res.json({ events });
});

/* ── Chat CRUD ─────────────────────────────────────────── */

/**
 * GET /api/copilot/:projectId/chats
 * List all chats for a project.
 */
router.get('/copilot/:projectId/chats', (req, res) => {
  const chats = copilotManager.listChats(req.params.projectId);
  const activeChatId = copilotManager.getActiveChatId(req.params.projectId);
  res.json({ chats, activeChatId });
});

/**
 * GET /api/copilot/:projectId/chats/:chatId
 * Load events for a specific chat.
 */
router.get('/copilot/:projectId/chats/:chatId', (req, res) => {
  const events = copilotManager.loadChatHistory(req.params.projectId, req.params.chatId);
  res.json({ events });
});

/**
 * POST /api/copilot/:projectId/chats/new
 * Archive current chat and start a new one.
 */
router.post('/copilot/:projectId/chats/new', (req, res) => {
  const meta = copilotManager.newChat(req.params.projectId);
  res.json(meta);
});

/**
 * POST /api/copilot/:projectId/chats/:chatId/switch
 * Switch to a different chat.
 */
router.post('/copilot/:projectId/chats/:chatId/switch', (req, res) => {
  const meta = copilotManager.switchChat(req.params.projectId, req.params.chatId);
  if (!meta) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  res.json(meta);
});

/**
 * DELETE /api/copilot/:projectId/chats/:chatId
 * Delete a chat. Cannot delete the active chat.
 */
router.delete('/copilot/:projectId/chats/:chatId', (req, res) => {
  const ok = copilotManager.deleteChat(req.params.projectId, req.params.chatId);
  if (!ok) {
    res.status(400).json({ error: 'Cannot delete active chat or chat not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
