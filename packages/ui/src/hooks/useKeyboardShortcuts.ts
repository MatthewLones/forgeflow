import { useEffect, useRef } from 'react';
import { isElectron } from '../lib/electron';
import { isMac, type ShortcutBinding } from '../lib/keyboard-shortcuts';

/**
 * Returns true if the active element is a text-editing context where
 * non-global shortcuts should be suppressed.
 */
function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.classList?.contains('cm-content')) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function matchesEvent(binding: ShortcutBinding, e: KeyboardEvent): boolean {
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  if (binding.mod && !modPressed) return false;
  if (!binding.mod && modPressed) return false;

  if ((binding.shift ?? false) !== e.shiftKey) return false;
  if ((binding.alt ?? false) !== e.altKey) return false;

  return e.key.toLowerCase() === binding.key.toLowerCase();
}

/**
 * Central keyboard shortcut hook. Registers a single document-level
 * keydown listener and dispatches to the first matching binding.
 */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const binding of bindingsRef.current) {
        if (!matchesEvent(binding, e)) continue;
        if (binding.electronOnly && !isElectron()) continue;
        if (!binding.global && isEditingText()) continue;

        e.preventDefault();
        binding.handler(e);
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
