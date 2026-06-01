import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  type TableProps,
  Tag,
  Typography
} from "antd";
import {
  approveCommunityMember,
  approveCommunityRequest,
  buildAdminCommunityScopeChallengeTargetId,
  createSensitiveOperationChallenge,
  createInviteCode,
  grantActivityAdmin,
  listCommunityCreationRequests,
  listMemberReviewQueue,
  listRiskSignals,
  recordRosterVerification,
  rejectCommunityRequest,
  reviewRiskSignal,
  revokeActivityAdmin,
  verifySensitiveOperationChallenge,
  type ApproveCommunityMemberInput,
  type ApproveCommunityRequestInput,
  type CommunityMemberTransitionResult,
  type CreateSensitiveOperationChallengeResult,
  type CreateInviteCodeInput,
  type CreateInviteCodeResult,
  type GrantActivityAdminInput,
  type GrantActivityAdminResult,
  type RecordRosterVerificationInput,
  type RejectCommunityRequestInput,
  type ReviewCommunityRequestResult,
  type ReviewRiskSignalInput,
  type ReviewRiskSignalResult,
  type RevokeActivityAdminInput,
  type RevokeActivityAdminResult,
  type SensitiveOperationType,
  type VerifySensitiveOperationChallengeResult
} from "./stage2-api.js";

type MutationAlertState =
  | ReviewCommunityRequestResult
  | GrantActivityAdminResult
  | RevokeActivityAdminResult
  | CreateInviteCodeResult
  | CommunityMemberTransitionResult
  | ReviewRiskSignalResult
  | CreateSensitiveOperationChallengeResult
  | VerifySensitiveOperationChallengeResult
  | null;

type SensitiveChallengeFormFields = {
  accessToken: string;
  challengeId?: string;
  verificationCode?: string;
};

type CommunityRequestRow = {
  key: string;
  requestId: string;
  guardianId: string;
  requestedName: string;
  gradeBand: string;
  expectedChildCount: number;
  status: "pending_review" | "approved" | "rejected" | "cancelled";
  submittedAt: string;
};

type ActivityAdminRow = {
  key: string;
  communityId: string;
  communityName: string;
  targetUserId: string;
  adminProfileId: string;
  scopeStatus: "active" | "revoked";
  mfaStatus: "required" | "missing";
};

type MemberReviewRow = {
  key: string;
  communityId: string;
  childId: string;
  guardianId: string;
  memberStatus:
    | "pending_guardian"
    | "pending_admin"
    | "active"
    | "removed"
    | "banned";
  rosterVerificationStatus:
    | "pending"
    | "matched"
    | "not_matched"
    | "manual_exception"
    | "rejected";
  riskState: "clear" | "restricted";
  requestedAt: string;
};

type RiskReviewRow = {
  key: string;
  signalId: string;
  scope: "user" | "guardian" | "child" | "community_member" | "community";
  targetId: string;
  type: string;
  status: "open" | "under_review" | "resolved" | "dismissed";
  restrictionCount: number;
  openedAt: string;
};

const activityAdminRows: ActivityAdminRow[] = [
  {
    key: "activity-admin-seed",
    communityId: "seed_community_stage2_sample",
    communityName: "Stage2 Sample Community",
    targetUserId: "seed_user_stage2_activity_admin",
    adminProfileId: "seed_admin_profile_stage2_activity_admin",
    scopeStatus: "active",
    mfaStatus: "required"
  },
  {
    key: "activity-admin-beta",
    communityId: "community_stage2_beta",
    communityName: "East Campus Exchange",
    targetUserId: "admin_user_beta",
    adminProfileId: "admin_profile_beta",
    scopeStatus: "revoked",
    mfaStatus: "missing"
  }
];

