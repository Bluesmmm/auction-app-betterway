import { useMutation, useQuery } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Descriptions,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableProps
} from "antd";
import { RefreshCw, ShieldAlert } from "lucide-react";
import {
  createAdminOperationPreview,
  createGovernanceControl,
  createGovernanceControlPreview,
  getGovernanceOverview,
  getHighRiskGovernanceReviewDetail,
  approveHighRiskGovernanceReview,
  liftGovernanceControl,
  listHighRiskGovernanceReviews,
  rejectHighRiskGovernanceReview,
  withdrawHighRiskGovernanceReview,
  listGovernanceControls,
  type AdminOperationPreviewResult,
  type GovernanceControlMutationResult,
  type GovernanceControlPreviewResult,
  type GovernanceControlsResult,
  type GovernanceOverviewResult,
  type HighRiskGovernanceReviewDetailResult,
  type HighRiskGovernanceReviewListResult,
  type HighRiskGovernanceReviewTransitionResult
} from "./stage8-api.js";
import {
  createSensitiveOperationChallenge,
  verifySensitiveOperationChallenge,
  type CreateSensitiveOperationChallengeResult,
  type VerifySensitiveOperationChallengeResult
} from "./stage2-api.js";

type Stage8GovernanceForm = {
  accessToken: string;
  communityId: string;
  operation: string;
  targetType: string;
  targetId: string;
  reason: string;
  governanceScopeType: string;
  governanceScopeId: string;
  governanceControlType: string;
  governanceReason: string;
  governancePreviewId: string;
  governanceChallengeId: string;
  governanceVerificationCode: string;
  governanceIdempotencyKey: string;
  governanceEndsAt: string;
  liftControlId: string;
  liftReason: string;
  liftChallengeId: string;
  liftVerificationCode: string;
  liftIdempotencyKey: string;
  reviewDecisionState: string;
  reviewRequestId: string;
  reviewChallengeId: string;
  reviewVerificationCode: string;
  reviewRejectReason: string;
  reviewWithdrawReason: string;
};

type AuditLogRow = Extract<
  GovernanceOverviewResult,
  { result: "accepted" }
>["recentAuditLogs"][number];
type AcceptedGovernanceOverview = Extract<
  GovernanceOverviewResult,
  { result: "accepted" }
>;
type RejectedGovernanceOverview = Extract<
  GovernanceOverviewResult,
  { result: "rejected" }
>;
type GovernanceControlRow = Extract<
  GovernanceControlsResult,
  { result: "accepted" }
>["controls"][number];
type HighRiskGovernanceReviewRow = Extract<
  HighRiskGovernanceReviewListResult,
  { result: "accepted" }
>["reviews"][number];
type HighRiskGovernanceReviewEventRow = Extract<
  HighRiskGovernanceReviewDetailResult,
  { result: "accepted" }
>["events"][number];

