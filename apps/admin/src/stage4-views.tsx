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
import {
  createAdminPointAdjustment,
  listLedgerCheckRuns,
  listPointAdjustmentRequests,
  reviewPointAdjustment,
  secondReviewPointAdjustment,
  type CreateAdminPointAdjustmentInput,
  type ListLedgerCheckRunsResult,
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

  return (
    <section className="workspace stage2-workspace">
      <Typography.Title level={2}>Points Ledger</Typography.Title>
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
