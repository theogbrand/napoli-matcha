import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import {
  parseTickets,
  parseQuestions,
  nextFeatureRequestId,
  nextTicketId,
} from "../src/lib/SpecAgent.js";

const FEATURE_REQUESTS_DIR = join(process.cwd(), "feature_requests");

describe("SpecAgent", () => {
  describe("parseTickets", () => {
    it("parses a single ticket", () => {
      const output = `TICKETS:
- title: "Add user auth"
  description: |
    Implement JWT authentication
  repo: "https://github.com/org/repo"
  dependsOn: []`;

      const tickets = parseTickets(output);
      expect(tickets).toHaveLength(1);
      expect(tickets[0].title).toBe("Add user auth");
      expect(tickets[0].description).toBe("Implement JWT authentication");
      expect(tickets[0].repo).toBe("https://github.com/org/repo");
      expect(tickets[0].dependsOn).toEqual([]);
    });

    it("parses multiple tickets", () => {
      const output = `TICKETS:
- title: "Setup database"
  description: |
    Create PostgreSQL schema
  repo: "TBD"
  dependsOn: []
- title: "Add API endpoints"
  description: |
    REST endpoints for CRUD
  repo: "TBD"
  dependsOn: ["AGI-1"]`;

      const tickets = parseTickets(output);
      expect(tickets).toHaveLength(2);
      expect(tickets[0].title).toBe("Setup database");
      expect(tickets[1].title).toBe("Add API endpoints");
      expect(tickets[1].dependsOn).toEqual(["AGI-1"]);
    });

    it("parses variant tickets with group and variantHint", () => {
      const output = `TICKETS:
- title: "OAuth login"
  description: |
    OAuth2 flow
  repo: "TBD"
  group: "login-auth"
  variantHint: "Variant 1 of 2: OAuth"
  dependsOn: []
- title: "Email login"
  description: |
    Email/password flow
  repo: "TBD"
  group: "login-auth"
  variantHint: "Variant 2 of 2: Email"
  dependsOn: []`;

      const tickets = parseTickets(output);
      expect(tickets).toHaveLength(2);
      expect(tickets[0].group).toBe("login-auth");
      expect(tickets[0].variantHint).toBe("Variant 1 of 2: OAuth");
      expect(tickets[1].group).toBe("login-auth");
      expect(tickets[1].variantHint).toBe("Variant 2 of 2: Email");
    });

    it("returns empty array for output with no valid tickets", () => {
      const output = "TICKETS:\nnothing here";
      expect(parseTickets(output)).toEqual([]);
    });
  });

  describe("parseQuestions", () => {
    it("parses numbered questions", () => {
      const output = `QUESTIONS:
1. What database should we use?
2. Do you need authentication?
3. What is the target deployment platform?`;

      const questions = parseQuestions(output);
      expect(questions).toEqual([
        "What database should we use?",
        "Do you need authentication?",
        "What is the target deployment platform?",
      ]);
    });

    it("handles questions without numbers", () => {
      const output = `QUESTIONS:
What database should we use?
Do you need authentication?`;

      const questions = parseQuestions(output);
      expect(questions).toHaveLength(2);
      expect(questions[0]).toBe("What database should we use?");
    });

    it("filters empty lines", () => {
      const output = `QUESTIONS:

1. First question

2. Second question
`;
      const questions = parseQuestions(output);
      expect(questions).toHaveLength(2);
    });
  });

  describe("nextFeatureRequestId", () => {
    beforeEach(() => {
      rmSync(FEATURE_REQUESTS_DIR, { recursive: true, force: true });
    });

    afterEach(() => {
      rmSync(FEATURE_REQUESTS_DIR, { recursive: true, force: true });
    });

    it("returns FR-1 when directory does not exist", () => {
      expect(nextFeatureRequestId()).toBe("FR-1");
    });

    it("returns FR-1 when directory is empty", () => {
      mkdirSync(FEATURE_REQUESTS_DIR, { recursive: true });
      expect(nextFeatureRequestId()).toBe("FR-1");
    });

    it("returns FR-6 when FR-5 exists", () => {
      mkdirSync(join(FEATURE_REQUESTS_DIR, "FR-5"), { recursive: true });
      expect(nextFeatureRequestId()).toBe("FR-6");
    });

    it("finds max across non-sequential IDs", () => {
      mkdirSync(join(FEATURE_REQUESTS_DIR, "FR-2"), { recursive: true });
      mkdirSync(join(FEATURE_REQUESTS_DIR, "FR-7"), { recursive: true });
      mkdirSync(join(FEATURE_REQUESTS_DIR, "FR-3"), { recursive: true });
      expect(nextFeatureRequestId()).toBe("FR-8");
    });
  });

  describe("nextTicketId", () => {
    beforeEach(() => {
      rmSync(FEATURE_REQUESTS_DIR, { recursive: true, force: true });
    });

    afterEach(() => {
      rmSync(FEATURE_REQUESTS_DIR, { recursive: true, force: true });
    });

    it("returns 1 when directory does not exist", () => {
      expect(nextTicketId()).toBe(1);
    });

    it("returns 1 when no AGI files exist", () => {
      mkdirSync(join(FEATURE_REQUESTS_DIR, "FR-1"), { recursive: true });
      expect(nextTicketId()).toBe(1);
    });

    it("continues from max existing AGI ID", () => {
      const dir = join(FEATURE_REQUESTS_DIR, "FR-1");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "AGI-1.md"), "");
      writeFileSync(join(dir, "AGI-3.md"), "");
      expect(nextTicketId()).toBe(4);
    });

    it("scans across multiple FR directories", () => {
      const dir1 = join(FEATURE_REQUESTS_DIR, "FR-1");
      const dir2 = join(FEATURE_REQUESTS_DIR, "FR-2");
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });
      writeFileSync(join(dir1, "AGI-1.md"), "");
      writeFileSync(join(dir1, "AGI-2.md"), "");
      writeFileSync(join(dir2, "AGI-5.md"), "");
      expect(nextTicketId()).toBe(6);
    });
  });
});
