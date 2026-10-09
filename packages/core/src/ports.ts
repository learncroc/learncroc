/**
 * Injected seams. Core never imports packages/ai or packages/widgets:
 * the server, the static demo and the CLI pass implementations in.
 */
import type { ZodType } from "zod";
import type {
  AnswerValue,
  CompiledPack,
  ExplainGrade,
  GradeResult,
  Item,
  ItemId,
  KeyPoint,
  Markdown,
  NodeId,
  WidgetId,
} from "./schema/index";

/** AI seam. createServer({ home, port, ai }) receives the real implementation from packages/ai. */
export interface AiPorts {
  configured(): Promise<boolean>;
  gradeExplain(a: {
    pack: CompiledPack;
    nodeId: NodeId;
    target: ItemId;
    keyPoints: KeyPoint[];
    minHits: number;
    text: string;
    runId: string;
  }): Promise<ExplainGrade | null>;
  rewriteHint(a: {
    pack: CompiledPack;
    nodeId: NodeId;
    interactionId: ItemId;
    answer: AnswerValue;
    authoredHint: Markdown;
    level: 0 | 1 | 2 | 3;
    runId: string;
  }): Promise<Markdown | null>;
  /** Fresh checkpoint items when a bank runs dry (may stay unused). */
  quizVariants(a: {
    pack: CompiledPack;
    nodeIds: NodeId[];
    count: number;
  }): Promise<(Item & { nodeId: NodeId })[] | null>;
}

/** Every method resolves null; configured() resolves false. Callers then take the offline path. */
export const offlineAiPorts: AiPorts = {
  configured: async () => false,
  gradeExplain: async () => null,
  rewriteHint: async () => null,
  quizVariants: async () => null,
};

/**
 * packages/widgets/src/<id>/spec.ts — NO React imports. Exported from "@learncroc/widgets/spec".
 */
export interface WidgetSpec<P, G, A> {
  id: WidgetId;
  version: 1;
  title: string;
  family: "llm" | "generic" | "physics" | "language" | "code";
  /** For authors and the AI catalogue. */
  description: string;
  llmDoc: { useWhen: string; notFor: string; learnerDoes: string; reports: string };
  props: ZodType<P>;
  /** null = explore-only widget (allowed in v0.1). */
  goal: ZodType<G> | null;
  answer: ZodType<A>;
  /** Semantic checks; [] = ok. */
  validate(props: P, goal?: G): string[];
  /** Pure, sync. */
  grade(args: { props: P; goal: G; answer: A }): GradeResult;
  initialAnswer(props: P): A;
  /** Screen-reader description of what it shows. */
  textAlternative(props: P): string;
  /** Plain-text rendering (AI context, terminal relight). */
  toText(props: P, answer?: A): string;
  /** Props for explore mode (opened ranges); default identity. */
  explore?(props: P): P;
  /** ≥ 2; replayed across releases. */
  examples: { note: string; props: P; goal: G; correctAnswer: A; wrongAnswer: A }[];
}

/** Injected into core lint/grading/services (core never imports widgets). */
export interface WidgetSpecRegistry {
  get(id: WidgetId): WidgetSpec<unknown, unknown, unknown> | undefined;
}
