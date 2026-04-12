/**
 * aos run — Launch a deliberation or execution session.
 */

import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { c, type ParsedArgs } from "../colors";
import { getHarnessRoot, discoverDirs, promptSelect, getAdapterDir } from "../utils";
import type { TranscriptEntry } from "@aos-harness/runtime/types";
import { runAdapterSession } from "../adapter-session";
import { readAdapterConfig } from "../adapter-config";

function createEventBuffer(platformUrl: string, sessionId: string) {
  const buffer: TranscriptEntry[] = [];
  const FLUSH_INTERVAL = 500;
  const BATCH_SIZE = 20;
  const TIMEOUT_MS = 2000;

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, BATCH_SIZE);
    try {
      await fetch(`${platformUrl}/api/sessions/${sessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Drop silently in Phase 1
    }
  }

  const interval = setInterval(flush, FLUSH_INTERVAL);

  return {
    enqueue(entry: TranscriptEntry) {
      buffer.push(entry);
      if (buffer.length >= BATCH_SIZE) flush();
    },
    async shutdown() {
      clearInterval(interval);
      await flush();
    },
  };
}

const HELP = `
${c.bold("aos run")} — Run a deliberation or execution session

${c.bold("USAGE")}
  aos run [profile] [--domain <domain>] [--brief <path>] [--verbose] [--dry-run]
                    [--workflow-dir <path>]

${c.bold("OPTIONS")}
  --domain <name>       Domain pack to apply (e.g. saas)
  --brief <path>        Path to the brief file
  --verbose             Stream engine decisions to stderr
  --dry-run             Validate config and print simulation summary without launching
  --workflow-dir <path> Directory containing workflow YAML files (default: core/workflows/)
  --platform-url <url> Platform API URL for live observability (e.g. http://localhost:3001)

${c.bold("DESCRIPTION")}
  Launches a deliberation or execution session using the specified profile.
  If the profile has a "workflow" field, it runs as an execution profile
  using the linked workflow definition. Otherwise, it runs as a standard
  deliberation session.

  If no profile is given, lists available profiles and prompts for selection.
  If no brief is given, lists available briefs and prompts for selection.

  The session is launched via the configured adapter (default: Pi CLI).

${c.bold("EXAMPLES")}
  aos run strategic-council
  aos run cto-execution --brief briefs/my-feature.md
  aos run strategic-council --domain saas --brief briefs/my-brief.md
  aos run strategic-council --dry-run --brief core/briefs/sample-product-decision/brief.md
  aos run  # interactive profile selection
`;

export async function runCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  const root = getHarnessRoot();
  const coreDir = join(root, "core");

  // ── Resolve profile ──────────────────────────────────────────
  let profileName = args.positional[0] || null;

  const profileDirs = discoverDirs(join(coreDir, "profiles"), "profile.yaml");
  const profileNames = profileDirs.map((d) => basename(d));

  if (!profileName) {
    if (profileNames.length === 0) {
      console.error(c.red("No profiles found. Create one with: aos create profile <name>"));
      process.exit(1);
    }
    const idx = await promptSelect("Select a profile:", profileNames);
    profileName = profileNames[idx];
  }

  const profileDir = profileDirs.find((d) => basename(d) === profileName);
  if (!profileDir) {
    console.error(c.red(`Profile "${profileName}" not found. Available profiles: ${profileNames.join(", ")}`));
    process.exit(1);
  }

  // ── Resolve domain ───────────────────────────────────────────
  const domainName = (args.flags.domain as string) || null;
  if (domainName) {
    const domainDir = join(coreDir, "domains", domainName);
    if (!existsSync(join(domainDir, "domain.yaml"))) {
      const availableDomains = discoverDirs(join(coreDir, "domains"), "domain.yaml").map((d) => basename(d));
      console.error(c.red(`Domain "${domainName}" not found. Available domains: ${availableDomains.join(", ") || "none"}`));
      process.exit(1);
    }
  }

  // ── Resolve brief ────────────────────────────────────────────
  let briefPath = (args.flags.brief as string) || null;

  if (!briefPath) {
    // Discover available briefs
    const briefsDir = join(coreDir, "briefs");
    const briefOptions: { name: string; path: string }[] = [];

    if (existsSync(briefsDir)) {
      for (const entry of readdirSync(briefsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const bp = join(briefsDir, entry.name, "brief.md");
        if (existsSync(bp)) {
          briefOptions.push({ name: entry.name, path: bp });
        }
      }
    }

    if (briefOptions.length === 0) {
      console.error(c.red("No briefs found. Create a brief.md file and pass it with --brief <path>."));
      process.exit(1);
    }

    const idx = await promptSelect(
      "Select a brief:",
      briefOptions.map((b) => b.name),
    );
    briefPath = briefOptions[idx].path;
  } else {
    // Resolve relative paths
    if (!briefPath.startsWith("/")) {
      briefPath = resolve(process.cwd(), briefPath);
    }
    if (!existsSync(briefPath)) {
      console.error(c.red(`Brief file not found: ${briefPath}`));
      process.exit(1);
    }
  }

  // ── Resolve workflow directory ───────────────────────────────
  const workflowsDir = (args.flags["workflow-dir"] as string)
    ? resolve(process.cwd(), args.flags["workflow-dir"] as string)
    : join(coreDir, "workflows");

  // ── Validate brief against profile ───────────────────────────
  const { loadProfile, loadWorkflow, validateBrief } = await import("@aos-harness/runtime/config-loader");
  const profile = loadProfile(profileDir);
  const validation = validateBrief(briefPath, profile.input.required_sections);

  // ── Detect execution profile (has workflow field) ──────────
  const isExecutionProfile = !!profile.workflow;
  let workflowConfig: Awaited<ReturnType<typeof loadWorkflow>> | null = null;

  if (isExecutionProfile) {
    // Resolve workflow file from workflowsDir
    const workflowId = profile.workflow!;
    const workflowFile = join(workflowsDir, `${workflowId.replace(/-workflow$/, "")}.workflow.yaml`);
    const workflowFileAlt = join(workflowsDir, `${workflowId}.workflow.yaml`);

    if (existsSync(workflowFile)) {
      workflowConfig = loadWorkflow(workflowFile);
    } else if (existsSync(workflowFileAlt)) {
      workflowConfig = loadWorkflow(workflowFileAlt);
    } else {
      // Try loading by the raw ID name
      const candidates = existsSync(workflowsDir)
        ? readdirSync(workflowsDir).filter((f) => f.endsWith(".workflow.yaml"))
        : [];
      const match = candidates.find((f) => {
        const loaded = loadWorkflow(join(workflowsDir, f));
        return loaded.id === workflowId;
      });
      if (match) {
        workflowConfig = loadWorkflow(join(workflowsDir, match));
      } else {
        console.error(c.red(`Workflow "${workflowId}" not found in ${workflowsDir}`));
        console.error(c.yellow(`Available workflow files: ${candidates.join(", ") || "none"}`));
        process.exit(1);
      }
    }
  }

  if (!validation.valid) {
    console.error(c.red("Brief validation failed. Missing required sections:"));
    for (const section of validation.missing) {
      console.error(c.red(`  - ${section.heading}: ${section.guidance}`));
    }
    console.error(c.yellow(`\nAdd the missing sections to your brief and try again.`));
    process.exit(1);
  }

  // ── Dry-run mode ─────────────────────────────────────────────
  if (args.flags["dry-run"]) {
    const { readFileSync } = await import("node:fs");
    const briefContent = readFileSync(briefPath, "utf-8");
    const briefSections = briefContent.match(/^##\s+.+/gm) || [];

    const agentIds = [
      profile.assembly.orchestrator,
      ...profile.assembly.perspectives.map((p: { agent: string }) => p.agent),
    ];
    const requiredCount = profile.assembly.perspectives.filter((p: { required: boolean }) => p.required).length;
    const optionalCount = profile.assembly.perspectives.length - requiredCount;

    const constraints = profile.constraints;
    const budgetMin = constraints.budget ? `$${constraints.budget.min.toFixed(2)}` : "N/A (unmetered)";
    const budgetMax = constraints.budget ? `$${constraints.budget.max.toFixed(2)}` : "N/A (unmetered)";

    let workflowSection = "";
    if (isExecutionProfile && workflowConfig) {
      const stepSummary = workflowConfig.steps
        .map((s: { id: string; name: string; action: string; review_gate?: boolean }) =>
          `    ${s.id.padEnd(20)} ${s.name.padEnd(30)} ${s.action}${s.review_gate ? " [gate]" : ""}`
        )
        .join("\n");
      const gateCount = workflowConfig.gates?.length || 0;
      workflowSection = `
${c.bold("Workflow")} ${c.magenta("(execution profile)")}
  ID:             ${c.cyan(workflowConfig.id)}
  Name:           ${workflowConfig.name}
  Steps:          ${workflowConfig.steps.length}
  Gates:          ${gateCount}
  Workflows dir:  ${workflowsDir}

${c.bold("  Step Details")}
${stepSummary}
`;
    }

    console.log(`
${c.bold("DRY RUN — Simulation Summary")}

${c.bold("Profile")}
  Name:           ${c.cyan(profile.name)}
  ID:             ${profile.id}
  Type:           ${isExecutionProfile ? c.magenta("execution") : c.cyan("deliberation")}
  Description:    ${profile.description || "none"}

${c.bold("Assembly")}
  Orchestrator:   ${c.cyan(profile.assembly.orchestrator)}
  Agents:         ${agentIds.length} total (1 orchestrator + ${requiredCount} required + ${optionalCount} optional)
  Agent IDs:      ${agentIds.join(", ")}

${c.bold("Constraints")}
  Time:           ${constraints.time.min_minutes}–${constraints.time.max_minutes} minutes
  Budget:         ${budgetMin}–${budgetMax}
  Rounds:         ${constraints.rounds.min}–${constraints.rounds.max}

${c.bold("Delegation")}
  Default:        ${profile.delegation.default}
  Tension pairs:  ${profile.delegation.tension_pairs.length}
  Bias limit:     ${profile.delegation.bias_limit}
  Opening rounds: ${profile.delegation.opening_rounds}
${workflowSection}
${c.bold("Brief")}
  Path:           ${briefPath}
  Sections found: ${briefSections.length > 0 ? briefSections.map((s: string) => s.replace(/^##\s+/, "")).join(", ") : "none"}

${c.bold("Domain")}
  Domain:         ${domainName || "none"}

${c.bold("Estimated Cost Range")}
  Minimum:        ${budgetMin}
  Maximum:        ${budgetMax}

${c.green("All configuration validated successfully. Ready to launch.")}
`);
    process.exit(0);
  }

  // ── Set up deliberation directory for artifact storage ──────
  const sessionId = `${new Date().toISOString().slice(0, 10)}-${profileName}-${Date.now().toString(36)}`;
  const deliberationDir = join(root, ".aos", "sessions", sessionId);
  mkdirSync(deliberationDir, { recursive: true });

  // ── Launch adapter ───────────────────────────────────────────
  const sessionType = isExecutionProfile ? "Execution" : "Deliberation";
  console.log(`
${c.bold(`AOS ${sessionType} Session`)}
  Profile:  ${c.cyan(profileName!)}
  Type:     ${isExecutionProfile ? c.magenta("execution") : c.cyan("deliberation")}${isExecutionProfile && workflowConfig ? `\n  Workflow: ${c.magenta(workflowConfig.id)} (${workflowConfig.steps.length} steps)` : ""}
  Domain:   ${c.cyan(domainName || "none")}
  Brief:    ${c.cyan(briefPath)}
  Output:   ${c.cyan(deliberationDir)}
`);

  // Check for .aos/config.yaml to determine adapter
  let platformUrl = (args.flags["platform-url"] as string) || null;
  const aosConfigPath = join(process.cwd(), ".aos", "config.yaml");
  let adapter = "pi";
  if (existsSync(aosConfigPath)) {
    const yaml = await import("js-yaml");
    const configText = await Bun.file(aosConfigPath).text();
    const config = yaml.load(configText, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
    adapter = (config.adapter as string) || "pi";
    if (!platformUrl && config?.platform && (config.platform as Record<string, unknown>)?.enabled && (config.platform as Record<string, unknown>)?.url) {
      platformUrl = (config.platform as Record<string, unknown>).url as string;
    }
  }

  const adapterName = adapter === "claude-code" ? "claude-code" : adapter;
  // Resolve adapter from: 1) project dir, 2) installed package, 3) monorepo
  const resolvedAdapterDir = existsSync(join(root, "adapters", adapterName, "src", "index.ts"))
    ? join(root, "adapters", adapterName)
    : getAdapterDir(adapterName);

  if (adapter === "pi") {
    const adapterEntry = resolvedAdapterDir ? join(resolvedAdapterDir, "src", "index.ts") : null;
    if (!adapterEntry || !existsSync(adapterEntry)) {
      console.error(c.red(`Pi adapter not found.`));
      console.error(c.yellow("Make sure Pi CLI is installed: https://github.com/pi-agi/pi"));
      console.error(c.dim("The adapter should be bundled with aos-harness. Try reinstalling: bun add -g aos-harness"));
      process.exit(1);
    }

    console.log(c.dim(`Launching Pi adapter...`));
    console.log(c.dim(`  pi -e ${adapterEntry}`));
    console.log();

    // Set environment variables for the adapter
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      AOS_PROFILE: profileName!,
      AOS_BRIEF: briefPath,
      AOS_HARNESS_ROOT: root,
      AOS_SESSION_ID: sessionId,
      AOS_DELIBERATION_DIR: deliberationDir,
    };
    if (domainName) {
      env.AOS_DOMAIN = domainName;
    }
    if (args.flags.verbose) {
      env.AOS_VERBOSE = "1";
    }
    if (platformUrl) {
      env.AOS_PLATFORM_URL = platformUrl;
    }
    if (isExecutionProfile && workflowConfig) {
      env.AOS_WORKFLOW_ID = workflowConfig.id;
      env.AOS_WORKFLOWS_DIR = workflowsDir;
    }

    const proc = Bun.spawn(["pi", "-e", adapterEntry], {
      cwd: root,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log(`\n${c.green("Session complete.")} Output: ${c.cyan(deliberationDir)}`);
    }
    process.exit(exitCode);
  } else {
    const adapterConfig = readAdapterConfig(root);
    await runAdapterSession({
      platform: adapter,
      profileDir: profileDir!,
      briefPath,
      domainName,
      root,
      sessionId,
      deliberationDir,
      verbose: !!args.flags.verbose,
      workflowConfig: isExecutionProfile ? workflowConfig : null,
      workflowsDir,
      modelOverrides: adapterConfig?.model_overrides,
    });
  }
}
