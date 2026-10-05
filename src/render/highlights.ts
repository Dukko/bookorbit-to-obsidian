/**
 * Highlights: one note per book + an index note.
 *
 * Data source: the annotation hub API (`/annotations`, paginated). Each
 * annotation already carries its book title + author, so we group by bookId
 * and render completely structured notes — no reliance on the raw Markdown
 * export.
 *
 * File layout (inside the vault output dir):
 *   Highlights.md                              <- index
 *   Highlights/<slug>-<bookId>.md              <- one per annotated book
 *
 * Notes written by this module carry `bookorbit-generated: true` in their
 * frontmatter. On every sync, generated notes whose book no longer has
 * highlights are pruned, so deleted highlights never leave ghost files.
 */

import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BookOrbitClient } from "../api.js";
import { frontmatter, mdTable, slugifyTitle, type FmValue } from "../markdown.js";
import type { AnnotationHubItem, HighlightOfTheDayWidgetData } from "../types.js";
import { writeFileAtomic } from "../writer.js";

export interface AnnotatedBook {
  bookId: number;
  title: string | null;
  author: string | null;
  highlights: AnnotationHubItem[];
}

export interface HighlightsData {
  highlightOfTheDay: HighlightOfTheDayWidgetData | null;
  books: AnnotatedBook[]; // sorted by title, then bookId
  totalHighlights: number;
  totalWithNotes: number;
}

export async function fetchHighlightsData(client: BookOrbitClient): Promise<HighlightsData> {
  const [highlightOfTheDay, all] = await Promise.all([
    client.getHighlightOfTheDay().catch(() => null),
    client.listAllAnnotations().catch(() => [] as AnnotationHubItem[]),
  ]);

  const byBook = new Map<number, AnnotationHubItem[]>();
  let withNotes = 0;
  for (const item of all) {
    const list = byBook.get(item.bookId) ?? [];
    list.push(item);
    byBook.set(item.bookId, list);
    if (item.note) withNotes += 1;
  }

  const books: AnnotatedBook[] = [...byBook.entries()]
    .map(([bookId, highlights]) => {
      const first = highlights[0];
      highlights.sort((a, b) => a.highlightedAt.localeCompare(b.highlightedAt));
      return {
        bookId,
        title: first.bookTitle,
        author: first.author,
        highlights,
      };
    })
    .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "") || a.bookId - b.bookId);

  return { highlightOfTheDay, books, totalHighlights: all.length, totalWithNotes: withNotes };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Maps BookOrbit/KOReader/Kobo color names + hex codes to emoji. */
const COLOR_EMOJI: Record<string, string> = {
  yellow: "🟨",
  green: "🟩",
  blue: "🟦",
  pink: "🟪",
  purple: "🟪",
  orange: "🟧",
  red: "🟥",
  olive: "🟢",
  cyan: "🟦",
  gray: "⬜",
  "#FF3300": "🟥",
  "#FF8800": "🟧",
  "#FFFF33": "🟨",
  "#00AA66": "🟩",
  "#88FF77": "🟢",
  "#00FFEE": "🟦",
  "#0066FF": "🟦",
  "#EE00FF": "🟪",
  "#808080": "⬜",
};

function colorEmoji(color: string | null | undefined): string {
  const key = (color ?? "").toLowerCase();
  return COLOR_EMOJI[key] ?? "▪";
}

function highlightBlockquote(item: AnnotationHubItem): string {
  const lines: string[] = [`> “${item.text.replace(/\n+/g, " ").trim()}”`];
  const attributions: string[] = [];
  if (item.chapterTitle) attributions.push(`*${item.chapterTitle}*`);
  attributions.push(item.highlightedAt.slice(0, 10));
  attributions.push(`_${item.origin}_ ${colorEmoji(item.color)}`);
  lines.push(">", `> — ${attributions.join(" · ")}`);
  if (item.note) lines.push(">", `> 📝 ${item.note.replace(/\n+/g, " ").trim()}`);
  return lines.join("\n");
}

function bookFileName(book: AnnotatedBook): string {
  return `${slugifyTitle(book.title ?? `Book ${book.bookId}`)}-${book.bookId}.md`;
}

