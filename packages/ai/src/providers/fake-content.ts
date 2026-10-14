/**
 * Deterministic content for the fake provider (LEARNCROC_FAKE_AI=1). Built from the call's
 * <input> block so every AI feature is demoable and testable offline: an article map of any
 * article (cards that pass the pocket card lint), the judge, teasers, graded explanations, hints,
 * quiz variants, flashcards, croc replies and figures.
 */
import type {
  AuthorNodeInput,
  AuthorPlanInput,
  AuthorPracticeInput,
  CardInput,
  CardsInput,
  CrocInput,
  FigureInput,
  GradeInput,
  HintInput,
  JudgeInput,
  SkeletonInput,
  SolveInput,
  TeaserInput,
  VariantInput,
} from "../inputs";
import type {
  ActionDraft,
  AuthorNodeDraft,
  AuthorPlanDraft,
  AuthorPracticeDraft,
  BeatDraft,
  BeatWriteDraft,
  CardDraftsDraft,
  CardJudgeDraft,
  CardWriteDraft,
  ExplainGradeDraft,
  FigureDraft,
  HintDraft,
  HookVariantDraft,
  ItemDraft,
  QuizVariantDraft,
  SkeletonDraft,
  SolverAnswer,
  StopCardDraft,
  TeaserDraft,
} from "../schemas";
import { clip, cutAtSentence, hash32, keywords, norm, sentences, slug, titleCase } from "../text";

const PALETTE = ["#2F5D8A", "#9C4A2F", "#3E7A4F", "#7A4E8C", "#8A6A1F"];

const LEAD_WORD = /^(what|why|how|when|where|who|which)\s+/i;
const sentenceCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The most repeated pair of adjacent content words, else the first pair containing the top keyword. */
function keyPhrase(text: string): string | undefined {
  const toks = norm(text).replace(/\./g, " ").split(/\s+/).filter(Boolean);
  const top = keywords(text, 1)[0];
  const isContent = (w: string) => keywords(w, 1)[0] === w;
  const counts = new Map<string, { n: number; at: number }>();
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i] as string;
    const b = toks[i + 1] as string;
    if (!isContent(a) || !isContent(b) || a === b || WEAK.has(a) || !strong(b)) continue;
    const k = `${a} ${b}`;
    const hit = counts.get(k);
    counts.set(k, hit ? { n: hit.n + 1, at: hit.at } : { n: 1, at: i });
  }
  const ranked = [...counts.entries()].sort((x, y) => y[1].n - x[1].n || x[1].at - y[1].at);
  const repeated = ranked.find(([, v]) => v.n >= 2);
  if (repeated) return repeated[0];
  return top ? ranked.find(([k]) => k.split(" ").includes(top))?.[0] : undefined;
}

type Para = SkeletonInput["paragraphs"][number];

