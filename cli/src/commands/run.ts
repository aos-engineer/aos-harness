/**
 * aos run — Launch a deliberation session.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { c, type ParsedArgs } from "../colors";
import { getFrameworkRoot, discoverDirs, promptSelect } from "../utils";

const HELP = `
${c.bold("aos run")} — Run a deliberation session

${c.bold("USAGE")}
  aos run [profile] [--domain <domain>] [--brief <path>] [--verbose] [--dry-run]

${c.bold("OPTIONS")}
  --domain <name>     Domain pack to apply (e.g. saas)
  --brief <path>      Path to the brief file
  --verbose           Stream engine decisions to stderr
  --dry-run           Validate config and print simulation summary without launching

${c.bold("DESCRIPTION")}
  Launches a deliberation session using the specified profile. If no profile
  is given, lists available profiles and prompts for selection. If no brief
  is given, lists available briefs and prompts for selection.

  The session is launched via the configured adapter (default: Pi CLI).

${c.bold("EXAMPLES")}
  aos run strategic-council
  aos run strategic-council --domain saas --brief briefs/my-brief.md
  aos run strategic-council --dry-run --brief core/briefs/sample-product-decision/brief.md
  aos run  # interactive profile selection
`;

export async function runCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  const root = getFrameworkRoot();
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

  // ── Validate brief against profile ───────────────────────────
  const { loadProfile, validateBrief } = await import("../../../runtime/src/config-loader");
  const profile = loadProfile(profileDir);
  const validation = validateBrief(briefPath, profile.input.required_sections);

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

    console.log(`
${c.bold("DRY RUN — Simulation Summary")}

${c.bold("Profile")}
  Name:           ${c.cyan(profile.name)}
  ID:             ${profile.id}
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

  // ── Launch adapter ───────────────────────────────────────────
  console.log(`
${c.bold("AOS Deliberation Session")}
  Profile: ${c.cyan(profileName!)}
  Domain:  ${c.cyan(domainName || "none")}
  Brief:   ${c.cyan(briefPath)}
`);

  // Check for .aos/config.yaml to determine adapter
  const aosConfigPath = join(process.cwd(), ".aos", "config.yaml");
  let adapter = "pi";
  if (existsSync(aosConfigPath)) {
    const yaml = await import("js-yaml");
    const configText = await Bun.file(aosConfigPath).text();
    const config = yaml.load(configText, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
    adapter = (config.adapter as string) || "pi";
  }

  const adapterDir = join(root, "adapters", adapter === "claude-code" ? "claude-code" : adapter);

  if (adapter === "pi") {
    const adapterEntry = join(adapterDir, "src", "index.ts");
    if (!existsSync(adapterEntry)) {
      console.error(c.red(`Pi adapter not found at: ${adapterEntry}`));
      console.error(c.yellow("Make sure the Pi adapter is installed: cd adapters/pi && bun install"));
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
      AOS_FRAMEWORK_ROOT: root,
    };
    if (domainName) {
      env.AOS_DOMAIN = domainName;
    }
    if (args.flags.verbose) {
      env.AOS_VERBOSE = "1";
    }

    const proc = Bun.spawn(["pi", "-e", adapterEntry], {
      cwd: root,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    process.exit(exitCode);
  } else {
    console.log(c.yellow(`Adapter "${adapter}" is not yet fully supported in the CLI.`));
    console.log(c.dim(`The framework launched with profile="${profileName}", domain="${domainName || "none"}", brief="${briefPath}".`));
    console.log(c.dim(`Implement the ${adapter} adapter at adapters/${adapter}/ to enable full execution.`));
  }
}