export function Stage8GovernanceView({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [form] = Form.useForm<Stage8GovernanceForm>();
  const { message } = AntApp.useApp();
  const accessToken = Form.useWatch("accessToken", form) ?? "";
  const communityId = Form.useWatch("communityId", form) ?? "";
  const reviewDecisionState = Form.useWatch("reviewDecisionState", form) ?? "pending";
  const reviewRequestId = Form.useWatch("reviewRequestId", form) ?? "";

  const overview = useQuery({
    queryKey: ["stage8-governance-overview", apiBaseUrl, accessToken, communityId],
    queryFn: () =>
      getGovernanceOverview(apiBaseUrl, {
        accessToken,
        communityId: communityId || undefined
      }),
    enabled: Boolean(accessToken),
    retry: false
  });
  const previewMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      createAdminOperationPreview(apiBaseUrl, {
        accessToken: values.accessToken,
        operation: values.operation,
        targetType: values.targetType,
        targetId: values.targetId,
        communityId: values.communityId || undefined,
        reason: values.reason || undefined
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.previewId : payload.errorCode
      );
      void overview.refetch();
    }
  });
  const controls = useQuery({
    queryKey: ["stage8-governance-controls", apiBaseUrl, accessToken, communityId],
    queryFn: () =>
      listGovernanceControls(apiBaseUrl, {
        accessToken,
        communityId: communityId || undefined
      }),
    enabled: Boolean(accessToken),
    retry: false
  });
  const reviews = useQuery({
    queryKey: [
      "stage8-high-risk-governance-reviews",
      apiBaseUrl,
      accessToken,
      reviewDecisionState
    ],
    queryFn: () =>
      listHighRiskGovernanceReviews(apiBaseUrl, {
        accessToken,
        decisionState: reviewDecisionState || undefined
      }),
    enabled: Boolean(accessToken),
    retry: false
  });
  const reviewDetail = useQuery({
    queryKey: [
      "stage8-high-risk-governance-review-detail",
      apiBaseUrl,
      accessToken,
      reviewRequestId
    ],
    queryFn: () =>
      getHighRiskGovernanceReviewDetail(apiBaseUrl, {
        accessToken,
        reviewRequestId
      }),
    enabled: Boolean(accessToken && reviewRequestId),
    retry: false
  });
  const controlPreviewMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      createGovernanceControlPreview(apiBaseUrl, {
        accessToken: values.accessToken,
        scopeType: values.governanceScopeType,
        scopeId: values.governanceScopeId || undefined,
        controlType: values.governanceControlType,
        reason: values.governanceReason || undefined
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.previewId : payload.errorCode
      );
      if (payload.result === "accepted") {
        form.setFieldValue("governancePreviewId", payload.previewId);
      }
    }
  });
  const controlChallengeMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      createSensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        operationType: "manage_governance_control",
        targetType: "governance_control_scope",
        targetId: governanceControlChallengeTargetId({
          scopeType: values.governanceScopeType,
          scopeId: values.governanceScopeId
        })
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.challengeId : payload.errorCode
      );
      if (payload.result === "accepted") {
        form.setFieldValue("governanceChallengeId", payload.challengeId);
      }
    }
  });
  const controlChallengeVerifyMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      verifySensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        challengeId: values.governanceChallengeId,
        verificationCode: values.governanceVerificationCode
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.challengeId : payload.errorCode
      );
    }
  });
  const controlCreateMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      createGovernanceControl(apiBaseUrl, {
        accessToken: values.accessToken,
        scopeType: values.governanceScopeType,
        scopeId: values.governanceScopeId || undefined,
        controlType: values.governanceControlType,
        previewId: values.governancePreviewId,
        sensitiveChallengeId: values.governanceChallengeId,
        idempotencyKey: values.governanceIdempotencyKey || undefined,
        reason: values.governanceReason || undefined,
        endsAt: values.governanceEndsAt || undefined
      }),
    onSuccess: (payload) => {
      void message.success(governanceControlMutationMessage(payload));
      if (payload.result === "pending_review") {
        form.setFieldValue("reviewRequestId", payload.reviewRequestId);
        form.setFieldValue("reviewDecisionState", "pending");
        void reviews.refetch();
      }
      void controls.refetch();
      void overview.refetch();
    }
  });
  const liftChallengeMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      createSensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        operationType: "manage_governance_control",
        targetType: "governance_control_scope",
        targetId: governanceControlChallengeTargetId({
          scopeType: values.governanceScopeType,
          scopeId: values.governanceScopeId
        })
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.challengeId : payload.errorCode
      );
      if (payload.result === "accepted") {
        form.setFieldValue("liftChallengeId", payload.challengeId);
      }
    }
  });
  const liftChallengeVerifyMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      verifySensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        challengeId: values.liftChallengeId,
        verificationCode: values.liftVerificationCode
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.challengeId : payload.errorCode
      );
    }
  });
  const controlLiftMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      liftGovernanceControl(apiBaseUrl, {
        accessToken: values.accessToken,
        controlId: values.liftControlId,
        sensitiveChallengeId: values.liftChallengeId,
        idempotencyKey: values.liftIdempotencyKey || undefined,
        reason: values.liftReason || undefined
      }),
    onSuccess: (payload) => {
      void message.success(governanceControlMutationMessage(payload));
      if (payload.result === "pending_review") {
        form.setFieldValue("reviewRequestId", payload.reviewRequestId);
        form.setFieldValue("reviewDecisionState", "pending");
        void reviews.refetch();
      }
      void controls.refetch();
      void overview.refetch();
    }
  });
  const reviewChallengeMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      createSensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        operationType: "manage_governance_control",
        targetType: "governance_control_scope",
        targetId: governanceControlChallengeTargetId(reviewChallengeScope(values, reviewDetail.data))
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.challengeId : payload.errorCode
      );
      if (payload.result === "accepted") {
        form.setFieldValue("reviewChallengeId", payload.challengeId);
      }
    }
  });
  const reviewChallengeVerifyMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      verifySensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        challengeId: values.reviewChallengeId,
        verificationCode: values.reviewVerificationCode
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.challengeId : payload.errorCode
      );
    }
  });
  const reviewApproveMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      approveHighRiskGovernanceReview(apiBaseUrl, {
        accessToken: values.accessToken,
        reviewRequestId: values.reviewRequestId,
        sensitiveChallengeId: values.reviewChallengeId
      }),
    onSuccess: (payload) => {
      void message.success(highRiskReviewTransitionMessage(payload));
      void reviews.refetch();
      void reviewDetail.refetch();
      void controls.refetch();
      void overview.refetch();
    }
  });
  const reviewRejectMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      rejectHighRiskGovernanceReview(apiBaseUrl, {
        accessToken: values.accessToken,
        reviewRequestId: values.reviewRequestId,
        sensitiveChallengeId: values.reviewChallengeId,
        reason: values.reviewRejectReason
      }),
    onSuccess: (payload) => {
      void message.success(highRiskReviewTransitionMessage(payload));
      void reviews.refetch();
      void reviewDetail.refetch();
    }
  });
  const reviewWithdrawMutation = useMutation({
    mutationFn: (values: Stage8GovernanceForm) =>
      withdrawHighRiskGovernanceReview(apiBaseUrl, {
        accessToken: values.accessToken,
        reviewRequestId: values.reviewRequestId,
        reason: values.reviewWithdrawReason
      }),
    onSuccess: (payload) => {
      void message.success(highRiskReviewTransitionMessage(payload));
      void reviews.refetch();
      void reviewDetail.refetch();
    }
  });

  const accepted = isAcceptedGovernanceOverview(overview.data)
    ? overview.data
    : null;
  const rejected = isRejectedGovernanceOverview(overview.data)
    ? overview.data
    : null;

  return (
    <section className="workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Stage 8 Governance</Typography.Title>
          <Typography.Text type="secondary">
            Governance queues, pilot metrics, and high-risk operation previews
          </Typography.Text>
        </div>
        <Button
          icon={<RefreshCw size={16} aria-hidden="true" />}
          onClick={() => void overview.refetch()}
          disabled={!accessToken}
        >
          Refresh
        </Button>
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          operation: "force_delist",
          targetType: "item",
          governanceScopeType: "community",
          governanceControlType: "pause_publish",
          reviewDecisionState: "pending"
        }}
      >
        <Space wrap>
          <Form.Item label="Access Token" name="accessToken">
            <Input.Password
              placeholder="Bearer token value"
              style={{ width: 260 }}
            />
          </Form.Item>
          <Form.Item label="Community" name="communityId">
            <Input placeholder="optional community id" style={{ width: 220 }} />
          </Form.Item>
        </Space>
        {rejected ? (
          <Tag color="red">{rejected.errorCode}</Tag>
        ) : overview.isError ? (
          <Tag color="red">{overview.error.message}</Tag>
        ) : null}
        <Tabs
          items={[
            {
              key: "queues",
              label: "Queues",
              children: <QueueSummary overview={accepted} />
            },
            {
              key: "system",
              label: "System",
              children: <SystemSummary overview={accepted} />
            },
            {
              key: "metrics",
              label: "Pilot Metrics",
              children: <PilotMetrics overview={accepted} />
            },
            {
              key: "preview",
              label: "Operation Preview",
              children: (
                <OperationPreview
                  mutationResult={previewMutation.data}
                  isPending={previewMutation.isPending}
                  onSubmit={() => previewMutation.mutate(form.getFieldsValue())}
                />
              )
            },
            {
              key: "controls",
              label: "Governance Controls",
              children: (
                <GovernanceControls
                  controlsResult={controls.data}
                  previewResult={controlPreviewMutation.data}
                  controlChallengeResult={controlChallengeMutation.data}
                  controlChallengeVerifyResult={controlChallengeVerifyMutation.data}
                  createResult={controlCreateMutation.data}
                  liftChallengeResult={liftChallengeMutation.data}
                  liftChallengeVerifyResult={liftChallengeVerifyMutation.data}
                  liftResult={controlLiftMutation.data}
                  onLoadReview={(reviewRequestId) => {
                    form.setFieldValue("reviewRequestId", reviewRequestId);
                  }}
                  isPreviewPending={controlPreviewMutation.isPending}
                  isChallengePending={controlChallengeMutation.isPending}
                  isVerifyPending={controlChallengeVerifyMutation.isPending}
                  isCreatePending={controlCreateMutation.isPending}
                  isLiftChallengePending={liftChallengeMutation.isPending}
                  isLiftVerifyPending={liftChallengeVerifyMutation.isPending}
                  isLiftPending={controlLiftMutation.isPending}
                  onPreview={() =>
                    controlPreviewMutation.mutate(form.getFieldsValue())
                  }
                  onChallenge={() =>
                    controlChallengeMutation.mutate(form.getFieldsValue())
                  }
                  onVerifyChallenge={() =>
                    controlChallengeVerifyMutation.mutate(form.getFieldsValue())
                  }
                  onCreate={() =>
                    controlCreateMutation.mutate(form.getFieldsValue())
                  }
                  onLiftChallenge={() =>
                    liftChallengeMutation.mutate(form.getFieldsValue())
                  }
                  onVerifyLiftChallenge={() =>
                    liftChallengeVerifyMutation.mutate(form.getFieldsValue())
                  }
                  onLift={() =>
                    controlLiftMutation.mutate(form.getFieldsValue())
                  }
                />
              )
            },
            {
              key: "reviews",
              label: "Review Requests",
              children: (
                <HighRiskGovernanceReviews
                  listResult={reviews.data}
                  detailResult={reviewDetail.data}
                  reviewChallengeResult={reviewChallengeMutation.data}
                  reviewChallengeVerifyResult={reviewChallengeVerifyMutation.data}
                  approveResult={reviewApproveMutation.data}
                  rejectResult={reviewRejectMutation.data}
                  withdrawResult={reviewWithdrawMutation.data}
                  isListPending={reviews.isPending}
                  isDetailPending={reviewDetail.isPending}
                  isChallengePending={reviewChallengeMutation.isPending}
                  isVerifyPending={reviewChallengeVerifyMutation.isPending}
                  isApprovePending={reviewApproveMutation.isPending}
                  isRejectPending={reviewRejectMutation.isPending}
                  isWithdrawPending={reviewWithdrawMutation.isPending}
                  onRefreshList={() => void reviews.refetch()}
                  onLoadDetail={() => void reviewDetail.refetch()}
                  onChallenge={() =>
                    reviewChallengeMutation.mutate(form.getFieldsValue())
                  }
                  onVerifyChallenge={() =>
                    reviewChallengeVerifyMutation.mutate(form.getFieldsValue())
                  }
                  onApprove={() =>
                    reviewApproveMutation.mutate(form.getFieldsValue())
                  }
                  onReject={() =>
                    reviewRejectMutation.mutate(form.getFieldsValue())
                  }
                  onWithdraw={() =>
                    reviewWithdrawMutation.mutate(form.getFieldsValue())
                  }
                />
              )
            },
            {
              key: "audit",
              label: "Audit",
              children: <RecentAudit overview={accepted} />
            }
          ]}
        />
      </Form>
    </section>
  );
}

