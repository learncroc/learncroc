import type { Confidence } from "@learncroc/core";
import { useId } from "react";
import { cn } from "../cn";

export interface ConfidenceTapProps {
  value?: Confidence;
  onChange: (value: Confidence) => void;
  disabled?: boolean;
}

const OPTIONS: { value: Confidence; label: string }[] = [
  { value: 3, label: "Sure" },
  { value: 2, label: "Think so" },
  { value: 1, label: "Guessing" },
];

/** "How sure?" before checking: sure / think so / guessing. Native radios (arrow keys work) styled as a segmented row. */
export function ConfidenceTap({ value, onChange, disabled }: ConfidenceTapProps) {
  const name = useId();
  return (
    <fieldset className="flex items-center gap-3 disabled:opacity-50" disabled={disabled}>
      <legend className="sr-only">How sure are you?</legend>
      <span aria-hidden className="text-small text-ink-2">
        How sure?
      </span>
      <span className="inline-flex rounded-sm border border-line-strong bg-surface-2 p-0.5">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={cn(
              "cursor-pointer rounded-xs px-3 py-1 text-small transition-colors duration-quick",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus",
              value === o.value ? "bg-ink text-bg" : "text-ink-2 hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}
