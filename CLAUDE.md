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
