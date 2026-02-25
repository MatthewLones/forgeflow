import { useEffect, useRef, useCallback, useState, type Dispatch } from 'react';
import type { FlowDefinition } from '@forgeflow/types';
import { useProjectStore } from '../context/ProjectStore';
import type { FlowAction } from '../context/FlowReducer';

const SAVE_DEBOUNCE_MS = 800;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Auto-save hook: watches flow state and persists to server when dirty.
 * Returns save status for UI indicator.
 */
export function useSyncFlow(
  projectId: string,
  flow: FlowDefinition,
  dirty: boolean,
  dispatch: Dispatch<FlowAction>,
): SaveStatus {
  const { saveFlow } = useProjectStore();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirty) return;

    // Clear existing timer
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setStatus('saving');
      try {
        await saveFlow(projectId, flow);
        dispatch({ type: 'MARK_CLEAN' });
        setStatus('saved');

        // Clear "saved" status after 2 seconds
        if (savedRef.current) clearTimeout(savedRef.current);
        savedRef.current = setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('error');
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dirty, flow, projectId, saveFlow, dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedRef.current) clearTimeout(savedRef.current);
    };
  }, []);

  return status;
}
