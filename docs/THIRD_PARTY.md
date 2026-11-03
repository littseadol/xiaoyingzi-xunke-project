# 第三方组件

本项目独立实现业务代码，依赖版本以 `package-lock.json` 为准。

| 组件                                                     | 用途                                    | 许可证/位置                                                                                      |
| -------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Electron / Chromium / Node.js                            | Windows 桌面与浏览器运行时              | 打包目录中的 `LICENSE.electron.txt`、`LICENSES.chromium.html`；各项目附带许可                    |
| React、Express、Vite、TypeScript、ws、sql.js、node-forge | UI、构建、接口、WebSocket、数据库、证书 | 各依赖附带许可证；打包生产依赖位于 `resources/app.asar`                                          |
| ffmpeg-static                                            | 提供独立 FFmpeg 转码程序                | GPL-3.0-or-later，详见附带 `LICENSE`                                                             |
| FFmpeg 6.1.1 essentials Windows x64                      | 无声 H.264 MP4 转码                     | GPL v3；`resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe.LICENSE` 与 `.README` |

本轮下载的 FFmpeg 二进制由 gyan.dev 构建，版本和构建说明来自其附带 README。对应源码入口：<https://github.com/FFmpeg/FFmpeg/commit/e38092ef93>；构建资料：<https://www.gyan.dev/ffmpeg/builds/>。FFmpeg 由独立子进程调用。后续若更新二进制，需同步核对版本、对应源码与许可证；对外再分发时保留这些文件并履行相应许可义务。
