import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  ConfigProvider,
  Descriptions,
  Layout,
  Space,
  Tabs,
  Tag,
  Typography
} from "antd";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { z } from "zod";
import { createAdminStage1Skeleton } from "./stage1-shell.js";

const { Content, Header } = Layout;

const queryClient = new QueryClient();

const stage1HealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  serverTime: z.string(),
  targetType: z.literal("runtime_health"),
  targetId: z.literal("stage1-runtime"),
  targetVersion: z.number().int().positive(),
  database: z
    .object({
      status: z.string(),
      serverTime: z.string().optional()
    })
    .optional(),
  redis: z
    .object({
      status: z.string()
    })
    .optional(),
  worker: z
    .object({
      status: z.string(),
      workerName: z.string().optional()
    })
    .optional()
});

type Stage1Health = z.infer<typeof stage1HealthSchema>;

export function AdminApp() {
  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 6,
          colorPrimary: "#1677ff",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        }
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

function Shell() {
  const skeleton = createAdminStage1Skeleton();

  return (
    <Layout className="admin-shell">
      <Header className="admin-header">
        <Space size={12}>
          <ShieldCheck size={22} aria-hidden="true" />
          <Typography.Title level={1}>Auction Admin</Typography.Title>
          <Tag color="blue">Stage 1</Tag>
        </Space>
        <Space>
          <Link to="/">Runtime</Link>
          <Link to="/security">Security</Link>
        </Space>
      </Header>
      <Content className="admin-content">
        <Routes>
          <Route path="/" element={<RuntimeView healthUrl={skeleton.healthUrl} />} />
          <Route path="/security" element={<SecurityView />} />
        </Routes>
      </Content>
    </Layout>
  );
}

function RuntimeView({ healthUrl }: { healthUrl: string }) {
  const health = useQuery({
    queryKey: ["stage1-health", healthUrl],
    queryFn: async () => {
      const response = await fetch(healthUrl);
      if (!response.ok) {
        throw new Error(`health returned ${response.status}`);
      }
      return stage1HealthSchema.parse(await response.json());
    },
    retry: false
  });

  const payload = health.data;

  return (
    <section className="workspace">
      <div className="toolbar">
        <div>
          <Typography.Title level={2}>Runtime</Typography.Title>
          <Typography.Text type="secondary">{healthUrl}</Typography.Text>
        </div>
        <Button
          icon={<RefreshCw size={16} aria-hidden="true" />}
          onClick={() => void health.refetch()}
        >
          Refresh
        </Button>
      </div>
      {health.isError ? (
        <Alert
          type="error"
          showIcon
          message="Runtime is unreachable"
          description={health.error.message}
        />
      ) : null}
      <Tabs
        items={[
          {
            key: "overview",
            label: "Overview",
            children: <RuntimeSummary payload={payload} isLoading={health.isLoading} />
          },
          {
            key: "contract",
            label: "Contract",
            children: <ContractSummary payload={payload} />
          }
        ]}
      />
    </section>
  );
}

function RuntimeSummary({
  payload,
  isLoading
}: {
  payload: Stage1Health | undefined;
  isLoading: boolean;
}) {
  const status = payload?.status ?? (isLoading ? "loading" : "unready");

  return (
    <Descriptions
      bordered
      column={1}
      size="small"
      items={[
        {
          key: "status",
          label: "Status",
          children: (
            <Badge
              status={status === "ok" ? "success" : status === "degraded" ? "warning" : "default"}
              text={status}
            />
          )
        },
        {
          key: "serverTime",
          label: "Server time",
          children: payload?.serverTime ?? "-"
        },
        {
          key: "database",
          label: "Database",
          children: payload?.database?.status ?? "-"
        },
        {
          key: "redis",
          label: "Redis",
          children: payload?.redis?.status ?? "-"
        },
        {
          key: "worker",
          label: "Worker",
          children: payload?.worker?.status ?? "-"
        }
      ]}
    />
  );
}

function ContractSummary({ payload }: { payload: Stage1Health | undefined }) {
  return (
    <Descriptions
      bordered
      column={1}
      size="small"
      items={[
        {
          key: "targetType",
          label: "Target type",
          children: payload?.targetType ?? "runtime_health"
        },
        {
          key: "targetId",
          label: "Target ID",
          children: payload?.targetId ?? "stage1-runtime"
        },
        {
          key: "targetVersion",
          label: "Target version",
          children: payload?.targetVersion ?? "-"
        }
      ]}
    />
  );
}

function SecurityView() {
  return (
    <section className="workspace">
      <Typography.Title level={2}>Security</Typography.Title>
      <Alert
        type="warning"
        showIcon
        message="MFA required for high-risk operations"
        description="Export, point adjustment, community pause, forced delist, and auction end-time changes are gated by MFA plus a fresh challenge."
      />
    </section>
  );
}
