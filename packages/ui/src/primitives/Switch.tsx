import { useId } from "react";
import { cn } from "../cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** One line under the label. */
  description?: string;
  disabled?: boolean;
}

/** An on/off setting: a real checkbox with role="switch", label on the left, track on the right. */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-6", disabled && "opacity-50")}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-body">{label}</span>
        {description ? <span className="mt-0.5 block text-small text-ink-2">{description}</span> : null}
      </label>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.checked)}
          className="peer h-6 w-11 cursor-pointer appearance-none rounded-pill border-[1.5px] border-ink-3 bg-surface-sunk transition-colors duration-quick checked:border-sea-text checked:bg-sea disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 left-1 size-4 rounded-pill bg-ink-2 transition-transform duration-quick ease-out peer-checked:translate-x-5 peer-checked:bg-surface"
        />
      </span>
    </div>
  );
}
