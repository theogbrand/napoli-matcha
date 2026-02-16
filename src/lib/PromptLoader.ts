import { readFile } from "fs/promises";
import { join } from "path";

export class PromptLoader {
  private promptsDir: string;

  constructor(promptsDir?: string) {
    this.promptsDir =
      promptsDir ?? join(import.meta.dirname, "..", "..", "prompts");
  }

  async load(name: string): Promise<string> {
    return readFile(join(this.promptsDir, name), "utf-8");
  }

  fill(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
      key in vars ? vars[key] : match
    );
  }

  async loadAndFill(
    name: string,
    vars: Record<string, string>
  ): Promise<string> {
    const template = await this.load(name);
    return this.fill(template, vars);
  }
}
