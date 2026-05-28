import { readFileSync } from "node:fs";

const requiredPairs = [
  ["OBJECT_STORAGE_KEY_CURRENT", "OBJECT_STORAGE_KEY_NEXT"],
  ["SUBSCRIPTION_MESSAGE_SECRET_CURRENT", "SUBSCRIPTION_MESSAGE_SECRET_NEXT"],
  ["LOG_EXPORT_SIGNING_KEY_CURRENT", "LOG_EXPORT_SIGNING_KEY_NEXT"]
];

const envFiles = [".env.example"];

for (const envFile of envFiles) {
  const content = readFileSync(envFile, "utf8");

  for (const [currentKey, nextKey] of requiredPairs) {
    if (!content.includes(`${currentKey}=`) || !content.includes(`${nextKey}=`)) {
      console.error(`${envFile} missing key rotation pair ${currentKey}/${nextKey}`);
      process.exit(1);
    }
  }
}

console.log("stage1 key rotation rehearsal passed");
