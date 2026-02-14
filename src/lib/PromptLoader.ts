import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROMPTS_DIR = join(process.cwd(), "prompts");

export function loadPrompt(
  name: string,
  variables?: Record<string, string>,
): string {
  const filePath = join(PROMPTS_DIR, `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Prompt not found: ${name} (looked at ${filePath})`);
  }

  let content = readFileSync(filePath, "utf-8");

  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      content = content.split(`{{${key}}}`).join(value);
    }
  }

  return content;
}

export function loadPromptFragment(name: string): string {
  const filePath = join(PROMPTS_DIR, "fragments", `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(
      `Prompt fragment not found: ${name} (looked at ${filePath})`,
    );
  }
  return readFileSync(filePath, "utf-8");
}
