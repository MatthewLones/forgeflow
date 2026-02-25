import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { startServer } from '@forgeflow/server';
import type { Server } from 'node:http';

const isDev = !app.isPackaged;
const DEV_UI_URL = process.env.FORGEFLOW_UI_URL ?? 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let server: Server | null = null;

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(1000, height),
    minWidth: 900,
    minHeight: 600,
    title: 'ForgeFlow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_UI_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: load built UI assets
    const uiPath = path.join(__dirname, '..', '..', '..', 'ui', 'dist', 'index.html');
    mainWindow.loadFile(uiPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async (_event, options?: {
  filters?: { name: string; extensions: string[] }[];
  title?: string;
  multiple?: boolean;
}) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title ?? 'Open File',
    filters: options?.filters,
    properties: [
      'openFile',
      ...(options?.multiple ? ['multiSelections' as const] : []),
    ],
  });
  return result;
});

ipcMain.handle('dialog:saveFile', async (_event, options?: {
  filters?: { name: string; extensions: string[] }[];
  title?: string;
  defaultPath?: string;
}) => {
  if (!mainWindow) return { canceled: true, filePath: '' };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options?.title ?? 'Save File',
    filters: options?.filters,
    defaultPath: options?.defaultPath,
  });
  return result;
});

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const data = await fs.promises.readFile(filePath);
  return data.buffer;
});

ipcMain.handle('fs:readFileUtf8', async (_event, filePath: string) => {
  return fs.promises.readFile(filePath, 'utf-8');
});

ipcMain.handle('fs:writeFile', async (_event, filePath: string, data: ArrayBuffer | string) => {
  if (typeof data === 'string') {
    await fs.promises.writeFile(filePath, data, 'utf-8');
  } else {
    await fs.promises.writeFile(filePath, Buffer.from(data));
  }
});

ipcMain.handle('app:isPackaged', () => app.isPackaged);

ipcMain.handle('app:getPath', (_event, name: string) => {
  return app.getPath(name as 'home' | 'appData' | 'userData' | 'temp' | 'documents' | 'downloads');
});

// ── App Lifecycle ─────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Start the Express server
  const port = Number(process.env.FORGEFLOW_PORT ?? 3001);
  server = startServer(port);
  console.log(`ForgeFlow server started on port ${port}`);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
    server = null;
  }
});
