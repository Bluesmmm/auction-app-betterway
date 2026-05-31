import { Building2, ShieldAlert, UserCheck, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type AdminStage2RouteDefinition = {
  key: string;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
};

export const stage2AdminViewDefinitions: AdminStage2RouteDefinition[] = [
  {
    key: "community-requests",
    label: "Community Requests",
    path: "/stage2/community-requests",
    description: "creation approvals and rejects",
    icon: Building2
  },
  {
    key: "activity-admins",
    label: "Activity Admins",
    path: "/stage2/activity-admins",
    description: "scope grant and revoke",
    icon: UserCog
  },
  {
    key: "member-review",
    label: "Member Review",
    path: "/stage2/member-review",
    description: "invite, roster, member approval",
    icon: UserCheck
  },
  {
    key: "risk-review",
    label: "Risk Review",
    path: "/stage2/risk-review",
    description: "signal and restriction resolution",
    icon: ShieldAlert
  }
];
