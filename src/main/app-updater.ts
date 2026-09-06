import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow } from 'electron';

export class AppUpdater {
  constructor(private mainWindow?: BrowserWindow) {
    // 默认关闭自动静默下载，由用户确认后再下
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    this.registerEvents();
  }

  private registerEvents() {
    autoUpdater.on('update-available', (info) => {
      dialog
        .showMessageBox({
          type: 'info',
          title: '发现桌面客户端新版本',
          message: `DeepSeek Harness 桌面端发现新版本 v${info.version}！`,
          detail: '是否立即下载更新？',
          buttons: ['立即下载', '暂不更新'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) {
            autoUpdater.downloadUpdate();
          }
        });
    });

    autoUpdater.on('update-downloaded', () => {
      dialog
        .showMessageBox({
          type: 'info',
          title: '更新已就绪',
          message: '新版本已下载完毕，将在下次启动时自动应用。',
          detail: '是否立即重启应用并安装新版本？',
          buttons: ['立即重启', '稍后自动更新'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
    });

    autoUpdater.on('error', (err) => {
      console.warn('[AppUpdater Error]', err.message);
    });
  }

  public checkForUpdates() {
    // 开发环境下通常跳过，仅在打包后检测
    if (process.env.NODE_ENV === 'development') {
      console.log('[AppUpdater] 开发模式跳过 GitHub Release 检查。');
      return;
    }
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[AppUpdater] 检查更新失败:', err.message);
    });
  }
}
