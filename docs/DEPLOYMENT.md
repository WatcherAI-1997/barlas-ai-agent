# Production deployment

The production stack is separate from every existing agent: its own Compose
project, networks, containers, database, workspaces, backups, Caddy state,
ports, credentials, and bot identity.

## Prepare

1. Copy `deploy/production.env.example` to `deploy/production.env`.
2. Set file mode to `0600` and replace every placeholder with a dedicated
   secret. Never reuse an existing agent token or database.
3. Point the chosen domain to the server. The default host ports are 18080 and
   18443 specifically to avoid taking ports from current services; map or proxy
   them intentionally after checking the host.
4. Validate without starting anything:

   ```bash
   docker compose -f compose.production.yml --env-file deploy/production.env config --quiet
   ```

## Start

```bash
docker compose -f compose.production.yml --env-file deploy/production.env --profile backup up -d --build
```

Check container health, then run `deploy/smoke-test.sh` against the public URL.
Telegram remains disabled until a dedicated bot token and webhook secret are
configured and the webhook is registered to this deployment's domain.

The one-shot `migrate` service applies the ordered, idempotent SQL files after
PostgreSQL becomes healthy and before the API is allowed to start.

## Upgrade

Create and verify a backup first. Pull the reviewed commit, rebuild only this
Compose project, inspect the one-shot migration result, health and logs, and
run the smoke test. Database migrations are immutable and ordered.

## Rollback

Keep the previous image tag and database backup. Application rollback is an
image-tag change. A database restore is a separate, explicit operation and
requires `ALLOW_BARLAS_RESTORE=YES`; it must never target another agent's
database or volume.
