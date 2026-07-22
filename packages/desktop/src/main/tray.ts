/**
 * 系统托盘 — 应用生命周期入口
 *
 * 桌宠窗 skipTaskbar + 透明 + 可点击穿透，任务栏无图标。
 * 托盘是用户显隐桌宠、打开聊天、退出应用的唯一正规入口。
 *
 * 菜单只放能真正工作的项——不放"设置(开发中)"之类画饼项，
 * 等真有承载内容（persona 切换等）再扩展。
 */
import { Tray, Menu, nativeImage, app } from "electron";
import type { BrowserWindow } from "electron";
import { existsSync } from "fs";

export interface TrayOptions {
  /** 托盘图标绝对路径（png）。不存在时回退到空图标 */
  iconPath: string;
  /** 打开聊天窗口 */
  onOpenChat: () => void;
  /** 获取桌宠主窗口（可能已销毁返回 null） */
  getMainWindow: () => BrowserWindow | null;
}

/**
 * 创建系统托盘。
 *
 * 返回的 Tray 实例必须由调用方持有引用，否则会被 GC 回收导致图标消失。
 */
export function createTray(opts: TrayOptions): Tray {
  // Windows 托盘图标建议 16×16，nativeImage 自动缩放；图标缺失时用空图标兜底
  const image = existsSync(opts.iconPath)
    ? nativeImage.createFromPath(opts.iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  const tray = new Tray(image);
  tray.setToolTip("Cyrene");

  const rebuildMenu = (): void => {
    const win = opts.getMainWindow();
    const petVisible = win != null && !win.isDestroyed() && win.isVisible();
    const menu = Menu.buildFromTemplate([
      { label: "打开聊天", click: () => opts.onOpenChat() },
      {
        label: petVisible ? "隐藏桌宠" : "显示桌宠",
        click: () => {
          const w = opts.getMainWindow();
          if (!w || w.isDestroyed()) return;
          if (w.isVisible()) w.hide();
          else { w.show(); w.focus(); }
        },
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  };

  rebuildMenu();
  // 每次右键弹出前重建，保证"显示/隐藏"标签反映当前可见态
  tray.on("right-click", rebuildMenu);

  // 双击托盘 = 显示并聚焦桌宠
  tray.on("double-click", () => {
    const w = opts.getMainWindow();
    if (!w || w.isDestroyed()) return;
    w.show();
    w.focus();
  });

  return tray;
}
