# 微信 ClawBot：阶段 A 实施与核验记录

核验日期：2026-10-10。本文区分官方文档核验、本地模拟测试、真实云端验证；没有扫码/长轮询测试证据时不认定接入已完成。

## 1. 协议来源

官方仓库：[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)。

本次读取 commit：`c6643f6f0ac03574eb126f2d69569ea4267cc3c6`，包版本 `2.4.10`，仓库声明 MIT。MyBaby 独立实现最小客户端，不安装或嵌入 OpenClaw。

核对文件：
- [协议说明](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/docs/protocol_zh_CN.md)
- [请求实现](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/src/api/api.ts)
- [扫码实现](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/src/auth/login-qr.ts)
- [包元数据](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/package.json)

确认的客户端行为：
- 默认服务 `https://ilinkai.weixin.qq.com`。
- 获取二维码使用 POST `/ilink/bot/get_bot_qrcode?bot_type=3`，body 为 `local_token_list`，没有 Bot Bearer token 或 base_info。
- 二维码状态使用 GET `/ilink/bot/get_qrcode_status`；支持验证码与服务器返回的域名重定向。
- 收消息 POST `/ilink/bot/getupdates`，游标字段 `get_updates_buf`，响应消息列表 `msgs`。
- 发消息 POST `/ilink/bot/sendmessage`，使用 `msg`、`client_id`、`context_token` 和 `item_list.text_item.text`。
- 请求头包含应用标识、编码后的客户端版本；Bot POST 使用 AuthorizationType、随机 X-WECHAT-UIN、Bearer token 与 base_info。
- -14 表示会话失效；本实现停止轮询，等待人工重新扫码，而不是采用官方插件的一小时自动恢复策略。

**仍待验证**：独立客户端服务准入、条款/账号风险、合法应用版本策略、真实登录返回的域名范围、消息 ID 精度、context_token 时效、通知启动/停止接口是否为独立客户端必需、发送 client_id 的服务端去重语义。官方协议自身也声明其来源是客户端行为，不是完整服务端契约。

## 2. Cloudflare 文档核验

