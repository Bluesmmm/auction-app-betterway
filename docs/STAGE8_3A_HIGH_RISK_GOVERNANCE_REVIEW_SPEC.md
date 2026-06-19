# Stage 8 3A 高风险治理复核规格草案

## 状态

Draft

## 背景

Stage 8 第二轮已经实现治理控制的预览、创建、列表、解除、敏感操作二次验证、审计、outbox，以及发布、出价、结算和强制平台复核相关业务 guard。第三轮是一个统一设计总包，后续会分批接入 category-scoped controls、export/delete governance、provider governance 和通知扩展。

Stage 8 3A 先引入高风险治理复核底座，并只把 `pause_settlement` 的 governance control create/lift 接入这个双人复核工作流。`pause_publish`、`pause_bid`、`force_platform_review` 暂时保持第二轮的同步敏感操作路径。

本规格遵循：

- `CONTEXT.md` 中的“高风险治理复核”“治理控制”“治理控制管理”“治理控制预览”“敏感操作二次验证”术语。
- `docs/adr/0006-stage8-governance-controls.md` 的第二轮治理控制边界。
- `docs/adr/0007-stage8-high-risk-governance-review.md` 的 3A 架构决策。

## 目标

Stage 8 3A 必须完成以下闭环：

- 管理员发起 `pause_settlement` create/lift 时，不立即执行业务 mutation，而是生成 pending 高风险治理复核请求。
- 发起人和复核人都必须完成敏感操作二次验证。
- 复核人必须是另一名具备资格的 `platform_admin`。
- 复核批准后自动执行发起时冻结的 payload。
- 拒绝、撤回、过期、失效、执行失败都有明确状态、理由、审计和管理员通知。
- pending review 不阻断业务；只有 active governance control 生效后才阻断 settlement/guardian confirmation 相关路径。
- 现有低影响 governance controls 行为保持兼容。

## 非目标

3A 不实现：

- category-scoped controls 的数据模型和业务 guard。
- export/delete governance 的实际导出、删除或匿名化工作流。
- provider governance 的供应商配置变更工作流。
- 家长或孩子端通知。
- 完整治理复核 dashboard、统计报表或批量处理。
- 改变 `pause_settlement` 已有业务 guard 语义。

## 角色与权限

### 发起人

- 必须是 active `platform_admin`。
- 必须完成针对治理控制管理的敏感操作二次验证。
- 可以发起 `pause_settlement` create/lift review request。
- 可以撤回自己发起的 pending request，但必须填写撤回理由。
- 不能复核自己发起的 request。

### 复核人

- 必须是另一名 active `platform_admin`。
- 必须完成敏感操作二次验证。
- 可以批准或拒绝 pending request。
- 拒绝必须填写理由。

发起 `pause_settlement` review request 时，系统必须确认至少存在一名不同于发起人的 active `platform_admin` 可作为复核人。如果不存在，创建请求直接失败并返回 `NO_ELIGIBLE_REVIEWER`，不得创建永远无法完成的 pending request。

### 不允许的角色

- `activity_admin` 不能发起或复核 `pause_settlement` review request。
- `institution_admin` 不参与 3A 的治理复核授权边界。

## Review Request 模型语义

### Action Type

第一版只需要：

- `governance_control_create`
- `governance_control_lift`

不复用 sensitive operation type。高风险治理复核是业务审批事实，敏感操作二次验证是身份确认事实。

### Decision State

- `pending`：等待复核。
- `approved`：复核人已批准。
- `rejected`：复核人已拒绝，必须有拒绝理由。
- `expired`：超过 request 有效期，不能再复核。
- `withdrawn`：发起人撤回，必须有撤回理由。
- `invalidated`：复核时发现 request 已不可执行、关键影响面变化，或 action-specific 前置条件不再成立。

### Execution State

- `not_started`：尚未执行冻结 payload。
- `succeeded`：批准后执行业务 mutation 成功。
- `failed`：批准后执行业务 mutation 失败。

批准与执行必须分开记录。`approved + failed` 是合法终态，不能把 request 回滚成 pending。

3A 第一版的 `pause_settlement` create/lift 属于数据库内治理控制 mutation。对这类 action，approve 决策、lifecycle event、业务 mutation、execution state 和 outbox 写入必须在同一个数据库事务中提交。系统不得持久暴露 `approved + not_started`。`approved + failed` 只用于 execution adapter 明确记录“未产生部分业务 mutation 的执行失败”；基础设施错误必须回滚事务或由幂等恢复路径处理。

### Lifecycle Event Log

Review request 必须有单独 lifecycle event log，不能只依赖当前状态或通用 audit log。

第一版 event type 至少包括：

