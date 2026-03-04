/** Modifier-key-agnostic shortcut definition */
export interface ShortcutDefinition {
  id: string;
  label: string;
  category: 'general' | 'tabs' | 'toolbar' | 'layout' | 'nodes' | 'navigation';
  /** The key to press (e.g. 'w', '\\', 'Escape', 'F5') */
  key: string;
  /** Cmd on Mac, Ctrl on Windows */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** When true, fires even when focus is in an input/textarea/CodeMirror */
  global?: boolean;
  /** When true, only fires inside Electron (not in browser) */
  electronOnly?: boolean;
}

export interface ShortcutBinding extends ShortcutDefinition {
  handler: (e: KeyboardEvent) => void;
}

export const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  tabs: 'Tabs & Panels',
  toolbar: 'Toolbar Actions',
  layout: 'Layout',
  nodes: 'Node Operations',
  navigation: 'Navigation',
};

/** Order for display in help overlay */
export const CATEGORY_ORDER = ['general', 'tabs', 'toolbar', 'layout', 'nodes', 'navigation'] as const;

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

const MOD = isMac ? '\u2318' : 'Ctrl';
const SHIFT = isMac ? '\u21E7' : 'Shift';
const ALT = isMac ? '\u2325' : 'Alt';

const KEY_DISPLAY: Record<string, string> = {
  '\\': '\\',
  'Backspace': isMac ? '\u232B' : 'Bksp',
  'Escape': 'Esc',
  '/': '/',
  '[': '[',
  ']': ']',
};

export function formatShortcut(binding: ShortcutDefinition): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(MOD);
  if (binding.shift) parts.push(SHIFT);
  if (binding.alt) parts.push(ALT);
  parts.push(KEY_DISPLAY[binding.key] ?? binding.key.toUpperCase());
  return parts.join(isMac ? '\u200A' : '+');
}
