import { exec, execSync } from 'child_process';
import https from 'https';
import semver from 'semver';
import { DshProcessManager } from './dsh-process';

export interface DshUpdateInfo {
  hasUpdate: boolean;
  isInstalled: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  releaseNotesUrl?: string;
}

export class DshUpdater {
  private static NPM_REGISTRY = 'https://registry.npmjs.org/@deepseek-ai/dsh';
  private static MIRROR_REGISTRY = 'https://registry.npmmirror.com/@deepseek-ai/dsh';

  /**
   * 获取本地安装的 DSH 版本，未安装返回 null
   */
  public static getLocalVersion(): string | null {
    const env = DshProcessManager.getAugmentedEnv();
    try {
      const output = execSync('dsh -V', {
        env,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const match = output.trim().match(/(\d+\.\d+\.\d+[-\w.]*)/);
      return match ? match[1] : output.trim();
    } catch {
      return null;
    }
  }

  /**
   * 从 npm 官方或镜像源查询最新版本号
   */
  public static async getRemoteVersion(registryUrl: string = this.NPM_REGISTRY): Promise<string | null> {
    const fetchJson = (url: string): Promise<any> => {
      return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 5000 }, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Status ${res.statusCode}`));
          }
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
    };

    try {
      const json = await fetchJson(`${registryUrl}/latest`).catch(() => {
        return fetchJson(`${this.MIRROR_REGISTRY}/latest`);
      });
      return json?.version || null;
    } catch {
      return null;
    }
  }

  /**
   * 检查 DSH 安装与更新状态
   */
  public static async checkForUpdate(): Promise<DshUpdateInfo> {
    const local = this.getLocalVersion();
    const remote = await this.getRemoteVersion();

    if (!local) {
      // 本地未安装
      return {
        hasUpdate: false,
        isInstalled: false,
        currentVersion: null,
        latestVersion: remote,
      };
    }

    if (!remote) {
      // 离线或无法连网，有本地直接启动
      return {
        hasUpdate: false,
        isInstalled: true,
        currentVersion: local,
        latestVersion: null,
      };
    }

    const cleanLocal = semver.clean(local) || semver.coerce(local)?.version || local;
    const cleanRemote = semver.clean(remote) || semver.coerce(remote)?.version || remote;

    const hasUpdate =
      semver.valid(cleanLocal) && semver.valid(cleanRemote)
        ? semver.gt(cleanRemote, cleanLocal)
        : false;

    return {
      hasUpdate,
      isInstalled: true,
      currentVersion: local,
      latestVersion: remote,
      releaseNotesUrl: 'https://github.com/deepseek-ai/deepseek-harness/releases',
    };
  }

  /**
   * 执行官方安装或升级命令：npm install -g @deepseek-ai/dsh@latest
   */
  public static installOrUpgrade(onLog?: (data: string) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const cmd = 'npm install -g @deepseek-ai/dsh@latest';
      const env = DshProcessManager.getAugmentedEnv();
      onLog?.(`正在执行官方安装命令: ${cmd}`);

      const proc = exec(cmd, { env, windowsHide: true });

      proc.stdout?.on('data', (chunk) => onLog?.(chunk.toString()));
      proc.stderr?.on('data', (chunk) => onLog?.(chunk.toString()));

      proc.on('close', (code) => {
        if (code === 0) {
          onLog?.('DSH 官方核心组件安装成功！');
          resolve(true);
        } else {
          onLog?.(`安装命令退出码: ${code}`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        onLog?.(`安装命令执行异常: ${err.message}`);
        resolve(false);
      });
    });
  }
}