export function CommunityRequestsView({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [form] = Form.useForm<ApproveCommunityRequestInput & RejectCommunityRequestInput>();
  const [result, setResult] = useState<MutationAlertState>(null);
  const { message } = AntApp.useApp();
  const accessToken = Form.useWatch("accessToken", form);
  const requestAccessToken = accessToken ?? "";

  const requestsQuery = useQuery({
    queryKey: [
      "stage2-community-creation-requests",
      apiBaseUrl,
      requestAccessToken
    ],
    queryFn: () =>
      listCommunityCreationRequests(apiBaseUrl, {
        accessToken: requestAccessToken
      }),
    enabled: Boolean(requestAccessToken),
    retry: false
  });

  const communityRequestRows: CommunityRequestRow[] =
    requestsQuery.data?.result === "accepted"
      ? requestsQuery.data.requests.map((request) => ({
          key: request.requestId,
          ...request,
          submittedAt: request.submittedAt ?? ""
        }))
      : [];

  const approveMutation = useMutation({
    mutationFn: (values: ApproveCommunityRequestInput) =>
      approveCommunityRequest(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Approved ${payload.requestId}`
          : payload.errorCode
      );
    }
  });

  const rejectMutation = useMutation({
    mutationFn: (values: RejectCommunityRequestInput) =>
      rejectCommunityRequest(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Rejected ${payload.requestId}`
          : payload.errorCode
      );
    }
  });

  const columns: TableProps<CommunityRequestRow>["columns"] = [
    {
      title: "Request",
      dataIndex: "requestedName",
      render: (_: unknown, row: CommunityRequestRow) => (
        <div>
          <div>{row.requestedName}</div>
          <Typography.Text type="secondary">{row.requestId}</Typography.Text>
        </div>
      )
    },
    {
      title: "Guardian",
      dataIndex: "guardianId"
    },
    {
      title: "Grade",
      dataIndex: "gradeBand"
    },
    {
      title: "Size",
      dataIndex: "expectedChildCount",
      width: 88
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 124,
      render: (status: CommunityRequestRow["status"]) => (
        <Tag color={status === "pending_review" ? "gold" : status === "approved" ? "green" : "red"}>
          {status}
        </Tag>
      )
    },
    {
      title: "Action",
      key: "action",
      width: 188,
      render: (_: unknown, row: CommunityRequestRow) => (
        <Space size={8} wrap>
          <Button
            size="small"
            onClick={() =>
              form.setFieldsValue({
                requestId: row.requestId,
                defaultAuctionDurationMinutes: 1440
              })
            }
          >
            Load Approve
          </Button>
          <Button
            size="small"
            onClick={() =>
              form.setFieldsValue({
                requestId: row.requestId,
                reason: "pilot roster not ready"
              })
            }
          >
            Load Reject
          </Button>
        </Space>
      )
    }
  ];

  return (
    <section className="workspace stage2-workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Community Requests</Typography.Title>
          <Typography.Text type="secondary">
            Platform review for creation approvals and rejections.
          </Typography.Text>
        </div>
      </div>
      <div className="ops-layout">
        <section className="ops-band">
          <SectionHeader
            title="Pending Queue"
            subtitle="Requests waiting for platform decision"
          />
          <Table
            columns={columns}
            dataSource={communityRequestRows}
            pagination={false}
            rowKey="requestId"
            size="small"
          />
        </section>
        <section className="ops-band">
          <SectionHeader
            title="Review Actions"
            subtitle="Approve creates the community; reject stores review notes"
          />
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              accessToken: "",
              defaultAuctionDurationMinutes: 1440,
              reason: "pilot roster not ready"
            }}
          >
            <Form.Item label="Access Token" name="accessToken">
              <Input.Password placeholder="Bearer access token" />
            </Form.Item>
            <Form.Item label="Request ID" name="requestId">
              <Input placeholder="community_creation_request id" />
            </Form.Item>
            <Form.Item
              label="Default Auction Duration Minutes"
              name="defaultAuctionDurationMinutes"
            >
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Reject Reason" name="reason">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Space wrap>
              <Button
                type="primary"
                loading={approveMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "requestId",
                    "accessToken",
                    "defaultAuctionDurationMinutes"
                  ]);
                  approveMutation.mutate(values as ApproveCommunityRequestInput);
                }}
              >
                Approve Request
              </Button>
              <Button
                danger
                loading={rejectMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "requestId",
                    "accessToken",
                    "reason"
                  ]);
                  rejectMutation.mutate(values as RejectCommunityRequestInput);
                }}
              >
                Reject Request
              </Button>
            </Space>
          </Form>
          {requestsQuery.data?.result === "rejected" ? (
            <Alert
              className="ops-alert"
              type="warning"
              showIcon
              message={requestsQuery.data.errorCode}
            />
          ) : null}
          <MutationResultAlert result={result} />
        </section>
      </div>
    </section>
  );
}

