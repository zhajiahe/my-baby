# Cloudflare 迁移验收报告（可审计）

> 本文件保留上一轮证据。最新发布候选推进、失败与门禁见 [CLOUDFLARE_RC_REPORT.md](CLOUDFLARE_RC_REPORT.md)，不能用历史通过代替本轮验收。

状态日期：2026-10-11 · 分支 `feat/cloudflare-migration` · 基线提交 `8a887ab`（本报告对应其上的未提交实现）

**结论：No-Go。** 隔离环境的合成与浏览器验收通过，但真实微信、真实 Safari/真机、MOV/HEVC、WAF/长期凭证、生产资源与生产切换均未验收，也未获批准。

重新生成（读取私有证据并输出脱敏摘要）：

```sh
npm run acceptance:report   # 写入私有 .migration/acceptance-summary.json（0600）
```

## 1. 代码与部署版本

| 项 | 值 |
|---|---|
| 分支 | `feat/cloudflare-migration` |
| 基线提交 | `8a887ab` |
| 源码哈希 | 见私有 `acceptance-summary.json.code.sourceHash`（含未提交实现） |
| Web Worker | `mybaby-web-migration-test`（隔离） |
| D1 | `mybaby-cloudflare-migration-test`（隔离） |
| 私有 R2 | `mybaby-cloudflare-migration-test-media`（隔离，无公共访问） |
| 合成微信 Worker | `mybaby-weixin-acceptance`（独立，合成 iLink，非正式） |
| 正式资源/Vercel/域名/微信 Worker | **未改动** |

版本由 `scripts/code-version.ts` 计算（commit + 受版本控制源码 SHA-256 + dirty 标记），部署时注入 `MYBABY_CODE_VERSION`，`/api/ops/health` 可读回。控制面真实部署版本与 bindings 由 `scripts/test-target-guard.ts` 核对，不信任本地配置。

## 2. 用例通过率与证据

| 套件 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 单元测试 | `npm run test:unit` | 17/17 通过 | `.migration/unit-latest.log` |
| 微信桥接单测 | `weixin/npm test` | 48/48 通过 | `weixin/.local/acceptance-regression.log` |
| 可丢弃 PostgreSQL 回归 | `npm run test:postgres` | 通过（临时集群，用后销毁） | `.migration/postgres-latest.log` |
| 云端 HTTP 冒烟 | `npm run test:cloudflare` | 通过 | `/tmp/http-smoke.log` |
| 运维健康探测 | `npm run monitor:cloudflare:test` | 通过 | `.migration/monitor-latest.json` |
| Playwright E2E | `npm run test:e2e` | 24/24 通过（12 用例 × 2 工程） | `.migration/e2e/results.json` + 时间戳副本；失败证据在 `artifacts-<runId>/` |
| 合成微信全链路 | `npm run test:weixin:acceptance` | 3/3 用例通过 | `.migration/weixin-acceptance-report.json` |
| 隔离回滚演练 | `npm run rollback:cloudflare:test` | 通过 | `.migration/rollback-rehearsal-report.json` |

E2E 工程为 **桌面 Chrome** 与 **Chrome 的 iPhone 视口模拟**；覆盖：家庭登录/退出与匿名拒绝、导航、资料创建/编辑/头像、成长记录与随心记 CRUD、PNG/HEIC/H264-MP4/WebM 直传与私有查看、保存响应丢失后的幂等重试、MOV 明确拒绝。

覆盖用例 12 项：`tests/e2e/app.spec.ts`（登录/匿名、导航、资料创建、资料更新+头像、成长 CRUD、随心记 CRUD、图片直传查看、响应丢失恢复、HEIC 转码、MOV 拒绝、MP4 透传、WebM 海报与 Range）。

## 3. 失败证据与已修复项

首次完整运行有失败，均保留私有证据并修复：

- Playwright WebKit：本机 macOS 13.1 不支持（`Playwright does not support webkit on mac13-arm64`），改用系统 Chrome，iPhone 为视口模拟，**不声称 Safari/真机通过**。
- MP4 用例误点封面装饰层（测试定位问题），改用 `data-testid="media-card-<id>"` 后通过。
- 一次 HEIC 私有读取 TLS ECONNRESET：未复现，重跑通过；已加 `maxRetries`，不当作已修复。
- 媒体清理 keepKeys 用了裸源 key，实际目标为 `legacy/<key>`，dry-run 暴露（304 全为候选），修复后候选 65 → 删除 → 复检 0。
- **诊断输出曾意外包含一枚隔离会话 Cookie**：已立即轮换隔离测试会话签名 secret 并重新部署，旧 Cookie 失效；正式密钥未受影响。诊断脚本改为只输出脱敏摘要。
- 新增独立合成微信链路时发现 Workers 不支持 `redirect:'error'`，已改为 `redirect:'manual'` 并新增回归用例。

## 4. 数据摘要（隔离副本）

只读一致性导出生产 Neon 后导入隔离 D1，逐字段/关系/JSON/UTC 日期/ID 校验：

| 表 | 行数 |
|---|---|
| babies | 1 |
| growth_records | 59 |
| milestones | 96 |
| media_items | 234 |
| agent_operations | 0（源无该表） |

R2 私有引用 239 个，逐对象源/目标 SHA-256 与字节数一致。浏览器与冒烟测试后已 `import --reset-test-data` 复位并 `validate --require-media` 复核通过；`cleanup:cloudflare:test:media` 删除 67 个合成孤儿对象，复检 0 孤儿。隔离 R2 公共访问保持关闭，测试 Worker 已移除 `SOURCE_MEDIA`。

## 5. 费用

合成微信全链路 3 次真实 OpenRouter 调用，模型 `meta/muse-spark-1.3-contributor`：

- 总费用 **USD 0.0007035**（约 0.00023/次）
- 单次 latency 3172–6641 ms，prompt 1171 tokens，completion 540–660 tokens
- 仅采集标量计量（prompt/completion tokens、cost、latency），不记录模型正文或身份

## 6. Go/No-Go 门禁

**No-Go**，以下仍需完成或明确接受后才可再评估：

1. 真实微信收发/绑定（当前仅合成 iLink）；合成通过不等于真实通道通过。
2. 真实 Safari/WebKit 与 iPhone 真机矩阵。
3. MOV/HEVC/音频/旋转/时长矩阵；当前明确拒绝，未获得降级批准。
4. WAF 模板按套餐验证并上线；登录限流升级为分布式或明确接受简化方案。
5. 生产独立资源、长期最小权限凭证、外部持续监控与告警、可恢复备份及恢复演练。
6. 用户对生产切换的显式批准。

生产操作细节见 `docs/CLOUDFLARE_PRODUCTION_OPERATIONS.md`；迁移与回滚总览见 `docs/CLOUDFLARE_MIGRATION.md`。
