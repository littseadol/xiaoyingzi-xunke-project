# 云端版本开发与运维

## 教师使用流程

1. 维护者先部署网站、开 HTTPS/TURN，并将正式网站地址写入桌面安装包配置。
2. 教师打开该网站，维护者把第一次访问密码告诉她；网站下载栏提供 Windows 安装包。
3. 在白板双击安装包，接受默认“当前用户安装”。
4. 从网站“录制与设置 → 连接教室白板”生成 10 分钟有效的一次性 12 位码，在白板连接窗口填入该码并点“连接教室”。连接页默认勾选“Windows 登录后自动运行”，可以取消；只在安装版绑定成功后生效。
5. 以后直接打开网站；关闭采集端窗口会缩到托盘，网络恢复后自动重连。

她不需要输入 IP、改路由器、开 Windows 防火墙端口或安装 HTTPS 证书。首次安装后尚未完成绑定前白板不会采集。网站“解除绑定”会立即撤销凭据并断开白板。

## 本机模拟

需要 Windows 10/11 x64、Node.js 22.12+、npm 及本项目锁定的开发依赖。执行 `npm ci` 后运行 `npm run dev:cloud`，自动构建并打开独立浏览器及 Electron 采集端，网站为 `https://localhost:8443`，终端显示初始密码。没有 Chrome/Edge 时先运行 `npx playwright install chromium`。

1. 在自动打开的独立浏览器中，用终端密码登录。
2. 登录后从“录制与设置 → 连接教室白板”生成绑定码。
3. 采集端已预填调试网站，只填绑定码即可。首次录像仍关闭；需要先添加时间表并开启。
4. 默认画面是合成测试图。测试录制、回放和喊话后按 `Ctrl+C` 结束，数据保留在 `data/cloud-dev/server`，绑定信息在 `data/cloud-dev/collector`。下次启动无需重新绑定；更改过密码则使用个人密码。

开发启动脚本仅给独立浏览器/Electron 注入当前服务的证书公钥例外和 Node 子进程 CA，不写系统证书，不全局忽略 HTTPS 错误。正式安装包严格校验证书。`XY_LOCAL_MODE=1` 仅选择 0.1 历史局域网模式，不应用于云端调试。

需要主动测试真实摄像头/麦克风时，在 PowerShell 设置 `$env:XY_REAL_DEVICES='1'` 后运行同一命令；测试结束执行 `Remove-Item Env:XY_REAL_DEVICES`。本机模拟不支持手机跨设备访问，手机待正式 HTTPS 网站上线后测试。

有正式域名后设置 `$env:XY_CLOUD_ORIGIN='https://class.example.com'` 再 `npm run dist`。正式包预填且锁定域名；直接 `npm start` 用于连接公开可信网站，无需开发证书例外。

开发浏览器下载的安装包会持久保存到开发电脑的 `Downloads`，使用正常文件名；同名文件添加序号，Windows 保存成功后打开文件所在文件夹。`XY_DEV_DOWNLOAD_DIR` 可以指定其他目录。关闭试用浏览器不会删除这些副本。正式浏览器按自身下载设置保存，可用 `Ctrl+J` 找到下载记录。

## 阿里云资源

建议先在学校附近的中国大陆地域选择 Ubuntu 24.04 LTS x64，2 核 4 GB 作为单路试运行起点，公网带宽建议先按 5–10 Mbps 估算并实测。大陆网站需完成域名 ICP 备案。录制请求码率默认约 1.5 Mbit/s，连续全天原始量约 16 GB/日；H.264 实际体积待测，建议至少 80 GB 可用数据空间。优先独立数据盘，不将录像写入容器层。

准备两条已完成 ICP 备案并解析的 DNS A 记录：`class.example.com` 指向 ECS 公网 IP；`turn.example.com` 也指向该公网 IP。自动 HTTPS 证书要求网站域名正确解析且 TCP 80/443 从公网可达。

安全组只开放：TCP 22（限维护者固定 IP）、TCP 80/443（公网）、UDP 3478、TCP 3478，以及 TURN 媒体 UDP 49160–49200。不给应用服务器映射 8080 到公网，不配置校园 IP 白名单，不开放泛化 TURN relay 网段访问。

单日观看和录像带宽为主要持续费用：每 Mbps 持续上传约 10.8 GB/日，云厂商公网出流量按地区和产品计费，正式采购前应核对阿里云价格。用量超预算时，应暂停/关闭时间表录像；当前版本不提供云流量配额控制。先购买至少一周观察用量再决定月付规格。

