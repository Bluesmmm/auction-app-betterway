# 核心数据模型

本文档描述概念数据模型。字段名称为建议命名，最终实现可按 ORM 和数据库规范调整。

## 1. 建模原则

- PostgreSQL 是唯一业务事实源。
- 积分账本不可变，余额快照可重算校验。
- 拍卖、交易、交付和申诉使用明确状态机。
- 管理员操作必须留痕。
- 儿童个人信息最小化，敏感字段分级可见。
- 关键约束尽量下沉到数据库唯一索引、外键、检查约束和事务中。
- 裁决用时间由服务端或数据库生成，客户端时间不能入库为业务裁决依据。
- 文件访问、搜索可见性、导出和日志默认脱敏并失败关闭。

## 2. 账号与身份

### 2.1 `users`

内部用户主体。一个微信身份可以是家长，也可以是孩子，但具体角色能力由 profile 和绑定关系决定。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `status` | active / restricted / closed |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

### 2.2 `wechat_identities`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 关联 users |
| `openid` | 小程序 openid，唯一 |
| `unionid` | unionid，可空 |
| `avatar_url` | 微信头像原始地址或缓存引用 |
| `nickname` | 微信昵称 |
| `last_login_at` | 最近登录时间 |

约束：

- `openid` 唯一。

### 2.3 `guardian_profiles`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 关联 users |
| `phone_hash` | 手机号哈希或加密引用 |
| `phone_last4` | 展示用后四位 |
| `consent_version` | 监护/隐私授权版本 |
| `consented_at` | 授权时间 |
| `status` | active / restricted / closed |

### 2.4 `child_profiles`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 孩子微信账号关联用户，可空 |
| `display_name` | 孩子昵称 |
| `avatar_asset_id` | 审核后的头像资源 |
| `grade_band` | 年龄段/年级 |
| `status` | pending_guardian / active / restricted / closed |
| `created_by_guardian_id` | 由家长创建时记录 |
| `created_at` | 创建时间 |

约束：

- 一个孩子微信 `user_id` 只能绑定一个 `child_profile`。

### 2.5 `guardian_child_links`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `guardian_id` | 家长 profile |
| `child_id` | 孩子 profile |
| `role` | primary / secondary |
| `status` | pending / active / revoked |
| `confirmed_at` | 确认时间 |

约束：

- 每个孩子最多 1 个 primary guardian。
- 每个孩子最多 2 个 active guardian。
- 每个家长默认最多 3 个 active child link，超过需审核流程。

### 2.6 `child_guardian_settings`

| 字段 | 说明 |
| --- | --- |
| `child_id` | 主键/外键 |
| `allow_publish` | 是否允许发布 |
| `allow_bid` | 是否允许出价 |
| `max_bid_points` | 单次最高出价 |
| `daily_bid_limit` | 每日出价次数 |
| `daily_publish_limit` | 每日发布数量 |
| `require_publish_preconfirm` | 发布前家长确认 |
| `require_each_bid_confirm` | 每次出价家长确认 |
| `allow_courier_delivery` | 是否允许快递 |
| `allow_guardian_arranged_delivery` | 是否允许家长自行约定 |
| `allow_favorite` | 是否允许收藏 |
| `notification_policy` | 通知配置 JSON |

### 2.7 `trusted_devices`

家长、管理员和机构联系人可信设备记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 用户 |
| `device_fingerprint_hash` | 设备指纹哈希 |
| `device_label` | 展示名称 |
| `trust_level` | normal / sensitive_allowed / revoked |
| `last_seen_at` | 最近使用时间 |
| `created_at` | 创建时间 |

### 2.8 `sensitive_operation_challenges`

敏感操作二次验证和冷却期。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `actor_user_id` | 操作者 |
| `operation_type` | 操作类型 |
| `target_type` | 目标类型 |
| `target_id` | 目标 ID |
| `status` | pending / passed / failed / expired / cooling_down |
| `risk_labels` | 风险标签 JSON |
| `passed_at` | 通过时间 |
| `expires_at` | 过期时间 |
| `created_at` | 创建时间 |

### 2.9 `admin_security_profiles`

管理员安全配置。

| 字段 | 说明 |
| --- | --- |
| `user_id` | 主键/外键 |
| `mfa_enabled` | 是否启用 MFA |
| `mfa_enrolled_at` | MFA 启用时间 |
| `last_mfa_at` | 最近 MFA 验证时间 |
| `risk_status` | normal / elevated / locked |
| `allowed_ip_policy` | IP 策略 JSON |

### 2.10 `guardian_disputes`

监护关系争议和冻结模式。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `child_id` | 孩子 |
| `submitted_by_guardian_id` | 提交家长 |
| `dispute_type` | guardian_change / unlink / deletion / consent / transaction |
| `status` | pending_platform_review / frozen / resolved / rejected |
| `freeze_started_at` | 冻结开始时间 |
| `resolved_at` | 解决时间 |
| `resolution` | 处理结果 |
| `created_at` | 创建时间 |

