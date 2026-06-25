# Stage 9 试点前验证门禁

本文档定义 Stage 9 的验证口径、证据产物和从第一版最小可信自动化进化到试点前全覆盖的路径。Stage 9 不新增业务功能；它把 Stage 1-8 已实现能力收口为可执行、可审查、可追溯的试点前门禁。

## 1. 交付物

Stage 9 交付一个试点前验证门禁，包含：

- `npm run stage9:verify`：日常可重复运行的 Stage 9 门禁。
- `npm run stage9:discover`：缺口盘点模式，生成完整矩阵和报告，允许 `not_covered`，但不能作为试点通过证据。
- `npm run stage9:verify:full`：最终试点前全量门禁，先串行运行 Stage 1-8 verify，再运行 Stage 9 门禁。
- `scripts/stage9/gate-matrix.mjs`：只定义 Stage 9 gates，不执行命令。
- `scripts/stage9/verify-stage9.mjs`：Stage 9 gate matrix 执行入口。
- `apps/api/test/runtime/stage9-scripts.test.ts`：验证 Stage 9 package scripts、matrix categories、状态枚举、报告路径和关键 gate 存在。
- `docs/STAGE9_PREPILOT_VERIFICATION.md`：本验证规格文档。
- `artifacts/stage9/prepilot-verification-report.json`：机器可读运行报告，作为事实源。
- `artifacts/stage9/prepilot-verification-report.md`：人可读运行报告，由同一 gate matrix 生成。

运行报告属于本地或 CI 产物，不默认提交到 Git。正式试点评审如需留档，应归档某次报告产物，而不是让日常运行覆盖仓库文档。

## 2. 状态和结论

每个 gate 必须有明确状态：

- `passed`：自动化证据或人工证据满足门槛。
- `failed`：已有验证入口运行失败。
- `manual_gate`：当前无法由仓库自动化证明，需要法务、运营、真实供应商后台或人工演练证据。
- `not_covered`：路线图要求存在验证，但当前没有可执行测试、脚本或可接受人工证据。

最终结论只能是：

- `ready_for_pilot`：所有 gate 均为 `passed`。
- `ready_with_manual_gates`：没有 `failed` 或 `not_covered`，但存在 `manual_gate`。
- `blocked`：存在任意 `failed` 或 `not_covered`。

`stage9:verify` 遇到任意 `failed` 或 `not_covered` 必须以非零退出码结束。只有 `passed` 和 `manual_gate` 可以产生零退出码，但结论不能高于 `ready_with_manual_gates`。

`stage9:discover` 只用于盘点缺口和生成报告。它可以在存在 `not_covered` 时以零退出码结束，但报告结论仍必须是 `blocked`，且不得被用于声明试点可进入。

`overallStatus` 必须完全由 gate statuses 计算，不接受 CLI 参数、环境变量或手工编辑覆盖。若业务上决定接受某个风险，必须新增明确的 `manual_gate`、更新验证规格或记录 ADR，不能把 `failed` / `not_covered` 强行改成 `passed`。

`manual_gate` 必须有责任方和证据要求。第一版不要求实现电子签名或审批流，但报告中每个 `manual_gate` 至少包含：

- `owner`：`legal`、`operations`、`platform_admin`、`engineering` 或 `vendor_owner`。
- `requiredEvidence`：需要归档的人工证据。
- `validFor` 或 `expiresAt`：人工证据有效期。
- `blockingIfMissing`：必须为 `true`。

缺少人工证据时，最终结论不能高于 `blocked`；人工证据存在但仍需外部确认时，最终结论不能高于 `ready_with_manual_gates`。

## 3. 第一版策略

Stage 9 第一版采用“全量矩阵声明 + 最小可信自动化”：

- gate matrix 必须声明 `docs/MVP_ROADMAP.md` Stage 9 范围、验收、测试重点和上线前检查清单中的所有门槛。
- 已有自动化能证明的 gate，必须执行对应命令并记录证据。
- 当前没有验证入口的 gate，必须标记为 `not_covered`，不得假装通过。
- 确实无法自动化的 gate 才能标记为 `manual_gate`，并必须说明需要的人工证据。

第一版可以失败，但必须诚实失败。它的主要价值是把“离试点还差什么”变成机器可读事实。