/** One paragraph per section first (its heading makes the best title), then evenly spread extras. */
function pickParagraphs(pool: Para[], n: number): Para[] {
  const firsts: Para[] = [];
  const seen = new Set<string>();
  for (const p of pool) {
    const key = p.heading ?? `#${p.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      firsts.push(p);
    }
  }
  const spread = (list: Para[], k: number) =>
    Array.from({ length: k }, (_, i) => list[Math.floor((i * list.length) / k)]).filter(
      (p): p is Para => p !== undefined,
    );
  if (firsts.length >= n) return spread(firsts, n);
  const rest = pool.filter((p) => !firsts.includes(p));
  const chosen = new Set([...firsts, ...spread(rest, n - firsts.length)]);
  return pool.filter((p) => chosen.has(p));
}

/** Words that make poor titles or landmarks in a fake map (verbs, adverbs, adjectives). */
const WEAK = new Set(
  "called again also fades fade after before first last still only just even very often usually comes come came goes going make makes made used uses using keep keeps kept fewer less lower higher same different good better best seems seem feel feels thing things lots part long short right next while because though through again ever never always sometimes until within without around fresh easy hard means mean assume want wants needs need gives give takes take".split(
    " ",
  ),
);
const ADJECTIVE = /(ic|ive|ous|al|ful|less|ly|able|ible)$/;
const strong = (w: string) => !WEAK.has(w) && !ADJECTIVE.test(w);

/** A plain stop title in sentence case, at most 4 words, like an authored one. */
function headlineOf(text: string, heading?: string): string {
  if (heading) {
    let h = heading.trim().replace(/[?.:!]+$/, "");
    if (h.split(/\s+/).length > 4) h = h.replace(LEAD_WORD, "");
    if (h.split(/\s+/).length <= 4) return sentenceCase(h);
  }
  const phrase = keyPhrase(text);
  if (phrase) return sentenceCase(phrase);
  const kw = keywords(text, 12).filter(strong).slice(0, 2);
  return sentenceCase(kw.length === 2 ? `${kw[0]} and ${kw[1]}` : (kw[0] ?? clip(text, 3)));
}

export function fakeSkeleton(input: SkeletonInput): SkeletonDraft {
  // 5 cards for a short map, otherwise the low end of the size (one checkpoint up to 6 cards).
  const want = Math.min(input.cards.max, Math.max(input.cards.min, 5));
  const usable = input.paragraphs.filter((p) => p.text.split(/\s+/).length >= 20);
  const pool = usable.length >= want ? usable : input.paragraphs;
  const n = Math.min(want, Math.max(1, pool.length));
  const picks = pickParagraphs(pool, n);
  const used = new Set<string>();
  const usedTitles = new Set<string>();
  const usedMarks = new Set<string>();
  const landmarkFor = (text: string) => {
    const word = keywords(text, 20).find((w) => strong(w) && !usedMarks.has(w)) ?? `quiet ${usedMarks.size + 1}`;
    usedMarks.add(word);
    return `${titleCase(word)} Corner`;
  };
  const nodes = picks.map((p, i) => {
    let title = headlineOf(p.text, p.heading);
    if (usedTitles.has(title)) title = headlineOf(p.text);
    usedTitles.add(title);
    let id = slug(title, 30);
    while (used.has(id)) {
      id = `${id}-${i + 1}`;
      title = `${title} ${i + 1}`;
    }
    used.add(id);
    const ss = sentences(p.text);
    const keyPoints = ss.slice(0, 3).map((s) => clip(s, 18));
    while (keyPoints.length < 2) keyPoints.push(clip(p.text, 14));
    return {
      id,
      title: clip(title, 4).replace(/…$/, ""),
      landmark: landmarkFor(p.text),
      objective: `Explain what the passage says about ${title.toLowerCase()}`,
      keyPoints,
      paras: [p.id],
      hookIdea: clip(ss[1] ?? ss[0] ?? p.text, 20),
      hookStyle: null,
      misconceptions: [{ id: "m-opposite", label: `The opposite of "${clip(ss[0] ?? p.text, 8)}" is true` }],
      caution: null,
      requires: [] as string[],
    };
  });
  // Ids were assigned in order, so requires can be fixed up after the fact.
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    node.requires = i === 1 && nodes.length >= 4 ? [] : [nodes[i - 1]?.id ?? ""].filter(Boolean);
  }
  const edges = nodes.flatMap((nd) => nd.requires.map((r) => ({ from: r, to: nd.id })));
  return {
    title: clip(input.title, 6).replace(/…$/, ""),
    gist: clip(`A short map of ${input.title}: ${nodes.map((nd) => nd.title.toLowerCase()).join(", ")}.`, 25),
    palette: PALETTE,
    nodes,
    edges,
  };
}

function opt(text: string, correct: boolean, misconception: string | null = null) {
  return { text, correct, misconception };
}

function item(over: Partial<ItemDraft> & Pick<ItemDraft, "kind" | "prompt">): ItemDraft {
  return {
    options: [],
    steps: [],
    numericAnswer: null,
    tolerance: null,
    unit: null,
    accept: [],
    level: "recall",
    difficulty: 2,
    feedbackRight: null,
    why: null,
    callback: false,
    ...over,
  };
}

const short = (t: string, n: number) => clip(t, n).replace(/…$/, "");

function hookVariant(
  style: HookVariantDraft["style"],
  setup: string,
  prompt: string,
  options: ReturnType<typeof opt>[],
  truth: string,
): HookVariantDraft {
  return {
    style,
    setup,
    prompt,
    options,
    lotsGuess: 1,
    closeByGuess: options.map((o, i) => ({
      option: i,
      text: o.correct
        ? clip(`You picked "${o.text}", and that's it. ${truth}`, 50)
        : clip(`"${o.text}" is a fair guess, and lots of people make it. ${truth}`, 50),
    })),
  };
}

