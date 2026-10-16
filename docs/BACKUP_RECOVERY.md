# Backup and recovery

The optional `backup` profile creates PostgreSQL custom-format dumps and SHA-256
sidecars in the dedicated `barlas-ai-agent-production-backups` volume. The same
cycle now archives the dedicated user-workspace volume with its own SHA-256
sidecar. Default frequency is daily and default retention is fourteen days.

A backup is not trusted until it has been restored into a disposable database
and checked with `/ready`, an owner login, conversation reads, and an autonomous
test run. Perform that drill before launch and after every schema change.

Copy both artifacts to encrypted off-host storage using an operator-selected
backup system. Database and workspace snapshots share the same timestamp. Never
mount or include an existing working agent's data directory.

`deploy/restore.sh` refuses to run unless the operator supplies both an explicit
dump path and `ALLOW_BARLAS_RESTORE=YES`. Stop API and workers before an actual
production restore, verify the target Compose project and volume names, restore,
start the stack, and run the smoke test.

`deploy/restore-workspaces.sh` similarly requires
`ALLOW_BARLAS_WORKSPACE_RESTORE=YES`, verifies the sidecar when present, and
targets only the explicitly named `barlas-ai-agent-production-workspaces`
volume. It replaces the contents of that volume, so stop API/workers, verify the
archive and target, and take a fresh snapshot before running it.
