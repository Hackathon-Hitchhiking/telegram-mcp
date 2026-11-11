import { LAYER } from "telegram/tl/AllTLObjects.js";
import apiTl from "telegram/tl/apiTl.js";
import { parseTl } from "telegram/tl/generationHelpers.js";

interface TlArgument {
  type: string | null;
  isVector: boolean;
  isFlag: boolean;
  flagName: string | null;
  flagIndex: number;
  flagIndicator: boolean;
}

interface TlDefinition {
  name: string;
  namespace?: string;
  constructorId: number;
  result: string;
  isFunction: boolean;
  argsConfig: Record<string, TlArgument>;
}

export interface ApiField {
  name: string;
  type: string;
  required: boolean;
  flag?: { name: string; bit: number; sharedWith: string[] };
  managedByCodec?: true;
  codecMayInfer?: true;
}

interface ApiEntry {
  name: string;
  gramjsName: string;
  kind: "method" | "constructor";
  constructorId: string;
  result: string;
  fields: ApiField[];
}

export type ApiCatalogKind = "method" | "constructor" | "all";

function boundedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function namesFromSchema(schema: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of schema.split("\n")) {
    const match = /^\s*([\w.]+)#([0-9a-fA-F]+)\b/.exec(line);
    if (match) names.set(Number.parseInt(match[2], 16) >>> 0, match[1]);
  }
  return names;
}

function describeField(name: string, argument: TlArgument, fields: Record<string, TlArgument>): ApiField {
  const result: ApiField = {
    name,
    type: argument.flagIndicator ? "#" : argument.isVector ? `Vector<${argument.type}>` : (argument.type ?? "unknown"),
    required: !argument.isFlag && !argument.flagIndicator,
  };
  if (argument.flagIndicator) result.managedByCodec = true;
  if (name === "randomId") result.codecMayInfer = true;
  if (argument.isFlag && argument.flagName) {
    result.flag = {
      name: argument.flagName,
      bit: argument.flagIndex,
      sharedWith: Object.entries(fields)
        .filter(
          ([other, value]) =>
            other !== name &&
            value.isFlag &&
            value.flagName === argument.flagName &&
            value.flagIndex === argument.flagIndex,
        )
        .map(([other]) => other),
    };
  }
  return result;
}

let cache: ApiEntry[] | undefined;

function catalog(): ApiEntry[] {
  if (cache) return cache;
  const originalNames = namesFromSchema(apiTl);
  const definitions = Array.from(parseTl(apiTl, String(LAYER))) as TlDefinition[];
  cache = definitions
    .map((definition): ApiEntry => {
      const gramjsName = `${definition.namespace ? `${definition.namespace}.` : ""}${definition.name}`;
      return {
        name: originalNames.get(definition.constructorId >>> 0) ?? gramjsName,
        gramjsName,
        kind: definition.isFunction ? "method" : "constructor",
        constructorId: `0x${(definition.constructorId >>> 0).toString(16).padStart(8, "0")}`,
        result: definition.result,
        fields: Object.entries(definition.argsConfig).map(([name, value]) =>
          describeField(name, value, definition.argsConfig),
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

/** Schema introspection only: it never opens a Telegram connection or invokes a method. */
export function searchApi(query = "", kind: ApiCatalogKind = "method", limit = 20, offset = 0) {
  if (typeof query !== "string" || query.length > 160) throw new Error("query must contain at most 160 characters");
  if (!["method", "constructor", "all"].includes(kind)) throw new Error("kind must be method, constructor or all");
  boundedInteger("limit", limit, 1, 50);
  boundedInteger("offset", offset, 0, 100_000);
  const words = query.trim().toLowerCase().replace(/_/g, "").split(/\s+/).filter(Boolean);
  const matches = catalog().filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    const searchable = [entry.name, entry.gramjsName, entry.result, ...entry.fields.map((field) => field.name)]
      .join(" ")
      .toLowerCase()
      .replace(/_/g, "");
    return words.every((word) => searchable.includes(word));
  });
  return {
    schemaLayer: LAYER,
    source: "Installed GramJS TL schema",
    invocation: "schema-reference-only",
    coverage: "Describes protocol methods/types. This catalog is not an arbitrary method execution tool.",
    total: matches.length,
    offset,
    limit,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
    entries: matches
      .slice(offset, offset + limit)
      .map(({ fields, ...entry }) => ({ ...entry, fieldCount: fields.length })),
  };
}

export function describeApi(name: string, fieldOffset = 0, fieldLimit = 100) {
  if (typeof name !== "string" || !name.trim() || name.length > 160) {
    throw new Error("name must contain 1–160 characters");
  }
  boundedInteger("fieldOffset", fieldOffset, 0, 100_000);
  boundedInteger("fieldLimit", fieldLimit, 1, 100);
  const entry = catalog().find((item) => item.name === name || item.gramjsName === name);
  if (!entry) throw new Error(`Unknown TL method or constructor: ${name}`);
  const { fields, ...summary } = entry;
  return {
    schemaLayer: LAYER,
    source: "Installed GramJS TL schema",
    invocation: "schema-reference-only",
    ...summary,
    fieldNaming: "name is the GramJS camelCase argument name; flag indicators are managed by the serializer.",
    fieldCount: fields.length,
    fieldOffset,
    fieldLimit,
    nextFieldOffset: fieldOffset + fieldLimit < fields.length ? fieldOffset + fieldLimit : null,
    fields: fields.slice(fieldOffset, fieldOffset + fieldLimit),
  };
}
