/**
 * /settings/:section: AI (the AI panel), Appearance, Learning (Relight size,
 * target memory, credit flows down, reminder), Moss (reactions: Chatty / Quiet), Sound, Data (export,
 * import, reset, Your numbers), Keyboard and About. Changes save as you make them (PATCH /settings,
 * optimistic). There is no Find my level, no Sparked pill and no guess-gate switch.
 */
import {
  CROC_NAME,
  type ExportFile,
  LEARNCROC_VERSION,
  LOCAL_NUMBER_EXPLAIN,
  type LocalNumbers,
  type Settings,
  type SettingsPatch,
} from "@learncroc/core";
import {
  AnswerKey,
  Button,
  Croc,
  CrocBubble,
  cn,
  Dialog,
  Kbd,
  Segmented,
  StatePill,
  Switch,
  toast,
  WhyThisWorks,
} from "@learncroc/ui";
import { ArrowSquareOut, CalendarPlus, Copy, DownloadSimple, SpeakerHigh, UploadSimple } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { api } from "../../api/client";
import { DOCTOR_COMMAND, REPO_URL } from "../../app/demo";
import { downloadFile, fileDate } from "../../app/download";
import { errorText } from "../../app/errors";
import { globalShortcutGroups } from "../../app/keys";
import { useHealth, useNumbers, usePacks, usePatchSettings, useSettings } from "../../app/queries";
import { Page, ScreenHeader } from "../../app/ScreenHeader";
import { useSound } from "../../app/sound";
import { useShell } from "../../app/store";
import { modKey } from "../../lib/keys";
import { AiSettingsPanel } from "../../slots";

