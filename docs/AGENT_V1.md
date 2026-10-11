# 阶段 B：家庭登录与 MyBaby Agent API

阶段 B 状态：**本地实现和测试完成，未部署 Vercel、未变更生产数据库、未上线云端 Agent**。后续阶段 A 已完成扫码、真实文字收发/Queue 消费与人工暂停切换部署后的恢复验证，24/72 小时稳定性及无人工暂停的热升级仍待验收；线上只更新了独立构建的阶段 A 文字桥接，详见[核验记录](./WEIXIN_CLAWBOT_VALIDATION.md)。用户选择 B 仅做本地实施；提交推送到功能分支，不能把分支推送视为生产上线。

OpenRouter 模型固定为 `meta/muse-spark-1.3-contributor`。使用 `weixin/.env` 中的 key 完成合成输入 Tool Calling 实测，没有将 key、用户微信 ID、真实宝宝资料或消息发送给模型，也没有执行数据库写入。

## 1. 家庭访问保护

新增：
- `src/proxy.ts`：Next.js 16 Proxy，保护页面及所有原有 API。
- `src/lib/auth.ts`：签名会话、凭证比较、Origin 检查与请求大小限制。
- `/login`、`/api/auth/login`、`/api/auth/logout`，导航提供退出按钮。
- 原有公共缓存的 baby/growth/milestones/photos 查询改为 `private, no-store`。

这是单家庭共享密码，不是多租户账号系统：登录家庭成员能操作站点中的所有宝宝数据。Agent 权限另行按微信身份绑定特定 babyId，不能拿家庭 cookie 访问服务接口。

密码至少 6 字符（2026-10-11 所有者决定，按极简模式从 12 放宽），签名 Secret 至少 32 字符；未配置或长度不足时拒绝访问，而不是退回匿名模式。会话有效期 7 天，Cookie 使用 HttpOnly、SameSite=Strict，生产环境 Secure。改变密码或签名 Secret 会使全部会话失效。退出删除浏览器 Cookie，但不提供服务端单会话吊销；被盗 Cookie 在过期/轮换前仍可能有效。

写入请求必须有可信同源 Origin；登录、退出亦检查 Origin。部署域名固定时建议设置 `MYBABY_APP_ORIGIN`。登录具备每实例速率限制，但它**不是分布式防暴力破解保证**；经用户明确接受，极简模式下不要求 WAF/分布式限流，该缺口作为已接受残留风险记录在 `SECURITY_CREDENTIALS_PLAN.md`。

### 本地配置

在根目录执行（不会连接数据库或部署）：

```bash
npm run auth:setup
```

脚本创建 0600 的 `.env.local`，生成家庭密码、会话 Secret 和独立 Agent token，不打印值。私下读取文件中的密码以登录。已有 `.env.local` 时脚本拒绝覆盖，请手工合并 `env.example` 的配置。已有 Worker 本地凭证时只同步 Agent token，不替换微信 token 或管理 token。

`npm run dev` 使用本地环境变量；原 `.env` 数据库仍会被 Next.js 加载。**做写入测试前务必将 DATABASE_URL 换成独立测试数据库**，不要让本地页面误连生产 Neon。测试脚本使用内存存储/无效数据库 URL，不会调用现有生产数据库。

原 R2 公共链接仍可在绕过 Web 页面时直接访问。密码登录不能保护已公开的媒体文件，生产需另行评估私有桶与签名访问、清除旧共享缓存；本轮没有修改存储或执行缓存清理。

## 2. 服务 API

入口：`POST /api/agent/v1`。只接受 `Authorization: Bearer <MYBABY_AGENT_TOKEN>`，不接受家庭 Cookie，也不接受任意 URL、SQL、删除操作或模型指定的 babyId。

服务端授权环境变量：

```env
# 真实 token 不能提交或放进 NEXT_PUBLIC_ 变量
MYBABY_AGENT_TOKEN="<高熵随机值，至少32字符>"
MYBABY_AGENT_GRANTS='[{"source":"weixin","botId":"<bot>","userId":"<允许用户>","babyId":"<授权宝宝>"}]'
MYBABY_AGENT_WRITES_ENABLED="false"
```

默认无授权、写入关闭。身份必须精确匹配一条授权记录；没有匹配或重复匹配均拒绝。Worker 和服务端分别控制写入开关，两端都开启才可写入。

规范请求（值为示意，不是真实身份）：

```json
{
  "source": "weixin",
  "botId": "bot",
  "userId": "allowed-user",
  "messageId": "123",
  "operation": "create_growth_record",
  "operationKey": "op_0",
  "args": { "date": "2026-10-10", "weight": 10.5 }
}
```

身份及 operationKey 由接收层生成，不由 LLM 生成。字段白名单、日期、数值类型、范围、文字长度与列表条数都会再由 MyBaby 校验；服务 token 只是信任 Worker 的基础，服务器仍检查其渠道用户到宝宝的授权映射。

