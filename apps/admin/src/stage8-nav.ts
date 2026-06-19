import { ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type AdminStage8RouteDefinition = {
  key: string;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
};

export const stage8AdminViewDefinitions: AdminStage8RouteDefinition[] = [
  {
    key: "governance",
    label: "Governance",
    path: "/stage8/governance",
    description: "governance queues, pilot metrics, and operation previews",
    icon: ShieldAlert
  }
];