export function ActivityAdminsView({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [form] = Form.useForm<
    GrantActivityAdminInput &
      RevokeActivityAdminInput &
      SensitiveChallengeFormFields
  >();
  const [result, setResult] = useState<MutationAlertState>(null);
  const { message } = AntApp.useApp();

  const challengeMutation = useMutation({
    mutationFn: (values: {
      accessToken: string;
      operationType: SensitiveOperationType;
      communityId: string;
      targetUserId: string;
    }) =>
      createSensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        operationType: values.operationType,
        targetType: "admin_community_scope_request",
        targetId: buildAdminCommunityScopeChallengeTargetId(
          values.communityId,
          values.targetUserId
        )
      }),
    onSuccess: (payload) => {
      setResult(payload);
      if (payload.result === "accepted") {
        form.setFieldsValue({ challengeId: payload.challengeId });
      }
      void message.success(
        payload.result === "accepted"
          ? `Challenge ${payload.challengeId}`
          : payload.errorCode
      );
    }
  });

  const verifyChallengeMutation = useMutation({
    mutationFn: (values: {
      accessToken: string;
      challengeId: string;
      verificationCode: string;
    }) => verifySensitiveOperationChallenge(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Verified ${payload.challengeId}`
          : payload.errorCode
      );
    }
  });

  const grantMutation = useMutation({
    mutationFn: (values: GrantActivityAdminInput) =>
      grantActivityAdmin(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Granted scope for ${payload.communityId}`
          : payload.errorCode
      );
    }
  });

  const revokeMutation = useMutation({
    mutationFn: (values: RevokeActivityAdminInput) =>
      revokeActivityAdmin(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Revoked scope for ${payload.communityId}`
          : payload.errorCode
      );
    }
  });

  const columns: TableProps<ActivityAdminRow>["columns"] = [
    {
      title: "Community",
      dataIndex: "communityName",
      render: (_: unknown, row: ActivityAdminRow) => (
        <div>
          <div>{row.communityName}</div>
          <Typography.Text type="secondary">{row.communityId}</Typography.Text>
        </div>
      )
    },
    {
      title: "Target User",
      dataIndex: "targetUserId"
    },
    {
      title: "Scope",
      dataIndex: "scopeStatus",
      width: 120,
      render: (status: ActivityAdminRow["scopeStatus"]) => (
        <Tag color={status === "active" ? "green" : "default"}>{status}</Tag>
      )
    },
    {
      title: "MFA",
      dataIndex: "mfaStatus",
      width: 120,
      render: (status: ActivityAdminRow["mfaStatus"]) => (
        <Tag color={status === "required" ? "blue" : "red"}>{status}</Tag>
      )
    },
    {
      title: "Action",
      key: "action",
      width: 188,
      render: (_: unknown, row: ActivityAdminRow) => (
        <Space size={8} wrap>
          <Button
            size="small"
            onClick={() =>
              form.setFieldsValue({
                communityId: row.communityId,
                targetUserId: row.targetUserId
              })
            }
          >
            Load Grant
          </Button>
          <Button
            size="small"
            onClick={() =>
              form.setFieldsValue({
                communityId: row.communityId,
                targetUserId: row.targetUserId,
                reason: "scope rotated after term end"
              })
            }
          >
            Load Revoke
          </Button>
        </Space>
      )
    }
  ];

  return (
    <section className="workspace stage2-workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Activity Admins</Typography.Title>
          <Typography.Text type="secondary">
            Community-scoped admin grant and revoke controls.
          </Typography.Text>
        </div>
      </div>
      <div className="ops-layout">
        <section className="ops-band">
          <SectionHeader
            title="Scope Matrix"
            subtitle="Current activity-admin coverage by community"
          />
          <Table
            columns={columns}
            dataSource={activityAdminRows}
            pagination={false}
            rowKey="adminProfileId"
            size="small"
          />
        </section>
        <section className="ops-band">
          <SectionHeader
            title="Scope Actions"
            subtitle="Grant creates or reactivates scope; revoke records a reason"
          />
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              accessToken: "",
              reason: "scope rotated after term end"
            }}
          >
            <Form.Item label="Access Token" name="accessToken">
              <Input.Password placeholder="Bearer access token" />
            </Form.Item>
            <Form.Item label="Community ID" name="communityId">
              <Input placeholder="community id" />
            </Form.Item>
            <Form.Item label="Target User ID" name="targetUserId">
              <Input placeholder="activity admin user id" />
            </Form.Item>
            <Form.Item label="Revoke Reason" name="reason">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item label="Challenge ID" name="challengeId">
              <Input placeholder="fresh challenge id" />
            </Form.Item>
            <Form.Item label="Verification Code" name="verificationCode">
              <Input placeholder="out-of-band code" />
            </Form.Item>
            <Space wrap>
              <Button
                loading={challengeMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "communityId",
                    "targetUserId",
                    "accessToken"
                  ]);
                  challengeMutation.mutate({
                    ...values,
                    operationType: "grant_activity_admin"
                  });
                }}
              >
                Create Grant Challenge
              </Button>
              <Button
                loading={challengeMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "communityId",
                    "targetUserId",
                    "accessToken"
                  ]);
                  challengeMutation.mutate({
                    ...values,
                    operationType: "revoke_activity_admin"
                  });
                }}
              >
                Create Revoke Challenge
              </Button>
              <Button
                loading={verifyChallengeMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "accessToken",
                    "challengeId",
                    "verificationCode"
                  ]);
                  verifyChallengeMutation.mutate(
                    values as {
                      accessToken: string;
                      challengeId: string;
                      verificationCode: string;
                    }
                  );
                }}
              >
                Verify Challenge
              </Button>
              <Button
                type="primary"
                loading={grantMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "communityId",
                    "targetUserId",
                    "accessToken",
                    "challengeId"
                  ]);
                  grantMutation.mutate(values as GrantActivityAdminInput);
                }}
              >
                Grant Scope
              </Button>
              <Button
                danger
                loading={revokeMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "communityId",
                    "targetUserId",
                    "accessToken",
                    "reason",
                    "challengeId"
                  ]);
                  revokeMutation.mutate(values as RevokeActivityAdminInput);
                }}
              >
                Revoke Scope
              </Button>
            </Space>
          </Form>
          <MutationResultAlert result={result} />
        </section>
      </div>
    </section>
  );
}

export function MemberReviewView({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [inviteForm] = Form.useForm<CreateInviteCodeInput>();
  const [rosterForm] = Form.useForm<RecordRosterVerificationInput & { evidenceText: string }>();
  const [approvalForm] = Form.useForm<ApproveCommunityMemberInput>();
  const [result, setResult] = useState<MutationAlertState>(null);
  const { message } = AntApp.useApp();
  const memberQueueAccessToken = Form.useWatch("accessToken", inviteForm) ?? "";

  const memberQueue = useQuery({
    queryKey: ["stage2-member-review-queue", apiBaseUrl, memberQueueAccessToken],
    queryFn: () =>
      listMemberReviewQueue(apiBaseUrl, {
        accessToken: memberQueueAccessToken
      }),
    enabled: Boolean(memberQueueAccessToken),
    retry: false
  });

  const memberReviewRows: MemberReviewRow[] =
    memberQueue.data?.result === "accepted" ? memberQueue.data.members : [];

  const inviteMutation = useMutation({
    mutationFn: (values: CreateInviteCodeInput) => createInviteCode(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Created invite ${payload.code}`
          : payload.errorCode
      );
    }
  });

  const rosterMutation = useMutation({
    mutationFn: (values: RecordRosterVerificationInput) =>
      recordRosterVerification(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Recorded roster for ${payload.childId}`
          : payload.errorCode
      );
    }
  });

  const approvalMutation = useMutation({
    mutationFn: (values: ApproveCommunityMemberInput) =>
      approveCommunityMember(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Approved member ${payload.childId}`
          : payload.errorCode
      );
    }
  });

  const columns: TableProps<MemberReviewRow>["columns"] = [
    {
      title: "Community / Child",
      key: "communityChild",
      render: (_: unknown, row: MemberReviewRow) => (
        <div>
          <div>{row.communityId}</div>
          <Typography.Text type="secondary">{row.childId}</Typography.Text>
        </div>
      )
    },
    {
      title: "Guardian",
      dataIndex: "guardianId"
    },
    {
      title: "Member",
      dataIndex: "memberStatus",
      width: 160,
      render: (status: MemberReviewRow["memberStatus"]) => (
        <Tag color={status === "active" ? "green" : "gold"}>{status}</Tag>
      )
    },
    {
      title: "Roster",
      dataIndex: "rosterVerificationStatus",
      width: 172,
      render: (status: MemberReviewRow["rosterVerificationStatus"]) => (
        <Tag
          color={
            status === "matched"
              ? "green"
              : status === "manual_exception"
                ? "blue"
                : status === "not_matched"
                  ? "red"
                  : "default"
          }
        >
          {status}
        </Tag>
      )
    },
    {
      title: "Risk",
      dataIndex: "riskState",
      width: 120,
      render: (status: MemberReviewRow["riskState"]) => (
        <Tag color={status === "clear" ? "green" : "red"}>{status}</Tag>
      )
    },
    {
      title: "Action",
      key: "action",
      width: 188,
      render: (_: unknown, row: MemberReviewRow) => (
        <Space size={8} wrap>
          <Button
            size="small"
            onClick={() => {
              inviteForm.setFieldsValue({
                accessToken: "",
                communityId: row.communityId,
                code: "PILOT2026",
                maxUses: 10
              });
              rosterForm.setFieldsValue({
                accessToken: "",
                communityId: row.communityId,
                childId: row.childId,
                status: "matched",
                evidenceText: '{"rosterId":"class-3a"}'
              });
              approvalForm.setFieldsValue({
                accessToken: "",
                communityId: row.communityId,
                childId: row.childId
              });
            }}
          >
            Load Row
          </Button>
        </Space>
      )
    }
  ];

  return (
    <section className="workspace stage2-workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Member Review</Typography.Title>
          <Typography.Text type="secondary">
            Admission flow covering invites, roster verification, and member approval.
          </Typography.Text>
        </div>
      </div>
      <div className="ops-layout">
        <section className="ops-band">
          <SectionHeader
            title="Pending Members"
            subtitle="Admissions that still need roster and admin review"
          />
          <Table
            columns={columns}
            dataSource={memberReviewRows}
            pagination={false}
            rowKey="key"
            size="small"
          />
        </section>
        <section className="ops-band">
          <SectionHeader
            title="Admission Actions"
            subtitle="Create invites, record roster evidence, and approve members"
          />
          <div className="ops-form-stack">
            <Form
              form={inviteForm}
              layout="vertical"
              initialValues={{
                accessToken: "",
                communityId: "seed_community_stage2_sample",
                code: "PILOT2026",
                maxUses: 10
              }}
            >
              <Typography.Title level={4}>Invite Creation</Typography.Title>
              <Form.Item label="Access Token" name="accessToken">
                <Input.Password placeholder="Bearer access token" />
              </Form.Item>
              <Form.Item label="Community ID" name="communityId">
                <Input />
              </Form.Item>
              <Form.Item label="Invite Code" name="code">
                <Input />
              </Form.Item>
              <Form.Item label="Max Uses" name="maxUses">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="Expires At (optional)" name="expiresAt">
                <Input placeholder="2026-06-30T18:00:00.000Z" />
              </Form.Item>
              <Button
                type="primary"
                loading={inviteMutation.isPending}
                onClick={async () => {
                  const values = await inviteForm.validateFields();
                  inviteMutation.mutate(values);
                }}
              >
                Create Invite
              </Button>
            </Form>

            <Form
              form={rosterForm}
              layout="vertical"
              initialValues={{
                accessToken: "",
                communityId: "seed_community_stage2_sample",
                childId: "seed_child_stage2_sample",
                status: "matched",
                evidenceText: '{"rosterId":"class-3a"}'
              }}
            >
              <Typography.Title level={4}>Roster Verification</Typography.Title>
              <Form.Item label="Access Token" name="accessToken">
                <Input.Password placeholder="Bearer access token" />
              </Form.Item>
              <Form.Item label="Community ID" name="communityId">
                <Input />
              </Form.Item>
              <Form.Item label="Child ID" name="childId">
                <Input />
              </Form.Item>
              <Form.Item label="Status" name="status">
                <Select
                  options={[
                    { label: "pending", value: "pending" },
                    { label: "matched", value: "matched" },
                    { label: "not_matched", value: "not_matched" },
                    { label: "manual_exception", value: "manual_exception" },
                    { label: "rejected", value: "rejected" }
                  ]}
                />
              </Form.Item>
              <Form.Item label="Evidence JSON" name="evidenceText">
                <Input.TextArea rows={4} />
              </Form.Item>
              <Button
                type="primary"
                loading={rosterMutation.isPending}
                onClick={async () => {
                  const values = await rosterForm.validateFields();
                  rosterMutation.mutate({
                    accessToken: values.accessToken,
                    communityId: values.communityId,
                    childId: values.childId,
                    status: values.status,
                    evidenceJson: parseJsonInput(values.evidenceText)
                  });
                }}
              >
                Record Roster
              </Button>
            </Form>

            <Form
              form={approvalForm}
              layout="vertical"
              initialValues={{
                accessToken: "",
                communityId: "seed_community_stage2_sample",
                childId: "seed_child_stage2_sample"
              }}
            >
              <Typography.Title level={4}>Member Approval</Typography.Title>
              <Form.Item label="Access Token" name="accessToken">
                <Input.Password placeholder="Bearer access token" />
              </Form.Item>
              <Form.Item label="Community ID" name="communityId">
                <Input />
              </Form.Item>
              <Form.Item label="Child ID" name="childId">
                <Input />
              </Form.Item>
              <Button
                type="primary"
                loading={approvalMutation.isPending}
                onClick={async () => {
                  const values = await approvalForm.validateFields();
                  approvalMutation.mutate(values);
                }}
              >
                Approve Member
              </Button>
            </Form>
          </div>
          <MutationResultAlert result={result} />
        </section>
      </div>
    </section>
  );
}

