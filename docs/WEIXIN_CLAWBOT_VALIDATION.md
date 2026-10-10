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

## 6. 尚未通过的验收门槛

- [x] 微信扫码确认与绑定（2026-10-11 北京时间，generation 1）。
- [x] 云端 Alarm 轮询与游标保存（状态 running，最近轮询无错误）。
- [ ] 真实文字回复与 Queue 消费：用户发送“桥接测试 001”后尚未收到回复，events 为空。
- [ ] 活跃会话下重新部署恢复。
- [ ] 长轮询暂停/启动与凭证轮换实测。
- [ ] 至少 24 小时阶段 A 观测；阶段 C 再做 72 小时稳定性测试。
- [ ] 实际配额与费用监控、DLQ 人工重放、未完成事件的清理策略。

下一步先核对入站消息计数与过滤原因，再用新的编号文本验证接收、入队、发送。无需因未收到回复立即重复扫码。未来如部署完整当前工作树，须先按 README 准备 B 的额外 Secret；当前线上仍只运行独立构建的阶段 A 文字桥接。**不能把扫码或轮询成功写成文字收发验收通过。**

## 7. 扫码接入进展（2026-10-11，北京时间）

- 初次二维码失效后重新生成；用户扫码并确认，客户端轮询确认 `confirmed`。
- 凭证、二维码与绑定文件仅保存在被忽略的 `weixin/.local/`；文件权限 0600、目录 0700，不提交到 Git。
- 使用 cf 更新 Bot Secret；绑定成功返回 `generation: 1`、`state: paused`。初始启动遇到 HTTP 409；独立重建并部署阶段 A 后可启动。
- 初期轮询出现 `network` 错误，后续真实状态为 `running`、`failures: 0`、`lastError: null`，游标已保存。**未确定网络错误的根因，不将候选兼容性修改描述为已证实的根因修复。**
- 本轮最后部署版本：`2e9a838d-878a-4b62-8e51-6b93937eee91`。从 `1b15917` 提取阶段 A 到临时目录，仅加入本轮协议/观测修改进行构建；没有上传阶段 B Agent、Web 登录或业务 API。AI 和宝宝数据写入仍未开启。
- 临时连接诊断端点已从最后上传源码移除。持续轮询状态已观察到，但管理状态尚未返回新增 `reception` 字段；新观测字段的线上生效情况仍需确认。
- 用户发送“桥接测试 001”后反馈没有回复；状态中 `events` 为空。尚不能确认该消息是否进入服务器返回、被过滤或在其它环节丢失，Queue/发送端到端验收未通过。

本轮代码增加：入站 NEW (0) /省略状态兼容（仍拒绝流式状态、陌生人、群消息、不匹配收件人和不安全 ID）；固定词汇的接收/拒绝计数；取消信号的可移植组合与监听器清理；不跟随重定向并明确处理 HTTP 状态；不回显原始错误或凭证的传输错误分类。

本轮本地 `npm run check` 通过：TypeScript、34 个 Worker 单元测试、cf 部署 dry-run；额外断言拒绝计数不包含发送者信息且可在对象重建后保留。仍未运行真实 workerd 集成测试。

这些改动属于待实测候选修正，**不代表已观察到测试消息的实际字段，也不代表微信文字桥接已通过验收**。用户在此进度要求 commit & push，后续继续排查并进行编号文本、暂停/恢复、活跃会话重部署与 24 小时观测。
