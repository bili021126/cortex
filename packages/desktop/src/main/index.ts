/**
 * Electron 主进程入口
 *
 * 多窗口架构（对标 cyrene-agent 原版）：
 * - mainWindow: 透明桌宠窗口（Live2D + 拖拽）
 * - chatWindow: 独立聊天窗口（React ChatView）
 */
import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "path";
import * as fs from "fs";
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
      sandbox: false // R13 归因：type:module 的 preload 是 ESM——sandbox preload 不支持 ESM（只能 require）——contextIsolation 仍在,
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
      sandbox: false // R13 归因：type:module 的 preload 是 ESM——sandbox preload 不支持 ESM（只能 require）——contextIsolation 仍在,
    },
  });

  void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`[main] renderer load FAILED ${code}: ${desc}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.error("[main] renderer loaded OK");
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[main] renderer GONE: ${details.reason}`);
  });
  mainWindow.webContents.on("console-message", (_e, level, message) => {
    console.error(`[renderer:${level}] ${message.slice(0, 200)}`);
  });

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

  // ── 定时自动截图（harness 视觉闭环：每 5 秒截一张窗口渲染到固定路径——遮挡免疫）──
  const shotOutPath = path.join(app.getPath("userData"), "desktop-shot.png");
  console.error(`[main] screenshot timer armed → ${shotOutPath}`);
  const shotTimer = setInterval(() => {
    const win = chatWindow ?? mainWindow;
    if (!win || win.isDestroyed()) {
      console.error(`[main] screenshot skip——窗口不可用 main=${!!mainWindow} chat=${!!chatWindow}`);
      return;
    }
    // chat 窗口：capturePage（非透明——可用）；桌宠：executeJavaScript 取 canvas（透明——capturePage 挂起）
    if (win === chatWindow) {
      void win.capturePage().then((image) => {
        if (image.isEmpty()) return;
        fs.writeFileSync(shotOutPath, image.toPNG());
        console.error(`[main] chat shot saved ${image.getSize().width}x${image.getSize().height}`);
      }).catch((e) => {
        console.error("[main] chat shot error:", e);
      });
      return;
    }
    // 桌宠：main 直接取 canvas（绕开 renderer 模块链——Live2D 失败不阻断）
    void win.webContents.executeJavaScript(`(function(){var c=document.getElementById('live2d-canvas');if(!c)return null;try{return c.toDataURL('image/png');}catch(e){return null;}})()`).then((dataUrl: string | null) => {
      if (!dataUrl || dataUrl.length < 100) return;
      const b64 = dataUrl.split(",")[1] ?? "";
      fs.writeFileSync(shotOutPath, Buffer.from(b64, "base64"));
      console.error(`[main] shot saved ${b64.length}b`);
    }).catch((e) => {
      console.error("[main] shot exec error:", e);
    });
  }, 5000);
  if (shotTimer.unref) shotTimer.unref();
  app.on("before-quit", () => clearInterval(shotTimer));
  // ── 渲染进程 canvas 截图落盘（绕开透明窗口 capturePage 挂起——renderer 自渲染 toDataURL）──
  ipcMain.handle("window:save-shot", async (_e, dataUrl: string) => {
    try {
      const b64 = dataUrl.split(",")[1] ?? "";
      const buf = Buffer.from(b64, "base64");
      const outPath = path.join(app.getPath("userData"), "desktop-shot.png");
      const fs = await import("fs");
      fs.writeFileSync(outPath, buf);
      console.error(`[main] save-shot wrote ${buf.length}b → ${outPath}`);
      return { ok: true, data: outPath };
    } catch (e) {
      console.error(`[main] save-shot error: ${String(e)}`);
      return { ok: false, error: String(e) };
    }
  });
  ipcMain.handle("window:get-cursor-position", () => {
    const pt = screen.getCursorScreenPoint();
    return { x: pt.x, y: pt.y };
  });

  // ── 聊天窗口 ────────────────────────────────────
  ipcMain.on("chat:open", () => openChatWindow());
  // U1 运行验证（临时）：自动开聊天 + 注入消息触发发送（手脚——验证完移除）
  setTimeout(() => {
    openChatWindow();
    setTimeout(() => {
      const w = chatWindow;
      if (!w || w.isDestroyed()) return;
      void w.webContents.executeJavaScript(`(function(){
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        const ta = document.getElementById('input');
        if (!ta) return 'no-input';
        setter.call(ta, '你好，昔涟');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return 'injected';
      })()`);
    }, 2000);
  }, 1500);

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