function action(over: Partial<ActionDraft> & Pick<ActionDraft, "kind" | "prompt" | "reveal">): ActionDraft {
  return {
    options: [],
    buckets: [],
    steps: [],
    numericAnswer: null,
    tolerance: null,
    unit: null,
    feedbackRight: null,
    ...over,
  };
}

const blankCard: Omit<StopCardDraft, "type"> = {
  say: [],
  prompt: "",
  hunches: [],
  passage: null,
  paras: [],
  plain: "",
  idea: "",
  action: null,
  figure: null,
  contrast: null,
  text: "",
  byHunch: [],
  idk: "",
};

/** A stop as typed cards (ask → teach → try → teach → check → takeaway), built from the beat draft. */
export function fakeCard(input: CardInput): CardWriteDraft {
  const { hooks, beats, close, ...rest } = fakeBeatCard(input);
  const hook = hooks[0] as HookVariantDraft;
  const [b1, b2, b3] = beats as [BeatDraft, BeatDraft, BeatDraft];
  const teach = (b: BeatDraft): StopCardDraft => ({
    ...blankCard,
    type: "teach",
    say: [b.lead],
    passage: b.passage,
    paras: b.paras,
    plain: b.plain,
    idea: b.idea,
    figure: b.figure,
    contrast: b.contrast,
  });
  const cards: StopCardDraft[] = [
    {
      ...blankCard,
      type: "ask",
      say: hook.setup ? [hook.setup] : [],
      prompt: hook.prompt,
      hunches: hook.options.map((o) => o.text),
    },
    teach(b1),
    { ...blankCard, type: "try", say: b1.aside ? [b1.aside] : [], action: b1.action },
    teach(b2),
    { ...blankCard, type: "check", say: [b3.lead], action: b3.action },
    {
      ...blankCard,
      type: "takeaway",
      text: close.text,
      byHunch: hook.closeByGuess.map((g) => ({ hunch: g.option, text: g.text })),
      idk: close.idk,
    },
  ];
  return { cards, ...rest };
}

