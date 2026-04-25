/**
 * core/src/work/backlog-parser.ts
 *
 * Parser for the 4-layer handoff backlog file. Reads a Markdown file
 * whose entries follow this grammar:
 *
 *   ### [Critical|High|Med|Low] <id> <title>
 *   ```yaml
 *   id: ...
 *   priority: ...
 *   status: ...
 *   roadmap_ref: ...
 *   worktree: ...
 *   pr: ...
 *   ```
 *
 * Each level-3 heading that matches the bracketed-priority pattern is
 * one entry. The optional fenced YAML block immediately following the
 * heading (only `yaml` / `YAML` info-strings count) supplies machine-
 * readable metadata; values there override the heading-derived defaults.
 *
 * Design notes:
 * - The parser is hand-rolled (no `js-yaml` / `yaml` runtime dependency
 *   in the consumer surface). The handoff backlog YAML is intentionally
 *   limited to flat `key: value` pairs — nested structures, multi-line
 *   strings, and lists are not part of the grammar. The hand-rolled
 *   parser keeps the dependency footprint minimal and surfaces malformed
 *   input as a stderr warning rather than a thrown error.
 * - Entries are returned in file order. The dispatcher applies its own
 *   priority / dependency ordering — losing file order would make
 *   editor-driven authoring (where the human places a new entry near
 *   related context) feel non-deterministic.
 * - Missing files yield `[]` (no throw). The handoff backlog may not
 *   exist yet for a freshly-initialised project; consumers (skills)
 *   should treat absence as "no pending work" rather than an error.
 */

import { existsSync, readFileSync } from "node:fs";

export type BacklogPriority = "Critical" | "High" | "Med" | "Low";
export type BacklogStatus = "pending" | "in_progress" | "review" | "done";

const VALID_PRIORITIES: readonly BacklogPriority[] = [
  "Critical",
  "High",
  "Med",
  "Low",
];
const VALID_STATUSES: readonly BacklogStatus[] = [
  "pending",
  "in_progress",
  "review",
  "done",
];

export interface BacklogEntry {
  /** Stable identifier (heading or YAML override). */
  id: string;
  /** Priority bucket controlling dispatcher ordering. */
  priority: BacklogPriority;
  /** Lifecycle state — defaults to `pending` when absent. */
  status: BacklogStatus;
  /** Title text from the heading (everything after `<id> `). */
  title: string;
  /** Optional pointer into the roadmap layer (e.g. `phase-1.week-2`). */
  roadmapRef?: string;
  /** Optional worktree path that is currently driving this entry. */
  worktree?: string;
  /** Optional pull request reference (the value is preserved verbatim). */
  pr?: string;
  /** Verbatim heading line (useful for diagnostics / preview UIs). */
  rawHeading: string;
  /** 1-indexed line number of the heading in the source file. */
  lineNumber: number;
}

// Heading grammar: `### [Priority] <id> <title>`. The id token is
// permissive — letters, digits, hyphens, dots, and underscores — so
// project-specific id schemes (`T-001`, `phase-1.task-2`, `MYPROJ-001`,
// `2026.04.25`) all parse without configuration.
const HEADING_RE =
  /^###[ \t]+\[(Critical|High|Med|Low)\][ \t]+([A-Za-z0-9._-]+)[ \t]+(.+?)[ \t]*$/;

// Fence grammar: opening / closing triple-backtick. Only `yaml` / `YAML`
// info strings cause us to consume the block as YAML; other languages
// (`ts`, `bash`, etc.) or no-info fences are treated as opaque blocks
// that belong to the previous heading's prose and are skipped.
const FENCE_OPEN_RE = /^```[ \t]*([A-Za-z]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;

// Hand-rolled YAML key:value pattern (single line). `key` is alphanumerics
// + underscore + hyphen; `value` is everything after the first colon.
// Quoted values are unwrapped by `parseYamlValue` below.
const YAML_KEY_VALUE_RE = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/;

/**
 * Strip surrounding `"..."` / `'...'` quotes from a YAML value. The
 * handoff backlog is single-line scalar territory only — there is no
 * multi-line string / heredoc support, so a simple unquote is enough.
 */
function parseYamlValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  // Drop trailing `# comment` on the same line. We keep this simple:
  // any unescaped `#` preceded by whitespace ends the value. (No quote-
  // aware tokenizer because the grammar excludes embedded `#` in
  // scalars; an author who needs a literal hash should quote.)
  // tsconfig has `noUncheckedIndexedAccess: true`, so `trimmed[0]` is
  // `string | undefined`. We've already gated on `trimmed.length === 0`
  // above and on a quote prefix here, so coerce safely.
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    if (trimmed.endsWith(quote) && trimmed.length >= 2) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

