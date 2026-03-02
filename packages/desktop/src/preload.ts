import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposes a safe subset of Electron APIs to the renderer process
 * via window.forgeflow. The UI package checks for this object
 * to detect whether it's running inside Electron.
 */
const api = {
  /** True when running inside Electron */
  isElectron: true as const,

  /** Whether this is a packaged (production) build */
  isPackaged: () => ipcRenderer.invoke('app:isPackaged') as Promise<boolean>,

  /** Get an Electron app path (home, appData, userData, etc.) */
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name) as Promise<string>,

  dialog: {
    openFile: (options?: {
      filters?: { name: string; extensions: string[] }[];
      title?: string;
      multiple?: boolean;
    }) => ipcRenderer.invoke('dialog:openFile', options) as Promise<{
      canceled: boolean;
      filePaths: string[];
    }>,

    saveFile: (options?: {
      filters?: { name: string; extensions: string[] }[];
      title?: string;
      defaultPath?: string;
    }) => ipcRenderer.invoke('dialog:saveFile', options) as Promise<{
      canceled: boolean;
      filePath: string;
    }>,
  },

  fs: {
    readFile: (filePath: string) =>
      ipcRenderer.invoke('fs:readFile', filePath) as Promise<ArrayBuffer>,

    readFileUtf8: (filePath: string) =>
      ipcRenderer.invoke('fs:readFileUtf8', filePath) as Promise<string>,

    writeFile: (filePath: string, data: ArrayBuffer | string) =>
      ipcRenderer.invoke('fs:writeFile', filePath, data) as Promise<void>,
  },

  /** Listen for .forge file opens (double-click in Finder/Explorer) */
  onForgeFileOpen: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('forge:open-file', handler);
    return () => { ipcRenderer.removeListener('forge:open-file', handler); };
  },
};

export type ForgeFlowElectronAPI = typeof api;

contextBridge.exposeInMainWorld('forgeflow', api);
