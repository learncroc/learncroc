/**
 * Shared bits of the card and checkpoint modal shells: the wide-layout switch (Moss's column at
 * ≥ 1280 px), the text "Back to map" button and the animated close for buttons inside the modal.
 */
import { Kbd, useModal } from "@learncroc/ui";
import { type ReactNode, useEffect, useState } from "react";

export function useWide(min = 1280): boolean {
  const get = () => typeof window !== "undefined" && window.innerWidth >= min;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const on = () => setWide(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  });
  return wide;
}

/** The header's text close button: plays the modal's close, then `onClose` (no X anywhere). */
export function BackToMap() {
  const { requestClose } = useModal();
  return (
    <button
      type="button"
      onClick={requestClose}
      className="flex shrink-0 items-center gap-2 rounded-sm px-2 py-1 text-small text-ink-2 hover:bg-surface hover:text-ink"
      data-back-to-map
    >
      Back to map <Kbd keys="Esc" />
    </button>
  );
}

/** A "Back to map" / "Not now" action inside the modal body. */
export function useCloseModal(): () => void {
  return useModal().requestClose;
}

/** The modal's animated close, for buttons inside it ("Back to map" at the close). */
export function WithModalClose({ children }: { children: (close: () => void) => ReactNode }) {
  return <>{children(useModal().requestClose)}</>;
}
