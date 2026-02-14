import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRun = vi.fn().mockResolvedValue(["/path/to/ticket.md"]);
const mockProcessQueue = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/lib/SpecAgent.js", () => ({
  SpecAgent: class {
    run = mockRun;
  },
}));

vi.mock("../src/lib/SandboxQueueProcessor.js", () => ({
  SandboxQueueProcessor: class {
    processQueue = mockProcessQueue;
    constructor(_key: string) {}
  },
}));

import { main } from "../src/index.js";

describe("Entry point routing", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("invokes SpecAgent.run when 'spec' command is given with a request", async () => {
    process.argv = ["node", "index.ts", "spec", "Build", "a", "REST", "API"];
    await main();
    expect(mockRun).toHaveBeenCalledWith("Build a REST API");
  });

  it("exits with error when 'spec' command is given without a request", async () => {
    process.argv = ["node", "index.ts", "spec"];
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await main();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage:"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("invokes SandboxQueueProcessor.processQueue when no command is given", async () => {
    process.argv = ["node", "index.ts"];
    await main();
    expect(mockProcessQueue).toHaveBeenCalled();
  });
});
