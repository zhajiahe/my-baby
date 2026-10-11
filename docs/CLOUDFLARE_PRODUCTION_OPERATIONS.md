# Cloudflare 生产准备与回滚门禁

这是 `feat/cloudflare-migration` 的**待审批生产配置**，不是上线授权。生产 Neon、Vercel、正式域名和当前微信 Worker 均不得由下面的测试命令修改。

## 1. 独立资源，不把测试资源改名

`cloudflare/production.config.ts` 提供 standby Worker 工厂，现有 `cloudflare.config.ts` / `deploy:cloudflare:test` **不会选择它**。

| 资源 | 生产独立名称 | 当前状态 |
|---|---|---|
| Web Worker | `mybaby-web-production` | 未创建/未部署 |
| D1 | `mybaby-production` | 未创建；须独立 ID，不能填测试 ID |
| 私有 R2 | `mybaby-production-media` | 未创建；必须关闭 managed public access |
| 正式 routes/domain | 审批后的域名 | 未绑定 |

工厂需要生产 account/D1/code version 元数据及显式 `MYBABY_PRODUCTION_APPROVED=standby-only`；该环境变量只是操作门禁，**不是用户批准的替代品**。默认关闭 workers.dev、冻结业务写入、空 Agent grants、关闭 Agent writes。不包含 SOURCE_MEDIA、MIGRATION_TOKEN、测试 SESSION_TOKEN、微信 DO/Queue。

正式 schema/importer 必须另行评审：保留业务表结构，deployment_guard 必须写为 `mybaby-production`；不得直接执行只允许测试目标的 importer 或沿用测试 guard。

## 2. WAF 与长期凭证：未执行的生产阻塞

`cloudflare/waf-policy.template.json` 是 zone rate-limit 草案，尚未向 Cloudflare 提交，也未证明当前账户套餐支持其 period/mitigation 参数。替换审批域名并按套餐验证后，使用已发现的 `cf rulesets create` / `cf schema rulesets create` 检查请求。**不得把模板文件视为 WAF 验收通过**。

- 登录与 presign 路径有独立 burst guard；不要对服务 Agent API、视频 Range 或 S3 PUT 施加 JS challenge。
- 现有内存登录限制仍是单实例 best effort，不是全局分布式保证。是否允许两人低频使用的简化方案，需要用户明确接受，不由其他草案自动取消验收门禁。
- 正式 R2 凭证仅授权新生产 bucket，最好进一步限制 `uploads/`。不得复用源复制凭证或测试 bucket 凭证。
- 生产工厂只声明 ACCESS_KEY/SECRET，不声明临时 SESSION_TOKEN。长期凭证尚未签发、安装或验收，不能宣称已解决。
- 密码、会话 secret、Agent token、upload secret、operations token 分别生成，不同环境不复用。保存在独立 secret manager；Git/浏览器资源/日志均不存值。
- 凭证轮换先安装新 key、验证直传与私有读取，再吊销旧 key；记录操作时间、权限范围、吊销结果，禁止记录 secret 值。

## 3. 监控与隐私

`GET /api/ops/health` 需要独立 ≥32 字符 operations bearer，家庭 Cookie 不足以授权。返回 private/no-store、代码版本、部署类型、冻结与 Agent 写开关，并只读探测 D1 guard 和 R2 binding。依赖异常只返回固定错误，不返回 SQL/对象路径/凭证。

```sh
npm run monitor:cloudflare:test
```

该命令检查实际部署版本的 D1/R2 bindings 和缺失 SOURCE_MEDIA，且只能用于固定隔离 Worker。**单次 probe 不等于持续监控**。生产还需独立外部定时探测、报警接收渠道及报警/恢复演练：连续依赖 503、登录/签名异常、Queue backlog/DLQ、unknown replies、模型费用、R2 孤儿量。应用/模型消息正文、Cookie、Authorization、二维码、签名 URL 和原始媒体路径不进入公开报告。

Playwright 的 trace/截图包含 Cookie、媒体或签名 URL，只能保存在 `.migration/` 私有目录；不要上传公开 CI artifacts。错误摘要使用 hash。一次诊断曾意外输出隔离 Cookie，测试会话签名 secret 已立即轮换并重新部署；旧 Cookie 的 401 验证记录在私有报告。正式密钥/会话未改。

## 4. 已执行的隔离回滚演练

```sh
npm run rollback:cloudflare:test
```

只操作固定测试 Worker，部署冻结版本 A/B（同源码、不同配置标识），把 A 恢复到 100% 流量，并等待实际 HTTP probe/控制面版本一致；不能仅凭部署 API 成功断言生效。D1 业务行和两套 receipt ledger 的逐行 SHA-256 在回滚前后一致。历史第一次即时 probe 未通过；加入传播等待后重跑通过，失败记录保留。

这证明**隔离 Worker 配置/版本回滚保留 D1 数据**，不证明不同代码版本、正式域名切换、Neon 增量对账或生产备份恢复已通过。

## 5. 正式切换与切回

1. 明确批准生产资源、长期凭证、套餐/预算和最终迁移窗口。
2. Freeze 原入口写入；暂停对应桥接消费；等待已签发直传 URL 的 600 秒 TTL 和在途上传完成，必要时吊销旧上传 key。冻结开关不能撤销已签发的 R2 PUT。
3. 创建可恢复的 Neon、R2、配置/秘密引用备份，并演练恢复到**另一个隔离目标**。备份包含原 ID、JSON、UTC 日期、媒体摘要和 Agent/media receipts。
4. 最后一次一致性导出 → 独立生产 D1 导入 → 逐字段/关系/媒体完整性复核；审批恢复演练、浏览器/真实微信矩阵后才绑定域名。
5. 上线后监控只读 canary 和真实低风险写入的事务回执，再按批准顺序开放写入/Agent grants。
6. 若 CF 已产生新写入，切回前再次冻结：导出 D1/R2 增量及回执，用 original ID/operation key 对账到隔离 PostgreSQL 并验证；审批后才对旧生产应用接收新写入。**不能直接切 DNS 丢掉 CF 新数据**。
7. 分别验证代码版本、域名路由、长期 secret 版本、schema 兼容性和原/新增数据。变更 schema 或 secret 后不要强制绕过 Cloudflare 的 rollback 检查。

当前生产结论：**No-Go**。模板、单次 probe 和测试版本回滚都不能替代这些验收。
