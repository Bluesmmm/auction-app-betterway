# 状态机契约

本文档记录实现和测试必须遵循的核心状态机。状态机表是 TypeScript enum、数据库约束、service transition guard 和自动化测试的来源之一。

## 1. 使用规则

- 状态转换必须通过服务端显式 transition 执行，不能直接任意更新状态字段。
- 每次转换必须校验操作者、目标版本、当前状态、业务 guard 和治理开关。
- 关键转换必须在同一数据库事务中写入业务状态、审计日志、账本流水或 outbox 事件。
- 未列出的状态转换默认禁止。
- 当前状态、权限、时间、账本、审核、文件或可见性不确定时，默认失败关闭。

## 2. 状态表格式

每个状态机必须包含：

| 字段 | 含义 |
| --- | --- |
| 当前状态 | 转换前状态 |
| 下一状态 | 转换后状态 |
| 触发动作 | API、worker、管理员动作或系统任务 |
| 操作者 | 孩子、主监护人、活动管理员、平台管理员或系统 |
| Guard | 必须满足的权限、版本、时间、账本或治理条件 |
| 同事务副作用 | 必须和状态转换一起提交的业务事实 |
| 失败关闭 | Guard 不满足或结果不确定时的行为 |

## 3. 待固定状态机

第一版至少固定以下状态机：

- `auction_session.status`
- `transaction.status`
- `content_version.status`
- `moderation_task.status`
- `point_hold.status`
- `community_member.status`
- `guardian_dispute.status`

## 4. 初始状态枚举

以下枚举来自现有产品、架构和数据模型文档。最终实现前需要在本文件中逐项补齐允许转换。

### 4.1 `auction_session.status`

`auction_session.status` 只表达拍卖竞价生命周期，不表达成交后的家长确认、交付确认或争议处理。

```text
pending_start
active
pending_settlement
settled
cancelled
unsold
delisted
```

### 4.2 `transaction.status`

`transaction.status` 表达成交后的家长确认、交付确认、完成、取消和争议处理。

```text
pending_guardian_confirm
pending_delivery_confirm
completed
cancelled
disputed
platform_review
```

### 4.3 `content_version.status`

```text
pending_ai
pending_manual
approved
rejected
escalated
blocked
```

### 4.4 `moderation_task.status`

```text
pending
processing
needs_manual_review
approved
rejected
escalated
failed
```

阶段 3 审核 guard：

- `needs_manual_review -> approved` 必须由人工审核动作触发，且审核人具备目标社区 scope。
- `high` 或 `severe` 风险内容不能由活动管理员单人转换为 `approved`。
- 内容安全 API 故障、超时或结果不可解析时，不得进入 `approved`。
- 已有公开版本的内容修改后，新内容版本通过审核前不得改变 `current_public_version_id`。
- `rejected` 内容版本不得重新进入审核流；重提必须创建新的内容版本。
- 下架已公开内容后，孩子端不得继续读取该内容，相关文件旧授权必须被访问校验拒绝。
- `failed` 审核任务只能通过系统或管理员 retry 重新处理，不能由人工审核直接批准。

### 4.5 `point_hold.status`

```text
active
released
transferred
cancelled
disputed
```

### 4.6 `community_member.status`

```text
pending_guardian
pending_admin
active
removed
banned
```

### 4.7 `guardian_dispute.status`

```text
pending_platform_review
frozen
resolved
rejected
```