约束：

- 同一孩子最多一个未解决的 active/frozen 监护争议。
- 争议未解决时，服务层必须阻断发布、出价、成交确认、交付方式变更、导出和注销。

## 3. 社区

### 3.1 `auction_communities`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `name` | 社区名称 |
| `description` | 简介 |
| `creator_guardian_id` | 创建者/机构联系人 |
| `organization_name` | 机构/组织名称 |
| `contact_info_encrypted` | 联系方式加密存储 |
| `status` | draft / pending_review / active / suspended / closed / rejected |
| `open_start_at` | 开放开始时间 |
| `open_end_at` | 开放结束时间 |
| `default_auction_duration_minutes` | 默认拍卖时长 |
| `age_band` | 适用年龄段 |
| `region` | 活动区域 |
| `expected_member_count` | 预计参与人数 |
| `rules` | 社区规则 |
| `extra_prohibited_rules` | 加严禁售规则 |
| `created_at` | 创建时间 |

### 3.2 `community_invite_codes`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `code` | 易记邀请码，唯一 |
| `status` | active / disabled / expired |
| `max_uses` | 最大使用次数 |
| `used_count` | 已使用次数 |
| `expires_at` | 过期时间 |

约束：

- `max_uses` 为空表示不限次数；非空时必须大于 0。
- `used_count >= 0`。
- 消耗邀请码时必须在同一事务内锁定本行，并保证 `used_count < max_uses` 后才递增。

### 3.3 `community_members`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `child_id` | 孩子 |
| `status` | pending_guardian / pending_admin / active / removed / banned |
| `joined_at` | 加入时间 |

约束：

- `(community_id, child_id)` 唯一。

### 3.4 `community_admins`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `user_id` | 管理员用户 |
| `role` | creator / activity_admin |
| `status` | active / revoked |

### 3.5 `community_join_requests`

记录邀请码加入、家长确认和管理员审核。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `child_id` | 孩子 |
| `invite_code_id` | 邀请码 |
| `guardian_confirmed_at` | 家长确认时间 |
| `admin_review_status` | pending / approved / rejected |
| `admin_reviewed_by` | 审核人 |
| `admin_reviewed_at` | 审核时间 |
| `reject_reason` | 拒绝原因 |

### 3.6 `community_rule_versions`

社区规则版本，用于追溯家长看到和确认过的规则。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `version_no` | 版本号 |
| `rules_snapshot` | 规则快照 JSON |
| `change_reason` | 变更原因 |
| `created_by_user_id` | 创建人 |
| `effective_at` | 生效时间 |
| `created_at` | 创建时间 |

### 3.7 `member_risk_signals`

社区准入和成年人伪装风险信号。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `child_id` | 孩子，可空 |
| `user_id` | 用户，可空 |
| `signal_type` | adult_impersonation / abnormal_join / abnormal_browse / contact_seeking / off_hours_activity |
| `severity` | low / medium / high / severe |
| `source_type` | system / admin / appeal |
| `status` | open / reviewed / dismissed / restricted |
| `created_at` | 创建时间 |

## 4. 内容与文件

### 4.1 `media_assets`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `owner_user_id` | 上传用户 |
| `storage_bucket` | 存储桶 |
| `storage_key` | 对象 key |
| `visibility` | temp_private / formal_private / deleted |
| `mime_type` | 文件类型 |
| `size_bytes` | 大小 |
| `checksum` | 校验 |
| `ai_review_status` | pending / low / medium / high / severe / passed |
| `metadata_stripped_at` | EXIF/元数据清理时间 |
| `access_policy_version` | 文件访问策略版本 |
| `revoked_at` | 访问撤销时间，可空 |
| `created_at` | 创建时间 |

约束：

- 未审核、拒绝、下架或删除文件不得产生公开访问地址。
- `storage_key` 不得出现在通知正文、导出文件和普通日志中。

### 4.2 `items`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 所属社区 |
| `seller_child_id` | 卖家孩子 |
| `title` | 标题 |
| `category` | 基础分类 |
| `description` | 描述 |
| `condition_level` | 新旧程度 |
| `condition_note` | 自由说明 |
| `original_price_amount` | 原价金额，仅家长/管理员可见 |
| `start_points` | 起拍积分 |
| `min_increment_points` | 最小加价 |
| `status` | draft / ai_reviewing / manual_reviewing / approved / rejected / listed / withdrawn / delisted |
| `risk_level` | none / low / medium / high / severe |
| `current_public_version_id` | 当前孩子端可见的已审核内容版本 |
| `latest_version_id` | 最新提交的内容版本 |
| `created_at` | 创建时间 |

