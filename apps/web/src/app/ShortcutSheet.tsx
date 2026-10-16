/** The shortcut sheet (`?`): global keys plus whatever the current screen registered. */
import { Button, Dialog, Kbd } from "@learncroc/ui";
import { modKey } from "../lib/keys";
import { globalShortcutGroups } from "./keys";
import { useShell } from "./store";

export function ShortcutSheet() {
  const open = useShell((s) => s.layer === "shortcuts");
  const close = useShell((s) => s.close);
  const screen = useShell((s) => s.screenShortcuts);
  if (!open) return null;
  const groups = [...Object.values(screen), ...globalShortcutGroups(modKey())];
  return (
    <Dialog
      open
      onClose={close}
      title="Keyboard shortcuts"
      description="Single keys never fire while you're typing in a field."
      className="max-w-2xl"
      actions={
        <Button variant="secondary" onClick={close} kbd="Esc">
          Close
        </Button>
      }
    >
      <div className="grid max-h-[60vh] gap-6 overflow-y-auto pr-1 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3 className="mb-2 text-small font-semibold text-ink-2">{g.title}</h3>
            <dl className="grid gap-1.5">
              {g.items.map((it) => (
                <div key={`${g.title}-${it.label}`} className="flex items-center justify-between gap-4 text-small">
                  <dt className="text-ink">{it.label}</dt>
                  <dd>
                    <Kbd keys={it.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