function GovernanceControls({
  controlsResult,
  previewResult,
  controlChallengeResult,
  controlChallengeVerifyResult,
  createResult,
  liftChallengeResult,
  liftChallengeVerifyResult,
  liftResult,
  isPreviewPending,
  isChallengePending,
  isVerifyPending,
  isCreatePending,
  isLiftChallengePending,
  isLiftVerifyPending,
  isLiftPending,
  onPreview,
  onChallenge,
  onVerifyChallenge,
  onCreate,
  onLiftChallenge,
  onVerifyLiftChallenge,
  onLift,
  onLoadReview
}: {
  controlsResult: GovernanceControlsResult | undefined;
  previewResult: GovernanceControlPreviewResult | undefined;
  controlChallengeResult: CreateSensitiveOperationChallengeResult | undefined;
  controlChallengeVerifyResult:
    | VerifySensitiveOperationChallengeResult
    | undefined;
  createResult: GovernanceControlMutationResult | undefined;
  liftChallengeResult: CreateSensitiveOperationChallengeResult | undefined;
  liftChallengeVerifyResult: VerifySensitiveOperationChallengeResult | undefined;
  liftResult: GovernanceControlMutationResult | undefined;
  isPreviewPending: boolean;
  isChallengePending: boolean;
  isVerifyPending: boolean;
  isCreatePending: boolean;
  isLiftChallengePending: boolean;
  isLiftVerifyPending: boolean;
  isLiftPending: boolean;
  onPreview(): void;
  onChallenge(): void;
  onVerifyChallenge(): void;
  onCreate(): void;
  onLiftChallenge(): void;
  onVerifyLiftChallenge(): void;
  onLift(): void;
  onLoadReview(reviewRequestId: string): void;
}) {
  const form = Form.useFormInstance<Stage8GovernanceForm>();
  const rows = controlsResult?.result === "accepted" ? controlsResult.controls : [];
  const impactRows =
    previewResult?.result === "accepted"
      ? Object.entries(previewResult.impactSummary.counts).map(([key, value]) => ({
          key,
          value
        }))
      : [];
  const columns: TableProps<GovernanceControlRow>["columns"] = [
    {
      title: "Control",
      dataIndex: "controlType"
    },
    {
      title: "Scope",
      render: (_, row) => `${row.scopeType}:${row.scopeId ?? "platform"}`
    },
    {
      title: "Status",
      render: (_, row) => (
        <Space wrap>
          <Tag color={row.effective ? "red" : "default"}>{row.status}</Tag>
          {row.effective ? <Tag color="volcano">effective</Tag> : null}
        </Space>
      )
    },
    {
      title: "Reason",
      dataIndex: "reason"
    },
    {
      title: "Created",
      dataIndex: "createdAt"
    },
    {
      title: "Action",
      render: (_, row) => (
        <Button
          size="small"
          onClick={() =>
            form.setFieldsValue({
              governanceScopeType: row.scopeType,
              governanceScopeId: row.scopeId ?? "",
              governanceControlType: row.controlType,
              liftControlId: row.id
            })
          }
        >
          Load Lift
        </Button>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        <Form.Item label="Scope Type" name="governanceScopeType">
          <Select
            style={{ width: 160 }}
            options={[
              { label: "Community", value: "community" },
              { label: "Platform", value: "platform" }
            ]}
          />
        </Form.Item>
        <Form.Item label="Scope ID" name="governanceScopeId">
          <Input placeholder="community id or blank for platform" style={{ width: 260 }} />
        </Form.Item>
        <Form.Item label="Control Type" name="governanceControlType">
          <Select
            style={{ width: 230 }}
            options={[
              { label: "Pause Publish", value: "pause_publish" },
              { label: "Pause Bid", value: "pause_bid" },
              { label: "Pause Settlement", value: "pause_settlement" },
              { label: "Force Platform Review", value: "force_platform_review" }
            ]}
          />
        </Form.Item>
        <Form.Item label="Reason" name="governanceReason">
          <Input style={{ width: 280 }} />
        </Form.Item>
        <Form.Item label="Ends At" name="governanceEndsAt">
          <Input placeholder="optional ISO time" style={{ width: 220 }} />
        </Form.Item>
        <Button loading={isPreviewPending} onClick={onPreview}>
          Preview
        </Button>
      </Space>
      {previewResult?.result === "rejected" ? (
        <Tag color="red">{previewResult.errorCode}</Tag>
      ) : null}
      {previewResult?.result === "accepted" ? (
        <Descriptions
          bordered
          size="small"
          column={1}
          items={[
            {
              key: "previewId",
              label: "Preview ID",
              children: previewResult.previewId
            },
            {
              key: "expiresAt",
              label: "Expires At",
              children: previewResult.expiresAt
            },
            {
              key: "blockedActions",
              label: "Blocked Actions",
              children: previewResult.impactSummary.blockedActions.join(", ")
            }
          ]}
        />
      ) : null}
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={impactRows}
        columns={[
          {
            title: "Impact",
            dataIndex: "key"
          },
          {
            title: "Count",
            dataIndex: "value"
          }
        ]}
      />
      <Space wrap>
        <Form.Item label="Preview ID" name="governancePreviewId">
          <Input style={{ width: 260 }} />
        </Form.Item>
        <Form.Item label="Challenge ID" name="governanceChallengeId">
          <Input style={{ width: 260 }} />
        </Form.Item>
        <Form.Item label="Idempotency Key" name="governanceIdempotencyKey">
          <Input style={{ width: 220 }} />
        </Form.Item>
        <Button loading={isChallengePending} onClick={onChallenge}>
          Create Challenge
        </Button>
        <Form.Item label="Verification Code" name="governanceVerificationCode">
          <Input style={{ width: 180 }} />
        </Form.Item>
        <Button loading={isVerifyPending} onClick={onVerifyChallenge}>
          Verify Challenge
        </Button>
        <Button type="primary" loading={isCreatePending} onClick={onCreate}>
          Create Control
        </Button>
        <SensitiveChallengeResultTags
          created={controlChallengeResult}
          verified={controlChallengeVerifyResult}
        />
        {createResult?.result === "rejected" ? (
          <Tag color="red">{createResult.errorCode}</Tag>
        ) : null}
        {createResult?.result === "pending_review" ? (
          <Button size="small" onClick={() => onLoadReview(createResult.reviewRequestId)}>
            Review {createResult.reviewRequestId}:{createResult.reviewStatus}
          </Button>
        ) : null}
      </Space>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        columns={columns}
      />
      <Space wrap>
        <Form.Item label="Control ID" name="liftControlId">
          <Input style={{ width: 260 }} />
        </Form.Item>
        <Form.Item label="Lift Reason" name="liftReason">
          <Input style={{ width: 260 }} />
        </Form.Item>
        <Form.Item label="Challenge ID" name="liftChallengeId">
          <Input style={{ width: 260 }} />
        </Form.Item>
        <Form.Item label="Idempotency Key" name="liftIdempotencyKey">
          <Input style={{ width: 220 }} />
        </Form.Item>
        <Button loading={isLiftChallengePending} onClick={onLiftChallenge}>
          Create Lift Challenge
        </Button>
        <Form.Item label="Verification Code" name="liftVerificationCode">
          <Input style={{ width: 180 }} />
        </Form.Item>
        <Button loading={isLiftVerifyPending} onClick={onVerifyLiftChallenge}>
          Verify Lift Challenge
        </Button>
        <Button loading={isLiftPending} onClick={onLift}>
          Lift Control
        </Button>
        <SensitiveChallengeResultTags
          created={liftChallengeResult}
          verified={liftChallengeVerifyResult}
        />
        {liftResult?.result === "rejected" ? (
          <Tag color="red">{liftResult.errorCode}</Tag>
        ) : null}
        {liftResult?.result === "pending_review" ? (
          <Button size="small" onClick={() => onLoadReview(liftResult.reviewRequestId)}>
            Review {liftResult.reviewRequestId}:{liftResult.reviewStatus}
          </Button>
        ) : null}
      </Space>
    </Space>
  );
}

function HighRiskGovernanceReviews({
  listResult,
  detailResult,
  reviewChallengeResult,
  reviewChallengeVerifyResult,
  approveResult,
  rejectResult,
  withdrawResult,
  isListPending,
  isDetailPending,
  isChallengePending,
  isVerifyPending,
  isApprovePending,
  isRejectPending,
  isWithdrawPending,
  onRefreshList,
  onLoadDetail,
  onChallenge,
  onVerifyChallenge,
  onApprove,
  onReject,
  onWithdraw
}: {
  listResult: HighRiskGovernanceReviewListResult | undefined;
  detailResult: HighRiskGovernanceReviewDetailResult | undefined;
  reviewChallengeResult: CreateSensitiveOperationChallengeResult | undefined;
  reviewChallengeVerifyResult:
    | VerifySensitiveOperationChallengeResult
    | undefined;
  approveResult: HighRiskGovernanceReviewTransitionResult | undefined;
  rejectResult: HighRiskGovernanceReviewTransitionResult | undefined;
  withdrawResult: HighRiskGovernanceReviewTransitionResult | undefined;
  isListPending: boolean;
  isDetailPending: boolean;
  isChallengePending: boolean;
  isVerifyPending: boolean;
  isApprovePending: boolean;
  isRejectPending: boolean;
  isWithdrawPending: boolean;
  onRefreshList(): void;
  onLoadDetail(): void;
  onChallenge(): void;
  onVerifyChallenge(): void;
  onApprove(): void;
  onReject(): void;
  onWithdraw(): void;
}) {
  const form = Form.useFormInstance<Stage8GovernanceForm>();
  const reviewRequestId = Form.useWatch("reviewRequestId", form) ?? "";
  const rows = listResult?.result === "accepted" ? listResult.reviews : [];
  const detail = detailResult?.result === "accepted" ? detailResult : null;
  const reviewColumns: TableProps<HighRiskGovernanceReviewRow>["columns"] = [
    {
      title: "Action",
      dataIndex: "actionType"
    },
    {
      title: "Decision",
      render: (_, row) => (
        <Tag color={reviewStateColor(row.decisionState)}>
          {row.decisionState}
        </Tag>
      )
    },
    {
      title: "Execution",
      render: (_, row) => (
        <Tag color={executionStateColor(row.executionState)}>
          {row.executionState}
        </Tag>
      )
    },
    {
      title: "Target",
      render: (_, row) => `${row.targetType}:${row.targetId}`
    },
    {
      title: "Scope",
      render: (_, row) => `${row.scopeType ?? "platform"}:${row.scopeId ?? "platform"}`
    },
    {
      title: "Expires",
      dataIndex: "expiresAt"
    },
    {
      title: "Review",
      render: (_, row) => (
        <Button
          size="small"
          onClick={() => form.setFieldValue("reviewRequestId", row.id)}
        >
          Load Detail
        </Button>
      )
    }
  ];
  const eventColumns: TableProps<HighRiskGovernanceReviewEventRow>["columns"] = [
    {
      title: "Event",
      dataIndex: "eventType"
    },
    {
      title: "Actor",
      dataIndex: "actorUserId",
      render: (value) => value ?? "system"
    },
    {
      title: "Decision",
      render: (_, row) =>
        `${row.fromDecisionState ?? "-"} -> ${row.toDecisionState ?? "-"}`
    },
    {
      title: "Execution",
      render: (_, row) =>
        `${row.fromExecutionState ?? "-"} -> ${row.toExecutionState ?? "-"}`
    },
    {
      title: "Reason",
      dataIndex: "reason",
      render: (value) => value ?? "-"
    },
    {
      title: "Error",
      dataIndex: "errorCode",
      render: (value) => value ?? "-"
    },
    {
      title: "Created",
      dataIndex: "createdAt"
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        <Form.Item label="Decision State" name="reviewDecisionState">
          <Select
            style={{ width: 180 }}
            options={[
              { label: "Pending", value: "pending" },
              { label: "All", value: "all" },
              { label: "Approved", value: "approved" },
              { label: "Rejected", value: "rejected" },
              { label: "Expired", value: "expired" },
              { label: "Withdrawn", value: "withdrawn" },
              { label: "Invalidated", value: "invalidated" }
            ]}
          />
        </Form.Item>
        <Button loading={isListPending} onClick={onRefreshList}>
          Refresh Reviews
        </Button>
        {listResult?.result === "rejected" ? (
          <Tag color="red">{listResult.errorCode}</Tag>
        ) : null}
      </Space>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        columns={reviewColumns}
      />
      <Space wrap>
        <Form.Item label="Review Request ID" name="reviewRequestId">
          <Input style={{ width: 320 }} />
        </Form.Item>
        <Button
          loading={isDetailPending}
          disabled={!reviewRequestId}
          onClick={onLoadDetail}
        >
          Load Review Detail
        </Button>
        {detailResult?.result === "rejected" ? (
          <Tag color="red">{detailResult.errorCode}</Tag>
        ) : null}
      </Space>
      {detail ? (
        <>
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              {
                key: "states",
                label: "State",
                children: (
                  <Space wrap>
                    <Tag color={reviewStateColor(detail.review.decisionState)}>
                      {detail.review.decisionState}
                    </Tag>
                    <Tag color={executionStateColor(detail.review.executionState)}>
                      {detail.review.executionState}
                    </Tag>
                  </Space>
                )
              },
              {
                key: "action",
                label: "Action",
                children: detail.review.actionType
              },
              {
                key: "target",
                label: "Target",
                children: `${detail.review.targetType}:${detail.review.targetId}`
              },
              {
                key: "scope",
                label: "Scope",
                children: `${detail.review.scopeType ?? "platform"}:${
                  detail.review.scopeId ?? "platform"
                }`
              },
              {
                key: "controlType",
                label: "Control Type",
                children: detail.review.controlType ?? "-"
              },
              {
                key: "expiresAt",
                label: "Expires At",
                children: detail.review.expiresAt
              },
              {
                key: "initiator",
                label: "Initiator",
                children: detail.review.initiatorUserId
              },
              {
                key: "reviewer",
                label: "Reviewer",
                children: detail.review.reviewerUserId ?? "-"
              },
              {
                key: "decisionReason",
                label: "Decision Reason",
                children: detail.review.decisionReason ?? "-"
              },
              {
                key: "executionError",
                label: "Execution Error",
                children: detail.review.executionErrorCode ?? "-"
              }
            ]}
          />
          <Space wrap>
            <Form.Item label="Challenge ID" name="reviewChallengeId">
              <Input style={{ width: 260 }} />
            </Form.Item>
            <Button loading={isChallengePending} onClick={onChallenge}>
              Create Review Challenge
            </Button>
            <Form.Item label="Verification Code" name="reviewVerificationCode">
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Button loading={isVerifyPending} onClick={onVerifyChallenge}>
              Verify Review Challenge
            </Button>
            <Button
              type="primary"
              loading={isApprovePending}
              onClick={onApprove}
            >
              Approve Review
            </Button>
            <SensitiveChallengeResultTags
              created={reviewChallengeResult}
              verified={reviewChallengeVerifyResult}
            />
            <ReviewTransitionTag result={approveResult} />
          </Space>
          <Space wrap>
            <Form.Item label="Reject Reason" name="reviewRejectReason">
              <Input style={{ width: 320 }} />
            </Form.Item>
            <Button danger loading={isRejectPending} onClick={onReject}>
              Reject Review
            </Button>
            <ReviewTransitionTag result={rejectResult} />
          </Space>
          <Space wrap>
            <Form.Item label="Withdraw Reason" name="reviewWithdrawReason">
              <Input style={{ width: 320 }} />
            </Form.Item>
            <Button loading={isWithdrawPending} onClick={onWithdraw}>
              Withdraw Review
            </Button>
            <ReviewTransitionTag result={withdrawResult} />
          </Space>
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              {
                key: "frozenPayload",
                label: "Frozen Payload",
                children: <JsonBlock value={detail.review.frozenPayloadJson} />
              },
              {
                key: "evidence",
                label: "Evidence",
                children: <JsonBlock value={detail.review.evidenceJson} />
              }
            ]}
          />
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={detail.events}
            columns={eventColumns}
          />
        </>
      ) : null}
    </Space>
  );
}

