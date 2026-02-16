#!/usr/bin/env node

import { getVersion } from "./lib/version.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Dawn v${getVersion()} - Autonomous Task Queue Processor

Usage:
  dawn              Process tasks from request_queue/
  dawn --help       Show this help message
  dawn --version    Show version

Environment Variables (set in .env):
  DAYTONA_API_KEY       Daytona sandbox API key (required)
  ANTHROPIC_API_KEY     Anthropic API key (required)
  GITHUB_TOKEN          GitHub token for PR creation (required)
  DAWN_CLAUDE_MODEL     Model to use (default: claude-opus-4-6)
  DAWN_MAX_CONCURRENCY  Parallel tasks (default: 1)
  DAWN_MERGE_MODE       "pr" (default), "auto", or "direct"
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log(getVersion());
  process.exit(0);
}

import("./index.js").then((m) => m.main().catch(console.error));
