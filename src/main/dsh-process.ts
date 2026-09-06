import { spawn, execSync, ChildProcess } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import os from 'os';
import treeKill from 'tree-kill';

export interface DshProcessConfig {
  preferredPort?: number;
  maxWaitTimeoutMs?: number;
  onLog?: (log: string) => void;
  onError?: (err: Error) => void;
}

export class DshProcessManager {
  private child: ChildProcess | null = null;
  private port: number = 3080;
  private isStopping: boolean = false;

  constructor(private config: DshProcessConfig = {}) {
    this.port = config.preferredPort || 3080;
  }

  public getPort(): number {
    return this.port;
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * 自动补全 Windows 环境变量 PATH（解决桌面快捷方式启动找不到 node/npm/dsh 的通病）
   */
  public static getAugmentedEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (process.platform === 'win32') {
      const candidates = [
        path.join(process.env.APPDATA || '', 'npm'),
        process.env.NVM_HOME || '',
        process.env.NVM_SYMLINK || '',
        'C:\\Program Files\\nodejs',
        'C:\\Program Files (x86)\\nodejs',
        'D:\\ProgramFiles\\nvm\\nodejs',
      ].filter(Boolean);

      const currentPaths = (env.PATH || '').split(';');
      for (const p of candidates) {
        if (fs.existsSync(p) && !currentPaths.includes(p)) {
          currentPaths.unshift(p);
        }
      }
      env.PATH = currentPaths.join(';');
    }
    return env;
  }

  /**
   * 探测 DSH 可执行入口（支持双保险：直接命令 或 node bin.js）
   */
  private resolveDshCommand(): { cmd: string; args: string[] } {
    const env = DshProcessManager.getAugmentedEnv();

    // 1. 尝试直接检测 dsh 命令是否存在
    try {
      execSync(process.platform === 'win32' ? 'where dsh' : 'which dsh', {
        env,
        stdio: 'ignore',
        windowsHide: true,
      });
      return {
        cmd: process.platform === 'win32' ? 'dsh.cmd' : 'dsh',
        args: ['web'],
      };
    } catch {
      // PATH 中没有检测到，进入第二层探测
    }

    // 2. 双保险：在全局 node_modules 目录探测 bin.js 直接通过 node 拉起
    const possibleGlobalDirs = [
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      'D:\\ProgramFiles\\nvm\\v22.23.2\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
      'C:\\Program Files\\nodejs\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    ];

    for (const p of possibleGlobalDirs) {
      if (fs.existsSync(p)) {
        return {
          cmd: 'node',
          args: [p, 'web'],
        };
      }
    }

    // 默认兜底
    return {
      cmd: process.platform === 'win32' ? 'dsh.cmd' : 'dsh',
      args: ['web'],
    };
  }

  /**
   * 检查端口占用
   */
  public async isPortOccupied(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: any) => {
        resolve(err.code === 'EADDRINUSE');
      });
      server.once('listening', () => {
        server.close(() => resolve(false));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * 查找可用端口
   */
  public async findAvailablePort(startPort: number = 3080): Promise<number> {
    let p = startPort;
    while (p < startPort + 50) {
      const occupied = await this.isPortOccupied(p);
      if (!occupied) return p;
      p++;
    }
    return startPort;
  }

  /**
   * 启动 DSH Web 服务
   */
  public async start(): Promise<string> {
    this.isStopping = false;

    // 1. 端口检查与自愈
    const isDefaultOccupied = await this.isPortOccupied(this.port);
    if (isDefaultOccupied) {
      const isAlreadyDsh = await this.probeHttpHealth(this.port, 1000);
      if (isAlreadyDsh) {
        this.config.onLog?.(`[DSH] 检测到现有 DSH 服务已在端口 ${this.port} 运行，直接复用。`);
        return this.getBaseUrl();
      }
      this.port = await this.findAvailablePort(this.port + 1);
      this.config.onLog?.(`[DSH] 默认端口被占用，已重定向至可用端口 ${this.port}`);
    }

    // 2. 构造环境变量与启动命令
    const env = DshProcessManager.getAugmentedEnv();
    const { cmd, args } = this.resolveDshCommand();

    this.config.onLog?.(`[DSH] 正在启动后台服务: ${cmd} ${args.join(' ')}`);

    try {
      this.child = spawn(cmd, args, {
        env: {
          ...env,
          PORT: String(this.port),
        },
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.child.stdout?.on('data', (data) => {
        this.config.onLog?.(`[DSH stdout] ${data.toString().trim()}`);
      });

      this.child.stderr?.on('data', (data) => {
        this.config.onLog?.(`[DSH stderr] ${data.toString().trim()}`);
      });

      this.child.on('error', (err) => {
        this.config.onError?.(err);
      });

      this.child.on('exit', (code, signal) => {
        this.config.onLog?.(`[DSH] 子进程退出 code: ${code}, signal: ${signal}`);
        this.child = null;
      });
    } catch (e: any) {
      throw new Error(`无法启动 DSH CLI，请确保已安装 @deepseek-ai/dsh：${e.message}`);
    }

    // 3. 健康检查等待服务就绪
    const timeout = this.config.maxWaitTimeoutMs || 30000;
    const ready = await this.waitForReady(timeout);
    if (!ready) {
      await this.stop();
      throw new Error(`DSH 服务启动超时（${timeout}ms），未能通过健康检查。`);
    }

    return this.getBaseUrl();
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (this.isStopping) return false;
      const ok = await this.probeHttpHealth(this.port, 1000);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private probeHttpHealth(port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port: port,
          path: '/',
          timeout: timeout,
        },
        (res) => {
          resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 强力递归清除进程树
   */
  public async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;

    const pid = this.child?.pid;
    this.config.onLog?.(`[DSH] 正在彻底终止 DSH 进程树 (PID: ${pid || 'unknown'})...`);

    if (pid) {
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
        } catch {}
      } else {
        await new Promise<void>((resolve) => {
          treeKill(pid, 'SIGKILL', () => resolve());
        });
      }
    }

    this.child = null;
    this.config.onLog?.(`[DSH] DSH 服务已完全终止。`);
  }
}