function governanceControlMutationMessage(
  payload: GovernanceControlMutationResult
) {
  switch (payload.result) {
    case "accepted":
      return payload.control.id;
    case "pending_review":
      return payload.reviewRequestId;
    case "rejected":
      return payload.errorCode;
  }
}

function highRiskReviewTransitionMessage(
  payload: HighRiskGovernanceReviewTransitionResult
) {
  switch (payload.result) {
    case "accepted":
      return `${payload.review.decisionState}:${payload.review.executionState}`;
    case "rejected":
      return payload.errorCode;
  }
}

function ReviewTransitionTag({
  result
}: {
  result: HighRiskGovernanceReviewTransitionResult | undefined;
}) {
  if (!result) {
    return null;
  }

  return result.result === "accepted" ? (
    <Tag color={reviewStateColor(result.review.decisionState)}>
      {result.review.decisionState}:{result.review.executionState}
      {result.transitionApplied ? "" : " replayed"}
    </Tag>
  ) : (
    <Tag color="red">{result.errorCode}</Tag>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        maxHeight: 260,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word"
      }}
    >
      {formatJson(value)}
    </pre>
  );
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function reviewStateColor(state: string) {
  switch (state) {
    case "pending":
      return "gold";
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "expired":
    case "withdrawn":
    case "invalidated":
      return "default";
    default:
      return "blue";
  }
}

