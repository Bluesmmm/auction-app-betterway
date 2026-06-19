# Stage 8 3A 实施任务拆分草案

## 目标

把 `docs/STAGE8_3A_HIGH_RISK_GOVERNANCE_REVIEW_SPEC.md` 和 `docs/adr/0007-stage8-high-risk-governance-review.md` 拆成可独立实现、验证和 review 的任务。任务按依赖顺序排列，前置任务未完成时不应跳到后置 UI 或通知层。

## Issue 1: Review Request Schema 与迁移

目标：

- 增加高风险治理复核 request 表。
- 增加 lifecycle event log 表。
- 增加 preview/evidence locking 所需唯一约束。
- 支持把 source preview evidence 复制进 review request。
- 增加 idempotency key 约束。
- 增加 pending duplicate 防护所需索引。

验收：

- Prisma schema 和 migration contract tests 覆盖 decision state、execution state、action type、event type。
- 支持同 action/target/payload/idempotency key 的幂等查询。
- 支持同 scope/control type 的 pending duplicate 查找。
- review request 创建后由 request `expiresAt` 控制有效期，不依赖 source preview TTL。
- `npm run db:validate` 通过。

## Issue 2: HighRiskGovernanceReviewService 状态机

目标：

- 实现 create review request。
- 实现 approve/reject/withdraw。
- 实现 expired/invalidated/execution_failed 状态落库。
- 实现 event log 写入。
- 实现 create 和 approve 幂等。
- 实现 approve/reject/withdraw/expiry/invalidation 终态转换 first-writer-wins。
- approve 决策、event、execution state、outbox 与 3A 数据库内业务 mutation 在同一事务中提交。

验收：

- Unit/contract tests 覆盖所有 decision state 和 execution state。
- 禁止自复核。
- 无其他 eligible `platform_admin` 时 create 返回 `NO_ELIGIBLE_REVIEWER`。
- 拒绝和撤回必须有 reason。
- 重试 create/approve 返回同一 request/result。
- 并发 approve 只触发一次 execution。
- approve/reject/withdraw/expiry/invalidation 并发时只产生一个终态 event 和一组通知。
- 3A `pause_settlement` 路径不持久暴露 `approved + not_started`。

## Issue 3: `pause_settlement` Governance Control Execution Adapter

目标：

- 把 `governance_control_create` 和 `governance_control_lift` 封装为 frozen payload execution adapter。
- 对 `pause_settlement` create/lift 执行 stale check。
- create review 时锁定 preview，并把 preview evidence 复制进 review request。
- approve execution 时自动创建或解除 governance control。

验收：

- `pause_settlement` create review approve 后创建 active control。
- `pause_settlement` lift review approve 后解除 active control。
- preview 被 pending review 锁定，不能复用。
- source preview TTL 到期后，只要 review request 未过期且 stale check 通过，approve 仍按 request 有效期执行。
- active control 已存在时 request invalidated。
- target control 不可解除时 request invalidated。
- execution failure 记录 `approved + failed`，request 不回到 pending。
- approve execution 不产生部分业务 mutation；事务失败时不落半截状态。

## Issue 4: Routing Flag 与兼容路径

目标：

- 增加运行时 routing flag。
- 测试和 CI 默认开启。
- 生产默认关闭，必须显式配置开启。
- flag 关闭时回到 Stage 8 第二轮同步路径。
- flag 关闭时未执行 pending review 标记为 invalidated。
- review request idempotency lookup 必须先于 routing flag 判断。

验收：

- flag on：`pause_settlement` create/lift 返回 `pending_review`。
- flag off：`pause_settlement` create/lift 同步执行。
- flag on 创建 pending 后，同 idempotency key 在 flag off 下重试仍返回已有 request 状态。
- 低影响 controls 不受 flag 影响，仍同步执行。
- pending review 不阻断业务 guard。

## Issue 5: Stage8 Controller 与 API Contract

目标：

- 扩展 governance control mutation result union，增加 `pending_review`。
- 新增 review request list/detail/approve/reject/withdraw endpoints。
- API 使用服务端 actor/session，不接受客户端 actor id。
- 返回 frozen payload、状态、执行结果和 event log。
- 暴露 `NO_ELIGIBLE_REVIEWER`、self-review、terminal-state race 等稳定错误/状态响应。

验收：

- Contract tests 覆盖 `pending_review` 响应。
- approve/reject/withdraw 输入输出稳定。
- list/detail 不泄露非授权 request。
- 错误码覆盖 self-review、role forbidden、no eligible reviewer、expired、invalidated、execution failed。

## Issue 6: Expiry Worker 与 API Lazy Expiry

目标：

- 增加 worker 定时处理过期 pending request。
- list/detail/approve 入口执行 lazy expiry。
- 两条路径都使用原子状态转换。
- 过期 event 和通知只生成一次。
- expiry 与 approve/reject/withdraw/invalidation 并发时遵循 pending 终态 first-writer-wins。

验收：

- Worker 能把过期 pending request 标记为 expired。
- API lazy expiry 能阻止 stale approval。
- Worker 与 API 并发时不产生重复 event/notification。
- Expiry 与其他终态操作并发时只保留第一个成功终态。

## Issue 7: Administrator Notification Loop

目标：

- 发起后通知 eligible platform_admin reviewers，不通知发起人作为 reviewer。
- approval/rejection/withdrawal/expiry/invalidation/execution failure 后通知 initiator。
- 通知失败不影响 review request 状态。

验收：

- Notification tests 覆盖 reviewer 待办。
- Initiator result notification 覆盖所有终态。
- 不通知 parent/child。
- 通知 delivery failure 可记录且不回滚 request 状态。

## Issue 8: Admin Minimal UI

目标：

- Stage8 admin UI 增加 review request list/detail。
- 支持 approve、reject with reason、withdraw with reason。
- Governance controls tab 展示 `pause_settlement` pending review result。
- 显示 decision state、execution state、event log、frozen payload、expiresAt、initiator、reviewer 和 execution error。

验收：

- Runtime shell tests 覆盖 review list/detail/action controls。
- Admin build 通过。
- 低影响 governance control UI 仍可同步 create/lift。

## Issue 9: Stage8 Verification Script

目标：

- 更新 `npm run stage8:verify` 覆盖 3A contract、integration、worker、runtime shell、typecheck、build、diff check。

验收：

- `npm run stage8:verify` 通过。
- 测试总量覆盖 3A spec 中列出的全部验收类别。

## 推荐实现顺序

1. Issue 1: schema/migration。
2. Issue 2: review state machine。
3. Issue 3: governance control execution adapter。
4. Issue 4: routing flag and compatibility。
5. Issue 5: controller/API contracts。
6. Issue 6: expiry worker/lazy expiry。
7. Issue 7: notifications。
8. Issue 8: admin UI。
9. Issue 9: verification script。

## 暂不进入 3A 的后续任务

- Category-scoped governance controls。
- Export/delete governance adapters。
- Provider governance adapters。
- Parent/child notification matrix。
- Full governance review dashboard。
