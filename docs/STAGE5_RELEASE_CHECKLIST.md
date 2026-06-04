# Stage 5 Release Checklist

本文档用于 Stage 5 合并或交接前的工程验收。Stage 5 的目标是让积分拍卖核心链路具备可验证的业务事实、账本一致性、超时收口和运营可见性。

## 已实现范围

- 拍卖场次创建、出价、最高价冻结、被超越解冻、1 分钟内当前最高出价撤销。
- 拍卖结算后创建 `transactions`，成交积分继续冻结，不立即转给卖家。
- 买卖双方主监护人成交确认：双方确认后进入交付确认；任一拒绝或成交确认超时则取消并释放买家冻结。
- 交付确认：双方确认后买家冻结积分转给卖家；任一拒绝进入 `disputed` 并继续冻结。
- 交付超时进入 `platform_review`，冻结保持 active，等待管理员裁决。
- 管理员争议裁决：`release_to_buyer`、`transfer_to_seller`、`keep_frozen_for_platform_review`。
- outbox 派发、拍卖结算 worker、交易超时 worker。
- 平台管理员积分运营大屏：账户、冻结、交易复核队列、outbox 异常、最近账本流水和最近 ledger check。

## 发布门禁

必须通过：

```bash
npm run stage5:verify
```

该命令会执行：

- 启动 runtime PostgreSQL / Redis。
- 生成并校验 Prisma schema。
- 部署 Stage 5 验证 schema：`stage5_verify_api`、`stage5_verify_points`、`stage5_verify_bidding`、`stage5_verify_worker`。
- 运行 Stage 5 schema、controller、service、bidding、worker 和后台 shell 测试。
- 在专用 `stage5_verify_points` schema 上运行 `npm run stage4:ledger-check`，要求 `ledgerDiffCount = 0`、`negativeReplayCount = 0`、`orphanLedgerCount = 0`。
- 运行 `npm run typecheck` 和 `npm run build`。

提交前还必须运行：

```bash
git diff --check
git diff --cached --check
```

## 非门禁说明

- 不要把混合 integration schema 上的手动 ledger check 当成 Stage 5 门禁。`stage5_verify_api` 会同时运行多个业务 fixture，部分 fixture 为验证服务边界会直接构造状态，不适合作为全局账本重放样本。
- 账本门禁以 `stage5_verify_points` 为准；该 schema 专门承载积分账本和 dashboard fixture。
- 运营大屏是只读快照，不是裁决入口；任何积分、冻结或交易变化仍必须通过幂等业务命令完成。

## 上线前仍需确认

- 法务和儿童信息保护条款尚未由法律顾问复核。
- 真实微信通知、对象存储、内容安全供应商和运维告警接入不属于 Stage 5 已完成范围。
- 管理员高危操作的双人复核和回滚预览仍按后续阶段推进。