| 官方来源 | 核验结论 |
| --- | --- |
| [DO class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)（页面更新 2026-09-28） | `exports` 为正式声明式方案，替代 legacy migrations；新命名空间用 SQLite。原方案的 exports 形态有效 |
| [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) | 每对象一个 Alarm，至少一次执行；抛出异常最多自动重试 6 次，故实现自己安排下次唤醒 |
| [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) | Alarm handler 墙钟上限为 15 分钟，文档层面可覆盖 35 秒轮询 |
| [生命周期](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)（页面更新 2026-09-30） | 未完成的 outbound fetch/I/O 阻止对象正常驱逐；不等于永远不重启或无超时 |
| [DO 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/) | 当前列出 Free 13,000 GB-s/天、Paid 400,000 GB-s/月；请求与存储另有配额 |
| [Queues 定价](https://developers.cloudflare.com/queues/platform/pricing/) | 当前列出 Free 10,000 标准操作/天、Paid 包含 1,000,000 操作/月 |
| [Queues 配置](https://developers.cloudflare.com/queues/configuration/configure-queues/) | 支持 Producer/Consumer、DLQ、批大小、超时与并发参数 |

未单独核验原方案指定的“2026-10-01”changelog；只确认目前生命周期文档中的行为。成本数字不是实测账单，持续活跃的 DO 仍需观测实际账户用量。

用户要求使用 **cf，不用 Wrangler**，实现采用 `cf@1.0.0-beta.14`、`cloudflare.config.ts` 和 Cloudflare Vite 插件；自动构建产生 Build Output Specification。已通过 cf dry-run 并完成真实部署。

## 3. OpenRouter 模型

2026-10-10 从 `https://openrouter.ai/api/v1/models` 核对：

- 模型 ID：`meta/muse-spark-1.3-contributor`。
- `supported_parameters` 列出 `tools`、`tool_choice`、`structured_outputs` 等。
- 用户指定此模型，配置已保存为 Worker 的 `OPENROUTER_MODEL`。

没有使用 API key 发起推理；阶段 A 不调用模型。模型目录包含工具参数不代表阶段 B 的业务工具正确性已经验证。

## 4. 已实现与本地检查

实现文件见 `weixin/README.md`。业务 API、Prisma schema 和数据库均未修改；根 `tsconfig.json` 排除独立 Worker，避免 Next.js 扫描 Cloudflare 类型及工具链文件。

检查命令：

```bash
cd weixin
npm run typecheck
npm test
cf deploy --dry-run
```

阶段 A 提交时的本地结果：`npm run typecheck` 通过，`npm test` 的 21 个用例全部通过，`cf deploy --dry-run` 通过。B 的新增检查与部署边界见 [阶段 B 文档](./AGENT_V1.md)。

测试覆盖：
- 可信 URL、权限、正文大小限制与消息规范化。
- 精确协议请求字段、错误分类、扫码请求方式与空游标处理。
- 消息/游标事务、插入失败回滚、Queue 入队失败后的 outbox 补投。
- 持久化状态重建、重复消息/消费、发送租约与未知发送结果。
- 暂停后旧轮询响应不写入、不重新安排 Alarm。
- 重绑定必须显式处理未完成事件；UNBOUND 占位不能启动。
- Worker 公共健康路由、管理接口保护与无效 Queue 引用重试。

测试使用 Node.js 内置真实 SQLite + 同步 DO 存储适配器。当前 macOS 13.1 低于 workerd 13.5 最低要求，因此**未运行 workerd 集成测试**。构建禁用自动运行时类型生成，其余配置由 cf/Vite 校验。

## 5. 真实云端证据

首次部署版本：`ebcea8ac-150f-44ae-b289-1df875c32eaf`。

增加重绑定保护和恢复测试后的基础核验版本：`9aad6800-cf78-41ea-9d15-20b67db54b4a`；再次授权状态查询通过。

- Worker：`mybaby-weixin`。
- 地址：`https://mybaby-weixin.zhajiahe1994.workers.dev`。
- DO：`mybaby-weixin_WeixinSession`，Cloudflare 返回 `use_sqlite: true`。
- Queue：`mybaby-inbox`，Producer/Consumer 都是当前 Worker；批大小 1、等待 1 秒、并发 1、重试 5 次。
- DLQ：`mybaby-inbox-dlq`，当前无消费者。
- 当前账号 Queue 与 DLQ 保留期均为 **86,400 秒（24 小时）**，以实际资源返回为准。
- 基础核验时管理 token 已上传，Bot Secret 使用 `UNBOUND` 占位；后续扫码更新见第 7 节。
- `GET /health`：200，`{"ok":true,"stage":"A"}`。
- 无授权 `GET /admin/session/status`：401。
- 有授权状态查询：200；DO 已真实创建表，状态 `unbound`、events 空、无 Alarm。

## 6. 验收状态

- [x] 微信扫码确认与绑定（2026-10-11 北京时间，generation 1）。
- [x] 云端 Alarm 轮询与游标保存（状态 running，最近轮询无错误）。
- [x] 真实文字回复与 Queue 消费：用户确认 003 及部署恢复后的新消息收到回复，4 条任务为 done。
- [x] 人工暂停/等待实例切换/启动后，版本、绑定、游标与完成记录保留，真实收发恢复。
- [ ] 不停轮询的自动热升级：部署后仍观察到旧 DO 版本，不能宣称已通过。
- [ ] 10 条编号文本完整验收、真实凭证轮换/失效重登录。
- [ ] 至少 24 小时阶段 A 观测；阶段 C 再做 72 小时稳定性测试。
- [ ] 实际配额与费用监控、DLQ 人工重放、未完成事件的清理策略。

下一步保留当前桥接运行，补齐编号文本与 24 小时观测，核对 Queue/DLQ、费用和告警。阶段 B 的真实 PostgreSQL 事务、业务授权与生产部署仍需单独验收；当前线上只运行独立构建的 A 文字桥接。**基础文字收发已通过，但阶段 A 的完整稳定性验收尚未完成，不据此开启 AI 或业务写入。**

## 7. 首次扫码阶段记录（2026-10-11，北京时间，后续结果见第 8 节）

- 初次二维码失效后重新生成；用户扫码并确认，客户端轮询确认 `confirmed`。
- 凭证、二维码与绑定文件仅保存在被忽略的 `weixin/.local/`；文件权限 0600、目录 0700，不提交到 Git。
- 使用 cf 更新 Bot Secret；绑定成功返回 `generation: 1`、`state: paused`。初始启动遇到 HTTP 409；独立重建并部署阶段 A 后可启动。
- 初期轮询出现 `network` 错误，后续真实状态为 `running`、`failures: 0`、`lastError: null`，游标已保存。**未确定网络错误的根因，不将候选兼容性修改描述为已证实的根因修复。**
- 本轮最后部署版本：`2e9a838d-878a-4b62-8e51-6b93937eee91`。从 `1b15917` 提取阶段 A 到临时目录，仅加入本轮协议/观测修改进行构建；没有上传阶段 B Agent、Web 登录或业务 API。AI 和宝宝数据写入仍未开启。
- 临时连接诊断端点已从最后上传源码移除。持续轮询状态已观察到，但管理状态尚未返回新增 `reception` 字段；新观测字段的线上生效情况仍需确认。
- 用户发送“桥接测试 001”后反馈没有回复；状态中 `events` 为空。尚不能确认该消息是否进入服务器返回、被过滤或在其它环节丢失，Queue/发送端到端验收未通过。

本轮代码增加：入站 NEW (0) /省略状态兼容（仍拒绝流式状态、陌生人、群消息、不匹配收件人和不安全 ID）；固定词汇的接收/拒绝计数；取消信号的可移植组合与监听器清理；不跟随重定向并明确处理 HTTP 状态；不回显原始错误或凭证的传输错误分类。

本轮本地 `npm run check` 通过：TypeScript、34 个 Worker 单元测试、cf 部署 dry-run；额外断言拒绝计数不包含发送者信息且可在对象重建后保留。仍未运行真实 workerd 集成测试。

在首次扫码阶段提交 `edaadd8` 时，这些改动仍属待实测候选修正，不代表当时已通过文字收发验收。后续继续排查的结果如下。

## 8. 文字收发与人工切换恢复（2026-10-11）

### 入站消息 ID

- 观测字段已生效。用户发送 002 后，`reception.received: 1`，拒绝原因 `invalid_message_id: 1`；证明消息进入本 Bot，但未入队。
- 原 `response.json()` 可能把 uint64 ID 解析为已舍入的 Number；从原文使用 `json-bigint@1.0.0` 无损解析，将大整数保存为字符串。仍拒绝不安全的已舍入 Number，不将 Number 再转成字符串冒充恢复。
- 新测试用原始 JSON 的相邻 uint64 ID 验证规范化和事件哈希互不相同；重复键、prototype/constructor 键拒绝且不回显响应内容。
- 授权入站消息若仍无法安全规范化 ID，则退避且不推进游标，避免静默确认/丢失。此前已推进的游标不盲目回退。
- 版本 `08944064-2c10-40f6-a6d2-4ec258c33190`、adapter `0.1.2` 生效后，用户确认 003 收到回复，状态中出现 2 条 done。没有输出真实消息 ID/原文，因此不声称已经人工读取到此前失败消息的具体数值。

### 部署与人工恢复

- 活跃轮询时部署恢复测试版本 `e3b22f20-da41-45f1-ba69-0ed96f170089` 后，DO 仍报告旧 `0.1.2`。控制面版本与运行实例版本不能混为一谈；自动无暂停热升级尚未通过。
- 新增显式可清理的请求截止计时器，成功/失败均清理；避免完成请求遗留不可取消的原生 timeout signal 计时器。此为资源生命周期改进，**未证实它是旧实例持续运行的根因**。
- 最终阶段 A 部署：`f91bd40f-3b48-4423-b12c-28495f09a5e3`，adapter `0.1.3`。仍从 A 基线独立构建，仅加入协议、接收观测与持久化指标，没有上线 B Agent/API 或宝宝写入。
- 人工暂停并等待旧请求退出后，状态确认 `0.1.3 / paused`、generation 1、游标保留、done 2、无 Alarm；随后启动为 running。
- 部署/等待的本地命令曾超时；没有因此重复扫码、重复绑定或盲目重发。读取实际云端状态确认部署完成并恢复。
- 用户再次确认部署恢复后的新消息收到回复；最新状态 **done 4、received 5、accepted 4、历史 invalid_message_id 拒绝 1**，无 pending/failed/unknown 记录。未将 4 条 done 等同于已完成全部 10 条编号验收。
- 最终重新核对 `/health` 200 (`stage: A`) 与无授权管理请求 401。

### 持久化观测与检查

- 窗口起点：`2026-10-11T00:10:38.617Z`（北京时间 08:10:38）；最近采样成功点：`2026-10-11T01:15:07.656Z`。
- 已成功提交轮询 **196 次**、失败周期 **0 次**，最大成功间隔 **109,733 ms**，最近错误为空，游标保存、Alarm 存在。这约 65 分钟，不是 24 小时验收；间隔数值保留真实值，不宣称恒定 35 秒或实时连续无间隙。
- `observation` 在 DO 中持久化成功/失败计数、最近成功/失败时间和最大间隔；对象重建不清零，后续成功不掩盖历史失败。失败周期可包括 Queue 错误，已提交轮询后仍可能记失败，两个计数不是互斥分类。
- 无需本机常驻进程。最早在北京时间 2026-10-12 08:10:38 之后复核 24 小时，结合编号文字、间隔、Queue/DLQ 与费用；告警与自动重放仍未完成。
- 本轮 `npm run check` 通过：TypeScript、**39 个单元测试**、cf dry-run；新增 uint64 精度/唯一性、异常 ID 不推进游标、原型/重复键防护、截止计时器清理、失败观测跨重启保留测试。
- 仍受 macOS 13.1 限制，未运行本机真实 workerd 集成测试；已有真实云端微信收发证据，二者不能互相替代。
