import { describe, it, expect } from "vitest";
import { Daytona } from "@daytonaio/sdk";
import dotenv from "dotenv";
import { StreamFormatter, StreamEvent } from "../src/lib/StreamFormatter.js";

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

      const decoder = new TextDecoder();
      let buffer = "";
      const formatter = new StreamFormatter();

      const ptyHandle = await sandbox.process.createPty({
        id: "claude",
        onData: (data: Uint8Array) => {
          const text = decoder.decode(data, { stream: true });
          buffer += text;
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            const stripped = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
            if (!stripped) continue;

            if (!stripped.startsWith("{")) {
              console.log(`[raw] ${stripped}`);
              continue;
            }

            try {
              const event: StreamEvent = JSON.parse(stripped);
              const formatted = formatter.format(event);
              if (formatted) console.log(`[test] ${formatted}`);
            } catch {
              console.log(`[raw] ${stripped}`);
            }
          }
        },
      });

      await ptyHandle.waitForConnection();

      ptyHandle.sendInput(
        `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} ${claudeCommand}\n`
      );
      ptyHandle.sendInput("exit\n");

      await ptyHandle.wait();

      // Flush remaining buffer
      if (buffer.trim()) {
        const stripped = buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
        if (stripped.startsWith("{")) {
          try {
            const event: StreamEvent = JSON.parse(stripped);
            const formatted = formatter.format(event);
            if (formatted) console.log(`[test] ${formatted}`);
          } catch { /* ignore */ }
        }
      }
    } finally {
      await sandbox.delete();
    }
  });
});
