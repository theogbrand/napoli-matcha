import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SandboxQueueProcessor,
  TaskRequest,
} from "../src/lib/SandboxQueueProcessor.js";
import { TaskStatus } from "../src/lib/TaskStatus.js";
import { PromptLoader } from "../src/lib/PromptLoader.js";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import matter from "gray-matter";

vi.mock("@daytonaio/sdk", () => ({
  Daytona: class {
    create = vi.fn();
  },
  Image: {
    base: vi.fn().mockReturnValue({
      runCommands: vi.fn().mockReturnThis(),
    }),
  },
}));

vi.mock("../src/lib/SandboxSetup.js", () => ({
  setupSandboxEnvironment: vi.fn().mockResolvedValue("/workspace/repo"),
  configureGit: vi.fn().mockResolvedValue(undefined),
  setupBranch: vi.fn().mockResolvedValue(undefined),
  generatePreviewUrls: vi.fn().mockResolvedValue({ 3000: "https://3000-mock.proxy.daytona.works", 5173: "https://5173-mock.proxy.daytona.works", 8080: "https://8080-mock.proxy.daytona.works" }),
}));

function makeTask(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    id: "AGI-1",
    file: "test.md",
    filePath: "/tmp/test.md",
    title: "Test",
    description: "A test task",
    repo: "https://github.com/test/repo",
    status: TaskStatus.NeedsResearch,
    dependsOn: [],
    ...overrides,
  };
}

// --- Pure logic tests (no I/O) ---

describe("Orchestrator logic", () => {
  const processor = new SandboxQueueProcessor("dummy-key");

  describe("filterEligible", () => {
    it("returns actionable tasks not in active set", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsResearch }),
        makeTask({ id: "AGI-2", status: TaskStatus.Done }),
        makeTask({ id: "AGI-3", status: TaskStatus.NeedsImplement }),
      ];
      const eligible = processor.filterEligible(tasks, new Set());
      expect(eligible.map((t) => t.id)).toEqual(["AGI-1", "AGI-3"]);
    });

    it("excludes tasks already in the active set", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsResearch }),
      ];
      const eligible = processor.filterEligible(tasks, new Set(["AGI-1"]));
      expect(eligible).toHaveLength(0);
    });

    it("excludes tasks with unmet dependencies", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({
          id: "AGI-2",
          status: TaskStatus.NeedsImplement,
          dependsOn: ["AGI-1"],
        }),
        makeTask({
          id: "AGI-3",
          status: TaskStatus.NeedsResearch,
          dependsOn: ["AGI-4"],
        }),
      ];
      const eligible = processor.filterEligible(tasks, new Set());
      // AGI-2 is eligible (dep AGI-1 is Done), AGI-3 is not (dep AGI-4 not found/not Done)
      expect(eligible.map((t) => t.id)).toEqual(["AGI-2"]);
    });

    it("returns empty for no actionable tasks", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({ id: "AGI-2", status: TaskStatus.Blocked }),
      ];
      expect(processor.filterEligible(tasks, new Set())).toHaveLength(0);
    });
  });

  describe("isTerminal", () => {
    it("returns true when no non-Done task depends on this one", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({
          id: "AGI-2",
          status: TaskStatus.Done,
          dependsOn: ["AGI-1"],
        }),
      ];
      expect(processor.isTerminal(tasks[0], tasks)).toBe(true);
    });

    it("returns false when a non-Done task depends on this one", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsResearch }),
        makeTask({
          id: "AGI-2",
          status: TaskStatus.NeedsImplement,
          dependsOn: ["AGI-1"],
        }),
      ];
      expect(processor.isTerminal(tasks[0], tasks)).toBe(false);
    });

    it("returns true for standalone tasks", () => {
      const tasks = [makeTask({ id: "AGI-1" })];
      expect(processor.isTerminal(tasks[0], tasks)).toBe(true);
    });
  });

  describe("branchName", () => {
    it("uses group when present", () => {
      const task = makeTask({ group: "auth" });
      expect(processor.branchName(task)).toBe("dawn/auth");
    });

    it("falls back to id when no group", () => {
      const task = makeTask({ id: "AGI-5" });
      expect(processor.branchName(task)).toBe("dawn/AGI-5");
    });
  });

  describe("resolvePreviewUrl", () => {
    const previewUrls: Record<number, string> = {
      3000: "https://3000-abc123.proxy.daytona.works",
      5173: "https://5173-abc123.proxy.daytona.works",
    };

    it("auto-corrects localhost URL to Daytona URL", () => {
      expect(
        processor.resolvePreviewUrl("http://localhost:3000", previewUrls)
      ).toBe("https://3000-abc123.proxy.daytona.works");
    });

    it("auto-corrects 127.0.0.1 URL to Daytona URL", () => {
      expect(
        processor.resolvePreviewUrl("http://127.0.0.1:5173", previewUrls)
      ).toBe("https://5173-abc123.proxy.daytona.works");
    });

    it("passes through non-localhost URLs unchanged", () => {
      const daytona = "https://3000-abc123.proxy.daytona.works";
      expect(processor.resolvePreviewUrl(daytona, previewUrls)).toBe(daytona);
    });

    it("passes through localhost URL when port has no Daytona mapping", () => {
      expect(
        processor.resolvePreviewUrl("http://localhost:9999", previewUrls)
      ).toBe("http://localhost:9999");
    });
  });
});

