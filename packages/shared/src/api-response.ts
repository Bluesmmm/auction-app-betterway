export type WriteResult = "accepted" | "rejected" | "pending" | "unknown";

export type WriteResponseInput = {
  serverTime: string;
  targetType: string;
  targetId: string;
  targetVersion: number;
  latestStatus: string;
  errorCode?: string;
};

export type WriteResponse = {
  serverTime: string;
  targetType: string;
  targetId: string;
  targetVersion: number;
  latestStatus: string;
  result: WriteResult;
  refreshRequired: boolean;
  errorCode?: string;
};

export function writeAccepted(input: WriteResponseInput): WriteResponse {
  return { ...input, result: "accepted", refreshRequired: false };
}

export function writeUnknown(input: WriteResponseInput): WriteResponse {
  return { ...input, result: "unknown", refreshRequired: true };
}