Stage 9 第一轮不主动改变业务行为：

- 如果缺口是没有测试、脚本或报告证据，在 Stage 9 分支补验证。
- 如果缺口是业务代码不满足 Stage 1-8 既定契约，必须作为对应阶段的回归修复处理，不得在 Stage 9 门禁里绕过。
- 极小稳定性修复可以留在 Stage 9 分支，但提交信息必须明确属于 `fix(stageX): ...` 或 `fix(stage9): ...`，不能混入验证脚本提交。
- Stage 9 不新增产品能力，不改变 PRD 或路线图语义，只把既有要求转成可执行门禁。

CI 接入分阶段推进：

- 第一轮提交 `stage9:discover`、`stage9:verify`、验证规格、ADR 和初始矩阵，但不立即把严格的 `stage9:verify` 接入普通 PR CI。
- 第一轮 PR 必须说明 `stage9:discover` 是缺口盘点命令，`stage9:verify` 可能因 `not_covered` 诚实失败。
- 高优先级 hard gates 补到足够稳定后，再将 `stage9:verify` 接入 CI。
- `stage9:verify:full` 只用于最终试点前或 release candidate，不进入普通 PR CI。

## 4. 进化到全覆盖

Stage 9 gate 不允许通过删除或弱化路线图门槛来提升通过率。每次迭代必须让 gate 处于以下更高成熟度之一：

- `declared`：gate 已出现在矩阵中，但状态仍是 `not_covered`。
- `mapped`：gate 已映射到现有测试、脚本、文档或人工证据要求。
- `automated`：gate 已由仓库内测试或脚本自动证明。
- `rehearsed`：涉及 runtime、迁移、备份恢复、供应商降级或运营流程的 gate 已有可重复演练入口。
- `pilot_ready`：gate 在最终 `stage9:verify:full` 中通过，或只剩明确可接受的 `manual_gate`。

实现顺序：

1. 先把所有 Stage 9 gate 声明到矩阵，允许 `not_covered` 导致失败。
2. 将 Stage 1-8 已有 verify、关键 contract/integration/runtime tests、typecheck、build 和 `git diff --check` 映射到对应 gate。
3. 对 `not_covered` gate 按风险排序补自动化，优先级为账本、权限、隐私、文件访问、搜索回源、治理暂停、outbox 幂等、注销阻断。
4. 对无法自动化的 gate 明确人工证据格式，例如法务复核记录、试点管理员演练记录、真实供应商配置截图或发布审批记录。
5. 最终试点前运行 `stage9:verify:full`，并归档当次 JSON/Markdown 报告作为试点评审证据。

每个新增 Stage 9 issue 都必须说明它减少了哪些 `not_covered` gate，或把哪些 gate 从 `manual_gate` 推进到 `automated` / `rehearsed`。

第一批自动化优先补最高损害面的 gate，避免平均用力：

1. 账本与交易状态：冻结、解冻、转移、取消、申诉、交易收口和账本重算。
2. 权限、隐私、文件访问和搜索回源：未成年人数据泄露、跨社区越权、旧授权继续可读和索引绕过必须优先失败关闭。
3. 治理暂停与高风险治理复核：证明治理控制、暂停恢复和高风险操作复核能作为试点刹车。
4. outbox、worker 幂等和故障恢复：重复、乱序、租约过期、worker 崩溃和重试不能改写业务事实。

当前 `ledger-recompute-clean` 已进入 `automated`：`npm run stage9:ledger`
会为 Stage 9 ledger gate 部署本次运行专用的隔离 schema，运行
`ledger-check.service` 的 clean / mismatch / negative replay / missing account
回归、`transaction-decision.service` 的 release / transfer / dispute / admin
close 回归、`ledger-check-worker` 的周期触发与幂等 key 回归，并在 ledger
与 transaction schema 上各执行一次 `stage4:ledger-check`。这个 gate 只证明
账本重算和交易账本流的试点前自动化证据，不替代最终 `stage9:verify:full`
对 Stage 1-8 的串行复核。

当前 `file-search-notification-regression` 已进入 `automated`：
`npm run stage9:file-search-notification` 会部署本次运行专用的隔离 schema，
运行私有对象 grant 过期/篡改回归、realtime 订阅权限回归、stale search index
回源过滤与分页补偿回归、通知只读当前用户回归、worker 端 stale transaction
通知抑制回归，以及 refresh-only realtime hint 发布回归。这个 gate 证明文件、
搜索、通知和实时提示不会依赖旧索引、旧授权或旧业务状态继续放行。

