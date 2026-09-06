import { Tray, Menu, nativeImage, app, shell, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';

export interface TrayCallbacks {
  onShowMain: () => void;
  onRestartService: () => void;
  onCheckUpdate: () => void;
  onQuit: () => void;
}

export class AppTray {
  private tray: Tray | null = null;

  constructor(private callbacks: TrayCallbacks) {}

  public init() {
    // 默认生成一个 16x16 纯色图标防止缺少 build/icon 时报错
    const icon = nativeImage.createEmpty();
    this.tray = new Tray(icon);
    this.tray.setToolTip('DeepSeek Harness 桌面客户端');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示 DeepSeek Harness 主窗口',
        click: () => this.callbacks.onShowMain(),
      },
      { type: 'separator' },
      {
        label: '重启后台 DSH 服务',
        click: () => this.callbacks.onRestartService(),
      },
      {
        label: '打开 DSH 用户配置目录',
        click: () => {
          const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
          shell.openPath(dshHome);
        },
      },
      {
        label: '检查更新',
        click: () => this.callbacks.onCheckUpdate(),
      },
      { type: 'separator' },
      {
        label: '完全退出',
        click: () => this.callbacks.onQuit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.on('double-click', () => {
      this.callbacks.onShowMain();
    });
  }

  public destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
