# 技术架构

## 当前部署：0.2 云端

```text
手机 / 电脑浏览器 ── HTTPS/WSS ── Caddy ── Node.js/Express
       │                                    ├─ SQLite：设置、绑定摘要、录像索引
       │                                    └─ 分块 WebM → FFmpeg → 云盘 MP4
       └──── WebRTC（直连或 coturn 中继）────── 白板 Electron 采集窗口
                                             ├─ HTTPS/WSS 主动连接云端
                                             ├─ 单路摄像头 → 预览和云录像
                                             └─ HTTPS 获取短语音 → 扬声器
```

云服务器用 Docker Compose 部署应用、Caddy 与 coturn。应用 HTTP 8080 仅容器网络可见，Caddy 终结公开 HTTPS，域名必须与 `XY_PUBLIC_ORIGIN` 精确一致。TURN REST 凭据每次临时签发、1 小时有效；学校仅放行 443 时需补充中继方案，不能仅靠网页可打开判定视频可达。

白板默认入口为 `electron/cloud.cjs`，仅持有云端绑定和采集窗口，不部署服务器或录像库。用户登录后签发 10 分钟一次性绑定码；设备换取 256 位令牌，云端仅持久化 SHA-256 摘要，白板通过 Windows DPAPI 加密保存在 Electron 用户目录。替换/撤销绑定会断开旧设备，令牌不会发送给观看网页。

观看者使用随机初始密码、scrypt 摘要及 Secure/HttpOnly/SameSite Cookie；变更接口校验公开 Origin，设备接口校验令牌，绑定兑换接口使用一次性能力码与限速。IPC 只向指定窗口、精确的 setup 或绑定站点 `/board` 开放，保持沙箱、上下文隔离、导航与媒体权限限制。

录像上传目标改为云端，保留期限、转码、低空间保护均在服务器执行；无离线缓存补传，网络断开会丢失未上传数据。60 秒未收到片段后将当前录像标记中断并恢复，最长约 90 秒回收（维护每 30 秒执行）。云端数据 volume 与容器版本分开，升级不删除数据。

新增模块：`src/server/cloud.ts`（绑定/TURN）、`electron/setup.*`（安装后连接）、`scripts/dev-cloud.mjs`（本机调试）、`deploy/`（云端部署）。`electron/local.cjs` 保存 0.1 排错模式，只在 `XY_LOCAL_MODE=1` 显式使用。

网站刷新加载新前端，白板采集页面需重开以加载新版脚本；桌面壳升级通过新版安装器，不提供静默更新。云端配置见 `CLOUD.md`，下方为 0.1 历史结构与共用录像实现参考，其中网络/证书规则已被本节覆盖。

## 0.1 历史部署

```text
鸿合白板（Windows 10/11 x64，待真机确认）
  Electron 主进程
    ├─ HTTPS Express 本地服务 :8443（对校园局域网监听）
    ├─ SQLite 设置/录像索引
    ├─ FFmpeg 单任务队列 → H.264 MP4
    └─ 沙箱采集窗口（React + TypeScript）
          └─ 单路 getUserMedia(video=true, audio=false)
                ├─ WebRTC → 一个观看页面
                └─ MediaRecorder → 分块写磁盘 → MP4

手机 / 电脑浏览器
  React + TypeScript + Vite 静态页面
    ├─ HTTPS API：登录、设置、录像、语音上传
    └─ WSS：观看信令和状态；视频通过局域网 WebRTC 传输
```

## 模块

| 路径                         | 职责                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `electron/main.cjs`          | 服务生命周期、托盘、受限权限、证书固定、开机启动选项、防休眠请求 |
| `electron/preload.cjs`       | 限制为本地窗口的 IPC 桥接，不暴露 Node.js                        |
| `src/client/main.tsx`        | 登录、预览、时间表、回放、语音录制、白板控制台                   |
| `src/client/board.ts`        | 单采集流、录像片段上传、WebRTC、扬声器播放、断线重连             |
| `src/server/app.ts`          | API、鉴权、单观看者信令、设备控制、定时心跳                      |
| `src/server/recordings.ts`   | 视频写入、转码、清理、启动恢复、磁盘空间保护                     |
| `src/server/schedule.ts`     | 设置校验和北京时间的录制时段判断                                 |
| `src/server/certificates.ts` | 每个实例的根证书和带本机 IP 的 HTTPS 证书                        |
| `src/server/store.ts`        | sql.js SQLite 元数据，临时文件后原子替换                         |
| `src/shared/types.ts`        | 前后端数据契约                                                   |

## 录像

录像独立于观看页面。服务每 3 秒向白板发送录制意图，窗口按需求打开/释放摄像头，每约 5 分钟结束一段 WebM。数据每秒按序上传本机服务，避免整段驻留内存。结束后 FFmpeg 单任务转码为无声 H.264 MP4，支持移动浏览器回放与快进。

状态机：`writing → processing → ready`；意外中断为 `interrupted → processing → ready/failed`。重启时尝试恢复已收到的 WebM 数据，不承诺找回未落盘数据。分段切换不承诺无帧间隙，须真机测试。

上传队列超过 32 MB 停止片段并重试；单段最多 256 MB；转码限制两个线程，积压超过阈值时暂停新片段。剩余磁盘小于 1 GB 时拒绝开启新片段。失败原始片段保留供排查，并受保留期限清理。

自动清理约每 30 秒执行一次，使用结束时间与 2/3 天保留期限比较，不删除正在写入或处理的录像。

## 连接与权限

- WebRTC `iceServers: []`，不连接公共 STUN/TURN，不处理外网穿透。
- 同时只有一个观看 WebSocket，新页面会替换旧页面，旧页面需手动重连。
- 初始密码随机生成，认证摘要为 scrypt；初始明文仅放本机引导文件，修改密码后删除。
- 观看者使用 Secure / HttpOnly / SameSite=Strict Cookie；登录有效 24 小时，重启服务后需重新登录。
- 控制和上传校验同源；白板接口需要随机进程令牌并限制为回环地址。
- 白板通过 preload 获取本机令牌，不向观看者网页暴露。
- Electron 只信任本服务证书指纹，不全局忽略证书错误；限制页面导航和媒体权限。
- 本地 root CA 每台设备独立生成，不复用用户参考压缩包中的证书。

## 数据与恢复

`data/classroom.sqlite` 保存设置、密码摘要和录像索引；`recordings/` 保存录像；`certificates/` 保存证书；`shouts/` 保存短暂语音。运行数据不进入仓库。

桌面服务与采集端同机运行。控制台关闭后缩到托盘；显式退出先尽量结束录像再关服务。防休眠请求无法覆盖管理员策略、断电或用户主动休眠。

服务退出停止接受新连接并断开 WebSocket；2 秒后回收剩余 HTTP/TLS 连接，防止浏览器未发送请求的 TLS 预连接阻塞退出。随后关闭转码队列和数据库。
