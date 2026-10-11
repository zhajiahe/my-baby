# Cloudflare 迁移：实现、隔离验收与切换手册

## 范围与边界

基线：`feat/weixin-agent-v1` / `51c1aca`；工作分支：`feat/cloudflare-migration`。不是从零重写。沿用现有 UI、Hooks、家庭登录、Agent v1 合约，以及独立 `weixin/` 实现。

**当前仅部署隔离测试 Web Worker，不是生产切换，也不是全功能验收完成。** 未修改生产 Neon 数据/结构、正式域名、Vercel 生产部署、现有微信 Worker/DO/Alarm/Queue。生产数据仅在只读一致性事务中导出，R2 源对象仅 GET。复制完成后，测试 Worker 的 SOURCE_MEDIA 绑定已移除；Agent grants 已恢复空数组，写入关闭。

测试地址：`https://mybaby-web-migration-test.zhajiahe1994.workers.dev`。独立家庭密码/服务令牌在本机忽略的 `.migration/secrets.json`，不得粘贴到工单、聊天、日志或 Git。

## 架构与选型

- vinext 1.1.0：保留 Next.js 16 App Router、RSC、route handlers、Proxy 和 UI；实际 Worker 构建、部署、鉴权与 API 验证通过。React/RSC 调整至匹配的 19.2.6。vinext 仍是有兼容性风险的替代实现，不将构建成功等同于所有浏览器功能通过。
- Cloudflare Vite plugin + `cf` CLI。默认配置的 Worker 名称固定为测试名称；无生产路由/域名、微信绑定或 Queue 消费者。
- D1：`cloudflare/migrations/0001_initial.sql`；`src/lib/d1-repository.ts` 提供现有 API 所需的窄 CRUD 接口，不使用 Prisma Workers runtime，也不回退到 DATABASE_URL。
- 旧 Prisma schema/client 保留用于 **Node 迁移导出和隔离 PostgreSQL 回归**，不属于 Worker 数据层。
- 日期：UTC ISO 文本；已有 ID 不变，新记录使用 UUID。标签为 JSON TEXT，返回时解码为数组。SQL 标识符来自固定模型列，值使用参数绑定。关系与级联删除由外键约束保证。
- Agent：`d1-store.ts` 使用 `DB.withSession('first-primary')` 和 D1 原子 `batch`。先插入唯一回执，再写业务记录；任何语句失败整批回滚。禁止模拟交互式 Prisma 事务。并发失败后读取已提交回执，重新核对 payload hash；认证、精确 grants、写开关仍先于回放检查。
- 相册：浏览器图片预处理、签名 R2 直传、浏览器视频缩略图；服务器无 Sharp、FFmpeg、child_process 或临时文件处理。兼容 multipart 接口只流式上传，不做转码。
- 私有媒体：测试 R2 无公共访问入口；`/api/media/[...key]` 受家庭 Cookie 保护、`private, no-store`、支持 Range，图片不经过匿名 optimizer。现有生产 R2 公共链接仍然存在，未擅自关闭或清缓存。
- 静态资源 COOP/COEP/CORP 配置在 `public/_headers`；页面 Proxy 也设置隔离头。

## 视频转换的当前功能范围

按用户最新要求，以日常功能验收为主，iPhone 原片必须支持。最新实现与实际证据见 [IPHONE_VIDEO_FUNCTIONAL_REPORT.md](IPHONE_VIDEO_FUNCTIONAL_REPORT.md)，历史的“WASM 默认关闭/MOV 必须手动导出”结论不再代表当前代码。

现在默认分发约 10.3MB gzip 的浏览器 WASM，MOV/HEVC MP4 自动生成 8-bit H264/AAC、faststart 的播放副本；普通 H264 MP4/WebM 保留透传。保留旋转，HLG/PQ 转 BT709 SDR；播放副本长边最大 1280、30fps，不承诺保留 HDR/电影模式编辑轨道。构建时显式设置 `NEXT_PUBLIC_MEDIA_WASM_ENABLED=false` 可关闭转换。

转换输入上限 200MiB、上传结果上限 100MiB，exec 120s、整体 deadline 210s，支持取消和失败后重试。WASM 不在 Worker 加载；native FFmpeg 仅用于测试样片生成/解码，不属于 Web/Worker runtime。旧危险 db:push/db:seed/db:reset/db:studio 脚本仍移除。

