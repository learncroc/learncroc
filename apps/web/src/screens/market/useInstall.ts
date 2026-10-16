/**
 * Install a pack from a registry over SSE (POST /packs/install): resolving → downloading → verifying
 * → extracting → done | error. Progress is shown on the button; errors say what happened.
 */
import type { InstallEvent, PackId, SemVer } from "@learncroc/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { api } from "../../api/client";
import { errorText } from "../../app/errors";
import { qk } from "../../app/queries";

export type InstallPhase = "idle" | "resolving" | "downloading" | "verifying" | "extracting" | "done" | "error";

export interface InstallState {
  phase: InstallPhase;
  /** 0..1 while downloading (verifying/extracting count as the last 10%). */
  progress: number;
  version?: SemVer;
  error?: string;
}

type ErrorCode = Extract<InstallEvent, { type: "error" }>["code"];

/** What went wrong, in plain words, plus what to do. */
export const INSTALL_ERROR: Record<ErrorCode, string> = {
  hash_mismatch:
    "The download didn't match its checksum, so nothing was installed. Try again; if it repeats, report the map.",
  engine: "This map needs a newer Learncroc. Update the app, then install it.",
  unsafe_archive: "The map archive contains unsafe paths, so it was refused.",
  unsafe_asset: "The map contains a file that failed the safety check, so it was refused.",
  invalid_pack: "The map's files don't pass validation, so it wasn't installed.",
  network: "The download failed. Check your connection and try again.",
  not_found: "The registry no longer lists this map.",
  url_refused: "The map's download address isn't allowed (it must be https).",
};

export function phaseLabel(s: InstallState): string {
  switch (s.phase) {
    case "resolving":
      return "Finding the map";
    case "downloading":
      return `Downloading ${Math.round(s.progress * 100)}%`;
    case "verifying":
      return "Checking the files";
    case "extracting":
      return "Unpacking";
    case "done":
      return "Installed";
    default:
      return "Install";
  }
}

export function reduceInstall(state: InstallState, ev: InstallEvent): InstallState {
  switch (ev.type) {
    case "resolving":
      return { phase: "resolving", progress: 0 };
    case "downloading":
      return { phase: "downloading", progress: ev.total > 0 ? Math.min(0.9, (ev.received / ev.total) * 0.9) : 0 };
    case "verifying":
      return { ...state, phase: "verifying", progress: 0.93 };
    case "extracting":
      return { ...state, phase: "extracting", progress: 0.97 };
    case "done":
      return { phase: "done", progress: 1, version: ev.version };
    case "error":
      return { phase: "error", progress: 0, error: INSTALL_ERROR[ev.code] ?? ev.message };
  }
}

export function useInstall(packId: PackId, registry?: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<InstallState>({ phase: "idle", progress: 0 });
  const busy = useRef(false);

  const start = useCallback(
    async (version?: SemVer) => {
      if (busy.current) return;
      busy.current = true;
      let s: InstallState = { phase: "resolving", progress: 0 };
      setState(s);
      try {
        for await (const ev of api.installPack({
          id: packId,
          ...(version ? { version } : {}),
          ...(registry ? { registry } : {}),
        })) {
          s = reduceInstall(s, ev);
          setState(s);
          if (ev.type === "done" || ev.type === "error") break;
        }
        if (s.phase !== "done" && s.phase !== "error") {
          s = { phase: "error", progress: 0, error: "The install stopped before it finished. Try again." };
          setState(s);
        }
      } catch (err) {
        s = { phase: "error", progress: 0, error: `Couldn't start the install (${errorText(err)}).` };
        setState(s);
      } finally {
        busy.current = false;
        if (s.phase === "done") {
          await Promise.all([
            qc.invalidateQueries({ queryKey: qk.packs }),
            qc.invalidateQueries({ queryKey: qk.registry }),
            qc.invalidateQueries({ queryKey: qk.progressAll }),
          ]);
        }
      }
      return s;
    },
    [packId, registry, qc],
  );

  const reset = useCallback(() => setState({ phase: "idle", progress: 0 }), []);
  return { state, start, reset };
}
