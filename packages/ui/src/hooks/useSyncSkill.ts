import { useEffect, useRef } from 'react';
import { useProjectStore } from '../context/ProjectStore';
import type { SkillState } from '../context/SkillContext';

const CACHE_DEBOUNCE_MS = 800;
const SAVE_DEBOUNCE_MS = 1500;

/**
 * Syncs skill editor state back to ProjectStore's skillData cache and to the server.
 * Both cache update and server save are debounced to avoid creating intermediate
 * artifacts when the user is typing in the output name field.
 */
export function useSyncSkill(
  projectId: string,
  skillName: string,
  state: SkillState,
) {
  const { updateSkillCache, saveSkill } = useProjectStore();
  const cacheTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!state.dirty) return;

    // Debounce cache update to avoid intermediate artifacts while typing
    if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
    cacheTimerRef.current = setTimeout(() => {
      updateSkillCache(skillName, state.files);
    }, CACHE_DEBOUNCE_MS);

    // Debounce the server save (longer)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveSkill(projectId, skillName, state.files);
      } catch (err) {
        console.error('Failed to auto-save skill:', err);
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state.dirty, state.files, skillName, projectId, updateSkillCache, saveSkill]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cacheTimerRef.current) clearTimeout(cacheTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);
}