- `created`
- `approved`
- `rejected`
- `withdrawn`
- `expired`
- `invalidated`
- `execution_succeeded`
- `execution_failed`

每个 event 至少记录 actor、server time、reason、error code、前后状态、target 和 payload/evidence 摘要。Event log 用于 admin UI 时间线、审计、通知重放和执行失败诊断。

### 有效期

- Review request 默认 30 分钟有效。
- 到期后变为 `expired`。
- `rejected`、`expired`、`withdrawn`、`invalidated`、`execution_failed` request 不可复用。
- 重新尝试必须生成新的 preview/evidence 和新的 review request。

过期推进采用双路径：

- Worker 定时扫描过期 pending request，写入 `expired` event，并触发发起人结果通知。
- API list/detail/approve 入口执行 lazy expiry，防止 worker 延迟时仍允许 stale approval。
- 两条路径都必须使用原子状态转换，避免重复写入 expiry event 或重复通知。

## Evidence 与 Payload

### 不可变 Payload

发起 review request 时必须冻结完整 payload，包括：

- action type。
- scope type / scope id。
- control type。
- create 所需 preview id。
- lift 所需 control id。
- reason。
- endsAt。
- 发起人 user id、session id、challenge id 或 challenge evidence 引用。
- 发起时的 impact summary 或 stale-check evidence。

复核人批准的是这份冻结 payload。批准后系统自动执行该 payload，不允许使用复核时的表单值替换。

### Preview Locking

`pause_settlement` create 发起 pending review 时必须锁定对应 governance control preview。

- 发起时必须把 preview 中的 impact summary 和 stale-check evidence 复制进 review request。
- 同一个 preview 不能发起多个 review request。
- review request 创建后，原 preview 的 TTL 不再决定 approve 是否有效；review request 自己的 `expiresAt` 才是复核窗口。
- Review request 失败、拒绝、过期、撤回或失效后，preview 不能复用。
- 重新发起必须重新生成 preview。

### Stale Check

复核执行前必须重新校验 action-specific 关键影响面。

第一版 governance control stale check 至少覆盖：

- review request 未过期。
- source preview 已在创建 request 时被锁定/消费，且没有被其他 request/control 重复消费。
- scope type、scope id、control type 与冻结 payload 一致。
- 发起时和复核时的关键 impact summary 未发生不允许的变化。
- create 执行前同 scope + control type 不存在 active control。
- create 执行前同 scope + control type 不存在当前 request 之外的其他 pending review。
- lift 执行前目标 control 仍存在且仍可解除。

如果 stale check 失败，request 进入 `invalidated`，不执行业务 mutation。

## API 行为

### Routing Flag

3A 必须提供运行时 routing flag，用于控制 `pause_settlement` create/lift 是否进入高风险治理复核。

- 同一 idempotency key 已经创建过 review request 时，必须先返回已有 request 状态，再评估当前 routing flag。
- 开启时：`pause_settlement` create/lift 返回 `pending_review`。
- 关闭时：`pause_settlement` create/lift 回到 Stage 8 第二轮同步行为。
- 测试和 CI 验证环境默认开启。
- 生产环境默认关闭，必须显式配置开启。
- 关闭时不得自动执行已有 pending review。
- 关闭时未执行的 pending review 必须标记为 `invalidated`，并保留审计与通知记录。

### Governance Control Create

现有治理控制创建 API 继续作为意图入口。

- 对 `pause_publish`、`pause_bid`、`force_platform_review`：保持第二轮同步行为。
- 对 `pause_settlement`：返回 `pending_review`，不立即创建 `GovernanceControl`。

`pending_review` 响应至少包含：

- `result: "pending_review"`
- `reviewRequestId`
- `reviewStatus`
- `executionStatus`
- `expiresAt`
- `actionType`
- `targetType`
- `targetId`

### Governance Control Lift

现有治理控制解除 API 继续作为意图入口。

- 对低影响 control type：保持第二轮同步行为。
- 对 `pause_settlement`：返回 `pending_review`，不立即 lift control。

### Review Request APIs

3A 需要最小 API：

- list pending review requests。
- get review request detail。
- approve review request。
- reject review request with reason。
- withdraw review request with reason。

创建 review request 必须支持 idempotency key。同一个发起人、action、target、冻结 payload 和 idempotency key 的重试必须返回同一个 request，不能创建重复 request，也不能把成功创建后的重试表现为 duplicate-pending 失败。

如果请求第一次在 flag 开启时创建了 pending review，而客户端响应丢失，之后同一 idempotency key 在 flag 关闭后重试，API 必须返回已有 review request 的当前状态，不能改走同步 mutation。

Approve 操作也必须支持幂等重试。同一个复核人对同一个 request 的 approve 重试，必须返回已有 approval 和 execution result，不能重复执行业务 mutation。