/** A card that passes the pocket card lint: 3 hooks, 2 beats (choice, order), a close per guess, 6 items. */
export function fakeBeatCard(input: CardInput): BeatWriteDraft {
  const { node } = input;
  const kp = node.keyPoints;
  const text = input.paragraphs.map((p) => p.text).join(" ");
  const kw = keywords(text, 8);
  const mis = node.misconceptions[0]?.id ?? "m-opposite";
  const misLabel = node.misconceptions[0]?.label ?? "It works the other way round";
  const truth = kp[0] ?? clip(text, 14);
  const topic = node.title.toLowerCase();
  const hookOptions = [
    opt(short(truth, 6), true),
    opt("It works the other way round", false, mis),
    opt("Nothing changes either way", false, mis),
  ];
  const contrast = {
    a: { label: "What lots of people assume", text: clip(misLabel, 16) },
    b: { label: "What the passage shows", text: clip(truth, 16) },
  };
  // Verbatim passages, whole sentences from one paragraph each: the assembler checks them word for word.
  const first = input.paragraphs[0];
  const second = input.paragraphs[1] ?? first;
  const passageOf = (p: Para | undefined) => (p ? cutAtSentence(p.text, 120) || null : null);
  const paras = first ? [first.id] : node.paras;
  const order = kp.length >= 3 ? kp.slice(0, 3) : [kp[0] ?? truth, kp[1] ?? clip(text, 8), "Put it to use"];
  const beat1: BeatDraft = {
    idea: short(`Each step of ${topic} leans on the one before it.`, 12),
    lead: clip(`This starts with one plain claim about ${topic}. Here's how the article puts it:`, 30),
    passage: passageOf(first),
    plain: clip(`In plain words: ${truth}. Think of a friend who tries it for a week and notices the difference.`, 60),
    aside: "Want to see it work? Put the steps in order.",
    paras,
    action: action({
      kind: "order",
      prompt: "Put the steps in order.",
      steps: order.map((s) => short(s, 12)),
      feedbackRight: "That's the chain the passage walks through.",
      reveal: clip(`Each step leans on the one before it: ${node.objective.toLowerCase()}.`, 20),
    }),
    figure: { description: `A left-to-right chain of three boxes for ${node.title}`, labels: ["First", "Then", "So"] },
    contrast,
  };
  const beat2: BeatDraft = {
    idea: short(truth, 12),
    lead: "So why does it work that way? The article has an answer:",
    passage: passageOf(second),
    plain: clip(
      `Put simply: ${kp[1] ?? truth}. Lots of people assume the opposite, which is why this one is worth a second look.`,
      60,
    ),
    aside: "",
    paras: second ? [second.id] : paras,
    action: null,
    figure: {
      description: `Two boxes: what people assume and what is true about ${node.title}, with an arrow between them`,
      labels: ["Assumed", "Actually"],
    },
    contrast,
  };
  const beat3: BeatDraft = {
    idea: short(`Use ${topic} on a new case.`, 12),
    lead: "One question, and it isn't about the article. It's about Sam.",
    passage: null,
    plain: "",
    aside: "",
    paras,
    action: action({
      kind: "choice",
      prompt: `Sam has a week to get ${topic} right. Which plan fits the idea?`,
      options: [
        { ...opt(short(truth, 10), true), why: null },
        { ...opt(short(misLabel, 10), false, mis), why: "It feels efficient, but the passage says the opposite." },
        {
          ...opt("Nothing changes either way", false, mis),
          why: "Something does change: the second passage shows what.",
        },
      ],
      feedbackRight: "That's the one. You used the idea on a new case.",
      reveal: clip(`That is the idea at work: ${truth}`, 20),
    }),
    figure: {
      description: `Sam's week as a row of days for ${node.title}`,
      labels: ["Day 1", "Day 7"],
    },
    contrast,
  };
  const key = kw[0] ?? "idea";
  const teaser = input.next
    ? clip(`Next up, ${input.next.title.toLowerCase()}. What would you guess happens there?`, 20)
    : "One last stop: a short checkpoint on everything so far. Ready?";
  return {
    hooks: [
      hookVariant(
        "puzzle",
        clip(`Someone new to ${topic} hears about it.`, 12),
        `Guess first: what holds true about ${topic}?`,
        hookOptions,
        truth,
      ),
      hookVariant("surprise", "", `Lots of people get ${topic} backwards. Which line is right?`, hookOptions, truth),
      hookVariant(
        "what-would-you-do",
        clip(`A colleague asks you about ${topic}.`, 12),
        "What would you tell them first?",
        hookOptions,
        truth,
      ),
    ],
    beats: [beat1, beat2, beat3],
    close: {
      text: clip(`==${short(truth, 18)}== That is what the passage shows, and the beats above put it to work.`, 60),
      idk: clip(`No idea yet is a fine place to start. ${truth}`, 60),
    },
    teaser,
    items: [
      item({
        kind: "choice",
        prompt: `Which statement matches ${topic}?`,
        options: [
          opt(short(truth, 12), true),
          opt(short(misLabel, 12), false, mis),
          opt("Nothing changes either way", false, mis),
        ],
        level: "recall",
        difficulty: 2,
        why: clip(truth, 20),
      }),
      item({
        kind: "order",
        prompt: "Order the chain from first to last.",
        steps: order.map((s) => short(s, 12)),
        level: "apply",
        difficulty: 3,
      }),
      item({
        kind: "text",
        prompt: `One word: the passage's key term here starts with "${key.slice(0, 2)}".`,
        accept: [key],
        level: "recall",
        difficulty: 2,
      }),
      item({
        kind: "choice",
        prompt: `Someone at work claims "${clip(misLabel, 8)}". What would you tell them?`,
        options: [
          opt(short(truth, 12), true),
          opt("They are right", false, mis),
          opt("It depends on luck", false, mis),
        ],
        level: "transfer",
        difficulty: 3,
      }),
      item({
        kind: "order",
        prompt: `In a different setting, rebuild the chain behind ${topic}.`,
        steps: order.map((s) => short(s, 12)),
        level: "transfer",
        difficulty: 3,
      }),
      item({
        kind: "choice",
        prompt: `A friend plans around ${key}. Which plan fits the idea?`,
        options: [
          opt(short(truth, 12), true),
          opt("Ignore it entirely", false, mis),
          opt("Do the reverse", false, mis),
        ],
        level: "transfer",
        difficulty: 3,
      }),
    ],
    flashcards: [
      { front: `What is the key claim of "${node.title}"?`, back: clip(truth, 22) },
      { front: `True or not: ${clip(misLabel, 12)}`, back: clip(`Not quite. ${truth}`, 22) },
      { front: `Name one point about ${topic}.`, back: clip(kp[1] ?? truth, 22) },
    ],
    misconceptions: node.misconceptions.slice(0, 2).map((m) => ({
      id: m.id,
      label: m.label,
      hint: clip(`Look again at what the passage says about ${key}.`, 25),
    })),
    claims: [{ text: truth, para: paras[0] ?? "p1" }],
    faq: [
      {
        q: `Where does ${topic} come from?`,
        a: clip(`The article doesn't go far into that. What it does say is the part you can use: ${truth}.`, 50),
      },
      { q: "Is this settled?", a: "As settled as the article makes it. Where it hedges, I hedge too." },
    ],
  };
}

