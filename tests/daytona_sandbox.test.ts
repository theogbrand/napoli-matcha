import { describe, it, expect } from "vitest";
import { Daytona } from "@daytonaio/sdk";
import dotenv from "dotenv";

dotenv.config();

describe("Daytona sandbox", () => {
  it("should create a sandbox, run Claude Code, and clean up", async () => {
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
        onData: (data) => process.stdout.write(data),
      });

      await ptyHandle.waitForConnection();

      ptyHandle.sendInput(
        `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} ${claudeCommand}\n`
      );
      ptyHandle.sendInput("exit\n");

      await ptyHandle.wait();
    } finally {
      await sandbox.delete();
    }
  });
});
