// ANSI constants (inlined from Horizon ui.ts)
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

interface BoxOptions {
  width?: number;
  title?: string;
  color?: string;
  dividerAfter?: number[];
}

function box(lines: string[], opts: BoxOptions = {}): string {
  const width = opts.width ?? 60;
  const color = opts.color ?? DIM;
  const dividers = new Set(opts.dividerAfter ?? []);
  const innerWidth = width - 2;

  let top: string;
  if (opts.title) {
    const titleStr = ` ${opts.title} `;
    const dashesAfter = innerWidth - 1 - titleStr.length;
    top = `${color}\u250c\u2500${RESET}${BOLD}${titleStr}${RESET}${color}${"\u2500".repeat(Math.max(0, dashesAfter))}\u2510${RESET}`;
  } else {
    top = `${color}\u250c${"\u2500".repeat(innerWidth)}\u2510${RESET}`;
  }

  const contentLines = lines.map((line, i) => {
    const visLen = stripAnsi(line).length;
    const pad = Math.max(0, innerWidth - visLen);
    const row = `${color}\u2502${RESET}${line}${" ".repeat(pad)}${color}\u2502${RESET}`;
    if (dividers.has(i)) {
      return row + "\n" + `${color}\u251c${"\u2500".repeat(innerWidth)}\u2524${RESET}`;
    }
    return row;
  });

  const bottom = `${color}\u2514${"\u2500".repeat(innerWidth)}\u2518${RESET}`;
  return [top, ...contentLines, bottom].join("\n");
}

// --- Helpers ---

export function truncate(str: string, maxLen = 120): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + "...";
}

