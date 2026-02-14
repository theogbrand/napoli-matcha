import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { loadPrompt, loadPromptFragment } from "../src/lib/PromptLoader.js";

// PromptLoader reads from process.cwd()/prompts/, and since vitest runs from
// the project root, we can use the actual prompts/ directory we created.

describe("PromptLoader", () => {
  const promptsDir = join(process.cwd(), "prompts");
  const testPromptPath = join(promptsDir, "test-prompt.md");
  const testFragmentPath = join(promptsDir, "fragments", "test-fragment.md");

  beforeEach(() => {
    mkdirSync(join(promptsDir, "fragments"), { recursive: true });
    writeFileSync(
      testPromptPath,
      "Hello {{NAME}}, your task is {{TASK}}.",
      "utf-8",
    );
    writeFileSync(testFragmentPath, "This is a fragment.", "utf-8");
  });

  afterEach(() => {
    try {
      rmSync(testPromptPath);
    } catch {
      /* ignore */
    }
    try {
      rmSync(testFragmentPath);
    } catch {
      /* ignore */
    }
  });

  describe("loadPrompt", () => {
    it("returns content for existing prompt", () => {
      const content = loadPrompt("test-prompt");
      expect(content).toContain("Hello {{NAME}}");
    });

    it("throws for missing prompt", () => {
      expect(() => loadPrompt("nonexistent-prompt")).toThrow(
        "Prompt not found: nonexistent-prompt",
      );
    });

    it("substitutes {{VAR}} correctly", () => {
      const content = loadPrompt("test-prompt", {
        NAME: "Alice",
        TASK: "write code",
      });
      expect(content).toBe("Hello Alice, your task is write code.");
    });

    it("replaces all occurrences of the same variable", () => {
      writeFileSync(
        testPromptPath,
        "{{NAME}} is great. {{NAME}} is the best.",
        "utf-8",
      );
      const content = loadPrompt("test-prompt", { NAME: "Bob" });
      expect(content).toBe("Bob is great. Bob is the best.");
    });

    it("leaves unmatched {{VAR}} as-is", () => {
      const content = loadPrompt("test-prompt", { NAME: "Alice" });
      expect(content).toBe("Hello Alice, your task is {{TASK}}.");
    });
  });

  describe("loadPromptFragment", () => {
    it("loads from prompts/fragments/", () => {
      const content = loadPromptFragment("test-fragment");
      expect(content).toBe("This is a fragment.");
    });

    it("throws for missing fragment", () => {
      expect(() => loadPromptFragment("nonexistent")).toThrow(
        "Prompt fragment not found: nonexistent",
      );
    });
  });
});
