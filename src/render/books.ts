import type { BookOrbitClient } from "../api.js";
import { formatDuration, frontmatter, inlineField, mdTable, monthAbbr } from "../markdown.js";
import type {
  BookCard,
  CurrentlyReadingWidgetData,
  DashboardScrollerResponse,
  UserCompletionTimelinePoint,
  UserSessionTimelineItem,
  UserStatisticsSummary,
} from "../types.js";

export interface BooksData {
  summary: UserStatisticsSummary;
  currentlyReading: CurrentlyReadingWidgetData | null;
  wantToRead: DashboardScrollerResponse | null;
  recentSessions: UserSessionTimelineItem[];
  completionTimeline: UserCompletionTimelinePoint[];
}

export interface BooksOptions {
  showWantToRead: boolean;
}

export async function fetchBooksData(
  client: BookOrbitClient,
  opts: BooksOptions,
): Promise<BooksData> {
  const [summary, currentlyReading, recentSessions, completionTimeline, wantToRead] = await Promise.all([
    client.getUserSummary().catch(() => null),
    client.getCurrentlyReading().catch(() => null),
    client.getRecentSessions(4).catch(() => [] as UserSessionTimelineItem[]),
    client.getCompletionTimeline(1825).catch(() => [] as UserCompletionTimelinePoint[]),
    opts.showWantToRead
      ? client.getScroller("want-to-read", 25).catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    summary: summary ?? {
      trackedBooks: 0,
      startedBooks: 0,
      inProgressBooks: 0,
      completedBooks: 0,
      meanProgressPercent: 0,
    },
    currentlyReading,
    wantToRead,
    recentSessions,
    completionTimeline,
  };
}

function renderBookTable(books: BookCard[]): string {
  if (!books.length) return "_None._";
  const rows = books.map((b) => [
    b.title ?? "(untitled)",
    b.authors.join(", ") || "—",
    b.rating !== null && b.rating !== undefined ? b.rating.toFixed(1) : "—",
    b.genres.slice(0, 3).join(", ") || "—",
  ]);
  return mdTable(["Book", "Author(s)", "Rating", "Genres"], rows);
}

export function renderBooks(data: BooksData, generatedAt: string): string {
  const { summary, currentlyReading, wantToRead, recentSessions, completionTimeline } = data;
  const parts: string[] = [];

  parts.push(
    frontmatter({
      tags: ["bookorbit", "reading-log"],
      generated: generatedAt,
      "bookorbit-note": "books",
    }),
    "# 🕮 Reading Log",
    "",
    `> Synced ${generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}.`,
    "",
  );

  /* ---- Currently reading ---- */
  parts.push("## 📖 Currently Reading", "");
  if (currentlyReading && currentlyReading.books.length) {
    const rows = currentlyReading.books.map((b) => [
      b.title ?? "(untitled)",
      b.authors.join(", ") || "—",
      `${Math.round(b.progress)}%`,
      b.fileFormat ?? "—",
    ]);
    parts.push(mdTable(["Book", "Author(s)", "Progress", "Format"], rows), "");
  } else {
    parts.push("_Nothing in progress._", "");
  }
  parts.push(inlineField("currently-reading-count", currentlyReading?.books.length ?? 0), "");

  /* ---- Want to read ---- */
  if (wantToRead) {
    parts.push("## 📚 Want to Read", "");
    parts.push(renderBookTable(wantToRead.books), "");
    parts.push(inlineField("want-to-read-count", wantToRead.total ?? wantToRead.books.length), "");
  }

  /* ---- Recent sessions ---- */
  parts.push("## ⏱ Recent Sessions (last 4 weeks)", "");
  if (recentSessions.length) {
    const rows = recentSessions
      .slice()
      .reverse()
      .slice(0, 40)
      .map((s) => [
        s.startedAt.slice(0, 16).replace("T", " "),
        s.bookTitle ?? "(unknown)",
        formatDuration(s.durationSeconds),
        s.bookSource ?? "—",
      ]);
    parts.push(mdTable(["Started", "Book", "Duration", "Source"], rows), "");
  } else {
    parts.push("_No sessions recorded in the last 4 weeks._", "");
  }
  parts.push("");

  /* ---- Finishes ---- */
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  parts.push("## ✅ Finished Books", "");
  parts.push(inlineField("finished-all-time", summary.completedBooks));

  const byYear = new Map<number, number>();
  for (const p of completionTimeline) byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.count);
  parts.push(inlineField("finished-this-year", byYear.get(thisYear) ?? 0), "");

  // Last 12 months as a table.
  const byMonth = new Map<string, number>();
  for (const p of completionTimeline) {
    const key = `${p.year}-${String(p.month).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.count);
  }
  const monthKeys = [...byMonth.keys()].sort().slice(-12);
  const monthRows = monthKeys.map((key) => {
    const [y, m] = key.split("-").map(Number);
    return [`${monthAbbr(m)} ${y}`, byMonth.get(key) ?? 0];
  });
  parts.push("### Last 12 months", "");
  parts.push(mdTable(["Month", "Finished"], monthRows), "");

  const yearRows = [...byYear.entries()].sort(([a], [b]) => b - a).map(([y, c]) => [y, c]);
  parts.push("### By year", "");
  parts.push(mdTable(["Year", "Finished"], yearRows), "");

  return parts.join("\n");
}