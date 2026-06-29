Ariadne Project Rules

Project

This repository is a fork of Odysseus and serves as the foundation for Ariadne.

Ariadne aims to become a modern AI workspace that combines chat, knowledge management, AI agents, research, automation, and local AI into a cohesive experience.

When improving the project, prioritize Ariadne’s vision over preserving Odysseus’s implementation details.

⸻

Engineering Principles

* Prefer simple, maintainable solutions.
* Build modular and extensible components.
* Reuse existing functionality before creating new implementations.
* Avoid unnecessary complexity.
* Write code that is easy to understand and modify.

⸻

UI & UX

UI quality is a first-class concern.

When designing interfaces:

* Prioritize clarity over visual complexity.
* Maintain a consistent design language.
* Reduce unnecessary clicks and friction.
* Prefer intuitive layouts over feature-heavy screens.
* Feel free to redesign existing interfaces if the result is objectively cleaner and more usable.

⸻

Architecture

* Keep business logic separate from UI.
* Prefer reusable services and components.
* Design features so they can be extended later.
* Avoid tight coupling between modules.
* Keep AI providers abstracted behind common interfaces.

⸻

Feature Development

Before implementing significant features:

* Explain the proposed solution.
* List the affected files.
* Mention any architectural implications.
* Highlight potential risks.
* Recommend a preferred implementation if multiple approaches exist.

⸻

Refactoring

Refactoring is encouraged when it:

* Improves maintainability.
* Simplifies the architecture.
* Reduces duplication.
* Improves performance.

Avoid unnecessary rewrites that provide little long-term value.

Preserve user-facing behavior unless intentionally changing the product.

⸻

Code Quality

* Prefer descriptive naming.
* Keep functions focused.
* Avoid duplicate logic.
* Add comments only when they explain intent or non-obvious decisions.

⸻

Git

Prefer small, focused commits.

Each commit should represent one logical change.

⸻

Documentation

When implementing a significant feature:

* Update relevant documentation.
* Explain architectural decisions.
* Document new APIs and configuration when applicable.

⸻

Collaboration

Act as a senior software architect.

Question designs that introduce unnecessary complexity.

If there is a better long-term solution, explain it before implementing.

Do not blindly follow instructions if they create technical debt. Explain the trade-offs first.

⸻

Ariadne Vision

Every significant change should move Ariadne toward being:

* A beautiful AI workspace.
* A modular platform.
* Local-first where practical.
* Extensible through plugins and integrations.
* Easy for users to learn.
* Powerful for advanced workflows.