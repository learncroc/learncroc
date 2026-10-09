/** Structural type equality helpers for the contract tests. */

/**
 * Flattens intersections and normalises nested objects, function signatures and promises so that
 * `A & B` compares equal to the merged object and interfaces compare equal to inferred object types.
 */
export type Norm<T> =
  T extends Promise<infer U>
    ? Promise<Norm<U>>
    : T extends (...args: infer A) => infer R
      ? (...args: { [K in keyof A]: Norm<A[K]> }) => Norm<R>
      : T extends object
        ? { [K in keyof T]: Norm<T[K]> }
        : T;

/** Exact type identity (distinguishes optional vs required, any vs unknown). */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type Same<A, B> = Equal<Norm<A>, Norm<B>>;
