import { lazy, Suspense, type ReactNode } from "react";
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
  Spin,
  Tabs,
  Tag,
  Typography
} from "antd";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { z } from "zod";
import { createAdminStage1Skeleton } from "./stage1-shell.js";
import { stage2AdminViewDefinitions } from "./stage2-nav.js";
import { stage3AdminViewDefinitions } from "./stage3-nav.js";
import { stage4AdminViewDefinitions } from "./stage4-nav.js";
import { stage6AdminViewDefinitions } from "./stage6-nav.js";

const { Content, Header } = Layout;

const queryClient = new QueryClient();

const CommunityRequestsView = lazy(() =>
  import("./stage2-views.js").then((module) => ({
    default: module.CommunityRequestsView
  }))
);
const ActivityAdminsView = lazy(() =>
  import("./stage2-views.js").then((module) => ({
    default: module.ActivityAdminsView
  }))
);
const MemberReviewView = lazy(() =>
  import("./stage2-views.js").then((module) => ({
    default: module.MemberReviewView
  }))
);
const RiskReviewView = lazy(() =>
  import("./stage2-views.js").then((module) => ({
    default: module.RiskReviewView
  }))
);
const ContentReviewView = lazy(() =>
  import("./stage3-views.js").then((module) => ({
    default: module.ContentReviewView
  }))
);
const PointsLedgerView = lazy(() =>
  import("./stage4-views.js").then((module) => ({
    default: module.PointsLedgerView
  }))
);
const Stage6TransactionClosureView = lazy(() =>
  import("./stage6-views.js").then((module) => ({
    default: module.Stage6TransactionClosureView
  }))
);

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

export const stage1AdminNavigationItems = [
  {
    key: "runtime",
    label: "Runtime",
    path: "/"
  },
  {
    key: "security",
    label: "Security",
    path: "/security"
  }
] as const;

export const adminShellNavigationItems = [
  ...stage1AdminNavigationItems,
  ...stage2AdminViewDefinitions.map((view) => ({
    key: view.key,
    label: view.label,
    path: view.path
  })),
  ...stage3AdminViewDefinitions.map((view) => ({
    key: view.key,
    label: view.label,
    path: view.path
  })),
  ...stage4AdminViewDefinitions.map((view) => ({
    key: view.key,
    label: view.label,
    path: view.path
  })),
  ...stage6AdminViewDefinitions.map((view) => ({
    key: view.key,
    label: view.label,
    path: view.path
  }))
];

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
  const apiBaseUrl = skeleton.healthUrl.replace(/\/health$/, "");

  return (
    <Layout className="admin-shell">
      <Header className="admin-header">
        <Space size={12} wrap>
          <ShieldCheck size={22} aria-hidden="true" />
          <Typography.Title level={1}>Auction Admin</Typography.Title>
          <Tag color="blue">Stage 1</Tag>
          <Tag color="cyan">Stage 2</Tag>
          <Tag color="green">Stage 3</Tag>
          <Tag color="gold">Stage 4</Tag>
          <Tag color="purple">Stage 6</Tag>
        </Space>
        <nav className="admin-nav" aria-label="Admin views">
          {adminShellNavigationItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              className={({ isActive }) =>
                `admin-nav-link${isActive ? " admin-nav-link-active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </Header>
      <Content className="admin-content">
        <Routes>
          <Route path="/" element={<RuntimeView healthUrl={skeleton.healthUrl} />} />
          <Route path="/security" element={<SecurityView />} />
          <Route
            path="/stage2/community-requests"
            element={
              <Stage2RouteFallback>
                <CommunityRequestsView apiBaseUrl={apiBaseUrl} />
              </Stage2RouteFallback>
            }
          />
          <Route
            path="/stage2/activity-admins"
            element={
              <Stage2RouteFallback>
                <ActivityAdminsView apiBaseUrl={apiBaseUrl} />
              </Stage2RouteFallback>
            }
          />
          <Route
            path="/stage2/member-review"
            element={
              <Stage2RouteFallback>
                <MemberReviewView apiBaseUrl={apiBaseUrl} />
              </Stage2RouteFallback>
            }
          />
          <Route
            path="/stage2/risk-review"
            element={
              <Stage2RouteFallback>
                <RiskReviewView apiBaseUrl={apiBaseUrl} />
              </Stage2RouteFallback>
            }
          />
          <Route
            path="/stage3/content-review"
            element={
              <Stage2RouteFallback>
                <ContentReviewView apiBaseUrl={apiBaseUrl} />
              </Stage2RouteFallback>
            }
          />
          <Route
            path="/stage4/points-ledger"
            element={
              <Stage2RouteFallback>
                <PointsLedgerView apiBaseUrl={apiBaseUrl} />
              </Stage2RouteFallback>
            }
          />
          <Route
            path="/stage6/transaction-closure"
            element={
              <Stage2RouteFallback>
                <Stage6TransactionClosureView apiBaseUrl={apiBaseUrl} />
              </Stage2RouteFallback>
            }
          />
        </Routes>
      </Content>
    </Layout>
  );
}

function Stage2RouteFallback({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <section className="workspace stage2-route-loading">
          <Spin />
        </section>
      }
    >
      {children}
    </Suspense>
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