当前 `privacy-content-hard-stop` 已进入 `automated`：
`npm run stage9:privacy-content` 会部署本次运行专用的隔离 schema，运行内容
安全 provider failure fail-closed、OCR/contact/QR 风险标签、SVG/格式风险拒绝、
未人工审核内容不公开、review 原图 grant 仅在 active review task 中有效，以及
人工审核完成后旧 grant 失效的回归。这个 gate 证明内容与媒体默认失败关闭。

当前 `authorization-privacy-cross-community` 已进入 `automated`：
`npm run stage9:authorization` 会部署本次运行专用的隔离 schema，运行孩子参与
能力、监护关系、社区成员资格、活动管理员社区 scope、平台管理员授权、管理员
MFA、高危操作 challenge、家长敏感操作 challenge、Bearer actor 派生，以及
Stage 6 交付点和申诉 API 的跨社区拒绝回归。这个 gate 证明主要服务端入口不会
接受客户端伪造身份、旧 scope 或跨社区管理员越权。

当前 `outbox-worker-failure-recovery` 已进入 `automated`：
`npm run stage9:outbox-worker` 会部署本次运行专用的隔离 schema，运行 outbox
到期和过期 lease 领取、通知发送失败 retry、通知处理不改业务状态、realtime
hint 失败不回滚 outbox 送达、结算 worker 幂等、交易超时 worker 幂等、
PostgreSQL 到期扫描兜底，以及通知 API 当前用户隔离回归。这个 gate 证明
outbox、worker 和通知失败不会伪造业务成功或改写交易事实。

当前 `governance-pause-and-review-recovery` 已进入 `automated`：
`npm run stage9:governance` 会部署本次运行专用的隔离 schema，运行治理控制
预览不变更业务状态、pause-bid / pause-publish / pause-settlement 创建与解除、
重复和过期控制处理、高风险治理复核路由和过期、跨社区活动管理员拒绝、风险
限制与平台复核，以及 settlement worker 在 pause-settlement 下停止结算的回归。
这个 gate 证明治理控制可以作为试点刹车，并且恢复、复核和作用域边界有自动化证据。

当前 `minimal-auction-state-machine-e2e` 已进入 `automated`：
`npm run stage9:state-machine` 会部署本次运行专用的隔离 schema，运行服务级
状态机闭环回归，覆盖内容提交和人工审核、拍卖场次创建、出价和撤回、结算
worker 成交和流拍、家长成交确认、交付确认、交易申诉、管理员裁决、超时补偿、
取消和异常路径。这个 gate 证明核心服务状态机和持久化事实闭环可重复验证；
它不是前端 UI E2E，也不替代最终试点前 `stage9:verify:full`。

当前 `runtime-rehearsal-coverage` 已进入 `rehearsed`：
`npm run stage9:runtime-rehearsal` 会准备 Docker runtime 需要的 Prisma
`debian-openssl-1.1.x` query engine，构建 API/worker，启动 PostgreSQL、
Redis、API 和 worker，运行 runtime connectivity、备份恢复、迁移回滚/重放、
key rotation 配置、日志扫描、ledger、outbox/worker、file/search/notification
和 privacy/content fail-closed 证据。2026-06-25 的工程演练记录在
`docs/STAGE9_RUNTIME_REHEARSAL_EVIDENCE_2026-06-25.md`；该 gate 只证明
仓库可执行 runtime 演练，不替代真实生产供应商后台配置复核。

当前 `grey-release-compatibility` 已进入 `rehearsed`：
`npm run stage9:grey-release` 会准备 Docker runtime 需要的 Prisma query
engine，构建 API/worker，启动 PostgreSQL、Redis、API 和 worker，先验证初始
runtime connectivity，再分别对 API 和 worker 执行 `--no-deps --force-recreate`
滚动重建，并在每一步后验证 API health、PostgreSQL、Redis 和 worker heartbeat。
最后它会运行迁移回滚/重放演练。该 gate 是本地灰度兼容 smoke，用于证明当前
workspace 的 API/worker 可以在同一 runtime 数据库和 Redis 上独立重建；它不替代
不可变 candidate image 验证、真实流量切分、真实生产回滚或供应商后台降级复核。

