/**
 * Inline suppressions: a YAML comment on the line above a key,
 *   # lint-ignore L001: quoted source
 * suppresses that rule for that key's subtree. A reason is required; suppressions are listed in
 * the report and count toward a per-pack budget (≤ 5 for curated and sampler packs).
 */
import { isMap, isSeq, type LineCounter, type Document as YamlDocument } from "yaml";
import { pointer } from "../compile/load";

export interface Suppression {
  rule: string;
  reason: string;
  file: string;
  /** JSON pointer of the suppressed subtree. */
  path: string;
  line: number;
}

export interface SuppressionProblem {
  file: string;
  line: number;
  message: string;
}

const COMMENT_RE = /^\s*#\s*lint-ignore\s+([A-Za-z0-9]+)\s*(?::\s*(.*))?$/;

/** Map each source line to the shallowest YAML path that starts on it. */
function linePaths(doc: YamlDocument, lines: LineCounter): Map<number, PropertyKey[]> {
  const out = new Map<number, PropertyKey[]>();
  const note = (offset: number | undefined, path: PropertyKey[]) => {
    if (offset === undefined) return;
    const line = lines.linePos(offset).line;
    const prev = out.get(line);
    if (!prev || path.length < prev.length) out.set(line, path);
  };
  const walk = (node: unknown, path: PropertyKey[]): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = pair.key as { value?: unknown; range?: [number, number, number] } | null;
        const p = [...path, String(key?.value)];
        note(key?.range?.[0], p);
        walk(pair.value, p);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => {
        const p = [...path, i];
        note((item as { range?: [number, number, number] } | null)?.range?.[0], p);
        walk(item, p);
      });
    }
  };
  walk(doc.contents, []);
  return out;
}

/** Find every suppression comment in a file. */
export function findSuppressions(
  file: string,
  text: string,
  doc: YamlDocument,
  lines: LineCounter,
): { suppressions: Suppression[]; problems: SuppressionProblem[] } {
  const suppressions: Suppression[] = [];
  const problems: SuppressionProblem[] = [];
  const src = text.split(/\r?\n/);
  const paths = linePaths(doc, lines);
  for (let i = 0; i < src.length; i++) {
    const m = COMMENT_RE.exec(src[i] ?? "");
    if (!m) continue;
    const line = i + 1;
    const rule = m[1] as string;
    const reason = (m[2] ?? "").trim();
    if (!reason) {
      problems.push({ file, line, message: `lint-ignore ${rule} needs a reason ("# lint-ignore ${rule}: why")` });
      continue;
    }
    let target: PropertyKey[] | undefined;
    for (let j = i + 1; j < src.length; j++) {
      const t = (src[j] ?? "").trim();
      if (!t || t.startsWith("#")) continue;
      target = paths.get(j + 1);
      break;
    }
    if (!target) {
      problems.push({ file, line, message: `lint-ignore ${rule} isn't followed by a key` });
      continue;
    }
    suppressions.push({ rule, reason, file, path: pointer(target), line });
  }
  return { suppressions, problems };
}

/** Does a suppression cover an issue (same file and rule, path inside the suppressed subtree)? */
export function covers(
  s: Pick<Suppression, "rule" | "file" | "path">,
  issue: { rule: string; file: string; path: string },
) {
  if (s.rule !== issue.rule || s.file !== issue.file) return false;
  return issue.path === s.path || issue.path.startsWith(`${s.path}/`) || s.path === "";
}
