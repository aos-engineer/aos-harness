import * as yaml from "js-yaml";
import type { ArtifactManifest } from "./types";

export interface ExecutionPackageOpts {
  profile: string;
  workflow: string;
  sessionId: string;
  domain: string | null;
  participants: string[];
  briefPath: string;
  transcriptPath: string;
  durationMinutes: number;
  stepsCompleted: string[];
  gatesPassed: string[];
  artifacts: Map<string, { manifest: ArtifactManifest; content: string }>;
  sections?: string[];
  executiveSummary?: string;
}

const DEFAULT_SECTIONS = [
  "executive_summary",
  "requirements_analysis",
  "architecture_decision_record",
  "phase_plan",
  "task_breakdown",
  "risk_assessment",
  "stress_test_findings",
  "implementation_checklist",
];

function toTitleCase(slug: string): string {
  return slug
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function renderExecutionPackage(opts: ExecutionPackageOpts): string {
  const frontmatter: Record<string, unknown> = {
    schema: "aos/output/v1",
    date: new Date().toISOString().slice(0, 10),
    session_id: opts.sessionId,
    duration_minutes: opts.durationMinutes,
    profile: opts.profile,
    domain: opts.domain,
    participants: opts.participants,
    brief_path: opts.briefPath,
    transcript_path: opts.transcriptPath,
    workflow: opts.workflow,
    phases_completed: opts.stepsCompleted,
    gates_passed: opts.gatesPassed,
  };

  const yamlStr = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: "'",
    forceQuotes: false,
  });

  const sections = opts.sections ?? DEFAULT_SECTIONS;

  const lines: string[] = [];
  lines.push("---");
  lines.push(yamlStr.trimEnd());
  lines.push("---");
  lines.push("");
  lines.push(`# Execution Package: ${opts.sessionId}`);
  lines.push("");

  // Executive Summary is always rendered first, unnumbered
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(opts.executiveSummary ?? "*No executive summary provided.*");
  lines.push("");

  // Render remaining numbered sections
  const numberedSections = sections.filter((s) => s !== "executive_summary");
  for (let i = 0; i < numberedSections.length; i++) {
    const section = numberedSections[i];
    const heading = toTitleCase(section);
    lines.push(`## ${i + 1}. ${heading}`);
    lines.push("");
    const artifact = opts.artifacts.get(section);
    if (artifact) {
      lines.push(artifact.content);
    } else {
      lines.push("*Not produced in this session.*");
    }
    lines.push("");
  }

  return lines.join("\n");
}
