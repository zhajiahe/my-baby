# Cloudflare 发布候选推进报告（2026-10-11）

**结论：No-Go（生产）；隔离验证取得进展，不是生产验收通过。**

开始时实际 HEAD 为 `c303ead`，不是请求中的 `8a887ab`；保留并复用其实现。用户的 `test.txt` 未提交修改未更改。没有操作 Vercel 生产、Neon 生产写入、正式域名或现有微信 Worker。本轮没有重新导出 Neon；测试数据复位使用现有私有快照。

## 本轮实现与真实执行

| 项目 | 本轮结果 | 私有证据 |
|---|---|---|
| TypeScript | 通过 | `.migration/rc/types-final.log` |
| ESLint | 可运行、0 errors；旧债务仍为 warnings | `.migration/rc/lint-final.log` |
| Web 单测 | 20/20 通过 | `.migration/rc/unit-final.log` |
| 微信单测 | 通过（数量以日志为准） | `.migration/rc/weixin-unit.log` |
| Worker 构建 | 通过 | `.migration/rc/build-final.log` |
| 真实浏览器 E2E | 最终 26/26 通过，桌面 Chrome + Chrome iPhone 视口 | `.migration/rc/e2e-last.log`，`.migration/e2e/results-*.json` |
| 合成微信 Tool Calling | 3/3 通过，独立 DO/Alarm/Queue + 真实模型 + Agent API + D1 | `.migration/rc/synthetic.log`，`.migration/weixin-acceptance-report.json` |
| 权限撤回 | 撤回后真实回放 403，原回执保留，控制面 grants=[]、Agent writes=false | `.migration/rc/revocation-verification.json` |
| 媒体清理 | dry-run/execute 通过；0 个达到 24h 删除条件；未声称实际删除了本轮新孤儿 | `.migration/rc/cleanup-preview-fixed.log`、`cleanup-execute.log` |
| 清理拒绝用例 | 未授权 401；不匹配 candidate hash 409，删除前拒绝 | `.migration/rc/cleanup-negative.json` |
| A→B→A 回滚 | 本轮真实隔离演练通过，冻结与 D1/两套回执 ledger hash 保持一致 | `.migration/rc/rollback-rehearsal-fixed.log`、`.migration/rollback-rehearsal-report.json` |
| 冻结恢复快照 | 私有导出通过，包含业务表和两套回执，不写 Neon | `.migration/rc/rollback-export-final.log`、`.migration/rollback-*.json` |
| 数据复位/完整性 | 现有只读源快照恢复到隔离 D1，完整字段/关系/R2 manifest 通过 | `.migration/rc/validation-final.log` |
| 最终探测 | 隔离依赖健康；Web 冻结、Agent writes=false | `.migration/rc/monitor-final.log` |

浏览器测试覆盖登录/退出、成长 CRUD、里程碑 CRUD、相册/头像、R2 直传、HEIC→JPEG、H264 MP4 字节与播放、WebM 缩略图/Range、保存响应丢失回放。新增负例覆盖非 uploadId 路径与 batch 的外部 URL、缺失对象、伪造 PNG 内容、缺失 size。**iPhone 视口不是 iPhone 真机；本机未完成 WebKit/Safari。** MOV/HEVC 继续明确拒绝，不视为兼容性通过。

## 修复范围

- 单条/批量发布统一校验 canonical 私有 URL、UUID Key、对象存在、实际 R2 size（100MiB 上限）、MIME、容器签名；类型/format、缩略图同源 ID、日期与有限时长校验。不传 uploadId 不再绕过。
- 相册已发布媒体引用/格式/时长不可通过 PUT 替换；新增头像引用也校验实际对象。兼容 multipart 路径校验实际 File.size 和签名。签名路径要求 size，禁发 MOV 签名。
- 容器签名不是完整解码或 codec 验证，不能证明 MP4 都是 H264，不能证明音轨/旋转/iPhone HEVC 兼容。
- 清理永不扫描删除 legacy：只删 uploads 下超过 24h、未被 D1/迁移 manifest 引用的对象。执行需业务冻结和 preview hash；仅隔离目标、独立 token 可用。Proxy 特许该维护接口通过业务冻结，route 仍独立认证。
- 修复失效的 `next lint` 和 FlatCompat 配置。现有 explicit-any/React compiler 债务保留为 warning，没有声称零 warning。
- GitHub Actions 普通 PR/push 运行无云秘密检查；隔离云 E2E 只能由指定分支 workflow_dispatch + protected environment 运行。无生产部署任务，无 source DATABASE_URL/源 R2 绑定，无私有 artifacts 上传。
- CI 定义尚未在 GitHub runner 实际执行；需要环境审批、最小权限 token 和独立测试秘密。WebKit CI 用例是计划验收，不是已通过证据。

