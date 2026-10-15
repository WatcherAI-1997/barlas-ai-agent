# Isolation policy

This policy is a hard project requirement.

Barlas AI Agent must not read, modify, restart, migrate, reuse, or depend on any
existing production agent's:

- configuration or workspace;
- memory or conversation history;
- credentials, API keys, or messaging tokens;
- databases or queues;
- ports, networks, containers, services, or process names;
- repositories or deployment pipelines.

## Required safeguards

- Dedicated project directory and Git repository.
- Dedicated secrets file excluded from version control.
- Dedicated container names, Compose project name, network, and volumes.
- Dedicated database credentials and schema.
- Dedicated Telegram bot and webhook.
- Explicit port allocation checked before startup.
- No migration or import unless the owner gives separate written approval.

