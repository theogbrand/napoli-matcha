# PR: POLY-39 - POLY-36b: SpecAgent — Quality Gate + Ticket Writer

**Branch**: `horizon/POLY-39`
**Linear Issue**: POLY-39
**Date**: 2026-02-14

## Summary

Implements the SpecAgent — a front-door quality gate that evaluates user feature requests against 5 spec criteria, runs a clarification loop (max 3 rounds), detects variant requests, and writes structured tickets to the `feature_requests/` directory. This is Sub-Issue 2 of the Agent Pipeline Enhancement (POLY-36).

## Problem

The agent pipeline needs a quality gate before ticket creation. Without it, vague or ambiguous user requests would produce poorly defined tickets that downstream agents cannot implement effectively. The system needs to evaluate requests, ask clarifying questions when needed, and produce well-structured tickets with proper ID continuation and variant chain support.

## Solution

Built a `SpecAgent` class that orchestrates a clarification loop using `ClaudeSpawner` and a structured prompt (`prompts/agent0-spec.md`). The agent evaluates requests against 5 criteria (clarity, scope, testability, completeness, no ambiguity), asks up to 3 rounds of clarifying questions via Node readline, and writes tickets with YAML frontmatter to the `feature_requests/FR-{n}/AGI-{m}.md` directory structure.

## Changes

### Files Changed
- `src/lib/SpecAgent.ts` - New SpecAgent class with clarification loop, ticket writing, ID continuation, and variant chain handling (~218 LOC)
- `tests/spec_agent.test.ts` - Comprehensive test suite with 15 tests covering parsing, ID generation, and variant handling
- `prompts/agent0-spec.md` - Spec agent system prompt with 5 evaluation criteria and TICKETS/QUESTIONS output format (created in Sub-Issue 1)
- `horizon-docs/plans/2026-02-14-POLY-36-agent-pipeline-enhancement.md` - Updated plan status

## Testing

### Automated
- [x] Tests pass (`npm test`) — 87 unit tests pass; 4 pre-existing integration test failures (daytona_sandbox, pr_creation) are unrelated and require live services
- [x] TypeScript compiles (`npm run typecheck`) — zero errors
- [ ] Lint passes (`npm run lint`) — N/A (no lint script configured)

### Manual Verification
- Reviewed SpecAgent.ts implementation against plan's Sub-Issue 2 specification
- Verified all exported pure functions are tested (parseTickets, parseQuestions, nextFeatureRequestId, nextTicketId)
- Confirmed prompt file has all 5 spec quality criteria
- Verified variant chain handling with group/variantHint fields

## Breaking Changes

None. This is a purely additive change — new files only.

## Migration Notes

None. No existing code is modified.

## Screenshots

N/A — non-UI changes.

---
Created by [Horizon](https://github.com/ob1-sg/horizon) with [Claude Code](https://claude.ai/claude-code)