## 失败与限制（不可覆盖为通过）

1. 新媒体负例首次返回 403：测试缺少 CSRF Origin，补上正确 Origin 后通过；保留 `.migration/rc/e2e-final.log`。
2. 后续运行两例在 5s hydration 门禁超时（WebM 用例前置页面、资料创建 reload），不是媒体转换失败；显式就绪预算调整为 15s，最终完整运行通过。没有定位网络/客户端根因，保留 `.migration/rc/e2e-corrected.log`，仍需性能观察。
3. 权限撤回脚本在并发/回放检查与回执查询之后、撤回后的请求遇到 `UND_ERR_SOCKET`；后续重新跑/部署尝试超时。之后独立核对实际空 grants、关闭写入、同一消息回放 403、回执保留成功。**不能称专项 orchestrator 一次无故障通过。** 证据 `.migration/rc/agent-revocation-first-failed.log`。脚本增设控制面超时，不把网络失败直接算成功。
4. 冻结清理首次被 Proxy 全局冻结拦成 503，修复仅维护清理路由的豁免后通过。
5. 回滚本轮首次 A 部署即时 probe 未观察到 marker，失败 `freeze_a_not_verified`；增加 A/B 与回滚传播等待后重跑通过。失败 `.migration/rc/rollback-failed-freeze-propagation.json` 保留。
6. 新告警脚本最初缺少模块标记导致 TypeScript 失败，补 `export {}` 后最终检查通过。

## 生产准备：已准备 vs 未验收

已准备独立 standby 配置；现有迁移工具新增 `--production` 专用目录/固定资源名称、审批/冻结/备份记录、D1 名称与 guard、实际已部署 DB/R2/冻结/空 grants 检查，禁止 reset，复用只读一致性导出/导入/验证逻辑。**没有对生产资源执行过这些路径。** 正式媒体复制仍需独立审核的只读源转移工具；生产模式明确拒绝测试 copy-media 路径，不允许借测试 SOURCE_MEDIA 绕过。

新增冻结 D1 回滚快照工具与外部 webhook 健康/模拟告警入口。告警接收渠道、真实告警/恢复送达、生产增量反向导入 Neon、生产备份恢复仍未验收；没有配置秘密/未创建生产资源。测试 Worker A/B 回滚不等于生产数据回滚演练。

## Go/No-Go 门禁

**No-Go。** 剩余硬门禁：真实 Safari/iPhone；真实微信的 24h 复核/凭证轮换/热升级与阶段 B 真实通道业务写入（真实通道**编号文本 10 条**已于 2026-10-11 通过，见 `docs/WEIXIN_CLAWBOT_VALIDATION.md` 第 10 节）；HEVC/MOV、音轨/旋转矩阵或明确批准降级；长期最小权限 R2 凭证与 WAF/分布式认证防护；已签发 PUT 在 TTL 内可再次写同一 key 的不可变发布策略；生产媒体最终只读转移和 hash 校验；生产独立资源/恢复演练/增量逆向迁移；持续监控告警实测；GitHub runner CI 实测及切换批准。

最终隔离环境保留源快照数据、239 个 legacy 媒体引用；本轮上传的年轻 uploads 对象由 24h 宽限保护，后续需在维护冻结期间重复清理。Agent grants 空、Agent writes 关闭，Web 写入冻结。没有切换生产流量。
