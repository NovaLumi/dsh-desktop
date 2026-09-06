import { spawn, execSync, ChildProcess } from 'child_process';
import http from 'http';
import net from 'net';
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
   * 检查端口是否被占用
   */
  public async isPortOccupied(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(false));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * 查找首个可用端口
   */
  public async findAvailablePort(startPort: number = 3080): Promise<number> {
    let p = startPort;
    while (p < startPort + 100) {
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

    // 1. 端口检查与分配
    const isDefaultOccupied = await this.isPortOccupied(this.port);
    if (isDefaultOccupied) {
      // 检查当前占用的端口是否已经是 DSH Web
      const isAlreadyDsh = await this.probeHttpHealth(this.port, 1000);
      if (isAlreadyDsh) {
        this.config.onLog?.(`[DSH] 检测到现有 DSH 服务已在端口 ${this.port} 运行，直接复用。`);
        return this.getBaseUrl();
      }
      // 否则被其他程序占用，寻找下一个可用端口
      this.port = await this.findAvailablePort(this.port + 1);
      this.config.onLog?.(`[DSH] 默认端口被占用，已重定向至可用端口 ${this.port}`);
    }

    // 2. 构造启动命令
    const cmd = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
    const args = ['web'];

    this.config.onLog?.(`[DSH] 正在启动后台服务: ${cmd} ${args.join(' ')}`);

    try {
      this.child = spawn(cmd, args, {
        env: {
          ...process.env,
          PORT: String(this.port),
        },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.child.stdout?.on('data', (data) => {
        const msg = data.toString();
        this.config.onLog?.(`[DSH stdout] ${msg.trim()}`);
      });

      this.child.stderr?.on('data', (data) => {
        const msg = data.toString();
        this.config.onLog?.(`[DSH stderr] ${msg.trim()}`);
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
    const timeout = this.config.maxWaitTimeoutMs || 25000;
    const ready = await this.waitForReady(timeout);
    if (!ready) {
      await this.stop();
      throw new Error(`DSH 服务启动超时（${timeout}ms），未能通过健康检查。`);
    }

    return this.getBaseUrl();
  }

  /**
   * 轮询健康检查
   */
  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (this.isStopping) return false;
      const ok = await this.probeHttpHealth(this.port, 1000);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  /**
   * 单次 HTTP GET 探活
   */
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
          // 只要返回 200/302/304/404 等任意有效 HTTP 响应，均说明 Web 服务已拉起
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
   * 彻底安全杀死 DSH 进程树（核心关口）
   */
  public async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;

    const pid = this.child?.pid;
    this.config.onLog?.(`[DSH] 正在彻底终止 DSH 进程树 (PID: ${pid || 'unknown'})...`);

    if (pid) {
      if (process.platform === 'win32') {
        try {
          // Windows 下使用 taskkill /T /F 强制连同所有子进程一同彻底杀死
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // 若已提前退出则忽略
        }
      } else {
        // Unix / macOS 平台使用 tree-kill
        await new Promise<void>((resolve) => {
          treeKill(pid, 'SIGKILL', () => resolve());
        });
      }
    }

    this.child = null;
    this.config.onLog?.(`[DSH] DSH 服务已完全终止。`);
  }
}
