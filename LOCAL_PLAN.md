# Telegram MCP local extension plan

Base: upstream `v1.45.1` (`0fde88256343afba7a49d43b1a262d6485f20ccf`).

## Intended result

- Native rich Markdown tables sent, read back and edited through the existing Telegram MCP and the existing Premium-capable account.
- Versioned Telegram layer 233 schema, including the necessary response constructors, installed before GramJS loads.
- Useful additional message read methods and full schema/field discovery without a startup catalog containing hundreds of raw mutation tools.
- More complete fields for ordinary message sending, replies, editing and drafts, with backwards-compatible existing calls.
- A tested fork packaged for the existing single-owner worker and Rust gateway; credentials, sessions and local folder extensions retained.

## Execution

1. Clone latest upstream into `mcps/telegram`, inspect current deployment and establish official MTProto contracts.
2. Vendor pinned official TDLib schema and test build-time GramJS compatibility, serialization and response decoding.
3. Implement bounded rich Markdown compilation and dedicated preview/send/read/edit/draft tools, plus advanced message reads and schema discovery.
4. Integrate field additions, documentation and tests. Run targeted tests, typecheck, lint, full tests and build.
5. Package the fork, build a separately tagged worker image, cut over only Telegram and verify MCP discovery, account/session and folder-extension reads.
6. Send an explicitly authorized comparison to the selected group through MCP as a native rich message and read back its table blocks. Never automatically resend an uncertain write.

## Verification boundaries

- Offline fixtures verify protocol bytes, validation, parser behavior and transport mock calls; live MCP readback separately establishes delivery.
- Unsupported rich syntax must produce an explicit validation error rather than quietly becoming plain text.
- Schema capability discovery does not imply every MTProto method is exposed as an executable MCP tool.
- No upstream push, npm publication, new login or secret migration is part of this task.

## Work ownership

- Root: rich text modules, TelegramService/tool integration, package hooks, docs and local deployment.
- Schema executor: `vendor/telegram-schema`, schema patch script, schema tests.
- API executor: new advanced-message and schema-catalog helper/tool modules and tests.
- Research/exploration lanes: official schema and runtime evidence only.

## Completion evidence

All six steps completed. See `LOCAL_DEPLOYMENT.md` for runtime/rollback and `LIVE_VERIFICATION.md` for the exact one-send/readback evidence.
