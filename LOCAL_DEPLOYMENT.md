# Local Telegram MCP deployment

This checkout starts from upstream `v1.45.1`, commit
`0fde88256343afba7a49d43b1a262d6485f20ccf`, on branch
`feature/rich-messages-api-coverage`. It is a local extension, not an upstream
release. `package.json` retains the upstream version.

## Protocol and API scope

The exact official TDLib layer-233 schema is vendored with provenance, checksums
and its Boost license under `vendor/telegram-schema`. The installer checks
`telegram@2.26.22` and upgrades its generated schema before importing GramJS.
Its published TypeScript declarations are older; `src/tl/current-schema.ts` and
narrow rich-message request adapters describe the reviewed differences.

There are 194 package tools with all opt-in groups enabled. The deployed account
currently exposes 183 tools, including two existing local folder extensions.
The API catalog describes 873 native methods; it does not execute arbitrary
methods. Normal message writes expose explicit UTF-16 entities, preview flags,
quotes, scheduling, send-as and cross-chat replies. Native tables use dedicated
rich-message tools, not ordinary `parseMode`.

Rich Markdown supports text blocks and tables, without media upload, nested
lists or arbitrary HTML. Unsupported syntax fails explicitly. Scheduled writes
are acknowledged separately from immediate delivery; a successful draft save
is not a delivered message.

## Runtime

The service wrapper remains in `~/.config/mcp-services/telegram`. Its existing
backend owns the only Telegram connection and registers its folder extensions
on the same service. The gateway remains at
`http://127.0.0.1:19100/telegram/mcp`. Credentials and persistent session mounts
are unchanged.

The wrapper pins the local archive
`overpod-mcp-telegram-1.45.1-rich-layer233.tgz` with lockfile integrity. Both the
installed Dockerfile and the canonical connector-hub worker recipe copy that
archive and explicitly run the schema installer after `npm ci --ignore-scripts`.
The image is tagged
`local/telegram-mcp:1.45.1-rich-layer233-rust-gateway-0.2.1`.

Build and packaging use `npm run build`, `npm pack`, then installation of the
archive in the wrapper. When replacing an archive under the same filename,
refresh the lockfile's package integrity before building. Validate the packaged
schema in an isolated container with no network, then recreate only `telegram`
using `docker compose up -d --no-deps telegram` from the service directory.
Never start a second client against the live session to test a package.

## Write reconciliation

Every rich send/edit/draft requires a UUID-v4 `requestId`. The private journal
stores hashes, state and identifiers, without message bodies. It publishes a
synced reservation before one submission. A repeat with the same payload
returns the recorded receipt; changing its payload is rejected. Uncertain
writes are never automatically replayed. `telegram-get-rich-send-status` reads
local state, and `telegram-get-rich-message` reads one exact peer/message.

Readback compares text, table cells, explicit URLs, styles and native block
semantics. Telegram-generated automatic link wrappers can be normalized without
removing explicit links or formatting. The read API reports unsupported
semantic constructors explicitly. A persistence error after acknowledgement
retains the known message ID and accepted state.

## Rollback

Pre-update deployment files are saved under
`~/.config/mcp-services/telegram/backups/20261110-rich-layer233`.
The original image is retained at both
`local/telegram-mcp:1.43.6-rust-gateway-0.2.1` and
`local/telegram-mcp:rollback-before-rich-layer233-20261110`, image ID
`sha256:fc51027899281ebcaee54952ba7050db0c8361d47ce540ca558d1abe3a415e07`.
A runtime rollback changes only Telegram's image reference and recreates that
service; it does not remove data, credentials or journals.
