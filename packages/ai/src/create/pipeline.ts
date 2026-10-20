/**
 * The article-map create job: fetch → extract → streamed plan (cards appear as they close)
 * → cards in reading order (≤ 4 in parallel; card i starts once plan node i+1 is known, so its teaser
 * can open that card's question) → per stop: create-card (typed cards) → assembleStop + core
 * card lint → one repair round → card-judge (picks the hook, checks close, grounding, giveaway) →
 * one more repair when the judge objects → publish → a generated figure per beat → teaser pass in
 * reading order → checkpoints every 4–6 cards → write. Every step emits JobEvents for the
 * surveying view. (The generated toy is parked.)
 */

import type {
  CompiledPack,
  CreateRequest,
  JobEvent,
  JobStage,
  MinimapSkeleton,
  PackNode,
  PackOrigin,
  PlanNode,
  Provenance,
  Source,
  Usage,
} from "@learncroc/core";
import { CREATE_SIZES, CROC_NAME, cardWords, plainText, sectionSizes } from "@learncroc/core";
import type { AiClient } from "../client";
import type { ConvertIssue } from "../convert";
import { AiError, toAiError } from "../errors";
import type { CardInput, FigureInput, JudgeInput, Para, SkeletonInput, TeaserInput } from "../inputs";
import { inputBlock, prompt, render, tag } from "../prompts";
import {
  CardJudgeDraft,
  CardWriteDraft,
  FigureDraft,
  SkeletonDraft,
  type StopCardDraft,
  TeaserDraft,
} from "../schemas";
import { clip, keywords } from "../text";
import { assembleStop, type CardContext, capText, setTeaser } from "./card";
import { type Article, extractFromHtml, extractFromText, MAX_ARTICLE_WORDS, MIN_ARTICLE_WORDS } from "./extract";
import { type FetchOptions, FetchRefused, fetchArticle } from "./fetch";
import { checkFigure, normalizeFigure } from "./figure";
import {
  buildPocketPack,
  figurePath,
  POCKET_CHECKPOINT_EVERY,
  type PocketPackState,
  placeCheckpoints,
  pocketReadme,
  removePocketPack,
  writePocketPack,
} from "./pack";
import { type SkeletonNode, SkeletonStream } from "./skeleton";
import type { ToyValidator } from "./toy";

/** How the card prompt describes the learner's familiarity with the topic. */
const FAMILIARITY = {
  none: "none: assume no background, define every term",
  some: "some: the basics are familiar, the specifics are not",
  lots: "lots: knows the field, but not this article",
} as const;

export interface CreateJobDeps {
  jobId: string;
  packId: string;
  request: CreateRequest;
  client: AiClient;
  home: string;
  now(): number;
  emit(e: JobEvent): void;
  signal: AbortSignal;
  toyValidator: ToyValidator;
  /** How long to wait for the browser's toy verdict (default 45 s). */
  toyTimeoutMs?: number;
  fetchOptions?: FetchOptions;
  concurrency?: number;
  /** Optional full lint (core) for node-ready counts; the built-in pocket checks run regardless. */
  lint?: (pack: CompiledPack, nodeId: string) => { errors: number; warnings: number };
  /** Keeps the extracted paragraphs for the reader pane while the job runs. */
  onArticle?(article: Article): void;
  /** Total usage of this job (summed by the caller's client hook). */
  usage(): { usage: Usage; usd: number };
  /** Where the pack goes (the server installs through its PackStore). Default: write under <home>/packs/local. */
  writePack?(pack: CompiledPack, assets: Record<string, string>, readme: string): void;
  /** Undo a half-built pack on cancel. */
  removePack?(packId: string): void;
}

class JobFailed extends Error {
  constructor(
    readonly stage: JobStage,
    readonly code: Extract<JobEvent, { type: "error" }>["code"],
    message: string,
  ) {
    super(message);
  }
}