export function cleanPath(path: string): string {
  return path
    .replace(/\/home\/daytona\/[^/]+\//g, "")
    .replace(/\/home\/ubuntu\/repos\/[^/]+\//g, "")
    .replace(/\/Users\/[^/]+\/repos\/[^/]+\//g, "");
}

export function modelName(model: string | null | undefined): string {
  if (!model) return "?";
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model;
}

export function contextPct(usage: {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): number {
  const total =
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  return Math.floor((total * 100) / 168000);
}

function extractToolValue(input: Record<string, unknown>): string {
  if (input.file_path) return cleanPath(String(input.file_path));
  if (input.path && input.pattern)
    return `${input.pattern} in ${cleanPath(String(input.path))}`;
  if (input.pattern) return String(input.pattern);
  if (input.command)
    return String(input.command).substring(0, 80).replace(/\n/g, " ");
  if (input.query) return String(input.query).substring(0, 80);
  if (input.content) return "(content)";
  if (input.todos) return "(todos)";
  return JSON.stringify(input).substring(0, 80).replace(/\n/g, " ");
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function formatToolSignature(
  name: string,
  input: Record<string, unknown>
): string {
  const params = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (typeof v === "string") return `${k}="${truncate(cleanPath(v), 60)}"`;
      if (typeof v === "object") return `${k}={...}`;
      return `${k}=${v}`;
    })
    .join(", ");
  return `${name}(${truncate(params, 120)})`;
}

function formatToolResult(
  toolUseResult: Record<string, unknown>
): string | null {
  let text = "";
  if (
    toolUseResult.file &&
    typeof (toolUseResult.file as Record<string, unknown>).content === "string"
  ) {
    text = (toolUseResult.file as Record<string, unknown>).content as string;
  } else if (typeof toolUseResult.stdout === "string") {
    text = toolUseResult.stdout;
  } else if (typeof toolUseResult.content === "string") {
    text = toolUseResult.content;
  }
  if (!text.trim()) return null;

  const lines = text.split("\n").filter((l) => l.trim());
  const preview = lines.slice(0, 3);
  const more = lines.length > 3;

  return (
    preview
      .map((line, i) => {
        const prefix = i === 0 ? "\u2514 " : "  ";
        return `${DIM}  ${prefix}${truncate(line, 100)}${RESET}`;
      })
      .join("\n") + (more ? `\n${DIM}    ...${RESET}` : "")
  );
}

function formatMcpCompact(
  name: string,
  input: Record<string, unknown>
): string {
  const short = name.replace(/^mcp__/, "").replace(/__/, ":");
  const sig = input ? formatToolSignature(short, input) : short;
  return `${DIM}  \u25cb ${sig}${RESET}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StreamEvent = Record<string, any>;

const MCP_SHOW_LIMIT = 3;

export class StreamFormatter {
  private subagentMap = new Map<string, string>();
  private lastMainToolUseId: string | null = null;
  private mcpConsecutiveCount = 0;

  reset(): void {
    this.subagentMap.clear();
    this.lastMainToolUseId = null;
    this.mcpConsecutiveCount = 0;
  }

  /**
   * Extract main-agent text from a stream event (filters out subagent text).
   * Replaces SandboxQueueProcessor.extractTextFromStreamLine.
   */
  extractText(event: StreamEvent): string | null {
    if (
      event.type === "assistant" &&
      !event.parent_tool_use_id &&
      event.message?.content
    ) {
      const text = event.message.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("");
      return text || null;
    }
    if (event.type === "result" && typeof event.result === "string") {
      return event.result;
    }
    return null;
  }

  /**
   * Format a stream event into a human-readable log line.
   * Replaces SandboxQueueProcessor.handleStreamLine console output.
   */
  format(event: StreamEvent): string | null {
    // System init
    if (event.type === "system" && event.subtype === "init") {
      const tools = Array.isArray(event.tools) ? event.tools.length : 0;
      return (
        "\n" +
        box(
          [`  Model: ${event.model}  |  Tools: ${tools} available  `],
          { title: "SESSION START", color: BLUE, width: 60 }
        )
      );
    }

    // System status
    if (event.type === "system" && event.subtype === "status") {
      return `${BLUE}${DIM}\u2261 Working...${RESET}`;
    }

    // Context compaction
    if (event.type === "system" && event.subtype === "compact_boundary") {
      const metadata = event.compact_metadata as
        | { pre_tokens?: number }
        | undefined;
      const preTokens = metadata?.pre_tokens
        ? Math.floor(metadata.pre_tokens / 1000)
        : "?";
      return `${DIM}~ Context compacted (was ${preTokens}k tokens)${RESET}`;
    }

    // Task notification
    if (event.type === "system" && event.subtype === "task_notification") {
      return `${GREEN}\u2713 Done: ${event.summary}${RESET}`;
    }

    // Tool results (type: "user" with tool_result)
    if (event.type === "user") {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        const lines: string[] = [];
        for (const item of content) {
          if (
            item.type === "tool_result" &&
            item.tool_use_id === this.lastMainToolUseId
          ) {
            const resultContent = item.content;
            if (item.is_error && typeof resultContent === "string") {
              lines.push(
                `${YELLOW}  \u2514 Error: ${truncate(resultContent, 100)}${RESET}`
              );
            } else if (Array.isArray(resultContent)) {
              for (const block of resultContent) {
                if (typeof block === "object" && block !== null) {
                  const result = formatToolResult(
                    block as Record<string, unknown>
                  );
                  if (result) lines.push(result);
                }
              }
            } else if (
              typeof resultContent === "object" &&
              resultContent !== null
            ) {
              const result = formatToolResult(
                resultContent as Record<string, unknown>
              );
              if (result) lines.push(result);
            }
          }
        }
        return lines.length > 0 ? lines.join("\n") : null;
      }
      return null;
    }

    // Result (session end)
    if (event.type === "result") {
      const modelUsage = event.modelUsage as
        | Record<
            string,
            {
              inputTokens?: number;
              outputTokens?: number;
              cacheReadInputTokens?: number;
              cacheCreationInputTokens?: number;
              costUSD?: number;
            }
          >
        | undefined;

      let totalIn = 0,
        totalOut = 0,
        totalCacheRead = 0,
        totalCacheWrite = 0;
      const modelBreakdown: string[] = [];

      if (modelUsage) {
        for (const [model, usage] of Object.entries(modelUsage)) {
          const inTokens = usage.inputTokens || 0;
          const outTokens = usage.outputTokens || 0;
          const cacheRead = usage.cacheReadInputTokens || 0;
          const cacheWrite = usage.cacheCreationInputTokens || 0;
          const cost = usage.costUSD || 0;

          totalIn += inTokens;
          totalOut += outTokens;
          totalCacheRead += cacheRead;
          totalCacheWrite += cacheWrite;

          const shortModel = model.split("-")[1] || model;
          modelBreakdown.push(
            `${shortModel}: in=${formatNumber(inTokens)} out=${formatNumber(outTokens)} ` +
              `cache_read=${formatNumber(cacheRead)} cache_write=${formatNumber(cacheWrite)} $${cost.toFixed(2)}`
          );
        }
      }

      const durationSec = Math.floor(
        ((event.duration_ms as number) || 0) / 1000
      );
      const totalCost = ((event.total_cost_usd as number) || 0).toFixed(2);
      const numTurns = event.num_turns || 0;

      const endLines = [
        `  Duration: ${durationSec}s  |  Cost: $${totalCost}  |  Turns: ${numTurns}  `,
        ...modelBreakdown.map((l) => `  ${l}  `),
        `  TOTAL: in=${formatNumber(totalIn)} out=${formatNumber(totalOut)} cache_read=${formatNumber(totalCacheRead)} cache_write=${formatNumber(totalCacheWrite)}  `,
      ];
      return (
        "\n" +
        box(endLines, {
          title: "SESSION END",
          color: BLUE,
          width: 80,
          dividerAfter: [0],
        })
      );
    }

    // Assistant messages
    if (event.type === "assistant") {
      const message = event.message as
        | {
            model?: string;
            usage?: {
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
            content?: Array<{
              type: string;
              name?: string;
              text?: string;
              id?: string;
              input?: Record<string, unknown>;
            }>;
          }
        | undefined;

      const model = modelName(message?.model);
      const pct = message?.usage ? contextPct(message.usage) : 0;
      const parentId = event.parent_tool_use_id as string | null;
      const content = message?.content || [];
      const tag = `${DIM}[${model}/${pct}%]${RESET}`;

      // Detect if all tool_use items at top level are MCP calls
      const toolUseItems = content.filter(
        (i) => i.type === "tool_use" && parentId === null
      );
      const allMcp =
        toolUseItems.length > 0 &&
        toolUseItems.every((i) => (i.name || "").startsWith("mcp__"));

      if (allMcp) {
        this.mcpConsecutiveCount++;
        if (this.mcpConsecutiveCount > MCP_SHOW_LIMIT) {
          const compactLines = toolUseItems.map((i) =>
            formatMcpCompact(i.name || "unknown", i.input || {})
          );
          return compactLines.join("\n");
        }
      }

      // Reset MCP count when a non-MCP message arrives
      if (!allMcp) {
        this.mcpConsecutiveCount = 0;
      }

      const lines: string[] = [];

      for (const item of content) {
        if (item.name === "Task") {
          const input = item.input as
            | { description?: string; subagent_type?: string }
            | undefined;
          const desc = input?.description || "unknown";
          if (item.id) {
            this.subagentMap.set(item.id, desc);
          }
          lines.push(`${YELLOW}\u25b8 Spawn: ${desc} ${tag}${RESET}`);
        } else if (item.name === "TaskOutput") {
          continue;
        } else if (item.type === "tool_use") {
          if (parentId === null) {
            const sig = item.input
              ? formatToolSignature(item.name || "unknown", item.input)
              : item.name || "unknown";
            lines.push(`${GREEN}${BOLD}\u25cf${RESET} ${sig} ${tag}`);
            if (item.id) this.lastMainToolUseId = item.id;
          } else {
            const parentDesc = this.subagentMap.get(parentId) || parentId;
            const value = item.input ? extractToolValue(item.input) : "";
            lines.push(
              `${DIM}  ${parentDesc} \u25b8 ${item.name}: ${value}${RESET}`
            );
          }
        } else if (item.type === "thinking") {
          lines.push(`${DIM}* Thinking...${RESET}`);
        } else if (item.type === "text" && item.text) {
          if (parentId === null) {
            lines.push(`${item.text} ${tag}`);
          }
          // Skip subagent text
        }
      }

      return lines.length > 0 ? lines.join("\n") : null;
    }

    return null;
  }
}