约束：

- `start_points > 0`。
- `min_increment_points > 0`。
- `original_price_amount` 可空；填写时只能供家长和管理员可见。

### 4.3 `content_version_media`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `content_version_id` | 对应内容版本 |
| `media_asset_id` | 图片或头像文件 |
| `media_role` | front / back / side / detail / avatar |
| `sort_order` | 排序 |
| `created_at` | 创建时间 |

约束：

- 第一版拍品内容版本必须正好绑定 4 张图片。
- 拍品内容版本内 front/back/side/detail 必须各 1 张。
- 同一 `media_asset_id` 只能被一个已提交内容版本消耗。
- 同一内容版本内 `sort_order` 唯一。

### 4.4 `wanted_posts`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `child_id` | 发布孩子 |
| `title` | 求购标题 |
| `description` | 求购描述 |
| `category` | 分类 |
| `status` | draft / ai_reviewing / manual_reviewing / active / closed / rejected / delisted |
| `risk_level` | 风险等级 |
| `current_public_version_id` | 当前孩子端可见的已审核内容版本 |
| `latest_version_id` | 最新提交的内容版本 |

### 4.5 `wanted_responses`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `wanted_post_id` | 求购 |
| `responder_child_id` | 响应孩子 |
| `item_id` | 转成的拍品，可空直到创建 |
| `status` | submitted / reviewing / approved / converted_to_item / rejected / cancelled |
| `current_public_version_id` | 当前已审核内容版本，可空 |
| `latest_version_id` | 最新提交的内容版本，可空 |

### 4.6 `content_versions`

拍品、求购、响应和头像的可审核版本。任何公开字段修改都创建新版本。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `target_type` | item / wanted_post / wanted_response / avatar |
| `target_id` | 目标 ID |
| `version_no` | 版本号，从 1 递增 |
| `public_payload` | 孩子端可见文本、分类和展示字段 JSON |
| `media_payload` | 图片或头像资源轻量摘要 JSON；权威绑定关系以 `content_version_media` 为准 |
| `payload_hash` | 公开字段摘要 |
| `ocr_text_ref` | OCR 结果引用 |
| `qr_detected` | 是否识别到二维码/条码 |
| `metadata_findings` | 图片元数据检查结果 JSON |
| `status` | draft / pending_ai / pending_manual / approved / rejected / hidden / superseded |
| `risk_level` | none / low / medium / high / severe |
| `created_by_user_id` | 创建人 |
| `created_at` | 创建时间 |
| `approved_at` | 审核通过时间 |

约束：

- `(target_type, target_id, version_no)` 唯一。
- 每个目标最多一个 `status = approved` 且作为 `current_public_version_id` 的公开版本。
- 审核、举报、下架和申诉记录必须引用当时的内容版本。

## 5. 审核

### 5.1 `moderation_tasks`

统一审核任务。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `target_type` | item / wanted_post / wanted_response / avatar / community |
| `target_id` | 目标 ID |
| `content_version_id` | 内容版本，可空；内容类审核必须填写 |
| `community_id` | 社区，可空 |
| `status` | pending_ai / pending_manual / approved / rejected / escalated / blocked |
| `risk_level` | none / low / medium / high / severe |
| `assigned_to` | 审核人 |
| `created_at` | 创建时间 |

### 5.2 `ai_review_results`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `task_id` | 审核任务 |
| `provider` | 第三方审核服务 |
| `risk_level` | 风险等级 |
| `labels` | 风险标签 JSON |
| `raw_result_ref` | 原始结果引用 |
| `ocr_text_ref` | OCR 结果引用 |
| `qr_labels` | 二维码/条码识别标签 JSON |
| `provider_status` | success / timeout / failed / invalid_response |
| `created_at` | 创建时间 |

### 5.3 `manual_review_records`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `task_id` | 审核任务 |
| `reviewer_user_id` | 审核人 |
| `decision` | approve / reject / escalate |
| `reason` | 原因 |
| `content_version_id` | 审核的内容版本，可空；内容类审核必须填写 |
| `created_at` | 审核时间 |

约束：

- `low` 和 `medium` 风险内容可由具备目标社区 scope 的活动管理员批准或拒绝。
- `high` 和 `severe` 风险内容不能由活动管理员单人批准；第一版未实现完整复核链路时必须拒绝、升级或保持不可公开。

### 5.4 `moderation_quality_reviews`

审核抽检和质量记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `manual_review_record_id` | 被抽检审核记录 |
| `reviewer_user_id` | 复核人 |
| `quality_result` | correct / false_approve / false_reject / missed_escalation |
| `severity` | low / medium / high / severe |
| `notes` | 说明 |
| `created_at` | 创建时间 |

## 6. 拍卖与出价