interface YamlBlockResult {
  fields: Record<string, string>;
  malformed: boolean;
}

/**
 * Parse the body of a fenced YAML block (lines between ```yaml ... ```).
 * Lines that do not match the simple `key: value` pattern are reported
 * as malformed so the caller can emit a single diagnostic; the parser
 * still returns whatever fields it could extract so a typo on one line
 * does not destroy the whole block.
 *
 * Blank lines and `#` comment lines are skipped silently.
 */
function parseYamlBlockBody(lines: readonly string[]): YamlBlockResult {
  const fields: Record<string, string> = {};
  let malformed = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    const match = YAML_KEY_VALUE_RE.exec(line);
    if (!match) {
      malformed = true;
      continue;
    }
    const key = match[1];
    const rawValue = match[2] ?? "";
    if (key === undefined) {
      malformed = true;
      continue;
    }
    fields[key] = parseYamlValue(rawValue);
  }
  return { fields, malformed };
}

/**
 * Apply YAML overrides on top of heading-derived defaults. Unknown keys
 * are silently dropped; out-of-enum priority / status values are dropped
 * with a stderr warning so the entry retains the heading default rather
 * than disappearing.
 */
function applyYamlOverrides(
  entry: BacklogEntry,
  yaml: Record<string, string>,
  filepath: string,
): BacklogEntry {
  const next: BacklogEntry = { ...entry };
  if (typeof yaml.id === "string" && yaml.id.length > 0) {
    next.id = yaml.id;
  }
  if (typeof yaml.priority === "string" && yaml.priority.length > 0) {
    if ((VALID_PRIORITIES as readonly string[]).includes(yaml.priority)) {
      next.priority = yaml.priority as BacklogPriority;
    } else {
      process.stderr.write(
        `[harness backlog] ${filepath}:${entry.lineNumber} priority=${JSON.stringify(
          yaml.priority,
        )} is not one of ${JSON.stringify(
          VALID_PRIORITIES,
        )}; keeping heading default "${entry.priority}".\n`,
      );
    }
  }
  if (typeof yaml.status === "string" && yaml.status.length > 0) {
    if ((VALID_STATUSES as readonly string[]).includes(yaml.status)) {
      next.status = yaml.status as BacklogStatus;
    } else {
      process.stderr.write(
        `[harness backlog] ${filepath}:${entry.lineNumber} status=${JSON.stringify(
          yaml.status,
        )} is not one of ${JSON.stringify(
          VALID_STATUSES,
        )}; falling back to "pending".\n`,
      );
      next.status = "pending";
    }
  }
  if (typeof yaml.roadmap_ref === "string" && yaml.roadmap_ref.length > 0) {
    next.roadmapRef = yaml.roadmap_ref;
  }
  if (typeof yaml.worktree === "string" && yaml.worktree.length > 0) {
    next.worktree = yaml.worktree;
  }
  if (typeof yaml.pr === "string" && yaml.pr.length > 0) {
    next.pr = yaml.pr;
  }
  return next;
}

/**
 * Parse a backlog markdown file at `filepath`. Returns the entries in
 * file order. Missing files yield `[]` (no throw). Parse errors on
 * individual entries are surfaced via stderr warnings; the parser does
 * its best to extract the rest of the file rather than failing the
 * whole dispatch.
 */
