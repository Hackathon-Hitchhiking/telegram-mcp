# Verification, 2026-11-10

## Offline

- Original upstream baseline: 675 tests passed.
- Extended full-suite snapshot: 753 tests passed, none failed or skipped.
- Final changed rich semantic normalization + formatting/parser/docs regressions: 48 tests passed after that snapshot.
- TypeScript typecheck, Biome, schema integrity check, package build, VitePress build and diff checks passed.
- Packaged schema was checked in an isolated container with no network and no session mount.
- Existing local folder/probe regressions: 19 passed against the updated installed package.
- Connector-hub worker supervisor regressions: 10 passed. Rust formatting, Clippy and all tests passed (two existing ignored tests).

## Live MCP

All Telegram interaction used MCP, including the Streamable HTTP MCP endpoint for tools not present in this chat's cached catalog. No direct Telegram client, account login or GUI was used.

- Existing account connected after the scoped worker cutover; Premium and server rich-message eligibility confirmed.
- Live catalog: 183 tools with current opt-ins and two retained folder extensions; the complete package manifest has 194 tools.
- Native rich preview: 2 tables, 22 + 4 body rows, 4,808 visible characters, 40 blocks; no truncation or unsupported syntax.
- One authorized comparison send to the explicitly selected private chat; the accepted message ID is retained only in the private verification record.
- The durable request ID is retained only in the private operation journal.
- The initial receipt preserved accepted state and ID, but verification was false because the first verifier did not normalize Telegram's generated `TextAutoUrl` wrappers. The operation was never resent or edited.
- After correcting normalization, exact-message MCP readback matched text, all table cells, explicit links, styles and normalized native structure. Readback was complete, with no unsupported constructors.
- Expected and returned semantic SHA-256: `bfe210836260eb80931699aebe4bc702686276f33af837574b6f6d304d7e1c41`.
- New exact-ID, history-page and sent-media reads succeeded; folder listing and the local full-folder extension succeeded.
- The group is a basic group: the existing message-link tool does not provide a t.me permalink for it.

## Packaged runtime

Artifact SHA-256: `081173f1b11ea8ff4c16b1b167498f291afdf8c78cbeaf92a2176f157681165f`.

Image ID: `sha256:adba53b5dcc87a8ddc4409c5283eecc8d894462c4b1453d3ba0e171b8452a211`.

The worker is running and healthy. Credentials, session volumes, Rust gateway and local folder extensions were retained. Rollback image and deployment-file backups are documented separately.

## Claude clients

Claude Code user-scoped `telegram` configuration already targets the shared HTTP endpoint; `claude mcp get telegram` confirmed Connected. Claude Desktop already uses `~/.local/bin/mcp-telegram-local`, a stdio-to-HTTP bridge to the same endpoint. A fresh MCP connection through that exact configured executable returned all 183 active tools, all 12 additions, and layer-233 Premium rich-message capability. No configuration rewrite or second Telegram owner was needed. Already-open client conversations may keep their earlier tool catalog until reconnection.
