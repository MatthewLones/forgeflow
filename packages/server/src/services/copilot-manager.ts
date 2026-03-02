import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
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

interface PendingQuestion {
  questionId: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
}

interface CopilotSession {
  sessionId: string;
  projectId: string;
  sseClients: Set<Response>;
  events: ProgressEvent[];
  pendingQuestion: PendingQuestion | null;
  activeQuery: boolean;
  abortController: AbortController | null;
  totalCostUsd: number;
  totalTurns: number;
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

  private getOrCreateSession(projectId: string): CopilotSession {
    const existingId = this.projectSessions.get(projectId);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing) return existing;
    }

    const sessionId = randomUUID();
    const session: CopilotSession = {
      sessionId,
      projectId,
      sseClients: new Set(),
      events: [],
      pendingQuestion: null,
      activeQuery: false,
      abortController: null,
      totalCostUsd: 0,
      totalTurns: 0,
    };
    this.sessions.set(sessionId, session);
    this.projectSessions.set(projectId, sessionId);
    log(`created session ${sessionId} for project ${projectId}`);
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

    // Persist user message for history
    this.persistUserMessage(projectId, message);

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
    const toolDefs = buildCopilotToolDefs(session.projectId, askUser);

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

    try {
      const stream = sdk.query({
        prompt: message,
        options: {
          cwd: projectPath,
          model: options?.model ?? 'sonnet',
          maxTurns: options?.maxTurns ?? 25,
          maxBudgetUsd: options?.maxBudgetUsd ?? 1.0,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          persistSession: false,
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
    }
  }

  private processStreamMessage(
    session: CopilotSession,
    message: { type: string; message?: { content?: unknown[] }; subtype?: string; num_turns?: number; total_cost_usd?: number },
    seq: { value: number },
    toolNameMap: Map<string, string>,
  ): void {
    if (message.type === 'assistant') {
      const content = message.message?.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          this.emitEvent(session, {
            type: 'copilot_text',
            content: b.text,
            sequence: seq.value++,
          });
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
      const content = message.message?.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_result') {
          const resultContent = typeof b.content === 'string'
            ? b.content
            : JSON.stringify(b.content ?? '');
          const toolName = toolNameMap.get(b.tool_use_id as string) ?? 'unknown';

          // Detect flow-mutating tool results
          if (MUTATING_TOOLS.has(toolName) && b.is_error !== true) {
            this.emitEvent(session, {
              type: 'copilot_flow_changed',
              projectId: session.projectId,
            });
          }

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
    } else if (message.type === 'result') {
      session.totalTurns = (message as { num_turns?: number }).num_turns ?? session.totalTurns;
      session.totalCostUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? session.totalCostUsd;
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

    // Replay past events
    for (const event of session.events) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    session.sseClients.add(res);
    return () => { session.sseClients.delete(res); };
  }

  private emitEvent(session: CopilotSession, event: ProgressEvent): void {
    session.events.push(event);
    // Persist to disk
    this.persistEvent(session.projectId, event);

    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of session.sseClients) {
      client.write(data);
    }
  }

  private persistEvent(projectId: string, event: ProgressEvent): void {
    try {
      const dir = join(this.projectsBasePath, projectId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'copilot-events.ndjson'), JSON.stringify(event) + '\n');
    } catch (err) {
      logError('persistEvent failed:', err);
    }
  }

  private persistUserMessage(projectId: string, message: string): void {
    try {
      const dir = join(this.projectsBasePath, projectId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(
        join(dir, 'copilot-events.ndjson'),
        JSON.stringify({ type: 'user_message', content: message, timestamp: Date.now() }) + '\n',
      );
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

    // Clear events and state
    session.events = [];
    session.totalCostUsd = 0;
    session.totalTurns = 0;
    session.activeQuery = false;
    session.abortController = null;

    // Also delete the events file
    const eventsPath = join(this.projectsBasePath, session.projectId, 'copilot-events.ndjson');
    try { unlinkSync(eventsPath); } catch { /* may not exist */ }

    log(`reset session ${sessionId}`);
  }

  /* ── History ─────────────────────────────────────────── */

  /**
   * Load past copilot events from disk for a project.
   * Returns events that can be replayed to reconstruct conversation state.
   */
  loadHistory(projectId: string): ProgressEvent[] {
    const eventsPath = join(this.projectsBasePath, projectId, 'copilot-events.ndjson');
    if (!existsSync(eventsPath)) return [];

    try {
      const raw = readFileSync(eventsPath, 'utf-8');
      const events: ProgressEvent[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as ProgressEvent);
        } catch { /* skip malformed lines */ }
      }
      return events;
    } catch (err) {
      logError('loadHistory failed:', err);
      return [];
    }
  }
}

// Singleton
export const copilotManager = new CopilotManager();
