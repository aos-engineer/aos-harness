#!/usr/bin/env bun
/**
 * AOS Framework CLI — entry point.
 * Usage: aos <command> [options]
 */

import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";
import { createCommand } from "./commands/create";
import { validateCommand } from "./commands/validate";
import { listCommand } from "./commands/list";
import { c, parseArgs } from "./colors";

// ── Help ────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${c.bold("AOS Framework CLI")}

${c.bold("USAGE")}
  aos <command> [options]

${c.bold("COMMANDS")}
  ${c.cyan("init")}                          Initialize AOS in the current project
  ${c.cyan("run")} [profile]                  Run a deliberation session
  ${c.cyan("create")} agent <name>            Scaffold a new custom agent
  ${c.cyan("create")} profile <name>          Scaffold a new profile
  ${c.cyan("create")} domain <name>           Scaffold a new domain
  ${c.cyan("validate")}                       Validate all agents, profiles, and domains
  ${c.cyan("list")}                           List all available agents, profiles, and domains

${c.bold("OPTIONS")}
  --help                          Show help for any command

${c.bold("EXAMPLES")}
  aos init --adapter pi
  aos run strategic-council --domain saas --brief core/briefs/sample-product-decision/brief.md
  aos create agent my-analyst
  aos validate
  aos list
`);
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.flags.help && !parsed.command) {
    printHelp();
    process.exit(0);
  }

  switch (parsed.command) {
    case "init":
      await initCommand(parsed);
      break;
    case "run":
      await runCommand(parsed);
      break;
    case "create":
      await createCommand(parsed);
      break;
    case "validate":
      await validateCommand(parsed);
      break;
    case "list":
      await listCommand(parsed);
      break;
    case "":
      printHelp();
      break;
    default:
      console.error(c.red(`Unknown command: "${parsed.command}". Run "aos --help" for available commands.`));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
