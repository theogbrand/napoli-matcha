import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractFinalOutput } from "../src/lib/ClaudeSpawner.js";

// We test extractFinalOutput directly (pure function, no mocking needed).
// spawnClaude itself requires mocking child_process.spawn which is tested
// via integration tests with a live Claude CLI.

describe("ClaudeSpawner", () => {
  describe("extractFinalOutput", () => {
    it("extracts last assistant text from streaming JSON", () => {
      const stream = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "First response" }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Second response" }],
          },
        }),
      ].join("\n");

      expect(extractFinalOutput(stream)).toBe("Second response");
    });

    it("prefers result text over assistant text", () => {
      const stream = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Assistant text" }],
          },
        }),
        JSON.stringify({
          type: "result",
          is_error: false,
          result: "Result text",
          total_cost_usd: 0.05,
          duration_ms: 5000,
        }),
      ].join("\n");

      expect(extractFinalOutput(stream)).toBe("Result text");
    });

    it("ignores subagent messages (parent_tool_use_id set)", () => {
      const stream = [
        JSON.stringify({
          type: "assistant",
          parent_tool_use_id: "tool_123",
          message: {
            content: [{ type: "text", text: "Subagent text" }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Main agent text" }],
          },
        }),
      ].join("\n");

      expect(extractFinalOutput(stream)).toBe("Main agent text");
    });

    it("returns empty string when no text content", () => {
      const stream = [
        JSON.stringify({ type: "system", subtype: "init" }),
      ].join("\n");

      expect(extractFinalOutput(stream)).toBe("");
    });

    it("skips non-JSON lines gracefully", () => {
      const stream = [
        "not json",
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Valid text" }],
          },
        }),
        "also not json",
      ].join("\n");

      expect(extractFinalOutput(stream)).toBe("Valid text");
    });

    it("ignores error results", () => {
      const stream = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Good text" }],
          },
        }),
        JSON.stringify({
          type: "result",
          is_error: true,
          result: "Error message",
        }),
      ].join("\n");

      expect(extractFinalOutput(stream)).toBe("Good text");
    });

    it("handles tool_use content blocks without crashing", () => {
      const stream = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Read", id: "tu_1", input: {} },
              { type: "text", text: "After tool use" },
            ],
          },
        }),
      ].join("\n");

      expect(extractFinalOutput(stream)).toBe("After tool use");
    });

    it("handles empty stream", () => {
      expect(extractFinalOutput("")).toBe("");
    });
  });
});
