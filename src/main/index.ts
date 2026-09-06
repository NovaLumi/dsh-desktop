import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { DshProcessManager } from './dsh-process';
import { DshUpdater } from './dsh-updater';
import { AppUpdater } from './app-updater';
import { AppTray } from './tray';

// 1. 单例锁：防止用户重复双击打开多个桌面端实例抢占端口
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let dshManager: DshProcessManager | null = null;
let appUpdater: AppUpdater | null = null;
let tray: AppTray | null = null;
let isQuitting = false;

/**
 * 创建优雅的 Splash 启动屏
 */
function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 360,
    resizable: false,
    frame: false,
    transparent: false,
    center: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '../../src/renderer/splash.html'));
  return win;
}

/**
 * 创建主窗口加载 DSH Web 页面
 */
function createMainWindow(targetUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    center: true,
    show: false,
    backgroundColor: '#111827',
    title: 'DeepSeek Harness',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 外部 http 链接默认在系统原生浏览器打开，不抢占客户端界面
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.loadURL(targetUrl);

  win.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    win.show();
    win.focus();
  });

  // 核心：当主窗口关闭时，关闭应用并杀死后台服务
  win.on('close', async (e) => {
    if (!isQuitting) {
      isQuitting = true;
      e.preventDefault();
      await cleanupAndQuit();
    }
  });

  return win;
}

/**
 * 彻底销毁服务并优雅退出应用
 */
async function cleanupAndQuit() {
  try {
    tray?.destroy();
    if (dshManager) {
      await dshManager.stop();
    }
  } catch (err) {
    console.error('退出清理错误:', err);
  } finally {
    app.exit(0);
  }
}

/**
 * 启动全流程编排
 */
async function bootstrap() {
  splashWindow = createSplashWindow();

  const sendSplashStatus = (msg: string) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('status', msg);
    }
  };

  dshManager = new DshProcessManager({
    preferredPort: 3080,
    onLog: (log) => console.log(log),
    onError: (err) => console.error(err),
  });

  // 1. 初始化桌面客户端自身更新检查器 (GitHub Releases)
  appUpdater = new AppUpdater();
  appUpdater.checkForUpdates();

  // 2. 检查 DSH 官方版本环境与更新
  sendSplashStatus('正在检查 DeepSeek Harness 运行环境...');
  let updateInfo = null;
  try {
    updateInfo = await DshUpdater.checkForUpdate();
  } catch {
    // 离线环境静默降级
  }

  const startDshService = async () => {
    sendSplashStatus('正在拉起 DeepSeek Harness 后台服务...');
    try {
      const baseUrl = await dshManager!.start();
      sendSplashStatus('服务启动成功，正在进入界面...');
      mainWindow = createMainWindow(baseUrl);
    } catch (err: any) {
      dialog.showErrorBox(
        '服务启动失败',
        `无法拉起 DSH 核心服务：${err.message}\n\n请确保已联网并安装了 Node.js 环境。`
      );
      await cleanupAndQuit();
    }
  };

  // 场景 A：首次安装运行，本地尚无 dsh 命令，自动自愈安装
  if (updateInfo && !updateInfo.isInstalled) {
    sendSplashStatus('检测到首次运行，正在自动初始化 DSH 官方核心环境...');
    const ok = await DshUpdater.installOrUpgrade((log) => sendSplashStatus(log.trim()));
    if (!ok) {
      dialog.showErrorBox(
        '环境安装失败',
        '自动安装 @deepseek-ai/dsh 失败，请检查网络或 Node.js 环境配置。'
      );
      await cleanupAndQuit();
      return;
    }
    await startDshService();
    return;
  }

  // 场景 B：已有安装，但官方发布了新版本
  if (updateInfo && updateInfo.hasUpdate) {
    splashWindow.webContents.send('dsh-update-found', updateInfo);

    ipcMain.once('confirm-dsh-upgrade', async (_event, shouldUpgrade: boolean) => {
      if (shouldUpgrade) {
        sendSplashStatus('正在执行官方升级命令 (npm install -g @deepseek-ai/dsh)...');
        await DshUpdater.installOrUpgrade((log) => sendSplashStatus(log.trim()));
      }
      await startDshService();
    });
    return;
  }

  // 场景 C：已有安装且为最新版本，直接拉起
  await startDshService();

  // 3. 挂载系统托盘
  tray = new AppTray({
    onShowMain: () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onRestartService: async () => {
      sendSplashStatus('正在重启 DSH 后台服务...');
      if (dshManager) {
        await dshManager.stop();
        const url = await dshManager.start();
        mainWindow?.loadURL(url);
      }
    },
    onCheckUpdate: async () => {
      const res = await DshUpdater.checkForUpdate();
      if (res.hasUpdate) {
        dialog.showMessageBox({
          type: 'info',
          title: '官方更新提示',
          message: `发现 DSH 新版本 v${res.latestVersion} (当前 v${res.currentVersion})`,
          buttons: ['立即升级', '取消'],
        }).then(async (btn) => {
          if (btn.response === 0) {
            await DshUpdater.installOrUpgrade();
            dialog.showMessageBox({ message: 'DSH 官方核心升级完成，重启客户端即可生效。' });
          }
        });
      } else {
        dialog.showMessageBox({ message: '当前 DeepSeek Harness 已是最新版本。' });
      }
    },
    onQuit: () => cleanupAndQuit(),
  });
  tray.init();
}

// 单例唤醒：如果已经开着，唤醒已有窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAndQuit();
  }
});

app.on('before-quit', async (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();
    await cleanupAndQuit();
  }
});
