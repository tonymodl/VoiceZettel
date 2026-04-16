/**
 * VoiceZettel Desktop — Electron Main Process
 *
 * Antigravity-compatible:
 * - Window HIDES on blur (not close) — pre-warmed connections stay alive
 * - Global shortcut: Ctrl+Shift+Space to show/hide
 * - Always on top when visible
 */

const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
const APP_URL = process.env.VZ_URL || 'http://localhost:3000';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 420,
        height: 780,
        alwaysOnTop: true,
        frame: false,
        transparent: false,
        backgroundColor: '#0a0a0a',
        resizable: true,
        skipTaskbar: false,
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.loadURL(APP_URL);

    // Antigravity: HIDE on blur, don't close
    // This preserves WebRTC connections and pre-warmed mic/tokens
    mainWindow.on('blur', () => {
        // Don't auto-hide if devtools are open
        if (!mainWindow.webContents.isDevToolsOpened()) {
            // Optional: auto-hide on blur (uncomment if desired)
            // mainWindow.hide();
        }
    });

    // Prevent close — hide instead
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function toggleWindow() {
    if (!mainWindow) {
        createWindow();
        return;
    }

    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        mainWindow.show();
        mainWindow.focus();
    }
}

function createTray() {
    // Use a simple icon (can be replaced with proper icon)
    const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='
    );
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Показать VoiceZettel', click: () => toggleWindow() },
        { type: 'separator' },
        { label: 'DevTools', click: () => mainWindow?.webContents.openDevTools() },
        { type: 'separator' },
        {
            label: 'Выйти', click: () => {
                app.isQuitting = true;
                app.quit();
            }
        },
    ]);
    tray.setToolTip('VoiceZettel Desktop');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => toggleWindow());
}

app.whenReady().then(() => {
    createWindow();
    createTray();

    // Register global shortcut: Ctrl+Shift+Space
    const registered = globalShortcut.register('CommandOrControl+Shift+Space', () => {
        toggleWindow();
    });

    if (!registered) {
        console.error('Failed to register global shortcut Ctrl+Shift+Space');
    }
});

// macOS: re-create window on dock click
app.on('activate', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
});

// Unregister shortcuts on quit
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// Don't quit when all windows are closed (stay in tray)
app.on('window-all-closed', (e) => {
    // Don't quit — we hide to tray
});
