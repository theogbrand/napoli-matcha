# Session Context

## User Prompts

### Prompt 1

Implement the following plan:

# Plan: Fix PTY Log Streaming - JSON Parsing & Log Files

## Context
The PTY streamed logs from Claude Code are messy and untraceable. We need to:
1. Properly parse and `console.log` each JSON line from Claude's `stream-json` output (temporary debug logging)
2. Write all output to persistent `agent-{n}.log` files organized by ticket ID, linked back to the request queue MD file

## Files to Modify
- `src/lib/SandboxQueueProcessor.ts` — main changes (interface, ID ...

### Prompt 2

Referring to the update in @CLAUDE.md , create tests to confidently test this new feature with agent logs.

