import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultVendorRoot = join(root, "vendor", "telegram-schema");
const primitiveDeclarations = new Set([
  "int ? = Int;",
  "long ? = Long;",
  "double ? = Double;",
  "string ? = String;",
  "bytes = Bytes;",
  "int256 = Int256;",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function readRegularFile(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new Error(`Expected a regular schema dependency file: ${path}`);
  }
  return readFileSync(path);
}

/** Read the checked-in provenance and exact schema without loading Telegram. */
export function readTelegramSchema(vendorRoot = defaultVendorRoot) {
  const provenance = JSON.parse(readRegularFile(join(vendorRoot, "provenance.json")).toString("utf8"));
  if (provenance.layer !== 233 || provenance.gramjsVersion !== "2.26.22" || provenance.originalLayer !== 198) {
    throw new Error("Unsupported Telegram schema provenance; review the installer before changing its version contract");
  }
  const schema = readRegularFile(join(vendorRoot, "telegram_api.tl"));
  const license = readRegularFile(join(vendorRoot, "LICENSE"));
  if (sha256(schema) !== provenance.sha256) throw new Error("Pinned Telegram schema checksum does not match provenance");
  if (sha256(license) !== provenance.licenseSha256) throw new Error("Pinned Telegram schema license checksum does not match provenance");

  const removed = new Set();
  const normalized = schema.toString("utf8").split("\n").filter((line) => {
    if (!primitiveDeclarations.has(line.trim())) return true;
    removed.add(line.trim());
    return false;
  }).join("\n");
  if (removed.size !== primitiveDeclarations.size) {
    throw new Error("Pinned Telegram schema primitive declarations changed; review GramJS normalization");
  }
  return { provenance, schema: schema.toString("utf8"), normalized };
}

/** Inspect only. The explicit roots make isolated installer tests possible. */
export function inspectTelegramSchema({ telegramPackageRoot, vendorRoot = defaultVendorRoot } = {}) {
  const packageRoot = realpathSync(telegramPackageRoot ?? dirname(require.resolve("telegram/package.json")));
  const pkg = JSON.parse(readRegularFile(join(packageRoot, "package.json")).toString("utf8"));
  const { provenance, normalized } = readTelegramSchema(vendorRoot);
  if (pkg.name !== provenance.gramjsPackage || pkg.version !== provenance.gramjsVersion) {
    throw new Error(`Expected telegram@${provenance.gramjsVersion}; found ${pkg.name}@${pkg.version}`);
  }

  const apiPath = join(packageRoot, "tl", "apiTl.js");
  const layerPath = join(packageRoot, "tl", "AllTLObjects.js");
  const apiCurrent = readRegularFile(apiPath).toString("utf8");
  const layerCurrent = readRegularFile(layerPath).toString("utf8");
  const apiExpected = `"use strict";\n// Official TDLib ${provenance.commit}; layer ${provenance.layer}.\nmodule.exports = ${JSON.stringify(normalized)};\n`;
  if (apiCurrent !== apiExpected && sha256(apiCurrent) !== provenance.originalApiTlSha256) {
    throw new Error("GramJS apiTl.js differs from the pinned upstream package and the expected schema upgrade");
  }

  const layerPattern = /^exports\.LAYER = (\d+);$/gm;
  const matches = [...layerCurrent.matchAll(layerPattern)];
  if (matches.length !== 1 || ![provenance.originalLayer, provenance.layer].includes(Number(matches[0][1]))) {
    throw new Error("GramJS AllTLObjects.js has an unsupported layer declaration");
  }
  const originalLayerSource = layerCurrent.replace(layerPattern, `exports.LAYER = ${provenance.originalLayer};`);
  if (sha256(originalLayerSource) !== provenance.originalAllTlObjectsSha256) {
    throw new Error("GramJS AllTLObjects.js differs from the pinned upstream package");
  }
  const layerExpected = originalLayerSource.replace(layerPattern, `exports.LAYER = ${provenance.layer};`);

  const files = [
    { path: apiPath, current: apiCurrent, expected: apiExpected },
    { path: layerPath, current: layerCurrent, expected: layerExpected },
  ];
  return { packageRoot, provenance, files, changedFiles: files.filter((f) => f.current !== f.expected).map((f) => f.path) };
}

/** Apply before startup; never replaces classes or registries in a loaded client. */
export function upgradeTelegramSchema(options = {}) {
  const inspected = inspectTelegramSchema(options);
  for (const file of inspected.files) {
    if (file.current === file.expected) continue;
    const temporary = `${file.path}.schema-${process.pid}.tmp`;
    try {
      writeFileSync(temporary, file.expected, { flag: "wx", mode: lstatSync(file.path).mode & 0o777 });
      renameSync(temporary, file.path);
    } finally {
      try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  return { packageRoot: inspected.packageRoot, layer: inspected.provenance.layer, changedFiles: inspected.changedFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && !["--check", "--dry-run"].includes(args[0]))) {
      throw new Error("Usage: node scripts/telegram-schema.mjs [--check|--dry-run]");
    }
    const inspected = inspectTelegramSchema();
    if (args[0] === "--check" && inspected.changedFiles.length) {
      throw new Error("Telegram schema upgrade is not installed; run node scripts/telegram-schema.mjs before startup");
    }
    const result = args.length
      ? { packageRoot: inspected.packageRoot, layer: inspected.provenance.layer, changedFiles: inspected.changedFiles }
      : upgradeTelegramSchema();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Telegram schema upgrade failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