export function fakeJudge(_input: JudgeInput): CardJudgeDraft {
  return {
    hook: 0,
    closeAnswersHook: true,
    unsupportedClaims: [],
    giveaway: false,
    teaserOpensNext: true,
    problems: [],
    voiceProblems: [],
  };
}

export function fakeTeaser(input: TeaserInput): TeaserDraft {
  return { teaser: clip(`So what about ${input.next.title.toLowerCase()}? Make a guess before you open it.`, 20) };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fakeFigure(input: FigureInput): FigureDraft {
  const labels = (input.labels.length > 0 ? input.labels : ["Before", "After"]).slice(0, 3).map((l) => clip(l, 3));
  const n = labels.length;
  const gap = 800 / (n + 1);
  const shapes = labels
    .map((label, i) => {
      const cx = Math.round(gap * (i + 1));
      const color = `var(--w-${(i % 5) + 1})`;
      const arrow =
        i < n - 1
          ? `<path d="M ${cx + 90} 250 L ${Math.round(gap * (i + 2)) - 90} 250" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
          : "";
      return `<circle cx="${cx}" cy="250" r="80" fill="${color}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="${cx}" y="380" font-size="22" text-anchor="middle" fill="var(--ink)">${esc(label)}</text>${arrow}`;
    })
    .join("");
  const title = esc(clip(input.title, 5).replace(/…$/, ""));
  const desc = esc(clip(input.description, 30));
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><title>${title}</title><desc>${desc}</desc>${shapes}</svg>`,
    alt: clip(input.description, 25),
  };
}

export function fakeGrade(input: GradeInput): ExplainGradeDraft {
  const t = norm(input.text);
  const hit = input.keyPoints
    .filter((k) => {
      const kws = k.keywords && k.keywords.length > 0 ? k.keywords : keywords(k.text, 3);
      return kws.some((w) => t.includes(norm(w)));
    })
    .map((k) => k.id);
  const missing = input.keyPoints.find((k) => !hit.includes(k.id))?.id ?? null;
  const mis = input.misconceptions.find((m) => t.length > 0 && t.includes(norm(m.label))) ?? null;
  const missingText = input.keyPoints.find((k) => k.id === missing)?.text;
  return {
    hit,
    missing,
    misconception: mis?.id ?? null,
    feedback:
      hit.length >= input.minHits
        ? missingText
          ? `Solid. You could also say: ${clip(missingText, 14)}`
          : "Solid: you named every key point."
        : `Not there yet. Missing: ${clip(missingText ?? "the key idea", 16)}`,
  };
}

export function fakeHint(input: HintInput): HintDraft {
  return {
    hint: clip(`You went with ${clip(input.answer, 6)}. ${input.authoredHint} What changes if you look again?`, 40),
  };
}

/** Variant answers the fake has produced, so its blind solver can agree (deterministic fixture). */
const variantMemory = new Map<string, SolverAnswer>();

export function fakeVariant(input: VariantInput): QuizVariantDraft {
  const it = input.item;
  const prefix = "In a new case: ";
  if (it.kind === "choice") {
    const answer = Array.isArray(it.answer) ? (it.answer[0] ?? "") : it.answer;
    const options = [...it.options].reverse().map((o) => opt(o.text, o.id === answer, o.misconception ?? null));
    const prompt = clip(`${prefix}${it.prompt}`, 40);
    const correctIndex = options.findIndex((o) => o.correct);
    variantMemory.set(norm(prompt), { choice: `o${correctIndex + 1}`, number: null, order: null, text: null });
    return { item: item({ kind: "choice", prompt, options, level: it.level, difficulty: it.difficulty }) };
  }
  if (it.kind === "numeric") {
    const prompt = clip(`${prefix}${it.prompt}`, 40);
    variantMemory.set(norm(prompt), { choice: null, number: it.answer, order: null, text: null });
    return {
      item: item({
        kind: "numeric",
        prompt,
        numericAnswer: it.answer,
        tolerance: it.tolerance ?? 0,
        unit: it.unit ?? null,
        level: it.level,
        difficulty: it.difficulty,
      }),
    };
  }
  if (it.kind === "order") {
    const steps = it.answer.map((i) => it.items[i] ?? "");
    const prompt = clip(`${prefix}${it.prompt}`, 40);
    variantMemory.set(norm(prompt), { choice: null, number: null, order: steps.map((_, i) => i), text: null });
    return { item: item({ kind: "order", prompt, steps, level: it.level, difficulty: it.difficulty }) };
  }
  const accept = it.kind === "text" ? it.accept : ["answer"];
  const prompt = clip(`${prefix}${it.prompt}`, 40);
  variantMemory.set(norm(prompt), { choice: null, number: null, order: null, text: accept[0] ?? "" });
  return { item: item({ kind: "text", prompt, accept, level: it.level, difficulty: it.difficulty }) };
}

export function fakeSolve(input: SolveInput): SolverAnswer {
  const known = variantMemory.get(norm(input.question));
  if (known) return known;
  return { choice: input.options?.[0]?.id ?? null, number: 0, order: null, text: null };
}

export function fakeCards(input: CardsInput): CardDraftsDraft {
  const cards: CardDraftsDraft["cards"] = [];
  if (input.hook && !input.hook.correct) {
    cards.push({
      front: clip(`True or not: ${input.hook.guess}`, 20),
      back: clip(`Not quite. ${input.hook.truth}`, 25),
      kind: "qa",
      reason: "used-to-think",
    });
  }
  const m = input.misconceptions[0];
  if (m)
    cards.push({
      front: clip(`Why is "${m.label}" wrong?`, 20),
      back: clip(m.hint, 25),
      kind: "qa",
      reason: "misconception",
    });
  if (input.myWords) {
    const kw = keywords(input.myWords, 1)[0];
    if (kw) {
      const cloze = input.myWords.replace(new RegExp(`\\b${kw}\\b`, "i"), "{{answer}}");
      if (cloze.includes("{{answer}}"))
        cards.push({ front: clip(cloze, 20), back: kw, kind: "cloze", reason: "close" });
    }
  }
  return { cards: cards.filter((c) => !input.existing.some((e) => norm(e) === norm(c.front))).slice(0, 3) };
}

export function fakeCroc(input: CrocInput): string {
  const focus = input.card?.ideas[0] ?? input.card?.bigIdea ?? "the idea on this card";
  if (input.mode === "hint") {
    const hint = input.hintLevel >= 1 ? "Look at the part of the question that changes the answer. " : "";
    return `${hint}What do you expect to happen, and why? Try this: name the one thing that matters most.`;
  }
  const lead = clip(focus, 30).replace(/…$/, ".");
  return `Here's the short version. ${lead} The key is to connect it to what you just did on the card.\nTry this: say in one sentence why your answer worked.\nCHECK: Does this card's idea still hold in a new case? | Yes, the same idea applies | No, it only worked once | Only with different numbers | answer=1`;
}

export function fakeAuthorPlan(input: AuthorPlanInput): AuthorPlanDraft {
  const n = Math.max(3, Math.min(input.nodeCount, 12));
  const base = slug(input.title, 20);
  const nodes = Array.from({ length: n }, (_, i) => {
    const id = `${base}-${i + 1}`;
    return {
      id,
      title: `${titleCase(input.title)} ${i + 1}`,
      line: "main",
      requires: i < 2 ? [] : [`${base}-${i - 1}`],
      bigIdea: `Idea ${i + 1} of ${input.topic}`,
      hookIdea: `A surprising fact about ${input.topic}, part ${i + 1}`,
      objectives: [`Explain idea ${i + 1} of ${input.topic}`],
      misconceptions: [
        { id: "m-reverse", label: "It works the other way round", upstream: null },
        { id: "m-simple", label: "It is just a definition to memorise", upstream: null },
      ],
      sources: input.sources.slice(0, 1).map((s) => s.id),
    };
  });
  return { lines: [{ id: "main", title: titleCase(input.title), outcome: `Explain ${input.topic}` }], nodes };
}

export function fakeAuthorNode(input: AuthorNodeInput): AuthorNodeDraft {
  const card = fakeBeatCard({
    kind: "create-card",
    node: {
      id: input.node.id,
      title: input.node.title,
      landmark: input.node.title,
      objective: input.node.objectives[0] ?? input.node.bigIdea,
      keyPoints: [input.node.bigIdea, `${input.node.title} has a cause`, `${input.node.title} has an effect`],
      paras: [],
      hookIdea: input.node.hookIdea,
      hookStyle: null,
      misconceptions: input.misconceptions,
      caution: null,
      requires: [],
    },
    index: 1,
    total: 1,
    next: input.next,
    articleTitle: input.node.title,
    paragraphs: [{ id: "s1", text: `${input.node.bigIdea}. ${input.node.hookIdea}.` }],
    familiarity: "none",
  });
  const beats = [...card.beats];
  while (beats.length < input.beatCount) beats.push({ ...(card.beats[0] as BeatDraft), passage: null });
  return {
    ...card,
    beats: beats.slice(0, Math.max(2, input.beatCount)).map((b) => ({ ...b, passage: null })),
    items: [],
    flashcards: [],
    tagline: `A card about ${input.node.title.toLowerCase()}`,
    faq: [{ q: `Why does ${input.node.title.toLowerCase()} matter?`, a: clip(input.node.bigIdea, 40) }],
  };
}

export function fakeAuthorPractice(input: AuthorPracticeInput): AuthorPracticeDraft {
  const mis = input.misconceptions[0]?.id ?? null;
  const items = Array.from({ length: input.itemCount }, (_, i) => {
    const level = (["apply", "transfer", "recall", "transfer", "apply", "transfer"] as const)[i % 6] ?? "recall";
    if (i % 3 === 0) {
      return {
        ...item({
          kind: "choice",
          prompt: `Question ${i + 1}: which statement about ${input.node.title.toLowerCase()} holds?`,
          options: [
            opt(clip(input.node.bigIdea, 10), true),
            opt("The reverse holds", false, mis),
            opt("Neither", false, mis),
          ],
          level,
        }),
        params: null,
      };
    }
    if (i % 3 === 1) {
      const a = 2 + (hash32(`${input.node.id}${i}`) % 7);
      return {
        ...item({ kind: "numeric", prompt: `What is {n} times 3?`, numericAnswer: a * 3, tolerance: 0, level }),
        params: { vars: [{ name: "n", values: [a, a + 1, a + 2] }], answerExpr: "n * 3" },
      };
    }
    return {
      ...item({ kind: "order", prompt: "Order these from first to last.", steps: ["First", "Second", "Third"], level }),
      params: null,
    };
  });
  return {
    items,
    cards: [
      { front: `What is the big idea of ${input.node.title}?`, back: clip(input.node.bigIdea, 22) },
      { front: `Name one misconception about ${input.node.title}.`, back: input.misconceptions[0]?.label ?? "-" },
      { front: `Explain ${input.node.title} in one line.`, back: clip(input.node.bigIdea, 22) },
    ],
  };
}
