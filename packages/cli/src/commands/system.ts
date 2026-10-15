/**
 * learncroc doctor | install-app
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { homedir, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { LEARNCROC_VERSION } from "@learncroc/core";
import { homePaths, PackStore, readSession, SettingsStore, WEB_DIST_DIR } from "@learncroc/server";
import pc from "picocolors";
import { parseArgs } from "../lib/args";
import { cliEnv, runningServer } from "../lib/context";

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = netServer();
    s.once("error", () => done(false));
    s.listen(port, "127.0.0.1", () => s.close(() => done(true)));
  });
}

/** learncroc doctor — environment and install diagnostics (paste into bug reports; no secrets). */
export async function doctor(argv: string[]): Promise<number> {
  const env = cliEnv(argv);
  const p = homePaths(env.home);
  const lines: [string, string][] = [];
  const add = (k: string, v: string) => lines.push([k, v]);
  add("learncroc", LEARNCROC_VERSION);
  add("runtime", `bun ${Bun.version}`);
  add("os", `${platform()} ${release()} (${process.arch})`);
  add("home", env.home);
  add("home exists", existsSync(env.home) ? "yes" : "no (created on first run)");
  add("database", existsSync(p.db) ? "present" : "not created yet");
  add("web app", existsSync(join(WEB_DIST_DIR, "index.html")) ? "built" : "not built (bun run build)");
  const server = await runningServer(env.home);
  const session = readSession(env.home);
  add(
    "server",
    server ? `running at ${server.base}` : session ? `not answering (stale session pid ${session.pid})` : "not running",
  );
  if (!server) {
    add(`port ${env.port}`, (await portFree(env.port)) ? "free" : "in use by another program");
    add(`port ${env.port + 1} (sandbox)`, (await portFree(env.port + 1)) ? "free" : "in use by another program");
  }
  try {
    const packs = await new PackStore({ home: env.home }).list();
    add(
      "packs",
      packs.length
        ? packs.map((x) => `${x.id}@${x.version}${x.status === "ok" ? "" : ` [${x.status}]`}`).join(", ")
        : "none",
    );
  } catch (e) {
    add("packs", `error: ${(e as Error).message}`);
  }
  try {
    const s = new SettingsStore({ home: env.home }).get();
    add("ai provider", s.ai.provider);
    add("ai key", s.ai.keySource === "none" ? "none" : `from ${s.ai.keySource}`);
    add("registries", s.registries.join(", "));
  } catch (e) {
    add("settings", `error: ${(e as Error).message}`);
  }
  add("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY ? "set" : "unset");
  add("OPENAI_API_KEY", process.env.OPENAI_API_KEY ? "set" : "unset");
  if (parseArgs(argv).flags.has("json")) {
    console.log(JSON.stringify(Object.fromEntries(lines), null, 2));
    return 0;
  }
  const w = Math.max(...lines.map(([k]) => k.length));
  for (const [k, v] of lines) console.log(`${pc.dim(k.padEnd(w))}  ${v}`);
  return 0;
}

export interface AppInstallPaths {
  autostart: string;
  shortcut?: string;
}

/** Where the login item and desktop shortcut go on each platform (exported for tests). */
export function appInstallPaths(
  os: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
): AppInstallPaths {
  if (os === "darwin") return { autostart: join(home, "Library", "LaunchAgents", "dev.learncroc.com.plist") };
  if (os === "win32") {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    return {
      autostart: join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "learncroc.cmd"),
      shortcut: join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "learncroc.url"),
    };
  }
  const config = env.XDG_CONFIG_HOME ?? join(home, ".config");
  const data = env.XDG_DATA_HOME ?? join(home, ".local", "share");
  return {
    autostart: join(config, "autostart", "learncroc.desktop"),
    shortcut: join(data, "applications", "learncroc.desktop"),
  };
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The files install-app writes (exported for tests). */
export function appInstallFiles(
  os: NodeJS.Platform,
  command: string[],
  url: string,
  paths: AppInstallPaths,
): Map<string, string> {
  const files = new Map<string, string>();
  if (os === "darwin") {
    files.set(
      paths.autostart,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.learncroc.com</string>
  <key>ProgramArguments</key>
  <array>
${command.map((c) => `    <string>${xmlEscape(c)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`,
    );
  } else if (os === "win32") {
    files.set(paths.autostart, `@echo off\r\nstart "" /min ${command.map((c) => `"${c}"`).join(" ")}\r\n`);
    if (paths.shortcut) files.set(paths.shortcut, `[InternetShortcut]\r\nURL=${url}\r\n`);
  } else {
    const exec = command.map((c) => (/\s/.test(c) ? `"${c}"` : c)).join(" ");
    files.set(
      paths.autostart,
      `[Desktop Entry]\nType=Application\nName=learncroc\nComment=Start the learncroc server at login\nExec=${exec}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
    );
    if (paths.shortcut)
      files.set(
        paths.shortcut,
        `[Desktop Entry]\nType=Application\nName=learncroc\nComment=Learn anything by playing its map\nExec=xdg-open ${url}\nTerminal=false\nCategories=Education;\n`,
      );
  }
  return files;
}

/** learncroc install-app [--remove] — start the server at login and add a desktop shortcut. */
export async function installApp(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["port", "home"]);
  const env = cliEnv(argv);
  const paths = appInstallPaths(process.platform, homedir(), process.env);
  if (args.flags.has("remove")) {
    for (const f of [paths.autostart, paths.shortcut]) if (f && existsSync(f)) rmSync(f);
    console.log("Removed the learncroc login item and shortcut.");
    return 0;
  }
  const entry = resolve(process.argv[1] ?? join(import.meta.dir, "../index.ts"));
  const isCompiled = !entry.endsWith(".ts") && !entry.endsWith(".js");
  const command = [
    ...(isCompiled ? [process.execPath] : [process.execPath, entry]),
    "serve",
    "--no-open",
    "--port",
    String(env.port),
    "--home",
    env.home,
  ];
  const url = `http://127.0.0.1:${env.port}`;
  for (const [file, text] of appInstallFiles(process.platform, command, url, paths)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode: 0o644 });
    console.log(`${pc.green("Wrote")} ${file}`);
  }
  console.log(`learncroc will start at login and live at ${pc.cyan(url)}. Undo with: learncroc install-app --remove`);
  return 0;
}