export const SETTINGS_SECTIONS = [
  "ai",
  "appearance",
  "learning",
  "moss",
  "sound",
  "data",
  "keyboard",
  "about",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SECTION_LABEL: Record<SettingsSection, string> = {
  ai: "AI",
  appearance: "Appearance",
  learning: "Learning",
  moss: CROC_NAME,
  sound: "Sound",
  data: "Data",
  keyboard: "Keyboard",
  about: "About",
};

/** Old links (`/settings/experiments`) land on the section that took the setting over. */
const SECTION_ALIAS: Record<string, SettingsSection> = { experiments: "learning", croc: "moss" };

const isSection = (s: unknown): s is SettingsSection => SETTINGS_SECTIONS.includes(s as SettingsSection);

export function SettingsScreen() {
  const { section } = useParams({ strict: false });
  const settings = useSettings();
  const patch = usePatchSettings();
  const current = isSection(section) ? section : (SECTION_ALIAS[String(section)] ?? null);

  const onChange = (p: SettingsPatch) =>
    patch.mutate(p, {
      onError: (err) => toast({ tone: "ember", message: `Couldn't save that setting: ${errorText(err)}` }),
    });

  const onNavKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a")];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    e.preventDefault();
    const next = links[(i + (e.key === "ArrowDown" ? 1 : links.length - 1)) % links.length];
    next?.focus();
    next?.click();
  };

  return (
    <Page>
      <ScreenHeader title="Settings" />
      <div className="grid grid-cols-12 gap-8">
        <nav aria-label="Settings sections" className="col-span-12 md:col-span-3">
          <ul className="sticky top-6 grid gap-0.5" onKeyDown={onNavKey}>
            {SETTINGS_SECTIONS.map((s) => (
              <li key={s}>
                <Link
                  to="/settings/$section"
                  params={{ section: s }}
                  aria-current={s === current ? "page" : undefined}
                  className={cn(
                    "relative block rounded-sm px-3 py-2 text-body transition-colors duration-quick",
                    s === current
                      ? "bg-surface font-semibold text-ink shadow-1 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-pill before:bg-ink dark:bg-surface-2"
                      : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {SECTION_LABEL[s]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-labelledby="settings-section" className="col-span-12 md:col-span-9 lg:col-span-7">
          {current === null ? (
            <>
              <h2 id="settings-section" className="text-heading">
                No such section
              </h2>
              <p className="mt-2 text-body text-ink-2">Pick one from the list.</p>
            </>
          ) : settings.isError ? (
            <>
              <h2 id="settings-section" className="text-heading">
                {SECTION_LABEL[current]}
              </h2>
              <p role="alert" className="mt-2 text-body text-ember-text">
                Couldn't load your settings ({errorText(settings.error)}).
              </p>
            </>
          ) : settings.data ? (
            <>
              <h2 id="settings-section" className="t-heading mb-6 text-ink">
                {SECTION_LABEL[current]}
              </h2>
              <SectionBody section={current} settings={settings.data} onChange={onChange} />
            </>
          ) : (
            <h2 id="settings-section" className="text-heading">
              {SECTION_LABEL[current]}
            </h2>
          )}
        </section>
      </div>
    </Page>
  );
}

function SectionBody({
  section,
  settings,
  onChange,
}: {
  section: SettingsSection;
  settings: Settings;
  onChange: (p: SettingsPatch) => void;
}) {
  switch (section) {
    case "ai":
      return <AiSettingsPanel settings={settings} onChange={onChange} />;
    case "appearance":
      return <AppearanceSection settings={settings} onChange={onChange} />;
    case "learning":
      return <LearningSection settings={settings} onChange={onChange} />;
    case "sound":
      return <SoundSection settings={settings} onChange={onChange} />;
    case "moss":
      return <MossSection settings={settings} onChange={onChange} />;
    case "data":
      return <DataSection />;
    case "keyboard":
      return <KeyboardSection />;
    case "about":
      return <AboutSection />;
  }
}

// ── Layout helpers ───────────────────────────────────────────────────────────────

function Rows({ children }: { children: ReactNode }) {
  return (
    <div className="grid divide-y divide-line rounded-md border border-line bg-surface px-5 shadow-1 dark:shadow-[var(--inset-dark)] [&>*]:py-5">
      {children}
    </div>
  );
}

function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
      <div className="min-w-0 max-w-[46ch]">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-body text-ink">
            {label}
          </label>
        ) : (
          <p className="text-body text-ink">{label}</p>
        )}
        {description ? <p className="mt-0.5 text-small text-ink-2">{description}</p> : null}
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

function Range({
  id,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const [local, setLocal] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setLocal(value);
  }
  return (
    <>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        aria-valuetext={format(local)}
        onChange={(e) => setLocal(Number(e.currentTarget.value))}
        onPointerUp={() => local !== value && onChange(local)}
        onKeyUp={() => local !== value && onChange(local)}
        onBlur={() => local !== value && onChange(local)}
        className="w-48 accent-[var(--sea)]"
      />
      <output htmlFor={id} className="w-14 text-right tabular text-small text-ink">
        {format(local)}
      </output>
    </>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────────

function AppearanceSection({ settings, onChange }: { settings: Settings; onChange: (p: SettingsPatch) => void }) {
  const a = settings.appearance;
  const scaleId = useId();
  return (
    <div className="grid gap-6">
      <Rows>
        <Row label="Theme" description="System follows your computer. Maps keep their own ground either way.">
          <Segmented
            label="Theme"
            value={a.theme}
            onChange={(theme) => onChange({ appearance: { theme } })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>
        <Switch
          checked={a.font === "atkinson"}
          onChange={(v) => onChange({ appearance: { font: v ? "atkinson" : "recursive" } })}
          label="Easier-to-read font"
          description="Atkinson Hyperlegible, designed to keep similar letters apart."
        />
        <Row label="Text size" htmlFor={scaleId}>
          <Range
            id={scaleId}
            value={a.textScale}
            min={0.9}
            max={1.5}
            step={0.05}
            onChange={(textScale) => onChange({ appearance: { textScale } })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row
          label="Reduce motion"
          description="On: no travel or breathing, quick fades instead. Nothing that carries meaning is removed."
        >
          <Segmented
            label="Reduce motion"
            value={a.reducedMotion}
            onChange={(reducedMotion) => onChange({ appearance: { reducedMotion } })}
            options={[
              { value: "system", label: "System" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </Row>
        <Switch
          checked={a.contrast === "more"}
          onChange={(v) => onChange({ appearance: { contrast: v ? "more" : "normal" } })}
          label="More contrast"
          description="Stronger lines and darker secondary text."
        />
        <Row label="Map labels" description="Always, or only for ready cards and checkpoints until you zoom in.">
          <Segmented
            label="Map labels"
            value={a.mapLabels}
            onChange={(mapLabels) => onChange({ appearance: { mapLabels } })}
            options={[
              { value: "zoom", label: "On zoom" },
              { value: "always", label: "Always" },
            ]}
          />
        </Row>
      </Rows>
      <Preview />
    </div>
  );
}

/** A small live preview of the controls and the card and gate states in the current appearance. */
function Preview() {
  return (
    <figure className="rounded-md border border-dashed border-line-strong p-5">
      <figcaption className="mb-4 text-small text-ink-2">Preview</figcaption>
      <p className="voice-guide max-w-[40ch] text-ink">
        A train at half light speed turns on its headlight. How fast is the light, seen from the platform?
      </p>
      <div className="mt-4 grid max-w-md gap-3">
        <AnswerKey n={1} onPress={() => {}}>
          Half light speed
        </AnswerKey>
        <AnswerKey n={2} state="selected" onPress={() => {}}>
          Light speed
        </AnswerKey>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {(["locked", "ready", "in-progress", "done", "lit", "fading"] as const).map((s) => (
          <StatePill key={s} state={s} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["locked", "lit"] as const).map((s) => (
          <StatePill key={s} kind="checkpoint" state={s} />
        ))}
      </div>
    </figure>
  );
}

function LearningSection({ settings, onChange }: { settings: Settings; onChange: (p: SettingsPatch) => void }) {
  const l = settings.learning;
  const retentionId = useId();
  const timeId = useId();
  const calendar = async () => {
    try {
      const ics = await api.getRelightCalendar({ time: l.reminder.time });
      downloadFile("learncroc-relight.ics", ics, "text/calendar;charset=utf-8");
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't make the calendar file: ${errorText(err)}` });
    }
  };
  return (
    <Rows>
      <Row label="Relight size" description="How many questions a Relight asks. 8 is about five minutes.">
        <Segmented
          label="Relight size"
          value={l.dailyRelight}
          onChange={(dailyRelight) => onChange({ learning: { dailyRelight } })}
          options={[
            { value: 5, label: "5" },
            { value: 8, label: "8" },
            { value: 12, label: "12" },
          ]}
        />
      </Row>
      <Row
        label="Target memory"
        htmlFor={retentionId}
        description="How sure you want to be of remembering a card when it comes back. Higher means more frequent relights."
      >
        <Range
          id={retentionId}
          value={l.targetRetention}
          min={0.85}
          max={0.95}
          step={0.01}
          onChange={(targetRetention) => onChange({ learning: { targetRetention } })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Row>
      <div className="grid gap-3">
        <Switch
          checked={settings.experiments.creditFlowsDown}
          onChange={(v) => onChange({ experiments: { creditFlowsDown: v } })}
          label="Credit flows down (experimental)"
          description="Relighting a later card also refreshes the cards it builds on a little. This is unproven, so it's off by default."
        />
        <WhyThisWorks
          title="Credit flows down"
          line="Reviewing a later idea partly reviews the ideas it builds on. Promising, but nobody has tested it independently yet."
          evidence="experimental"
          citation="Math Academy's FIRe (Skycak)"
        />
      </div>
      <div className="grid gap-4">
        <Switch
          checked={l.reminder.enabled}
          onChange={(enabled) => onChange({ learning: { reminder: { ...l.reminder, enabled } } })}
          label="Daily reminder"
          description="One quiet notification from your computer at a time you choose. No counts, no streaks."
        />
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={timeId} className="text-small text-ink-2">
            At
          </label>
          <input
            id={timeId}
            type="time"
            value={l.reminder.time}
            onChange={(e) => {
              const time = e.currentTarget.value;
              if (/^\d{2}:\d{2}$/.test(time)) onChange({ learning: { reminder: { ...l.reminder, time } } });
            }}
            className="h-9 rounded-sm border border-line-strong bg-surface px-2 text-small text-ink tabular"
          />
          <Button size="sm" variant="ghost" icon={<CalendarPlus size={16} />} onClick={() => void calendar()}>
            Add to my calendar instead (.ics)
          </Button>
        </div>
      </div>
    </Rows>
  );
}

function SoundSection({ settings, onChange }: { settings: Settings; onChange: (p: SettingsPatch) => void }) {
  const s = settings.sound;
  const sound = useSound();
  const volId = useId();
  return (
    <div className="grid gap-6">
      <Rows>
        <Switch
          checked={s.enabled}
          onChange={(enabled) => onChange({ sound: { enabled } })}
          label="Sound"
          description="A wooden tok for a right answer, a curious hm for a missed guess, a soft knock when a card closes, a low chord when a gate opens. Never a buzzer."
        />
        <Row label="Volume" htmlFor={volId}>
          <Range
            id={volId}
            value={s.volume}
            min={0}
            max={1}
            step={0.05}
            onChange={(volume) => onChange({ sound: { volume } })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row label="Try them" description={s.enabled ? undefined : "Turn sound on to hear them."}>
          {(
            [
              ["tok", "Right answer"],
              ["hm", "Missed guess"],
              ["done", "Card closed"],
              ["gate", "Gate opens"],
            ] as const
          ).map(([cue, label]) => (
            <Button
              key={cue}
              size="sm"
              variant="secondary"
              disabled={!s.enabled}
              icon={<SpeakerHigh size={16} />}
              onClick={() => sound.play(cue)}
            >
              {label}
            </Button>
          ))}
        </Row>
      </Rows>
      <p className="text-small text-ink-3">
        Sound is design craft, not research: it's here because it feels good, not because it teaches.
      </p>
    </div>
  );
}

function DataSection() {
  const qc = useQueryClient();
  const health = useHealth();
  const packs = usePacks();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ExportFile | null>(null);
  const [resetPack, setResetPack] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const confirmId = useId();
  const resetTitle = packs.data?.find((p) => p.id === resetPack)?.title ?? resetPack;

  const exportAll = async () => {
    try {
      const file = await api.exportData();
      downloadFile(
        `learncroc-export-${fileDate(Date.parse(file.exportedAt) || Date.now())}.json`,
        JSON.stringify(file, null, 2),
        "application/json",
      );
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't export: ${errorText(err)}` });
    }
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      // Version 1 files (earlier releases) are upgraded by the server, so only the envelope is checked here.
      const raw = JSON.parse(await f.text()) as Omit<Partial<ExportFile>, "version"> & { version?: number };
      if (raw?.format !== "learncroc-export" || (raw.version !== 1 && raw.version !== 2) || !raw.exportedAt) {
        toast({
          tone: "ember",
          message: "That file isn't a Learncroc export (a JSON file from Settings → Data → Export).",
        });
        return;
      }
      setPending(raw as unknown as ExportFile);
    } catch {
      toast({ tone: "ember", message: "That file isn't valid JSON, so it can't be imported." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = async (file: ExportFile) => {
    setPending(null);
    try {
      const res = await api.importData(file);
      const n = Object.values(res.counts).reduce((a, b) => a + b, 0);
      toast({ tone: "done", message: `Imported ${n} records.` });
      await qc.invalidateQueries();
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't import: ${errorText(err)}` });
    }
  };

  const doReset = async () => {
    setResetOpen(false);
    try {
      await api.resetPack({ packId: resetPack }, { confirm: resetPack });
      toast({ tone: "done", message: `Reset ${resetTitle}. Its map starts fresh.` });
      setResetPack("");
      await qc.invalidateQueries();
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't reset: ${errorText(err)}` });
    }
  };

  return (
    <div className="grid gap-8">
      <Rows>
        <Row
          label="Data folder"
          description="Everything lives on this computer. Nothing is sent anywhere unless you add an AI key."
        >
          <code className="voice-mono rounded-xs bg-surface-sunk px-2 py-1 text-small text-ink">
            {health.data?.home ?? "~/.learncroc"}
          </code>
        </Row>
        <Row
          label="Export everything"
          description="Progress, flashcards, your numbers and settings as one JSON file. Your AI key is never included."
        >
          <Button icon={<DownloadSimple size={16} />} onClick={() => void exportAll()}>
            Export
          </Button>
        </Row>
        <Row label="Import" description="Load an export from this or another computer. Matching records are replaced.">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => void pickFile(e.currentTarget.files?.[0])}
          />
          <Button icon={<UploadSimple size={16} />} onClick={() => fileRef.current?.click()}>
            Choose a file
          </Button>
        </Row>
        <Row
          label="Reset a map's progress"
          description="Clears its cards' progress, flashcards and notes. You'll be asked to type the map's id."
        >
          <select
            aria-label="Map to reset"
            value={resetPack}
            onChange={(e) => setResetPack(e.currentTarget.value)}
            className="h-10 rounded-sm border border-line-strong bg-surface px-2 text-small text-ink"
          >
            <option value="">Choose a map</option>
            {(packs.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <Button
            disabled={!resetPack}
            onClick={() => {
              setConfirmText("");
              setResetOpen(true);
            }}
          >
            Reset
          </Button>
        </Row>

        <Dialog
          open={pending !== null}
          onClose={() => setPending(null)}
          title="Import this export?"
          description={
            pending
              ? `Exported ${pending.exportedAt.slice(0, 10)}. Matching progress, flashcards and notes here are replaced.`
              : undefined
          }
          actions={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => pending && void doImport(pending)}>
                Import
              </Button>
            </>
          }
        />
        <Dialog
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          role="alertdialog"
          title={`Reset ${resetTitle}?`}
          description="This map's card progress, flashcards and notes are deleted. Its map starts fresh. This can't be undone."
          actions={
            <>
              <Button variant="ghost" onClick={() => setResetOpen(false)}>
                Keep my progress
              </Button>
              <Button variant="primary" disabled={confirmText !== resetPack} onClick={() => void doReset()}>
                Reset
              </Button>
            </>
          }
        >
          <label htmlFor={confirmId} className="text-small text-ink-2">
            Type <code className="voice-mono text-ink">{resetPack}</code> to confirm
          </label>
          <input
            id={confirmId}
            value={confirmText}
            onChange={(e) => setConfirmText(e.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            className="voice-mono mt-1.5 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-body text-ink"
          />
        </Dialog>
      </Rows>
      <YourNumbers />
    </div>
  );
}

function AboutSection() {
  const health = useHealth();
  const openLayer = useShell((s) => s.open);
  return (
    <div className="grid gap-6">
      <Rows>
        <Row label="Version">
          <span className="tabular text-body text-ink">{health.data?.version ?? LEARNCROC_VERSION}</span>
        </Row>
        <Row label="Check your setup" description="Run this in a terminal; paste its output into bug reports.">
          <code className="voice-mono rounded-xs bg-surface-sunk px-2 py-1 text-small text-ink">{DOCTOR_COMMAND}</code>
        </Row>
        <Row label="Keyboard shortcuts">
          <Button size="sm" onClick={() => openLayer("shortcuts")} kbd="?">
            Show
          </Button>
        </Row>
        <Row label="License" description="The app is MIT. Maps carry their own Creative Commons license.">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-body text-ink underline underline-offset-2"
          >
            Source code
            <ArrowSquareOut size={14} aria-hidden />
          </a>
        </Row>
      </Rows>
      <p className="max-w-[62ch] text-small text-ink-2">
        No account, no telemetry. Learncroc is open source and local-first: your progress stays in your data folder.
      </p>
    </div>
  );
}

function MossSection({ settings, onChange }: { settings: Settings; onChange: (p: SettingsPatch) => void }) {
  const chatty = settings.croc.reactions === "chatty";
  return (
    <div className="grid gap-6">
      <Rows>
        <Row
          label="Reactions"
          description={`Quiet keeps ${CROC_NAME} on screen, but ${CROC_NAME} only speaks when you ask. Chat and the buttons work either way.`}
        >
          <Segmented
            label="Reactions"
            value={settings.croc.reactions}
            onChange={(reactions) => onChange({ croc: { reactions } })}
            options={[
              { value: "chatty", label: "Chatty" },
              { value: "quiet", label: "Quiet" },
            ]}
          />
        </Row>
      </Rows>
      <figure className="flex items-end gap-4 rounded-md border border-dashed border-line-strong p-5">
        <Croc size={72} state={chatty ? "happy" : "idle"} title={CROC_NAME} />
        <div className="grid gap-2">
          {chatty ? (
            <CrocBubble tail="left">Locked in. Let's see.</CrocBubble>
          ) : (
            <p className="text-small text-ink-2">{CROC_NAME} stays quiet until you ask.</p>
          )}
          <figcaption className="text-small text-ink-3">
            {CROC_NAME} is an old river croc: never in a hurry, never keeping score. One short line at most per moment,
            never while you type, never on idle.
          </figcaption>
        </div>
      </figure>
    </div>
  );
}

function KeyboardSection() {
  const openLayer = useShell((s) => s.open);
  const groups = globalShortcutGroups(modKey());
  return (
    <div className="grid gap-6">
      <Rows>
        {groups.map((g) => (
          <div key={g.title} className="grid gap-2">
            <p className="text-small font-semibold text-ink-2">{g.title}</p>
            <dl className="grid gap-1.5">
              {g.items.map((it) => (
                <div key={it.label} className="flex items-center justify-between gap-4 text-small">
                  <dt className="text-ink">{it.label}</dt>
                  <dd>
                    <Kbd keys={it.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <Row
          label="Shortcuts for the screen you're on"
          description="Single keys never fire while you're typing in a field."
        >
          <Button size="sm" onClick={() => openLayer("shortcuts")} kbd="?">
            Show
          </Button>
        </Row>
      </Rows>
    </div>
  );
}

/** One row's value for Your numbers (plain words, no scores). */
export function numberValue(key: keyof typeof LOCAL_NUMBER_EXPLAIN, n: LocalNumbers): string {
  const pct = (a: number, b: number) => (b > 0 ? ` (${Math.round((a / b) * 100)}%)` : "");
  switch (key) {
    case "nextDayExplain":
      return n.nextDayExplain.asked
        ? `${n.nextDayExplain.right} of ${n.nextDayExplain.asked}${pct(n.nextDayExplain.right, n.nextDayExplain.asked)}`
        : "None asked yet";
    case "checkpointFirstTry":
      return n.checkpointFirstTry.attempted
        ? `${n.checkpointFirstTry.passedFirstTry} of ${n.checkpointFirstTry.attempted}${pct(n.checkpointFirstTry.passedFirstTry, n.checkpointFirstTry.attempted)}`
        : "No checkpoints yet";
    case "maps":
      return n.maps.started ? `${n.maps.finished} of ${n.maps.started}` : "None started yet";
    case "cameBack":
      return n.cameBack.activeDays
        ? `${n.cameBack.returned} of ${n.cameBack.activeDays} days${pct(n.cameBack.returned, n.cameBack.activeDays)}`
        : "No days yet";
    case "linkToFirstCard":
      return n.linkToFirstCard.medianSec !== null
        ? `${Math.round(n.linkToFirstCard.medianSec)} s (median of ${n.linkToFirstCard.samples})`
        : "No article maps built yet";
    case "cardCompletion":
      return n.cardCompletion.opened
        ? `${n.cardCompletion.closed} of ${n.cardCompletion.opened}${pct(n.cardCompletion.closed, n.cardCompletion.opened)}`
        : "No cards opened yet";
    case "cardMinutes":
      return n.cardMinutes.median !== null
        ? `${n.cardMinutes.median.toFixed(1)} min (median of ${n.cardMinutes.samples})`
        : "Not enough cards yet";
    case "workedAnswers":
      return n.workedAnswers.beats ? `${n.workedAnswers.needed} of ${n.workedAnswers.beats}` : "None yet";
    case "mostMissed":
      return n.mostMissed.length
        ? n.mostMissed
            .slice(0, 3)
            .map((m) => `${m.nodeId} · ${m.itemId}: ${m.missed} of ${m.asked}`)
            .join("; ")
        : "None missed yet";
    case "checkpointHints":
      return n.checkpointHints.questions
        ? `${n.checkpointHints.hinted} of ${n.checkpointHints.questions} questions`
        : "No checkpoint questions yet";
    case "crocAsks":
      return `${n.crocAsks.chips} from the buttons · ${n.crocAsks.freeText} typed`;
    case "relightPerWeek":
      return n.relightPerWeek.weeks && n.relightPerWeek.sessions
        ? `${(n.relightPerWeek.sessions / n.relightPerWeek.weeks).toFixed(1)} a week`
        : "No Relights yet";
  }
}

/** Settings → Data → Your numbers: computed here, shown here, copied only if you choose. */
function YourNumbers() {
  const numbers = useNumbers();
  const copy = async () => {
    if (!numbers.data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(numbers.data, null, 2));
      toast({ tone: "done", message: "Copied your numbers as JSON." });
    } catch {
      toast({ tone: "ember", message: "Couldn't copy: the browser refused the clipboard." });
    }
  };
  const keys = Object.keys(LOCAL_NUMBER_EXPLAIN) as (keyof typeof LOCAL_NUMBER_EXPLAIN)[];
  return (
    <section aria-labelledby="your-numbers" className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="your-numbers" className="t-heading text-ink">
            Your numbers
          </h3>
          <p className="mt-1 text-small text-ink-2">These numbers never leave this computer.</p>
        </div>
        <Button size="sm" icon={<Copy size={16} />} disabled={!numbers.data} onClick={() => void copy()}>
          Copy as JSON
        </Button>
      </div>
      {numbers.isError ? (
        <p className="rounded-md border border-line bg-surface p-5 text-body text-ink-2">
          Your numbers aren't available yet ({errorText(numbers.error)}).{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void numbers.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface shadow-1 dark:shadow-[var(--inset-dark)]">
          <table className="w-full border-collapse text-left text-small">
            <caption className="sr-only">Your numbers, computed on this computer</caption>
            <thead className="bg-surface-2 text-micro text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2 font-normal">
                  What
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  Yours
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {keys.map((k) => (
                <tr key={k}>
                  <th scope="row" className="px-4 py-3 align-top font-normal text-ink">
                    {LOCAL_NUMBER_EXPLAIN[k]}
                  </th>
                  <td className="tabular px-4 py-3 align-top text-ink-2">
                    {numbers.data ? numberValue(k, numbers.data) : "…"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
