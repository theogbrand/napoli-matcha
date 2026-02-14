import { spawn } from "child_process";
import { existsSync } from "fs";

export interface SpawnResult {
  output: string;
  finalOutput: string;
  cost: number;
  duration: number;
  exitCode: number;
}

export interface SpawnOptions {
  prompt: string;
  model?: string;
  workingDirectory?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export async function spawnClaude(options: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const model = options.model ?? DEFAULT_MODEL;

    const args = [
      "-p",
      "--dangerously-skip-permissions",
      "--output-format=stream-json",
      "--model",
      model,
      "--verbose",
    ];

    if (options.mcpConfigPath && existsSync(options.mcpConfigPath)) {
      args.push("--mcp-config", options.mcpConfigPath);
    }

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.workingDirectory,
    });

    proc.stdin.write(options.prompt);
    proc.stdin.end();

    let output = "";
    let cost = 0;
    let duration = 0;

    proc.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[ClaudeSpawner] stderr: ${text}`);
    });

    proc.on("close", (code) => {
      const finalOutput = extractFinalOutput(output);
      const stats = extractStats(output);
      cost = stats.cost;
      duration = stats.duration;

      resolve({
        output,
        finalOutput,
        cost,
        duration,
        exitCode: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

export function extractFinalOutput(streamOutput: string): string {
  let lastTextContent = "";

  for (const line of streamOutput.split("\n")) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);

      if (json.type === "assistant" && !json.parent_tool_use_id) {
        const content = json.message?.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === "text" && item.text) {
              lastTextContent = item.text;
            }
          }
        }
      }

      if (json.type === "result" && !json.is_error && json.result) {
        lastTextContent = String(json.result);
      }
    } catch {
      // Not JSON, skip
    }
  }

  return lastTextContent;
}

function extractStats(streamOutput: string): {
  cost: number;
  duration: number;
} {
  for (const line of streamOutput.split("\n")) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      if (json.type === "result") {
        return {
          cost: json.total_cost_usd ?? 0,
          duration: json.duration_ms ?? 0,
        };
      }
    } catch {
      // Not JSON, skip
    }
  }
  return { cost: 0, duration: 0 };
}
