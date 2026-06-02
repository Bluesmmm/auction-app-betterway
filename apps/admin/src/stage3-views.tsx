import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Space,
  Table,
  Tag,
  Typography,
  type TableProps
} from "antd";
import {
  getContentReviewTask,
  listContentReviewQueue,
  retryContentTask,
  reviewContentTask,
  type GetContentReviewTaskResult,
  type ListContentReviewQueueResult,
  type ReviewContentTaskInput,
  type ReviewContentTaskResult
} from "./stage3-api.js";

type ContentReviewForm = {
  accessToken: string;
  communityId: string;
  taskId?: string;
  reason?: string;
};

type ContentReviewTaskRow = Extract<
  ListContentReviewQueueResult,
  { result: "accepted" }
>["tasks"][number];

export function ContentReviewView({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [form] = Form.useForm<ContentReviewForm>();
  const { message } = AntApp.useApp();
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [lastResult, setLastResult] = useState<ReviewContentTaskResult | null>(null);
  const accessToken = Form.useWatch("accessToken", form) ?? "";
  const communityId = Form.useWatch("communityId", form) ?? "";
  const reason = Form.useWatch("reason", form) ?? "";

  const queue = useQuery({
    queryKey: ["stage3-content-review-queue", apiBaseUrl, accessToken, communityId],
    queryFn: () =>
      listContentReviewQueue(apiBaseUrl, {
        accessToken,
        communityId
      }),
    enabled: Boolean(accessToken && communityId),
    retry: false
  });

  const detail = useQuery({
    queryKey: ["stage3-content-review-task", apiBaseUrl, accessToken, selectedTaskId],
    queryFn: () =>
      getContentReviewTask(apiBaseUrl, {
        accessToken,
        taskId: selectedTaskId
      }),
    enabled: Boolean(accessToken && selectedTaskId),
    retry: false
  });

  const reviewMutation = useMutation({
    mutationFn: (input: ReviewContentTaskInput) =>
      reviewContentTask(apiBaseUrl, input),
    onSuccess: (payload) => {
      setLastResult(payload);
      void message.success(
        payload.result === "accepted" ? payload.taskStatus : payload.errorCode
      );
      void queue.refetch();
      void detail.refetch();
    }
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) =>
      retryContentTask(apiBaseUrl, {
        accessToken,
        taskId
      }),
    onSuccess: (payload) => {
      setLastResult(payload);
      void message.success(
        payload.result === "accepted" ? payload.taskStatus : payload.errorCode
      );
      void queue.refetch();
      void detail.refetch();
    }
  });

  const rows =
    queue.data?.result === "accepted" ? queue.data.tasks : [];
  const columns: TableProps<ContentReviewTaskRow>["columns"] = [
    {
      title: "Content",
      dataIndex: "title",
      render: (_: unknown, row) => (
        <div>
          <div>{row.title || row.targetId}</div>
          <Typography.Text type="secondary">
            {targetLabel(row.targetType)} / v{row.versionNo}
          </Typography.Text>
        </div>
      )
    },
    {
      title: "Risk",
      dataIndex: "riskLevel",
      render: (risk: string) => <Tag>{risk}</Tag>
    },
    {
      title: "Status",
      dataIndex: "taskStatus"
    },
    {
      title: "Created",
      dataIndex: "createdAt"
    },
    {
      title: "",
      key: "actions",
      render: (_: unknown, row) => (
        <Button type="link" onClick={() => setSelectedTaskId(row.taskId)}>
          Open
        </Button>
      )
    }
  ];

  const taskDetail = detail.data;

  return (
    <section className="workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Content Review</Typography.Title>
          <Typography.Text type="secondary">
            Item, wanted post, and wanted response manual decisions
          </Typography.Text>
        </div>
      </div>
      <Form layout="inline" form={form} className="stage2-command-form">
        <Form.Item name="accessToken" label="Access token">
          <Input.Password placeholder="Bearer token" />
        </Form.Item>
        <Form.Item name="communityId" label="Community">
          <Input placeholder="community id" />
        </Form.Item>
        <Button onClick={() => queue.refetch()} disabled={!accessToken || !communityId}>
          Refresh
        </Button>
      </Form>

      {queue.error ? (
        <Alert type="error" message="Queue request failed" />
      ) : null}
      {lastResult ? (
        <Alert
          type={lastResult.result === "accepted" ? "success" : "warning"}
          message={
            lastResult.result === "accepted"
              ? lastResult.taskStatus
              : lastResult.errorCode
          }
        />
      ) : null}

      <Table
        rowKey="taskId"
        columns={columns}
        dataSource={rows}
        loading={queue.isFetching}
        pagination={false}
      />

      <ReviewDetail
        accessToken={accessToken}
        detail={taskDetail}
        reason={reason}
        onReasonChange={(value) => form.setFieldValue("reason", value)}
        onReview={(decision) => {
          if (!selectedTaskId) return;
          reviewMutation.mutate({
            accessToken,
            taskId: selectedTaskId,
            decision,
            reason
          });
        }}
        onRetry={() => {
          if (selectedTaskId) retryMutation.mutate(selectedTaskId);
        }}
      />
    </section>
  );
}

function ReviewDetail({
  detail,
  reason,
  onReasonChange,
  onReview,
  onRetry
}: {
  accessToken: string;
  detail: GetContentReviewTaskResult | undefined;
  reason: string;
  onReasonChange: (value: string) => void;
  onReview: (decision: "approve" | "reject" | "escalate") => void;
  onRetry: () => void;
}) {
  if (!detail) return null;
  if (detail.result === "rejected") {
    return <Alert type="warning" message={detail.errorCode} />;
  }

  return (
    <section className="stage2-detail-panel">
      <Typography.Title level={3}>{detail.title || detail.targetId}</Typography.Title>
      <Typography.Paragraph>{detail.description}</Typography.Paragraph>
      <Space wrap>
        <Tag>{targetLabel(detail.targetType)}</Tag>
        <Tag>v{detail.versionNo}</Tag>
        <Tag>{detail.taskStatus}</Tag>
        <Tag>{detail.riskLevel}</Tag>
      </Space>
      <Typography.Text type="secondary">
        {detail.images.map((image) => `${image.mediaRole}:${image.mediaAssetId}`).join(" | ")}
      </Typography.Text>
      <Input.TextArea
        rows={3}
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
        placeholder="Reason"
      />
      <Space wrap>
        <Button type="primary" onClick={() => onReview("approve")}>
          Approve
        </Button>
        <Button onClick={() => onReview("reject")}>Reject</Button>
        <Button onClick={() => onReview("escalate")}>Escalate</Button>
        <Button onClick={onRetry}>Retry</Button>
      </Space>
    </section>
  );
}

function targetLabel(targetType: string): string {
  if (targetType === "item") return "Item";
  if (targetType === "wanted_request") return "Wanted";
  if (targetType === "wanted_response") return "Response";
  return targetType;
}
