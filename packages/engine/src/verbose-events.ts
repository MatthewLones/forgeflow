import type { ProgressEvent } from '@forgeflow/types';

/** Maximum characters for truncated content in verbose events */
export const MAX_VERBOSE_CHARS = 2000;

/** Mutable reference for monotonic sequence numbering within a phase */
export interface SequenceRef {
  value: number;
}

/**
 * Extract verbose ProgressEvents from an Agent SDK message.
 *
 * Handles:
 * - assistant messages with text blocks → text_block events
 * - assistant messages with tool_use blocks → tool_call events
 * - user messages with tool_result blocks → tool_result events
 *
 * Also tracks toolUseId → toolName for correlating results.
 */
export function extractVerboseEvents(
  message: { type: string; message?: { content?: unknown[] }; [key: string]: unknown },
  nodeId: string,
  seq: SequenceRef,
  toolNameMap: Map<string, string>,
): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  const content = message.message?.content;
  if (!Array.isArray(content)) return events;

  if (message.type === 'assistant') {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;

      if (b.type === 'text' && typeof b.text === 'string') {
        const text = b.text;
        const truncated = text.length > MAX_VERBOSE_CHARS;
        events.push({
          type: 'text_block',
          nodeId,
          content: truncated ? text.slice(0, MAX_VERBOSE_CHARS) : text,
          truncated,
          charCount: text.length,
          sequence: seq.value++,
        });
      } else if (b.type === 'tool_use' && typeof b.name === 'string' && typeof b.id === 'string') {
        toolNameMap.set(b.id, b.name);
        const inputStr = JSON.stringify(b.input ?? {});
        const truncated = inputStr.length > MAX_VERBOSE_CHARS;
        events.push({
          type: 'tool_call',
          nodeId,
          toolName: b.name,
          toolUseId: b.id,
          inputSummary: truncated ? inputStr.slice(0, MAX_VERBOSE_CHARS) : inputStr,
          truncated,
          sequence: seq.value++,
        });
      }
    }
  } else if (message.type === 'user') {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;

      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const resultContent = typeof b.content === 'string'
          ? b.content
          : JSON.stringify(b.content ?? '');
        const truncated = resultContent.length > MAX_VERBOSE_CHARS;
        events.push({
          type: 'tool_result',
          nodeId,
          toolName: toolNameMap.get(b.tool_use_id) ?? 'unknown',
          toolUseId: b.tool_use_id,
          outputSummary: truncated ? resultContent.slice(0, MAX_VERBOSE_CHARS) : resultContent,
          truncated,
          isError: b.is_error === true,
          sequence: seq.value++,
        });
      }
    }
  }

  return events;
}