function executionStateColor(state: string) {
  switch (state) {
    case "succeeded":
      return "green";
    case "failed":
      return "red";
    default:
      return "default";
  }
}

function SensitiveChallengeResultTags({
  created,
  verified
}: {
  created: CreateSensitiveOperationChallengeResult | undefined;
  verified: VerifySensitiveOperationChallengeResult | undefined;
}) {
  return (
    <>
      {created?.result === "rejected" ? (
        <Tag color="red">{created.errorCode}</Tag>
      ) : created?.result === "accepted" ? (
        <Tag color="blue">{created.challengeId}</Tag>
      ) : null}
      {verified?.result === "rejected" ? (
        <Tag color="red">{verified.errorCode}</Tag>
      ) : verified?.result === "accepted" ? (
        <Tag color="green">verified</Tag>
      ) : null}
    </>
  );
}

function QueueSummary({
  overview
}: {
  overview: AcceptedGovernanceOverview | null;
}) {
  const queue = overview?.queueSummary;

  return (
    <Descriptions
      bordered
      size="small"
      column={2}
      items={[
        {
          key: "communityRequests",
          label: "Community Requests",
          children: queue?.pendingCommunityRequests ?? "-"
        },
        {
          key: "memberReviews",
          label: "Member Reviews",
          children: queue?.pendingMemberReviews ?? "-"
        },
        {
          key: "contentTasks",
          label: "Content Review",
          children: queue?.contentReviewTasks ?? "-"
        },
        {
          key: "appeals",
          label: "Activity Appeals",
          children: queue?.pendingAppeals ?? "-"
        },
        {
          key: "platformAppeals",
          label: "Platform Appeals",
          children: queue?.platformAppeals ?? "-"
        },
        {
          key: "notifications",
          label: "High Priority Notifications",
          children: queue?.unreadHighPriorityNotifications ?? "-"
        }
      ]}
    />
  );
}

