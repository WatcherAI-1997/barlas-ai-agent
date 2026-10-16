# Production deployment

The production stack is separate from every existing agent: its own Compose
project, networks, containers, database, workspaces, backups, Caddy state,
ports, credentials, and bot identity.

## Prepare

1. Copy `deploy/production.env.example` to `deploy/production.env`.
2. Set file mode to `0600` and replace every placeholder with a dedicated
   secret. Never reuse an existing agent token or database.
   Generate the connector encryption key with `openssl rand -base64 32`, store
   it in `CONNECTOR_VAULT_KEY`, and back it up separately in an operator-owned
   secret manager. Losing this key makes saved connector credentials unreadable.
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
Semantic memory remains optional; set `EMBEDDING_MODEL` to an embedding model
available through the dedicated model API key to enable it.

The production stack includes an unexposed Playwright browser sidecar. Keep
`BROWSER_WS_ENDPOINT=ws://browser:3000/`; never publish port 3000. The browser
has a separate egress network while the database remains on the internal
backend network. Interactive actions remain approval-gated. Local development
may start the same optional sidecar with `docker compose --profile browser up`.

The one-shot `migrate` service applies the ordered, idempotent SQL files after
PostgreSQL becomes healthy and before the API is allowed to start.

## Upgrade

Create and verify a backup first. Pull the reviewed commit, rebuild only this
Compose project, inspect the one-shot migration result, health and logs, and
run the smoke test. Database migrations are immutable and ordered.

The production stack also builds an offline code sandbox. Generate a dedicated
`SANDBOX_SHARED_TOKEN` with at least 32 random characters. The API and runner
share only the `sandbox_socket` and Barlas workspace volumes; the runner uses
`network_mode: none` and must never receive `/var/run/docker.sock` or a host
filesystem mount.

Remote MCP connections are created per user in the encrypted connector vault.
Use public HTTPS Streamable HTTP endpoints only, store the endpoint in connector
metadata and the bearer token in the secret field, and grant the remote server
the minimum permissions required. Localhost, private networks, nonstandard
ports, cross-origin redirects, and unbounded responses are rejected. A token of
`-` explicitly selects an unauthenticated MCP endpoint.

## Rollback

Keep the previous image tag and database backup. Application rollback is an
image-tag change. A database restore is a separate, explicit operation and
requires `ALLOW_BARLAS_RESTORE=YES`; it must never target another agent's
database or volume.

Before admitting users, complete the gates in [Release readiness](RELEASE_READINESS.md).
