---
name: devlane
description: Use when working in a repository that has a Devlane environment. Helps Codex inspect service status, read logs, restart services, reset databases, and avoid manually recreating local infrastructure.
---

When this repository has a Devlane environment:

1. Check Devlane status before starting backend services manually.
2. Use existing URLs from `.devlane/context.md` and `.env.local`.
3. Use Devlane logs to inspect backend, database, or worker failures.
4. Use Devlane restart commands instead of starting duplicate service processes.
5. Use Devlane reset commands when test data or migrations need a clean database.
6. Do not run Docker Compose or create new Postgres/Redis instances unless the user explicitly asks.
