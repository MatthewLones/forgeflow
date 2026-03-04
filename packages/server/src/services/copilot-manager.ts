import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync, mkdirSync, existsSync, readFileSync,
  writeFileSync, unlinkSync, renameSync,
} from 'node:fs';
import type { Response } from 'express';
import type { ProgressEvent } from '@forgeflow/types';
import {
  buildCopilotToolDefs,
  FORGE_COPILOT_SYSTEM_PROMPT,
  MUTATING_TOOLS,
} from './copilot-tools.js';

/* ── Logger ──────────────────────────────────────────────── */

const LOG_PREFIX = '[CopilotManager]';
function log(...args: unknown[]) { console.log(LOG_PREFIX, ...args); }
function logError(...args: unknown[]) { console.error(LOG_PREFIX, ...args); }

/* ── Types ───────────────────────────────────────────────── */

export interface ChatMeta {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalCostUsd: number;
}

interface ChatIndex {
  version: 1;
  chats: ChatMeta[];
  /** chatId of the currently active (non-archived) chat, or null */
  activeChatId: string | null;
}

interface PendingQuestion {
  questionId: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
}

interface CopilotSession {
  sessionId: string;
  projectId: string;
  chatId: string;
  sseClients: Set<Response>;
  events: ProgressEvent[];
  pendingQuestion: PendingQuestion | null;
  activeQuery: boolean;
  abortController: AbortController | null;
  totalCostUsd: number;
  totalTurns: number;
  /** Number of query() calls — first is fresh, subsequent use `continue: true` to resume conversation */
  queryCount: number;
}

/* ── Manager ─────────────────────────────────────────────── */

export class CopilotManager {
  /** Maps sessionId → session */
  private sessions = new Map<string, CopilotSession>();
  /** Maps projectId → sessionId (one session per project) */
  private projectSessions = new Map<string, string>();
  private projectsBasePath: string;

  constructor() {
    this.projectsBasePath = join(homedir(), '.forgeflow', 'projects');
  }

