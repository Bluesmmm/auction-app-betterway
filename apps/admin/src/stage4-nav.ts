import { Landmark } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type AdminStage4RouteDefinition = {
  key: string;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
};

export const stage4AdminViewDefinitions: AdminStage4RouteDefinition[] = [
  {
    key: "points-ledger",
    label: "Points Ledger",
    path: "/stage4/points-ledger",
    description: "point adjustment queue and ledger check results",
    icon: Landmark
  }
];