/** The index note: points at every per-book note, Dataview-friendly. */
export function renderHighlightsIndex(data: HighlightsData, generatedAt: string): string {
  const { highlightOfTheDay, books } = data;
  const parts: string[] = [];

  parts.push(
    frontmatter({
      tags: ["bookorbit", "highlights"],
      generated: generatedAt,
      "bookorbit-note": "highlights",
      "highlight-total": data.totalHighlights,
      "highlight-books": books.length,
    }),
    "# 🖍 Highlights",
    "",
    `> Synced ${generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}.`,
    "",
  );

  if (highlightOfTheDay) {
    parts.push("## ✨ Highlight of the Day", "");
    parts.push(`> ${highlightOfTheDay.text}`);
    if (highlightOfTheDay.note) parts.push("", `> — *${highlightOfTheDay.note}*`);
    if (highlightOfTheDay.bookTitle) {
      parts.push(
        "",
        `— ${highlightOfTheDay.bookTitle}${highlightOfTheDay.chapterTitle ? ` · ${highlightOfTheDay.chapterTitle}` : ""}`,
      );
    }
    parts.push("");
  }

  parts.push("## Books", "");
  if (books.length) {
    const rows = books.map((b) => {
      const file = bookFileName(b).replace(/\.md$/, "");
      const link = `[[${file}|${b.title ?? "(untitled)"}]]`;
      const notes = b.highlights.filter((h) => h.note).length;
      const first = b.highlights[0]?.highlightedAt.slice(0, 10) ?? "—";
      const last = b.highlights[b.highlights.length - 1]?.highlightedAt.slice(0, 10) ?? "—";
      return [link, b.author ?? "—", b.highlights.length, notes, first, last];
    });
    parts.push(mdTable(["Book", "Author", "Highlights", "Notes", "First", "Last"], rows), "");
  } else {
    parts.push("_No highlights yet — highlight something in BookOrbit and re-sync._", "");
  }

  return parts.join("\n");
}

/** One note per book. Frontmatter is Dataview-queryable; `aliases` lets Obsidian
 * resolve [[Plain Book Title]] links despite the id-suffixed filename. */
export function renderBookHighlightNote(book: AnnotatedBook, generatedAt: string): string {
  const title = book.title ?? "(untitled)";
  const notes = book.highlights.filter((h) => h.note).length;
  const first = book.highlights[0]?.highlightedAt.slice(0, 10);
  const last = book.highlights[book.highlights.length - 1]?.highlightedAt.slice(0, 10);

  const fm: Record<string, FmValue> = {
    tags: ["bookorbit", "highlight"],
    "bookorbit-generated": true,
    generated: generatedAt,
    "book-id": book.bookId,
    "book-author": book.author ?? "",
    "highlight-count": book.highlights.length,
    "note-count": notes,
    "first-highlight": first ?? "",
    "last-highlight": last ?? "",
  };
  // The plain-language alias: filename is "<slug>-<bookId>.md", alias is the real title.
  if (book.title) fm.aliases = [book.title];

  const parts: string[] = [
    frontmatter(fm),
    `# ✍️ ${title}`,
    "",
    `*${book.highlights.length} highlights${notes ? ` · ${notes} notes` : ""}${book.author ? ` · ${book.author}` : ""}*`,
    "",
  ];

  const body = book.highlights.map(highlightBlockquote).join("\n\n");
  parts.push(body, "", "---", "", "[[Highlights|← All highlights]]");
  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

const GENERATED_MARKER = "bookorbit-generated";
const BOOK_ID_PATTERN = /book-id:\s*(\d+)/;

/**
 * Write the index + per-book notes into `outDir` and prune stale generated
 * notes. Returns the path of the index note.
 */
export async function writeHighlights(data: HighlightsData, outDir: string, generatedAt: string): Promise<string> {
  const highlightsDir = join(outDir, "Highlights");
  const indexPath = join(outDir, "Highlights.md");

  // Always rewrite the index (it is fully generated).
  await writeFileAtomic(indexPath, renderHighlightsIndex(data, generatedAt));

  // Per-book notes.
  const freshIds = new Set(data.books.map((b) => b.bookId));
  for (const book of data.books) {
    await writeFileAtomic(join(highlightsDir, bookFileName(book)), renderBookHighlightNote(book, generatedAt));
  }

  // Prune stale generated notes (e.g. highlights deleted in BookOrbit).
  await pruneStaleNotes(highlightsDir, freshIds);

  return indexPath;
}

async function pruneStaleNotes(dir: string, freshIds: Set<number>): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // nothing to prune
  }
  await Promise.all(
    entries
      .filter((name) => name.endsWith(".md"))
      .map(async (name) => {
        const path = join(dir, name);
        try {
          const head = await readFile(path, "utf8").then((c) => c.slice(0, 600));
          if (!head.includes(GENERATED_MARKER)) return;
          const match = BOOK_ID_PATTERN.exec(head);
          const id = match ? Number(match[1]) : NaN;
          if (!Number.isFinite(id) || !freshIds.has(id)) {
            await unlink(path);
          }
        } catch {
          // Unreadable/unremovable — leave it alone rather than failing the sync.
        }
      }),
  );
}