  getSession(sessionId: string): CopilotSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Get the active session for a project (if any). */
  getSessionByProject(projectId: string): CopilotSession | null {
    const sessionId = this.projectSessions.get(projectId);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  /* ── Chat index helpers ──────────────────────────────────── */

  private getChatsDir(projectId: string): string {
    return join(this.projectsBasePath, projectId, 'copilot-chats');
  }

  private getIndexPath(projectId: string): string {
    return join(this.getChatsDir(projectId), 'index.json');
  }

  private readIndex(projectId: string): ChatIndex {
    this.migrateIfNeeded(projectId);

    const indexPath = this.getIndexPath(projectId);
    if (!existsSync(indexPath)) {
      return { version: 1, chats: [], activeChatId: null };
    }
    try {
      return JSON.parse(readFileSync(indexPath, 'utf-8')) as ChatIndex;
    } catch {
      return { version: 1, chats: [], activeChatId: null };
    }
  }

  private writeIndex(projectId: string, index: ChatIndex): void {
    const dir = this.getChatsDir(projectId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.getIndexPath(projectId), JSON.stringify(index, null, 2));
  }

  /** Migrate legacy copilot-events.ndjson to copilot-chats/ directory. */
  private migrateIfNeeded(projectId: string): void {
    const legacyPath = join(this.projectsBasePath, projectId, 'copilot-events.ndjson');
    const chatsDir = this.getChatsDir(projectId);

    if (!existsSync(legacyPath) || existsSync(join(chatsDir, 'index.json'))) return;

    log(`migrating legacy copilot history for project ${projectId}`);
    mkdirSync(chatsDir, { recursive: true });

    const chatId = randomUUID();
    const newPath = join(chatsDir, `${chatId}.ndjson`);

    // Move the file
    try {
      renameSync(legacyPath, newPath);
    } catch {
      // Cross-device? Copy + delete
      writeFileSync(newPath, readFileSync(legacyPath));
      try { unlinkSync(legacyPath); } catch { /* ok */ }
    }

    // Extract metadata from events
    let title = 'Untitled chat';
    let messageCount = 0;
    let totalCostUsd = 0;
    let firstTimestamp = Date.now();
    let lastTimestamp = Date.now();

    try {
      const raw = readFileSync(newPath, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as Record<string, unknown>;
          if (evt.type === 'user_message' && typeof evt.content === 'string') {
            messageCount++;
            if (title === 'Untitled chat') {
              title = truncateTitle(evt.content);
            }
            if (typeof evt.timestamp === 'number') {
              if (firstTimestamp === Date.now()) firstTimestamp = evt.timestamp;
              lastTimestamp = evt.timestamp;
            }
          } else if (evt.type === 'copilot_completed' && typeof evt.totalCostUsd === 'number') {
            totalCostUsd = evt.totalCostUsd;
            messageCount++; // assistant turn
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* ok */ }

    const index: ChatIndex = {
      version: 1,
      activeChatId: chatId,
      chats: [{
        chatId,
        title,
        createdAt: new Date(firstTimestamp).toISOString(),
        updatedAt: new Date(lastTimestamp).toISOString(),
        messageCount,
        totalCostUsd,
      }],
    };
    this.writeIndex(projectId, index);
    log(`migrated legacy history to chat ${chatId}`);
  }

  private createNewChat(projectId: string, firstMessage?: string): ChatMeta {
    const index = this.readIndex(projectId);
    const chatId = randomUUID();
    const now = new Date().toISOString();
    const meta: ChatMeta = {
      chatId,
      title: firstMessage ? truncateTitle(firstMessage) : 'New chat',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      totalCostUsd: 0,
    };
    index.chats.push(meta);
    index.activeChatId = chatId;
    this.writeIndex(projectId, index);

    // Create empty NDJSON file
    const dir = this.getChatsDir(projectId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${chatId}.ndjson`), '');

    log(`created new chat ${chatId} for project ${projectId}`);
    return meta;
  }

  private updateIndexMeta(projectId: string, chatId: string, updates: Partial<ChatMeta>): void {
    const index = this.readIndex(projectId);
    const chat = index.chats.find((c) => c.chatId === chatId);
    if (!chat) return;
    Object.assign(chat, updates);
    this.writeIndex(projectId, index);
  }

  /* ── Session management ──────────────────────────────────── */

  private getOrCreateSession(projectId: string): CopilotSession {
    const existingId = this.projectSessions.get(projectId);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing) return existing;
    }

    // Find or create the active chat
    const index = this.readIndex(projectId);
    let chatId = index.activeChatId;
    if (!chatId) {
      const meta = this.createNewChat(projectId);
      chatId = meta.chatId;
    }

    const sessionId = randomUUID();
    const session: CopilotSession = {
      sessionId,
      projectId,
      chatId,
      sseClients: new Set(),
      events: [],
      pendingQuestion: null,
      activeQuery: false,
      abortController: null,
      totalCostUsd: 0,
      totalTurns: 0,
      queryCount: 0,
    };
    this.sessions.set(sessionId, session);
    this.projectSessions.set(projectId, sessionId);
    log(`created session ${sessionId} for project ${projectId}, chat ${chatId}`);
    return session;
  }

  /**
   * Send a user message to the copilot. Runs sdk.query() in background.
   * Returns the sessionId immediately.
   */
  async sendMessage(
    projectId: string,
    message: string,
    options?: { maxTurns?: number; maxBudgetUsd?: number; model?: string },
  ): Promise<string> {
    const session = this.getOrCreateSession(projectId);

    if (session.activeQuery) {
      throw new Error('A query is already in progress');
    }

    // If this is the first message in the chat, set the title
    const index = this.readIndex(projectId);
    const chatMeta = index.chats.find((c) => c.chatId === session.chatId);
    if (chatMeta && chatMeta.messageCount === 0) {
      chatMeta.title = truncateTitle(message);
      this.writeIndex(projectId, index);
    }

    // Persist user message for history
    this.persistUserMessage(session, message);

    session.activeQuery = true;
    const ac = new AbortController();
    session.abortController = ac;

    // Run query in background (don't await)
    this.executeQuery(session, message, options, ac).catch((err) => {
      logError(`query error for session ${session.sessionId}:`, err);
    });

    return session.sessionId;
  }

  private async executeQuery(
    session: CopilotSession,
    message: string,
    options: { maxTurns?: number; maxBudgetUsd?: number; model?: string } | undefined,
    ac: AbortController,
  ): Promise<void> {
    const projectPath = join(this.projectsBasePath, session.projectId);

    // Build the ask_user callback for this session
    const askUser = (question: string, opts?: Array<{ label: string; description?: string }>) => {
      return new Promise<string>((resolve, reject) => {
        const questionId = randomUUID();
        const event: ProgressEvent = {
          type: 'copilot_user_question',
          questionId,
          questions: [{ question, options: opts }],
        };
        this.emitEvent(session, event);
        session.pendingQuestion = { questionId, resolve, reject };
      });
    };

    // Build tool defs (plain objects — we'll register them with createSdkMcpServer)
    // The onFlowMutated callback fires immediately when a tool writes to disk,
    // bypassing the stream-parsing path which may not reliably detect tool results.
    const onFlowMutated = () => {
      log(`onFlowMutated: emitting copilot_flow_changed, sseClients=${session.sseClients.size}`);
      this.emitEvent(session, {
        type: 'copilot_flow_changed',
        projectId: session.projectId,
      });
    };
    const toolDefs = buildCopilotToolDefs(session.projectId, askUser, onFlowMutated);

    // Lazy imports
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');

    // Build MCP server with tool definitions
    const mcpServer = sdk.createSdkMcpServer({
      name: 'forgeflow',
      tools: toolDefs.map((def) => {
        // Convert our plain inputSchema objects to Zod schemas
        const zodShape: Record<string, unknown> = {};
        for (const [key, spec] of Object.entries(def.inputSchema)) {
          const s = spec as Record<string, unknown>;
          if (s.type === 'string') {
            zodShape[key] = z.string().optional().describe(String(s.description ?? ''));
          } else if (s.type === 'array') {
            zodShape[key] = z.array(z.any()).optional().describe(String(s.description ?? ''));
          } else if (s.type === 'object') {
            zodShape[key] = z.any().optional().describe(String(s.description ?? ''));
          }
        }

        return sdk.tool(
          def.name,
          def.description,
          zodShape,
          async (args: Record<string, unknown>) => def.handler(args),
        );
      }),
    });

    const env: Record<string, string | undefined> = { ...process.env };
    const seq = { value: 0 };
    const toolNameMap = new Map<string, string>();

    // Track whether this is a continuation of an existing conversation
    const isFollowUp = session.queryCount > 0;
    session.queryCount++;

    try {
      const stream = sdk.query({
        prompt: message,
        options: {
          cwd: projectPath,
          model: options?.model ?? 'sonnet',
          maxTurns: options?.maxTurns ?? 10_000,
          maxBudgetUsd: options?.maxBudgetUsd ?? 3.0,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          // Persist session to disk so follow-up messages can resume
          // the full conversation via `continue: true`
          persistSession: true,
          ...(isFollowUp ? { continue: true } : {}),
          settingSources: [],
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: FORGE_COPILOT_SYSTEM_PROMPT,
          },
          mcpServers: { forgeflow: mcpServer },
          tools: { type: 'preset', preset: 'claude_code' },
          abortController: ac,
          env,
        },
      });

      for await (const msg of stream) {
        if (ac.signal.aborted) break;
        this.processStreamMessage(session, msg, seq, toolNameMap);
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.emitEvent(session, { type: 'copilot_error', error: errorMsg });
      }
    } finally {
      session.activeQuery = false;
      session.abortController = null;
      this.emitEvent(session, {
        type: 'copilot_completed',
        numTurns: session.totalTurns,
        totalCostUsd: session.totalCostUsd,
      });

      // Update index with final cost
      this.updateIndexMeta(session.projectId, session.chatId, {
        totalCostUsd: session.totalCostUsd,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private processStreamMessage(
    session: CopilotSession,
    message: Record<string, unknown>,
    seq: { value: number },
    toolNameMap: Map<string, string>,
  ): void {
    // Handle token-level streaming deltas for real-time text
    if (message.type === 'stream_event') {
      const event = message.event as Record<string, unknown> | undefined;
      if (!event) return;

      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
          // Stream to live SSE clients but don't persist (tokens are tiny fragments).
          // The full text will be persisted when the complete assistant message arrives.
          this.emitEvent(session, {
            type: 'copilot_text',
            content: delta.text,
            sequence: seq.value++,
          }, false);
        }
      }
      return;
    }

    if (message.type === 'assistant') {
      const msg = message.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        const b = block as Record<string, unknown>;
        // Emit full text blocks to SSE clients AND persist for history replay.
        // Stream deltas (persist=false) may have already delivered this token-by-token,
        // so the `consolidated` flag tells the UI to replace pendingText instead of appending.
        if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          this.emitEvent(session, {
            type: 'copilot_text',
            content: b.text,
            sequence: seq.value++,
            consolidated: true,
          } as ProgressEvent);
        } else if (b.type === 'tool_use' && typeof b.name === 'string') {
          toolNameMap.set(b.id as string, b.name);
          const inputStr = JSON.stringify(b.input ?? {});

          // Detect TodoWrite
          if (b.name === 'TodoWrite' && b.input && typeof b.input === 'object' && 'todos' in (b.input as Record<string, unknown>)) {
            this.emitEvent(session, {
              type: 'copilot_todo_update',
              todos: (b.input as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }> }).todos,
            });
          }

          this.emitEvent(session, {
            type: 'copilot_tool_call',
            toolName: b.name,
            toolUseId: b.id as string,
            inputSummary: inputStr.length > 2000 ? inputStr.slice(0, 2000) : inputStr,
            truncated: inputStr.length > 2000,
            sequence: seq.value++,
          });
        }
      }
    } else if (message.type === 'user') {
      // copilot_flow_changed is now emitted directly from tool handlers via onFlowMutated callback.
      // Here we only extract tool_result info for the UI's tool call display.

      // SDK provides parent_tool_use_id at the top level for convenience
      const parentToolUseId = (message as Record<string, unknown>).parent_tool_use_id as string | null;
      const toolUseResult = (message as Record<string, unknown>).tool_use_result;

      if (parentToolUseId) {
        const toolName = toolNameMap.get(parentToolUseId) ?? 'unknown';
        const resultContent = toolUseResult != null ? JSON.stringify(toolUseResult) : '';
        const isError = typeof toolUseResult === 'object' && toolUseResult !== null && 'error' in (toolUseResult as Record<string, unknown>);

        this.emitEvent(session, {
          type: 'copilot_tool_result',
          toolName,
          toolUseId: parentToolUseId,
          outputSummary: resultContent.length > 2000 ? resultContent.slice(0, 2000) : resultContent,
          truncated: resultContent.length > 2000,
          isError,
          sequence: seq.value++,
        });
      } else {
        // Fallback: check content array for tool_result blocks (raw API format)
        const msg = message.message as Record<string, unknown> | undefined;
        const content = msg?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === 'tool_result') {
              const resultContent = typeof b.content === 'string'
                ? b.content
                : JSON.stringify(b.content ?? '');
              const toolName = toolNameMap.get(b.tool_use_id as string) ?? 'unknown';

              this.emitEvent(session, {
                type: 'copilot_tool_result',
                toolName,
                toolUseId: b.tool_use_id as string,
                outputSummary: resultContent.length > 2000 ? resultContent.slice(0, 2000) : resultContent,
                truncated: resultContent.length > 2000,
                isError: b.is_error === true,
                sequence: seq.value++,
              });
            }
          }
        }
      }
    } else if (message.type === 'result') {
      session.totalTurns = (message.num_turns as number | undefined) ?? session.totalTurns;
      session.totalCostUsd = (message.total_cost_usd as number | undefined) ?? session.totalCostUsd;
    }
  }

  /* ── SSE ──────────────────────────────────────────────── */

  subscribeProgress(sessionId: string, res: Response): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log(`subscribeProgress: session ${sessionId} not found`);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Session not found' })}\n\n`);
      res.end();
      return () => {};
    }

    log(`subscribeProgress: session ${sessionId}, replaying ${session.events.length} events`);

    // Replay past events (skip already-answered questions to avoid re-showing them)
    const pendingQId = session.pendingQuestion?.questionId;
    for (const event of session.events) {
      if (event.type === 'copilot_user_question') {
        // Only replay the question if it's still pending
        if (pendingQId && event.questionId === pendingQId) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        continue;
      }
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    session.sseClients.add(res);
    return () => { session.sseClients.delete(res); };
  }

  /**
   * Emit an event to SSE clients and optionally persist to disk.
   * @param persist - If false, only sends to live SSE clients (used for streaming tokens
   *   that will be consolidated into a single copilot_text event later).
   */
  private emitEvent(session: CopilotSession, event: ProgressEvent, persist = true): void {
    if (persist) {
      session.events.push(event);
      this.persistEvent(session, event);
    }

    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of session.sseClients) {
      client.write(data);
    }
  }

  private persistEvent(session: CopilotSession, event: ProgressEvent): void {
    try {
      const dir = this.getChatsDir(session.projectId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `${session.chatId}.ndjson`), JSON.stringify(event) + '\n');
    } catch (err) {
      logError('persistEvent failed:', err);
    }
  }

  private persistUserMessage(session: CopilotSession, message: string): void {
    try {
      const dir = this.getChatsDir(session.projectId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(
        join(dir, `${session.chatId}.ndjson`),
        JSON.stringify({ type: 'user_message', content: message, timestamp: Date.now() }) + '\n',
      );
      // Update index metadata
      this.updateIndexMeta(session.projectId, session.chatId, {
        messageCount: (this.readIndex(session.projectId).chats.find((c) => c.chatId === session.chatId)?.messageCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logError('persistUserMessage failed:', err);
    }
  }

  /* ── Question answering ───────────────────────────────── */

  answerQuestion(sessionId: string, questionId: string, answer: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingQuestion) return false;
    if (session.pendingQuestion.questionId !== questionId) return false;

    session.pendingQuestion.resolve(answer);
    session.pendingQuestion = null;
    return true;
  }

  /* ── Stop / Reset ─────────────────────────────────────── */

  stopSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.activeQuery) return false;

    log(`stopping session ${sessionId}`);
    session.abortController?.abort();

    // Reject pending question
    if (session.pendingQuestion) {
      session.pendingQuestion.reject(new Error('Session stopped'));
      session.pendingQuestion = null;
    }

    return true;
  }

  /** Tear down the in-memory session without deleting disk data. */
  resetSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Stop if active
    if (session.activeQuery) {
      session.abortController?.abort();
    }
    if (session.pendingQuestion) {
      session.pendingQuestion.reject(new Error('Session reset'));
      session.pendingQuestion = null;
    }

    this.sessions.delete(sessionId);
    this.projectSessions.delete(session.projectId);
    log(`reset session ${sessionId}`);
  }

  /* ── Chat CRUD ─────────────────────────────────────────── */

  /** List all chats for a project, sorted by updatedAt descending. */
  listChats(projectId: string): ChatMeta[] {
    const index = this.readIndex(projectId);
    return [...index.chats].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /** Get the active chatId for a project. */
  getActiveChatId(projectId: string): string | null {
    const index = this.readIndex(projectId);
    return index.activeChatId;
  }

  /** Load events for a specific chat. */
  loadChatHistory(projectId: string, chatId: string): ProgressEvent[] {
    const filePath = join(this.getChatsDir(projectId), `${chatId}.ndjson`);
    if (!existsSync(filePath)) return [];

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const events: ProgressEvent[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as ProgressEvent);
        } catch { /* skip malformed lines */ }
      }
      return events;
    } catch (err) {
      logError('loadChatHistory failed:', err);
      return [];
    }
  }

  /** Archive current active chat and create a new empty one. Returns the new chat's metadata. */
  newChat(projectId: string): ChatMeta {
    // Tear down existing session if any
    const existingSession = this.getSessionByProject(projectId);
    if (existingSession) {
      this.resetSession(existingSession.sessionId);
    }

    const index = this.readIndex(projectId);

    // Don't archive empty chats — just reuse them
    if (index.activeChatId) {
      const active = index.chats.find((c) => c.chatId === index.activeChatId);
      if (active && active.messageCount === 0) {
        // Already empty — just return it
        return active;
      }
    }

    // Create a fresh chat
    return this.createNewChat(projectId);
  }

  /** Switch to a different chat. Returns the chat metadata. */
  switchChat(projectId: string, chatId: string): ChatMeta | null {
    const index = this.readIndex(projectId);
    const chat = index.chats.find((c) => c.chatId === chatId);
    if (!chat) return null;

    // Tear down existing session
    const existingSession = this.getSessionByProject(projectId);
    if (existingSession) {
      this.resetSession(existingSession.sessionId);
    }

    // Set as active
    index.activeChatId = chatId;
    this.writeIndex(projectId, index);

    return chat;
  }

  /** Delete a specific chat. Cannot delete the currently active chat. */
  deleteChat(projectId: string, chatId: string): boolean {
    const index = this.readIndex(projectId);

    // Don't delete the active chat
    if (index.activeChatId === chatId) return false;

    const chatIdx = index.chats.findIndex((c) => c.chatId === chatId);
    if (chatIdx === -1) return false;

    // Remove from index
    index.chats.splice(chatIdx, 1);
    this.writeIndex(projectId, index);

    // Delete the NDJSON file
    const filePath = join(this.getChatsDir(projectId), `${chatId}.ndjson`);
    try { unlinkSync(filePath); } catch { /* may not exist */ }

    log(`deleted chat ${chatId} for project ${projectId}`);
    return true;
  }

  /* ── History (backward compat) ─────────────────────────── */

  /**
   * Load past copilot events from disk for the active chat.
   * Returns events that can be replayed to reconstruct conversation state.
   */
  loadHistory(projectId: string): ProgressEvent[] {
    const index = this.readIndex(projectId);
    if (!index.activeChatId) return [];
    return this.loadChatHistory(projectId, index.activeChatId);
  }
}

/* ── Helpers ─────────────────────────────────────────────── */

function truncateTitle(message: string): string {
  const clean = message.replace(/\n/g, ' ').trim();
  if (clean.length <= 80) return clean;
  // Truncate at last word boundary before 80 chars
  const truncated = clean.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

// Singleton
export const copilotManager = new CopilotManager();