两个合格复核人并发 approve 同一个 request 时采用先到先赢。只有第一个以原子状态转换把 request 从 `pending` 移出的复核人能记录 approval 并触发 execution；后续 approve 只能读取已处理状态，不能再次执行 frozen payload。

所有从 `pending` 进入终态的转换都采用同一条 first-writer-wins 规则，包括 approve、reject、withdraw、expiry 和 invalidation。后到的终态操作只能返回当前状态，不得重复写 event、通知或执行业务 mutation。

Approve 成功后自动执行冻结 payload，并返回 execution result。

## 管理后台

3A 需要 minimal admin UI，不做完整 dashboard。

必须支持：

- 待复核列表。
- 复核详情页或详情面板。
- 状态标签：decision state + execution state。
- 批准。
- 拒绝并填写理由。
- 发起人撤回并填写理由。
- 显示冻结 payload、影响摘要、过期时间、发起人、复核人和执行结果。

治理控制 tab 在 `pause_settlement` create/lift 后应能展示 pending review 结果，并引导管理员进入复核视图。

## 通知矩阵

3A 第一版只覆盖管理员通知：

- 发起后通知有资格复核的 `platform_admin`，但不通知发起人本人作为复核待办。
- 批准、拒绝、过期、失效、撤回、执行失败后通知发起人。
- 不通知家长。
- 不通知孩子。

通知不是业务事实源。管理员进入复核详情时必须读取服务端最新状态。

通知发送失败不影响 review request 状态或 execution result。通知失败必须记录 delivery failure 并允许通知基础设施重试，但不能阻止 request 创建、批准、拒绝、撤回、过期、失效或执行结果落库。

## 审计与 Outbox

必须记录：

- review request created。
- review approved。
- review rejected。
- review withdrawn。
- review expired。
- review invalidated。
- execution succeeded。
- execution failed。

发起、复核、撤回、执行都必须可追踪 actor、reason、target、payload/evidence 摘要和 server time。

需要为 review lifecycle 产生 outbox event，以支持管理员通知和后续观测。

## 兼容性要求

3A 不能破坏第二轮行为：

- `pause_publish` create/lift 仍可同步完成。
- `pause_bid` create/lift 仍可同步完成。
- `force_platform_review` create/lift 仍可同步完成。
- 现有 publish/bid/settlement/platform-review guards 语义不变。
- `pause_settlement` guard 生效范围不变，只改变 create/lift 的审批路径。
- Stage 8 admin shell 和 command catalog 必须能表达 pending review 结果。

## 验收标准

3A 不算完成，除非以下全部通过：

- Contract tests：API result union 支持 `pending_review`，review request approve/reject/withdraw 的输入输出稳定，并暴露 lifecycle event log。
- Integration tests：`pause_settlement` create review、idempotent create retry、approve execution、idempotent approve retry、concurrent approve first-writer-wins、reject、withdraw、expiry、stale invalidation、execution failure、source preview TTL 到期但 review request 未到期时仍可按 stale check approve。
- State-race tests：approve/reject/withdraw/expiry/invalidation 并发时只有一个 pending 终态成功，不重复 event、通知或 execution。
- Authorization tests：两个不同 `platform_admin`，禁止自复核，禁止 `activity_admin` 和 `institution_admin`，无其他 eligible reviewer 时返回 `NO_ELIGIBLE_REVIEWER`。
- Transaction tests：3A 数据库内 execution 不持久暴露 `approved + not_started`，事务失败不产生半截状态或部分业务 mutation。
- Notification tests：eligible reviewer 待办、initiator result notification、不通知 parent/child。
- Worker tests：过期 pending request 会被 worker 标记为 `expired`，API lazy expiry 与 worker 并发时不会重复 event/notification。
- Compatibility tests：低影响 governance controls 仍同步 create/lift，flag off 后同 idempotency key 重试已有 request 不改走同步 mutation。
- Guard regression tests：`pause_settlement` 生效后的业务阻断语义不变。
- Runtime shell tests：admin UI 暴露 review list/detail/action controls。
- `npm run stage8:verify` 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。

## 回滚策略

3A 应允许通过禁用 high-risk governance review routing 回退到 Stage 8 第二轮同步行为；但 `pause_settlement` 一旦切换到 review 模式，回滚时必须明确 pending review 的处理策略。

推荐回滚策略：

- 未执行的 pending review 标记为 `invalidated`。
- 已执行成功的 governance control 不自动撤销。
- 保留全部审计与通知记录。

## 后续子阶段

3A 之后的候选子阶段：

- 3B：category-scoped governance controls。
- 3C：export/delete governance。
- 3D：provider governance。
- 3E：家长/孩子分层通知与申诉入口。
