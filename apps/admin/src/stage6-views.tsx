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
  createAppealAttachmentGrant,
  createDeliveryPoint,
  disableDeliveryPoint,
  getAppealDetail,
  listAppeals,
  listDeliveryPoints,
  reviewAppeal,
  resolveTransactionDispute,
  updateDeliveryPoint,
  type AppealDetailResult,
  type ListAppealsResult,
  type ListDeliveryPointsResult,
  type ResolveTransactionDisputeInput,
  type ReviewAppealInput
} from "./stage6-api.js";

type Stage6AdminForm = {
  accessToken: string;
  communityId: string;
  deliveryPointId: string;
  transactionId: string;
  appealId: string;
  appealAttachmentId: string;
  name: string;
  addressText: string;
  availableTimeText: string;
  reason: string;
  disputeAction: ResolveTransactionDisputeInput["action"];
  disputeReason: string;
  disputeIdempotencyKey: string;
  reviewAction: ReviewAppealInput["action"];
  resolution: string;
  ttlSeconds: number;
};

type DeliveryPointRow = Extract<
  ListDeliveryPointsResult,
  { result: "accepted" }
>["points"][number];
type AppealRow = Extract<
  ListAppealsResult,
  { result: "accepted" }
>["appeals"][number];
type AppealDetail = Extract<AppealDetailResult, { result: "accepted" }>["appeal"];

