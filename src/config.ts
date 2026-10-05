import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Minimal .env loader — no dependency. Real environment variables win,
 * so exported vars override anything in the file.
 */
export function loadEnvFile(path = ".env"): void {
  let content: string;
  try {
    content = readFileSync(resolve(path), "utf8");
  } catch {
    return; // no .env file — rely on the environment
  }
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export type NoteName = "overview" | "heatmap" | "books" | "library" | "highlights";

export interface Config {
  url: string;
  username: string;
  password: string;
  vaultPath: string;
  outputDir: string;
  heatmapDays: number;
  showWantToRead: boolean;
  includeHighlights: boolean;
  only: NoteName[] | null; // null = all
  quiet: boolean;
  sessionFile: string;
  deviceLabel: string;
}

export class ConfigError extends Error {}

function requires(value: string | undefined, name: string): string {
  if (!value) {
    throw new ConfigError(
      `Missing required configuration: ${name}. Set it in .env or pass it as a flag (see README).`,
    );
  }
  return value;
}

/**
 * Parse CLI flags. Supported:
 *   --url, --username, --password   BookOrbit connection (override .env)
 *   --vault=<dir>                   Obsidian vault path (override .env)
 *   --out=<dir>                     subfolder inside the vault
 *   --days=<n>                      heatmap trailing window (default 365)
 *   --only=overview,heatmap,...     render a subset of notes
 *   --no-highlights                 skip annotations export
 *   --no-want-to-read               skip the Want to Read shelf
 *   --quiet                         suppress progress output (for cron)
 *   --help                          print usage
 */
export function loadConfig(argv: string[]): Config {
  const flags = new Map<string, string>();
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    flags.set(m[1], m[2] ?? "true");
  }

  if (help) {
    printUsage();
    process.exit(0);
  }

  const parseOnly = (): NoteName[] | null => {
    const raw = flags.get("only");
    if (!raw || raw === "true") return null;
    const names = raw.split(",").map((s) => s.trim()) as NoteName[];
    const valid = new Set<NoteName>(["overview", "heatmap", "books", "library", "highlights"]);
    for (const name of names) {
      if (!valid.has(name)) throw new ConfigError(`Unknown note name in --only: ${name}`);
    }
    return names.length ? names : null;
  };

  const heatmapDays = Number(flags.get("days") ?? process.env.HEATMAP_DAYS ?? 365);
  if (!Number.isInteger(heatmapDays) || heatmapDays < 1 || heatmapDays > 3650) {
    throw new ConfigError("HEATMAP_DAYS must be an integer between 1 and 3650.");
  }

  const config: Config = {
    url: requires(flags.get("url") ?? process.env.BOOKORBIT_URL, "BOOKORBIT_URL"),
    username: requires(flags.get("username") ?? process.env.BOOKORBIT_USERNAME, "BOOKORBIT_USERNAME"),
    password: requires(flags.get("password") ?? process.env.BOOKORBIT_PASSWORD, "BOOKORBIT_PASSWORD"),
    vaultPath: requires(flags.get("vault") ?? process.env.OBSIDIAN_VAULT_PATH, "OBSIDIAN_VAULT_PATH"),
    outputDir: flags.get("out") ?? process.env.OBSIDIAN_OUTPUT_DIR ?? "BookOrbit",
    heatmapDays,
    showWantToRead: flagToBool(flags.get("no-want-to-read"), process.env.SHOW_WANT_TO_READ, true),
    includeHighlights: flagToBool(flags.get("no-highlights"), undefined, true),
    only: parseOnly(),
    quiet: flags.get("quiet") === "true",
    sessionFile: flags.get("session-file") ?? process.env.BOOKORBIT_SESSION_FILE ?? join(process.cwd(), ".bookorbit-session.json"),
    deviceLabel: process.env.BOOKORBIT_DEVICE_LABEL ?? "bookorbit-to-obsidian sync",
  };

  // Cosmetics: strip trailing slashes.
  config.url = config.url.replace(/\/+$/, "");
  config.outputDir = config.outputDir.replace(/^\/+|\/+$/g, "");
  if (!config.outputDir) config.outputDir = "BookOrbit";

  return config;
}

function flagToBool(negationFlag: string | undefined, env: string | undefined, defaultValue: boolean): boolean {
  if (negationFlag === "true") return false;
  if (env !== undefined) return env.toLowerCase() !== "false";
  return defaultValue;
}

function printUsage(): void {
  console.log(`BookOrbit → Obsidian sync

Usage:
  npm run sync [flags]

Flags:
  --url=<url>            BookOrbit server URL (override .env)
  --username=<u>         login username
  --password=<p>         login password
  --vault=<dir>          Obsidian vault path
  --out=<dir>            subfolder inside the vault (default: BookOrbit)
  --days=<n>             heatmap trailing window in days (default: 365)
  --only=<a,b,c>         render only: overview,heatmap,books,library,highlights
  --no-highlights        skip the annotations export
  --no-want-to-read      skip the Want to Read shelf
  --session-file=<path>  persisted login session (default: .bookorbit-session.json)
  --quiet                suppress progress output (intended for cron)
  --help                 this help

Environment: BOOKORBIT_URL, BOOKORBIT_USERNAME, BOOKORBIT_PASSWORD,
             OBSIDIAN_VAULT_PATH, OBSIDIAN_OUTPUT_DIR, HEATMAP_DAYS,
             SHOW_WANT_TO_READ`);
}