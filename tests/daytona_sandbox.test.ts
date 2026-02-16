import { describe, it, expect } from "vitest";
import { Daytona } from "@daytonaio/sdk";
import dotenv from "dotenv";

dotenv.config();

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

describe("Daytona sandbox", () => {
  it("should create a sandbox, run Claude Code, and clean up", async () => {
    expect(process.env.DAYTONA_API_KEY).toBeTruthy();
    expect(process.env.ANTHROPIC_API_KEY).toBeTruthy();

    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    const sandbox = await daytona.create({ language: "typescript" });

    try {
      const claudeCommand =
        "claude --dangerously-skip-permissions -p 'write a dad joke about penguins' --output-format stream-json --verbose";

      await sandbox.process.executeCommand(
        "npm install -g @anthropic-ai/claude-code"
      );

      const ptyHandle = await sandbox.process.createPty({
        id: "claude",
        envs: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
        },
        onData: (data) => {
          process.stdout.write(data);
        },
      });

      await withTimeout(
        ptyHandle.waitForConnection(),
        30_000,
        "Timed out waiting for PTY connection"
      );

      ptyHandle.sendInput(`${claudeCommand}\n`);
      ptyHandle.sendInput("exit\n");

      const result = await withTimeout(
        ptyHandle.wait(),
        300_000,
        "Timed out waiting for Claude command to finish"
      );
      expect(result.exitCode).toBe(0);
    } finally {
      await sandbox.delete();
    }
  });
});