### 6.1 `auction_sessions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `item_id` | 拍品 |
| `community_id` | 社区 |
| `seller_child_id` | 卖家孩子 |
| `status` | pending_start / active / pending_settlement / pending_guardian_confirm / pending_delivery_confirm / completed / cancelled / unsold / delisted |
| `start_at` | 开始时间 |
| `end_at` | 结束时间 |
| `start_points` | 起拍积分 |
| `min_increment_points` | 最小加价 |
| `current_price_points` | 当前最高价 |
| `current_highest_bid_id` | 当前最高出价 |
| `current_highest_child_id` | 当前最高出价孩子 |
| `settled_at` | 结算时间 |
| `settlement_attempt_count` | 结算尝试次数 |
| `last_settlement_error` | 最近结算错误摘要 |
| `version` | 乐观版本，可选 |

约束：

- 同一拍品同一时间最多一个 active/pending 状态场次。
- 状态流转只能由服务层按状态机执行。
- `start_points > 0`。
- `min_increment_points > 0`。
- `current_price_points >= 0`。
- `start_at`、`end_at`、`settled_at` 只能由服务端或数据库写入。

### 6.2 `bids`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `auction_session_id` | 拍卖场次 |
| `bidder_child_id` | 出价孩子 |
| `amount_points` | 出价积分 |
| `status` | active_highest / outbid / retracted / winning / cancelled |
| `point_hold_id` | 对应冻结记录 |
| `idempotency_key` | 出价请求幂等键 |
| `server_received_at` | 服务端接收时间 |
| `created_at` | 出价时间 |
| `retract_deadline_at` | 可撤销截止时间 |

约束：

- `amount_points > 0`。
- `idempotency_key` 在出价业务范围内唯一。
- `created_at` 和 `retract_deadline_at` 由服务端或数据库计算。
- 服务层必须拒绝卖家孩子对自己的拍品出价。
- 服务层必须拒绝默认禁止的同一主监护人名下孩子互拍。

### 6.3 `bid_retractions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `bid_id` | 被撤销出价 |
| `child_id` | 孩子 |
| `reason` | 原因，可选 |
| `created_at` | 撤销时间 |

## 7. 积分账户与账本

### 7.1 `point_accounts`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `child_id` | 孩子，唯一 |
| `available_points` | 可用积分 |
| `frozen_points` | 冻结积分 |
| `total_earned_points` | 累计获得 |
| `total_spent_points` | 累计花费 |
| `total_awarded_points` | 累计奖励 |
| `total_penalty_points` | 累计扣减 |
| `total_completed_sales` | 完成销售数 |
| `total_completed_purchases` | 完成购买数 |
| `updated_at` | 更新时间 |

约束：

- `available_points >= 0`。
- `frozen_points >= 0`。
- `child_id` 唯一。

### 7.2 `point_holds`

记录当前冻结。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `account_id` | 积分账户 |
| `auction_session_id` | 拍卖场次 |
| `bid_id` | 出价 |
| `amount_points` | 冻结积分 |
| `status` | active / released / transferred / cancelled |
| `created_at` | 创建时间 |
| `released_at` | 释放时间 |

约束：

- 同一拍卖场次最多一个 active hold。

### 7.3 `point_ledger_entries`

不可变流水。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `account_id` | 积分账户 |
| `child_id` | 孩子 |
| `entry_type` | initial_grant / admin_award / admin_penalty / hold / release / transfer_out / transfer_in / correction |
| `amount_points` | 正数或负数，按类型定义 |
| `available_after` | 变更后可用积分 |
| `frozen_after` | 变更后冻结积分 |
| `related_type` | auction / transaction / admin_adjustment / appeal |
| `related_id` | 关联 ID |
| `idempotency_key` | 幂等键 |
| `reason` | 原因 |
| `created_by_user_id` | 操作者，可空表示系统 |
| `created_at` | 创建时间 |

约束：

- `idempotency_key` 在业务范围内唯一。
- 禁止 update/delete，应用层和数据库权限共同限制。

### 7.4 `point_adjustment_requests`

家长申请积分纠错或活动奖励。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `child_id` | 孩子 |
| `guardian_id` | 申请家长 |
| `request_type` | correction / activity_reward |
| `requested_points` | 申请积分 |
| `reason` | 申请原因 |
| `status` | pending / approved / rejected |
| `reviewed_by` | 审核人 |
| `reviewed_at` | 审核时间 |

## 8. 交易与交付

### 8.1 `transactions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `auction_session_id` | 拍卖场次 |
| `item_id` | 拍品 |
| `seller_child_id` | 卖家 |
| `buyer_child_id` | 买家 |
| `winning_bid_id` | 成交出价 |
| `points_amount` | 成交积分 |
| `status` | pending_guardian_confirm / pending_delivery_confirm / completed / cancelled / disputed |
| `buyer_guardian_confirmed_at` | 买方家长确认 |
| `seller_guardian_confirmed_at` | 卖方家长确认 |
| `buyer_effective_decision_id` | 买方当前有效监护人决策 |
| `seller_effective_decision_id` | 卖方当前有效监护人决策 |
| `cancel_reason` | 取消原因 |
| `version` | 乐观版本 |
| `created_at` | 创建时间 |
| `completed_at` | 完成时间 |