本机真实 Chrome/WASM 对 4 类合成视频与 5 条隔离存量原片转换/播放通过，Chrome iPhone 视口同样通过；**云端完整专项因并行任务冻结环境而中断，真机 Safari 未完成**，不宣称完整 iPhone 验收通过。运营项单独跟踪，不扩大本轮功能门禁。

## 已记录的验收证据

- vinext Cloudflare Worker 实际构建、隔离部署成功；无本机 workerd 验收（macOS 13.1 低于运行要求）。
- `npm run test:unit`：13/13，含 SQLite 真实约束、八次并发唯一回执、后续业务失败回滚回执、缓存授权、JSON 标签、原子媒体批次、外键级联。
- `npm run test:postgres`：10/10，仅临时专用 PostgreSQL；未连接 Neon 进行写测试，完成后清理。
- TypeScript 通过。
- `npm run test:cloudflare`：真实云端登录/注销、匿名 401/重定向、CSRF 403、private/no-store、源 ID、50 条分页、成长/里程碑 CRUD、标签更新、R2 签名直传、字节比对、Range 206、媒体匿名 401、相册批次/编辑/删除、Cookie 不可授权 Agent、无 grants 拒绝。
- `npm run test:cloudflare:agent`：测试环境临时仅对虚构微信身份授权；八个并发请求 1 次提交 / 7 次回放，payload 和跨工具冲突 409，独立 key 的里程碑成功、读范围与身份限制通过。测试记录/回执清理，grants 与写开关恢复关闭。
- 早期浏览器证据仅证明登录/导航/表单和相册界面；后续全 UI 回归见 RC 报告，最新视频功能证据见 iPhone 视频报告。历史的转换停滞和默认关闭不是当前实现状态；仍不声称真机 Safari 通过。
- 测试 R2 的托管 r2.dev 公共访问状态实测为 disabled。
- 公开客户端资产扫描：独立测试 secrets 不在 JS/JSON/CSS 中。不是完整渗透测试。

## 生产数据安全副本

只读 RepeatableRead 事务导出：宝宝 1、成长 59、里程碑 96、媒体 234、AgentOperation 0（源尚无该表时兼容空结果）。D1 校验 **完整标量字段、ID 集合 hash、JSON 标签/回执、UTC 日期与外键关系**，媒体 URL 仅改写为私有读取路径。

239 个去重 R2 引用复制到测试 bucket 的 `legacy/`；总计 **825,988,373 bytes**。每对象源/目标 SHA-256 与字节数比对。源对象仅 GET，目标对象写入测试 bucket。复制有过 HTTP 503，有限重试和断点续传后完成；根因未建立。不能据此宣称 Cloudflare/iLink 长期稳定性验收已完成。

临时 R2 凭据仅用于测试 bucket 的 `uploads/`，有效期七天。正式系统必须使用可轮换、权限最小化的长期凭据，不能以测试临时凭据切生产。

## 可重复执行的命令

先进行匿名发现再查看所选命令 help，例如：

```sh
cf cli search "create D1 database"
cf cli search "create R2 bucket"
cf cli search "create scoped R2 S3 credentials"
cf cli search "set R2 bucket CORS policy"
cf cli search "deploy Worker project build"
```

私有目录 `.migration/` 为 0700，JSON/快照/报告为 0600。`target.json` 必须包含测试 databaseId、固定测试 workerName/bucketName、sourceBucket、sourcePublicDomain、accountId；部署脚本填入 origin。准备 secrets.json 的独立家庭 password/session secret、Agent token、migration token、upload secret 和测试 R2 accessKeyId/secretAccessKey/sessionToken。**不要复用生产家庭密码，不要将 R2 凭据输出到终端。** 当前资源已创建，重跑不要盲目再创建。

```sh
npm run migration -- export                 # Neon 只读事务，私有时间戳快照
npm run migration -- schema                 # 云端数据库名称 + guard 校验
npm run migration -- import                 # 按 ID upsert，可重跑
npm run deploy:cloudflare:test              # 仅测试 Worker，暂时附源 R2 GET 绑定
npm run migration -- media                  # 有限重试，已验证对象断点继续
npm run migration -- validate --require-media
npm run deploy:cloudflare:test -- --without-source-media
npm run test:cloudflare
```