function SystemSummary({
  overview
}: {
  overview: AcceptedGovernanceOverview | null;
}) {
  const system = overview?.systemSummary;

  return (
    <Descriptions
      bordered
      size="small"
      column={1}
      items={[
        {
          key: "scope",
          label: "Admin Scope",
          children: overview ? (
            <Space wrap>
              <Tag color={overview.adminScope.platformWide ? "purple" : "blue"}>
                {overview.adminScope.role}
              </Tag>
              <Tag color={overview.adminScope.mfaEnabled ? "green" : "red"}>
                MFA {overview.adminScope.mfaEnabled ? "enabled" : "required"}
              </Tag>
              <span>{overview.adminScope.communityIds.join(", ") || "platform"}</span>
            </Space>
          ) : (
            "-"
          )
        },
        {
          key: "pendingOutbox",
          label: "Pending Outbox",
          children: system?.pendingOutboxEvents ?? "-"
        },
        {
          key: "failedOutbox",
          label: "Failed Outbox",
          children: system?.failedOutboxEvents ?? "-"
        },
        {
          key: "ledger",
          label: "Latest Ledger Check",
          children: system?.latestLedgerCheck
            ? `${system.latestLedgerCheck.status} / ${system.latestLedgerCheck.ledgerDiffCount} diffs`
            : "-"
        }
      ]}
    />
  );
}

