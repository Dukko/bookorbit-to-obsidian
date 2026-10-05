/**
 * Small Markdown / YAML helpers for generating Obsidian-friendly notes.
 * No external dependencies: frontmatter is written by hand (JSON string quoting
 * is valid YAML for scalars) and tables are assembled manually.
 */

export type Scalar = string | number | boolean | null | undefined;
export type ScalarList = Scalar[];
export type FmValue = Scalar | ScalarList;

/** Quote/escape a scalar for a single-line YAML value. */
function yamlString(value: string): string {
  const needsQuoting = /[:#\[\]{}&*!|>'"%@`]|^\s|\s$|^[\d-]/.test(value);
  if (!needsQuoting) return value;
  return JSON.stringify(value);
}

export function yamlValue(value: FmValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Short arrays of simple scalars render as flow lists (tags, links, etc.).
    if (value.every((v) => typeof v === "string" && !/[:#\[\]{}&*!|>'"%@`]|^\s|\s$/.test(v))) {
      return `[${value.join(", ")}]`;
    }
    return value.map((v) => `  - ${yamlValue(v)}`).join("\n");
  }
  if (typeof value === "string") return yamlString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "null";
  return String(value);
}

/** Build a YAML frontmatter block (with surrounding --- fences). */
export function frontmatter(record: Record<string, FmValue>): string {
  const lines = Object.entries(record).map(([key, value]) => `${key}: ${yamlValue(value)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * A Dataview-queriable inline field. Obsidian core ignores these; the Dataview
 * plugin reads them as `key:: value` lines (put them on their own line).
 */
export function inlineField(name: string, value: Scalar): string {
  if (value === null || value === undefined) value = "";
  return `${name}:: ${value}`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0 min";
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Decimal hours, e.g. 12.5 */
export function formatHours(seconds: number): string {
  if (!isFinite(seconds)) return "0";
  return (seconds / 3600).toFixed(1);
}

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function escapeTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function mdTable(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.map(escapeTableCell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

export const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthAbbr(month: number): string {
  return MONTHS_ABBR[(month - 1 + 12) % 12] ?? String(month);
}

/** Parse the date portion of an ISO string into {year, month, day}. */
export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return { year: 0, month: 0, day: 0 };
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function isoDayKey(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${m}-${d}`;
}

/** Monday of the week containing `date` (UTC-normalized). */
export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/** ISO-8601 week number (weeks start Monday). */
export function isoWeekOf(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** 2026-10-05 -> 2026-W41 style label. */
export function isoWeekLabel(date: Date): string {
  const { year, week } = isoWeekOf(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Five intensity levels used by the text heatmap. */
export const HEATMAP_CHARS = ["·", "▁", "▃", "▅", "▓", "█"] as const;

export function intensityFor(minutes: number, max: number): number {
  if (!(minutes > 0) || !(max > 0)) return 0;
  const t = minutes / max;
  if (t >= 0.8) return 5;
  if (t >= 0.6) return 4;
  if (t >= 0.4) return 3;
  if (t >= 0.2) return 2;
  return 1;
}

/** Escapes characters that would break Markdown emphasis/code spans. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_\[\]])/g, "\\$1");
}

/** Make a vault-safe filename-slug from a book title (ASCII, max 80 chars, trim). */
export function slugifyTitle(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "book";
}