/** Run up to `n` tasks at once, in the order they were queued. */
class Pool {
  private running = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly n: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.n) await new Promise<void>((r) => this.queue.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

function articleTag(a: Article, url?: string): string {
  const body = a.paragraphs
    .map((p) => `${p.heading ? `<h id="${p.id}-h">${p.heading}</h>\n` : ""}<p id="${p.id}">${p.text}</p>`)
    .join("\n");
  return tag("article", body, { title: a.title, ...(url ? { url } : {}) });
}

/** card-judge (smart tier): the best hook of the three, and whether the card holds together. */
async function judgeCard(
  d: CreateJobDeps,
  sk: SkeletonNode,
  draft: CardWriteDraft,
  next: SkeletonNode | undefined,
  article: Article,
): Promise<CardJudgeDraft> {
  const paraText = new Map(article.paragraphs.map((p) => [p.id, p.text]));
  const ask = draft.cards.find((c) => c.type === "ask");
  const takeaway = draft.cards.find((c) => c.type === "takeaway");
  const input: JudgeInput = {
    kind: "card-judge",
    title: sk.title,
    // One ask per stop: the judge sees it as the only hook (its hunches are never graded).
    hooks: ask
      ? [
          {
            style: sk.hookStyle ?? "puzzle",
            prompt: ask.say[0] ? `${ask.say[0]} ${ask.prompt}` : ask.prompt,
            options: ask.hunches.map((text) => ({ text, correct: false })),
          },
        ]
      : [],
    close: takeaway?.text ?? "",
    byGuess: (takeaway?.byHunch ?? []).map((g) => g.text),
    teaser: draft.teaser,
    claims: draft.claims.slice(0, 12).map((c) => ({ ...c, paraText: clip(paraText.get(c.para) ?? "", 120) })),
    beats: draft.cards
      .filter((c) => c.type === "teach" || c.type === "try" || c.type === "check")
      .map((c) => ({
        moss: [...c.say, c.plain, c.action?.reveal ?? ""].filter((t) => t.trim().length > 0),
        passage: c.passage,
      })),
    nextHookIdea: next?.hookIdea ?? null,
  };
  const { value } = await d.client.object({
    feature: "create",
    promptId: "card-judge",
    schema: CardJudgeDraft,
    schemaName: "CardJudgeDraft",
    signal: d.signal,
    messages: [{ role: "user", content: inputBlock(input) }],
  });
  return { ...value, hook: Math.min(Math.max(0, value.hook), Math.max(0, input.hooks.length - 1)) };
}

export async function runCreateJob(d: CreateJobDeps): Promise<void> {
  const started = d.now();
  const stage = (s: JobStage, status: "start" | "done") => d.emit({ type: "stage", stage: s, status });
  let wrotePack = false;
  try {
    // 1. fetch
    stage("fetch", "start");
    let article: Article;
    let origin: PackOrigin;
    const src = d.request.source;
    if (src.kind === "url") {
      let page: Awaited<ReturnType<typeof fetchArticle>>;
      try {
        page = await fetchArticle(src.url, { ...d.fetchOptions, signal: d.signal });
      } catch (e) {
        if (e instanceof FetchRefused)
          throw new JobFailed("fetch", e.code === "url_refused" ? "invalid" : e.code, e.message);
        throw new JobFailed("fetch", "fetch_failed", "Couldn't load that page.");
      }
      stage("fetch", "done");
      stage("extract", "start");
      article = page.contentType.includes("text/plain")
        ? extractFromText(page.body, new URL(page.url).pathname.split("/").pop() || page.url)
        : extractFromHtml(page.body, page.url);
      const isWikipedia = /(^|\.)wikipedia\.org$/.test(new URL(page.url).hostname);
      origin = {
        kind: "url",
        url: page.url,
        title: article.title,
        ...(article.site ? { site: article.site } : {}),
        fetchedAt: new Date(d.now()).toISOString(),
        ...(isWikipedia ? { license: "CC-BY-SA-4.0" } : {}),
      };
    } else {
      stage("fetch", "done");
      stage("extract", "start");
      article = extractFromText(src.text, src.title);
      origin = { kind: "text", title: src.title || article.title, createdAt: new Date(d.now()).toISOString() };
    }
    d.emit({
      type: "meta",
      title: article.title,
      ...(article.site ? { site: article.site } : {}),
      words: article.words,
      paragraphs: article.paragraphs.length,
      headings: article.headings.slice(0, 40),
    });
    d.onArticle?.(article);
    if (article.words < MIN_ARTICLE_WORDS) {
      throw new JobFailed("extract", "too_short", "We couldn't read enough of this page. Paste the text instead?");
    }
    if (article.words > MAX_ARTICLE_WORDS) {
      throw new JobFailed(
        "extract",
        "too_long",
        `This article is about ${Math.round(article.words / 1000)}k words. Paste the section you care about (up to ${MAX_ARTICLE_WORDS / 1000}k words).`,
      );
    }
    stage("extract", "done");

    // 2. plan (streamed) with cards starting as plan nodes arrive
    stage("plan", "start");
    const state: PocketPackState = {
      packId: d.packId,
      skeleton: { title: article.title, gist: "", renderer: "sketchbook", nodes: [], edges: [] },
      origin,
      familiarity: d.request.familiarity,
      nodes: {},
      assets: {},
      now: d.now,
    };
    const readme = pocketReadme(article.title, origin);
    let writeChain = Promise.resolve();
    let layoutSent = false;
    const persist = (provisional: boolean, announce = false) => {
      writeChain = writeChain
        .catch(() => {})
        .then(() => {
          if (d.signal.aborted) return;
          const built = buildPocketPack(state, provisional);
          if (d.writePack) d.writePack(built, state.assets, readme);
          else writePocketPack(d.home, built, state.assets, readme);
          wrotePack = true;
          // Publish early: the map is servable from the first ready card on.
          if (!layoutSent || announce) {
            layoutSent = true;
            d.emit({ type: "layout", map: built.map });
          }
        });
      return writeChain;
    };
    const provenance = (feature: Provenance["feature"], promptRef: string, tier: "fast" | "smart"): Provenance => ({
      feature,
      prompt: promptRef,
      provider: d.client.env.providerId === "fake" ? "none" : (d.client.env.providerId as Provenance["provider"]),
      model: d.client.env.models[tier],
      at: new Date(d.now()).toISOString(),
    });

    const url = origin.kind === "url" ? origin.url : undefined;
    const sources: Source[] = [
      {
        id: "article",
        title: article.title,
        ...(url ? { url } : {}),
        ...(origin.kind === "url" && origin.license ? { license: origin.license } : {}),
      },
    ];
    state.intro = {
      title: article.title,
      ...(origin.kind === "url"
        ? {
            site: /(^|\.)wikipedia\.org$/.test(new URL(origin.url).hostname)
              ? "Wikipedia"
              : (origin.site ?? new URL(origin.url).hostname.replace(/^www\./, "")),
          }
        : {}),
      ...(url ? { url } : {}),
      paragraphs: article.paragraphs,
      sources,
    };
    const paraById = new Map(article.paragraphs.map((p) => [p.id, p]));
    const paraIds = new Set(article.paragraphs.map((p) => p.id));
    const familiarity = FAMILIARITY[d.request.familiarity];
    const cardPrompt = prompt("create-card");

    // Plan nodes in reading order, and waiters for "plan node n has closed (or the plan ended)".
    const planned: SkeletonNode[] = [];
    let skeletonComplete = false;
    let waiters: (() => void)[] = [];
    const wake = () => {
      const w = waiters;
      waiters = [];
      for (const f of w) f();
    };
    d.signal.addEventListener("abort", wake, { once: true });
    const whenPlanned = async (n: number) => {
      while (planned.length < n && !skeletonComplete && !d.signal.aborted) {
        await new Promise<void>((r) => waiters.push(r));
      }
    };

    const pool = new Pool(d.concurrency ?? 4);
    const fills: Promise<void>[] = [];
    const failed = new Set<string>();
    /** The judge's teaser verdict per card (false = rewrite it in the teaser pass). */
    const teaserOk = new Map<string, boolean>();
    let figuresStarted = false;
    let cardsStarted = false;
    const figureTasks: Promise<void>[] = [];
    const drafts = new Map<string, CardWriteDraft>();

    const contextFor = (sk: SkeletonNode, strictQuote: boolean, hook?: number): CardContext => ({
      id: sk.id,
      title: sk.title,
      tagline: sk.objective,
      bigIdea: sk.keyPoints[0] ?? sk.objective,
      objectives: [sk.objective],
      misconceptions: sk.misconceptions,
      ...(sk.hookStyle ? { preferStyle: sk.hookStyle } : {}),
      ...(hook !== undefined ? { hook } : {}),
      paragraphs: article.paragraphs,
      strictQuote,
      cite: { title: article.title, ...(url ? { url } : {}) },
      srcIds: paraIds,
      sources,
      provenance: provenance("create", cardPrompt.ref, "fast"),
      profile: "pocket",
    });

    const judgeProblems = (v: CardJudgeDraft): { check: "hook-close" | "grounded" | "giveaway"; line: string }[] => {
      const out: { check: "hook-close" | "grounded" | "giveaway"; line: string }[] = [];
      const lines = v.problems.length > 0 ? v.problems.join(" ") : "";
      if (!v.closeAnswersHook) out.push({ check: "hook-close", line: "the close does not answer the chosen hook" });
      if (v.unsupportedClaims.length > 0)
        out.push({
          check: "grounded",
          line: `claims ${v.unsupportedClaims.join(", ")} are not supported by their paragraph`,
        });
      if (v.giveaway) out.push({ check: "giveaway", line: "the title or the hook gives the answer away" });
      if (out.length > 0 && lines) out.push({ check: out[0]?.check ?? "hook-close", line: lines });
      return out;
    };
    /** Moss's voice: the judge's fixes, repaired along with the checks (no job check event of their own). */
    const voiceLines = (v: CardJudgeDraft): string[] => (v.voiceProblems ?? []).slice(0, 6).map((l) => `voice: ${l}`);

    const fill = async (sk: SkeletonNode, index: number): Promise<void> => {
      // The teaser opens the next card's question, so wait for that plan node (or the end of the plan).
      await whenPlanned(index + 2);
      if (d.signal.aborted) return;
      const nextSk = planned[index + 1];
      const cited: Para[] = sk.paras.map((p) => paraById.get(p)).filter((p): p is Para => !!p);
      const input: CardInput = {
        kind: "create-card",
        node: { ...sk, landmark: sk.landmark ?? sk.title, hookStyle: sk.hookStyle ?? null },
        index: index + 1,
        total: skeletonComplete ? planned.length : Math.max(planned.length, index + 2),
        next: nextSk ? { title: nextSk.title, hookIdea: nextSk.hookIdea } : null,
        articleTitle: article.title,
        paragraphs: cited.length > 0 ? cited : article.paragraphs.slice(0, 3),
        familiarity: d.request.familiarity,
      };
      const base = [
        {
          role: "user" as const,
          content: `${articleTag(article, url)}\n\nCard plan:\n${JSON.stringify(sk, null, 1)}\n\n${inputBlock(input)}`,
        },
      ];
      const repair = (draft: CardWriteDraft, problems: string[]) =>
        d.client
          .object({
            feature: "create",
            promptId: "repair",
            maxTokens: cardPrompt.maxTokens,
            extraSystem: [{ text: render(cardPrompt.body, { familiarity, crocName: CROC_NAME }) }],
            schema: CardWriteDraft,
            schemaName: "CardWriteDraft",
            signal: d.signal,
            messages: [
              ...base,
              { role: "assistant", content: JSON.stringify(draft) },
              {
                role: "user",
                content: `Problems:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn the corrected CardWriteDraft JSON. Keep the ask card's question.\n\n${inputBlock(input)}`,
              },
            ],
          })
          .then(
            (r) => r.value,
            (e: unknown) => {
              if (d.signal.aborted) throw e;
              return undefined;
            },
          );
      const issueLines = (issues: ConvertIssue[]) => issues.map((i) => `${i.path}: ${i.message}`);

      const first = (
        await d.client.object({
          feature: "create",
          promptId: "create-card",
          vars: { familiarity },
          schema: CardWriteDraft,
          schemaName: "CardWriteDraft",
          messages: base,
          signal: d.signal,
        })
      ).value;
      if (d.signal.aborted) return;
      let draft = first;
      let built = assembleStop(draft, contextFor(sk, true));
      if (!built.node) {
        // One repair round; after it a card without a verbatim quote still plays (story + idea).
        const repaired = await repair(draft, issueLines(built.issues));
        if (repaired) {
          const again = assembleStop(repaired, contextFor(sk, false));
          if (again.node) draft = repaired;
          built = again;
        }
        if (!built.node) {
          const lenient = assembleStop(first, contextFor(sk, false));
          if (lenient.node) {
            draft = first;
            built = lenient;
          }
        }
      }
      if (!built.node) {
        const why = built.issues[0];
        failed.add(sk.id);
        d.emit({
          type: "card-failed",
          nodeId: sk.id,
          message: why ? `${why.path}: ${why.message}` : "invalid card",
          retryable: true,
        });
        return;
      }

      // The judge: picks the hook, checks the close, the grounding and giveaways. One repair when it objects.
      const judge = (dr: CardWriteDraft) => judgeCard(d, sk, dr, nextSk, article).catch(() => undefined);
      let verdict = await judge(draft);
      if (d.signal.aborted) return;
      const problems = verdict ? judgeProblems(verdict) : [];
      const voice = verdict ? voiceLines(verdict) : [];
      if (problems.length > 0 || voice.length > 0) {
        const lines = [...problems.map((p) => p.line), ...voice];
        lines.push("Keep the ask card's question, and make the takeaway's text and byHunch lines answer it.");
        const repaired = await repair(draft, lines);
        let fixed = false;
        if (repaired) {
          const again = assembleStop(repaired, contextFor(sk, false));
          if (again.node) {
            const second = await judge(repaired);
            const left = second ? judgeProblems(second) : [];
            const leftVoice = second ? voiceLines(second) : [];
            if (left.length < problems.length || (left.length === problems.length && leftVoice.length < voice.length)) {
              draft = repaired;
              built = again;
              verdict = second ?? verdict;
              fixed = left.length === 0;
            }
          }
        }
        for (const c of new Set(problems.map((p) => p.check)))
          d.emit({ type: "check", nodeId: sk.id, check: c, ok: false, action: fixed ? "repaired" : "kept" });
      }
      if (d.signal.aborted || !built.node) return;
      const node: PackNode = {
        ...built.node,
        ...(verdict ? { grounding: { checked: true, unsupported: verdict.unsupportedClaims.length } } : {}),
      };
      if (verdict) teaserOk.set(sk.id, verdict.teaserOpensNext);
      drafts.set(sk.id, draft);
      state.nodes[sk.id] = node;
      await persist(true);
      const lint = d.lint
        ? d.lint(buildPocketPack(state, true), sk.id)
        : { errors: built.lint.errors, warnings: built.lint.warnings };
      d.emit({ type: "card-ready", nodeId: sk.id, words: cardWords(node, "en").total, lint });
      // Figures for teach cards (their canvas is the visual).
      const teachDrafts = draft.cards.filter((c) => c.type === "teach");
      for (const [k, card] of (node.cards ?? []).filter((c) => c.type === "teach").entries()) {
        if (!figuresStarted) {
          figuresStarted = true;
          stage("figures", "start");
        }
        figureTasks.push(figureFor(sk, card.id, teachDrafts[k]));
      }
    };

    const figureFor = async (sk: SkeletonNode, screenId: string, beat: StopCardDraft | undefined) => {
      const input: FigureInput = {
        kind: "create-figure",
        nodeId: sk.id,
        screenId,
        title: sk.title,
        description: beat?.figure?.description || sk.objective,
        labels: beat?.figure?.labels ?? [],
        ...(beat?.idea ? { idea: beat.idea } : {}),
      };
      try {
        const { value } = await d.client.object({
          feature: "create",
          promptId: "create-figure",
          houseStyle: false,
          schema: FigureDraft,
          schemaName: "FigureDraft",
          signal: d.signal,
          messages: [
            {
              role: "user",
              content: `Card: ${sk.title}. ${sk.objective}\n${input.idea ? `The idea it must make visible before any question: ${input.idea}\n` : ""}Figure: ${input.description}\nLabels: ${input.labels.join(", ")}\n\n${inputBlock(input)}`,
            },
          ],
        });
        const check = checkFigure(normalizeFigure(value.svg, sk.title, value.alt || input.description));
        if (!check.ok) {
          d.emit({ type: "figure", nodeId: sk.id, screenId, ok: false, reason: check.reason });
          return;
        }
        const path = figurePath(sk.id, screenId);
        state.assets[path] = check.svg;
        const current = state.nodes[sk.id];
        const card = current?.cards?.find((c) => c.id === screenId);
        if (!current || card?.type !== "teach") return;
        const visual = { kind: "figure" as const, asset: path, alt: clip(value.alt || input.description, 40) };
        card.visual = visual;
        // The legacy screen derived from this card (core legacyFromCards names it s<n>-<card id>).
        const screen = current.screens.find((s) => s.id.endsWith(`-${screenId}`));
        if (screen) screen.visual = visual;
        await persist(true);
        d.emit({ type: "figure", nodeId: sk.id, screenId, ok: true });
      } catch (e) {
        if (d.signal.aborted) return;
        d.emit({ type: "figure", nodeId: sk.id, screenId, ok: false, reason: toAiError(e).message });
      }
    };

    const [minCards, maxCards] = CREATE_SIZES[d.request.size ?? "standard"];
    const stream = new SkeletonStream(
      article.paragraphs.map((p) => p.id),
      maxCards,
    );
    const skInput: SkeletonInput = {
      kind: "create-skeleton",
      cards: { min: minCards, max: maxCards },
      familiarity: d.request.familiarity,
      title: article.title,
      paragraphs: article.paragraphs,
    };
    const planMessages = [{ role: "user" as const, content: `${articleTag(article, url)}\n\n${inputBlock(skInput)}` }];
    const sectionOf = new Map<string, number>();
    const planNode = (n: SkeletonNode, section: number): PlanNode => ({
      id: n.id,
      title: n.title,
      ...(n.landmark ? { landmark: n.landmark } : {}),
      requires: n.requires,
      paras: n.paras,
      section,
      hookIdea: n.hookIdea,
    });
    const handle = (updates: ReturnType<SkeletonStream["push"]>) => {
      for (const u of updates) {
        if (u.kind === "node") {
          const sk = u.node;
          const index = planned.length;
          planned.push(sk);
          // The provisional pack draws the plan so far (cards may be ready before the plan ends).
          state.skeleton = stream.result();
          const section = sectionSizes(index + 1, POCKET_CHECKPOINT_EVERY).length - 1;
          sectionOf.set(sk.id, section);
          d.emit({ type: "highlight", paras: sk.paras, nodeId: sk.id });
          d.emit({ type: "plan-node", node: planNode(sk, section) });
          wake();
          if (!cardsStarted) {
            cardsStarted = true;
            stage("cards", "start");
          }
          fills.push(
            pool.run(() =>
              fill(sk, index).catch((e) => {
                if (d.signal.aborted) return;
                failed.add(sk.id);
                d.emit({ type: "card-failed", nodeId: sk.id, message: toAiError(e).message, retryable: true });
              }),
            ),
          );
        } else if (u.kind === "edge") {
          d.emit({ type: "plan-edge", from: u.from, to: u.to });
        }
      }
    };
    /** Sections re-derived over the current cards: changed sections go out as plan-update, gates as plan-checkpoint. */
    const announceGates = () => {
      const gates = placeCheckpoints(state.skeleton.nodes);
      const changed: PlanNode[] = [];
      gates.checkpoints.forEach((cp, k) => {
        for (const id of cp.covers) {
          const n = state.skeleton.nodes.find((x) => x.id === id);
          if (n && sectionOf.get(id) !== k) {
            sectionOf.set(id, k);
            changed.push(planNode(n, k));
          }
        }
      });
      if (changed.length > 0) d.emit({ type: "plan-update", removed: [], added: changed });
      for (const cp of gates.checkpoints)
        d.emit({
          type: "plan-checkpoint",
          checkpoint: { id: cp.id, requires: cp.requires, covers: cp.covers, size: cp.size },
        });
    };

    let lastText = "";
    const it = d.client.objectStream({
      feature: "create",
      promptId: "create-skeleton",
      vars: { cardsMin: minCards, cardsMax: maxCards, familiarity: d.request.familiarity },
      schema: SkeletonDraft,
      schemaName: "SkeletonDraft",
      messages: planMessages,
      signal: d.signal,
    });
    try {
      while (true) {
        const next = await it.next();
        if (next.done) break;
        lastText = next.value.partialJson;
        if (/[}\]]\s*$/.test(lastText) || lastText.length % 4 === 0) handle(stream.push(lastText));
      }
      handle(stream.push(lastText, true));
    } finally {
      skeletonComplete = true;
      wake();
    }
    const skeleton: MinimapSkeleton = stream.result();
    if (skeleton.nodes.length < 2)
      throw new JobFailed("plan", "provider_error", "The planner returned fewer than 2 cards.");
    state.skeleton = skeleton;
    state.planComplete = true;
    announceGates();
    await persist(true, true);
    stage("plan", "done");

    await Promise.all(fills);
    if (!cardsStarted) stage("cards", "start");
    if (d.signal.aborted) throw new JobFailed("cards", "invalid", "cancelled");

    // Cards that could not be written leave the map; their children inherit their requirements.
    if (failed.size > 0) {
      const gone = state.skeleton.nodes.filter((n) => failed.has(n.id));
      const reqOf = new Map(gone.map((n) => [n.id, n.requires]));
      const lift = (req: string[]): string[] => {
        const out: string[] = [];
        for (const r of req) out.push(...(reqOf.has(r) ? lift(reqOf.get(r) ?? []) : [r]));
        return [...new Set(out)];
      };
      const kept = state.skeleton.nodes
        .filter((n) => !failed.has(n.id))
        .map((n) => ({ ...n, requires: lift(n.requires).slice(0, 4) }));
      state.skeleton = {
        ...state.skeleton,
        nodes: kept,
        edges: kept.flatMap((n) => n.requires.map((r) => ({ from: r, to: n.id }))),
      };
      d.emit({ type: "plan-update", removed: [...failed], added: [] });
      announceGates();
      await persist(true, true);
    }
    stage("cards", "done");
    const ready = Object.keys(state.nodes);
    if (ready.length === 0)
      throw new JobFailed(
        "cards",
        "provider_error",
        "No card could be written. Try again, or try a different article.",
      );

    // Teaser pass in reading order: each teaser must open the next card's final hook.
    const order = state.skeleton.nodes.map((n) => n.id).filter((id) => state.nodes[id]);
    await Promise.all(
      order.slice(0, -1).map(async (id, i) => {
        const cur = state.nodes[id];
        const next = state.nodes[order[i + 1] ?? ""];
        if (!cur || !next) return;
        const hookText = plainText(next.hook.interaction.prompt);
        const shared = keywords(`${next.title} ${hookText}`, 8).some((k) =>
          plainText(cur.close.teaser).toLowerCase().includes(k),
        );
        if (shared && teaserOk.get(id) !== false) return;
        const input: TeaserInput = {
          kind: "card-teaser",
          title: cur.title,
          close: plainText(cur.close.text),
          next: { title: next.title, hook: hookText },
        };
        try {
          const { value } = await d.client.object({
            feature: "create",
            promptId: "card-teaser",
            schema: TeaserDraft,
            schemaName: "TeaserDraft",
            signal: d.signal,
            messages: [{ role: "user", content: inputBlock(input) }],
          });
          const teaser = capText(value.teaser.trim(), 20, "teaser", []);
          if (teaser) setTeaser(cur, teaser);
          d.emit({ type: "check", nodeId: id, check: "teaser", ok: false, action: teaser ? "repaired" : "kept" });
        } catch (e) {
          if (d.signal.aborted) throw e;
          d.emit({ type: "check", nodeId: id, check: "teaser", ok: false, action: "kept" });
        }
      }),
    );
    const lastId = order.at(-1);
    const last = lastId ? state.nodes[lastId] : undefined;
    if (last && !/checkpoint/i.test(last.close.teaser)) {
      setTeaser(last, "One last stop: a short checkpoint on everything so far. Ready?");
    }

    await Promise.all(figureTasks);
    if (!figuresStarted) stage("figures", "start");
    stage("figures", "done");

    // 5. write
    stage("write", "start");
    await persist(false);
    await writeChain;
    stage("write", "done");
    const total = d.usage();
    d.emit({
      type: "done",
      packId: d.packId,
      version: "0.1.0",
      cards: Object.keys(state.nodes).length,
      usage: total.usage,
      costUsd: Math.round(total.usd * 1e6) / 1e6,
      ms: d.now() - started,
    });
  } catch (e) {
    if (wrotePack && d.signal.aborted) {
      try {
        if (d.removePack) d.removePack(d.packId);
        else removePocketPack(d.home, d.packId);
      } catch {
        /* best effort */
      }
    }
    if (e instanceof JobFailed) {
      d.emit({ type: "error", stage: e.stage, code: e.code, message: e.message });
      return;
    }
    const err = d.signal.aborted ? new AiError("invalid", "cancelled") : toAiError(e);
    d.emit({ type: "error", stage: "plan", code: err.code, message: err.message });
  }
}
