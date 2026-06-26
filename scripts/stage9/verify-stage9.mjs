import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  stage9GateCategories,
  stage9GateMaturities,
  stage9GateModes,
  stage9GateStatuses,
  stage9Gates,
  stage9OverallStatuses,
  stage9ReportPaths
} from "./gate-matrix.mjs";

const mode = parseMode(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

const gateResults = stage9Gates.map((gate) => evaluateGate(gate, mode));
const overallStatus = computeOverallStatus(gateResults);
const report = {
  generatedAt,
  mode,
  overallStatus,
  counts: countStatuses(gateResults),
  gates: gateResults
};

writeReports(report);
printSummary(report);

if (mode !== "discover" && overallStatus === "blocked") {
  console.error("stage9 verification blocked");
  process.exit(1);
}

function parseMode(args) {
  const rawMode =
    args.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ??
    "verify";
  if (!["discover", "verify", "full"].includes(rawMode)) {
    throw new Error(`unsupported stage9 mode: ${rawMode}`);
  }
  return rawMode;
}

function evaluateGate(gate, currentMode) {
  validateGate(gate);
  const activeMode = currentMode === "full" ? gate.fullMode : gate.defaultMode;

  if (gate.gateType === "manual") {
    const manualEvidence = evaluateManualGateEvidence(gate);
    return {
      ...baseGateResult(gate, currentMode, activeMode),
      status: "manual_gate",
      missingManualEvidence:
        gate.manual?.blockingIfMissing === true &&
        manualEvidence.status !== "present",
      evidence: gate.evidence.map((evidence) => ({
        ...evidence,
        status: "manual_gate"
      })),
      manual: gate.manual,
      manualEvidence
    };
  }

  if (activeMode === "skip") {
    return {
      ...baseGateResult(gate, currentMode, activeMode),
      status: "passed",
      evidence: [
        {
          kind: "mode_skip",
          status: "passed",
          message: "Gate is enforced by another Stage 9 mode."
        }
      ],
      manual: null
    };
  }

  const evidenceResults = [];
  for (const evidence of gate.evidence) {
    const result = evaluateEvidence(evidence, currentMode, activeMode);
    evidenceResults.push(result);
    if (result.status === "failed") {
      break;
    }
  }
  const status = evidenceResults.some((evidence) => evidence.status === "failed")
    ? "failed"
    : evidenceResults.some((evidence) => evidence.status === "not_covered")
      ? "not_covered"
      : "passed";

  return {
    ...baseGateResult(gate, currentMode, activeMode),
    status,
    evidence: evidenceResults,
    manual: null
  };
}

function validateGate(gate) {
  if (!stage9GateCategories.includes(gate.category)) {
    throw new Error(`stage9 gate ${gate.id} has unknown category ${gate.category}`);
  }
  if (!["hard", "manual"].includes(gate.gateType)) {
    throw new Error(`stage9 gate ${gate.id} has unknown gateType ${gate.gateType}`);
  }
  if (!stage9GateMaturities.includes(gate.maturity)) {
    throw new Error(`stage9 gate ${gate.id} has unknown maturity ${gate.maturity}`);
  }
  if (!stage9GateModes.includes(gate.defaultMode)) {
    throw new Error(`stage9 gate ${gate.id} has unknown defaultMode`);
  }
  if (!stage9GateModes.includes(gate.fullMode)) {
    throw new Error(`stage9 gate ${gate.id} has unknown fullMode`);
  }
  if (gate.gateType === "manual" && !gate.manual?.blockingIfMissing) {
    throw new Error(`stage9 manual gate ${gate.id} must block when evidence is missing`);
  }
  if (gate.gateType === "manual") {
    if (!gate.manual?.owner || !gate.manual?.requiredEvidence) {
      throw new Error(`stage9 manual gate ${gate.id} must define owner and requiredEvidence`);
    }
    if (!gate.manual?.validFor && !gate.manual?.expiresAt) {
      throw new Error(`stage9 manual gate ${gate.id} must define validFor or expiresAt`);
    }
    if (!gate.manual?.evidencePath || !gate.manual?.templatePath) {
      throw new Error(`stage9 manual gate ${gate.id} must define evidencePath and templatePath`);
    }
    if (!Array.isArray(gate.manual?.requiredFields)) {
      throw new Error(`stage9 manual gate ${gate.id} must define requiredFields`);
    }
  }
}

function baseGateResult(gate, currentMode, activeMode) {
  return {
    id: gate.id,
    category: gate.category,
    title: gate.title,
    gateType: gate.gateType,
    maturity: gate.maturity,
    mode: currentMode,
    activeMode,
    roadmapRefs: gate.roadmapRefs
  };
}

function evaluateEvidence(evidence, currentMode, activeMode) {
  if (evidence.kind === "gap") {
    return {
      ...evidence,
      status: "not_covered"
    };
  }

  if (activeMode === "discover" || currentMode === "discover") {
    return evaluateDiscoverEvidence(evidence);
  }

  if (!evidenceRequiredForMode(evidence, currentMode)) {
    return {
      ...evidence,
      status: "passed",
      message: "Evidence is not required for this mode."
    };
  }

  if (evidence.kind === "file_exists") {
    const missing = evidence.paths.filter((path) => !existsSync(path));
    return {
      ...evidence,
      status: missing.length === 0 ? "passed" : "failed",
      missing
    };
  }

  if (evidence.kind === "package_scripts") {
    const missing = evidence.scripts.filter(
      (script) => !packageJson.scripts?.[script]
    );
    return {
      ...evidence,
      status: missing.length === 0 ? "passed" : "failed",
      missing
    };
  }

  if (evidence.kind === "command") {
    const result = spawnSync(evidence.binary, evidence.args, {
      stdio: "inherit",
      shell: false,
      env: process.env
    });
    return {
      ...evidence,
      status: result.status === 0 ? "passed" : "failed",
      exitCode: result.status ?? 1
    };
  }

  return {
    ...evidence,
    status: "failed",
    message: `unsupported evidence kind: ${evidence.kind}`
  };
}

function evaluateDiscoverEvidence(evidence) {
  if (evidence.kind === "file_exists") {
    const missing = evidence.paths.filter((path) => !existsSync(path));
    return {
      ...evidence,
      status: missing.length === 0 ? "passed" : "failed",
      missing
    };
  }

  if (evidence.kind === "package_scripts") {
    const missing = evidence.scripts.filter(
      (script) => !packageJson.scripts?.[script]
    );
    return {
      ...evidence,
      status: missing.length === 0 ? "passed" : "failed",
      missing
    };
  }

  if (evidence.kind === "command") {
    return {
      ...evidence,
      status: "passed",
      message: "Command evidence is registered but not executed in discover mode."
    };
  }

  if (evidence.kind === "manual") {
    return {
      ...evidence,
      status: "manual_gate"
    };
  }

  return {
    ...evidence,
    status: "failed",
    message: `unsupported evidence kind: ${evidence.kind}`
  };
}

function evaluateManualGateEvidence(gate) {
  const evidencePath = resolveManualEvidencePath(gate.manual.evidencePath);
  if (!existsSync(evidencePath)) {
    return {
      status: "missing",
      path: evidencePath,
      templatePath: gate.manual.templatePath,
      message: "Manual evidence file is missing."
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch (error) {
    return {
      status: "invalid",
      path: evidencePath,
      templatePath: gate.manual.templatePath,
      problems: [`Manual evidence JSON could not be parsed: ${error.message}`]
    };
  }

  const problems = [];
  for (const field of gate.manual.requiredFields) {
    if (typeof parsed[field] !== "string" || parsed[field].trim() === "") {
      problems.push(`Missing required string field: ${field}`);
    }
  }
  if (parsed.gateId !== gate.id) {
    problems.push(`gateId must be ${gate.id}`);
  }
  if (parsed.owner !== gate.manual.owner) {
    problems.push(`owner must be ${gate.manual.owner}`);
  }

  const approvedAt = parseEvidenceDate(parsed.approvedAt, "approvedAt", problems);
  const expiresAt = parseEvidenceDate(parsed.expiresAt, "expiresAt", problems);
  if (approvedAt && approvedAt.getTime() > Date.parse(generatedAt)) {
    problems.push("approvedAt must not be in the future");
  }
  if (expiresAt && expiresAt.getTime() <= Date.parse(generatedAt)) {
    problems.push("expiresAt must be later than the report generation time");
  }

  if (problems.length > 0) {
    return {
      status: "invalid",
      path: evidencePath,
      templatePath: gate.manual.templatePath,
      problems
    };
  }

  return {
    status: "present",
    path: evidencePath,
    templatePath: gate.manual.templatePath,
    gateId: parsed.gateId,
    owner: parsed.owner,
    approvedAt: parsed.approvedAt,
    expiresAt: parsed.expiresAt,
    evidenceUri: parsed.evidenceUri,
    summary: parsed.summary
  };
}

function resolveManualEvidencePath(defaultPath) {
  if (!process.env.STAGE9_MANUAL_EVIDENCE_DIR) {
    return defaultPath;
  }
  return join(process.env.STAGE9_MANUAL_EVIDENCE_DIR, basename(defaultPath));
}

function parseEvidenceDate(value, field, problems) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    problems.push(`${field} must be an ISO-8601 timestamp`);
    return null;
  }
  return new Date(timestamp);
}

function evidenceRequiredForMode(evidence, currentMode) {
  const modeKey = currentMode === "full" ? "full" : "verify";
  return !evidence.requiredFor || evidence.requiredFor.includes(modeKey);
}

function computeOverallStatus(results) {
  if (
    results.some(
      (gate) =>
        gate.status === "failed" ||
        gate.status === "not_covered" ||
        gate.missingManualEvidence === true
    )
  ) {
    return "blocked";
  }
  if (results.some((gate) => gate.status === "manual_gate")) {
    return "ready_with_manual_gates";
  }
  return "ready_for_pilot";
}

function countStatuses(results) {
  const counts = Object.fromEntries(
    stage9GateStatuses.map((status) => [status, 0])
  );
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

function writeReports(report) {
  mkdirSync(dirname(stage9ReportPaths.json), {
    recursive: true
  });
  writeFileSync(stage9ReportPaths.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(stage9ReportPaths.markdown, renderMarkdownReport(report));
}

function renderMarkdownReport(report) {
  const lines = [
    "# Stage 9 Pre-Pilot Verification Report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Overall status: ${report.overallStatus}`,
    "",
    "## Counts",
    "",
    ...stage9GateStatuses.map((status) => `- ${status}: ${report.counts[status]}`),
    "",
    "## Gates",
    ""
  ];

  for (const gate of report.gates) {
    lines.push(`### ${gate.id}`);
    lines.push("");
    lines.push(`- Category: ${gate.category}`);
    lines.push(`- Status: ${gate.status}`);
    lines.push(`- Gate type: ${gate.gateType}`);
    lines.push(`- Maturity: ${gate.maturity}`);
    lines.push(`- Active mode: ${gate.activeMode}`);
    lines.push(`- Title: ${gate.title}`);
    if (gate.missingManualEvidence) {
      lines.push("- Missing manual evidence: true");
    }
    if (gate.manual) {
      lines.push(`- Owner: ${gate.manual.owner}`);
      lines.push(`- Required evidence: ${gate.manual.requiredEvidence}`);
      lines.push(`- Valid for: ${gate.manual.validFor}`);
      lines.push(`- Evidence path: ${gate.manual.evidencePath}`);
      lines.push(`- Evidence template: ${gate.manual.templatePath}`);
    }
    if (gate.manualEvidence) {
      lines.push(`- Manual evidence status: ${gate.manualEvidence.status}`);
      lines.push(`- Manual evidence checked path: ${gate.manualEvidence.path}`);
      if (gate.manualEvidence.expiresAt) {
        lines.push(`- Manual evidence expires at: ${gate.manualEvidence.expiresAt}`);
      }
      if (gate.manualEvidence.evidenceUri) {
        lines.push(`- Manual evidence URI: ${gate.manualEvidence.evidenceUri}`);
      }
      if (gate.manualEvidence.problems?.length > 0) {
        for (const problem of gate.manualEvidence.problems) {
          lines.push(`- Manual evidence problem: ${problem}`);
        }
      }
    }
    lines.push("");
  }

  lines.push("## Status Rules");
  lines.push("");
  lines.push(
    "- `failed`, `not_covered`, and missing required manual evidence produce `blocked` and make strict modes fail."
  );
  lines.push(
    "- `manual_gate` with recorded evidence can only produce `ready_with_manual_gates`, never `ready_for_pilot`."
  );
  lines.push("- `stage9:discover` is a gap discovery mode, not pilot evidence.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function printSummary(report) {
  console.log(`stage9 mode: ${report.mode}`);
  console.log(`stage9 overall status: ${report.overallStatus}`);
  for (const status of stage9GateStatuses) {
    console.log(`stage9 ${status}: ${report.counts[status]}`);
  }
  console.log(`stage9 report json: ${stage9ReportPaths.json}`);
  console.log(`stage9 report markdown: ${stage9ReportPaths.markdown}`);

  if (!stage9OverallStatuses.includes(report.overallStatus)) {
    throw new Error(`stage9 produced unknown overall status: ${report.overallStatus}`);
  }
}
