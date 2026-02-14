import { createInterface } from "readline";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import { loadPrompt } from "./PromptLoader.js";
import { spawnClaude } from "./ClaudeSpawner.js";

export interface SpecAgentOptions {
  model?: string;
}

interface TicketDef {
  title: string;
  description: string;
  repo: string;
  group?: string;
  variantHint?: string;
  dependsOn: string[];
}

const MAX_ROUNDS = 3;
const FEATURE_REQUESTS_DIR = join(process.cwd(), "feature_requests");

export class SpecAgent {
  private model?: string;

  constructor(options?: SpecAgentOptions) {
    this.model = options?.model;
  }

  async run(userRequest: string): Promise<string[]> {
    let context = userRequest;
    let round = 0;

    while (round < MAX_ROUNDS) {
      const prompt = loadPrompt("agent0-spec", { USER_REQUEST: context });
      const result = await spawnClaude({ prompt, model: this.model });

      const output = result.finalOutput.trim();

      if (output.startsWith("TICKETS:")) {
        const tickets = parseTickets(output);
        return this.writeTickets(tickets);
      }

      if (output.startsWith("QUESTIONS:")) {
        const questions = parseQuestions(output);
        const answers = await this.askUser(questions);
        context = buildContext(userRequest, questions, answers, context);
        round++;
        continue;
      }

      // If output is neither TICKETS nor QUESTIONS, treat as tickets on last round
      // or re-prompt on earlier rounds
      if (round === MAX_ROUNDS - 1) {
        const tickets = parseTickets("TICKETS:\n" + output);
        return this.writeTickets(tickets);
      }
      round++;
    }

    // After max rounds, force ticket generation with what we have
    const prompt = loadPrompt("agent0-spec", { USER_REQUEST: context });
    const result = await spawnClaude({ prompt, model: this.model });
    const tickets = parseTickets(result.finalOutput.trim());
    return this.writeTickets(tickets);
  }

  private writeTickets(tickets: TicketDef[]): string[] {
    const paths: string[] = [];
    let frId = nextFeatureRequestId();
    let ticketId = nextTicketId();

    const frDir = join(FEATURE_REQUESTS_DIR, frId);
    mkdirSync(frDir, { recursive: true });

    for (const ticket of tickets) {
      const agiId = `AGI-${ticketId}`;
      const filePath = join(frDir, `${agiId}.md`);

      const frontmatter: Record<string, unknown> = {
        id: agiId,
        title: ticket.title,
        description: ticket.description,
        repo: ticket.repo || "TBD",
        status: "Backlog",
        dependsOn: ticket.dependsOn,
      };

      if (ticket.group) frontmatter.group = ticket.group;
      if (ticket.variantHint) frontmatter.variantHint = ticket.variantHint;

      const content = matter.stringify("", frontmatter);
      writeFileSync(filePath, content);
      paths.push(filePath);
      ticketId++;
    }

    return paths;
  }

  private async askUser(questions: string[]): Promise<string[]> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answers: string[] = [];

    for (const q of questions) {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`${q}\n> `, resolve);
      });
      answers.push(answer);
    }

    rl.close();
    return answers;
  }
}

// --- Pure helpers (exported for testing) ---

export function parseTickets(output: string): TicketDef[] {
  const body = output.replace(/^TICKETS:\s*/, "").trim();
  const tickets: TicketDef[] = [];
  const blocks = body.split(/^- /m).filter((b) => b.trim());

  for (const block of blocks) {
    const ticket: TicketDef = {
      title: "",
      description: "",
      repo: "TBD",
      dependsOn: [],
    };

    const titleMatch = block.match(/title:\s*"([^"]+)"/);
    if (titleMatch) ticket.title = titleMatch[1];

    const descMatch = block.match(/description:\s*\|\s*\n([\s\S]*?)(?=\n\s*\w+:|$)/);
    if (descMatch) ticket.description = descMatch[1].trim();

    const repoMatch = block.match(/repo:\s*"([^"]+)"/);
    if (repoMatch) ticket.repo = repoMatch[1];

    const groupMatch = block.match(/group:\s*"([^"]+)"/);
    if (groupMatch) ticket.group = groupMatch[1];

    const variantMatch = block.match(/variantHint:\s*"([^"]+)"/);
    if (variantMatch) ticket.variantHint = variantMatch[1];

    const depsMatch = block.match(/dependsOn:\s*\[([^\]]*)\]/);
    if (depsMatch && depsMatch[1].trim()) {
      ticket.dependsOn = depsMatch[1]
        .split(",")
        .map((d) => d.trim().replace(/"/g, ""))
        .filter(Boolean);
    }

    if (ticket.title) tickets.push(ticket);
  }

  return tickets;
}

export function parseQuestions(output: string): string[] {
  const body = output.replace(/^QUESTIONS:\s*/, "").trim();
  return body
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

export function nextFeatureRequestId(): string {
  if (!existsSync(FEATURE_REQUESTS_DIR)) return "FR-1";

  const dirs = readdirSync(FEATURE_REQUESTS_DIR).filter((d) =>
    /^FR-\d+$/.test(d),
  );
  if (dirs.length === 0) return "FR-1";

  const maxN = Math.max(...dirs.map((d) => parseInt(d.replace("FR-", ""), 10)));
  return `FR-${maxN + 1}`;
}

export function nextTicketId(): number {
  if (!existsSync(FEATURE_REQUESTS_DIR)) return 1;

  let maxN = 0;
  const frDirs = readdirSync(FEATURE_REQUESTS_DIR).filter((d) =>
    /^FR-\d+$/.test(d),
  );

  for (const dir of frDirs) {
    const dirPath = join(FEATURE_REQUESTS_DIR, dir);
    const files = readdirSync(dirPath).filter((f) => /^AGI-\d+\.md$/.test(f));
    for (const f of files) {
      const match = f.match(/AGI-(\d+)\.md$/);
      if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
    }
  }

  return maxN === 0 ? 1 : maxN + 1;
}

function buildContext(
  originalRequest: string,
  questions: string[],
  answers: string[],
  previousContext: string,
): string {
  let context = `Original request: ${originalRequest}\n\n`;
  if (previousContext !== originalRequest) {
    context += `Previous context:\n${previousContext}\n\n`;
  }
  context += "Clarification Q&A:\n";
  for (let i = 0; i < questions.length; i++) {
    context += `Q: ${questions[i]}\nA: ${answers[i] || "(no answer)"}\n`;
  }
  return context;
}
