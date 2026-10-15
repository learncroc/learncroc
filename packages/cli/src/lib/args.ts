/** Tiny argv parser: positionals, `--flag`, `--key value` and `--key=value`. */
export interface ParsedArgs {
  _: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

export function parseArgs(argv: string[], valueKeys: readonly string[] = []): ParsedArgs {
  const out: ParsedArgs = { _: [], flags: new Set(), values: new Map() };
  const takesValue = new Set(valueKeys);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        out.values.set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (takesValue.has(key) && next !== undefined && !next.startsWith("--")) {
        out.values.set(key, next);
        i++;
      } else out.flags.add(key);
      continue;
    }
    if (a.startsWith("-") && a.length === 2) {
      out.flags.add(a.slice(1));
      continue;
    }
    out._.push(a);
  }
  return out;
}
