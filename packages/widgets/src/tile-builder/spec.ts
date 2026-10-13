/**
 * tile-builder: build a sentence from tiles with live agreement (gender = shape AND colour), audio on
 * completion. Parsons mode (code lines with indent). Also the "I'm stuck" tiles (CONTRACTS §7.2 #12).
 */
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";

export const TileBuilderProps = z.strictObject({
  /** lines = Parsons problem. */
  mode: z.enum(["sentence", "lines"]),
  /** Prompt in the learner's language, e.g. "The red houses". */
  meaning: z.string().optional(),
  tiles: z.array(
    z.strictObject({
      id: z.string(),
      text: z.string(),
      tags: z.array(z.enum(["m", "f", "sg", "pl", "verb", "noun", "adj"])).optional(),
    }),
  ),
  /** Gender by shape AND colour. */
  showAgreement: z.boolean().optional(),
  /** For audio. */
  lang: z.string().optional(),
  /** Play the built sentence on commit (pack audio, else TTS). */
  speak: z.boolean().optional(),
});

/** Tile id sequences; indents parallel to accept (lines mode). */
export const TileBuilderGoal = z.strictObject({
  kind: z.literal("sequence"),
  accept: z.array(z.array(z.string())),
  indents: z.array(z.array(z.number().int())).optional(),
});

export const TileBuilderAnswer = z.object({ sequence: z.array(z.string()), indents: z.array(z.number()).optional() });

export type TileBuilderProps = z.infer<typeof TileBuilderProps>;
export type TileBuilderGoal = z.infer<typeof TileBuilderGoal>;
export type TileBuilderAnswer = z.infer<typeof TileBuilderAnswer>;
export type Tile = TileBuilderProps["tiles"][number];

/** Deepest indent a lines-mode answer may use. */
export const MAX_INDENT = 6;

/** Join tile texts the way they read: words with spaces, punctuation tiles snug against the previous word. */
export function joinTiles(texts: readonly string[]): string {
  let out = "";
  for (const t of texts) {
    if (out === "" || /^[.,;:!?)»…]/.test(t) || /[¿¡(«]$/.test(out)) out += t;
    else out += ` ${t}`;
  }
  return out;
}

/**
 * Agreement clashes between neighbouring tiles of one noun phrase: both carry a gender (or a number) and they
 * differ. Verbs and untagged tiles break the phrase. Returns pairs of indices into `seq`.
 */
export function agreementClashes(tiles: readonly Tile[], seq: readonly string[]): [number, number][] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const out: [number, number][] = [];
  for (let i = 1; i < seq.length; i++) {
    const a = byId.get(seq[i - 1] as string)?.tags ?? [];
    const b = byId.get(seq[i] as string)?.tags ?? [];
    if (a.includes("verb") || b.includes("verb") || a.length === 0 || b.length === 0) continue;
    const g = (t: readonly string[]) => (t.includes("m") ? "m" : t.includes("f") ? "f" : undefined);
    const n = (t: readonly string[]) => (t.includes("sg") ? "sg" : t.includes("pl") ? "pl" : undefined);
    const ga = g(a);
    const gb = g(b);
    const na = n(a);
    const nb = n(b);
    if ((ga && gb && ga !== gb) || (na && nb && na !== nb)) out.push([i - 1, i]);
  }
  return out;
}

function validate(p: TileBuilderProps, goal?: TileBuilderGoal): string[] {
  const errors: string[] = [];
  const ids = p.tiles.map((t) => t.id);
  if (p.tiles.length < 2) errors.push("tile-builder needs at least 2 tiles");
  if (p.tiles.length > 16) errors.push("tile-builder takes at most 16 tiles");
  if (new Set(ids).size !== ids.length) errors.push("tile ids must be unique");
  for (const t of p.tiles) {
    if (t.text.trim() === "") errors.push(`tile "${t.id}" has no text`);
    const tags = t.tags ?? [];
    if (tags.includes("m") && tags.includes("f")) errors.push(`tile "${t.id}" can't be both masculine and feminine`);
    if (tags.includes("sg") && tags.includes("pl")) errors.push(`tile "${t.id}" can't be both singular and plural`);
  }
  if (p.speak && !p.lang) errors.push("speak needs lang (the language to read the sentence in)");
  if (!goal) return errors;
  if (goal.accept.length === 0) errors.push("goal needs at least one accepted sequence");
  goal.accept.forEach((seq, i) => {
    if (seq.length === 0) errors.push(`accepted sequence ${i + 1} is empty`);
    for (const id of seq) if (!ids.includes(id)) errors.push(`accepted sequence ${i + 1} uses unknown tile "${id}"`);
    if (new Set(seq).size !== seq.length) errors.push(`accepted sequence ${i + 1} uses a tile twice`);
  });
  if (goal.indents) {
    if (p.mode !== "lines") errors.push("indents only apply in lines mode");
    if (goal.indents.length !== goal.accept.length) errors.push("indents must be parallel to accept");
    goal.indents.forEach((ind, i) => {
      if (ind.length !== (goal.accept[i]?.length ?? -1)) {
        errors.push(`indents ${i + 1} must have one entry per line of accepted sequence ${i + 1}`);
      }
      if (ind.some((n) => n < 0 || n > MAX_INDENT)) errors.push(`indents must be between 0 and ${MAX_INDENT}`);
    });
  }
  return errors;
}

