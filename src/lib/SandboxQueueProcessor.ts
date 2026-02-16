import { Daytona, Image, Sandbox } from "@daytonaio/sdk";
import matter from "gray-matter";
import { appendFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import {
  TaskStatus,
  isActionable,
  inProgressStatus,
  stagePromptMap,
  codeProducingStages,
} from "./TaskStatus.js";
import { PromptLoader } from "./PromptLoader.js";
import { parseWorkResult, WorkResult } from "./WorkResultParser.js";
import {
  setupSandboxEnvironment,
  configureGit,
  setupBranch,
  generatePreviewUrls,
} from "./SandboxSetup.js";
import { StreamFormatter, StreamEvent, stripAnsi } from "./StreamFormatter.js";

export interface TaskRequest {
  id: string;
  file: string;
  filePath: string;
  title: string;
  description: string;
  repo: string;
  status: TaskStatus;
  dependsOn: string[];
  group?: string;
  variantHint?: string;
}

export interface OrchestratorConfig {
  daytonaApiKey: string;
  anthropicApiKey: string;
  githubToken: string;
  claudeModel: string;
  maxConcurrency: number;
  maxIterations: number;
  pollInterval: number;
  mergeMode: "auto" | "direct" | "pr";
}

export class SandboxQueueProcessor {
  private static readonly MAX_STAGES = 10;
  private daytona: Daytona;
  private queueDir: string;
  private logsDir: string;
  private promptLoader: PromptLoader;
  private orchConfig: OrchestratorConfig;

  constructor(daytonaApiKeyOrConfig: string | OrchestratorConfig) {
    const config: OrchestratorConfig =
      typeof daytonaApiKeyOrConfig === "string"
        ? {
            daytonaApiKey: daytonaApiKeyOrConfig,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
            githubToken: process.env.GITHUB_TOKEN ?? "",
            claudeModel: "claude-sonnet-4-5-20250929",
            maxConcurrency: 2,
            maxIterations: Infinity,
            pollInterval: 0,
            mergeMode: "pr",
          }
        : daytonaApiKeyOrConfig;

    this.orchConfig = config;
    this.daytona = new Daytona({ apiKey: config.daytonaApiKey });
    const root = join(import.meta.dirname, "..", "..");
    this.queueDir = join(root, "request_queue");
    this.logsDir = join(root, "logs");
    this.promptLoader = new PromptLoader();
  }

  async processQueue(): Promise<void> {
    const activeIds = new Set<string>();
    let iteration = 0;

    while (iteration < this.orchConfig.maxIterations) {
      iteration++;
      const allTasks = await this.loadAllTasks();
      const eligible = this.filterEligible(allTasks, activeIds);

      if (eligible.length === 0) {
        const anyInProgress = allTasks.some((t) =>
          t.status.includes("In Progress")
        );
        if (!anyInProgress) {
          console.log("[Dawn] No eligible tasks and nothing in progress. Stopping.");
          break;
        }
        console.log("[Dawn] No eligible tasks. Waiting...");
        await new Promise((r) => setTimeout(r, this.orchConfig.pollInterval));
        continue;
      }

      const toDispatch = eligible.slice(
        0,
        this.orchConfig.maxConcurrency - activeIds.size
      );

      const dispatches = toDispatch.map(async (task) => {
        const promptFile = stagePromptMap.get(task.status);
        if (!promptFile) return;

        activeIds.add(task.id);
        try {
          await this.dispatchStage(task, promptFile, allTasks);
        } catch (err) {
          console.error(`[Dawn] ${task.id} failed:`, err);
          await this.updateTaskStatus(task, TaskStatus.Blocked);
        } finally {
          activeIds.delete(task.id);
        }
      });

      await Promise.all(dispatches);
    }
  }

  async dispatchStage(
    task: TaskRequest,
    promptFile: string,
    allTasks: TaskRequest[]
  ): Promise<void> {
    const label = `${task.id}`;
    const logDir = join(this.logsDir, task.id);
    await mkdir(logDir, { recursive: true });

    const GH_VERSION = "2.86.0";
    const image = Image.base("node:24-bookworm").runCommands(
      "apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates jq && rm -rf /var/lib/apt/lists/*",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz | tar -xz -C /tmp && mv /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh && chmod +x /usr/local/bin/gh`,
      "npm install -g @anthropic-ai/claude-code",
    );

    const sandbox = await this.daytona.create({
      language: "typescript",
      image,
      resources: { cpu: 2, memory: 4, disk: 8 },
    }, {
      timeout: 300,
      onSnapshotCreateLogs: (chunk) => console.log(`[Dawn:${label}:build] ${chunk.trim()}`),
    });
    console.log(`[Dawn:${label}] Sandbox created`);

    let hasPreviewUrl = false;

    try {
      const verify = await sandbox.process.executeCommand(
        "which claude && claude --version && which gh && gh --version"
      );
      if (verify.exitCode !== 0) {
        console.error(`[Dawn:${label}] Tool verification failed: ${verify.result}`);
        throw new Error("Sandbox missing required tools (claude, gh)");
      }
      console.log(`[Dawn:${label}] Tools verified: ${verify.result.trim()}`);

      const repoDir = await setupSandboxEnvironment(sandbox, task.repo, label);
      await configureGit(sandbox, label, this.orchConfig.githubToken);

      const branch = this.branchName(task);
      await setupBranch(sandbox, repoDir, branch, label);

      const previewUrls = await generatePreviewUrls(sandbox);
      console.log(`[Dawn:${label}] Preview URLs generated for ports: ${Object.keys(previewUrls).join(", ")}`);

      let stageCount = 0;
      let currentPromptFile = promptFile;

      while (stageCount < SandboxQueueProcessor.MAX_STAGES) {
        stageCount++;

        const logFile = join(logDir, `stage-${task.status.replace(/\s+/g, "-").toLowerCase()}.log`);
        const header = [
          "=== Dawn Agent Log ===",
          `Task: ${task.id}`,
          `Title: ${task.title}`,
          `Stage: ${task.status}`,
          `Queue File: request_queue/${task.file}`,
          `Started: ${new Date().toISOString()}`,
          "===\n\n",
        ].join("\n");
        await writeFile(logFile, header);

        const actionableStatus = task.status;
        await this.updateTaskStatus(task, inProgressStatus(task.status));

        const prompt = await this.buildStagePrompt(task, currentPromptFile, allTasks, previewUrls, actionableStatus);
        await appendFile(logFile, [
          "╔══════════════════════════════════════════════════════════╗",
          "║                    PROMPT SENT TO CLAUDE                ║",
          "╚══════════════════════════════════════════════════════════╝",
          "",
          prompt,
          "",
          "═".repeat(60),
          "",
        ].join("\n"));

        const output = await this.runClaudeInSandbox(
          sandbox,
          prompt,
          repoDir,
          label,
          logFile
        );

        const result = parseWorkResult(output);
        if (!result) {
          console.warn(`[Dawn:${label}] No WORK_RESULT found in output`);
          await this.updateTaskStatus(task, TaskStatus.Blocked);
          break;
        }

        if (result.previewUrl) {
          result.previewUrl = this.resolvePreviewUrl(result.previewUrl, previewUrls);
        }

        if (
          result.success &&
          codeProducingStages.has(actionableStatus) &&
          this.isTerminal(task, allTasks) &&
          !result.mergeStatus
        ) {
          const mergePrompt = await this.buildMergePrompt(task, branch, result.previewUrl);
          const mergeOutput = await this.runClaudeInSandbox(
            sandbox,
            mergePrompt,
            repoDir,
            label,
            logFile
          );
          const mergeResult = parseWorkResult(mergeOutput);
          if (mergeResult) {
            result.mergeStatus = mergeResult.mergeStatus;
            result.prUrl = mergeResult.prUrl;
            if (mergeResult.nextStatus) result.nextStatus = mergeResult.nextStatus;
          } else {
            console.warn(`[Dawn:${label}] Merge invocation did not produce a WORK_RESULT — PR may not have been created`);
          }
        }

        await this.writeResults(task, result);

        if (result.previewUrl) {
          hasPreviewUrl = true;
          this.printPreviewBanner(result.previewUrl, (sandbox as any).id ?? "unknown");
        }

        const footer = `\n=== Stage finished: ${new Date().toISOString()} ===\n`;
        await appendFile(logFile, footer);

        if (!isActionable(task.status)) break;

        const nextPromptFile = stagePromptMap.get(task.status);
        if (!nextPromptFile) break;
        currentPromptFile = nextPromptFile;
        console.log(`[Dawn:${label}] Continuing to next stage: ${task.status}`);
      }

      if (stageCount >= SandboxQueueProcessor.MAX_STAGES && isActionable(task.status)) {
        console.warn(`[Dawn:${label}] Hit MAX_STAGES (${SandboxQueueProcessor.MAX_STAGES}), marking Blocked`);
        await this.updateTaskStatus(task, TaskStatus.Blocked);
      }
    } finally {
      if (hasPreviewUrl) {
        console.log(`[Dawn:${label}] Sandbox kept alive (preview active) — delete from https://app.daytona.io/dashboard`);
      } else {
        await sandbox.delete();
        console.log(`[Dawn:${label}] Sandbox deleted`);
      }
    }
  }

  async buildStagePrompt(
    task: TaskRequest,
    promptFile: string,
    allTasks: TaskRequest[],
    previewUrls: Record<number, string> = {},
    actionableStatus?: TaskStatus
  ): Promise<string> {
    const statusForCheck = actionableStatus ?? task.status;
    const mergeFragment =
      codeProducingStages.has(statusForCheck) && this.isTerminal(task, allTasks)
        ? await this.promptLoader.load(`fragments/merge-${this.orchConfig.mergeMode}.md`)
        : "";

    const stageTemplate = await this.promptLoader.load(promptFile);

    const vars: Record<string, string> = {
      MERGE_INSTRUCTIONS: mergeFragment,
      STAGE: statusForCheck.split(" ")[1]?.toLowerCase() ?? "unknown",
      WORKFLOW: "staged",
      ARTIFACT_DIR: statusForCheck.includes("Oneshot") ? "oneshot" : "validation",
      PROVIDER_LINK: `[Claude](https://claude.ai) (${this.orchConfig.claudeModel})`,
      PREVIEW_URLS: Object.entries(previewUrls)
        .map(([port, url]) => `- Port ${port}: ${url}`)
        .join("\n"),
    };

    const filled = this.promptLoader.fill(stageTemplate, vars);

    // Read artifacts from frontmatter
    const raw = await readFile(task.filePath, "utf-8");
    const { data } = matter(raw);
    const artifacts = data.artifacts as Record<string, string> | undefined;

    const artifactLines: string[] = [];
    if (artifacts && Object.keys(artifacts).length > 0) {
      artifactLines.push("**Existing Artifacts**:");
      for (const [stage, path] of Object.entries(artifacts)) {
        artifactLines.push(`  - ${stage}: ${path}`);
      }
      artifactLines.push("");
    }

    // Prepend task context
    const context = [
      "## Task Context",
      "",
      `**Task ID**: ${task.id}`,
      `**Title**: ${task.title}`,
      `**Description**: ${task.description}`,
      `**Repo**: ${task.repo}`,
      `**Branch**: ${this.branchName(task)}`,
      `**Stage**: ${task.status}`,
      ...artifactLines,
      "",
      "---",
      "",
    ].join("\n");

    return context + filled;
  }

  async buildMergePrompt(task: TaskRequest, branch: string, previewUrl?: string): Promise<string> {
    const mergeTemplate = await this.promptLoader.load(
      `fragments/merge-${this.orchConfig.mergeMode}.md`
    );
    return this.promptLoader.fill(mergeTemplate, {
      STAGE: "validate",
      WORKFLOW: "staged",
      ARTIFACT_DIR: "validation",
      PROVIDER_LINK: `[Claude](https://claude.ai) (${this.orchConfig.claudeModel})`,
      PREVIEW_URL: previewUrl ?? "N/A - no web server",
    });
  }

  async runClaudeInSandbox(
    sandbox: Sandbox,
    prompt: string,
    repoDir: string,
    label: string,
    logFile: string
  ): Promise<string> {
    const escaped = prompt.replace(/'/g, "'\\''");
    const claudeCmd = `IS_SANDBOX=1 claude -p '${escaped}' --dangerously-skip-permissions --output-format=stream-json --model ${this.orchConfig.claudeModel} --verbose`;

    console.log(`[Dawn:${label}] Starting Claude via PTY...`);
    console.log(`[Dawn:${label}] PTY cwd=${repoDir}`);

    const decoder = new TextDecoder();
    let buffer = "";
    let fullOutput = "";
    const formatter = new StreamFormatter();

    let resolveResult: () => void;
    const resultPromise = new Promise<void>((resolve) => { resolveResult = resolve; });
    const terminalLogFile = logFile.replace(/\.log$/, "-terminal.log");

    const pty = await sandbox.process.createPty({
      id: `claude-${label}-${Date.now()}`,
      cwd: repoDir,
      envs: {
        ANTHROPIC_API_KEY: this.orchConfig.anthropicApiKey,
        GITHUB_TOKEN: this.orchConfig.githubToken,
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
      onData: (data: Uint8Array) => {
        const text = decoder.decode(data, { stream: true });
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          fullOutput = this.processStreamLine(
            line, formatter, label, logFile, terminalLogFile, fullOutput, resolveResult!
          );
        }
      },
    });

    await pty.waitForConnection();
    pty.sendInput(`${claudeCmd}\n`);

    // Wait for Claude to emit the result event instead of pty.wait()
    // (the PTY WebSocket doesn't close reliably after shell exit)
    await resultPromise;
    await pty.disconnect();

    // Flush remaining buffer
    if (buffer.trim()) {
      fullOutput = this.processStreamLine(
        buffer, formatter, label, logFile, terminalLogFile, fullOutput
      );
    }

    console.log(`[Dawn:${label}] Claude session completed`);
    await appendFile(logFile, `\nClaude session completed\n`);

    return fullOutput;
  }

  async writeResults(task: TaskRequest, result: WorkResult): Promise<void> {
    if (result.nextStatus) {
      await this.updateTaskStatus(task, result.nextStatus);
      console.log(`[Dawn:${task.id}] Status → ${result.nextStatus}`);
    } else if (!result.success) {
      await this.updateTaskStatus(task, TaskStatus.Blocked);
      console.log(`[Dawn:${task.id}] Status → Blocked (failed)`);
    }

    // Write result summary to frontmatter
    const raw = await readFile(task.filePath, "utf-8");
    const { data } = matter(raw);
    if (result.branchName) data.branch_name = result.branchName;
    if (result.commitHash) data.commit_hash = result.commitHash;
    if (result.prUrl) data.pr_url = result.prUrl;
    if (result.previewUrl) data.preview_url = result.previewUrl;
    if (result.summary) data.last_summary = result.summary;
    if (result.error) data.last_error = result.error;
    if (result.artifactPath && result.stageCompleted) {
      if (!data.artifacts) data.artifacts = {};
      (data.artifacts as Record<string, string>)[result.stageCompleted] = result.artifactPath;
    }
    await writeFile(task.filePath, matter.stringify("", data));
  }

  // --- Pure logic methods (public for testing) ---

  filterEligible(
    allTasks: TaskRequest[],
    activeIds: Set<string>
  ): TaskRequest[] {
    return allTasks.filter((task) => {
      if (!isActionable(task.status)) return false;
      if (activeIds.has(task.id)) return false;
      if (task.dependsOn.length > 0) {
        const allDepsDone = task.dependsOn.every((depId) => {
          const dep = allTasks.find((t) => t.id === depId);
          return dep?.status === TaskStatus.Done;
        });
        if (!allDepsDone) return false;
      }
      return true;
    });
  }

  isTerminal(task: TaskRequest, allTasks: TaskRequest[]): boolean {
    return !allTasks.some(
      (t) =>
        t.id !== task.id &&
        t.status !== TaskStatus.Done &&
        t.dependsOn.includes(task.id)
    );
  }

  branchName(task: TaskRequest): string {
    return task.group ? `dawn/${task.group}` : `dawn/${task.id}`;
  }

  resolvePreviewUrl(
    url: string,
    previewUrls: Record<number, string>
  ): string {
    const localhostMatch = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
    if (localhostMatch) {
      const port = parseInt(localhostMatch[1], 10);
      if (previewUrls[port]) {
        console.log(`[Dawn] Auto-corrected preview URL: localhost:${port} → Daytona URL`);
        return previewUrls[port];
      }
    }
    return url;
  }

  // --- Task loading and persistence ---

  async loadAllTasks(): Promise<TaskRequest[]> {
    const files = (await readdir(this.queueDir)).filter((f) =>
      f.endsWith(".md")
    );

    let maxId = 0;
    const allData: {
      file: string;
      filePath: string;
      data: Record<string, unknown>;
    }[] = [];
    for (const file of files) {
      const filePath = join(this.queueDir, file);
      const raw = await readFile(filePath, "utf-8");
      const { data } = matter(raw);
      allData.push({ file, filePath, data });
      if (typeof data.id === "string") {
        const match = data.id.match(/^AGI-(\d+)$/);
        if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
      }
    }

    const tasks: TaskRequest[] = [];
    for (const { file, filePath, data } of allData) {
      if (!data.id) {
        maxId++;
        data.id = `AGI-${maxId}`;
        await writeFile(filePath, matter.stringify("", data));
        console.log(`[Dawn] Assigned ${data.id} to ${file}`);
      }

      const rawStatus = (data.status as string) ?? "Needs Research";
      const status = Object.values(TaskStatus).find(
        (v) => v === rawStatus
      ) as TaskStatus | undefined;

      if (!status) {
        console.warn(
          `[Dawn] Unknown status "${rawStatus}" in ${file}, skipping`
        );
        continue;
      }

      const dependsOnRaw = data.depends_on;
      const dependsOn: string[] = Array.isArray(dependsOnRaw)
        ? dependsOnRaw.map(String)
        : typeof dependsOnRaw === "string"
          ? [dependsOnRaw]
          : [];

      tasks.push({
        id: data.id as string,
        file,
        filePath,
        title: data.title as string,
        description: data.description as string,
        repo: data.repo as string,
        status,
        dependsOn,
        group: data.group as string | undefined,
        variantHint: data.variant_hint as string | undefined,
      });
    }

    return tasks;
  }

  async updateTaskStatus(
    task: TaskRequest,
    status: TaskStatus
  ): Promise<void> {
    const raw = await readFile(task.filePath, "utf-8");
    const { data } = matter(raw);
    await writeFile(
      task.filePath,
      matter.stringify("", { ...data, status })
    );
    task.status = status;
  }

  // --- Preview banner ---

  private printPreviewBanner(previewUrl: string, sandboxId: string): void {
    const urlDisplay = previewUrl.length > 50 ? previewUrl.slice(0, 50) + "..." : previewUrl;
    const banner = [
      "",
      "╔══════════════════════════════════════════════════════╗",
      "║  LIVE PREVIEW READY                                  ║",
      `║  URL: ${urlDisplay}`,
      `║  Sandbox ID: ${sandboxId}`,
      "║  Delete from: https://app.daytona.io/dashboard       ║",
      "╚══════════════════════════════════════════════════════╝",
      "",
    ].join("\n");
    console.log(banner);
  }

  // --- Stream handling ---

  private processStreamLine(
    line: string,
    formatter: StreamFormatter,
    label: string,
    logFile: string,
    terminalLogFile: string,
    fullOutput: string,
    onResult?: () => void
  ): string {
    const stripped = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
    if (!stripped) return fullOutput;

    if (!stripped.startsWith("{")) {
      console.log(`[${label}:raw] ${stripped}`);
      appendFile(logFile, `[raw] ${stripped}\n`);
      return fullOutput;
    }

    try {
      const event: StreamEvent = JSON.parse(stripped);
      appendFile(logFile, JSON.stringify(event) + "\n");

      const extracted = formatter.extractText(event);
      if (extracted) fullOutput += extracted + "\n";

      const formatted = formatter.format(event);
      if (formatted) {
        console.log(`[${label}] ${formatted}`);
        appendFile(terminalLogFile, stripAnsi(formatted) + "\n");
      }

      if (event.type === "result") onResult?.();
    } catch {
      appendFile(logFile, `[raw] ${stripped}\n`);
    }

    return fullOutput;
  }
}