首批工具：

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `get_baby_summary` | `{}` | 名字和出生日期，不返回过敏/备注/媒体链接 |
| `list_growth_records` | 可选 from/to/limit（最多30） | 日期、体重、身高、头围 |
| `list_media_items` | 可选 from/to/limit（最多30）/mediaType=`IMAGE`\|`VIDEO` | 日期、类型、格式、标题；**永不返回 `url`/缩略图/任何媒体链接**（私有路径在通道里无用且会泄露） |
| `get_album_summary` | `{}`（无参数） | 总数、照片数、视频数、最早/最近日期、最近 6 个月的按月计数；求和由服务端完成，模型不做算术 |
| `create_growth_record` | date、至少一个 weight/height/headCircumference，可选 notes | 实际记录 ID 和测量结果 |
| `create_milestone` | date/title，可选 description/tags | 实际记录 ID、日期和标题 |

日期为严格 YYYY-MM-DD，测量单位为 kg/cm。接口读取结果限量；不能用工具绕过授权查其他宝宝。家庭原有表单校验尚未与 Agent 工具合并为同一业务层，现阶段 Agent 使用独立严格校验，原页面受统一登录/CSRF 保护。

## 3. 写入幂等与数据库变更

新增 Prisma `AgentOperation`，唯一键为：

```text
source + botId + messageId + operationKey
```

payloadHash 同时绑定授权 babyId、用户身份和规范化参数。重复请求返回原结果；相同 key 参数不同返回 409。每次 mutation 与 receipt 在同一个 Prisma 事务中写入；并发唯一约束冲突会回滚败方业务写入，再读取胜方结果。

本仓库此前使用 `db:push`，没有 Prisma migration 历史，所以本轮提供独立可审查的追加 SQL，而不是直接创建不完整的 migrate deploy 历史：

`prisma/changes/20261010_agent_operations.sql`

**生产数据库未执行 SQL 或 db:push；后续已在全新临时本地 PostgreSQL 14 中验证追加 SQL 与真实事务，见第 7 节。** 上线前必须:
1. 备份并确认目标数据库，先在独立测试 PostgreSQL 上执行该 SQL。
2. 在目标测试环境复核 Prisma/数据库事务与并发行为；本地 PostgreSQL 14 测试已通过，仍不等同于 Neon/连接池及生产环境验收。
3. 若要统一使用 Prisma migrations，先为现有数据库做 baseline。
4. 再经确认将追加表变更应用到生产，保持写入开关关闭，联调成功后开启。

receipt 保留实际操作结果用于重放，不会自动到期删除；后续制定清理策略必须覆盖 Queue/DLQ/人工重放窗口，不能提前删掉幂等记录。代码回滚可先保留这张表，不要连同业务数据盲目回滚数据库结构。

## 4. Agent 运行方式

Worker 新增 `agent.ts`、`tools.ts`、`agent-run.ts` 和 DO `agent_runs` checkpoint 表；已有 DO 的 events 表只追加 message_id 字段，不删除已有游标。

- 每条消息独立规划，一次 OpenRouter 请求，最多 3 个工具操作。
- 模型请求最多 2048 输出 token、30 秒超时，使用 low reasoning；不支持的 `parallel_tool_calls` 参数未发送。
- “今天/昨天”按消息创建时间与配置时区（默认 Asia/Shanghai）解析；没有可靠创建时间时使用接收时间。重试不会以新日期重新解释已持久化的计划。
- 模型只看到必要名字、日期和当前文字，不看到服务 token、微信身份或 babyId。当前不提供聊天历史；追问后应重新说明完整记录需求。
- 计划在任何写入前持久化；每个成功工具结果逐步保存，稳定 operationKey 为 `op_0`、`op_1` 等。模型计划已保存后重试不重新推理。
- 规划/工具处理使用 processing 状态与 150 秒租约，可从 checkpoint 恢复；微信发送仍使用 sending 状态与保守的 unknown 策略。
- 已保存的回复仍重新核验服务端授权；权限撤回不直接泄露缓存的健康资料。
- 成功回复直接由真实业务结果格式化，不让 LLM 捏造记录成功。永久失败报告实际已确认成功的部分，不声称整个消息是跨操作原子事务。
- 暂停阻止尚未开始的后续业务调用，但无法撤销已经发出的事务或微信回复。

`AGENT_MODE` 默认 `bridge`，`AGENT_WRITES_ENABLED` 默认 false，`MYBABY_API_ORIGIN` 默认空。当前云端仍是上一阶段已部署版本，未上传新的 OpenRouter Secret，也没有启用 AI。

### 凭证准备与模型测试

```bash
cd weixin
npm run test:model            # 读取本地 .env key；仅合成 Tool Calling，有模型费用
npm run secrets:prepare       # 写本地 0600 凭证文件；不上传、不部署
```