### 8.2 `guardian_decisions`

记录成交确认、交付确认和拒绝，不覆盖历史决策。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `transaction_id` | 交易 |
| `phase` | guardian_confirm / delivery_confirm / dispute |
| `side` | buyer / seller |
| `child_id` | 对应买方或卖方孩子 |
| `guardian_id` | 操作家长 |
| `guardian_role` | primary / secondary |
| `decision` | confirm / reject / dispute / cancel |
| `effective` | 是否为当前有效决策 |
| `transaction_version` | 决策基于的交易版本 |
| `reason` | 原因，可空 |
| `created_at` | 创建时间 |

约束：

- 同一交易、阶段、侧别最多一个 `effective = true` 决策。
- 主监护人决策优先于副监护人决策。
- 交易和交付状态只能根据有效决策流转，历史决策不可删除。

### 8.3 `delivery_records`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `transaction_id` | 交易 |
| `delivery_method` | designated_point / guardian_arranged / courier |
| `designated_point_id` | 指定交付点，可空 |
| `courier_info_ref` | 快递信息加密引用，可空 |
| `seller_confirmed_at` | 卖家家长确认交付 |
| `buyer_confirmed_at` | 买家家长确认收到 |
| `status` | pending / completed / disputed / admin_resolved |
| `deadline_at` | 交付确认截止 |

### 8.4 `delivery_points`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `community_id` | 社区 |
| `name` | 交付点名称 |
| `address_text` | 地址文本，展示给家长 |
| `available_time_text` | 可交付时间 |
| `status` | active / disabled |

## 9. 申诉、违规与限制

### 9.1 `appeals`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `target_type` | transaction / item / bid / restriction / moderation |
| `target_id` | 目标 ID |
| `submitted_by_guardian_id` | 申诉家长 |
| `community_id` | 社区 |
| `status` | pending_activity_admin / resolved / escalated_platform / platform_resolved / rejected |
| `reason` | 申诉内容 |
| `resolution` | 处理结果 |
| `created_at` | 创建时间 |

### 9.2 `violations`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `child_id` | 孩子，可空 |
| `guardian_id` | 家长，可空 |
| `community_id` | 社区，可空 |
| `violation_type` | buyer_cancel / seller_cancel / prohibited_item / privacy_leak / malicious_bid / fake_item / self_dealing / collusive_bidding / contact_evasion |
| `severity` | low / medium / high / severe |
| `source_type` | system / admin / appeal |
| `source_id` | 来源 |
| `related_transaction_id` | 关联交易，可空 |
| `created_at` | 创建时间 |

### 9.3 `restrictions`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `target_type` | child / guardian / community |
| `target_id` | 目标 |
| `restriction_type` | no_bid / no_publish / no_join / no_create_community / suspended |
| `scope` | platform / community |
| `starts_at` | 开始时间 |
| `ends_at` | 结束时间，可空 |
| `reason` | 原因 |
| `created_by_user_id` | 操作者 |
| `status` | active / lifted / expired |

### 9.4 `governance_controls`

平台、社区或分类级暂停和风控开关。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `scope_type` | platform / community / category |
| `scope_id` | 范围 ID，platform 可空 |
| `control_type` | pause_publish / pause_bid / pause_settlement / disable_courier / disable_guardian_arranged_delivery / force_platform_review |
| `status` | active / lifted / expired |
| `reason` | 原因 |
| `created_by_user_id` | 操作者 |
| `starts_at` | 生效时间 |
| `ends_at` | 结束时间，可空 |
| `created_at` | 创建时间 |

约束：

- 同一范围同一控制类型最多一个 active 记录。
- 启用和解除都必须写入审计日志。

### 9.5 `abuse_rate_limits`

投诉、收藏、浏览、出价等滥用风险计数。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `actor_user_id` | 用户 |
| `child_id` | 孩子，可空 |
| `action_type` | complaint / view / favorite / bid / join / publish |
| `scope_type` | platform / community / item |
| `scope_id` | 范围 ID |
| `window_start_at` | 窗口开始 |
| `count` | 次数 |
| `risk_score` | 风险分 |
| `status` | normal / throttled / blocked |

### 9.6 `product_safety_flags`

儿童商品安全风险标签。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `item_id` | 拍品 |
| `flag_type` | recall / battery_damage / magnet / choking_hazard / sharp_part / laser / unknown_origin |
| `severity` | low / medium / high / severe |
| `source_type` | rule / admin / appeal |
| `status` | open / cleared / delisted |
| `created_at` | 创建时间 |

