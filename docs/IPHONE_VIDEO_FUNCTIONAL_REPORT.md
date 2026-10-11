# iPhone 原片功能推进（2026-10-11）

## 验收范围

按用户最新要求：以家庭日常功能为主，不把 WAF、持续监控、长时间观察等全部作为功能验收前置条件；**必须支持 iPhone 原片，不能要求用户先导出 MP4**。鉴权、私有媒体和生产数据保护边界不变。

当前结论：**本地转码功能通过；完整云端视频 E2E 与真机 Safari 待验收。** 不把本地 Chromium/视口模拟写成 iPhone 真机通过，也不自动上线生产。

## 实现

- 默认分发浏览器 WASM 转码（gzip 约 10.3MB）；`NEXT_PUBLIC_MEDIA_WASM_ENABLED=false` 可在构建时显式关闭。
- MOV 与 HEVC MP4 自动转成 8-bit H264/AAC MP4；不能再仅凭 `.mp4` 扩展名透传 HEVC。检查 bounded ISO-BMFF moov/stsd/avcC，不读取整段 mdat 来探测；普通 8-bit H264 MP4 保持原字节透传。
- 修复原转换输出 H264 High 10/yuv420p10le 的兼容性问题；输出 yuv420p、AAC、faststart。处理 HLG/PQ→BT709 SDR，默认长边不超过 1280、30fps；这是日常播放副本，不承诺保留 HDR/Dolby Vision 编辑信息、原分辨率或电影模式深度轨道。
- 显式只选首个视频轨道及可选音轨，排除辅助 data/subtitle 与源 metadata；保留自动旋转，测试竖屏方向。
- FFprobe core 0.12.10 成功可能返回 -1，不能仅按非零失败；同时核对 JSON 输出和实际视频轨道。
- 稳定同源模块 Worker 路径；转换总 deadline 210s，exec 上限 120s。支持取消，失败/取消终止 engine 并重置，后续可重试，不永久复用 rejected promise。
- UI 显示准备/转换阶段与取消按钮，取消信号覆盖转码、缩略图与网络请求；转换前输入上限 200MiB，上传前转换结果上限 100MiB。
- Native FFmpeg **仅用于生成与校验测试样片**，Web/Worker 上传接口没有 native FFmpeg/Sharp/child_process。

## 实测结果

| 套件 | 结果 | 私有证据 |
|---|---|---|
| Web 单测 | 当前工作区 27/27（含并行任务用例），新增容器/High10/HDR/取消覆盖 | `.migration/iphone/final-unit.log` |
| TypeScript / ESLint / Worker 构建 | 均通过；ESLint 0 errors、66 warnings | `.migration/iphone/final-types.log`、`final-lint.log`、`final-build.log` |
| 本机桌面 Chrome + 真实 WASM | 5/5：H264 MOV、90° 旋转 MOV、HEVC Main10 HLG MOV、HEVC MP4、取消后重试 | `.migration/iphone/offline-synthetic.log`、时间戳 `offline-*.json` |
| 本机 Chrome iPhone 视口 + 真实 WASM | 同上 5/5；不是 Safari/真机 | `.migration/iphone/offline-layout.log` |
| 隔离副本 5 条存量原片，本机 Chrome + WASM | 5/5；解码、播放、AAC、8-bit H264 通过 | `.migration/iphone/offline-originals.log` |
| 隔离云浏览器视频专项 | 部分通过，但整轮中断，不计为完整通过 | `.migration/iphone/e2e-video.log` 与私有 trace |

存量原片仅从现有隔离 R2 legacy 副本读取，按迁移 manifest 逐对象校验字节/SHA-256 后保存在私有目录。未访问或修改生产 R2；未向第三方发送原片。

5 条存量原片输出分别为 1280×942、720×1280、960×1280、960×1280、720×1280。包含 HEVC MP4、旋转 MOV、4K 原片。证明这些文件在本机真实浏览器中的转换及输出解码，不证明它们均由本次 iPhone 真机直接拍摄/上传。

本地测试以 127.0.0.1 临时 HTTP 服务提供现有 SDK、WASM 与转译后的实际 `src/lib/media-client.ts`，浏览器运行真实转换，再由视频元素播放和 native decoder 交叉检查输出；不 mock 转换结果。不调用 Cloudflare、D1、R2、grants、生产密码或域名。输出/元数据证据仅保留在 `.migration/`（0700/0600）。

## 失败和纠正

1. 原代码对 HEVC Main10 转码输出 H264 High10：已真实复现并修复为 8-bit。
2. FFprobe 输出有效 JSON 但返回 -1：修复返回值判断；验证 metadata 后才执行转换。
3. 旋转专项最初失败：合成 fixture 用 `-metadata rotate=90` 在当前 native FFmpeg 中没有生成 display matrix，不能据此认定应用旋转损坏；改成 `-display_rotation 90` 后真实 WASM 输出 180×320，存量旋转原片也保持竖屏。
4. 云端专项与并行微信验收共享资源：HEAD 和 Worker 版本被另一任务推进，Web 被冻结，视频保存返回 503；另一例保存等待超时，整轮命令也超时，均不算通过。部分云端成功包括 H264 MOV、HLG Main10、HEVC MP4 与取消重试。
5. 按用户选择停止云端部署/解冻/seed/权限修改，改成本地离线测试。没有擅自恢复另一任务的环境状态。
6. 下载存量样片有整对象读取长度不足的传输现象；使用有长度校验的分段 Range GET，最终逐个 SHA-256 与 manifest 一致。未定位传输层根因，不当作已修复媒体读取 bug。

## 可重复执行

本机安装 FFmpeg 仅供测试，或将 `MYBABY_FIXTURE_FFMPEG` 指向测试 encoder；Playwright 默认使用系统 Chrome，设置 `MYBABY_E2E_CHROMIUM_BUNDLED=true` 可使用已安装的 bundled Chromium。

```sh
npm run test:e2e:video-fixtures
npm run test:video:offline
npm run test:video:offline -- --iphone-layout
# 仅在私有目录已有验证过的存量样片时：
npm run test:video:offline -- --originals
```

云端环境独占后才能重跑：

```sh
# 部署、解冻、seed 均需与并行任务协调；现在不要直接运行。
npm run test:e2e -- tests/e2e/iphone-video.spec.ts
npm run test:e2e
```

GitHub 隔离 E2E job 已加入 native 测试样片生成步骤，无生产部署任务。

## 剩余功能验收

1. 隔离环境可用后，完整视频专项及全站 E2E 跑完，确认 R2 原片转换→上传→私有播放/缩略图/编辑/删除；不要把冻结环境的失败忽略为通过。
2. 至少一次实际 iPhone Safari 直接选择原片并播放；现有机器不支持 Playwright WebKit，Chrome iPhone 视口不能代替。需验证目标设备对 gzip 解压、WASM 内存、较长/较大原片的实际表现。

运营/生产发布事项单独跟踪，不再扩充本轮功能验收范围。
