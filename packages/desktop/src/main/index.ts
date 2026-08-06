/**
 * Electron 主进程入口
 *
 * 多窗口架构（对标 cyrene-agent 原版）：
 * - mainWindow: 透明桌宠窗口（Live2D + 拖拽）
 * - chatWindow: 独立聊天窗口（React ChatView）
 */
import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "path";
import { fileURLToPath } from "url";
import { CortexBridge } from "./cortex-bridge.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { PresenceBridge } from "./presence-bridge.js";
import { createTray } from "./tray.js";
import type { Tray } from "electron";

// ESM 下 __dirname 不可用，手动构造
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererDir = path.join(__dirname, "../renderer");

let mainWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let presenceBridge: PresenceBridge | null = null;
let tray: Tray | null = null;
const cortex = new CortexBridge();

function openChatWindow(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return;
  }
  chatWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 680,
    minHeight: 480,
    title: "Cyrene · 聊天",
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void chatWindow.loadFile(path.join(rendererDir, "chat/index.html"));
  chatWindow.once("ready-to-show", () => chatWindow?.show());
  chatWindow.on("closed", () => { chatWindow = null; });
}

void app.whenReady().then(async () => {
  // 初始化 CortexBridge（连接 cortex daemon）
  await cortex.init().catch((err) => {
    console.error("[main] CortexBridge init failed:", err);
  });

  mainWindow = new BrowserWindow({
    width: 600,
    height: 800,
    transparent: true,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  // 注册 IPC 处理器
  registerIpcHandlers(ipcMain, cortex);

  // Presence 层：订阅 WS 事件 → IPC 转发到桌宠窗口
  if (cortex.isInitialized) {
    presenceBridge = new PresenceBridge(mainWindow, cortex.connection);
    presenceBridge.start();
  }

  // ── 窗口拖拽 IPC ────────────────────────────────
  ipcMain.on("window:move", (_e, dx: number, dy: number) => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition((x ?? 0) + dx, (y ?? 0) + dy);
  });
  ipcMain.on("window:move-to", (_e, x: number, y: number) => {
    mainWindow?.setPosition(Math.round(x), Math.round(y));
  });
  let _dragging = false;
  ipcMain.on("window:set-dragging", (_e, v: boolean) => {
    _dragging = v;
    // 抑制 Windows DWM 拖拽重影（0.99 透明度切换 DWM 合成路径）
    mainWindow?.setOpacity(v ? 0.99 : 1.0);
  });
  ipcMain.handle("window:set-interactive", (_e, v: boolean) => {
    mainWindow?.setIgnoreMouseEvents(!v, { forward: true });
    return true;
  });
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:hide", () => mainWindow?.hide());
  ipcMain.on("app:quit", () => app.quit());
  ipcMain.handle("window:capture-frame", async (event) => {
    // harness 视觉闭环：窗口级截图导出（capturePage 捕获窗口自身渲染——遮挡免疫）
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win) return { ok: false, error: "窗口不可用" };
    try {
      const image = await win.capturePage();
      const outPath = path.join(app.getPath("userData"), "desktop-shot.png");
      const fs = await import("fs");
      fs.writeFileSync(outPath, image.toPNG());
      return { ok: true, data: outPath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ── 外部截图触发（harness 视觉闭环：轮询请求文件——外部写文件即触发截图）──
  const shotRequestPath = path.join(app.getPath("userData"), "desktop-shot-request");
  const shotTimer = setInterval(() => {
    const fs = require("fs") as typeof import("fs");
    if (!fs.existsSync(shotRequestPath)) return;
    try {
      fs.rmSync(shotRequestPath);
      const win = mainWindow ?? chatWindow;
      if (!win || win.isDestroyed()) return;
      void win.capturePage().then((image) => {
        const outPath = path.join(app.getPath("userData"), "desktop-shot.png");
        fs.writeFileSync(outPath, image.toPNG());
        console.error(`[main] screenshot captured → ${outPath}`);
      });
    } catch (e) {
      console.error("[main] screenshot poll error:", e);
    }
  }, 500);
  if (shotTimer.unref) shotTimer.unref();
  app.on("before-quit", () => clearInterval(shotTimer));
  ipcMain.handle("window:get-cursor-position", () => {
    const pt = screen.getCursorScreenPoint();
    return { x: pt.x, y: pt.y };
  });

  // ── 聊天窗口 ────────────────────────────────────
  ipcMain.on("chat:open", () => openChatWindow());

  // ── 系统托盘：应用生命周期入口（桌宠 skipTaskbar，无托盘则无法退出）──
  tray = createTray({
    iconPath: path.join(rendererDir, "avatars/cyrene-avatar.png"),
    onOpenChat: () => openChatWindow(),
    getMainWindow: () => mainWindow,
  });

  mainWindow.on("closed", () => {
    presenceBridge?.dispose();
    presenceBridge = null;
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
});

app.on("activate", () => {
  if (mainWindow === null) {
    // macOS 重新激活时重建窗口
    // （macOS 非必需，但保留兼容）
  }
});