## 10. 通知

### 10.1 `notifications`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `recipient_user_id` | 接收用户 |
| `recipient_child_id` | 关联孩子，可空 |
| `type` | 通知类型 |
| `title` | 标题 |
| `body` | 内容 |
| `related_type` | 关联类型 |
| `related_id` | 关联 ID |
| `event_id` | 对应 outbox 事件，可空 |
| `target_version` | 目标版本号，可空 |
| `delivery_status` | pending / sent / failed / suppressed |
| `read_at` | 阅读时间 |
| `created_at` | 创建时间 |

约束：

- 通知正文不得包含明文手机号、地址、对象 key、签名 URL、快递信息或儿童身份信息。

### 10.2 `notification_preferences`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 用户 |
| `child_id` | 孩子，可空 |
| `event_type` | 事件类型 |
| `in_app_enabled` | 站内通知 |
| `wechat_subscribe_enabled` | 微信订阅消息 |
| `child_visible` | 是否给孩子可见 |

### 10.3 `search_index_documents`

搜索索引用的非事实源文档。搜索命中后仍必须回源权限校验。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `target_type` | item / wanted_post |
| `target_id` | 目标 ID |
| `content_version_id` | 已审核内容版本 |
| `community_id` | 社区 |
| `visibility_status` | searchable / hidden / delisted |
| `search_payload` | 脱敏搜索字段 JSON |
| `indexed_at` | 索引时间 |
| `source_version` | 源业务版本 |

约束：

- 只索引已审核、可见、未下架内容。
- `search_payload` 不得包含原价、手机号、地址、对象 key、快递信息或家长身份信息。
- 搜索返回前必须按 PostgreSQL 当前状态回源校验成员、内容版本、下架、暂停和限制状态。

## 11. 审计与异步事件

### 11.1 `audit_logs`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `actor_user_id` | 操作者，可空表示系统 |
| `actor_role` | 操作者角色 |
| `action` | 操作 |
| `target_type` | 目标类型 |
| `target_id` | 目标 ID |
| `before_snapshot` | 变更前摘要 JSON |
| `after_snapshot` | 变更后摘要 JSON |
| `impact_summary` | 危险操作影响摘要 JSON |
| `redaction_status` | none / redacted / blocked |
| `reason` | 操作原因 |
| `ip_hash` | IP 哈希 |
| `created_at` | 时间 |

### 11.2 `outbox_events`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `event_type` | 事件类型 |
| `payload` | 事件内容 JSON |
| `idempotency_key` | 业务幂等键 |
| `status` | pending / processing / sent / failed |
| `retry_count` | 重试次数 |
| `available_at` | 可处理时间 |
| `locked_at` | worker 领取时间 |
| `locked_by` | worker 标识 |
| `next_retry_at` | 下次重试时间 |
| `last_error` | 最近错误摘要 |
| `created_at` | 创建时间 |

约束：

- `idempotency_key` 唯一。
- `retry_count >= 0`。
- processing 状态必须有可过期租约，租约过期后可被重新领取。

### 11.3 `idempotency_records`

记录关键写请求的幂等状态，避免弱网、重复点击和重试造成重复业务事实。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `idempotency_key` | 客户端或服务端生成的幂等键 |
| `actor_user_id` | 操作者 |
| `child_id` | 关联孩子，可空 |
| `action` | 业务动作 |
| `target_type` | 目标类型 |
| `target_id` | 目标 ID |
| `request_hash` | 请求摘要 |
| `status` | processing / succeeded / failed / unknown |
| `response_ref` | 原响应引用，可空 |
| `expires_at` | 过期时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

约束：

- `(idempotency_key, actor_user_id, action, target_type, target_id)` 唯一。
- 同一幂等键不同 `request_hash` 必须拒绝。

### 11.4 `admin_operation_previews`

危险后台操作的影响预览和二次确认记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `actor_user_id` | 管理员 |
| `operation_type` | cancel_auction / delist_item / release_points / transfer_points / pause_scope / adjust_end_time / export_data |
| `target_type` | 目标类型 |
| `target_id` | 目标 ID |
| `impact_summary` | 影响拍卖、交易、冻结积分、通知对象 JSON |
| `status` | generated / confirmed / expired / cancelled |
| `generated_at` | 生成时间 |
| `confirmed_at` | 确认时间，可空 |
| `expires_at` | 过期时间 |

约束：

- 危险操作必须引用未过期且已确认的 preview。
- preview 过期后必须重新计算影响。

### 11.5 `file_access_grants`

受控文件访问授权，用于签名 URL 或访问网关鉴权。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `media_asset_id` | 文件 |
| `grantee_user_id` | 被授权用户 |
| `purpose` | item_view / review / export / appeal |
| `status` | active / expired / revoked |
| `signed_token_hash` | 签名令牌哈希 |
| `expires_at` | 过期时间 |
| `revoked_at` | 撤销时间 |
| `created_at` | 创建时间 |

