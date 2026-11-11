# Schema installer fixtures

`gramjs-2.26.22-source.json.gz` contains the unmodified published
`telegram@2.26.22` files `tl/apiTl.js` and `tl/AllTLObjects.js`. They let the
installer tests reproduce a fresh layer 198 dependency after the real install
has already been upgraded. Each file's SHA-256 is recorded in
`vendor/telegram-schema/provenance.json`. The original package's MIT license is
included as `GRAMJS-LICENSE`.

Source package: https://registry.npmjs.org/telegram/-/telegram-2.26.22.tgz

`rich-table-layer233.json` is an independent binary fixture encoded from the
official pinned TDLib TL declarations. It contains a two-cell table header in
`messages.sendMessage`, an incoming `Updates` with `Message.rich_message`, and
the `messages.Messages` response for `messages.getRichMessage`. The IDs are
synthetic; the fixture contains no account, credential, or session data. The
fixture's constructor IDs and field order are intentionally fixed to detect
accidental serialization or response-registry changes.
