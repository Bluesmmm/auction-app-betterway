import { createAdminStage1Skeleton } from "./stage1-shell.js";

export {
  createAdminStage1Skeleton,
  resolveAdminApiBaseUrl
} from "./stage1-shell.js";
export type { AdminStage1Skeleton } from "./stage1-shell.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(createAdminStage1Skeleton()));
}
