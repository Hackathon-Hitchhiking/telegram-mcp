# Pinned Telegram user API schema

`telegram_api.tl` and `LICENSE` are exact copies from the official TDLib
commit recorded in `provenance.json`. The schema is layer 233, also used by
the official Telegram clients on the date this integration was prepared.
The package's `telegram@2.26.22` dependency originally supplies layer 198.

Run `node scripts/telegram-schema.mjs` after installing dependencies and before
importing `telegram`. It replaces only GramJS's generated TL source string and
negotiated layer constant. GramJS generates its normal classes and response
registry once during startup, preserving its own `Api.Message` identity and
custom message methods. The core MTProto transport schema is left unchanged.
This is an install/build operation; it must not run in an already-loaded client.

The installer verifies the pinned source/license checksums, dependency version,
and original dependency file checksums. It accepts either the original files or
its exact generated result, so repeated installation is idempotent and unrelated
dependency edits fail closed. `--check` verifies that the upgrade is already
installed without writing files. `--dry-run` reports the intended changes.

GramJS's parser omits six built-in primitive declarations that TDLib includes.
The generated source removes only these exact declarations; the vendored source
remains unchanged. No API methods or fields are filtered out.

The schema and checksum updates must be reviewed together when upgrading the
official Telegram layer or the GramJS package. Offline tests cover native rich
table request bytes and nested `Updates`/`Message.rich_message` response decoding.
They do not establish server-side permissions, account Premium status, or live
message delivery.
