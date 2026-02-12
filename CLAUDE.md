# TypeScript / OOP Code Style

## File & Module Structure
- One class per file, exported from `src/lib/ClassName.ts`
- Keep class files under ~300 lines; split by concern if larger
- Define interfaces at the top of the file, above the class definition
- Entry points (`index.ts`) should only instantiate and call `.run()` — no business logic

## Method Organization & Naming
- Order: public API methods first, then private methods grouped by concern
- Name methods by their action: `loadTasksFromQueue()`, `parseTaskFile()`, `updateTaskStatus()`
- Each method has one clear responsibility; keep methods ~5-20 lines
- Use labeled logging `[TaskQueue]`, `[Sandbox]` for parallel/concurrent operations

## Factory Instantiation & Dependency Injection
- Instantiate classes through factory functions, never direct `new` from business logic
- Inject dependencies (clients, callbacks, config) via constructor — never reach for globals
- Use conditional logic in factories to return the correct subclass variant (e.g., sync vs async)
- Example: `createExecutor(mode === 'pty' ? PtyExecutor : ExecExecutor, config)`

## Class Hierarchy & Composition
- Use a base class for shared logic; subclasses override only what differs
- Subclasses call through to `super` rather than duplicating logic
- Keep inheritance shallow (1-2 levels) — prefer composition for cross-cutting concerns
- Compose behavior via collaborator objects as fields: `this.hooks = hooks || new Hooks()`
- Keep internal state private (`private` or `#prefix`); expose only intentional public methods

## Protocols, Interfaces & Type Safety
- Define `interface` or `type` contracts for callable signatures and data shapes
- Use enums for finite value sets (modes, providers, event names) — not raw strings
- Leverage structural typing so classes are interchangeable when they share the same shape
- Example: `ExecutorOptions` interface injected into all executor variants

## Polymorphic Behavior & Runtime Selection
- Use property accessors or fluent methods returning `this` for chainable APIs
- Select behavior at runtime via enum/type checks, not long `if/else` on strings
- Use explicit method delegation rather than dynamic dispatch (Proxy) — keep call paths traceable

## Error Handling & Cleanup
- Use `try/finally` for resource cleanup (sandbox deletion, connection closing)
- Fail fast with thrown errors on critical failures; log and continue on non-critical ones
- Guard against bad input before processing: `line.startsWith("{")` before `JSON.parse(line)`
- Don't wrap everything in try/catch — only where recovery or cleanup is needed

## Async Patterns
- Use `Promise.all()` for independent parallel operations
- Always prefer `async/await` over raw promises or callbacks
- Example: `await Promise.all([loadConfig(), connectDB(), initCache()])`

## Event Systems & Hooks
- Encapsulate event registration/emission in a dedicated `Hooks` class with typed event names
- Register handlers via public `.on(eventName, handler)` API; keep handler map private
- Support composability — allow merging or combining hook instances via `.merge()` method

## Git Push & PR Creation in Sandboxes

When running inside a Daytona sandbox (or any environment where `GITHUB_TOKEN` is set but git has no credential helper), follow this exact sequence to push and create PRs without errors.

### Step 1: Configure git auth (once, before first push)
```bash
gh auth setup-git
```
This configures git to use `gh` as the credential helper, which automatically uses `GITHUB_TOKEN` from the environment. Do NOT try manual credential helpers with bash functions — they fail in non-bash shells (e.g., `dash`/`sh`).

### Step 2: Push the branch
```bash
git push -u origin <branch-name>
```

### Step 3: Create the PR with `--head` flag
Always pass `--head` to avoid "you must first push" detection failures:
```bash
gh pr create --head <branch-name> --title "..." --body "$(cat <<'EOF'
...
EOF
)"
```

### Common pitfalls to avoid
- **Do NOT** use `git config credential.helper '!f() { ... }; f'` — breaks in non-bash shells
- **Do NOT** omit `--head` from `gh pr create` — `gh` may not detect the just-pushed branch
- **Do NOT** try `git push` before running `gh auth setup-git` — HTTPS remotes need credentials

## Testing Requirements

### When to Write Tests
Every change to the core workflow (`src/index.ts`, `src/lib/*.ts`) MUST include corresponding tests when any of the following apply:
- A new public method is added to a class
- A new private method encapsulates non-trivial logic (parsing, state transitions, error handling)
- The task processing pipeline gains a new step (e.g., new setup, new execution mode, new cleanup)
- A new interface or data shape is introduced that flows through the system
- An existing method's behavior or signature changes

### What to Test
- **Unit tests** for pure logic: parsing (frontmatter, JSON, PTY output), data transformations, input validation, status transitions
- **Integration tests** for end-to-end workflows: queue loading → sandbox execution → status update
- Place tests in `tests/` with the naming convention `<feature>.test.ts`

### Test Quality Standards
- Tests must assert on specific outcomes, not just "no error thrown"
- Cover both the happy path and at least one meaningful failure case (bad input, missing fields, malformed data)
- Use descriptive test names that state the expected behavior: `"updates task status from Backlog to Done after successful run"`
- Keep tests independent — no shared mutable state between test cases

### Enforcement
- Before marking a feature complete, run `npm test` and confirm all tests pass
- If a new feature cannot be covered by a fast unit test (e.g., requires live Daytona sandboxes), add an integration test and document the required environment variables
