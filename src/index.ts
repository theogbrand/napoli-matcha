import dotenv from "dotenv";
import { SandboxQueueProcessor } from "./lib/SandboxQueueProcessor.js";

dotenv.config();

async function main() {
  const processor = new SandboxQueueProcessor(process.env.DAYTONA_API_KEY!);
  await processor.processQueue();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
