# TypeScript / OOP Code Style

## Class Design
- One class per file, exported from a dedicated module (e.g., `src/lib/ClassName.ts`)
- Define interfaces for data structures at the top of the file, above the class
- Centralize configuration and dependencies in the constructor
- Keep entry points (`index.ts`) minimal — just instantiate and run

## Method Organization
- Public API methods first, then private methods grouped by concern
- Each private method should have a single, clear responsibility
- Name methods by what they do: `loadTasksFromQueue()`, `parseTaskFile()`, `updateTaskStatus()`
- Prefer small, focused methods (~5-20 lines) over large monolithic functions

## Error Handling & Cleanup
- Use `try/finally` for resource cleanup (e.g., sandbox deletion, connection closing)
- Fail fast with thrown errors on critical failures; log and continue on non-critical ones
- Guard against bad input before processing (e.g., check `startsWith("{")` before `JSON.parse`)
- Don't wrap everything in try/catch — only where recovery or cleanup is needed

## General Patterns
- Use `Promise.all()` for independent parallel operations
- Use labeled logging with `[label]` prefixes for concurrent/parallel operations
- Keep class files under ~300 lines; if a class grows beyond that, consider splitting by concern
- Prefer `async/await` over raw promises or callbacks
