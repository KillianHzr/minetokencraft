import { codex } from './codex.mjs';
import { gemini } from './gemini.mjs';

// The other coding assistants that get a wing of their own, next to the Claude Code accounts. Each one finds its
// folder, reads its sessions, and turns them into players (lib/sessions.mjs) and usage (lib/tracker.mjs).
export const ASSISTANTS = [codex, gemini];

export function assistantFor(tool) {
  return ASSISTANTS.find((assistant) => assistant.tool === tool) ?? null;
}