- 导出可显式使用 `MYBABY_MIGRATION_SOURCE_URL`，否则读取本机 `.env` 中原 DATABASE_URL；仅执行只读事务，绝不 db:push/migrate/reset 源库。
- importer 上述命令只允许固定测试资源及匹配的云端数据库名称/guard；不接受任意生产 UUID。新正式目标必须另行明确批准与审查 guard/config，不能改一个 JSON 就绕过。
- 导入数据改变时建议重新导出快照，保存旧快照，重新审核媒体 manifest；已验证引用的源对象应保持不可变，否则应移除对应进度并重新比对。
- `import --reset-test-data` 删除并恢复 **guarded 测试 D1** 全部业务表，仅用于清理隔离测试；不可用于生产。
- 本机管理文件不写入 Git；cf 输出与参数文件可能含私有资料，始终私有捕获。
- `--agent-test` 临时开启测试 API 的精确虚构身份 grants；执行 Agent smoke 后必须部署无该 flag 的版本并重新 validate。与运行微信桥接没有 token/origin/grants 联系，也不调用模型。

## 正式冻结 / 备份 / 切换 / 回滚（必须先明确批准）

1. 完成媒体与全 UI/浏览器矩阵、签名直传大小/失败/孤儿对象回收、性能/费用/日志隐私审查；配置长期 R2 凭据与生产 secret rotation。家庭 auth 的 WAF/分布式限流已按极简模式明确接受为不做（内存限流 + 6 位密码，残留风险见 `SECURITY_CREDENTIALS_PLAN.md`）。解决 vinext 兼容性风险及未验收转换路径。
2. 创建明确批准的新正式 Worker/D1/私有 R2；单独配置正式域名，但此时不修改 DNS 流量。审查 Actor grants、API token、writesEnabled；先保持 Agent 写关闭。
3. 维护窗口冻结旧 Web 业务写入及未来 Agent 写入，保留旧站只读；微信 Stage A 桥接继续运行，不重绑、不清 cursor/outbox/DO 存储。
4. 做 Neon 可恢复备份（完整 schema/data/角色/扩展 + PITR 记录），旧 R2 清单与保留策略、Vercel commit/config/env 备份；真实演练恢复。最终只读一致性快照必须在冻结后导出。
5. 对批准的正式 D1 应用经审查 schema/guard；导入冻结快照及媒体，校验数量、关系、完整字段、ID hash、R2 引用/字节/hash。测试副本不是最终冻结备份。
6. 用正式 CF origin 验证登录、数据、分页、图片/视频/Range/上传、幂等/并发和实际家庭设备。审查真实计费与安全监控。所有环节通过后才修改正式 DNS/路由；不同时开启两端写入。
7. 切换后分阶段开放 Web 写入，再明确批准 Agent 业务写入。保留旧 Vercel/Neon/R2 与备份，不立刻销毁，不盲目同步两个系统。
8. **回滚写入前**：新站尚无新增写入时，恢复旧域名路由和旧写开关即可。已有新写入时先冻结新站，导出 D1/R2 增量并核对 ID/回执，明确批准反向导入 Neon，再恢复旧站；不能直接 DNS 回切丢掉新记录。备份恢复不能删除幂等回执导致微信消息重复写入。

## 发布候选推进（本轮新增）

最新实测/失败/门禁见 [CLOUDFLARE_RC_REPORT.md](CLOUDFLARE_RC_REPORT.md)，优先于本文件早期验收摘要。媒体校验、带宽限/冻结/hash 确认的隔离清理、26 项浏览器回归、受审批隔离 CI、权限撤回核对与回滚演练均有本轮证据；仍是 No-Go。

迁移工具现在支持**另行审批**的 `--production`，使用 `.migration-production/`，固定新正式名称、独立 D1、冻结后快照、实际 standby bindings 与 guard 检查；禁止 reset 和测试媒体复制接口。没有在正式资源执行。此前“importer 只支持测试”的边界已被这个严格独立入口补充，不允许通过更改 `.migration/target.json` 指向生产。命令与未验收项见生产操作文档。

## 仍然阻塞生产验收

完整媒体格式/跨浏览器矩阵与可选 WASM；全 UI 交互及无暂停升级/恢复；长期凭据；迁移最终冻结窗口、恢复演练、正式资源/域名切换批准。既有微信 24/72h 观察不因本轮开发自动通过。默认测试分支推送可能触发 Vercel Preview，其 vinext 输出并非 Vercel Next.js 产物；生产 main 未修改，应保持旧部署回滚基线。
