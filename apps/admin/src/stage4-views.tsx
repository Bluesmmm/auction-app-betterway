import { useMutation, useQuery } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableProps
} from "antd";
import { RefreshCw } from "lucide-react";
import {
  createAdminPointAdjustment,
  listOperationsDashboard,
  listLedgerCheckRuns,
  listPointAdjustmentRequests,
  reviewPointAdjustment,
  secondReviewPointAdjustment,
  type CreateAdminPointAdjustmentInput,
  type ListLedgerCheckRunsResult,
  type ListOperationsDashboardResult,
  type ListPointAdjustmentRequestsResult,
  type ReviewPointAdjustmentInput
} from "./stage4-api.js";

type Stage4PointForm = {
  accessToken: string;
  childId: string;
  requestId: string;
  requestType: CreateAdminPointAdjustmentInput["requestType"];
  requestedPoints: number;
  reason: string;
  challengeId: string;
  idempotencyKey: string;
};

type AdjustmentRow = Extract<
  ListPointAdjustmentRequestsResult,
  { result: "accepted" }
>["requests"][number];
type LedgerCheckRunRow = Extract<
  ListLedgerCheckRunsResult,
  { result: "accepted" }
>["runs"][number];
type OperationsDashboard = Extract<
  ListOperationsDashboardResult,
  { result: "accepted" }
>;
type OperationsTransactionRow = OperationsDashboard["reviewTransactions"][number];
type OperationsActiveHoldRow = OperationsDashboard["activeHolds"][number];
type OperationsOutboxRow = OperationsDashboard["outboxExceptions"][number];
type OperationsLedgerEntryRow = OperationsDashboard["recentLedgerEntries"][number];

