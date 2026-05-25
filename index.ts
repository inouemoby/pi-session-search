import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { basename } from "node:path";

const err = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true as const });

export default function (pi: ExtensionAPI) {

  // ── session_search: search current session messages ────────
  pi.registerTool({
    name: "session_search",
    label: "Session Search",
    description:
      "Search through the current conversation history. Finds messages matching a keyword or pattern. Returns matching messages with their role (user/assistant), timestamp, and surrounding context. Use to recall previous discussions, find code snippets, or review decisions made earlier in the conversation.",
    promptSnippet: "Search current conversation history",
    promptGuidelines: [
      "Use session_search when you need to find something discussed earlier in the current conversation.",
      "Useful for recalling previous decisions, code snippets, file paths, or error messages.",
      "Searches are case-insensitive and match against message content.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query — keywords separated by spaces. All must match (AND). Partial matches (≥half terms) shown after." }),
      role: Type.Optional(Type.String({ description: "Filter by role, comma-separated: 'user', 'assistant', 'toolResult', or omit for all" })),
      order: Type.Optional(Type.String({ description: "Sort order: 'relevance' (AND first, default) or 'time' (chronological)" })),
      limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const entries = ctx.sessionManager.getEntries();
      const query = params.query.toLowerCase();
      const roleFilter = params.role ? new Set(params.role.toLowerCase().split(',').map(s => s.trim()).filter(Boolean)) : null;
      const order = params.order ?? "relevance";
      const limit = params.limit ?? 10;

      const results: { sortKey: number; idx: number; line: string }[] = [];
      let count = 0;

      for (const entry of entries) {
        if (entry.type !== "message") continue;
        const msg = (entry as any).message;
        if (!msg) continue;

        // Role filter
        if (roleFilter && !roleFilter.has(msg.role)) continue;

        // Extract text content
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (typeof part === "string") text += part + " ";
            else if (part?.type === "text") text += part.text + " ";
          }
        }

        // Split query by spaces — AND matches first, OR (≥half terms) after
        const terms = query.split(/\s+/).filter(Boolean);
        const textLower = text.toLowerCase();
        const matchCount = terms.filter(t => textLower.includes(t)).length;
        if (matchCount === 0) continue;
        // Partial match must hit at least half the terms
        const minMatch = Math.ceil(terms.length / 2);
        if (matchCount < minMatch) continue;

        const isAnd = matchCount === terms.length;
        count++;

        // Short preview for scanability, with entry id for retrieval
        const preview = text.length > 400 ? text.slice(0, 400) + "..." : text;
        const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "?";
        const tag = isAnd ? "" : "partial";
        const relevance = `${matchCount}/${terms.length}`;
        results.push({ sortKey: isAnd ? 0 : 1, idx: count, line: `[${count}] ${msg.role} (${ts}) relevance:${relevance} ${tag}id:${entry.id}:\n${preview}` });
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: `No messages matching "${params.query}" found in current session.` }] };
      }

      // Sort: 'relevance' = AND first then by match count desc; 'time' = chronological
      if (order === "time") {
        // results already in chronological order (we iterated entries in order)
      } else {
        // AND first, then partial sorted by idx (time)
        results.sort((a, b) => a.sortKey - b.sortKey || a.idx - b.idx);
      }
      const shown = results.slice(0, limit);
      const andCount = results.filter(r => r.sortKey === 0).length;
      const orCount = results.filter(r => r.sortKey === 1).length;

      let header = `Found ${count} match(es) for "${params.query}"`;
      if (andCount > 0 && orCount > 0) header += ` (${andCount} full, ${orCount} partial)`;
      header += `, showing ${shown.length}:\n\n`;
      return { content: [{ type: "text", text: header + shown.map(r => r.line).join("\n\n---\n\n") }] };
    },

    renderCall(args, theme) {
      const q = args.query.length > 40 ? args.query.slice(0, 37) + "..." : args.query;
      return new Text(theme.fg("toolTitle", theme.bold("session_search ")) + theme.fg("dim", `"${q}"`), 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);
      if (result.isError) return new Text(theme.fg("error", "Failed"), 0, 0);
      const text = result.content?.[0]?.text || "";
      const m = text.match(/Found (\d+) match/);
      const label = m ? `✓ ${m[1]} match(es)` : "✓ Done";
      return new Text(theme.fg("success", label), 0, 0);
    },
  });

  // ── session_read: get full message by entry id(s) ────────
  pi.registerTool({
    name: "session_read",
    label: "Session Read",
    description:
      "Read the full content of one or more messages from the current session by entry id. Use after session_search to get complete text of matched entries. Supports multiple ids separated by commas.",
    promptSnippet: "Read full message(s) by entry id",
    promptGuidelines: [
      "Use session_read after session_search to get the full content of interesting entries.",
      "Pass multiple comma-separated ids to read several messages at once.",
    ],
    parameters: Type.Object({
      ids: Type.String({ description: "Entry id(s) from session_search, comma-separated (e.g. 'abc123,def456')" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const idList = params.ids.split(",").map(s => s.trim()).filter(Boolean);
      if (idList.length === 0) return err("No entry ids provided.");

      const entries = ctx.sessionManager.getEntries();
      const byId = new Map<string, any>();
      for (const e of entries) byId.set(e.id, e);

      const results: string[] = [];
      const missing: string[] = [];

      for (const eid of idList) {
        const entry = byId.get(eid);
        if (!entry || entry.type !== "message") { missing.push(eid); continue; }
        const msg = entry.message;

        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (typeof part === "string") text += part + " ";
            else if (part?.type === "text") text += part.text + " ";
          }
        }

        const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "?";
        results.push(`─── ${msg.role} (${ts}) id:${eid} ───\n${text}`);
      }

      let output = results.join("\n\n");
      if (missing.length > 0) output += `\n\nNot found: ${missing.join(", ")}`;
      return { content: [{ type: "text", text: output || "No entries found." }] };
    },

    renderCall(args, theme) {
      const count = args.ids.split(",").length;
      return new Text(theme.fg("toolTitle", theme.bold("session_read ")) + theme.fg("dim", `${count} entr${count > 1 ? "ies" : "y"}`), 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Reading..."), 0, 0);
      if (result.isError) return new Text(theme.fg("error", "Failed"), 0, 0);
      return new Text(theme.fg("success", "✓ Read"), 0, 0);
    },
  });

  // ── session_list: list/search all sessions ─────────────────
  pi.registerTool({
    name: "session_list",
    label: "Session List",
    description:
      "List and search across all pi conversation sessions. Returns session metadata (name, date, project, message count, first message preview). Filter by keyword to find sessions about a specific topic. Use to locate previous conversations before reading them in detail.",
    promptSnippet: "List/search all conversation sessions",
    promptGuidelines: [
      "Use session_list when you need to find a previous conversation across all projects.",
      "Returns session summaries — use the session path to read full content if needed.",
      "Filter with 'query' to search within session first messages and names.",
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Filter sessions whose name or first message contains this text" })),
      limit: Type.Optional(Type.Number({ description: "Max sessions to return (default 20)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const SessionManager = (await import(
        /* @vite-ignore */
        "@earendil-works/pi-coding-agent"
      )).SessionManager as any;

      const sessions = await SessionManager.listAll() as Array<{
        path: string;
        id: string;
        cwd: string;
        name?: string;
        created: Date;
        modified: Date;
        messageCount: number;
        firstMessage: string;
        allMessagesText: string;
      }>;

      const query = params.query?.toLowerCase();
      const limit = params.limit ?? 20;

      let filtered = sessions;
      if (query) {
        filtered = sessions.filter(s =>
          (s.name?.toLowerCase().includes(query)) ||
          (s.firstMessage?.toLowerCase().includes(query)) ||
          (s.cwd?.toLowerCase().includes(query))
        );
      }

      // Sort by modified date (most recent first)
      filtered.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      const shown = filtered.slice(0, limit);

      if (shown.length === 0) {
        return { content: [{ type: "text", text: query ? `No sessions matching "${params.query}".` : "No sessions found." }] };
      }

      const lines = shown.map((s, i) => {
        const date = new Date(s.modified).toLocaleDateString();
        const name = s.name || basename(s.path).split("_")[0];
        const cwd = s.cwd ? basename(s.cwd) : "?";
        const preview = s.firstMessage?.slice(0, 80).replace(/\n/g, " ") || "(empty)";
        return `${i + 1}. [${date}] ${name} (${cwd}, ${s.messageCount} msgs)\n   ${preview}`;
      });

      const header = `${query ? `Sessions matching "${params.query}"` : "All sessions"} (${filtered.length} total, showing ${shown.length}):\n\n`;
      return { content: [{ type: "text", text: header + lines.join("\n\n") }] };
    },

    renderCall(args, theme) {
      const label = args.query ? `"${args.query}"` : "all sessions";
      return new Text(theme.fg("toolTitle", theme.bold("session_list ")) + theme.fg("dim", label), 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Loading sessions..."), 0, 0);
      if (result.isError) return new Text(theme.fg("error", "Failed"), 0, 0);
      const text = result.content?.[0]?.text || "";
      const m = text.match(/(\d+) total/);
      const label = m ? `✓ ${m[1]} session(s)` : "✓ Done";
      return new Text(theme.fg("success", label), 0, 0);
    },
  });
}
