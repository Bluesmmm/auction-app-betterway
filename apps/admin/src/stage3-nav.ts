import { FileCheck2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type AdminStage3RouteDefinition = {
  key: string;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
};

export const stage3AdminViewDefinitions: AdminStage3RouteDefinition[] = [
  {
    key: "content-review",
    label: "Content Review",
    path: "/stage3/content-review",
    description: "item content queue and manual decisions",
    icon: FileCheck2
  }
];
