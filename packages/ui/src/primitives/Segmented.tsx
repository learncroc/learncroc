import { useId } from "react";
import { cn } from "../cn";

export interface SegmentedProps<T extends string | number> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Accessible group name (the visible label usually sits beside it). */
  label: string;
  disabled?: boolean;
}

/** A small set of exclusive choices as a segmented control (native radios: arrow keys move). */
export function Segmented<T extends string | number>({ value, options, onChange, label, disabled }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset
      disabled={disabled}
      className="inline-flex rounded-sm border border-line-strong bg-surface-2 p-0.5 disabled:opacity-50"
    >
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={String(o.value)}
          className={cn(
            "cursor-pointer rounded-xs px-3 py-1 text-small whitespace-nowrap transition-colors duration-quick",
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
    </fieldset>
  );
}
