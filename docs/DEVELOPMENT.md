# 开发与稳定交付

## 环境与命令

Windows 10/11 x64，Node.js >=22.12。依赖由 `package-lock.json` 固定。

```powershell
npm ci
npm run test
npm run build
npm run dev:cloud
```

- `npm run check`：Prettier 检查、单元/集成测试、前端/服务端/测试类型检查、生产构建。
- `npm run format`：应用仓库已有 Prettier 格式。
- `npm run test:e2e`：真实 HTTPS 服务 + 合成摄像头/麦克风的浏览器和实际 Electron 媒体测试；需先构建。
- `npm run dev:cloud`：自动打开本机云端网站与采集端，默认合成设备，终端显示密码。
- `npm run dist`：执行检查并生成 Windows x64 用户级 NSIS 安装程序；正式发布前配置 `XY_CLOUD_ORIGIN`。
- `npm run test:portable`：验证已生成便携 exe 的自解压、HTTPS、preload 和默认待命窗口，最后回收隔离测试进程。
- `npm run start:server`：仅启动后端用于排错，不会调用摄像头。
- `XY_DATA_DIR`：后端和桌面端均可使用的数据目录覆盖，测试使用独立临时目录。默认桌面端使用 Electron 用户数据目录。`XY_PORT` 仅供后端 CLI 调试。
- `XY_BROWSER_PATH`：端到端测试浏览器路径。默认优先本机 Chrome/Edge，否则使用 Playwright Chromium；缺少浏览器时运行 `npx playwright install chromium`。

## 打包验证

开发版媒体测试通过后生成安装包，再用云端媒体用例验证实际打包目录中的程序，覆盖绑定页面、asar、preload、凭据保留与媒体链路。当前包仍含 0.1 排错资源，但默认只运行云端采集，不监听本机端口。

```powershell
npm run dist
$env:XY_DESKTOP_EXE = (Resolve-Path 'release/win-unpacked/小影子教室助手.exe').Path
npm run test:e2e -- --grep 云端
Remove-Item Env:XY_DESKTOP_EXE
```

打包测试只使用合成摄像头/麦克风，并取消自动启动选项，不安装系统证书或修改防火墙。NSIS 启动器不提供 Playwright `electron.launch` 调试管道，媒体测试指向 `win-unpacked`；安装器的覆盖升级和 Windows 登录项在隔离测试机额外验收。`test:portable` 仅为 0.1 便携包历史检查，不用于 0.2 安装交付。

## Harness 工作流

1. 读 `AGENTS.md` 和 `PROGRESS.md`，确认已有证据和用户授权边界。
2. 将这次交付的行为写成可检查的验收目标；必要时更新需求/决策。
3. 先在对应边界补充有价值的测试，再做最小实现。
4. 按风险运行检查：纯文档读检；业务逻辑跑单元测试；接口跑集成测试；媒体改动跑浏览器测试；发布前打包。
5. 区分“编译通过”“合成设备验证”“物理摄像头验证”“鸿合教室验收”，不能互相替代。
6. 更新 `PROGRESS.md`：完成什么、命令和结果、失败原因、剩余限制、下一步。

## 开发约束

- 所有素材、字体和脚本本地提供，不依赖互联网加载 UI 资源。
- 服务器不提供测试登录、假设备、模拟录像等生产入口；合成设备能力只在测试夹具中注入。
- 时间表、保留清理、鉴权和媒体上传顺序属于关键边界，必须有回归测试。
- 记录错误到控制台/产品状态，不能吞错后显示成功。
- 不自动安装根证书或修改 Windows 防火墙；部署操作由现场使用者按文档完成。
- 开机启动由首次连接页或白板控制台选择，开发模式不修改登录项。

## 依赖下载

Electron 和 FFmpeg 的 npm 安装脚本需要下载二进制。如果网络受限，可在当前 PowerShell 进程临时配置可信镜像后安装，避免写入系统级 npm 配置。具体使用过的镜像和验证结果记录在进度文档，不将下载失败误报为代码问题。

本轮 GitHub 下载超时时使用以下镜像配置后完成安装和打包；这些设置只在当前终端有效。也可在正常网络下直接使用默认源。

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:FFMPEG_BINARIES_URL = 'https://registry.npmmirror.com/-/binary/ffmpeg-static'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm ci
```
