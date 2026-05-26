# pi-session-search

Pi Coding Agent extension that adds conversation search capabilities. Search through current session history, read full messages by id, and list sessions across all projects.

## Install

```bash
pi install git:github.com/inouemoby/pi-session-search
```

## Tools

| Tool | Description |
|------|-------------|
| `session_search` | Search current conversation history with AND/OR matching |
| `session_read` | Read full message(s) by entry id, with optional surrounding context |
| `session_list` | List and search across all conversation sessions |

## Usage

### Search Current Session

```
session_search query="pdftotext exit code" role="assistant" limit=5
```

Each result shows:
- **relevance** — e.g. `3/3` (all terms matched) or `2/3 partial` (matched ≥half)
- **timestamp** — when the message was sent
- **entry id** — for use with `session_read`
- **preview** — first 400 characters

#### Search Parameters

| Parameter | Description |
|-----------|-------------|
| `query` | Keywords separated by spaces. All must match (AND). Partial matches (≥half terms) shown after. |
| `role` | Filter by role, comma-separated: `user`, `assistant`, `toolResult`. Omit for all. |
| `order` | `relevance` (AND first, default) or `time` (chronological) |
| `limit` | Max results (default 10) |

#### Search Logic

- Multiple keywords are matched with **AND priority** — results containing all terms appear first
- Results matching **≥half the terms** (but not all) are shown as `[partial]` after full matches
- Single keyword searches behave as simple substring match
- Case-insensitive

### Read Full Messages

```
session_read ids="abc123,def456" context=3
```

Read full content of one or more messages by their entry id.

| Parameter | Description |
|-----------|-------------|
| `ids` | Entry id(s) from search results, comma-separated |
| `context` | Number of surrounding messages to include before and after each target (default 0) |

When `context` is set:
- `▶` marks the target message
- `(-2)`, `(-1)`, `(+1)` show relative position to target
- Overlapping context between multiple targets is deduplicated

### List All Sessions

```
session_list query="lean" limit=10
```

| Parameter | Description |
|-----------|-------------|
| `query` | Filter sessions by name, first message, or project path |
| `limit` | Max sessions to return (default 20) |

## Typical Workflow

```
1. session_search query="pdf scan" role="user,assistant"
   → Find messages about PDF scanning

2. session_read ids="abc123" context=2
   → Read the full message with surrounding context (2 messages before/after)

3. session_list query="pdf"
   → Find other sessions that discussed PDFs
```

## Notes

- Session entries are **append-only** in pi — compaction does not delete original messages. `session_search` sees the full history.
- `session_list` searches session metadata (name, first message). For full-text search across sessions, use `session_search` within the relevant session.
- Entry ids are UUIDs, not sequential numbers. Use the `id:` field from search results, not the `#` index.

## License

MIT