`secrets:prepare` 保留原管理/微信 token，将 OpenRouter key 和 Agent token 加入 `.local/secrets.json`；服务器 companion 配置在 `.local/agent-server.json`，请私下同步 token 到 MyBaby 服务端。勿将文件内容粘贴进聊天或 shell 命令参数。

阶段 A 验收后再配置真实业务 origin、部署受保护的 MyBaby API、上传 Worker Secrets。阶段 B 新配置声明了两项额外 Secret，之后部署必须先运行 `secrets:prepare`；不要用只有阶段 A token 的旧 secrets 文件直接部署。

## 5. 已执行检查

- 根项目：`npm run test:unit` 的 9 个用例全部通过，覆盖登录签名、Origin、代理保护、授权、参数验证、幂等冲突、事务回滚与并发行为。
- `npm run build`：Next.js 生产构建通过，包含 Proxy、登录和 Agent API。
- `npm run test:auth`：实际启动生产构建，验证匿名 API 401、首页跳转、登录 Cookie、CSRF、独立服务鉴权及退出；显式覆盖 DATABASE_URL，生产数据库调用为 0。
- `npx prisma validate` 与 TypeScript 检查通过。
- Worker：`npm run check` 的 30 个用例全部通过，并通过 cf dry-run；包含阶段 A 回归和 Agent 规划、稳定计划、部分成功恢复、权限撤回、写入开关、暂停及 DO checkpoint 重启/回复重试测试。
- `npm run test:model`：真实模型成功输出合成日期/体重工具计划，businessWrites 为 0。此前调试请求的参数兼容/输出限制失败不记为成功；调整后实测通过。

## 6. 下一阶段门槛

已完成微信基础文字收发及临时本地 PostgreSQL 的真实并发事务测试。仍未完成：24/72 小时连续运行、目标 Neon 测试环境/连接池复核、业务授权映射配置、媒体访问安全、Vercel 发布与微信→数据库完整链路。生产分布式登录限流已按极简模式接受不做（见 `SECURITY_CREDENTIALS_PLAN.md`）。

本轮完成的是 **B 的本地实现与测试**，不是 B 的生产验收。功能分支推送可能触发 Vercel Preview，取决于仓库集成；不要未经配置把它合并到自动部署的生产 main。

## 7. 真实本地 PostgreSQL 集成测试（2026-10-11）

```bash
npm run test:postgres
```

运行器 `scripts/agent-postgres-test.ts` 找到本地 PostgreSQL 工具（当前为 Homebrew PostgreSQL 14.18），以 0700 临时目录、随机端口、新账号/随机密码启动独立实例，仅监听 `127.0.0.1`。**不读取应用 DATABASE_URL 作为测试目标、不启动已有服务、不访问 Neon、不修改 .env**。可用 `MYBABY_TEST_PG_BIN` 指定本机工具目录，不提供外部数据库 URL 参数。

从当前 schema 去除 AgentOperation 后生成基线 SQL，应用到空数据库，再执行仓库审查用追加 SQL；Prisma schema diff 确认两者与完整 schema 一致。随后加入测试专用 guard 表。集成测试显式使用独立 URL，在任何清理/写入前校验 loopback、随机端口、测试账号/库名、实际 data_directory 与随机 guard；直接用应用环境运行测试文件会拒绝连接。

10 个实际数据库用例通过：
- 追加表与复合唯一键；新 Prisma 客户端读取已提交回执，重复请求不再写入。
- 参数改变的 409、独立 operationKey 分别写入。
- 同参数、改参数、跨工具的确定性并发竞争：barrier 保证双方事务都已执行 mutation，再争用回执；败方业务写入回滚，最终只留下一个回执和一个业务记录。
- PostgreSQL trigger 实际拒绝回执 INSERT，成长/里程碑 mutation 均回滚；移除故障后可正常重试。
- 撤回/重映射授权不泄露旧结果、不写入另一宝宝。
- 按宝宝和 UTC 日期范围读取、限量排序、私密备注不返回。
- Cookie 不授权 Agent；写入关闭/陌生人请求不改变数据库。

成功后 pg_ctl 停止专属临时实例并删除数据；失败保留 0700 私有诊断目录，输出不含连接 URL、密码或 guard。SIGINT/SIGTERM 尝试停止子命令并清理自己启动的实例，不操作 Homebrew 常驻服务。此次运行实际确认 **10/10 通过、实例停止、数据删除**；根单元测试 9/9、`tsc --noEmit` 通过；显式覆盖为无效合成数据库 URL 的 Next.js 生产构建通过；直接运行集成测试文件（未由临时库运行器提供 guard）已实际确认在客户端构造前拒绝。

这验证真实 PostgreSQL 事务，不表示已应用生产 SQL、配置真实业务授权、完成 Neon 连接池联调或上线 Agent。
