/**
 * Electron bridge utilities.
 *
 * When running inside Electron, the preload script exposes
 * `window.forgeflow` with IPC methods for file dialogs,
 * filesystem access, etc. In the browser this object is undefined.
 */

export interface ForgeFlowElectronAPI {
  isElectron: true;
  isPackaged: () => Promise<boolean>;
  getPath: (name: string) => Promise<string>;
  dialog: {
    openFile: (options?: {
      filters?: { name: string; extensions: string[] }[];
      title?: string;
      multiple?: boolean;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
    saveFile: (options?: {
      filters?: { name: string; extensions: string[] }[];
      title?: string;
      defaultPath?: string;
    }) => Promise<{ canceled: boolean; filePath: string }>;
  };
  fs: {
    readFile: (filePath: string) => Promise<ArrayBuffer>;
    readFileUtf8: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, data: ArrayBuffer | string) => Promise<void>;
  };
  onForgeFileOpen?: (callback: (filePath: string) => void) => () => void;
}

declare global {
  interface Window {
    forgeflow?: ForgeFlowElectronAPI;
  }
}

/** Whether we are running inside the Electron desktop app */
export function isElectron(): boolean {
  return !!window.forgeflow?.isElectron;
}

/** Get the Electron API. Returns undefined in the browser. */
export function getElectronAPI(): ForgeFlowElectronAPI | undefined {
  return window.forgeflow;
}
