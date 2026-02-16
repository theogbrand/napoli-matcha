---
title: Ralph HealthKit View
description: >-
  Propose a UI styling improvement for my dashboard app. It's too plain now,
  give it a clean, Apple-style classic design.
repo: 'https://github.com/theogbrand/ralph-healthkit-view'
number_of_sandboxes: 2
status: Blocked
id: TEST-AGI-5
branch_name: dawn/TEST-AGI-5
commit_hash: '3659693'
last_summary: >-
  |

  Created a 5-phase implementation plan for the Apple-style UI redesign of the
  Ralph HealthKit dashboard.

  Phase 1: Theme Foundation — Update globals.css with Apple-inspired OKLch color
  tokens (warm off-white

  background, Apple System Blue primary, true black dark mode) and increase base
  border-radius to 16px.


  Phase 2: Component Primitives — Restyle Card (shadow-only in light, border in
  dark), Button (pill-shaped,

  44px tap targets), Tabs (segmented control), and Progress (muted track)
  components.


  Phase 3: Dashboard Layout & Typography — Apply Apple typography hierarchy
  (34px Large Title, 22px section

  headings), update header separator, revise copy text per specification.


  Phase 4: Chart & Data Components — Update all 5 chart components and
  formatters.ts to use Apple Health

  color palette (Red #FF3B30, Orange #FF9500, Green #34C759, Blue #007AFF).


  Phase 5: Import Page Polish — Migrate FileUpload from raw gray-* Tailwind
  classes to theme tokens for

  proper dark mode support.


  Total: ~174 lines across 16 files. No sub-issues needed — scope is under 1000
  LOC and phases are

  sequential with shared dependencies. Validation via npm run typecheck + npm
  run build (no test suite).
artifacts:
  research: >-
    dawn-docs/active/research/2026-02-15-TEST-AGI-5-ralph-healthkit-view-apple-style-ui.md
  specification: >-
    dawn-docs/active/specifications/2026-02-15-TEST-AGI-5-apple-style-ui-redesign.md
  plan: dawn-docs/active/plans/2026-02-15-TEST-AGI-5-apple-style-ui-redesign.md
---

