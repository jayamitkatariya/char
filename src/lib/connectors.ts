import type { AgentId } from "./desktop";

// Connectors: tools an agent can reach beyond its folder (GitHub, a calendar, the web), through
// MCP servers or the agent's own integrations. charlie doesn't install them itself: Settings →
// Agents sends the agent a setup prompt, and the agent sets the connector up for its own use.

export type Connector = { id: string; name: string; blurb: string; goal: string };

export const CONNECTORS: Connector[] = [
  { id: "github", name: "GitHub", blurb: "Issues, pull requests and repos", goal: "read and search my GitHub repositories, issues and pull requests" },
  { id: "calendar", name: "Google Calendar", blurb: "Your events and free time", goal: "read my Google Calendar events and find free time" },
  { id: "gmail", name: "Gmail", blurb: "Search and read mail", goal: "search and read my Gmail (reading only, never sending)" },
  { id: "drive", name: "Google Drive", blurb: "Docs, Sheets and files", goal: "search and read my Google Drive files, Docs and Sheets" },
  { id: "notion", name: "Notion", blurb: "Pages and databases", goal: "search and read my Notion pages and databases" },
  { id: "linear", name: "Linear", blurb: "Issues and projects", goal: "read and search my Linear issues and projects" },
  { id: "slack", name: "Slack", blurb: "Channels and threads", goal: "search and read my Slack channels and threads (reading only, never posting)" },
  { id: "web", name: "Web search", blurb: "Search and read web pages", goal: "search the web and read web pages" },
];

// How each agent adds a connector for itself. Kept to the commands each CLI documents.
const HOW: Record<AgentId, string> = {
  claude:
    "You are Claude Code. Add it with `claude mcp add --scope user …` (use `--transport http` for a remote server) so it works in every folder. Prefer the vendor's official remote MCP server. If it needs a browser sign-in, start it and tell me what to do (I can finish it from `/mcp` in Claude Code).",
  codex:
    "You are Codex. Add it with `codex mcp add <name> -- <command>` or `codex mcp add <name> --url <url>`, and sign in with `codex mcp login <name>` if it uses OAuth. Check with `codex mcp list`.",
  opencode:
    "You are OpenCode. Add it with `opencode mcp add`, or in the `mcp` section of your global config (~/.config/opencode/opencode.json). Sign in to OAuth servers with `opencode mcp auth <name>`. Check with `opencode mcp list`.",
  hermes:
    "You are Hermes. First run `hermes connectors list`: if it's a hosted connector there, use `hermes connectors connect <app>` (that needs `hermes login`). Otherwise look in `hermes mcp catalog` and use `hermes mcp install <name>`, or `hermes mcp add`. Check with `hermes mcp list`.",
  custom: "Use whatever your own tool or MCP configuration supports.",
};

export function setupPrompt(agent: AgentId, what: { name: string; goal: string }) {
  return `Set up ${what.name} for yourself, so that from now on the tasks I send you can ${what.goal}.

${HOW[agent]}

Rules:
- Set it up for my user account (global), not only for the current folder.
- Prefer official servers from the vendor. Don't invent package names: check they exist first.
- Never print secrets. If an API key or token is needed, tell me where to create it and the exact command to run with it, instead of guessing or asking me to paste it to you.
- If a step needs me (a browser sign-in, a key, an approval), start what you can, then stop and tell me exactly what to do.
- If it's already set up, just check that it works.

Finally, check that it works (list your servers, or call one harmless read-only tool) and reply with a short Markdown summary: what you set up, whether it works, and anything I still need to do.`;
}
