# Barlas AI Agent privacy policy template

> Draft for private-alpha deployment. Replace every `[placeholder]`, select the
> governing jurisdiction, and obtain qualified legal review before public use.
> This file is not legal advice.

**Effective date:** `[date]`  
**Controller/operator:** `[legal entity and registration details]`  
**Contact:** `[privacy email and postal address]`

## Data we process

Barlas AI Agent may process account identity data, authentication and security
events, prompts and responses, conversation history, saved memory, uploaded
workspace files, task and approval records, usage/token metrics, encrypted
third-party connector credentials, Telegram identifiers after account linking,
and limited technical logs. The deployment operator must document which model
providers and integrations are enabled and which countries receive data.

## Purposes and legal basis

Data is used to provide the requested agent service, authenticate users,
execute and recover tasks, enforce quotas and permissions, prevent abuse,
maintain auditability, back up the service, and meet legal obligations. The
operator must record the applicable basis for each purpose (contract,
legitimate interest, consent, or legal obligation) under local law.

## Models, tools, and recipients

Prompts or selected context may be sent to the configured model provider.
Tool calls may send data to services explicitly connected by the user. Risky
or externally visible actions require confirmation, but confirmation does not
replace the user's responsibility for lawful use. List all subprocessors at
`[subprocessor URL]` and sign required processing agreements before production.

## Retention and deletion

Define concrete periods for accounts, conversations, memory, task history,
audit events, logs, backups, and connector metadata. Deletion from the live
database may remain in encrypted backups until the stated backup rotation
expires. Users may request access, correction, export, restriction, objection,
or deletion where applicable by contacting `[privacy email]`.

## Security

The service uses scoped accounts, server-side sessions, approval gates,
encrypted connector secrets, isolated workspaces, audit records, TLS at the
edge, backups, and recovery checks. No system is perfectly secure; suspected
incidents should be reported to `[security email]`.

## Children, changes, and complaints

The service is not intended for children below the locally applicable age.
Material policy changes will be announced through `[method]`. Users may lodge a
complaint with their competent data-protection authority.

## Русское резюме

Оператор обязан заполнить реквизиты, сроки хранения, перечень провайдеров и
правовые основания. Barlas AI Agent хранит только данные, необходимые для
аккаунтов, диалогов, памяти, задач, инструментов, безопасности и резервного
копирования. Перед публичным запуском требуется юридическая проверка текста и
договоров с обработчиками данных.
