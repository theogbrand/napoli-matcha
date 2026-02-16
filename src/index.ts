import dotenv from "dotenv";
import {
  SandboxQueueProcessor,
  OrchestratorConfig,
} from "./lib/SandboxQueueProcessor.js";
import { getVersion } from "./lib/version.js";

dotenv.config();

const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function displayBanner(): void {
  const version = getVersion();
  console.log(`
${BOLD}    ▓█▀▄ ▄▀▄ █   █ █▄ █
    █▄▀  █▀█ ▀▄▀▄▀ █ ▀█${RESET}

    ${YELLOW}☀  Turn task queues into pull requests  ☀${RESET}  ${DIM}v${version}${RESET}
${"═".repeat(55)}
`);
}

export async function main() {
  displayBanner();

  const config: OrchestratorConfig = {
    daytonaApiKey: process.env.DAYTONA_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    githubToken: process.env.GITHUB_TOKEN!,
    claudeModel: process.env.DAWN_CLAUDE_MODEL ?? "claude-opus-4-6",
    maxConcurrency: parseInt(process.env.DAWN_MAX_CONCURRENCY ?? "1", 10),
    maxIterations: process.env.DAWN_MAX_ITERATIONS
      ? parseInt(process.env.DAWN_MAX_ITERATIONS, 10)
      : Infinity,
    pollInterval: parseInt(process.env.DAWN_POLL_INTERVAL ?? "5000", 10),
    mergeMode: (process.env.DAWN_MERGE_MODE as "auto" | "direct" | "pr") ?? "pr",
  };

  console.log("[Dawn] Starting orchestrator...");
  console.log(`[Dawn] Max concurrency: ${config.maxConcurrency}`);
  console.log(`[Dawn] Max iterations: ${config.maxIterations}`);
  console.log(`[Dawn] Merge mode: ${config.mergeMode}`);

  const processor = new SandboxQueueProcessor(config);
  await processor.processQueue();
}

main().catch((error) => {
  console.error("[Dawn] Fatal error:", error);
  process.exit(1);
});
