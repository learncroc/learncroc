/**
 * Settings → AI: pick a provider (listed side by side, no ranking), add or test a key,
 * choose models per tier, which tier Moss uses, the monthly cap with the spend meter and "What did I
 * send?". Learncroc works fully without any of this. Moss always follows the moment on the server
 * (hints before a guess and during a checkpoint), so there is no guess-gate switch.
 */

import { suggestLocalModels } from "@learncroc/ai/models";
import { CROC_NAME, type ModelTier, PROVIDER_PRESETS, type ProviderId, type Settings } from "@learncroc/core";
import { Button, cn, Panel } from "@learncroc/ui";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { api } from "../api/client";
import { ApiClientError } from "../api/errors";
import { queryKeys } from "../api/hooks";
import type { AiSettingsPanelProps } from "../slots";
import { useAiStatusQuery } from "./status";

const PROVIDER_BLURB: Record<Exclude<ProviderId, "none">, string> = {
  anthropic: "Claude models with your Anthropic API key.",
  ollama: "Free models running on this computer. Nothing leaves your machine.",
  "openai-compatible": "OpenAI, OpenRouter, LM Studio, vLLM or llama.cpp, by URL.",
};
const TIER_LABEL: Record<ModelTier, { title: string; help: string }> = {
  fast: { title: "Fast", help: "Card writing, hints, checks" },
  smart: { title: "Smart", help: `${CROC_NAME}'s chat and planning maps` },
  deep: { title: "Deep", help: "Optional, for authoring maps" },
};
const DEFAULT_OLLAMA = "http://127.0.0.1:11434";

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-line pt-5">
      <h3 id={id} className="m-0 t-heading text-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ProviderPicker({ settings, onChange, ollamaDetected }: AiSettingsPanelProps & { ollamaDetected: boolean }) {
  const current = settings.ai.provider;
  const options: { id: ProviderId; label: string; blurb: string }[] = [
    ...PROVIDER_PRESETS.map((p) => ({ id: p.id, label: p.label, blurb: PROVIDER_BLURB[p.id] })),
    { id: "none", label: "No AI", blurb: "Everything works offline: written hints, checkpoints, the gallery." },
  ];
  return (
    <fieldset className="m-0 grid grid-cols-1 gap-3 border-0 p-0 md:grid-cols-2 xl:grid-cols-4">
      <legend className="sr-only">AI provider</legend>
      {options.map((o) => {
        const checked = current === o.id;
        return (
          <label
            key={o.id}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-md border-[1.5px] bg-surface p-3 transition-colors duration-quick",
              checked ? "border-ink shadow-1" : "border-line hover:border-line-strong",
            )}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                value={o.id}
                checked={checked}
                onChange={() =>
                  onChange({
                    ai: {
                      provider: o.id,
                      models: { fast: "", smart: "", deep: "" },
                      ...(o.id === "ollama" && !settings.ai.baseUrl ? { baseUrl: DEFAULT_OLLAMA } : {}),
                    },
                  })
                }
                className="accent-[var(--ink)]"
              />
              <span className="text-body font-[650] text-ink">{o.label}</span>
            </span>
            <span className="text-small text-ink-2">{o.blurb}</span>
            {o.id === "ollama" && ollamaDetected ? (
              <span className="text-micro text-sea-text">Running on this computer</span>
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}

function KeyEditor({ settings }: { settings: Settings }) {
  const provider = settings.ai.provider;
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.ai.baseUrl ?? "");
  const keyId = useId();
  const urlId = useId();
  useEffect(() => setBaseUrl(settings.ai.baseUrl ?? ""), [settings.ai.baseUrl]);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.settings }),
      qc.invalidateQueries({ queryKey: queryKeys.aiStatus }),
      qc.invalidateQueries({ queryKey: ["ai"] }),
    ]);
  const save = useMutation({
    mutationFn: () => {
      if (provider === "none") throw new Error("no provider");
      return api.setAiKey({ provider, key: key.trim(), ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) });
    },
    onSuccess: async () => {
      setKey("");
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api.clearAiKey(), onSuccess: refresh });
  const saveUrl = useMutation({
    mutationFn: () => api.patchSettings({ ai: { baseUrl: baseUrl.trim() } }),
    onSuccess: refresh,
  });
  if (provider === "none") return null;
  const needsKey = provider !== "ollama";
  const needsUrl = provider !== "anthropic";
  const envName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const err = (e: unknown) =>
    e instanceof ApiClientError ? e.body.message : e instanceof Error ? e.message : "Something went wrong.";

  return (
    <div className="flex flex-col gap-4">
      {needsUrl ? (
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            saveUrl.mutate();
          }}
        >
          <label htmlFor={urlId} className="text-small font-[620] text-ink">
            Server URL
          </label>
          <div className="flex gap-2">
            <input
              id={urlId}
              type="url"
              value={baseUrl}
              placeholder={provider === "ollama" ? DEFAULT_OLLAMA : "https://api.openai.com/v1"}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="voice-mono h-10 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-3 text-small"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={baseUrl.trim() === (settings.ai.baseUrl ?? "") || saveUrl.isPending}
            >
              Save URL
            </Button>
          </div>
          {needsKey ? (
            <p className="m-0 text-micro text-ink-3">
              Changing the URL removes the stored key, so a key is never sent to a server it wasn't meant for.
            </p>
          ) : null}
          {saveUrl.error ? <p className="m-0 text-small text-ember-text">{err(saveUrl.error)}</p> : null}
        </form>
      ) : null}
      {needsKey ? (
        settings.ai.keySource === "env" ? (
          <p className="m-0 text-small text-ink-2">
            Key from the environment (<code className="voice-mono">{envName}</code>):{" "}
            <span className="voice-mono">{settings.ai.keyMasked}</span>. Unset it to manage the key here.
          </p>
        ) : (
          <form
            className="flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) save.mutate();
            }}
          >
            <label htmlFor={keyId} className="text-small font-[620] text-ink">
              API key
            </label>
            <div className="flex gap-2">
              <input
                id={keyId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                placeholder={settings.ai.keyMasked ?? (provider === "anthropic" ? "sk-ant-…" : "sk-…")}
                onChange={(e) => setKey(e.target.value)}
                className="voice-mono h-10 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-3 text-small"
              />
              <Button type="submit" variant="primary" disabled={!key.trim() || save.isPending}>
                {settings.ai.keyMasked ? "Replace" : "Save key"}
              </Button>
              {settings.ai.keyMasked ? (
                <Button type="button" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="m-0 text-micro text-ink-3">
              Stored in <code className="voice-mono">~/.learncroc/config.json</code> (readable only by you). Only this
              app's server reads it, and only to call the provider.
            </p>
            {save.error ? <p className="m-0 text-small text-ember-text">{err(save.error)}</p> : null}
          </form>
        )
      ) : null}
    </div>
  );
}