export function parseBacklog(filepath: string): BacklogEntry[] {
  if (!existsSync(filepath)) return [];
  const raw = readFileSync(filepath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const entries: BacklogEntry[] = [];
  const seenIds = new Map<string, number>(); // id -> first lineNumber
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const headingMatch = HEADING_RE.exec(line);
    if (!headingMatch) {
      i += 1;
      continue;
    }
    const priority = headingMatch[1] as BacklogPriority;
    const id = headingMatch[2] ?? "";
    const title = (headingMatch[3] ?? "").trim();
    const lineNumber = i + 1;
    let entry: BacklogEntry = {
      id,
      priority,
      status: "pending",
      title,
      rawHeading: line,
      lineNumber,
    };
    // Look ahead for an immediately-following YAML fence. The grammar
    // tolerates blank lines between the heading and the fence, but any
    // non-blank, non-fence line disqualifies the block (it belongs to
    // the heading's prose context, not the YAML metadata).
    let lookahead = i + 1;
    while (lookahead < lines.length) {
      const candidate = lines[lookahead] ?? "";
      if (candidate.trim().length === 0) {
        lookahead += 1;
        continue;
      }
      break;
    }
    const fenceLine = lines[lookahead] ?? "";
    const fenceMatch = FENCE_OPEN_RE.exec(fenceLine);
    if (
      fenceMatch !== null &&
      typeof fenceMatch[1] === "string" &&
      fenceMatch[1].toLowerCase() === "yaml"
    ) {
      // Walk forward to the matching close fence. Recovery: if we hit the
      // next entry heading before a closing fence, treat the fence as
      // unclosed and resume from that heading — otherwise an unterminated
      // YAML block would silently swallow every following entry until EOF.
      const bodyStart = lookahead + 1;
      let bodyEnd = bodyStart;
      let closedProperly = false;
      let nextHeadingHit = false;
      while (bodyEnd < lines.length) {
        const candidate = lines[bodyEnd] ?? "";
        if (FENCE_CLOSE_RE.test(candidate)) {
          closedProperly = true;
          break;
        }
        if (HEADING_RE.test(candidate)) {
          nextHeadingHit = true;
          break;
        }
        bodyEnd += 1;
      }
      const bodyLines = lines.slice(bodyStart, bodyEnd);
      const { fields, malformed } = parseYamlBlockBody(bodyLines);
      if (malformed) {
        process.stderr.write(
          `[harness backlog] ${filepath}:${lineNumber} YAML metadata block is malformed (one or more lines did not match key:value); falling back to heading defaults for unparsable lines.\n`,
        );
      }
      if (!closedProperly) {
        // Unterminated fence: warn so the operator can fix the markdown,
        // but still parse the partial body so the entry's metadata is
        // not entirely lost.
        process.stderr.write(
          `[harness backlog] ${filepath}:${lineNumber} YAML fence opened with \`\`\`yaml but no closing \`\`\` before ${
            nextHeadingHit ? `next heading at line ${bodyEnd + 1}` : "end of file"
          }; treating fence as unclosed and recovering.\n`,
        );
      }
      entry = applyYamlOverrides(entry, fields, filepath);
      if (nextHeadingHit) {
        // Resume *at* the heading so it is parsed in the next iteration
        // (do not skip past it).
        i = bodyEnd;
      } else {
        // Resume after the closing fence (or end-of-file when unclosed
        // with no following heading).
        i = bodyEnd + 1;
      }
    } else {
      i = lookahead;
    }
    // Duplicate-id detection. We retain both entries (the dispatcher
    // decides how to surface the conflict) but emit a single warning
    // pointing at the first sighting.
    const firstSeen = seenIds.get(entry.id);
    if (firstSeen !== undefined) {
      process.stderr.write(
        `[harness backlog] ${filepath}:${entry.lineNumber} duplicate id "${entry.id}" (first seen at line ${firstSeen}); both entries retained for dispatcher inspection.\n`,
      );
    } else {
      seenIds.set(entry.id, entry.lineNumber);
    }
    entries.push(entry);
  }
  return entries;
}
