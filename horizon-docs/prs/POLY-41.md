# PR: POLY-41 - POLY-36d: Test-Writer + Entry Point

**Branch**: `horizon/POLY-41`
**Linear Issue**: POLY-41
**Date**: 2026-02-14

## Summary

Refactors `src/index.ts` for two-mode CLI operation (spec vs orchestrator) and refines the test-writer prompt with concrete vitest patterns. This is the 4th and final sub-issue of the POLY-36 Agent Pipeline Enhancement.

## Problem

The entry point lacked a way to invoke the SpecAgent for interactive ticket creation. The test-writer prompt needed refinement based on patterns established during sub-issues 1-3.

## Solution

Added CLI routing in `src/index.ts`: `spec` command invokes `SpecAgent.run()` for ticket creation, default mode runs `SandboxQueueProcessor.processQueue()` for orchestration. Refined `prompts/agent2-worker-test.md` with concrete vitest patterns (framework imports, pure function testing, file-system tests with temp dirs, private method access via reflection, frontmatter helpers).

## Changes

### Files Changed
- `src/index.ts` - Two-mode CLI: `spec` command routes to SpecAgent, default runs orchestrator
- `prompts/agent2-worker-test.md` - Refined test-writer prompt with concrete vitest patterns
- `tests/entry_point.test.ts` - 3 tests for spec routing, missing-request error, orchestrator fallback
- `horizon-docs/plans/2026-02-14-POLY-36-agent-pipeline-enhancement.md` - Marked Sub-Issue 4 as complete

## Testing

### Automated
- [x] Tests pass (`npm test`) — 90/90 unit tests
- [ ] TypeScript compiles (`npx tsc --noEmit`) — 7 pre-existing errors from POLY-40, none new
- [x] Lint passes (`npm run lint`) — N/A (no ESLint config)

### Manual Verification
- Verified `spec` command routing via unit test mocks
- Verified orchestrator fallback via unit test mocks
- Verified missing-request error handling via unit test

## Breaking Changes

None

## Migration Notes

None

## Screenshots

N/A — non-UI changes

---
🤖 Created by [Horizon](https://github.com/ob1-sg/horizon) with [Claude Code](https://claude.ai/claude-code)
