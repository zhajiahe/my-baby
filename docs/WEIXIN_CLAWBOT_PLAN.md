# MyBaby 微信 ClawBot：Cloudflare 轻量化实施计划

> 状态：阶段 A 已通过扫码、真实文字收发/Queue 消费与人工暂停切换部署后的恢复验证；约 1 小时持久化观测无失败，24/72 小时、10 条编号文本及自动热升级仍待验收。阶段 B 已完成本地实现与测试，未上线 Agent、未部署 Vercel 或变更生产数据库。证据见 [实施记录](./WEIXIN_CLAWBOT_VALIDATION.md)，B 的范围见 [家庭登录与 Agent API](./AGENT_V1.md)。
> 目标：无 VPS、无 OpenClaw，以独立 Cloudflare Worker 接入个人微信，先验证文字收发，再接 MyBaby AI 操作。
> 本文是总体计划。初稿的外部能力保留意见已有部分经官方文档核验，具体以实施记录为准；官方文档不替代真实微信兼容性和长期运行测试。

## 1. 范围与决策

- 新增独立 `weixin/` TypeScript 项目，不迁移现有 Next.js 页面。
- 微信适配：腾讯 iLink HTTP JSON 协议的最小客户端；具体字段、端点、鉴权以官方协议核验结果为准。
- 状态与轮询：SQLite Durable Object（DO）+ Alarms；不依赖永久运行的 Node.js 进程。
- 消息任务：Cloudflare Queues；同一 Worker 同时生产和消费消息。
- AI：OpenRouter，用户指定模型 `meta/muse-spark-1.3-contributor`，原生 Tool Calling，不引入 MCP Server、LangChain 或完整 Agent 框架。
- 业务：受保护的 MyBaby Agent API，暂留 Vercel + Prisma + Neon；媒体保留 R2。
- 第一版仅文字即时问答与记录，不承诺主动提醒、图片、语音或全站迁移。
- 原计划 A 验收后再开发 B；用户已确认先完成 B 的本地实现和测试，但 AI 生产接入/业务写入仍必须等待微信、授权、数据库与部署验收。

公开客户端协议不等于官方长期支持第三方独立客户端。准入、服务条款、凭证有效期、账号风险和协议变化均是上线前置风险。

## 2. 当前仓库与改动边界

| 当前文件 / 能力 | 实施影响 |
| --- | --- |
| `package.json`：Next.js 16、React 19、Prisma 6 | 根 README 的旧版本描述不是实现依据；Worker 依赖与脚本独立管理 |
| `src/app/api/baby/route.ts` | 当前 GET 获取第一个宝宝；不能作为 Agent 的授权选择方式 |
| `src/app/api/growth-records/route.ts` | 已支持体重、身高、头围；需复用业务校验而非直接暴露给模型 |
| `src/app/api/milestones/route.ts` | 已支持日期、标题、描述、标签 |
| `src/app/api/photos/**` | 上传及媒体访问需纳入安全审计；多模态阶段再接入 |
| `prisma/schema.prisma` | 有 Baby、GrowthRecord、Milestone、MediaItem；暂无用户授权或消息幂等模型 |
| `src/lib/prisma.ts` | 保留现有数据库访问方式 |

已检查的 baby、growth-records、milestones 集合路由没有路由内鉴权，且 GET 使用公共缓存。不能只保护新增 Agent API 就宣称整个应用安全；需检查所有读写路由、部署侧访问控制、媒体链接与缓存策略。

阶段 A 新增独立 `weixin/` Worker，根 TypeScript 配置排除该项目。阶段 B 已新增家庭登录、Agent API 与幂等 Prisma 模型/追加 SQL，并移除原有公共缓存；这些 B 改动只在本地验证，尚未部署和执行数据库变更。

## 3. 目标架构

```text
个人微信 ClawBot
    ⇅ iLink：扫码凭证 / getUpdates / 发送回复
WeixinSession（Durable Object + Alarm）
    ├─ 会话配置、游标、消息去重、持久化 outbox
    └─ Cloudflare Queue → Worker 消费者
                            ├─ 阶段 A：确定性文字回复
                            └─ 阶段 B：Agent + Tool Calling
                                        ↓ 受保护的 HTTPS API
                              Vercel MyBaby /api/agent/v1
                                        ↓
                                 Prisma → Neon
```

