import { Daytona } from "@daytonaio/sdk";
import dotenv from "dotenv";
dotenv.config(); // looks for .env in process.cwd()

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

try {
    const sandbox = await daytona.create({
        language: 'typescript',
    });

    // Define the Claude Code command to be executed
    const claudeCommand =
    "claude --dangerously-skip-permissions -p 'write a dad joke about penguins' --output-format stream-json --verbose";

    // Install Claude Code in the sandbox
    await sandbox.process.executeCommand("npm install -g @anthropic-ai/claude-code");

    const ptyHandle = await sandbox.process.createPty({
        id: "claude",
        onData: (data) => {
            process.stdout.write(data);
        },
    });

    await ptyHandle.waitForConnection();

    // Run the Claude Code command inside the sandbox
    ptyHandle.sendInput(
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} ${claudeCommand}\n`
    );

    // Use this to close the terminal session if no more commands will be executed
    ptyHandle.sendInput("exit\n")

    await ptyHandle.wait();

    // If you are done and have closed the PTY terminal, it is recommended to clean up resources by deleting the sandbox
    await sandbox.delete();
} catch (error) {
    console.error("Failed to run Claude Code in Daytona sandbox:", error);
}