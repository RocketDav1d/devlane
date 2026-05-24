# Codex Node Postgres Demo

This example is a small repo-shaped app for demonstrating Devlane in Codex.

It contains:

- one API process
- one managed local Postgres service
- SQL migrations in `scripts/db/migrations`
- seed data in `scripts/db/seed.sql`
- a database reset command that drops the schema, reruns migrations, and reseeds
- health checks that require Postgres, migrations, and seed data to be ready
- generated Codex integration assets via `devlane install-codex`

Run it from the Devlane repo:

```bash
DEVLANE_HOME=/private/tmp/devlane-demo node ../../src/cli/index.js install-codex --project .
DEVLANE_HOME=/private/tmp/devlane-demo node ../../src/cli/index.js up --project .
DEVLANE_HOME=/private/tmp/devlane-demo node ../../src/cli/index.js status --project .
DEVLANE_HOME=/private/tmp/devlane-demo node ../../src/cli/index.js reset-db --project .
DEVLANE_HOME=/private/tmp/devlane-demo node ../../src/cli/index.js destroy --project .
```

Once it is running:

```bash
curl "$API_URL/health"
curl "$API_URL/todos"
curl -X POST "$API_URL/todos" -H 'content-type: application/json' -d '{"title":"Test Codex API change"}'
curl "$API_URL/events/count"
```

The Postgres scripts require local `postgres`, `initdb`, `pg_isready`, `psql`, and `createdb` binaries.
