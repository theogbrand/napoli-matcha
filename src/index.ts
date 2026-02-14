import dotenv from "dotenv";
import { SandboxQueueProcessor } from "./lib/SandboxQueueProcessor.js";
import { SpecAgent } from "./lib/SpecAgent.js";

dotenv.config();

export async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "spec") {
    const userRequest = args.join(" ");
    if (!userRequest) {
      console.error('Usage: npx tsx src/index.ts spec "<your request>"');
      process.exit(1);
    }
    const agent = new SpecAgent();
    const tickets = await agent.run(userRequest);
    console.log(`Created ${tickets.length} ticket(s):`);
    for (const t of tickets) console.log(`  - ${t}`);
  } else {
    const processor = new SandboxQueueProcessor(process.env.DAYTONA_API_KEY!);
    await processor.processQueue();
  }
}

const isDirectRun =
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
