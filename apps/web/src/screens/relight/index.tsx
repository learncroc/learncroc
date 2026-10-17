import { useSearch } from "@tanstack/react-router";
import { RelightRunner } from "../../run/RelightRunner";

/** /relight (?pack=) — Relight: mixed questions across packs that bring fading stops back. */
export function RelightScreen() {
  const search = useSearch({ strict: false }) as { pack?: string };
  return <RelightRunner key={search.pack ?? "*"} {...(search.pack ? { packId: search.pack } : {})} />;
}