业务工具不应依赖微信字段。渠道上下文仅用于认证、审计、幂等和回复；未来 Web AI 或其他渠道复用相同业务接口。

### 目录规划（A 与 B 的本地代码已新增，B 尚未部署）

```text
weixin/
├── package.json
├── tsconfig.json
├── cloudflare.config.ts    # 用户指定 cf CLI；不使用 Wrangler
├── .dev.vars.example       # 仅占位，不放真实凭证
├── src/
│   ├── index.ts            # 管理路由、Queue 消费者、DO 导出
│   ├── types.ts            # 环境与规范化事件类型
│   ├── weixin.ts           # iLink 请求、超时、协议错误分类
│   ├── session.ts          # DO、Alarm、游标、outbox、去重
│   ├── agent.ts            # B：受限模型工具规划
│   └── tools.ts            # B：MyBaby 业务接口适配
├── scripts/login.ts        # 一次性本地扫码与绑定
└── tests/                  # 协议 fixture、故障注入、幂等测试

src/app/api/agent/v1/route.ts # B：新增服务端认证与授权入口
```

## 4. 前置核验清单（A0）

必须保存官方来源 URL、协议版本或 commit、查阅日期与脱敏测试结论。原方案中的搜索图标和“+1 / +2”不是可追溯引用。

- [ ] 确认腾讯 `openclaw-weixin` 官方仓库地址、许可、第三方客户端准入及使用条款。
- [ ] 核对 `get_bot_qrcode`、`get_qrcode_status`、`getUpdates`、发送文本的实际端点、字段、请求头、错误码和限流。
- [ ] 确认 `bot_token`、Bot ID、用户 ID、API base URL、`message_id`、`context_token`、`get_updates_buf` 的语义与有效期。
- [ ] 确认游标推进、批量消息、重复投递、空响应以及重登录后的游标处理规则。
- [ ] 核对 DO Alarm 的执行时限、重试、事件并发、待完成 I/O 生命周期与长轮询超时兼容性。
- [ ] 核对 Free/Paid 对 SQLite DO、Queues、消费者并发参数、限额和超额行为的当前支持。
- [x] 验证所选 cf 版本的配置、SQLite exports 和 compatibility date（真实部署通过）。