function grade({ props, goal, answer }: { props: TileBuilderProps; goal: TileBuilderGoal; answer: TileBuilderAnswer }) {
  const seq = answer.sequence;
  let best = 0;
  let orderOnly = false;
  for (let i = 0; i < goal.accept.length; i++) {
    const want = goal.accept[i] as string[];
    const same = want.length === seq.length && want.every((id, k) => seq[k] === id);
    const ind = props.mode === "lines" ? goal.indents?.[i] : undefined;
    const indentsOk = !ind || ind.every((n, k) => (answer.indents?.[k] ?? 0) === n);
    if (same && indentsOk) {
      return graded(true, 1, {
        solution: { sequence: want, ...(ind ? { indents: ind } : {}) } satisfies TileBuilderAnswer,
      });
    }
    if (same) orderOnly = true;
    let hits = 0;
    for (let k = 0; k < Math.min(want.length, seq.length); k++) if (want[k] === seq[k]) hits++;
    best = Math.max(best, hits / Math.max(want.length, seq.length, 1));
  }
  const first = goal.accept[0] ?? [];
  const firstInd = props.mode === "lines" ? goal.indents?.[0] : undefined;
  return graded(false, orderOnly ? 0.75 : best * 0.9, {
    solution: { sequence: first, ...(firstInd ? { indents: firstInd } : {}) } satisfies TileBuilderAnswer,
    feedback: orderOnly ? "The order is right; check the indentation." : undefined,
  });
}

function textOf(p: TileBuilderProps, seq: readonly string[]): string[] {
  const byId = new Map(p.tiles.map((t) => [t.id, t.text]));
  return seq.map((id) => byId.get(id) ?? id);
}

export const tileBuilderSpec: WidgetSpec<TileBuilderProps, TileBuilderGoal, TileBuilderAnswer> = {
  id: "tile-builder",
  version: 1,
  title: "Tile builder",
  family: "language",
  description:
    "Build a sentence (or a program, Parsons-style, with indentation) from tiles; gender and number agreement show as shape and colour; the finished sentence can be read aloud.",
  llmDoc: {
    useWhen:
      "Producing a sentence or a few lines of code from given pieces: word order, agreement (tags m/f/sg/pl), Parsons problems, and the 'I'm stuck' scaffold for explain answers.",
    notFor: "Free production without tiles (use a text interaction) or more than 16 pieces.",
    learnerDoes:
      "Taps tiles to add them, reorders them by dragging or with Space + arrow keys, sets indents with the arrow keys in lines mode, and can hear the sentence.",
    reports:
      "{ sequence: [tileId…], indents?: [n…] } — correct when the sequence equals one of goal.accept (and, in lines mode, its indents).",
  },
  props: TileBuilderProps,
  goal: TileBuilderGoal,
  answer: TileBuilderAnswer,
  validate,
  grade,
  initialAnswer: (p) => (p.mode === "lines" ? { sequence: [], indents: [] } : { sequence: [] }),
  textAlternative: (p) =>
    `${p.meaning ? `Build "${p.meaning}" ` : `Build ${p.mode === "lines" ? "a program" : "a sentence"} `}from tiles: ${p.tiles
      .map((t) => t.text)
      .join(" / ")}.`,
  toText: (p, a) => {
    if (!a || a.sequence.length === 0) return tileBuilderSpec.textAlternative(p);
    const texts = textOf(p, a.sequence);
    if (p.mode === "lines") return texts.map((t, i) => `${"    ".repeat(a.indents?.[i] ?? 0)}${t}`).join("\n");
    return joinTiles(texts);
  },
  examples: [
    {
      note: "Spanish agreement: the red houses",
      props: {
        mode: "sentence",
        meaning: "The red houses",
        tiles: [
          { id: "las", text: "las", tags: ["f", "pl"] },
          { id: "casas", text: "casas", tags: ["f", "pl", "noun"] },
          { id: "rojas", text: "rojas", tags: ["f", "pl", "adj"] },
          { id: "rojos", text: "rojos", tags: ["m", "pl", "adj"] },
          { id: "la", text: "la", tags: ["f", "sg"] },
        ],
        showAgreement: true,
        lang: "es-ES",
        speak: true,
      },
      goal: { kind: "sequence", accept: [["las", "casas", "rojas"]] },
      correctAnswer: { sequence: ["las", "casas", "rojas"] },
      wrongAnswer: { sequence: ["las", "rojas", "casas"] },
    },
    {
      note: "Ordering at the bar: two accepted orders",
      props: {
        mode: "sentence",
        meaning: "A beer, please.",
        tiles: [
          { id: "una", text: "Una", tags: ["f", "sg"] },
          { id: "cerveza", text: "cerveza", tags: ["f", "sg", "noun"] },
          { id: "comma", text: "," },
          { id: "por", text: "por" },
          { id: "favor", text: "favor" },
          { id: "dot", text: "." },
        ],
        lang: "es-ES",
      },
      goal: {
        kind: "sequence",
        accept: [
          ["una", "cerveza", "comma", "por", "favor", "dot"],
          ["por", "favor", "comma", "una", "cerveza", "dot"],
        ],
      },
      correctAnswer: { sequence: ["por", "favor", "comma", "una", "cerveza", "dot"] },
      wrongAnswer: { sequence: ["cerveza", "una", "por", "favor", "dot"] },
    },
    {
      note: "Parsons: a loop that adds up 1 to 3",
      props: {
        mode: "lines",
        tiles: [
          { id: "total", text: "total = 0" },
          { id: "for", text: "for n in range(1, 4):" },
          { id: "add", text: "total = total + n" },
          { id: "print", text: "print(total)" },
        ],
      },
      goal: { kind: "sequence", accept: [["total", "for", "add", "print"]], indents: [[0, 0, 1, 0]] },
      correctAnswer: { sequence: ["total", "for", "add", "print"], indents: [0, 0, 1, 0] },
      wrongAnswer: { sequence: ["total", "for", "add", "print"], indents: [0, 0, 1, 1] },
    },
  ],
};
