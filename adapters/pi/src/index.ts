// ── AOS Harness Pi Extension Entry Point ──────────────────────
// Wires all 4 adapter layers together and makes the AOS Harness
// runnable as a Pi extension.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname, basename } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { PiAgentRuntime } from "./agent-runtime";
import { PiEventBus } from "./event-bus";
import { PiUI } from "./ui";
import { BaseWorkflow, composeAdapter, discoverAgents, createFlatAgentsDir, findProjectRoot } from "@aos-harness/adapter-shared";

import { AOSEngine } from "@aos-harness/runtime";
import type { AOSAdapter, ConstraintState, ProfileConfig } from "@aos-harness/runtime/types";
import { resolveTemplate } from "@aos-harness/runtime/template-resolver";
import { validateBrief } from "@aos-harness/runtime/config-loader";
export { probeAdapterInfo } from "@aos-harness/adapter-shared";

// ── Helpers ─────────────────────────────────────────────────────

/** List subdirectories that contain a given file. */
function listDirsWithFile(parentDir: string, fileName: string): { name: string; dir: string; mtime: number }[] {
  if (!existsSync(parentDir)) return [];
  try {
    return readdirSync(parentDir)
      .filter((f) => {
        const full = join(parentDir, f);
        return statSync(full).isDirectory() && existsSync(join(full, fileName));
      })
      .map((f) => {
        const filePath = join(parentDir, f, fileName);
        return { name: f, dir: join(parentDir, f), mtime: statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/** Render a progress bar with color coding. */
function renderGauge(
  label: string,
  current: number,
  min: number,
  max: number,
  barWidth: number,
  currentLabel: string,
  rangeLabel: string,
  totalWidth: number,
): string {
  const ratio = max > 0 ? Math.min(current / max, 1) : 0;
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;

  // Color: cyan below min, green at min-80%, yellow at 80%+, pink/red at max
  let colorCode: string;
  if (current < min) {
    colorCode = "36"; // cyan
  } else if (ratio < 0.8) {
    colorCode = "32"; // green
  } else if (ratio < 1) {
    colorCode = "33"; // yellow
  } else {
    colorCode = "35"; // pink/magenta
  }

  const bar = `\x1b[${colorCode}m${"█".repeat(filled)}${"░".repeat(empty)}\x1b[0m`;
  const padLabel = label.padEnd(8);
  const line = `  ${padLabel}[${bar}]  ${currentLabel.padEnd(12)}${rangeLabel}`;
  return line;
}

/** Write transcript entries as JSONL. */
function writeTranscript(sessionDir: string, transcript: unknown[]): void {
  mkdirSync(sessionDir, { recursive: true });
  const transcriptPath = join(sessionDir, "transcript.jsonl");
  const lines = transcript.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(transcriptPath, lines, "utf-8");
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Shared state ────────────────────────────────────────────
  let projectRoot: string | null = null;
  let engine: AOSEngine | null = null;
  let sessionActive = false;
  let resolvedArbiterPrompt: string | null = null;
  let arbiterCost = 0;
  let sessionStartTime = 0;
  let sessionId = "";
  let briefPath = "";
  let memoPath = "";
  let participantNames: string[] = [];
  let constraintState: ConstraintState | null = null;

  // ── Adapter layer instances ─────────────────────────────────
  const eventBus = new PiEventBus();
  const agentRuntime = new PiAgentRuntime(eventBus);
  const ui = new PiUI(pi);
  const workflow = new BaseWorkflow(agentRuntime);

  let extensionCtx: any = null;

  // ── 1. session_start — initialization ─────────────────────

  pi.on("session_start", async (_event, ctx) => {
    extensionCtx = ctx;
    ui.setContext(ctx);

    // Discover project root
    projectRoot = findProjectRoot(ctx.cwd);

    // Apply theme
    if (ctx.hasUI) {
      ctx.ui.setTheme("synthwave");
      setTimeout(() => ctx.ui.setTitle("AOS Harness"), 150);
    }

    // Wire event bus to Pi lifecycle
    eventBus.wire(pi);

    if (!projectRoot) {
      ctx.ui.notify(
        "AOS Harness loaded but no project root found (no core/ directory). Navigate to an AOS project and restart.",
        "warning",
      );
      return;
    }

    // Count available profiles and agents
    const profilesDir = join(projectRoot, "core", "profiles");
    const profiles = listDirsWithFile(profilesDir, "profile.yaml");
    const agentsDir = join(projectRoot, "core", "agents");
    const agentMap = discoverAgents(agentsDir);

    ctx.ui.setStatus("aos", "AOS Harness ready");
    ctx.ui.notify(
      `AOS Harness initialized\nProject: ${projectRoot}\nProfiles: ${profiles.length} | Agents: ${agentMap.size}\n\nRun /aos-run to start a deliberation.`,
      "info",
    );

    // Auto-start session if CLI passed environment variables
    const autoProfile = process.env.AOS_PROFILE;
    const autoBrief = process.env.AOS_BRIEF;
    if (autoProfile && autoBrief && projectRoot) {
      // Defer to let Pi finish initialization, then send the command as user message
      setTimeout(() => {
        pi.sendUserMessage("/aos-run");
      }, 500);
    }
  });

  // ── 2. /aos-run command — main entry point ────────────────

  pi.registerCommand("aos-run", {
    description: "Start an AOS multi-agent deliberation session",
    handler: async (_args, ctx) => {
      if (!projectRoot) {
        ctx.ui.notify("No AOS project root found. Ensure a core/ directory exists.", "error");
        return;
      }

      if (sessionActive) {
        ctx.ui.notify("A session is already active. Type 'halt' to stop or 'wrap' to end early.", "warning");
        return;
      }

      // ── Check for CLI-provided env vars (auto-start mode) ──
      const envProfile = process.env.AOS_PROFILE;
      const envBrief = process.env.AOS_BRIEF;
      const envDomain = process.env.AOS_DOMAIN;
      const envSessionId = process.env.AOS_SESSION_ID;
      const autoMode = !!(envProfile && envBrief);

      let profileDir: string;
      let selectedDomain: string | undefined;
      let domainDir: string | undefined;

      if (autoMode) {
        // CLI provided profile and brief via env vars — skip interactive selection
        profileDir = join(projectRoot, "core", "profiles", envProfile);
        if (!existsSync(join(profileDir, "profile.yaml"))) {
          ctx.ui.notify(`Profile not found: ${envProfile}`, "error");
          return;
        }
        briefPath = envBrief;
        if (!existsSync(briefPath)) {
          ctx.ui.notify(`Brief not found: ${briefPath}`, "error");
          return;
        }
        if (envDomain) {
          selectedDomain = envDomain;
          domainDir = join(projectRoot, "core", "domains", envDomain);
          if (!existsSync(join(domainDir, "domain.yaml"))) {
            ctx.ui.notify(`Domain not found: ${envDomain}`, "warning");
            selectedDomain = undefined;
            domainDir = undefined;
          }
        }
        if (envSessionId) {
          sessionId = envSessionId;
        }
      } else {
        // Interactive mode — select profile, brief, domain via UI
        // ── Select profile ────────────────────────────────────
        const profilesDir = join(projectRoot, "core", "profiles");
        const profiles = listDirsWithFile(profilesDir, "profile.yaml");

        if (profiles.length === 0) {
          ctx.ui.notify(
            "No profiles found in core/profiles/.\nCreate a directory with a profile.yaml file.",
            "warning",
          );
          return;
        }

        const profileNames = profiles.map((p) => p.name);
        let profileIdx: number;
        if (profiles.length === 1) {
          profileIdx = 0;
        } else {
          const selected = await ctx.ui.select("Select a profile:", profileNames);
          profileIdx = typeof selected === "number" ? selected : Number(selected);
        }
        if (profileIdx === undefined || profileIdx === null || profileIdx < 0) {
          ctx.ui.notify("No profile selected. Cancelled.", "info");
          return;
        }
        const selectedProfile = profiles[profileIdx];
        profileDir = selectedProfile.dir;

        // ── Select brief ──────────────────────────────────────
        const briefsDir = join(projectRoot, "core", "briefs");
        const briefs = listDirsWithFile(briefsDir, "brief.md");

        if (briefs.length === 0) {
          ctx.ui.notify(
            "No briefs found in core/briefs/.\nCreate a directory containing a brief.md file.",
            "warning",
          );
          return;
        }

        const briefNames = briefs.map((b) => b.name);
        let briefIdx: number;
        if (briefs.length === 1) {
          briefIdx = 0;
        } else {
          const selected = await ctx.ui.select("Select a brief:", briefNames);
          briefIdx = typeof selected === "number" ? selected : Number(selected);
        }
        if (briefIdx === undefined || briefIdx === null || briefIdx < 0) {
          ctx.ui.notify("No brief selected. Cancelled.", "info");
          return;
        }
        const selectedBrief = briefs[briefIdx];
        briefPath = join(selectedBrief.dir, "brief.md");

        // ── Optionally select domain ──────────────────────────
        const domainsDir = join(projectRoot, "core", "domains");

        if (existsSync(domainsDir)) {
          const domains = listDirsWithFile(domainsDir, "domain.yaml");
          if (domains.length > 0) {
            const domainNames = ["(none)", ...domains.map((d) => d.name)];
            const rawDomainIdx = await ctx.ui.select("Select a domain (optional):", domainNames);
            const domainIdx = typeof rawDomainIdx === "number" ? rawDomainIdx : Number(rawDomainIdx);
            if (domainIdx > 0) {
              selectedDomain = domains[domainIdx - 1].name;
              domainDir = domains[domainIdx - 1].dir;
            }
          }
        }
      }

      // ── Discover agents and create flat directory ─────────
      const agentsDir = join(projectRoot, "core", "agents");
      const agentMap = discoverAgents(agentsDir);
      const flatAgentsDir = createFlatAgentsDir(projectRoot, agentMap);

      // ── Compose adapter ───────────────────────────────────
      const adapter = composeAdapter(agentRuntime, eventBus, ui, workflow);

      // ── Create engine ─────────────────────────────────────
      try {
        engine = new AOSEngine(adapter, profileDir, {
          agentsDir: flatAgentsDir,
          domain: selectedDomain,
          domainDir: selectedDomain ? domainsDir : undefined,
        });
      } catch (err: any) {
        ctx.ui.notify(`Failed to create engine: ${err.message}`, "error");
        return;
      }

      // ── Start engine (validate brief) ─────────────────────
      try {
        await engine.start(briefPath);
      } catch (err: any) {
        ctx.ui.notify(`Failed to start session: ${err.message}`, "error");
        engine = null;
        return;
      }

      sessionActive = true;
      sessionStartTime = Date.now();
      sessionId = `session-${randomUUID().slice(0, 12)}`;
      arbiterCost = 0;

      // Read profile to get participant names
      try {
        const profileRaw = readFileSync(join(profileDir, "profile.yaml"), "utf-8");
        const idMatches = profileRaw.match(/agent:\s*(\w+)/g);
        participantNames = idMatches
          ? idMatches.map((m) => m.replace("agent: ", "").replace("agent:", "").trim())
          : [];
      } catch {
        participantNames = [];
      }

      // Determine memo output path
      const briefSlug = autoMode
        ? basename(briefPath, ".md").replace(/\s+/g, "-").toLowerCase()
        : basename(briefPath, ".md").replace(/\s+/g, "-").toLowerCase();
      const dateStr = new Date().toISOString().split("T")[0];
      const memoDir = join(projectRoot, "output", "memos", `${dateStr}-${briefSlug}-${sessionId}`);
      mkdirSync(memoDir, { recursive: true });
      memoPath = join(memoDir, "memo.md");

      // ── Load Arbiter prompt and resolve template ──────────
      const arbiterDir = agentMap.get("arbiter");
      if (arbiterDir) {
        const promptPath = join(arbiterDir, "prompt.md");
        if (existsSync(promptPath)) {
          const rawPrompt = readFileSync(promptPath, "utf-8");
          const briefContent = readFileSync(briefPath, "utf-8");

          // Resolve template variables using spec-compliant underscore names (Section 6.13)
          // Also include hyphenated aliases for backward compatibility
          const briefSlugValue = briefSlug;
          const constraintsStr = `${profileRaw.match(/min_minutes:\s*(\d+)/)?.[1] ?? "?"}-${profileRaw.match(/max_minutes:\s*(\d+)/)?.[1] ?? "?"} min`;
          const deliberationDirPath = join(projectRoot, ".aos", "sessions", sessionId);
          const transcriptFilePath = join(deliberationDirPath, "transcript.jsonl");

          const templateVars: Record<string, string> = {
            // Spec-compliant underscore names (Section 6.13)
            session_id: sessionId,
            brief_slug: briefSlugValue,
            brief: briefContent,
            format: "brief",
            agent_id: "arbiter",
            agent_name: "Arbiter",
            participants: participantNames.join(", "),
            constraints: constraintsStr,
            expertise_block: "",
            output_path: memoPath,
            deliberation_dir: deliberationDirPath,
            transcript_path: transcriptFilePath,
            // Hyphenated aliases for backward compatibility
            "session-id": sessionId,
            "brief-content": briefContent,
            "output-path": memoPath,
            "deliberation-dir": deliberationDirPath,
            "memo-path": memoPath,
            "date": dateStr,
          };

          resolvedArbiterPrompt = resolveTemplate(rawPrompt, templateVars);
        }
      }

      // ── Set up constraint gauge widget ────────────────────
      registerConstraintGauges();

      // ── Block input (allow only halt and wrap) ────────────
      ui.blockInput(["halt", "wrap"]);

      const profileDisplayName = autoMode ? envProfile : basename(profileDir);
      const briefDisplayName = autoMode ? basename(briefPath) : basename(briefPath);
      ctx.ui.setStatus("aos", `AOS: ${profileDisplayName} | ${briefDisplayName}`);
      ctx.ui.notify(
        `Deliberation started!\nProfile: ${profileDisplayName}\nBrief: ${briefDisplayName}\nMemo: ${memoPath}\n\nType 'halt' to stop or 'wrap' to end early.`,
        "info",
      );

      // ── Kick off the Arbiter ──────────────────────────────
      const briefContent = readFileSync(briefPath, "utf-8");
      const kickoff =
        "Read the brief below and begin the multi-agent deliberation. " +
        "Use the `delegate` tool to engage perspective agents and `end` when ready to wrap up.\n\n" +
        `---\n\n## Brief\n\n${briefContent}`;

      pi.sendUserMessage(kickoff);
    },
  });

  // ── Constraint gauge widget ───────────────────────────────

  function registerConstraintGauges() {
    if (!extensionCtx || !engine) return;

    // Remove then re-add to keep at end of widget order
    extensionCtx.ui.setWidget("aos-constraint-gauges", undefined);
    extensionCtx.ui.setWidget("aos-constraint-gauges", () => ({
      render(width: number): string[] {
        if (!engine || !sessionActive) return [];

        const cs = engine.getConstraintState();
        constraintState = cs;

        const barWidth = Math.max(10, width - 39);
        const lines: string[] = [""];

        // TIME gauge
        lines.push(renderGauge(
          "TIME",
          cs.elapsed_minutes,
          2, // will be overridden by profile
          10, // will be overridden by profile
          barWidth,
          `${cs.elapsed_minutes.toFixed(1)} min`,
          "time",
          width,
        ));

        // BUDGET gauge (if metered)
        if (cs.metered) {
          lines.push(renderGauge(
            "BUDGET",
            cs.budget_spent,
            1,
            10,
            barWidth,
            `$${cs.budget_spent.toFixed(2)}`,
            "budget",
            width,
          ));
        }

        // ROUNDS gauge
        lines.push(renderGauge(
          "ROUNDS",
          cs.rounds_completed,
          2,
          8,
          barWidth,
          `${cs.rounds_completed}`,
          "rounds",
          width,
        ));

        lines.push("");
        return lines;
      },
      invalidate() {},
    }));
  }

  // ── 3. delegate tool ──────────────────────────────────────

  pi.registerTool({
    name: "delegate",
    label: "Delegate",
    description:
      "Send a message to one or more perspective agents. Use `to` to address specific agents by ID, an array of IDs, or \"all\" to broadcast. Returns their responses and the current constraint state.",
    promptSnippet:
      'Delegate to perspective agents. to: agent id, array of ids, or "all". Returns responses + constraint state.',
    promptGuidelines: [
      'Default to delegate("all", message) to broadcast. Only use targeted delegation for follow-ups.',
      'Do NOT loop through agents individually — use "all" to let all agents respond in one call.',
      "Check constraint_state in every response: if hit_maximum is true, call end() immediately.",
      "If approaching_any_maximum, start wrapping up the deliberation.",
    ],
    parameters: Type.Object({
      to: Type.Union([Type.String(), Type.Array(Type.String())], {
        description: 'Agent ID, array of IDs, or "all" to address all perspectives',
      }),
      message: Type.String({
        description: "The Arbiter's question, challenge, follow-up, or directive to the agents",
      }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!engine || !sessionActive) {
        throw new Error("No active deliberation. Use /aos-run to start a session.");
      }

      // Pre-check constraints
      const preCs = engine.getConstraintState();
      if (preCs.hit_maximum) {
        throw new Error(
          "Constraint limit reached. You MUST call end() immediately.",
        );
      }

      const { to, message } = params;

      // Dispatch via engine
      let responses;
      try {
        responses = await engine.delegateMessage(to as string | string[], message as string);
      } catch (err: any) {
        throw new Error(`Delegation failed: ${err.message}`);
      }

      // Update constraint state
      const cs = engine.getConstraintState();
      constraintState = cs;

      // Re-register gauges to reflect new state
      registerConstraintGauges();

      // Build return text
      let resultText = "";
      const responseList: { agent: string; response: string; cost: number }[] = [];

      // Map responses back to agent IDs
      const targetIds = to === "all"
        ? participantNames.filter((n) => n !== "arbiter")
        : Array.isArray(to) ? to as string[] : [to as string];

      for (let i = 0; i < responses.length; i++) {
        const resp = responses[i];
        const agentId = targetIds[i] || `agent-${i}`;
        resultText += `\n\n### ${agentId}\n${resp.text}`;
        responseList.push({ agent: agentId, response: resp.text, cost: resp.cost });
      }

      // Build structured constraint message per spec Section 6.11
      const roundNum = cs.rounds_completed;
      const timeMax = 10; // Will be overridden by actual profile constraints
      const budgetMax = 10; // Will be overridden by actual profile constraints
      const roundsMax = 8; // Will be overridden by actual profile constraints
      const timePct = timeMax > 0 ? Math.round((cs.elapsed_minutes / timeMax) * 100) : 0;
      const budgetPct = budgetMax > 0 ? Math.round((cs.budget_spent / budgetMax) * 100) : 0;
      const roundsPct = roundsMax > 0 ? Math.round((roundNum / roundsMax) * 100) : 0;

      resultText += `\n\n---\n\n## Deliberation Status — Round ${roundNum}\n`;
      resultText += `\n### Constraints\n`;
      resultText += `- **Time:** ${cs.elapsed_minutes.toFixed(1)} / ${timeMax.toFixed(1)} min (${timePct}%)\n`;
      if (cs.metered) {
        resultText += `- **Budget:** $${cs.budget_spent.toFixed(2)} / $${budgetMax.toFixed(2)} (${budgetPct}%)\n`;
      }
      resultText += `- **Rounds:** ${roundNum} / ${roundsMax} (${cs.past_all_minimums ? "minimums met" : "minimums not met"})\n`;
      if (cs.bias_ratio > 0) {
        resultText += `- **Bias:** ${cs.bias_ratio.toFixed(0)}:1 (limit 5)\n`;
      }

      resultText += `\n### Available Actions\n`;
      resultText += `- delegate("all", "message") — broadcast\n`;
      resultText += `- delegate(["agent-a", "agent-b"], "message") — targeted\n`;
      resultText += `- end("closing message") — end deliberation\n`;

      // Conditional warning/limit messages
      if (cs.hit_maximum) {
        resultText += `\n**[LIMIT REACHED]** Maximum hit (${cs.hit_reason}). You **MUST** call \`end()\` immediately to close the deliberation.\n`;
      } else if (cs.approaching_any_maximum) {
        const warnings: string[] = [];
        if (cs.approaching_max_time) warnings.push("time");
        if (cs.approaching_max_budget) warnings.push("budget");
        if (cs.approaching_max_rounds) warnings.push("rounds");
        resultText += `\n**[WARNING]** Approaching maximum: ${warnings.join(", ")}. Begin wrapping up — target the most important unresolved tension, then close.\n`;
      }
      if (cs.bias_blocked) {
        resultText += `\n**[BIAS BLOCKED]** Over-addressed certain agents. Target neglected agents first: ${cs.least_addressed.join(", ")}.\n`;
      }

      return {
        content: [{ type: "text" as const, text: resultText.trim() }],
        details: { responses: responseList, constraintState: cs },
      };
    },

    renderCall(args, theme) {
      const toStr =
        typeof args.to === "string"
          ? args.to
          : Array.isArray(args.to)
            ? (args.to as string[]).join(", ")
            : "...";
      const msgPreview =
        args.message && (args.message as string).length > 80
          ? (args.message as string).slice(0, 80) + "..."
          : (args.message as string) || "...";
      let text = theme.fg("toolTitle", theme.bold("delegate "));
      text += theme.fg("accent", `Arbiter -> ${toStr}`);
      text += "\n  " + theme.fg("dim", msgPreview);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as
        | { responses?: { agent: string; response: string; cost: number }[]; constraintState?: ConstraintState }
        | undefined;
      const responses = details?.responses || [];
      const cs = details?.constraintState;

      let text = theme.fg("success", `${responses.length} response(s)`);
      if (cs) {
        text += theme.fg("muted", ` | ${cs.elapsed_minutes.toFixed(1)}min | $${cs.budget_spent.toFixed(2)} | R${cs.rounds_completed}`);
        if (cs.hit_maximum) text += " " + theme.fg("error", "[MAX REACHED]");
        else if (cs.approaching_any_maximum) text += " " + theme.fg("warning", "[APPROACHING MAX]");
      }

      if (expanded) {
        for (const r of responses) {
          text += `\n\n${theme.fg("accent", theme.bold(r.agent))}${theme.fg("dim", ` ($${r.cost.toFixed(4)})`)}`;
          text += `\n${theme.fg("dim", r.response)}`;
        }
      } else {
        for (const r of responses) {
          const preview =
            r.response.length > 100 ? r.response.slice(0, 100) + "..." : r.response;
          text += `\n  ${theme.fg("accent", r.agent)}: ${theme.fg("dim", preview.replace(/\n/g, " "))}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── 4. end tool ───────────────────────────────────────────

  pi.registerTool({
    name: "end",
    label: "End Deliberation",
    description:
      "End the deliberation and collect final statements from all agents. After this tool returns, write the memo.",
    promptSnippet:
      "End deliberation. Collects final statements from all agents. Then write the memo.",
    promptGuidelines: [
      "Call end() when hit_maximum is true, or when you have sufficient discussion to make a decision.",
      "After end() returns, write the memo to the specified output path using the write tool.",
    ],
    parameters: Type.Object({
      message: Type.String({
        description: "The Arbiter's closing prompt (e.g., 'Provide your final position in one concise statement.')",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!engine || !sessionActive) {
        throw new Error("No active deliberation to end.");
      }

      let responses;
      try {
        responses = await engine.end(params.message as string);
      } catch (err: any) {
        throw new Error(`Failed to end deliberation: ${err.message}`);
      }

      // Build result
      const finalStatements: { agent: string; response: string }[] = [];
      const targetIds = participantNames.filter((n) => n !== "arbiter");

      let resultText = "## Final Statements\n";
      for (let i = 0; i < responses.length; i++) {
        const agentId = targetIds[i] || `agent-${i}`;
        resultText += `\n### ${agentId}\n${responses[i].text}\n`;
        finalStatements.push({ agent: agentId, response: responses[i].text });
      }

      const elapsedMinutes = (Date.now() - sessionStartTime) / 60000;
      const totalCost = engine.getConstraintState().budget_spent;

      resultText += `\n---\n\nDeliberation complete. Elapsed: ${elapsedMinutes.toFixed(1)} min, Cost: $${totalCost.toFixed(2)}.`;
      resultText += `\nNow write the memo to: ${memoPath}`;

      // Persist transcript
      if (projectRoot) {
        const sessionDir = join(projectRoot, ".aos", "sessions", sessionId);
        writeTranscript(sessionDir, engine.getTranscript());
      }

      return {
        content: [{ type: "text" as const, text: resultText }],
        details: { finalStatements, elapsedMinutes, totalCost },
      };
    },

    renderCall(args, theme) {
      const preview =
        args.message && (args.message as string).length > 80
          ? (args.message as string).slice(0, 80) + "..."
          : (args.message as string) || "...";
      let text = theme.fg("toolTitle", theme.bold("end "));
      text += theme.fg("warning", "Closing deliberation");
      text += "\n  " + theme.fg("dim", preview);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as
        | { finalStatements?: { agent: string; response: string }[]; elapsedMinutes?: number; totalCost?: number }
        | undefined;
      const statements = details?.finalStatements || [];
      const elapsed = details?.elapsedMinutes || 0;
      const cost = details?.totalCost || 0;

      let text = theme.fg("success", `Deliberation ended. ${statements.length} final statement(s).`);
      text += theme.fg("muted", ` | ${elapsed.toFixed(1)}min | $${cost.toFixed(2)}`);

      if (expanded) {
        for (const stmt of statements) {
          text += `\n\n${theme.fg("accent", theme.bold(stmt.agent))}`;
          text += `\n${theme.fg("dim", stmt.response)}`;
        }
      } else {
        for (const stmt of statements) {
          const preview =
            stmt.response.length > 80 ? stmt.response.slice(0, 80) + "..." : stmt.response;
          text += `\n  ${theme.fg("accent", stmt.agent)}: ${theme.fg("dim", preview.replace(/\n/g, " "))}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── 5. Input handler ──────────────────────────────────────

  pi.on("input", async (event, ctx) => {
    // Always let extension-sourced messages through
    if ((event as any).source === "extension") {
      return { action: "continue" as const };
    }

    if (ui.isInputBlocked()) {
      const text = (event as any).text?.trim().toLowerCase() || "";

      if (text === "halt") {
        // Abort session
        agentRuntime.abort();
        if (engine && projectRoot) {
          const sessionDir = join(projectRoot, ".aos", "sessions", sessionId);
          writeTranscript(sessionDir, engine.getTranscript());
        }
        sessionActive = false;
        engine = null;
        ui.unblockInput();
        ctx.abort();
        ctx.ui.notify("Deliberation halted by user. Transcript saved.", "warning");
        return { action: "handled" as const };
      }

      if (text === "wrap") {
        ctx.ui.notify("Wrapping up deliberation...", "info");
        const steerMsg = "The user has requested an early wrap-up. Call end() now with a closing prompt to collect final statements from all agents.";
        pi.sendUserMessage(steerMsg, { deliverAs: "steer" });

        // Add steer event to transcript (spec Section 5G / Gap #10)
        if (engine) {
          engine.pushTranscript({
            type: "steer",
            timestamp: new Date().toISOString(),
            source: "user_command",
            command: "wrap",
            message: steerMsg,
          });
        }

        return { action: "handled" as const };
      }

      ctx.ui.notify(
        "Session in progress. Type 'halt' to stop or 'wrap' to end early.",
        "info",
      );
      return { action: "handled" as const };
    }

    // Not blocked — let input through
    return { action: "continue" as const };
  });

  // ── 6. before_agent_start — inject Arbiter system prompt ──

  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!sessionActive || !resolvedArbiterPrompt) {
      return undefined;
    }

    return {
      systemPrompt: resolvedArbiterPrompt,
    };
  });

  // ── 7. tool_result — memo frontmatter injection ───────────

  pi.on("tool_result", async (event, ctx) => {
    if (!sessionActive) return;
    if (event.toolName !== "write") return;

    const input = event.input as { file_path?: string; path?: string } | undefined;
    const filePath = input?.file_path || input?.path || "";

    // Only inject frontmatter into memo files
    if (!filePath.includes("memo")) return;
    if (!filePath.endsWith(".md")) return;

    // Read the file that was just written
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    // Skip if it already has frontmatter
    if (content.startsWith("---\n")) return;

    // Build YAML frontmatter
    const elapsedMs = Date.now() - sessionStartTime;
    const durationMinutes = Math.round(elapsedMs / 1000 / 60 * 10) / 10;
    const totalCost = engine ? engine.getConstraintState().budget_spent : 0;
    const transcriptPath = projectRoot
      ? join(".aos", "sessions", sessionId, "transcript.jsonl")
      : "";

    let frontmatter = "---\n";
    frontmatter += `title: "Deliberation Memo"\n`;
    frontmatter += `date: ${new Date().toISOString().split("T")[0]}\n`;
    frontmatter += `duration: ${durationMinutes} minutes\n`;
    frontmatter += `budget_used: $${totalCost.toFixed(2)}\n`;
    frontmatter += `participants:\n`;
    for (const name of participantNames) {
      frontmatter += `  - ${name}\n`;
    }
    frontmatter += `brief_path: ${briefPath}\n`;
    frontmatter += `transcript_path: ${transcriptPath}\n`;
    frontmatter += "---\n\n";

    // Prepend frontmatter
    writeFileSync(filePath, frontmatter + content, "utf-8");

    // Unblock input
    ui.unblockInput();
    sessionActive = false;

    // Open in editor
    const editor = process.env.AOS_EDITOR || process.env.EDITOR || "code";
    try {
      workflow.openInEditor(filePath, editor);
    } catch {
      // Not critical
    }

    ctx.ui.notify(
      `Memo saved to ${filePath}\nFrontmatter injected. Opening in ${editor}.`,
      "info",
    );
  });

  // ── 8. message_end — track Arbiter cost ───────────────────

  pi.on("message_end", async (event, _ctx) => {
    if (!sessionActive) return;

    const msg = (event as any).message;
    if (msg?.role === "assistant" && msg?.usage?.cost?.total) {
      arbiterCost += msg.usage.cost.total;
    }
  });

  // ── 10. session_shutdown — cleanup ────────────────────────

  pi.on("session_shutdown", async (_event, _ctx) => {
    // Abort any active subprocesses
    agentRuntime.abort();

    // Persist transcript if session was active
    if (engine && projectRoot && sessionActive) {
      const sessionDir = join(projectRoot, ".aos", "sessions", sessionId);
      writeTranscript(sessionDir, engine.getTranscript());
    }

    sessionActive = false;
    engine = null;
  });
}
