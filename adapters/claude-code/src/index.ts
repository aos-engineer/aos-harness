/**
 * AOS Harness — Claude Code Adapter
 *
 * Barrel file re-exporting the adapter's public API.
 */

export { generateClaudeCodeArtifacts } from "./generate";
export {
  generateAgentFile,
  generateCommandFile,
  generateClaudeMdFragment,
  mapTierToModel,
} from "./templates";
