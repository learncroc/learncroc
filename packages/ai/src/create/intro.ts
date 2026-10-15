/**
 * The intro stop of an article map: always the first stop, one typed `intro` card. Moss says hello, the
 * article's opening is quoted word for word, and the map's summary says it plainly. Deterministic, no
 * model call. The player shows the questions the map answers from the other stops' ask cards; the legacy
 * hook / screens / close (filled through core `legacyFromCards`) keep phase-1 players working.
 */
import {
  type Block,
  CARD_CAPS,
  CROC_NAME,
  INTRO_NODE_ID,
  legacyFromCards,
  type PackNode,
  type Source,
  words,
} from "@learncroc/core";
import type { Para } from "../inputs";
import { clip, cutAtSentence } from "../text";

export interface IntroSource {
  /** The article's title. */
  title: string;
  /** Where it's from, said in the hello ("Wikipedia", "addyosmani.com"); absent for pasted text. */
  site?: string;
  url?: string;
  /** The article's paragraphs in reading order (the opening is quoted from them). */
  paragraphs: readonly Para[];
  sources: Source[];
}

/** Opening words the intro quotes: whole sentences of the first paragraph long enough to say something. */
export const INTRO_PASSAGE = { min: 40, max: 80 } as const;

/** The opening passage: whole sentences from one early paragraph, 40–80 words when the article allows. */
export function openingPassage(paragraphs: readonly Para[]): { text: string; para: string } | undefined {
  const early = paragraphs.slice(0, 6).filter((p) => words(p.text) >= 12);
  const pick = early.find((p) => words(p.text) >= INTRO_PASSAGE.min) ?? early[0];
  if (!pick) return undefined;
  const text = cutAtSentence(pick.text.replace(/\s+/g, " ").trim(), INTRO_PASSAGE.max);
  // cutAtSentence clips mid-sentence (with "…") only when the first sentence alone is too long.
  return text ? { text, para: pick.id } : undefined;
}

export interface IntroInput {
  source: IntroSource;
  /** The map's one-line summary (the plan's gist), Moss's plain-words line. */
  gist: string;
  /** Stop titles in reading order (the hook's options). */
  stops: string[];
}

export function introNode(input: IntroInput): PackNode {
  const { source } = input;
  const opening = openingPassage(source.paragraphs);
  const site = source.site?.replace(/[.\s]+$/, "");
  const from = site ? `, from ${site}` : "";
  const n = input.stops.length;
  const options = (input.stops.length >= 2 ? input.stops.slice(0, 4) : [...input.stops, "Not sure yet"]).map(
    (t, i) => ({ id: `o${i + 1}`, text: clip(t, 6).replace(/…$/, "") }),
  );
  const cut = cutAtSentence(input.gist.trim(), CARD_CAPS.plain - 3).replace(/…$/, "");
  const gist = cut && !/[.?!]$/.test(cut) ? `${cut}.` : cut;
  const plain = gist
    ? `Short version: ${/^[A-Z][a-z]/.test(gist) ? gist[0]?.toLowerCase() + gist.slice(1) : gist}`
    : "Short version coming up, one question at a time.";
  const blocks: Block[] = [
    { type: "say", text: `Hi. I'm ${CROC_NAME}. I read this one before you got here, so I'll walk you through it.` },
    {
      type: "say",
      text: opening
        ? `It's “${clip(source.title, 14)}”${from}. Here's how it opens, word for word:`
        : `It's “${clip(source.title, 14)}”${from}.`,
    },
  ];
  if (opening)
    blocks.push({
      type: "quote",
      text: opening.text,
      cite: { title: source.title, ...(source.url ? { url: source.url } : {}), para: opening.para },
    });
  blocks.push({ type: "say", text: plain });
  const cards: PackNode["cards"] = [{ type: "intro", id: "intro", blocks }];
  // Phase-1 players read the screen: the same lines, as story blocks.
  const storyBlocks: Block[] = blocks.map((b) => (b.type === "say" ? { type: "story", text: b.text } : b));
  const legacy = legacyFromCards(cards, {
    hook: {
      interaction: {
        id: "hook",
        kind: "choice",
        prompt: "Which of these are you most curious about?",
        options: options.length >= 2 ? options : [...options, { id: "o2", text: "Not sure yet" }],
        answer: "o1",
      },
    },
    screens: [
      {
        id: "s1",
        newIdea: "What the article says, in its own words.",
        blocks: storyBlocks,
        ...(opening ? { src: [opening.para], confidence: "sourced" as const } : { confidence: "model" as const }),
      },
    ],
    close: {
      text:
        n > 0
          ? `That's the map: ${n} ${n === 1 ? "stop" : "stops"}, one question each. I'll be with you the whole way.`
          : "That's the map. I'll be with you the whole way.",
      teaser: "Ready for the first question?",
    },
  });
  return {
    id: INTRO_NODE_ID,
    title: "Before you start",
    tagline: "What the article says, and the questions ahead",
    estMinutes: 1,
    bigIdea: input.gist.trim() || source.title,
    objectives: ["See what the article claims and which questions the map answers."],
    misconceptions: {},
    ...legacy,
    cards,
    items: [],
    sources: source.sources,
    status: "draft",
  };
}
