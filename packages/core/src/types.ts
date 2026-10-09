/**
 * Inferred TypeScript types for every schema in ./schema (z.infer). Import types from here
 * (or from "@learncroc/core") when you don't need the runtime schema.
 */

export type { ApiRoutes, RouteKey } from "./api";
export type { AiPorts, WidgetSpec, WidgetSpecRegistry } from "./ports";
export type { Clock, PackSource, Repo } from "./repo";
export type * from "./schema/index";

/** Omit that distributes over unions. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
