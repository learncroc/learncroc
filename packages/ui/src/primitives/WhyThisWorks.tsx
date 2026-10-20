import { Info } from "@phosphor-icons/react";
import { useState } from "react";
import { Popover } from "./Popover";

export interface WhyThisWorksProps {
  /** "Guess first", "Relight", "Teach", "Placement" … */
  title: string;
  /** One line of explanation. */
  line: string;
  /** The honesty label. */
  evidence: "strong" | "moderate" | "weak (theory)" | "experimental" | "craft";
  citation: string;
  href?: string;
}

const EVIDENCE_COPY: Record<WhyThisWorksProps["evidence"], string> = {
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  "weak (theory)": "Weak evidence (theory)",
  experimental: "Experimental, not independently tested",
  craft: "Design craft, not research",
};

/** The (i) chip next to Guess first, Relight, Teach and Placement: one line, the honesty label, the citation. */
export function WhyThisWorks({ title, line, evidence, citation, href }: WhyThisWorksProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={`Why ${title} works`}
      anchor={
        <button
          type="button"
          aria-label={`Why this works: ${title}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-micro text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <Info size={14} aria-hidden />
          Why this works
        </button>
      }
    >
      <p className="text-small font-semibold">{title}</p>
      <p className="mt-1 text-small text-ink-2">{line}</p>
      <p className="mt-3 text-micro text-ink-2">
        {EVIDENCE_COPY[evidence]}.{" "}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {citation}
          </a>
        ) : (
          citation
        )}
      </p>
    </Popover>
  );
}