function PilotMetrics({
  overview
}: {
  overview: AcceptedGovernanceOverview | null;
}) {
  const metrics = overview?.pilotMetrics;

  return (
    <Descriptions
      bordered
      size="small"
      column={2}
      items={[
        {
          key: "communities",
          label: "Active Communities",
          children: metrics?.activeCommunities ?? "-"
        },
        {
          key: "members",
          label: "Active Members",
          children: metrics?.activeMembers ?? "-"
        },
        {
          key: "auctions",
          label: "Active Auctions",
          children: metrics?.activeAuctions ?? "-"
        },
        {
          key: "transactions",
          label: "Pending Guardian Transactions",
          children: metrics?.pendingGuardianTransactions ?? "-"
        }
      ]}
    />
  );
}

function OperationPreview({
  mutationResult,
  isPending,
  onSubmit
}: {
  mutationResult: AdminOperationPreviewResult | undefined;
  isPending: boolean;
  onSubmit(): void;
}) {
  const counts =
    mutationResult?.result === "accepted"
      ? Object.entries(mutationResult.impactSummary.counts).map(([key, value]) => ({
          key,
          value
        }))
      : [];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        <Form.Item label="Operation" name="operation">
          <Select
            style={{ width: 230 }}
            options={[
              { label: "Force Delist", value: "force_delist" },
              { label: "Adjust Auction End", value: "adjust_auction_end_time" },
              { label: "Pause Community", value: "pause_community" },
              { label: "Export Child Data", value: "export_child_data" },
              { label: "Adjust Points", value: "adjust_points" }
            ]}
          />
        </Form.Item>
        <Form.Item label="Target Type" name="targetType">
          <Input style={{ width: 180 }} />
        </Form.Item>
        <Form.Item label="Target ID" name="targetId">
          <Input style={{ width: 240 }} />
        </Form.Item>
        <Form.Item label="Reason" name="reason">
          <Input style={{ width: 280 }} />
        </Form.Item>
        <Button
          type="primary"
          icon={<ShieldAlert size={16} aria-hidden="true" />}
          loading={isPending}
          onClick={onSubmit}
        >
          Preview
        </Button>
      </Space>
      {mutationResult?.result === "rejected" ? (
        <Tag color="red">{mutationResult.errorCode}</Tag>
      ) : null}
      {mutationResult?.result === "accepted" ? (
        <Descriptions
          bordered
          size="small"
          column={1}
          items={[
            {
              key: "previewId",
              label: "Preview ID",
              children: mutationResult.previewId
            },
            {
              key: "expiresAt",
              label: "Expires At",
              children: mutationResult.expiresAt
            },
            {
              key: "mutation",
              label: "Business Mutation",
              children: String(mutationResult.mutatesBusinessState)
            }
          ]}
        />
      ) : null}
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={counts}
        columns={[
          {
            title: "Impact",
            dataIndex: "key"
          },
          {
            title: "Count",
            dataIndex: "value"
          }
        ]}
      />
    </Space>
  );
}