function TestKey() {
  const t = useMutation({ mutationFn: () => api.testAi() });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={() => t.mutate()} disabled={t.isPending}>
        {t.isPending ? "Testing…" : "Test"}
      </Button>
      {t.data?.ok ? (
        <span className="flex items-center gap-1.5 text-small text-sea-text" role="status">
          <CheckCircle size={16} aria-hidden /> Works · {t.data.model} ·{" "}
          <span className="tabular">{t.data.latencyMs} ms</span>
        </span>
      ) : null}
      {t.data && !t.data.ok ? (
        <span className="flex items-center gap-1.5 text-small text-ember-text" role="status">
          <Warning size={16} aria-hidden /> {t.data.error ?? "It didn't work."}
        </span>
      ) : null}
      {t.error ? <span className="text-small text-ember-text">Couldn't reach the local server.</span> : null}
    </div>
  );
}

function Models({ settings, onChange }: AiSettingsPanelProps) {
  const list = useQuery({
    queryKey: ["ai", "models", settings.ai.provider, settings.ai.baseUrl],
    queryFn: () => api.listAiModels(),
    retry: false,
  });
  const preset = PROVIDER_PRESETS.find((p) => p.id === settings.ai.provider)?.models;
  const listId = useId();
  const models = list.data?.models ?? [];
  const empty = !settings.ai.models.fast && !settings.ai.models.smart && !settings.ai.models.deep;
  // Local providers have no preset: pre-fill each tier with the first recommended model installed.
  useEffect(() => {
    if (!preset && empty && list.data?.source === "provider" && models.length > 0) {
      onChange({ ai: { models: suggestLocalModels(models) } });
    }
  }, [preset, empty, list.data?.source, models, onChange]);
  return (
    <div className="flex flex-col gap-3">
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {(["fast", "smart", "deep"] as const).map((tier) => (
        <ModelField
          key={tier}
          tier={tier}
          listId={listId}
          value={settings.ai.models[tier]}
          placeholder={preset?.[tier] ?? (tier === "deep" ? "same as Smart" : "pick a model")}
          onSave={(v) => onChange({ ai: { models: { ...settings.ai.models, [tier]: v } } })}
        />
      ))}
      {settings.ai.provider === "ollama" && models.length === 0 && !list.isLoading ? (
        <p className="m-0 text-small text-ink-2">
          No models found. Install one with <code className="voice-mono">ollama pull qwen3:14b</code> (recommendations
          in docs/ai/local-models.md).
        </p>
      ) : null}
    </div>
  );
}

