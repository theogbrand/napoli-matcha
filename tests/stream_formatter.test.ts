import { describe, it, expect, beforeEach } from "vitest";
import {
  StreamFormatter,
  truncate,
  cleanPath,
  modelName,
  contextPct,
  formatToolSignature,
  stripAnsi,
} from "../src/lib/StreamFormatter.js";

describe("StreamFormatter", () => {
  let fmt: StreamFormatter;

  beforeEach(() => {
    fmt = new StreamFormatter();
  });

  // --- Static helpers ---

  describe("truncate", () => {
    it("returns short strings unchanged", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });
    it("truncates long strings with ellipsis", () => {
      expect(truncate("abcdefghij", 5)).toBe("abcde...");
    });
  });

  describe("stripAnsi", () => {
    it("removes ANSI escape codes", () => {
      expect(stripAnsi("\x1b[32m\x1b[1m●\x1b[0m hello")).toBe("● hello");
    });
    it("returns plain strings unchanged", () => {
      expect(stripAnsi("no codes here")).toBe("no codes here");
    });
  });

  describe("cleanPath", () => {
    it("strips Daytona sandbox prefixes", () => {
      expect(cleanPath("/home/daytona/repo-name/src/index.ts")).toBe(
        "src/index.ts"
      );
    });
    it("strips Ubuntu repo prefixes", () => {
      expect(cleanPath("/home/ubuntu/repos/my-repo/lib/foo.ts")).toBe(
        "lib/foo.ts"
      );
    });
    it("leaves normal paths unchanged", () => {
      expect(cleanPath("src/lib/file.ts")).toBe("src/lib/file.ts");
    });
  });

  describe("modelName", () => {
    it("extracts opus", () => {
      expect(modelName("claude-opus-4-6")).toBe("opus");
    });
    it("extracts sonnet", () => {
      expect(modelName("claude-sonnet-4-5-20250929")).toBe("sonnet");
    });
    it("extracts haiku", () => {
      expect(modelName("claude-haiku-4-5-20251001")).toBe("haiku");
    });
    it("returns ? for null", () => {
      expect(modelName(null)).toBe("?");
    });
    it("returns raw model for unknown", () => {
      expect(modelName("gpt-4")).toBe("gpt-4");
    });
  });

  describe("contextPct", () => {
    it("computes percentage of 168k limit", () => {
      expect(
        contextPct({
          cache_creation_input_tokens: 84000,
          cache_read_input_tokens: 0,
        })
      ).toBe(50);
    });
    it("returns 0 for empty usage", () => {
      expect(contextPct({})).toBe(0);
    });
  });

  describe("formatToolSignature", () => {
    it("formats name with string params", () => {
      expect(formatToolSignature("Read", { file_path: "src/index.ts" })).toBe(
        'Read(file_path="src/index.ts")'
      );
    });
    it("formats name with numeric params", () => {
      expect(
        formatToolSignature("Read", { file_path: "src/index.ts", offset: 10 })
      ).toBe('Read(file_path="src/index.ts", offset=10)');
    });
    it("formats name with object params as {...}", () => {
      expect(
        formatToolSignature("Write", {
          file_path: "f.ts",
          content: { nested: true },
        })
      ).toBe('Write(file_path="f.ts", content={...})');
    });
  });

  // --- format() ---

  describe("format", () => {
    it("formats system/init as a box with model and tool count", () => {
      const result = fmt.format({
        type: "system",
        subtype: "init",
        model: "claude-sonnet-4-5-20250929",
        tools: new Array(42),
      });
      expect(result).toContain("SESSION START");
      expect(result).toContain("claude-sonnet-4-5-20250929");
      expect(result).toContain("42 available");
    });

    it("formats system/status", () => {
      const result = fmt.format({
        type: "system",
        subtype: "status",
      });
      expect(result).toContain("Working...");
    });

    it("formats compact_boundary", () => {
      const result = fmt.format({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { pre_tokens: 50000 },
      });
      expect(result).toContain("Context compacted");
      expect(result).toContain("50k");
    });

    it("formats task_notification", () => {
      const result = fmt.format({
        type: "system",
        subtype: "task_notification",
        summary: "Tests pass",
      });
      expect(result).toContain("Done: Tests pass");
    });

    it("formats main-agent tool_use with green dot and signature", () => {
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {
            cache_creation_input_tokens: 70560,
            cache_read_input_tokens: 0,
          },
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "Read",
              input: { file_path: "src/index.ts" },
            },
          ],
        },
      });
      expect(result).toContain("\u25cf"); // green dot
      expect(result).toContain('Read(file_path="src/index.ts")');
      expect(result).toContain("[sonnet/42%]");
    });

    it("formats subagent tool_use indented with arrow", () => {
      // First register a subagent via Task spawn
      fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "task_1",
              name: "Task",
              input: { description: "explore", subagent_type: "Explore" },
            },
          ],
        },
      });

      // Then a subagent tool call
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: "task_1",
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "tu_sub",
              name: "Grep",
              input: { pattern: "TODO", path: "src/" },
            },
          ],
        },
      });
      expect(result).toContain("explore");
      expect(result).toContain("\u25b8");
      expect(result).toContain("Grep");
    });

    it("formats Task spawn with yellow arrow", () => {
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "task_2",
              name: "Task",
              input: {
                description: "research subtask",
                subagent_type: "Explore",
              },
            },
          ],
        },
      });
      expect(result).toContain("\u25b8 Spawn: research subtask");
    });

    it("formats main-agent text with model tag", () => {
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [{ type: "text", text: "Hello world" }],
        },
      });
      expect(result).toContain("Hello world");
      expect(result).toContain("[sonnet/0%]");
    });

    it("suppresses subagent text", () => {
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: "some_parent",
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [{ type: "text", text: "Subagent talking" }],
        },
      });
      expect(result).toBeNull();
    });

    it("formats thinking indicator", () => {
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [{ type: "thinking" }],
        },
      });
      expect(result).toContain("Thinking...");
    });

    it("formats tool results with tree connector", () => {
      // First set up lastMainToolUseId
      fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "tu_main",
              name: "Read",
              input: { file_path: "f.ts" },
            },
          ],
        },
      });

      const result = fmt.format({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_main",
              content: { content: "line1\nline2\nline3\nline4\nline5" },
            },
          ],
        },
      });
      expect(result).toContain("\u2514"); // tree connector
      expect(result).toContain("line1");
    });

    it("formats tool result errors", () => {
      fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "tu_err",
              name: "Bash",
              input: { command: "fail" },
            },
          ],
        },
      });

      const result = fmt.format({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_err",
              is_error: true,
              content: "Command failed with exit code 1",
            },
          ],
        },
      });
      expect(result).toContain("Error:");
      expect(result).toContain("Command failed");
    });

    it("formats session end with cost and duration", () => {
      const result = fmt.format({
        type: "result",
        result: "Done",
        duration_ms: 45000,
        total_cost_usd: 0.12,
        num_turns: 15,
        modelUsage: {
          "claude-sonnet-4-5-20250929": {
            inputTokens: 50000,
            outputTokens: 10000,
            cacheReadInputTokens: 30000,
            cacheCreationInputTokens: 5000,
            costUSD: 0.12,
          },
        },
      });
      expect(result).toContain("SESSION END");
      expect(result).toContain("45s");
      expect(result).toContain("$0.12");
      expect(result).toContain("Turns: 15");
    });

    it("collapses MCP calls after threshold", () => {
      const mcpEvent = (id: string) => ({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id,
              name: "mcp__linear__list_issues",
              input: { team: "POLY" },
            },
          ],
        },
      });

      // First 3 show as full green dot format
      for (let i = 1; i <= 3; i++) {
        const r = fmt.format(mcpEvent(`mcp_${i}`));
        expect(r).toContain("\u25cf"); // green dot
      }

      // 4th shows as dimmed compact
      const r4 = fmt.format(mcpEvent("mcp_4"));
      expect(r4).toContain("\u25cb"); // compact circle
      expect(r4).toContain("linear:list_issues");
    });

    it("resets MCP count when non-MCP message arrives", () => {
      const mcpEvent = (id: string) => ({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id,
              name: "mcp__linear__list_issues",
              input: { team: "POLY" },
            },
          ],
        },
      });

      // 3 MCP calls
      for (let i = 1; i <= 3; i++) fmt.format(mcpEvent(`m_${i}`));

      // Non-MCP call resets
      fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "tu_normal",
              name: "Read",
              input: { file_path: "f.ts" },
            },
          ],
        },
      });

      // Next 3 MCP calls should be full format again
      for (let i = 4; i <= 6; i++) {
        const r = fmt.format(mcpEvent(`m_${i}`));
        expect(r).toContain("\u25cf");
      }
    });

    it("returns null for unknown event types", () => {
      expect(fmt.format({ type: "unknown_garbage" })).toBeNull();
    });

    it("skips TaskOutput tool calls", () => {
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "to_1",
              name: "TaskOutput",
              input: { task_id: "abc" },
            },
          ],
        },
      });
      expect(result).toBeNull();
    });
  });

  // --- extractText() ---

  describe("extractText", () => {
    it("extracts main-agent text", () => {
      const result = fmt.extractText({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      });
      expect(result).toBe("Hello world");
    });

    it("filters out subagent text", () => {
      const result = fmt.extractText({
        type: "assistant",
        parent_tool_use_id: "some_parent",
        message: {
          content: [{ type: "text", text: "Subagent output" }],
        },
      });
      expect(result).toBeNull();
    });

    it("extracts result text", () => {
      const result = fmt.extractText({
        type: "result",
        result: "Final answer",
      });
      expect(result).toBe("Final answer");
    });

    it("returns null for tool_use-only events", () => {
      const result = fmt.extractText({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "f.ts" },
            },
          ],
        },
      });
      expect(result).toBeNull();
    });

    it("returns null for non-string result", () => {
      const result = fmt.extractText({
        type: "result",
        result: 42,
      });
      expect(result).toBeNull();
    });
  });

  // --- reset() ---

  describe("reset", () => {
    it("clears subagent map and internal state", () => {
      // Register a subagent
      fmt.format({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "task_99",
              name: "Task",
              input: { description: "old task" },
            },
          ],
        },
      });

      fmt.reset();

      // After reset, subagent should not be recognized
      const result = fmt.format({
        type: "assistant",
        parent_tool_use_id: "task_99",
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          content: [
            {
              type: "tool_use",
              id: "tu_sub2",
              name: "Grep",
              input: { pattern: "foo" },
            },
          ],
        },
      });
      // Should use the raw parent ID since "old task" is gone
      expect(result).toContain("task_99");
      expect(result).not.toContain("old task");
    });
  });
});