function RecentAudit({
  overview
}: {
  overview: AcceptedGovernanceOverview | null;
}) {
  const columns: TableProps<AuditLogRow>["columns"] = [
    {
      title: "Action",
      dataIndex: "action"
    },
    {
      title: "Target",
      render: (_, row) => `${row.targetType}:${row.targetId}`
    },
    {
      title: "Reason",
      dataIndex: "reason"
    },
    {
      title: "Created",
      dataIndex: "createdAt"
    }
  ];

  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={overview?.recentAuditLogs ?? []}
      columns={columns}
    />
  );
}

function isAcceptedGovernanceOverview(
  value: GovernanceOverviewResult | undefined
): value is AcceptedGovernanceOverview {
  return value?.result === "accepted";
}

function isRejectedGovernanceOverview(
  value: GovernanceOverviewResult | undefined
): value is RejectedGovernanceOverview {
  return value?.result === "rejected";
}

function governanceControlChallengeTargetId(input: {
  scopeType: string;
  scopeId: string;
}) {
  return input.scopeType === "platform" ? "platform" : input.scopeId;
}

function reviewChallengeScope(
  values: Stage8GovernanceForm,
  detailResult: HighRiskGovernanceReviewDetailResult | undefined
) {
  if (detailResult?.result === "accepted") {
    return {
      scopeType: detailResult.review.scopeType ?? "platform",
      scopeId: detailResult.review.scopeId ?? ""
    };
  }

  return {
    scopeType: values.governanceScopeType || "platform",
    scopeId: values.governanceScopeId || ""
  };
}
