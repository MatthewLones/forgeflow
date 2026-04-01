import type { ProgressEvent } from '@forgeflow/types';
import type { TodoItem } from '../components/shared/TodoWidget';

/**
 * Derive a phase-level todo list from run progress events.
 * Maps phase_started → in_progress, phase_completed → completed, phase_failed → failed.
 * Attaches subtask snapshots from subtask_update events.
 * Buffers subtask_update events that arrive before their parent phase_started.
 */
export function derivePhaseTodos(events: ProgressEvent[]): TodoItem[] {
  const todoMap = new Map<string, TodoItem>();
  const order: string[] = [];
  const pendingSubtasks = new Map<string, Array<{ id: string; label: string; status: 'pending' | 'in_progress' | 'completed' }>>();

  for (const event of events) {
    if (event.type === 'phase_started') {
      if (!todoMap.has(event.nodeId)) {
        order.push(event.nodeId);
      }
      const todo: TodoItem = {
        content: event.nodeName,
        activeForm: `Running ${event.nodeName}...`,
        status: 'in_progress',
      };
      // Apply any buffered subtasks that arrived before phase_started
      const buffered = pendingSubtasks.get(event.nodeId);
      if (buffered) {
        todo.subtasks = buffered;
        pendingSubtasks.delete(event.nodeId);
      }
      todoMap.set(event.nodeId, todo);
    } else if (event.type === 'phase_completed') {
      const existing = todoMap.get(event.nodeId);
      if (existing) {
        existing.status = 'completed';
        // Mark all subtasks as completed
        if (existing.subtasks) {
          existing.subtasks = existing.subtasks.map((s) => ({ ...s, status: 'completed' as const }));
        }
      }
    } else if (event.type === 'phase_failed') {
      const existing = todoMap.get(event.nodeId);
      if (existing) {
        existing.status = 'failed';
      }
    } else if (event.type === 'subtask_update') {
      const existing = todoMap.get(event.nodeId);
      if (existing) {
        existing.subtasks = event.subtasks;
      } else {
        // Buffer for later — phase_started hasn't arrived yet
        pendingSubtasks.set(event.nodeId, event.subtasks);
      }
    }
  }

  return order.map((id) => todoMap.get(id)!);
}