export function PointsLedgerView({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [form] = Form.useForm<Stage4PointForm>();
  const { message } = AntApp.useApp();
  const accessToken = Form.useWatch("accessToken", form) ?? "";

  const requests = useQuery({
    queryKey: ["stage4-point-adjustment-requests", apiBaseUrl, accessToken],
    queryFn: () => listPointAdjustmentRequests(apiBaseUrl, { accessToken }),
    enabled: Boolean(accessToken),
    retry: false
  });
  const runs = useQuery({
    queryKey: ["stage4-ledger-check-runs", apiBaseUrl, accessToken],
    queryFn: () => listLedgerCheckRuns(apiBaseUrl, { accessToken }),
    enabled: Boolean(accessToken),
    retry: false
  });
  const dashboard = useQuery({
    queryKey: ["stage5-operations-dashboard", apiBaseUrl, accessToken],
    queryFn: () => listOperationsDashboard(apiBaseUrl, { accessToken }),
    enabled: Boolean(accessToken),
    retry: false
  });

  const createMutation = useMutation({
    mutationFn: (values: Stage4PointForm) =>
      createAdminPointAdjustment(apiBaseUrl, {
        accessToken: values.accessToken,
        childId: values.childId,
        requestType: values.requestType,
        requestedPoints: values.requestedPoints,
        reason: values.reason,
        idempotencyKey: values.idempotencyKey
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.status : payload.errorCode
      );
      void requests.refetch();
    }
  });
  const reviewMutation = useMutation({
    mutationFn: (input: ReviewPointAdjustmentInput) =>
      reviewPointAdjustment(apiBaseUrl, input),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.status : payload.errorCode
      );
      void requests.refetch();
    }
  });
  const secondReviewMutation = useMutation({
    mutationFn: (input: ReviewPointAdjustmentInput) =>
      secondReviewPointAdjustment(apiBaseUrl, input),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.status : payload.errorCode
      );
      void requests.refetch();
      void runs.refetch();
    }
  });

  const requestRows = requests.data?.result === "accepted" ? requests.data.requests : [];
  const runRows = runs.data?.result === "accepted" ? runs.data.runs : [];
  const dashboardData = isOperationsDashboard(dashboard.data) ? dashboard.data : null;
  const refreshAll = () => {
    void dashboard.refetch();
    void requests.refetch();
    void runs.refetch();
  };
  const requestColumns: TableProps<AdjustmentRow>["columns"] = [
    {
      title: "Request",
      dataIndex: "id",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.childId}</div>
        </div>
      )
    },
    {
      title: "Type",
      dataIndex: "requestType"
    },
    {
      title: "Points",
      dataIndex: "requestedPoints"
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: string, row) => (
        <Space>
          <Tag color={value === "approved" ? "green" : value === "rejected" ? "red" : "gold"}>
            {value}
          </Tag>
          {row.requiresSecondReview ? <Tag color="purple">Second Review</Tag> : null}
        </Space>
      )
    }
  ];
  const runColumns: TableProps<LedgerCheckRunRow>["columns"] = [
    {
      title: "Run",
      dataIndex: "id"
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: string) => (
        <Tag color={value === "passed" ? "green" : value === "failed" ? "red" : "default"}>
          {value}
        </Tag>
      )
    },
    {
      title: "Accounts",
      dataIndex: "checkedAccountCount"
    },
    {
      title: "Diffs",
      dataIndex: "ledgerDiffCount"
    },
    {
      title: "Started",
      dataIndex: "startedAt"
    }
  ];
  const transactionColumns: TableProps<OperationsTransactionRow>["columns"] = [
    {
      title: "Transaction",
      dataIndex: "id",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.communityId}</div>
        </div>
      )
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: string) => <Tag color={statusTagColor(value)}>{value}</Tag>
    },
    {
      title: "Points",
      dataIndex: "pointsAmount"
    },
    {
      title: "Children",
      render: (_, row) => (
        <div>
          <Typography.Text>{row.buyerChildId}</Typography.Text>
          <div className="muted-text">{row.sellerChildId}</div>
        </div>
      )
    },
    {
      title: "Deadlines",
      render: (_, row) => (
        <div>
          <Typography.Text>{row.guardianConfirmDeadlineAt}</Typography.Text>
          <div className="muted-text">{row.deliveryConfirmDeadlineAt ?? "-"}</div>
        </div>
      )
    }
  ];
  const activeHoldColumns: TableProps<OperationsActiveHoldRow>["columns"] = [
    {
      title: "Hold",
      dataIndex: "id",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.childDisplayName}</div>
        </div>
      )
    },
    {
      title: "Points",
      dataIndex: "amountPoints"
    },
    {
      title: "Auction",
      render: (_, row) => (
        <div>
          <Typography.Text>{row.auctionSessionId}</Typography.Text>
          <div className="muted-text">{row.auctionStatus}</div>
        </div>
      )
    },
    {
      title: "Community",
      dataIndex: "communityId"
    }
  ];
  const outboxColumns: TableProps<OperationsOutboxRow>["columns"] = [
    {
      title: "Event",
      dataIndex: "eventType",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">
            {row.targetType}:{row.targetId}
          </div>
        </div>
      )
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: string) => <Tag color={statusTagColor(value)}>{value}</Tag>
    },
    {
      title: "Attempts",
      dataIndex: "attempts"
    },
    {
      title: "Available",
      dataIndex: "availableAt"
    }
  ];
  const ledgerColumns: TableProps<OperationsLedgerEntryRow>["columns"] = [
    {
      title: "Entry",
      dataIndex: "id",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.childId}</div>
        </div>
      )
    },
    {
      title: "Type",
      dataIndex: "type"
    },
    {
      title: "Points",
      dataIndex: "amountPoints"
    },
    {
      title: "After",
      render: (_, row) => (
        <div>
          <Typography.Text>{row.availableAfter}</Typography.Text>
          <div className="muted-text">frozen {row.frozenAfter}</div>
        </div>
      )
    },
    {
      title: "Reason",
      dataIndex: "reason"
    }
  ];

  return (
    <section className="workspace stage2-workspace">
      <div className="toolbar">
        <Typography.Title level={2}>Points Operations</Typography.Title>
        <Button
          icon={<RefreshCw size={16} />}
          disabled={!accessToken}
          loading={dashboard.isFetching || requests.isFetching || runs.isFetching}
          onClick={refreshAll}
        >
          Refresh
        </Button>
      </div>
      <Form
        layout="inline"
        form={form}
        className="stage2-command-form"
        initialValues={{
          requestType: "admin_award",
          requestedPoints: 10
        }}
      >
        <Form.Item name="accessToken" label="Access Token" rules={[{ required: true }]}>
          <Input.Password placeholder="Bearer token" />
        </Form.Item>
        <Form.Item name="childId" label="Child">
          <Input placeholder="child id" />
        </Form.Item>
        <Form.Item name="requestType" label="Type">
          <Select
            style={{ width: 150 }}
            options={[
              { value: "admin_award", label: "Award" },
              { value: "admin_penalty", label: "Penalty" },
              { value: "correction", label: "Correction" },
              { value: "batch_award", label: "Batch Award" }
            ]}
          />
        </Form.Item>
        <Form.Item name="requestedPoints" label="Points">
          <InputNumber style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="reason" label="Reason">
          <Input placeholder="audit reason" />
        </Form.Item>
        <Form.Item name="requestId" label="Request">
          <Input placeholder="request id" />
        </Form.Item>
        <Form.Item name="challengeId" label="Challenge">
          <Input placeholder="challenge id" />
        </Form.Item>
        <Form.Item name="idempotencyKey" label="Idempotency">
          <Input placeholder="unique command key" />
        </Form.Item>
        <Space>
          <Button
            onClick={() => {
              const values = form.getFieldsValue();
              createMutation.mutate(values);
            }}
          >
            Create
          </Button>
          <Button
            onClick={() => {
              const values = form.getFieldsValue();
              reviewMutation.mutate({
                accessToken: values.accessToken,
                requestId: values.requestId,
                decision: "approve",
                reviewReason: values.reason,
                challengeId: values.challengeId,
                idempotencyKey: values.idempotencyKey
              });
            }}
          >
            Approve
          </Button>
          <Button
            onClick={() => {
              const values = form.getFieldsValue();
              secondReviewMutation.mutate({
                accessToken: values.accessToken,
                requestId: values.requestId,
                decision: "approve",
                reviewReason: values.reason,
                challengeId: values.challengeId,
                idempotencyKey: values.idempotencyKey
              });
            }}
          >
            Second Approve
          </Button>
        </Space>
      </Form>
      {dashboardData ? (
        <>
          <div className="stage5-metric-grid">
            <Metric label="Available" value={dashboardData.totals.availablePoints} />
            <Metric label="Frozen" value={dashboardData.totals.frozenPoints} />
            <Metric label="Earned" value={dashboardData.totals.totalEarnedPoints} />
            <Metric label="Spent" value={dashboardData.totals.totalSpentPoints} />
            <Metric label="Active Holds" value={dashboardData.holds.activeCount} />
            <Metric
              label="Review Queue"
              value={dashboardData.transactions.reviewQueueCount}
              tone={dashboardData.transactions.reviewQueueCount > 0 ? "warning" : "normal"}
            />
            <Metric
              label="Outbox Exceptions"
              value={dashboardData.outbox.exceptionCount}
              tone={dashboardData.outbox.exceptionCount > 0 ? "danger" : "normal"}
            />
            <Metric label="Accounts" value={dashboardData.totals.accountCount} />
          </div>
          <div className="stage5-ops-grid">
            <div className="ops-band">
              <Typography.Title level={3}>Transaction Review Queue</Typography.Title>
              <Table
                rowKey="id"
                columns={transactionColumns}
                dataSource={dashboardData.reviewTransactions}
                loading={dashboard.isLoading}
                pagination={false}
                size="small"
                scroll={{ x: true }}
              />
            </div>
            <div className="ops-band">
              <Typography.Title level={3}>Active Holds</Typography.Title>
              <Table
                rowKey="id"
                columns={activeHoldColumns}
                dataSource={dashboardData.activeHolds}
                loading={dashboard.isLoading}
                pagination={false}
                size="small"
                scroll={{ x: true }}
              />
            </div>
            <div className="ops-band">
              <Typography.Title level={3}>Outbox Exceptions</Typography.Title>
              <Table
                rowKey="id"
                columns={outboxColumns}
                dataSource={dashboardData.outboxExceptions}
                loading={dashboard.isLoading}
                pagination={false}
                size="small"
                scroll={{ x: true }}
              />
            </div>
            <div className="ops-band">
              <Typography.Title level={3}>Recent Ledger Entries</Typography.Title>
              <Table
                rowKey="id"
                columns={ledgerColumns}
                dataSource={dashboardData.recentLedgerEntries}
                loading={dashboard.isLoading}
                pagination={false}
                size="small"
                scroll={{ x: true }}
              />
            </div>
          </div>
          <div className="ops-band stage5-ledger-health">
            <Typography.Title level={3}>Ledger Health</Typography.Title>
            <Space size={8} wrap>
              <Tag color={dashboardData.latestLedgerCheckRun?.status === "passed" ? "green" : "red"}>
                {dashboardData.latestLedgerCheckRun?.status ?? "missing"}
              </Tag>
              <Typography.Text>
                checked {dashboardData.latestLedgerCheckRun?.checkedAccountCount ?? 0}
              </Typography.Text>
              <Typography.Text>
                ledger diffs {dashboardData.latestLedgerCheckRun?.ledgerDiffCount ?? 0}
              </Typography.Text>
              <Typography.Text>
                orphan ledgers {dashboardData.latestLedgerCheckRun?.orphanLedgerCount ?? 0}
              </Typography.Text>
            </Space>
          </div>
        </>
      ) : null}
      <Typography.Title level={3}>Adjustment Queue</Typography.Title>
      <Table
        rowKey="id"
        columns={requestColumns}
        dataSource={requestRows}
        loading={requests.isLoading}
        pagination={false}
      />
      <Typography.Title level={3}>Ledger Check Results</Typography.Title>
      <Table
        rowKey="id"
        columns={runColumns}
        dataSource={runRows}
        loading={runs.isLoading}
        pagination={false}
      />
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "normal"
}: {
  label: string;
  value: number;
  tone?: "normal" | "warning" | "danger";
}) {
  return (
    <div className={`stage5-metric stage5-metric-${tone}`}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text strong className="stage5-metric-value">
        {value}
      </Typography.Text>
    </div>
  );
}

function isOperationsDashboard(
  payload: ListOperationsDashboardResult | undefined
): payload is OperationsDashboard {
  return payload?.result === "accepted";
}

function statusTagColor(status: string) {
  if (
    status === "completed" ||
    status === "sent" ||
    status === "passed" ||
    status === "transferred"
  ) {
    return "green";
  }

  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "rejected" ||
    status === "disputed"
  ) {
    return "red";
  }

  if (
    status === "platform_review" ||
    status === "pending_guardian_confirm" ||
    status === "pending_delivery_confirm" ||
    status === "pending"
  ) {
    return "gold";
  }

  return "default";
}
