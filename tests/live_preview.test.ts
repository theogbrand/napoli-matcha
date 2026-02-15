import { describe, it, expect } from "vitest";
import { Daytona } from "@daytonaio/sdk";
import { generatePreviewUrls } from "../src/lib/SandboxSetup.js";
import dotenv from "dotenv";

dotenv.config();

const COUNTER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACCELERATE</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Space Mono', monospace;
      background: #0a0a0f;
      color: #e0e0e0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    h1 {
      font-size: 3rem;
      background: linear-gradient(90deg, #00f0ff, #ff00ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 2rem;
    }
    .counter {
      font-size: 6rem;
      font-weight: 700;
      color: #00f0ff;
      text-shadow: 0 0 20px rgba(0, 240, 255, 0.5);
      margin: 1rem 0;
      transition: transform 0.15s ease;
    }
    .counter.bump { transform: scale(1.1); }
    .controls { display: flex; gap: 1.5rem; margin-top: 1.5rem; }
    button {
      font-family: 'Space Mono', monospace;
      font-size: 1.2rem;
      padding: 0.8rem 2rem;
      border: 2px solid #00f0ff;
      background: transparent;
      color: #00f0ff;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover {
      background: #00f0ff;
      color: #0a0a0f;
      box-shadow: 0 0 25px rgba(0, 240, 255, 0.6);
    }
    .tagline {
      margin-top: 3rem;
      font-size: 0.9rem;
      color: #666;
      letter-spacing: 0.3em;
    }
  </style>
</head>
<body>
  <h1>BUILD THE FUTURE</h1>
  <div class="counter" id="counter">0</div>
  <div class="controls">
    <button onclick="update(-1)">&#x25C0; DEC</button>
    <button onclick="update(1)">INC &#x25B6;</button>
  </div>
  <p class="tagline">ACCELERATE</p>
  <script>
    let count = 0;
    const el = document.getElementById('counter');
    function update(d) {
      count += d;
      el.textContent = count;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 150);
    }
  </script>
</body>
</html>`;

describe("Live Preview", () => {
  it("should serve a page via signed preview URL", async () => {
    console.log("[LivePreview] Step 1: Creating Daytona client and sandbox...");
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    const sandbox = await daytona.create({ language: "typescript" });
    let sandboxId = "";
    console.log("[LivePreview] Step 1 done: sandbox created");

    try {
      sandboxId = (sandbox as any).id ?? "unknown";
      console.log("[LivePreview] Step 2: Generating signed preview URL for port 8080...");
      const previewUrls = await generatePreviewUrls(sandbox, [8080], 3600);
      const signedUrl = previewUrls[8080];
      console.log("[LivePreview] Step 2 done: signed URL generated");

      expect(signedUrl).toMatch(/^https:\/\/8080-.+\.proxy\..+/);

      console.log("[LivePreview] Step 3: Uploading index.html to sandbox...");
      await sandbox.fs.uploadFiles([
        {
          source: Buffer.from(COUNTER_HTML),
          destination: "/home/daytona/index.html",
        },
      ]);
      console.log("[LivePreview] Step 3 done: file uploaded");

      console.log("[LivePreview] Step 4: Starting HTTP server in sandbox via PTY...");
      const pty = await sandbox.process.createPty({
        id: "http-server",
        cwd: "/home/daytona",
        onData: (data) => process.stdout.write(`[server] ${data}`),
      });
      await pty.waitForConnection();
      pty.sendInput("python3 -m http.server 8080\n");
      console.log("[LivePreview] Step 4 done: server command sent");

      console.log("[LivePreview] Step 5: Waiting 3s for server startup...");
      await new Promise((r) => setTimeout(r, 3000));
      console.log("[LivePreview] Step 5 done");

      console.log("[LivePreview] Step 6: Fetching signed preview URL...");
      const response = await fetch(signedUrl, {
        headers: { "X-Daytona-Skip-Preview-Warning": "true" },
      });
      console.log("[LivePreview] Step 6 done: status", response.status);

      expect(response.status).toBe(200);

      const body = await response.text();
      expect(body).toContain("ACCELERATE");
      expect(body).toContain("counter");
      console.log("[LivePreview] Step 7: All assertions passed");

      // Log preview info for manual verification
      const banner = [
        "",
        "╔══════════════════════════════════════════════════════╗",
        "║  LIVE PREVIEW READY                                  ║",
        `║  URL: ${signedUrl.slice(0, 50)}...`,
        `║  Sandbox ID: ${sandboxId}`,
        "║  Expires in: 1 hour                                  ║",
        "║  Delete from: https://app.daytona.io/dashboard       ║",
        "╚══════════════════════════════════════════════════════╝",
        "",
      ].join("\n");
      console.log(banner);
    } finally {
      if (process.env.CLEANUP_SANDBOX === "true") {
        await sandbox.delete();
        console.log(`[LivePreview] Sandbox ${sandboxId} deleted`);
      } else {
        console.log(
          `[LivePreview] Sandbox ${sandboxId} kept alive — delete from https://app.daytona.io/dashboard`
        );
      }
    }
  });
});