function ModelField({
  tier,
  value,
  placeholder,
  listId,
  onSave,
}: {
  tier: ModelTier;
  value: string;
  placeholder: string;
  listId: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  const id = useId();
  useEffect(() => setV(value), [value]);
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="text-small font-[620] text-ink">
        {TIER_LABEL[tier].title}
      </label>
      <input
        id={id}
        list={listId}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() !== value && onSave(v.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="voice-mono h-9 rounded-sm border border-line-strong bg-surface px-3 text-small"
      />
      <span />
      <span className="text-micro text-ink-3">{TIER_LABEL[tier].help}</span>
    </div>
  );
}

function SpendMeter({ settings, onChange }: AiSettingsPanelProps) {
  const usage = useQuery({ queryKey: ["ai", "usage"], queryFn: () => api.getAiUsage(), retry: false });
  const [cap, setCap] = useState(String(settings.ai.monthlyCapUsd));
  const id = useId();
  useEffect(() => setCap(String(settings.ai.monthlyCapUsd)), [settings.ai.monthlyCapUsd]);
  const capApplies = PROVIDER_PRESETS.find((p) => p.id === settings.ai.provider)?.capApplies ?? false;
  if (!capApplies) {
    return <p className="m-0 text-small text-ink-2">Local models cost nothing, so there is no monthly cap.</p>;
  }
  const spent = usage.data?.spentUsd ?? 0;
  const share = settings.ai.monthlyCapUsd > 0 ? Math.min(1, spent / settings.ai.monthlyCapUsd) : 1;
  const features = Object.entries(usage.data?.byFeature ?? {}).filter(([, f]) => f.calls > 0);
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(cap);
          if (Number.isFinite(n) && n >= 0) onChange({ ai: { monthlyCapUsd: Math.round(n * 100) / 100 } });
        }}
      >
        <label htmlFor={id} className="text-small font-[620] text-ink">
          Monthly cap
        </label>
        <span className="text-small text-ink-2">$</span>
        <input
          id={id}
          inputMode="decimal"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          className="tabular h-9 w-24 rounded-sm border border-line-strong bg-surface px-2 text-small"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={Number(cap) === settings.ai.monthlyCapUsd}>
          Save
        </Button>
      </form>
      <div>
        <meter
          className="sr-only"
          min={0}
          max={settings.ai.monthlyCapUsd}
          value={spent}
          aria-label="Spent this month"
        />
        <div aria-hidden className="h-2 overflow-hidden rounded-pill bg-surface-sunk">
          <div
            className={cn("h-full rounded-pill", share >= 0.8 ? "bg-ember" : "bg-sea")}
            style={{ width: `${share * 100}%` }}
          />
        </div>
        <p className="m-0 mt-1 text-small text-ink-2">
          Spent this month: <span className="tabular">${spent.toFixed(2)}</span> of{" "}
          <span className="tabular">${settings.ai.monthlyCapUsd.toFixed(2)}</span> (estimated from tokens).
          {share >= 1
            ? " AI is paused until next month; everything uses its offline version."
            : share >= 0.8
              ? " Getting close to the cap."
              : ""}
        </p>
      </div>
      {features.length > 0 ? (
        <details className="text-small text-ink-2">
          <summary className="cursor-pointer">By feature</summary>
          <ul className="m-0 mt-2 grid list-none grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 p-0">
            {features.map(([f, row]) => (
              <li key={f} className="contents">
                <span>{f}</span>
                <span className="tabular text-right">{row.calls} calls</span>
                <span className="tabular text-right">${row.usd.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function LastSent() {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["ai", "last-sent", "*"],
    queryFn: () => api.getAiLastSent(),
    enabled: open,
    staleTime: 0,
  });
  return (
    <details className="text-small" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-ink-2">What did I send? (the last AI request, exactly)</summary>
      {q.data ? (
        <pre className="voice-mono mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-sm border border-line bg-surface-2 p-3 text-micro">
          {JSON.stringify(q.data, null, 2)}
        </pre>
      ) : (
        <p className="m-0 mt-2 text-ink-3">{q.isLoading ? "Loading…" : "Nothing sent yet."}</p>
      )}
    </details>
  );
}

export function AiSettingsPanel({ settings, onChange }: AiSettingsPanelProps) {
  const status = useAiStatusQuery();
  const provider = settings.ai.provider;
  return (
    <Panel as="section" data-slot="ai-settings" aria-label="AI settings" padding="lg" className="flex flex-col gap-6">
      <p className="m-0 max-w-[60ch] text-body text-ink-2">
        Learncroc works fully without AI: curated maps, the article gallery, checkpoints, Relight, and {CROC_NAME}'s
        written notes. AI adds article maps from links and a {CROC_NAME} you can talk to.
      </p>
      <ProviderPicker settings={settings} onChange={onChange} ollamaDetected={status.data?.ollamaDetected ?? false} />
      {provider !== "none" ? (
        <>
          <Section title="Connection">
            <KeyEditor settings={settings} />
            <TestKey />
          </Section>
          <Section title="Models">
            <Models settings={settings} onChange={onChange} />
          </Section>
          <Section title={CROC_NAME}>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-small font-[620] text-ink">{CROC_NAME} uses</legend>
              {(["smart", "fast"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2 text-small text-ink">
                  <input
                    type="radio"
                    name="tutor-tier"
                    checked={settings.ai.tutorTier === t}
                    onChange={() => onChange({ ai: { tutorTier: t } })}
                  />
                  {t === "smart" ? "Smart: better answers and hints (default)" : "Fast: cheaper and quicker"}
                </label>
              ))}
            </fieldset>
          </Section>
          <Section title="Spending">
            <SpendMeter settings={settings} onChange={onChange} />
            <LastSent />
          </Section>
        </>
      ) : null}
    </Panel>
  );
}