约束：

- 文件当前不可见、被下架、被删除或用户权限不匹配时，不能创建 active grant。
- grant 到期、撤销或文件策略版本变化后必须拒绝访问。

### 11.6 `security_events`

账号盗用、管理员异常、越权访问和敏感操作风险事件。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `actor_user_id` | 用户，可空 |
| `event_type` | login_risk / mfa_failed / admin_anomaly / scope_denied / session_revoked / credential_rotation |
| `severity` | low / medium / high / severe |
| `target_type` | 目标类型，可空 |
| `target_id` | 目标 ID，可空 |
| `risk_labels` | 风险标签 JSON |
| `status` | open / mitigated / dismissed |
| `created_at` | 创建时间 |

### 11.7 `release_migration_runs`

数据库迁移、灰度发布和回滚演练记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `release_version` | 发布版本 |
| `migration_name` | 迁移名称 |
| `strategy` | expand_contract / backward_compatible / blocking |
| `status` | planned / running / succeeded / failed / rolled_back |
| `compatibility_checked` | 是否完成双版本兼容检查 |
| `rollback_plan_ref` | 回滚方案引用 |
| `started_at` | 开始时间 |
| `finished_at` | 完成时间 |

### 11.8 `backup_restore_runs`

备份恢复演练和事故恢复记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `restore_type` | drill / incident |
| `backup_ref` | 备份引用 |
| `status` | planned / restoring / verifying / completed / failed |
| `ledger_diff_count` | 账本差异数 |
| `hold_diff_count` | 冻结差异数 |
| `outbox_replay_blocked_count` | 阻断重放事件数 |
| `search_rebuild_status` | 搜索重建状态 |
| `started_at` | 开始时间 |
| `completed_at` | 完成时间 |

### 11.9 `vendor_integrations`

第三方供应商和外部接口治理。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `vendor_name` | 供应商 |
| `integration_type` | content_safety / object_storage / notification / logging / analytics |
| `data_categories` | 传输数据类型 JSON |
| `pii_allowed` | 是否允许个人信息 |
| `status` | active / suspended / disabled |
| `last_reviewed_at` | 最近审查时间 |
| `credential_rotated_at` | 最近密钥轮换时间 |

约束：

- 供应商调用必须记录最小化后的数据类别。
- 未审查或 suspended 供应商不能处理儿童相关数据。

## 12. 导出与注销

### 12.1 `data_export_requests`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `requester_user_id` | 请求用户 |
| `child_id` | 孩子，可空 |
| `export_type` | child_activity / platform_audit |
| `status` | pending / processing / ready / expired / failed |
| `file_asset_id` | 导出文件 |
| `redaction_profile` | 脱敏规则 |
| `expires_at` | 导出文件过期时间 |
| `created_at` | 创建时间 |

### 12.2 `data_export_access_logs`

导出文件访问留痕。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `export_request_id` | 导出请求 |
| `actor_user_id` | 访问用户 |
| `action` | download / view / expire / revoke |
| `ip_hash` | IP 哈希 |
| `created_at` | 创建时间 |

### 12.3 `account_deletion_requests`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `child_id` | 孩子 |
| `guardian_id` | 主监护人 |
| `status` | pending / blocked_by_open_activity / blocked_by_open_transaction / completed / rejected |
| `reason` | 原因 |
| `created_at` | 创建时间 |
| `completed_at` | 完成时间 |

阻断条件：

- 存在活跃拍卖、当前最高出价、有效冻结积分、待确认交易、待交付交易、待审核内容或未结申诉时，不得完成注销。

### 12.4 `deletion_jobs`

全链路删除、匿名化和保留任务。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `child_id` | 孩子，可空 |
| `target_type` | child_profile / media / export / search_index / notification / log / backup |
| `target_id` | 目标 ID |
| `action` | delete / anonymize / retain_until_expiry |
| `status` | pending / processing / completed / failed / retained |
| `retention_reason` | 保留原因 |
| `completed_at` | 完成时间 |
| `created_at` | 创建时间 |

## 13. 关键状态枚举

### 13.1 拍卖场次状态

```text
pending_start
active
pending_settlement
pending_guardian_confirm
pending_delivery_confirm
completed
cancelled
unsold
delisted
```

### 13.2 交易状态

```text
pending_guardian_confirm
pending_delivery_confirm
completed
cancelled
disputed
```

### 13.3 审核状态

```text
pending_ai
pending_manual
approved
rejected
escalated
blocked
```

## 14. 关键索引建议

