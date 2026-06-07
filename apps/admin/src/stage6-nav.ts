import { Landmark } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type AdminStage6RouteDefinition = {
  key: string;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
};

export const stage6AdminViewDefinitions: AdminStage6RouteDefinition[] = [
  {
    key: "transaction-closure",
    label: "Transaction Closure",
    path: "/stage6/transaction-closure",
    description: "delivery points, transaction appeals, and platform review",
    icon: Landmark
  }
];
