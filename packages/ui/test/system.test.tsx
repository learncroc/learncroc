import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackTheme } from "@learncroc/core";
import { render } from "@testing-library/react";
import axe from "axe-core";
import {
  AnswerKey,
  Button,
  ConfidenceTap,
  contrast,
  createSoundEngine,
  mix,
  PENTATONIC,
  ProgressBeads,
  SegmentRing,
  StatePill,
  StopGlyph,
  Switch,
  WorldTheme,
  worldInk,
  worldVars,
} from "../src/index";
import { checkTokens } from "../src/tokens-check";

const THEME: Pick<PackTheme, "ground" | "mode" | "lines" | "texture"> = {
  ground: "#0F2321",
  mode: "dark",
  texture: "pcb",
  lines: ["#E39A5F", "#62B6E8", "#C792F2", "#7DD3A0", "#F07DA6"],
};

describe("colour", () => {
  test("contrast and mix", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  test("world ink reads at 7:1 and ink-2 at 4.5:1 on any ground", () => {
    for (const ground of ["#0F2321", "#14132E", "#F6F1E4", "#FFFFFF", "#2A2A2A"]) {
      const mode = contrast(ground, "#000000") > contrast(ground, "#FFFFFF") ? "light" : "dark";
      const v = worldVars({ ...THEME, ground, mode });
      expect(contrast(v["--w-ink"], ground)).toBeGreaterThanOrEqual(7);
      expect(contrast(v["--w-ink-2"], ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("an authored ink wins", () => {
    expect(worldInk({ ground: "#0F2321", mode: "dark", ink: "#FAFAFA" })).toBe("#FAFAFA");
  });
});

describe("WorldTheme", () => {
  test("sets --w-* on its root and follows the world's mode", () => {
    const { container } = render(
      <WorldTheme theme={THEME} data-testid="w">
        <span>inside</span>
      </WorldTheme>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--w-ground")).toBe("#0F2321");
    expect(root.style.getPropertyValue("--w-3")).toBe("#C792F2");
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.texture).toBe("pcb");
  });
});

describe("tokens:check", () => {
  test("every token pair meets its contrast target in light and dark", () => {
    const css = readFileSync(join(import.meta.dir, "../src/tokens.css"), "utf8");
    const failed = checkTokens(css)
      .filter((r) => !r.ok)
      .map((r) => `${r.theme} --${r.fg} on --${r.bg}: ${r.ratio.toFixed(2)}`);
    expect(failed).toEqual([]);
  });
});

/** A minimal AudioContext double that records the notes it is asked to play. */
function fakeAudio() {
  const freqs: number[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime(v: number) {
      this.value = v;
      return this;
    },
    exponentialRampToValueAtTime() {
      return this;
    },
  });
  const node = () => ({ connect: (n: unknown) => n });
  let created = 0;
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: node(),
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => {
      const frequency = param();
      const setValueAtTime = frequency.setValueAtTime.bind(frequency);
      frequency.setValueAtTime = (v: number) => {
        freqs.push(v);
        return setValueAtTime(v);
      };
      return { ...node(), type: "sine", frequency, start() {}, stop() {} };
    },
    resume: async () => {},
    close: async () => {},
  };
  return {
    freqs,
    get created() {
      return created;
    },
    create: () => {
      created++;
      return ctx as unknown as AudioContext;
    },
  };
}

describe("sound engine", () => {
  test("off by default: no audio context is ever created", () => {
    const audio = fakeAudio();
    const engine = createSoundEngine({ createContext: audio.create });
    engine.play("tok");
    expect(audio.created).toBe(0);
  });

  test("tok climbs the pentatonic scale within a run and resets", () => {
    const audio = fakeAudio();
    // Cues queue 120 ms apart; run the queue at once here.
    const engine = createSoundEngine({ enabled: true, createContext: audio.create, schedule: (fn) => fn() });
    engine.play("tok");
    engine.play("tok");
    expect(audio.freqs[0]).toBe(PENTATONIC[0] as number);
    expect(audio.freqs).toContain(PENTATONIC[1] as number);
    engine.resetRun();
    audio.freqs.length = 0;
    engine.play("tok");
    expect(audio.freqs[0]).toBe(PENTATONIC[0] as number);
    expect(audio.created).toBe(1);
  });

  test("every cue plays; volume 0 is silent", () => {
    const audio = fakeAudio();
    const engine = createSoundEngine({ enabled: true, createContext: audio.create, schedule: (fn) => fn() });
    for (const cue of ["hm", "gate", "done", "unlock"] as const) engine.play(cue);
    expect(audio.freqs.length).toBeGreaterThan(5);
    const n = audio.freqs.length;
    engine.setVolume(0);
    engine.play("gate");
    expect(audio.freqs.length).toBe(n);
  });
});

describe("accessibility", () => {
  test("axe: no serious or critical violations across the primitives", async () => {
    const { container } = render(
      <main>
        <h1>Primitives</h1>
        <AnswerKey n={1} onPress={() => {}}>
          Coffee
        </AnswerKey>
        <Button variant="primary" kbd="⏎">
          Continue
        </Button>
        <ConfidenceTap onChange={() => {}} />
        <StatePill state="lit" />
        <StopGlyph state="ready" />
        <ProgressBeads total={3} done={1} current={1} label="Screen 2 of 3" />
        <SegmentRing total={4} powered={1} label="1 of 4 stages powered" />
        <Switch checked={false} onChange={() => {}} label="Sound" />
      </main>,
    );
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
