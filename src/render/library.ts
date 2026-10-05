import type { BookOrbitClient } from "../api.js";
import { formatBytes, frontmatter, inlineField, mdTable } from "../markdown.js";
import type {
  BooksAddedDataPoint,
  FormatDistributionItem,
  GenreDistributionItem,
  LibraryOverviewWidgetData,
  StatisticsSummary,
  TopAuthorItem,
} from "../types.js";

export interface LibraryData {
  overview: LibraryOverviewWidgetData | null;
  summary: StatisticsSummary | null;
  formats: FormatDistributionItem[];
  genres: GenreDistributionItem[];
  topAuthors: TopAuthorItem[];
  booksAdded: BooksAddedDataPoint[];
}

export async function fetchLibraryData(client: BookOrbitClient): Promise<LibraryData> {
  const [overview, summary, formats, genres, topAuthors, booksAdded] = await Promise.all([
    client.getLibraryOverview().catch(() => null),
    client.getLibrarySummary().catch(() => null),
    client.getFormatDistribution().catch(() => null),
    client.getGenreDistribution().catch(() => null),
    client.getTopAuthors().catch(() => null),
    client.getBooksAddedOverTime().catch(() => null),
  ]);
  const sortByCount = <T extends { count: number }>(items: T[]): T[] =>
    [...items].sort((a, b) => b.count - a.count);
  return {
    overview,
    summary,
    formats: sortByCount(formats?.items ?? []),
    genres: sortByCount(genres?.items ?? []),
    topAuthors: sortByCount(topAuthors?.items ?? []),
    booksAdded: booksAdded?.items ?? [],
  };
}

export function renderLibrary(data: LibraryData, generatedAt: string): string {
  const { overview, summary, formats, genres, topAuthors, booksAdded } = data;
  const parts: string[] = [];

  parts.push(
    frontmatter({
      tags: ["bookorbit", "library"],
      generated: generatedAt,
      "bookorbit-note": "library",
    }),
    "# 🗄 Library Stats",
    "",
    `> Synced ${generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}.`,
    "",
  );

  /* ---- Headline numbers ---- */
  const totalBooks = overview?.totalBooks ?? summary?.totalBooks ?? 0;
  const totalStorage = overview?.totalStorageBytes ?? summary?.totalStorageBytes ?? 0;
  const booksAddedThisYear = overview?.booksAddedThisYear ?? summary?.booksAddedThisYear ?? 0;
  parts.push("## Overview", "");
  parts.push(inlineField("total-books", totalBooks));
  parts.push(inlineField("total-authors", overview?.totalAuthors ?? summary?.totalAuthors ?? 0));
  parts.push(inlineField("total-series", overview?.totalSeries ?? summary?.totalSeries ?? 0));
  if (summary) parts.push(inlineField("total-genres", summary.totalGenres));
  if (summary) parts.push(inlineField("total-languages", summary.totalLanguages));
  parts.push(inlineField("total-storage", formatBytes(totalStorage)));
  parts.push(inlineField("books-added-this-year", booksAddedThisYear));
  if (summary?.publicationYearMin != null && summary?.publicationYearMax != null) {
    parts.push(inlineField("publication-year-range", `${summary.publicationYearMin}–${summary.publicationYearMax}`));
  }
  parts.push("");

  /* ---- Formats ---- */
  if (formats.length) {
    parts.push("## Formats", "");
    parts.push(mdTable(["Format", "Books"], formats.map((f) => [f.format, f.count])), "");
  }

  /* ---- Genres ---- */
  if (genres.length) {
    parts.push("## Genres (top 15)", "");
    parts.push(mdTable(["Genre", "Books"], genres.slice(0, 15).map((g) => [g.genre, g.count])), "");
  }

  /* ---- Top authors ---- */
  if (topAuthors.length) {
    parts.push("## Top Authors (top 15)", "");
    parts.push(mdTable(["Author", "Books"], topAuthors.slice(0, 15).map((a) => [a.name, a.count])), "");
  }

  /* ---- Books added over time ---- */
  if (booksAdded.length) {
    const byYear = new Map<number, number>();
    for (const p of booksAdded) byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.count);
    const rows = [...byYear.entries()].sort(([a], [b]) => a - b).map(([y, c]) => [y, c]);
    parts.push("## Books Added By Year", "");
    parts.push(mdTable(["Year", "Added"], rows), "");
  }

  return parts.join("\n");
}