export function Stage6TransactionClosureView({
  apiBaseUrl
}: {
  apiBaseUrl: string;
}) {
  const [form] = Form.useForm<Stage6AdminForm>();
  const { message } = AntApp.useApp();
  const accessToken = Form.useWatch("accessToken", form) ?? "";
  const communityId = Form.useWatch("communityId", form) ?? "";
  const appealId = Form.useWatch("appealId", form) ?? "";

  const deliveryPoints = useQuery({
    queryKey: ["stage6-delivery-points", apiBaseUrl, accessToken, communityId],
    queryFn: () => listDeliveryPoints(apiBaseUrl, { accessToken, communityId }),
    enabled: Boolean(accessToken && communityId),
    retry: false
  });
  const appeals = useQuery({
    queryKey: ["stage6-appeals", apiBaseUrl, accessToken, communityId],
    queryFn: () => listAppeals(apiBaseUrl, { accessToken, communityId }),
    enabled: Boolean(accessToken),
    retry: false
  });
  const appealDetail = useQuery({
    queryKey: ["stage6-appeal-detail", apiBaseUrl, accessToken, appealId],
    queryFn: () => getAppealDetail(apiBaseUrl, { accessToken, appealId }),
    enabled: Boolean(accessToken && appealId),
    retry: false
  });

  const createPointMutation = useMutation({
    mutationFn: (values: Stage6AdminForm) =>
      createDeliveryPoint(apiBaseUrl, {
        accessToken: values.accessToken,
        communityId: values.communityId,
        name: values.name,
        addressText: values.addressText,
        availableTimeText: values.availableTimeText
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.point.status : payload.errorCode
      );
      void deliveryPoints.refetch();
    }
  });
  const updatePointMutation = useMutation({
    mutationFn: (values: Stage6AdminForm) =>
      updateDeliveryPoint(apiBaseUrl, {
        accessToken: values.accessToken,
        deliveryPointId: values.deliveryPointId,
        name: values.name,
        addressText: values.addressText,
        availableTimeText: values.availableTimeText
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.point.status : payload.errorCode
      );
      void deliveryPoints.refetch();
    }
  });
  const disablePointMutation = useMutation({
    mutationFn: (values: Stage6AdminForm) =>
      disableDeliveryPoint(apiBaseUrl, {
        accessToken: values.accessToken,
        deliveryPointId: values.deliveryPointId,
        reason: values.reason
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.point.status : payload.errorCode
      );
      void deliveryPoints.refetch();
    }
  });
  const reviewAppealMutation = useMutation({
    mutationFn: (values: Stage6AdminForm) =>
      reviewAppeal(apiBaseUrl, {
        accessToken: values.accessToken,
        appealId: values.appealId,
        action: values.reviewAction,
        resolution: values.resolution
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.status : payload.errorCode
      );
      void appeals.refetch();
      void appealDetail.refetch();
    }
  });
  const disputeMutation = useMutation({
    mutationFn: (values: Stage6AdminForm) =>
      resolveTransactionDispute(apiBaseUrl, {
        accessToken: values.accessToken,
        transactionId: values.transactionId,
        action: values.disputeAction,
        reason: values.disputeReason,
        idempotencyKey: values.disputeIdempotencyKey
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.status : payload.errorCode
      );
      void appeals.refetch();
      void appealDetail.refetch();
    }
  });
  const grantMutation = useMutation({
    mutationFn: (values: Stage6AdminForm) =>
      createAppealAttachmentGrant(apiBaseUrl, {
        accessToken: values.accessToken,
        appealAttachmentId: values.appealAttachmentId,
        ttlSeconds: values.ttlSeconds
      }),
    onSuccess: (payload) => {
      void message.success(
        payload.result === "accepted" ? payload.purpose : payload.errorCode
      );
    }
  });

  const pointRows =
    deliveryPoints.data?.result === "accepted" ? deliveryPoints.data.points : [];
  const appealRows = appeals.data?.result === "accepted" ? appeals.data.appeals : [];
  const detail =
    appealDetail.data?.result === "accepted" ? appealDetail.data.appeal : null;
  const refreshAll = () => {
    void deliveryPoints.refetch();
    void appeals.refetch();
    void appealDetail.refetch();
  };
  const pointColumns: TableProps<DeliveryPointRow>["columns"] = [
    {
      title: "Delivery Point",
      dataIndex: "name",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.addressText}</div>
        </div>
      )
    },
    {
      title: "Availability",
      dataIndex: "availableTimeText"
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: string) => (
        <Tag color={value === "active" ? "green" : "default"}>{value}</Tag>
      )
    }
  ];
  const appealColumns: TableProps<AppealRow>["columns"] = [
    {
      title: "Appeal",
      dataIndex: "id",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="muted-text">{row.transactionId}</div>
        </div>
      )
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: string) => <Tag color={appealStatusColor(value)}>{value}</Tag>
    },
    {
      title: "Attachments",
      dataIndex: "attachmentCount"
    },
    {
      title: "Reason",
      dataIndex: "reason"
    }
  ];

  return (
    <section className="workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Stage 6 Transaction Closure</Typography.Title>
          <Typography.Text type="secondary">
            Delivery Points, Transaction Appeals, Platform Review
          </Typography.Text>
        </div>
        <Button icon={<RefreshCw size={16} />} onClick={refreshAll}>
          Refresh
        </Button>
      </div>
      <Form form={form} layout="vertical" className="review-form">
        <Space wrap align="end">
          <Form.Item label="Access Token" name="accessToken">
            <Input.Password placeholder="Bearer token value" />
          </Form.Item>
          <Form.Item label="Community" name="communityId">
            <Input placeholder="community id" />
          </Form.Item>
          <Form.Item label="Delivery Point" name="deliveryPointId">
            <Input placeholder="delivery point id" />
          </Form.Item>
          <Form.Item label="Transaction" name="transactionId">
            <Input placeholder="transaction id" />
          </Form.Item>
          <Form.Item label="Appeal" name="appealId">
            <Input placeholder="appeal id" />
          </Form.Item>
          <Form.Item label="Attachment" name="appealAttachmentId">
            <Input placeholder="appeal attachment id" />
          </Form.Item>
        </Space>
        <Space wrap align="end">
          <Form.Item label="Name" name="name">
            <Input placeholder="delivery point name" />
          </Form.Item>
          <Form.Item label="Address" name="addressText">
            <Input placeholder="address text" />
          </Form.Item>
          <Form.Item label="Available Time" name="availableTimeText">
            <Input placeholder="available time" />
          </Form.Item>
          <Form.Item label="Reason / Resolution" name="reason">
            <Input placeholder="disable reason" />
          </Form.Item>
          <Button onClick={() => createPointMutation.mutate(form.getFieldsValue())}>
            Create Point
          </Button>
          <Button onClick={() => updatePointMutation.mutate(form.getFieldsValue())}>
            Update Point
          </Button>
          <Button danger onClick={() => disablePointMutation.mutate(form.getFieldsValue())}>
            Disable Point
          </Button>
        </Space>
        <Space wrap align="end">
          <Form.Item label="Review Action" name="reviewAction" initialValue="resolve">
            <Select
              options={[
                { label: "Resolve", value: "resolve" },
                { label: "Reject", value: "reject" },
                { label: "Escalate Platform", value: "escalate_platform" },
                { label: "Platform Resolve", value: "platform_resolve" }
              ]}
              style={{ width: 180 }}
            />
          </Form.Item>
          <Form.Item label="Resolution" name="resolution">
            <Input placeholder="review notes" />
          </Form.Item>
          <Form.Item label="Grant TTL" name="ttlSeconds" initialValue={300}>
            <InputNumber min={30} max={900} />
          </Form.Item>
          <Button onClick={() => reviewAppealMutation.mutate(form.getFieldsValue())}>
            Review Appeal
          </Button>
          <Button onClick={() => grantMutation.mutate(form.getFieldsValue())}>
            Attachment Grant
          </Button>
        </Space>
        <Space wrap align="end">
          <Form.Item
            label="Dispute Action"
            name="disputeAction"
            initialValue="release_to_buyer"
          >
            <Select
              options={[
                { label: "Release To Buyer", value: "release_to_buyer" },
                { label: "Transfer To Seller", value: "transfer_to_seller" },
                {
                  label: "Keep Frozen",
                  value: "keep_frozen_for_platform_review"
                }
              ]}
              style={{ width: 220 }}
            />
          </Form.Item>
          <Form.Item label="Dispute Reason" name="disputeReason">
            <Input placeholder="transaction dispute reason" />
          </Form.Item>
          <Form.Item label="Dispute Idempotency" name="disputeIdempotencyKey">
            <Input placeholder="idempotency key" />
          </Form.Item>
          <Button onClick={() => disputeMutation.mutate(form.getFieldsValue())}>
            Resolve Transaction Dispute
          </Button>
        </Space>
      </Form>
      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <Typography.Title level={3}>Delivery Points</Typography.Title>
          <Table
            rowKey="id"
            size="small"
            columns={pointColumns}
            dataSource={pointRows}
            pagination={false}
          />
        </section>
        <section className="dashboard-panel">
          <Typography.Title level={3}>Transaction Appeals</Typography.Title>
          <Table
            rowKey="id"
            size="small"
            columns={appealColumns}
            dataSource={appealRows}
            pagination={false}
          />
        </section>
      </div>
      <AppealDetailPanel appeal={detail} />
    </section>
  );
}

function AppealDetailPanel({ appeal }: { appeal: AppealDetail | null }) {
  if (!appeal) {
    return null;
  }

  return (
    <section className="dashboard-panel">
      <Typography.Title level={3}>Platform Review Detail</Typography.Title>
      <Space direction="vertical">
        <Typography.Text>{appeal.id}</Typography.Text>
        <Typography.Text>{appeal.reason}</Typography.Text>
        <Typography.Text>{appeal.resolution ?? "-"}</Typography.Text>
        <Space wrap>
          {appeal.attachments.map((attachment) => (
            <Tag key={attachment.id} color={appealStatusColor(attachment.status)}>
              {attachment.status}:{attachment.mediaAssetId}
            </Tag>
          ))}
        </Space>
      </Space>
    </section>
  );
}

function appealStatusColor(status: string) {
  if (status === "resolved" || status === "platform_resolved") {
    return "green";
  }
  if (status === "rejected") {
    return "red";
  }
  if (status === "escalated_platform") {
    return "purple";
  }

  return "gold";
}