- `wechat_identities(openid)` unique。
- `guardian_child_links(child_id, role)` partial unique where active and role = primary。
- `guardian_child_links(child_id)` count guard in service for max 2 active guardians。
- `trusted_devices(user_id, device_fingerprint_hash)` unique。
- `sensitive_operation_challenges(actor_user_id, operation_type, target_type, target_id, status)`。
- `guardian_disputes(child_id)` partial unique where status in pending/frozen states。
- `community_members(community_id, child_id)` unique。
- `community_invite_codes(code)` unique。
- `community_rule_versions(community_id, version_no)` unique。
- `member_risk_signals(community_id, child_id, status)`。
- `auction_sessions(item_id)` partial unique for active/pending states。
- `auction_sessions(status, end_at)` for settlement scan。
- `bids(auction_session_id, created_at)`。
- `bids(idempotency_key)` unique。
- `content_versions(target_type, target_id, version_no)` unique。
- `moderation_tasks(content_version_id)` for content review。
- `point_accounts(child_id)` unique。
- `point_holds(auction_session_id)` partial unique where status = active。
- `point_ledger_entries(idempotency_key)` unique。
- `guardian_decisions(transaction_id, phase, side)` partial unique where effective = true。
- `governance_controls(scope_type, scope_id, control_type)` partial unique where status = active。
- `abuse_rate_limits(actor_user_id, action_type, scope_type, scope_id, window_start_at)` unique。
- `product_safety_flags(item_id, flag_type, status)`。
- `notifications(recipient_user_id, read_at, created_at)`。
- `search_index_documents(community_id, visibility_status, indexed_at)`。
- `outbox_events(status, available_at)`。
- `outbox_events(idempotency_key)` unique。
- `idempotency_records(idempotency_key, actor_user_id, action, target_type, target_id)` unique。
- `admin_operation_previews(actor_user_id, operation_type, target_type, target_id, status)`。
- `file_access_grants(media_asset_id, grantee_user_id, status, expires_at)`。
- `data_export_access_logs(export_request_id, created_at)`。
- `security_events(event_type, severity, created_at)`。
- `release_migration_runs(release_version, migration_name)`。
- `backup_restore_runs(status, started_at)`。
- `vendor_integrations(integration_type, status)`。
- `deletion_jobs(child_id, status, target_type)`。

## 15. 关键事务

### 15.1 出价

事务内锁定拍卖场次；校验规则、家长控制、暂停开关、自买自卖和同家庭互拍限制；按账户 ID 顺序锁定新旧最高出价者账户；释放旧冻结；创建新冻结；写出价、账本、审计和 outbox。

### 15.2 撤销出价

事务内锁定拍卖场次和当前最高出价；校验 1 分钟窗口和撤销次数；释放积分；回退上一有效最高价；写撤销、账本、审计和 outbox。

### 15.3 拍卖结算

事务内锁定拍卖场次；校验状态和结束时间；无有效出价置为流拍；有最高出价创建交易并进入待家长确认；写审计和 outbox。

### 15.4 双方家长确认

事务内锁定交易；追加 `guardian_decisions`；按主监护人优先规则计算有效决策；任一有效拒绝则取消并解冻；双方有效确认则进入待交付确认。

### 15.5 交付完成

事务内锁定交易、交付记录和买卖双方账户；追加交付阶段 `guardian_decisions`；双方有效确认后将冻结积分从买家转给卖家；写 transfer out/in 流水；交易置为完成。

### 15.6 管理员争议处理

事务内锁定交易和相关账户；根据处理决定退回买家、转给卖家或继续冻结；写原因、审计、流水和通知事件。

### 15.7 受控文件访问

事务内校验用户权限、文件状态、内容版本、下架/删除/注销状态和访问目的；创建短期 `file_access_grants`；访问网关按 grant、文件策略版本和过期时间拒绝旧 URL。

### 15.8 搜索回源校验

搜索索引只返回候选结果；API 在 PostgreSQL 中重新校验社区成员、内容版本、审核状态、下架状态、暂停开关和限制记录后才返回给客户端。

### 15.9 危险管理员操作

先生成 `admin_operation_previews` 并展示影响；管理员二次确认后，事务内重新计算关键影响是否仍一致，再执行下架、取消、解冻、转积分、暂停或导出。

### 15.10 账号风险冻结

当出现疑似盗号、管理员异常或监护争议时，事务内写入 `security_events` 或 `guardian_disputes`，撤销相关会话，阻断敏感操作，并根据风险范围暂停孩子、家长或管理员能力。

### 15.11 备份恢复校验

恢复后进入只读或受限模式，运行账本重算、冻结核对、交易状态扫描、outbox 去重和搜索索引重建；差异归零前不得恢复出价和结算。

### 15.12 全链路删除

注销完成后创建 `deletion_jobs`，覆盖主库、搜索索引、对象存储、导出文件、通知、缓存和备份保留策略；必要保留数据必须记录保留原因。
