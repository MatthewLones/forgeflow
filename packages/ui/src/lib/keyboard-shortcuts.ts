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

/* ── Shortcut remapping persistence ──────────────────── */

/** The key fields that can be remapped */
export interface ShortcutKeys {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const STORAGE_KEY = 'forgeflow:shortcut-remaps';

/** Load custom remaps from localStorage. Returns id → ShortcutKeys. */
export function loadRemaps(): Record<string, ShortcutKeys> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Save a single remap. */
export function saveRemap(id: string, keys: ShortcutKeys): void {
  const remaps = loadRemaps();
  remaps[id] = keys;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaps));
}

/** Remove a single remap (restore to default). */
export function clearRemap(id: string): void {
  const remaps = loadRemaps();
  delete remaps[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaps));
}

/** Clear all custom remaps. */
export function clearAllRemaps(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Apply saved remaps to a bindings array, returning new array with overridden keys. */
export function applyRemaps(bindings: ShortcutBinding[]): ShortcutBinding[] {
  const remaps = loadRemaps();
  if (Object.keys(remaps).length === 0) return bindings;

  return bindings.map((b) => {
    const remap = remaps[b.id];
    if (!remap) return b;
    return { ...b, key: remap.key, mod: remap.mod, shift: remap.shift, alt: remap.alt };
  });
}

/**
 * Browser-reserved shortcuts that JS cannot intercept.
 * These work fine in Electron but will be swallowed by the browser.
 */
const BROWSER_RESERVED: ShortcutKeys[] = [
  // Tab management
  { key: 'w', mod: true },
  { key: 't', mod: true },
  { key: 'n', mod: true },
  { key: 'Tab', mod: true },
  { key: 'Tab', mod: true, shift: true },
  // Navigation
  { key: 'l', mod: true },
  { key: 'r', mod: true },
  // Dev tools / misc
  { key: 'q', mod: true },
  { key: 'h', mod: true },
  // Window management
  { key: 'm', mod: true },
  { key: 'w', mod: true, shift: true },
];

/** Check if a key combo is reserved by the browser. */
export function isBrowserReserved(keys: ShortcutKeys): boolean {
  return BROWSER_RESERVED.some(
    (r) =>
      r.key.toLowerCase() === keys.key.toLowerCase() &&
      !!r.mod === !!keys.mod &&
      !!r.shift === !!keys.shift &&
      !!r.alt === !!keys.alt,
  );
}

/** Convert a KeyboardEvent to ShortcutKeys (for capture UI). */
export function eventToKeys(e: KeyboardEvent): ShortcutKeys | null {
  // Ignore bare modifier presses
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return null;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return {
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    mod: mod || undefined,
    shift: e.shiftKey || undefined,
    alt: e.altKey || undefined,
  };
}