当前 `deletion-retention-coverage` 已进入 `automated`：
`npm run stage9:deletion-retention` 会部署本次运行专用的隔离 schema，运行孩子
注销/删除 readiness 阻断和执行回归，覆盖 active auction、active point hold、
unresolved transaction、open appeal、guardian dispute 阻断，以及通过
`ChildDataRetentionService` 对 child profile、可选 child user、微信身份、session、
trusted device、challenge、guardian link、community membership、settings、
item/content/media/search/notification/outbox/idempotency/risk/audit 记录进行关闭、
匿名化、隐藏、抑制或 redaction。这个 gate 会用真实私有对象 grant 验证删除后
旧媒体授权失效；导出文件、cache 和 backup retention 通过仓库内策略证据与审计
tombstone 覆盖，不代表已经直接操作生产备份或外部供应商后台。

真实供应商、法务复核、试点运营材料和人工培训第一版可以保留为 `manual_gate` 或 `not_covered`，但必须有后续推进到 `rehearsed` 或人工证据归档的路径。

## 5. 第一版 gate 分类

Stage 9 gate matrix 至少覆盖以下分类：

- `stage-verification`：Stage 1-8 verify 和 Stage 9 自身 verify。
- `state-machine`：最小拍卖闭环、异常路径、暂停收口和时间裁决。
- `ledger`：冻结、解冻、转移、管理员调整和账本重算。
- `concurrency`：并发出价、结算、邀请码消耗、outbox 重试和 worker lease。
- `authorization`：孩子参与能力、监护关系、管理员 scope、MFA 和敏感操作二次验证。
- `privacy-content`：内容审核、未审核文件访问、敏感字段脱敏和高风险内容收口。
- `file-search-notification`：文件授权、搜索回源、通知乱序和实时提示补偿。
- `governance`：治理控制、危险操作预览、高风险治理复核、暂停和恢复演练。
- `runtime-rehearsal`：Redis/BullMQ runtime readiness、备份恢复、迁移发布、本地灰度兼容 smoke 和恢复演练。
- `deletion-retention`：注销、删除、匿名化、导出文件过期和缓存/通知/对象存储覆盖。
- `manual-pilot`：法务、运营、真实供应商后台配置、试点社区和家长说明材料。

Stage 1-8 完成度证据拆成两个 gate：

- `stage-baseline-branches-present`：默认模式运行，检查 Stage 1-8 verify scripts、package scripts、关键文档和 ADR 是否存在，证明阶段链条具备可验证基线。
- `stage1-to-stage8-full-verification`：只在 `stage9:verify:full` 运行，串行执行 `stage1:verify` 到 `stage8:verify`，作为最终试点前 hard gate。

## 6. Gate schema

`scripts/stage9/gate-matrix.mjs` 中每个 gate 至少包含：

```js
{
  id: "ledger-recompute-clean",
  category: "ledger",
  title: "Ledger recomputation has no anomalies before pilot",
  gateType: "hard",
  maturity: "automated",
  defaultMode: "verify",
  fullMode: "verify",
  evidence: [
    {
      kind: "command",
      command: "npm run stage9:ledger",
      binary: "npm",
      args: ["run", "stage9:ledger"],
      requiredFor: ["verify", "full"]
    }
  ],
  roadmapRefs: ["docs/MVP_ROADMAP.md:474", "docs/MVP_ROADMAP.md:501"],
  manual: null
}
```

字段约束：

- `id`：稳定 ID，报告和后续 issue 必须引用它。
- `category`：必须属于第一版 gate 分类。
- `title`：人可读标题。
- `gateType`：`hard` 或 `manual`。
- `maturity`：`declared`、`mapped`、`automated`、`rehearsed` 或 `pilot_ready`。
- `defaultMode`：`skip`、`discover` 或 `verify`。
- `fullMode`：`skip`、`discover` 或 `verify`。
- `evidence`：命令、测试、文档或人工证据。
- `roadmapRefs`：指向路线图或上线前检查清单来源。
- `manual`：manual gate 的 owner、evidence 和 validity 信息；hard gate 必须为 `null`。
