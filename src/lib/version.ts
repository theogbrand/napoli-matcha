import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

export function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, "..", "..", "package.json");
    return JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;
  } catch {
    return "unknown";
  }
}
