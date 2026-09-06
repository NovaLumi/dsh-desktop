# DeepSeek Harness Desktop (DSH 桌面客户端)

基于 Electron + TypeScript 构建的 **DeepSeek Harness (DSH)** 官方/自建桌面客户端。

旨在解决 DSH 在日常使用中的启动繁琐、终端残留、窗口关闭后后台孤儿进程驻留占用端口、官方更新难追踪等痛点。

---

## ✨ 核心特性

- 🚀 **双击即用**：开箱即用，内置优雅 Splash 启动屏幕与状态加载动画，自动探活并进入 Web UI。
- 🛑 **关闭即关闭（零残留）**：针对 Windows / macOS 底层实现进程树递归强杀（`taskkill /T /F` + `tree-kill`），窗口关闭或退出时 100% 销毁全部后台子进程与 Node 端口占用，告别 `EADDRINUSE: 3080` 报错。
- 🔄 **双层更新机制**：
  1. **DSH 官方核心更新**：启动时自动检测 npm 官方最新版本，若有更新一键调用官方命令升级（`npm i -g @deepseek-ai/dsh`）。
  2. **桌面壳自身更新**：基于 GitHub Releases 自动化检测升级，支持差量下载与重启应用。
- ⚓ **系统托盘集成**：支持托盘常驻、快速唤醒主界面、一键重启 DSH 服务、快速打开 `$DSH_HOME` 配置目录。
- 🔒 **单例锁保护**：防止用户重复双击启动多个实例导致端口抢占。
- 📦 **自动化 CI/CD**：内置 GitHub Actions，打 Tag 即自动跨平台打包产出 Windows 安装包 (`.exe`)、macOS (`.dmg`) 和 Linux (`.AppImage`)。

---

## 🛠️ 项目结构

```text
├── .github/workflows/
│   └── release.yml          # GitHub Actions 自动化编译打包流水线
├── src/
│   ├── main/
│   │   ├── index.ts         # 主进程、单例锁、窗口生命周期管理
│   │   ├── dsh-process.ts   # DSH 子进程拉起、端口探测、HTTP 探活与树强杀
│   │   ├── dsh-updater.ts   # npm 官方 DSH 核心版本比对与一键升级
│   │   ├── app-updater.ts   # 桌面客户端自身更新器 (GitHub Releases)
│   │   └── tray.ts          # 系统托盘菜单
│   ├── preload/
│   │   └── index.ts         # IPC 安全桥梁
│   └── renderer/
│       └── splash.html      # Splash 启动界面与更新选择面板
├── electron-builder.yml     # 多平台打包规则配置
├── tsconfig.json
└── package.json
```

---

## 🚀 快速开始

### 前置要求
1. 本机已安装 **Node.js 18+**。
2. 本机已安装 DeepSeek Harness 官方命令行：
   ```bash
   npm install -g @deepseek-ai/dsh
   ```

### 1. 安装依赖
```bash
npm install
```

### 2. 本地开发与调试
```bash
# 启动 TypeScript 监视编译并运行桌面客户端
npm run build
npm start
```

### 3. 本地打包构建 (Windows)
```bash
# 构建 Windows 安装包 (NSIS .exe)
npm run dist
```
产物将输出在 `release/` 目录下。

---

## 📤 推送至 GitHub 并启用自动发布

### 第一步：修改发布配置
打开 `electron-builder.yml`，将 `publish` 块中的 `owner` 与 `repo` 替换为你的 GitHub 仓库信息：
```yaml
publish:
  provider: github
  owner: NovaLumi
  repo: dsh-desktop
```

### 第二步：推送代码至 GitHub
```bash
git init
git add .
git commit -m "feat: initial commit for DeepSeek Harness Desktop"
git branch -M main
git remote add origin https://github.com/NovaLumi/dsh-desktop.git
git push -u origin main
```

### 第三步：发布版本 (自动触发 GitHub Actions 打包)
当你需要发布新版本并让客户端自动检测到更新时：
```bash
# 1. 更新 package.json 中的 version 为新版本号（如 1.0.1）
# 2. 提交并打 Git Tag
git tag v1.0.1
git push origin v1.0.1
```
GitHub Actions 会自动编译多平台安装包并发布到 GitHub Releases 页面，桌面端在下次启动时即可自动接收到更新提示！

---

## 📄 License
MIT License
