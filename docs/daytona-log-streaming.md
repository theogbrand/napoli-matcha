# Daytona Log Streaming via PTY (TypeScript SDK)

## Overview

Real-time log streaming from Daytona sandboxes uses the **PTY (pseudo-terminal)** API. The session-based approach (`createSession` / `executeSessionCommand` / `getSessionCommandLogs`) did not deliver data reliably in practice. PTY streaming is proven and works.

## API Methods

### `createPty(options): Promise<PtyHandle>`

Creates an interactive PTY session with real-time output streaming.

```typescript
interface PtyCreateOptions {
  id: string;                        // Unique session identifier
  cwd?: string;                      // Working directory
  envs?: Record<string, string>;     // Environment variables
  cols?: number;                     // Terminal columns
  rows?: number;                     // Terminal rows
}

interface PtyConnectOptions {
  onData: (data: Uint8Array) => void; // Callback for each chunk of output
}
```

### `PtyHandle` methods

- `waitForConnection(): Promise<void>` - Wait for WebSocket connection to establish
- `sendInput(data: string): void` - Send input to the PTY shell
- `wait(): Promise<PtyResult>` - Block until the PTY session ends
- `disconnect(): Promise<void>` - Clean up the connection
- `resize(cols, rows): Promise<void>` - Resize the terminal

### `PtyResult`

```typescript
interface PtyResult {
  exitCode?: number;
}
```

## Full Streaming Example

```typescript
import { Daytona } from "@daytonaio/sdk";

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const sandbox = await daytona.create({ language: "typescript" });

const decoder = new TextDecoder();

const pty = await sandbox.process.createPty({
  id: "my-session",
  cwd: "/home/daytona/repo",
  envs: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    PATH: "/home/daytona/.npm-global/bin:/usr/local/bin:/usr/bin:/bin",
  },
  onData: (data: Uint8Array) => {
    const text = decoder.decode(data, { stream: true });
    process.stdout.write(text); // Real-time output
  },
});

await pty.waitForConnection();

pty.sendInput("claude -p 'write a dad joke' --output-format=stream-json --verbose\n");
pty.sendInput("exit\n");

const result = await pty.wait();
console.log(`Exited with code: ${result.exitCode}`);

await sandbox.delete();
```

## Key Details

- **`onData` receives `Uint8Array`** — use `TextDecoder` with `{ stream: true }` to handle multi-byte UTF-8 across chunk boundaries
- **PTY output includes ANSI escape codes** — strip with `/\x1b\[[0-9;]*[a-zA-Z]/g` before JSON parsing
- **Environment variables** are passed natively via `envs` — no need to inline them in the command string
- **Working directory** is set via `cwd` — no need to `cd` inside the shell
- **`sendInput("exit\n")`** after your command ensures the PTY shell terminates and `wait()` resolves
- **`wait()` resolves** when the shell process exits (after both the command and the `exit` complete)
