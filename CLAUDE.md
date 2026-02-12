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

## Production-Grade OOP Architecture

### Class Hierarchy & Inheritance
- Use a base class for shared logic; create specialized subclasses that override only what differs
- Subclasses should call through to the parent (`super`) rather than duplicating logic
- Keep inheritance shallow (1-2 levels deep) — prefer composition for cross-cutting concerns

### Factory Instantiation & Dependency Injection
- Instantiate classes through factory functions, not direct constructor calls from business logic
- Inject dependencies (clients, callbacks, config) via the constructor — never reach for globals
- Use conditional logic in factories to return the correct subclass variant (e.g., sync vs async)

### Composition Over Deep Inheritance
- Compose behavior by embedding collaborator objects as class fields (e.g., `this.hooks = hooks || new Hooks()`)
- Each composed object encapsulates its own state and exposes a clean public API
- Keep internal state private (`private` / `#` prefix); expose only intentional methods

### Protocols, Interfaces & Type Safety
- Define TypeScript `interface` or `type` contracts for callable signatures and data shapes
- Use enums for finite, known value sets (modes, providers, event names) — not raw strings
- Leverage structural typing (duck typing) so classes are interchangeable when they share the same shape

### Polymorphic Behavior
- Use property accessors or fluent methods that return `this` for chainable APIs
- Use explicit method delegation rather than dynamic dispatch (e.g., Proxy) — keep call paths traceable
- Select behavior at runtime via conditional checks on enums/types, not long `if/else` chains on strings

### Event Systems & Hooks
- Encapsulate event registration and emission in a dedicated `Hooks` class with typed event names
- Register handlers via a public `.on(eventName, handler)` API; keep the handler map private
- Support composability — allow merging or combining hook instances (operator overloading / `merge()` method)
