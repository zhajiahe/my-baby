# MyBaby 微信桥接 Worker（阶段 A）

独立于根目录 Next.js 项目，使用 TypeScript + Cloudflare **cf CLI** + SQLite Durable Object + Alarms + Queue。没有安装 OpenClaw，也没有 VPS。

当前**云端部署**仍只做受授权的文本收发验证，回复固定测试文字，不调用 LLM 或写入宝宝记录。阶段 B 的本地 Agent/API 与密码登录实现已完成，尚未部署；OpenRouter 模型为 `meta/muse-spark-1.3-contributor`。详见 [阶段 B 操作与边界](../docs/AGENT_V1.md)。

## 当前进度

- 已部署：`https://mybaby-weixin.zhajiahe1994.workers.dev`。
- 已创建 SQLite DO、`mybaby-inbox`、`mybaby-inbox-dlq` 与 Queue 消费者。
- 已验证 `/health` 200、未授权管理接口 401；2026-10-11 北京时间已扫码绑定，generation 1，观察到云端 `running`、游标保存且最近轮询无错误。
- 用户发送“桥接测试 001”后尚未收到回复，文字收发/Queue 消费验收仍未通过；新增接收计数的线上生效及 24/72 小时观测仍待确认。详见[核验记录](../docs/WEIXIN_CLAWBOT_VALIDATION.md#7-扫码接入进展2026-10-11北京时间)。
- 详见 [协议核验与验收记录](../docs/WEIXIN_CLAWBOT_VALIDATION.md) 和 [整体实施计划](../docs/WEIXIN_CLAWBOT_PLAN.md)。

## 开发与检查

要求 Node.js ≥ 22.13（测试使用内置 SQLite；当前验证环境为 Node.js 24）。依赖固定在 `package-lock.json`；此目录 `.npmrc` 使用国内镜像源。

```bash
cd weixin
npm ci
npm run typecheck
npm test
npm run build                # cf build
npm run check                # 类型检查 + 测试 + cf deploy --dry-run
```

使用 `cloudflare.config.ts`，不是 Wrangler 配置。`cf` 版本已锁定为 `1.0.0-beta.14`。开发服务器可用 `npm run dev`，但本地 workerd 需要 macOS ≥ 13.5 或受支持的 Linux；当前机器 macOS 13.1 不能运行本地 workerd。Vite 插件禁用了运行时类型生成，以便仍可构建与云端部署；类型由 workers-types 提供。

测试使用真实 Node SQLite 与 DO 存储适配器，不是 workerd 集成测试。云端健康检查不能替代微信协议验收。构建时当前 cf/Vite 可能打印 Docker 未启动提示；本项目无 Container，已确认不阻止 Worker 构建及部署，无须启动 Docker。

## 首次部署（已在当前机器执行）

```bash
cf auth whoami
npm run session -- init
cf deploy --secrets-file .local/secrets.json
npm run session -- url https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
npm run session -- status
```

`init` 只执行一次，生成高熵管理 token。`cf` 首次部署要求所有声明的 Secret 存在，所以未扫码时使用 `UNBOUND` 非凭证占位值；`/start` 显式拒绝这个值。未绑定状态没有 Alarm，不会持续轮询。

本地 `.local/client.json`、`.local/secrets.json`、`.local/binding.json` 均以 0600 保存且被 git 忽略。**请勿读取/粘贴这些内容到聊天或日志**；保管本机及备份权限。如果本地管理 token 丢失，需要安全轮换云端 Secret，不能从 Cloudflare 取回原值。

## 微信扫码与第一次启动（下一步）

在本机终端运行，保持终端前台以便输入手机显示的验证码：

```bash
cd weixin
npm run login
```

扫码脚本显示终端二维码；支持验证码、二维码过期刷新与可信 iLink 域名重定向。二维码是临时授权信息，不要分享或截图上传。登录成功只保存凭证，不自动启动云端轮询。

首次绑定时执行：

```bash
npm run secrets:prepare      # 当前代码新增了 B 的 Secret；读取本地 .env，不输出/上传 key
npm run build               # 使用当前源代码，保持 AGENT_MODE=bridge
cf deploy --prebuilt --secrets-file .local/secrets.json
npm run session -- bind
npm run session -- start
npm run session -- status
```

如果从上次部署后修改了代码，先 `npm run build`，或去掉 `--prebuilt` 完整构建部署。`--prebuilt` 复用 `.cloudflare/output` 的已构建代码。

随后在微信发送“桥接测试 001”，预期回复：

```text
微信桥接测试成功，已收到：桥接测试 001
当前尚未接入 AI 或成长记录写入。
```

只有扫码用户 ID 在允许列表中。陌生用户、Bot 自身消息、群聊、未完成消息、不支持的媒体、缺上下文或不安全的数字 ID 不会入队。权限控制在接收层和回复层重复检查。

## 重新扫码、暂停和部署

```bash
npm run session -- pause
npm run login
npm run secrets:prepare
cf deploy --secrets-file .local/secrets.json
npm run session -- bind
npm run session -- start
```

绑定必须在暂停/失效状态进行；同 Bot 重绑定保留游标，不同 Bot 清空游标。若有未完成事件，`bind` 返回 409，不会静默丢弃。确认这些事件可以放弃后，才能执行 `npm run session -- bind --discard-pending`；它将未完成事件标为 stale 并清理正文/上下文。后续阶段 B 需设计业务操作的恢复流程，不能用此操作代替数据库对账。

暂停会取消本实例中的轮询，并防止旧响应推进游标；已经发到微信的回复无法撤回。暂停期间 Queue 仍可能投递，重试耗尽会进入 DLQ。当前 DLQ 无消费者，阶段 C 再完善人工重放与告警。

## 管理 API

管理请求均需 `Authorization: Bearer <WEIXIN_ADMIN_TOKEN>`；至少 32 字符。CLI 从受保护本地文件读取，避免手工将 token 放入 shell 历史。

| 路径 | 方法 | 功能 |
| --- | --- | --- |
| `/health` | GET | 公共存活检查；不报告微信连接成功 |
| `/admin/session/status` | GET | 脱敏状态、最近轮询、Alarm 与事件状态计数 |
| `/admin/session/bind` | POST | botId、apiBaseUrl、allowedUserIds；可显式 discardPending |
| `/admin/session/start` | POST | 设置下一轮 Alarm |
| `/admin/session/pause` | POST | 暂停并删除 Alarm |

DO 的 `/consume` 只通过绑定由 Queue 消费者调用，没有公共 HTTP 路由。Queue 仅存事件引用，不包含微信正文、用户 ID 或 context_token。

## 可靠性与已知限制

- 单轮长轮询默认截止时间 40 秒；服务端 timeout 建议加 5 秒余量并限制在 5–60 秒。每轮后安排下次 Alarm，不依赖后台无限循环。
- 事务提交事件和游标，再发送 Queue；失败时 outbox 保留，下次 Alarm 先补投。Alarm 在外部 I/O 前设置 90 秒恢复唤醒。
- `botId + message_id` 派生 SHA-256 事件 ID，SQL 唯一键去重；消费前保存 60 秒租约，防重复回复。
- `done / failed / unknown / stale` 即时清除正文、用户 ID 和上下文，去重 tombstone 保留 30 天；尚未完成的事件保留供诊断，阶段 C 需补充其到期清理策略。
- 发送请求若超时、网络中断或 5xx，可能已经成功发送但未收到响应。协议尚未验证发送端幂等，采用保守的 `unknown` 终态，不自动重发；这避免盲目重复，但可能少一条回复。明确 429 才自动重试，使用稳定 client_id。
- 认证失效（HTTP 401/403 或协议 -14）停止轮询。其他轮询错误退避到最多约 5 分钟；协议拒绝暂停以免请求风暴。
- Queue 至少一次投递，不保证 FIFO。阶段 A 不提供会话顺序或主动提醒保证。
- 当前账号创建的 Queue/DLQ 保留期均为 24 小时，不能假设 Paid 默认 4 天。DLQ 应及时处理，阶段 C 需要外部告警、重放与积压恢复。
- 不承诺 Free 额度足够或第三方独立客户端永久可用；资源消耗和长轮询兼容性必须实测。

## 阶段 B 本地测试（不部署）

```bash
npm run test:model           # 使用 weixin/.env key，合成数据；不调用业务 API
```

根目录的家庭登录、Agent API、数据库追加 SQL 及本地验证步骤见 `docs/AGENT_V1.md`。默认 `AGENT_MODE=bridge` 与写入关闭；不要在协议、权限、真实数据库事务和生产部署验收前开启。

## 阶段 A 云端验收

1. 扫码绑定后发送 10 条带编号文字，逐条核对微信回复与事件状态。
2. 收发正常时重新部署，检查 cursorSaved 和后续回复；不要删除 DO 存储。
3. 暂停、启动，确认停止后不推进游标，恢复后继续收到消息。
4. 至少运行 24 小时，记录延迟、轮询错误、事件积压和资源使用。
5. 确认未解释的 failed/unknown/stale 事件为零或已明确处置，再进入 AI/API 阶段 B。