// --- Phase-gate pipeline tests (real I/O, mock only external boundaries) ---

describe("dispatchStage pipeline", () => {
  let processor: SandboxQueueProcessor;
  let tmpDir: string;
  let queueDir: string;

  // Realistic fixtures matching actual Claude output structure
  const researchSuccessOutput = `Thinking about the task...

WORK_RESULT:
  success: true
  stage_completed: research
  branch_name: feat/AGI-1
  commit_hash: abc1234
  next_status: "Needs Specification"
  summary: Analyzed the codebase and documented findings.
`;

  const specBlockedOutput = `WORK_RESULT:
  success: false
  stage_completed: specification
  next_status: Blocked
  error: Missing required config file.
`;

  const noWorkResultOutput =
    "I tried to analyze the codebase but ran into issues.\nNo structured output was produced.";

  beforeEach(async () => {
    vi.restoreAllMocks();
    tmpDir = join(tmpdir(), `dispatch-test-${Date.now()}`);
    queueDir = join(tmpDir, "queue");
    const promptsDir = join(tmpDir, "prompts");
    const logsDir = join(tmpDir, "logs");

    await mkdir(queueDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
    await mkdir(join(promptsDir, "fragments"), { recursive: true });

    // Minimal real prompt templates
    await writeFile(
      join(promptsDir, "agent2-worker-research.md"),
      "Research {{STAGE}}.\n{{MERGE_INSTRUCTIONS}}"
    );
    await writeFile(
      join(promptsDir, "agent2-worker-specification.md"),
      "Specify {{STAGE}}.\n{{MERGE_INSTRUCTIONS}}"
    );
    await writeFile(
      join(promptsDir, "fragments/merge-pr.md"),
      "Create a PR."
    );

    processor = new SandboxQueueProcessor("dummy-key");
    (processor as any).queueDir = queueDir;
    (processor as any).logsDir = logsDir;
    (processor as any).promptLoader = new PromptLoader(promptsDir);
    (processor as any).daytona = {
      create: vi.fn().mockResolvedValue({
        id: "test-sandbox-123",
        delete: vi.fn(),
        process: {
          executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, result: "/usr/local/bin/claude\n1.0.0\n/usr/local/bin/gh\ngh version 2.86.0" }),
        },
      }),
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeTaskFile(
    data: Record<string, unknown>
  ): Promise<void> {
    await writeFile(join(queueDir, "task.md"), matter.stringify("", data));
  }

  async function readFrontmatter(): Promise<Record<string, unknown>> {
    return matter(await readFile(join(queueDir, "task.md"), "utf-8")).data;
  }

  it("persists parsed results to frontmatter across multiple stages", async () => {
    await writeTaskFile({
      id: "AGI-1",
      title: "Add auth",
      description: "Implement OAuth2",
      repo: "https://github.com/test/repo",
      status: "Needs Research",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    let callIdx = 0;
    vi.spyOn(processor, "runClaudeInSandbox").mockImplementation(
      async () => [researchSuccessOutput, specBlockedOutput][callIdx++] ?? ""
    );

    await processor.dispatchStage(task, "agent2-worker-research.md", tasks);

    // Phase gate 1: task progressed through research, then blocked at spec
    expect(task.status).toBe(TaskStatus.Blocked);

    // Phase gate 2: frontmatter on disk has artifacts from BOTH stages
    const data = await readFrontmatter();
    expect(data.status).toBe("Blocked");
    expect(data.branch_name).toBe("feat/AGI-1"); // from research stage
    expect(data.commit_hash).toBe("abc1234"); // from research stage
    expect(data.last_summary).toContain("Analyzed"); // preserved from research
    expect(data.last_error).toContain("Missing required config"); // from spec stage
  });

  it("builds prompts with real task context", async () => {
    await writeTaskFile({
      id: "AGI-1",
      title: "Add auth module",
      description: "Implement OAuth2 login flow",
      repo: "https://github.com/test/repo",
      status: "Needs Research",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    const spy = vi
      .spyOn(processor, "runClaudeInSandbox")
      .mockResolvedValue(specBlockedOutput);

    await processor.dispatchStage(task, "agent2-worker-research.md", tasks);

    const prompt = spy.mock.calls[0][1];
    expect(prompt).toContain("AGI-1");
    expect(prompt).toContain("Add auth module");
    expect(prompt).toContain("Implement OAuth2 login flow");
    expect(prompt).toContain("https://github.com/test/repo");
    expect(prompt).toContain("dawn/AGI-1");
  });

  it("persists artifact_path to frontmatter keyed by stage", async () => {
    const outputWithArtifact = `WORK_RESULT:
  success: true
  stage_completed: research
  branch_name: dawn/AGI-1
  artifact_path: dawn-docs/active/research/2026-02-15-AGI-1-add-auth.md
  commit_hash: abc1234
  next_status: "Needs Specification"
  summary: Researched codebase.
`;

    await writeTaskFile({
      id: "AGI-1",
      title: "Add auth",
      description: "Implement OAuth2",
      repo: "https://github.com/test/repo",
      status: "Needs Research",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    vi.spyOn(processor, "runClaudeInSandbox").mockImplementation(
      async () => outputWithArtifact
    );

    // Stub specification stage to block so loop exits
    const specBlocked = `WORK_RESULT:
  success: false
  stage_completed: specification
  next_status: Blocked
  error: Blocked for test.
`;
    let callIdx = 0;
    vi.spyOn(processor, "runClaudeInSandbox").mockImplementation(
      async () => [outputWithArtifact, specBlocked][callIdx++] ?? ""
    );

    await processor.dispatchStage(task, "agent2-worker-research.md", tasks);

    const data = await readFrontmatter();
    expect(data.artifacts).toBeDefined();
    expect((data.artifacts as Record<string, string>).research).toBe(
      "dawn-docs/active/research/2026-02-15-AGI-1-add-auth.md"
    );
  });

  it("injects existing_artifacts into stage prompt", async () => {
    await writeTaskFile({
      id: "AGI-1",
      title: "Add auth",
      description: "Implement OAuth2",
      repo: "https://github.com/test/repo",
      status: "Needs Specification",
      artifacts: {
        research: "dawn-docs/active/research/2026-02-15-AGI-1-add-auth.md",
      },
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    const spy = vi
      .spyOn(processor, "runClaudeInSandbox")
      .mockResolvedValue(specBlockedOutput);

    await processor.dispatchStage(task, "agent2-worker-specification.md", tasks);

    const prompt = spy.mock.calls[0][1];
    expect(prompt).toContain("**Existing Artifacts**:");
    expect(prompt).toContain("research: dawn-docs/active/research/2026-02-15-AGI-1-add-auth.md");
  });

  it("marks Blocked and persists to disk when output has no WORK_RESULT", async () => {
    await writeTaskFile({
      id: "AGI-1",
      title: "Test",
      description: "Test task",
      repo: "https://github.com/test/repo",
      status: "Needs Research",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    vi.spyOn(processor, "runClaudeInSandbox").mockResolvedValue(
      noWorkResultOutput
    );

    await processor.dispatchStage(task, "agent2-worker-research.md", tasks);

    expect(task.status).toBe(TaskStatus.Blocked);
    expect((await readFrontmatter()).status).toBe("Blocked");
  });

  it("injects merge instructions for code-producing terminal tasks", async () => {
    const validateSuccessOutput = `WORK_RESULT:
  success: true
  stage_completed: validate
  merge_status: pr_created
  pr_url: https://github.com/test/repo/pull/1
  next_status: "Awaiting Merge"
  summary: All checks pass. PR created.
`;

    // Write a prompt template for validate that includes the placeholder
    await writeFile(
      join((processor as any).promptLoader.promptsDir, "agent2-worker-validate.md"),
      "Validate.\n{{MERGE_INSTRUCTIONS}}"
    );

    await writeTaskFile({
      id: "AGI-1",
      title: "Add auth",
      description: "Implement OAuth2",
      repo: "https://github.com/test/repo",
      status: "Needs Validate",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    const spy = vi
      .spyOn(processor, "runClaudeInSandbox")
      .mockResolvedValue(validateSuccessOutput);

    await processor.dispatchStage(task, "agent2-worker-validate.md", tasks);

    // The prompt sent to Claude should contain merge-pr.md content
    const prompt = spy.mock.calls[0][1];
    expect(prompt).toContain("Create a PR.");
  });

  it("prints LIVE PREVIEW READY banner when preview_url is in result", async () => {
    const previewOutput = `WORK_RESULT:
  success: true
  stage_completed: validate
  next_status: "Done"
  preview_url: https://3000-mock.proxy.daytona.works
  summary: App running with preview.
`;

    await writeTaskFile({
      id: "AGI-1",
      title: "Build UI",
      description: "Create landing page",
      repo: "https://github.com/test/repo",
      status: "Needs Validate",
    });

    await writeFile(
      join((processor as any).promptLoader.promptsDir, "agent2-worker-validate.md"),
      "Validate.\n{{MERGE_INSTRUCTIONS}}"
    );

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    vi.spyOn(processor, "runClaudeInSandbox").mockResolvedValue(previewOutput);
    const logSpy = vi.spyOn(console, "log");

    await processor.dispatchStage(task, "agent2-worker-validate.md", tasks);

    const bannerCall = logSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("LIVE PREVIEW READY")
    );
    expect(bannerCall).toBeDefined();
    expect(bannerCall![0]).toContain("https://3000-mock.proxy.daytona.works");
  });

  it("does NOT delete sandbox when preview_url exists", async () => {
    const previewOutput = `WORK_RESULT:
  success: true
  stage_completed: validate
  next_status: "Done"
  preview_url: https://3000-mock.proxy.daytona.works
  summary: App running with preview.
`;

    await writeTaskFile({
      id: "AGI-1",
      title: "Build UI",
      description: "Create landing page",
      repo: "https://github.com/test/repo",
      status: "Needs Validate",
    });

    await writeFile(
      join((processor as any).promptLoader.promptsDir, "agent2-worker-validate.md"),
      "Validate.\n{{MERGE_INSTRUCTIONS}}"
    );

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    vi.spyOn(processor, "runClaudeInSandbox").mockResolvedValue(previewOutput);

    await processor.dispatchStage(task, "agent2-worker-validate.md", tasks);

    const mockSandbox = await (processor as any).daytona.create.mock.results[0].value;
    expect(mockSandbox.delete).not.toHaveBeenCalled();
  });

  it("deletes sandbox when no preview_url in result", async () => {
    await writeTaskFile({
      id: "AGI-1",
      title: "Test",
      description: "Test task",
      repo: "https://github.com/test/repo",
      status: "Needs Research",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    vi.spyOn(processor, "runClaudeInSandbox").mockResolvedValue(researchSuccessOutput);

    // Stub spec stage to block so loop exits
    let callIdx = 0;
    vi.spyOn(processor, "runClaudeInSandbox").mockImplementation(
      async () => [researchSuccessOutput, specBlockedOutput][callIdx++] ?? ""
    );

    await processor.dispatchStage(task, "agent2-worker-research.md", tasks);

    const mockSandbox = await (processor as any).daytona.create.mock.results[0].value;
    expect(mockSandbox.delete).toHaveBeenCalled();
  });

  it("logs warning when merge fallback produces no WORK_RESULT", async () => {
    const validateSuccessNoMerge = `WORK_RESULT:
  success: true
  stage_completed: validate
  branch_name: dawn/AGI-1
  commit_hash: def5678
  next_status: "Done"
  summary: All checks pass.
`;

    await writeTaskFile({
      id: "AGI-1",
      title: "Add auth",
      description: "Implement OAuth2",
      repo: "https://github.com/test/repo",
      status: "Needs Validate",
    });

    await writeFile(
      join((processor as any).promptLoader.promptsDir, "agent2-worker-validate.md"),
      "Validate.\n{{MERGE_INSTRUCTIONS}}"
    );

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    // First call returns success with no merge_status (triggers merge fallback)
    // Second call (merge fallback) returns garbage with no WORK_RESULT
    let callIdx = 0;
    vi.spyOn(processor, "runClaudeInSandbox").mockImplementation(
      async () => [validateSuccessNoMerge, "Some garbage output with no structured result."][callIdx++] ?? ""
    );

    const warnSpy = vi.spyOn(console, "warn");

    await processor.dispatchStage(task, "agent2-worker-validate.md", tasks);

    const mergeWarning = warnSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("Merge invocation did not produce a WORK_RESULT")
    );
    expect(mergeWarning).toBeDefined();
  });

  it("auto-corrects localhost preview URL to Daytona URL in results", async () => {
    const localhostPreviewOutput = `WORK_RESULT:
  success: true
  stage_completed: validate
  next_status: "Done"
  preview_url: http://localhost:3000
  summary: App running with preview.
`;

    await writeTaskFile({
      id: "AGI-1",
      title: "Build UI",
      description: "Create landing page",
      repo: "https://github.com/test/repo",
      status: "Needs Validate",
    });

    await writeFile(
      join((processor as any).promptLoader.promptsDir, "agent2-worker-validate.md"),
      "Validate.\n{{MERGE_INSTRUCTIONS}}"
    );

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    vi.spyOn(processor, "runClaudeInSandbox").mockResolvedValue(localhostPreviewOutput);

    await processor.dispatchStage(task, "agent2-worker-validate.md", tasks);

    const data = await readFrontmatter();
    // Should be auto-corrected from localhost:3000 to the Daytona URL
    expect(data.preview_url).toBe("https://3000-mock.proxy.daytona.works");
  });

  it("resolves {{PREVIEW_URL}} to Daytona URL in oneshot prompts", async () => {
    await writeFile(
      join((processor as any).promptLoader.promptsDir, "agent2-worker-oneshot.md"),
      "Build it.\n{{MERGE_INSTRUCTIONS}}\nPreview: {{PREVIEW_URL}}"
    );

    await writeTaskFile({
      id: "AGI-1",
      title: "Build UI",
      description: "Create landing page",
      repo: "https://github.com/test/repo",
      status: "Needs Oneshot",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    const spy = vi
      .spyOn(processor, "runClaudeInSandbox")
      .mockResolvedValue(specBlockedOutput);

    await processor.dispatchStage(task, "agent2-worker-oneshot.md", tasks);

    const prompt = spy.mock.calls[0][1];
    expect(prompt).toContain("https://3000-mock.proxy.daytona.works");
    expect(prompt).not.toContain("{{PREVIEW_URL}}");
  });

  it("marks Blocked when MAX_STAGES is exhausted", async () => {
    const loopingOutput = `WORK_RESULT:
  success: true
  stage_completed: research
  next_status: "Needs Research"
  summary: Still going.
`;

    await writeTaskFile({
      id: "AGI-1",
      title: "Test",
      description: "d",
      repo: "https://github.com/test/repo",
      status: "Needs Research",
    });

    const tasks = await processor.loadAllTasks();
    const task = tasks[0];

    const spy = vi
      .spyOn(processor, "runClaudeInSandbox")
      .mockResolvedValue(loopingOutput);

    await processor.dispatchStage(task, "agent2-worker-research.md", tasks);

    expect(task.status).toBe(TaskStatus.Blocked);
    expect((await readFrontmatter()).status).toBe("Blocked");
    // Safety invariant: loop stopped at exactly MAX_STAGES (10)
    expect(spy).toHaveBeenCalledTimes(10);
  });
});