export function RiskReviewView({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [form] = Form.useForm<
    ReviewRiskSignalInput & SensitiveChallengeFormFields
  >();
  const [result, setResult] = useState<MutationAlertState>(null);
  const { message } = AntApp.useApp();
  const riskQueueAccessToken = Form.useWatch("accessToken", form) ?? "";

  const riskQueue = useQuery({
    queryKey: ["stage2-risk-signals", apiBaseUrl, riskQueueAccessToken],
    queryFn: () =>
      listRiskSignals(apiBaseUrl, {
        accessToken: riskQueueAccessToken
      }),
    enabled: Boolean(riskQueueAccessToken),
    retry: false
  });

  const riskReviewRows: RiskReviewRow[] =
    riskQueue.data?.result === "accepted" ? riskQueue.data.signals : [];

  const challengeMutation = useMutation({
    mutationFn: (values: { accessToken: string; signalId: string }) =>
      createSensitiveOperationChallenge(apiBaseUrl, {
        accessToken: values.accessToken,
        operationType: "review_risk_signal",
        targetType: "risk_signal",
        targetId: values.signalId
      }),
    onSuccess: (payload) => {
      setResult(payload);
      if (payload.result === "accepted") {
        form.setFieldsValue({ challengeId: payload.challengeId });
      }
      void message.success(
        payload.result === "accepted"
          ? `Challenge ${payload.challengeId}`
          : payload.errorCode
      );
    }
  });

  const verifyChallengeMutation = useMutation({
    mutationFn: (values: {
      accessToken: string;
      challengeId: string;
      verificationCode: string;
    }) => verifySensitiveOperationChallenge(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Verified ${payload.challengeId}`
          : payload.errorCode
      );
    }
  });

  const reviewMutation = useMutation({
    mutationFn: (values: ReviewRiskSignalInput) => reviewRiskSignal(apiBaseUrl, values),
    onSuccess: (payload) => {
      setResult(payload);
      void message.success(
        payload.result === "accepted"
          ? `Reviewed ${payload.signalId}`
          : payload.errorCode
      );
    }
  });

  const columns: TableProps<RiskReviewRow>["columns"] = [
    {
      title: "Signal",
      key: "signal",
      render: (_: unknown, row: RiskReviewRow) => (
        <div>
          <div>{row.type}</div>
          <Typography.Text type="secondary">{row.signalId}</Typography.Text>
        </div>
      )
    },
    {
      title: "Scope",
      dataIndex: "scope",
      width: 160
    },
    {
      title: "Target",
      dataIndex: "targetId"
    },
    {
      title: "Restrictions",
      dataIndex: "restrictionCount",
      width: 112
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 124,
      render: (status: RiskReviewRow["status"]) => (
        <Tag color={status === "under_review" ? "gold" : status === "resolved" ? "green" : "default"}>
          {status}
        </Tag>
      )
    },
    {
      title: "Action",
      key: "action",
      width: 132,
      render: (_: unknown, row: RiskReviewRow) => (
        <Button
          size="small"
          onClick={() =>
            form.setFieldsValue({
              signalId: row.signalId,
              resolutionText: "manual review complete",
              resolveRestrictions: true
            })
          }
        >
          Load Review
        </Button>
      )
    }
  ];

  return (
    <section className="workspace stage2-workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Risk Review</Typography.Title>
          <Typography.Text type="secondary">
            Platform review for risk signals and linked restriction release.
          </Typography.Text>
        </div>
      </div>
      <div className="ops-layout">
        <section className="ops-band">
          <SectionHeader
            title="Open Signals"
            subtitle="Signals under review with linked restriction counts"
          />
          <Table
            columns={columns}
            dataSource={riskReviewRows}
            pagination={false}
            rowKey="signalId"
            size="small"
          />
        </section>
        <section className="ops-band">
          <SectionHeader
            title="Review Decision"
            subtitle="Resolved releases linked restrictions unless explicitly disabled"
          />
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              signalId: "risk_signal_alpha",
              accessToken: "",
              decision: "resolved",
              resolutionText: "manual review complete",
              resolveRestrictions: true
            }}
          >
            <Form.Item label="Access Token" name="accessToken">
              <Input.Password placeholder="Bearer access token" />
            </Form.Item>
            <Form.Item label="Signal ID" name="signalId">
              <Input />
            </Form.Item>
            <Form.Item label="Decision" name="decision">
              <Select
                options={[
                  { label: "resolved", value: "resolved" },
                  { label: "dismissed", value: "dismissed" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Resolution Text" name="resolutionText">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Form.Item label="Challenge ID" name="challengeId">
              <Input />
            </Form.Item>
            <Form.Item label="Verification Code" name="verificationCode">
              <Input />
            </Form.Item>
            <Form.Item name="resolveRestrictions" valuePropName="checked">
              <Checkbox>Resolve linked restrictions</Checkbox>
            </Form.Item>
            <Space wrap>
              <Button
                loading={challengeMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "accessToken",
                    "signalId"
                  ]);
                  challengeMutation.mutate(
                    values as { accessToken: string; signalId: string }
                  );
                }}
              >
                Create Review Challenge
              </Button>
              <Button
                loading={verifyChallengeMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "accessToken",
                    "challengeId",
                    "verificationCode"
                  ]);
                  verifyChallengeMutation.mutate(
                    values as {
                      accessToken: string;
                      challengeId: string;
                      verificationCode: string;
                    }
                  );
                }}
              >
                Verify Challenge
              </Button>
              <Button
                type="primary"
                loading={reviewMutation.isPending}
                onClick={async () => {
                  const values = await form.validateFields([
                    "accessToken",
                    "signalId",
                    "decision",
                    "resolutionText",
                    "resolveRestrictions",
                    "challengeId"
                  ]);
                  reviewMutation.mutate(values as ReviewRiskSignalInput);
                }}
              >
                Submit Review
              </Button>
            </Space>
          </Form>
          <MutationResultAlert result={result} />
        </section>
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  subtitle
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="ops-section-header">
      <Typography.Title level={3}>{title}</Typography.Title>
      <Typography.Text type="secondary">{subtitle}</Typography.Text>
    </div>
  );
}

function MutationResultAlert({ result }: { result: MutationAlertState }) {
  if (!result) {
    return null;
  }

  return (
    <Alert
      className="ops-alert"
      type={result.result === "accepted" ? "success" : "warning"}
      showIcon
      message={result.result === "accepted" ? "Command accepted" : "Command rejected"}
      description={
        <pre className="ops-result-json">{JSON.stringify(result, null, 2)}</pre>
      }
    />
  );
}

function parseJsonInput(raw: string): RecordRosterVerificationInput["evidenceJson"] {
  return JSON.parse(raw) as RecordRosterVerificationInput["evidenceJson"];
}
