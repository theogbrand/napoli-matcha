import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { PromptLoader } from "../src/lib/PromptLoader.js";

describe("PromptLoader", () => {
  let tmpDir: string;
  let loader: PromptLoader;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `prompt-loader-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    loader = new PromptLoader(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("reads a prompt file by name", async () => {
      await writeFile(join(tmpDir, "test.md"), "Hello {{NAME}}");
      const content = await loader.load("test.md");
      expect(content).toBe("Hello {{NAME}}");
    });

    it("throws for missing files", async () => {
      await expect(loader.load("nonexistent.md")).rejects.toThrow();
    });
  });

  describe("fill", () => {
    it("replaces {{VAR}} placeholders", () => {
      const result = loader.fill("Hello {{NAME}}, welcome to {{SYSTEM}}", {
        NAME: "Alice",
        SYSTEM: "Dawn",
      });
      expect(result).toBe("Hello Alice, welcome to Dawn");
    });

    it("leaves unmatched placeholders intact", () => {
      const result = loader.fill("{{KNOWN}} and {{UNKNOWN}}", {
        KNOWN: "yes",
      });
      expect(result).toBe("yes and {{UNKNOWN}}");
    });

    it("handles templates with no placeholders", () => {
      expect(loader.fill("no vars here", { X: "Y" })).toBe("no vars here");
    });
  });

  describe("loadAndFill", () => {
    it("loads and fills in one call", async () => {
      await writeFile(
        join(tmpDir, "stage.md"),
        "Task: {{TASK_ID}}\n{{MERGE_INSTRUCTIONS}}"
      );
      const result = await loader.loadAndFill("stage.md", {
        TASK_ID: "AGI-1",
        MERGE_INSTRUCTIONS: "Create a PR",
      });
      expect(result).toBe("Task: AGI-1\nCreate a PR");
    });
  });
});
