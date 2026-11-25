/**
 * Merge database entries into the text of assets/releases.json.
 *
 * Works on the text, not on parsed JSON, so the hand-made formatting of the existing entries is
 * kept and the commit diff only shows the new entries. Each new entry is placed by date (the file
 * is newest first) and gets `"firebaseId": "<id>"`, which lets the site skip the database copy
 * once the file with the entry is deployed (see releases-source.js).
 */

const KEY_ORDER = [
  "date", "dateEnd", "dateLabel", "title", "titleEn", "titleCs", "titleAlt", "titleSecondary",
  "event", "type", "format", "abstract", "artistRoles", "venue", "city", "country", "place",
  "placeUrl", "collaborators", "context", "notes", "links", "embed", "cv", "cvAuthorRole"
];
const DROP_KEYS = new Set(["hidden", "_meta", "releaseKey", "_remoteId", "_index", "firebaseId"]);

/** Key order like the hand-written entries; database bookkeeping dropped; firebaseId last. */
export function toFileEntry(id, item) {
  const out = {};
  for (const k of KEY_ORDER) if (k in item && !DROP_KEYS.has(k)) out[k] = item[k];
  for (const k of Object.keys(item)) if (!(k in out) && !DROP_KEYS.has(k)) out[k] = item[k];
  out.firebaseId = id;
  return out;
}

/** Pretty print: objects one key per line, arrays of plain values on one line. */
export function formatValue(value, indent, step = "  ") {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = indent + step;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    if (value.every((v) => v === null || typeof v !== "object")) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    return `[\n${value.map((v) => inner + formatValue(v, inner, step)).join(",\n")}\n${indent}]`;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  if (!keys.length) return "{}";
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${formatValue(value[k], inner, step)}`).join(",\n")}\n${indent}}`;
}

/** Start/end offsets of the top-level array and of each of its elements. */
export function scanTopLevel(text) {
  let i = text.indexOf("[");
  if (i < 0) throw new Error("releases.json: no top-level array");
  const arrayStart = i;
  const elements = [];
  let depth = 0;
  let inString = false;
  let elStart = -1;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      if (depth === 1 && elStart < 0) elStart = i;
      continue;
    }
    if (c === "{" || c === "[") {
      if (depth === 1 && elStart < 0) elStart = i;
      depth += 1;
    } else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 1 && elStart >= 0) {
        elements.push({ start: elStart, end: i + 1 });
        elStart = -1;
      } else if (depth === 0) {
        return { arrayStart, arrayEnd: i, elements };
      }
    } else if (depth === 1 && elStart < 0 && !/[\s,]/.test(c)) {
      elStart = i; // a bare value (number / true / null) — not expected, but keep offsets sane
    } else if (depth === 1 && elStart >= 0 && c === "," ) {
      elements.push({ start: elStart, end: i });
      elStart = -1;
    }
  }
  throw new Error("releases.json: unterminated array");
}

function lineIndentAt(text, pos) {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  return /^\s*$/.test(before) ? before : "  ";
}

/** Firebase ids already in the file. */
export function firebaseIdsInText(text) {
  const items = JSON.parse(text.replace(/^﻿/, ""));
  return new Set((Array.isArray(items) ? items : []).map((i) => i && i.firebaseId).filter(Boolean));
}

/**
 * Insert `entries` ([{ id, item }]) into the releases.json text.
 * Entries whose id is already in the file are skipped. Returns { text, added: [ids] }.
 */
export function mergeIntoReleasesText(text, entries) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const present = firebaseIdsInText(text);
  const todo = entries
    .filter(({ id }) => !present.has(id))
    .sort((a, b) => String(b.item.date).localeCompare(String(a.item.date)));
  const added = [];

  for (const { id, item } of todo) {
    const { arrayEnd, elements } = scanTopLevel(text);
    const parsed = elements.map((el) => {
      try { return JSON.parse(text.slice(el.start, el.end)); } catch { return null; }
    });
    const date = String(item.date || "");
    // before the first entry that is older; entries on the same day stay above the new one
    let target = parsed.findIndex((p) => p && typeof p.date === "string" && p.date < date);
    const indent = elements.length ? lineIndentAt(text, elements[target >= 0 ? target : elements.length - 1].start) : "  ";
    const body = formatValue(toFileEntry(id, item), indent).split("\n").join(eol);

    if (!elements.length) {
      const arrayStart = text.indexOf("[");
      text = `${text.slice(0, arrayStart + 1)}${eol}${indent}${body}${eol}${text.slice(arrayEnd)}`;
    } else if (target >= 0) {
      const pos = elements[target].start;
      text = `${text.slice(0, pos)}${body},${eol}${indent}${text.slice(pos)}`;
    } else {
      const pos = elements[elements.length - 1].end;
      text = `${text.slice(0, pos)},${eol}${indent}${body}${text.slice(pos)}`;
    }
    added.push(id);
  }

  JSON.parse(text.replace(/^﻿/, "")); // never commit a broken file
  return { text, added };
}