Cloudflare 核验入口：
- [DO Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [DO 生命周期](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [DO 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [DO 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [DO migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Queues 文档](https://developers.cloudflare.com/queues/)
- [Queues 定价](https://developers.cloudflare.com/queues/platform/pricing/)
- [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)

已确认当前生命周期文档描述 pending outbound I/O 阻止正常驱逐；原方案的“2026-10-01”具体 changelog 尚未单独核验。这不是无重启或永久执行保证。

## 5. 配置与凭证设计

采用用户指定的 cf CLI 与 `cloudflare.config.ts`，包括 Worker 入口、`compatibilityDate`、`WEIXIN_SESSION` DO binding、SQLite exports、`INBOX` Queue producer 与 consumer、死信队列。实际配置见 `weixin/cloudflare.config.ts`。

旧工具链仍支持以下 legacy migrations 形态（仅供理解历史方案，本项目不使用）：

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "WEIXIN_SESSION", "class_name": "WeixinSession" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["WeixinSession"] }
  ]
}
```

2026-10-10 核验最新官方文档后确认原方案的 `exports.storage` 形态有效；本项目使用 cf SDK 的 `exports.durableObject({ storage: 'sqlite' })`，不混用 migrations。Worker 模块实际导出 DO 类；cf 已自动创建 Queue/DLQ。单条消费与低并发不能替代会话顺序控制，Queue 不保证 FIFO。

| 配置 | 存放位置 | 阶段 |
| --- | --- | --- |
| `WEIXIN_BOT_TOKEN` | Worker Secret | A |
| `WEIXIN_ADMIN_TOKEN` | Worker Secret；与微信 token 分离 | A |
| Bot ID、可信 API base URL、允许的微信用户 ID | 受保护 DO 配置 | A |
| `MYBABY_AGENT_TOKEN` | Worker Secret + Vercel 服务端环境变量 | B |
| `OPENROUTER_API_KEY` | Worker Secret | B |
| MyBaby API origin、模型、时区、用户到 babyId 授权映射 | 服务端配置；映射以 MyBaby 服务端为准 | B |

扫码脚本只在绑定或凭证失效时本地运行，不是常驻服务。凭证不得写入仓库、普通日志、Queue 消息、URL 查询参数或浏览器端环境变量。登录返回的 base URL 需 HTTPS 与可信域名白名单校验，避免凭证泄露或 SSRF。开发和生产使用不同 token 与测试数据。

部署与扫码命令（真实凭证不在命令行传递）：

```bash
cd weixin
npm run session -- init       # 只执行一次；当前机器已执行
cf deploy --secrets-file .local/secrets.json
npm run login                # 本机前台扫码；随后重新上传 Secret、bind、start
# 阶段 B 再配置：MYBABY_AGENT_TOKEN、OPENROUTER_API_KEY
```

详细顺序、已部署地址和重登录注意事项见 `weixin/README.md`。

## 6. 可靠消息处理设计

### 接收与游标

1. Alarm 发起有截止时间的单轮长轮询，不做无限循环；轮询超时以协议实测为准。
2. 校验用户、消息类型与字段；忽略自身消息和不支持的事件，避免回复循环。
3. 在 DO 本地事务内持久化规范化事件/outbox 与新游标；不能先推进游标再保留消息。
4. 将 outbox 发到 Queue，发送成功后标记已入队。DO 存储与 Queue 不存在跨服务原子事务，发送成功但标记前崩溃会重复入队，必须允许并去重。
5. 安排下一次 Alarm；暂时错误使用有上限的指数退避与 jitter，凭证失效则暂停并告警。确保已提交 outbox 在轮询失败时也能继续投递。

`context_token` 是敏感会话凭证，优先保存在 DO；Queue 只带事件 ID 与必要上下文引用。事件 ID、时间和用户信息由受信接收层生成，不能由 LLM 填写。

### 幂等与重试

- 接收层唯一键建议为 `botId + message_id`，保留期限覆盖协议重投和 Queue/DLQ 重放窗口；具体保留时间需依据当前产品限制制定。
- 业务层唯一键建议为 `source + botId + message_id + operationKey`。同一消息的多个同类操作必须有不同且稳定的 operationKey。
- 首次模型计划应持久化；重试复用计划及参数，不重新推理出另一组写入。日期“今天”按消息时间和配置时区解析，不按重试时刻解析。
- MyBaby 在同一个数据库事务内创建幂等记录和业务记录，并保存结果。相同 key 返回原结果；相同 key 携带不同参数返回冲突，不静默覆盖。
- 写入成功而回复失败时，只重试回复，不再执行工具。Queue ack 前保存处理阶段与结果引用。
- 发送回复若出现“已发送但响应丢失”，必须核验协议是否支持发送幂等；不支持时无法保证严格恰好一次回复，应记录未知状态并采用有限重试策略。
- 429、网络失败、暂时 5xx 可重试；字段错误、无权限、失效上下文需分类终止或人工处理。最大尝试次数和 DLQ 重放流程上线前固定。
- 同一会话如需顺序语义，使用序号与服务端状态协调；不能假设 Queue 按接收顺序处理。

### Alarm 与控制面

建议状态：`unbound → running → backoff / auth_expired / paused`。仅受保护的管理接口能绑定、启动、暂停、查看脱敏状态；公共健康检查不返回用户信息或凭证。

DO 可能在 await 期间交错处理事件。需使用持久化 generation/lease 或等效策略避免重复启动、并行轮询，以及暂停/重绑定后旧请求重新写入旧游标或安排 Alarm。暂停必须阻止新的任务，并明确处理已经在途的请求。

## 7. Agent API 与权限（阶段 B）

建议入口：`POST /api/agent/v1`，使用独立 Bearer token 做服务间认证，再按受信渠道身份校验用户与 babyId 授权。共享 token 本身不等于最终用户授权。

首批工具：
- `get_baby_summary`：仅返回所需基本信息。
- `list_growth_records`：限制时间范围与结果条数。
- `create_growth_record`：日期、体重 kg、身高 cm、头围 cm、备注。
- `create_milestone`：日期、标题、描述、标签。

禁止模型任意访问 URL、SQL、文件、其他 babyId；不开放删除、修改凭证或任意批量写入。工具 schema 和业务服务端均需校验数据、单位与合理范围。名称/日期/单位有歧义时先询问；多个操作需要稳定编号和明确的部分成功反馈，不夸大事务范围。

Agent 设置模型超时、最大工具轮数、输出长度、token 与费用上限。模型只接收必要信息，不发送 token、原始媒体链接或无关健康数据。提示词不能替代权限检查。

上线前必须同时完成：
- [ ] 所有现有 API 的认证与宝宝访问授权审计，不能绕过 Agent 直接读写。
- [ ] Web 登录/会话方案与现有页面联调，不把服务端 token 下发浏览器。
- [ ] 敏感 API 改为私有或禁用缓存，清理旧公共缓存。
- [ ] 审计 R2 公共域名；API 鉴权不能保护已公开的媒体 URL，必要时改私有存储与短期签名访问。
- [ ] 数据库幂等模型、唯一约束、事务测试与可审查的迁移；生产变更前备份，不盲目使用 `db:push`。

## 8. 分阶段任务与验收

未勾选项表示待完成；已勾选实现项不等于微信实测验收通过，具体证据见实施记录。

### A：协议与 Cloudflare 运行验证（首个里程碑）

- [ ] A0 完成第 4 节核验，记录协议 fixture 与平台限制。
- [x] A1 建立独立 Worker、SQLite DO、Queue、DLQ 与类型检查/测试脚本；基础设施已部署。
- [x] A2 扫码、绑定、凭证存储与受保护管理接口；真实扫码与 generation 1 绑定已确认。
- [x] A3 文本收发、Alarm、游标、outbox、去重与退避；无损大整数 ID 解析后微信实测通过。
- [x] A4 Queue 确定性文字回复，不访问模型与业务数据库；用户确认收到回复，4 条记录为 done。
- [ ] A5 已部署，人工暂停切换版本后的恢复通过；至少 24 小时观测与完整编号测试仍待完成，不停轮询的自动热升级尚未通过。

验收步骤：
1. 扫码绑定允许用户，发送 10 条带编号文本，逐条检查回复、游标与处理状态。
2. 陌生用户和自身消息不执行任务；管理接口无 token 返回 401，敏感状态不公开。
3. 重投相同 message_id，只出现一次有效处理；重复入队可安全消费。
4. 分别在消息持久化前后、入队成功后未标记时注入崩溃，恢复后不得丢失已接收事件。
5. 重新部署 Worker、重建运行中的 DO 对象后，从持久化游标恢复；不把“删除 DO 存储”当作普通重启。
6. 注入轮询超时、429、5xx、Queue 发送失败、token 失效，检查退避、outbox 补投、暂停及告警。
7. 记录 24 小时消息延迟 P50/P95、最大延迟、空闲轮询次数、失败率、积压和资源消耗。通过后再决定 B。

### B：AI 业务操作与安全加固

- [x] B1 本地实现 Agent API、服务认证、授权映射与家庭密码登录/Proxy；媒体访问和生产限流仍待加固。
- [ ] B2 本地校验、幂等模型/追加 SQL 和事务实现完成；临时 PostgreSQL 14 的 10 个真实事务/并发测试通过。目标 Neon/连接池与生产变更应用仍待审批和验收。
- [x] B3 本地实现一次受限 Tool Calling 规划、持久化操作计划与超时/token 限制；模型合成输入实测通过，生产费用告警仍待完成。
- [ ] B4 本地真实结果格式化和生产构建 HTTP 鉴权测试已通过；微信到业务链路与完整页面回归待验收。

验收案例：
- “小好今天 10.5 公斤”只创建一条授权宝宝的体重记录，日期按指定时区，回复含实际结果。
- “今天身高 80 厘米”“今天第一次自己走路”分别验证成长记录和里程碑字段。
- 同一消息重试、Queue 重投、业务响应丢失后重试，数据库均无重复记录。
- 缺少单位、同名宝宝或非法值先询问/拒绝；越权 babyId 返回 403，数据库不改变。
- Prompt injection 不改变授权；模型超时不虚报成功；写入成功后回复失败不重复写入。

### C：72 小时稳定性与上线门槛

- [ ] C1 持久化指标与只读 observe 报告/脱敏筛查已完成；DLQ 管理、独立外部监控与告警投递仍待完成，不能只依赖已停止的 Alarm 自己告警。
- [ ] C2 故障注入覆盖重登录、凭证轮换、消费超时、暂停/启动与积压重放。
- [ ] C3 连续运行 72 小时，输出资源与延迟报告。
- [ ] C4 固定去重保留期、重试预算、告警阈值和暂停操作说明。

验收：所有带编号测试消息可追踪到成功或明确终止原因；已受理事件无丢失、业务写入无重复；无未解释积压或未处置死信。建议初始目标：正常即时文本端到端 P95 ≤ 15 秒（含 AI），持续积压超过 5 分钟告警；这是验收目标，不是平台保证，需按 A 的实测调整并记录理由。

### D：多模态（可选，不阻塞首版）

- [ ] 核验媒体下载、解密、语音处理协议，限制 MIME、大小和有效来源。
- [ ] 媒体解密与失败恢复测试；使用授权上传通道写入 R2 和 MediaItem。
- [ ] 验证微信重投不会重复上传，未授权用户不能访问媒体。

### E：全站迁移（独立决策）

- [ ] 单独评估 Next.js 运行适配、Prisma/Neon 连接、Sharp/FFmpeg 与上传路径兼容性。
- [ ] 回归页面、数据库与媒体，并保留回滚方案。
- [ ] 只替换业务调用适配层，不重写微信协议层。

## 9. 成本与可行性假设

沿用原方案将单个 DO 的 128 MB 计费内存按 0.128 GB 计、持续活跃 30 天的示意换算（不是把 128 MiB 严格换算成十进制 GB；实际以平台计费单位为准）：

```text
每日：0.128 × 86,400 = 11,059.2 GB-s
每月：0.128 × 86,400 × 30 = 331,776 GB-s
若月包含额度为 400,000 GB-s：占 82.94%
若每日免费额度为 13,000 GB-s：占 85.07%
```

这是原方案的估算口径，不是当前账单预测。计费内存口径、等待网络 I/O 是否计时、实际活跃时长、Free 配额、其他实例与账户累计用量均需核验。免费额度每天重置，不能用月平均掩盖某日超限。

若每轮持续约 35 秒，理想连续轮询约 2,469 次/天；实际快速空返回、失败重试会提高请求量。还需计入 DO 存储/请求、Queue 每条消息的发送/接收/删除与重试、DLQ、Worker、模型和业务 API 费用。

结论：可尝试 Free，但不承诺 $0；Paid 也不承诺固定 $5 封顶。A/C 根据 Dashboard 实测设预算与告警，再决定长期部署。

## 10. 运维、回滚与降级

| 情况 | 操作 |
| --- | --- |
| token 失效 | 暂停轮询，重新扫码、更新 Secret，经授权绑定配置；按协议决定是否重置游标 |
| 长轮询连续失败 | 查看错误分类和资源限制，退避并告警；不要立即清除游标或去重数据 |
| Queue/DLQ 积压 | 先定位模型、API、权限或过期上下文，再限速重放；复用原操作计划和幂等 key |
| 业务成功但回复失败 | 根据已保存结果仅补发回复；上下文过期标记终止，不重新写入 |
| 费用异常 | 暂停轮询/消费或限制 AI 预算；保留待处理事件并明确用户影响 |
| 部署回滚 | 回滚兼容的 Worker/API 版本，保留 DO 与幂等数据；数据库迁移单独评估，不随代码盲目逆迁移 |

关键指标：最近成功轮询、游标更新时间、下一 Alarm、outbox 数量、Queue 年龄、DLQ 数量、接收/去重/写入/回复计数、错误类别、模型费用与 DO 用量。日志仅记录必要关联 ID，避免正文、宝宝健康数据和所有 token；另制定事件/日志清理期限。

若 A 证明 Alarms 长轮询无法可靠运行，再单独评估 Cloudflare Containers + 独立 Node.js 适配器。Containers 的计划资格、常驻成本、休眠与恢复机制同样需要核验，不能当作已验证的无成本替代方案。

## 11. 交付证据

每阶段验收记录包含：部署版本、协议版本、配置（脱敏）、测试时间窗口、用例结果、故障恢复记录、资源截图/导出、已知限制和是否允许进入下一阶段。无真实部署证据时只标记“设计完成”，不标记“微信接入完成”。