## 服务器安装

在服务器执行一次性 Docker Engine 安装和操作系统安全更新。将 Git 仓库克隆至 `/opt/xiaoyingzi`，复制 `deploy/.env.example` 为 `deploy/.env` 后填写：

- 网站域名、TURN 域名、固定公网 IP、ACME 通知邮箱。
- 通过 `openssl rand -hex 32` 生成随机 `XY_TURN_SECRET`。
- `XY_RELEASE` 采用仓库发布标签或镜像版本号。

在 `/opt/xiaoyingzi` 创建只由维护者可读写的 `deploy/downloads/`，将签名或已校验 SHA256 的 Windows 安装包命名为 `XiaoYingZi-Setup.exe` 放入。不要把 `.env`、初始密码、证书私钥、录像数据库或 exe 放入 Git。

从仓库根目录执行以下命令（填写真实 `.env` 后）：

```sh
docker compose -f deploy/compose.yaml --env-file deploy/.env config --quiet
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
docker compose -f deploy/compose.yaml --env-file deploy/.env ps
docker compose -f deploy/compose.yaml --env-file deploy/.env exec app cat /data/initial-password.txt
```

确认 app 健康、turn/caddy 正在运行，公开 `https://class.example.com/api/health` 返回 `ok`。通过可信渠道告知唯一使用者初始密码，首次登录立即修改。命令中的域名需要替换为实际值。

运行 `docker compose -f deploy/compose.yaml --env-file deploy/.env exec app df -h /data` 并观察云盘监控。默认使用 Docker named volume；要使用独立数据盘，在首次启动前用 Compose override 将 `app-data` 替换为 `/mnt/xiaoyingzi/data:/data`，确保属主 UID/GID 1000 可写。备份包含访问凭据和录像，应限制权限及保留时间；先停止 app 再复制数据库，避免 sql.js 写入期间热拷贝。不执行 `down -v`，否则会删除持久数据。

## 更新与回滚

日常网站、录像接口更新通过替换服务端容器维护。先停止 app、备份 `/data` 和下载目录、记录 Git SHA，再 `git fetch --tags` 并切换已审核版本，运行上述 `up -d --build`。用户浏览器刷新后加载新界面；已运行的白板采集页面会重连，但不会自动替换已加载的采集脚本，采集逻辑更新时仍需从托盘退出并重开。通过健康检查、手机登录、临时录像/回放/删除和 TURN 验证后继续使用。失败时切回已知版本并视数据格式变化恢复备份。维护期间录像会中断。

白板桌面壳升级时，发布一个正式域名预设、版本更新的安装包。经由网站更新下载目录发给老师，她从托盘退出旧程序，双击运行新版安装包并接受覆盖安装，保留个人数据。系统 DPAPI 加密的绑定凭据与首次运行后自动启动设置应在 `deleteAppDataOnUninstall: false` 下跨升级保留；更新前必须在同版本配置的测试电脑验证该行为。此版不宣称静默在线升级。

撤销旧白板：网站解除绑定，再托盘重新绑定并输入新码。若服务器疑似泄露，轮换访问密码与 TURN Secret，停止旧容器、换新 Secret、重启 TURN/应用并生成新的一次性绑定码。设备令牌只在维护者的 Windows 登录用户保护范围中加密保存。

## 现场验收与限制

- 公开网站可以登录并播放 HTTPS 页面；手机不需要安装 CA。
- 白板主动出站访问网站 TCP 443；校内代理/受管终端能否运行安装包由校方设备政策确认。
- 学校网络通常屏蔽 UDP 或隔离设备；TURN 是视频/音频必要的中继。用实际白板和手机确认 UDP 3478/媒体端口，TCP TURN 仅作兼容后备。
- 当前 TURN 使用 UDP/TCP 3478，未提供 TLS 443 中继；如果学校仅允许 HTTPS 443，需要额外 IP 的 TURN TLS 443 或专用代理方案，当前配置不保证该网络下直播可用。录像和喊话通过 HTTPS，不依赖 WebRTC。
- 检查网页观看状态确实通过 `relay` candidate；否则校园直连可能掩盖 TURN 配错。
- 检查录像实际占用量、H.264 转码 CPU、至少 3 天保留容量、MP4 回放与带宽。
- 学校/教育机构对课堂摄像头、教师/学生画面的采集、告知、访问和删除政策须由使用者及校方确认。默认录制关闭；只在授权时段开录制。
- 服务器尚未租赁，域名和备案尚未就绪，此仓库配置不代表生产部署已完成。
