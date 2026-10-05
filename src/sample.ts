/**
 * Generate sample Markdown output with synthetic data — no BookOrbit server
 * needed. Useful to preview the note formats before wiring real credentials.
 *
 *   npm run sample
 *
 * Writes into ./sample-out/ (gitignored).
 */
import { join } from "node:path";
import { isoDayKey } from "./markdown.js";
import { renderBooks } from "./render/books.js";
import { renderHeatmap } from "./render/heatmap.js";
import { renderBookHighlightNote, renderHighlightsIndex } from "./render/highlights.js";
import { renderLibrary } from "./render/library.js";
import { renderOverview } from "./render/overview.js";
import type {
  AnnotationHubItem,
  BookCard,
  BooksAddedDataPoint,
  CurrentlyReadingWidgetData,
  DashboardScrollerResponse,
  FormatDistributionItem,
  GenreDistributionItem,
  HighlightOfTheDayWidgetData,
  LibraryOverviewWidgetData,
  MonthlyChallengeWidgetData,
  ReadingGoalWidgetData,
  ReadingStreakWidgetData,
  StatisticsSummary,
  TopAuthorItem,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserSessionTimelineItem,
  UserStatisticsSummary,
  YearProjectionWidgetData,
} from "./types.js";
import { writeFileAtomic } from "./writer.js";

/* Deterministic PRNG so sample output is stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

/* ------------------------------------------------------------------ */
/* Synthetic data                                                      */
/* ------------------------------------------------------------------ */

function makeDailyStats(days = 365): UserDailyReadingStat[] {
  const stats: UserDailyReadingStat[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.getUTCDay();
    const weekendBoost = day === 0 || day === 6 ? 1.6 : 1;
    // ~12% of days have no reading at all.
    const minutes = rand() < 0.12 ? 0 : between(5, 95) * weekendBoost;
    const seconds = Math.round(minutes * 60);
    stats.push({
      day: isoDayKey(d),
      readingSeconds: seconds,
      progressDelta: seconds > 0 ? between(1, 40) : 0,
      eventsCount: seconds > 0 ? between(1, 6) : 0,
      bySource: seconds > 0 ? { web: Math.round(seconds * 0.5), koreader: Math.round(seconds * 0.3), kobo: Math.round(seconds * 0.2) } : undefined,
    });
  }
  return stats;
}

const summary: UserStatisticsSummary = {
  trackedBooks: 128,
  startedBooks: 101,
  inProgressBooks: 4,
  completedBooks: 97,
  meanProgressPercent: 61,
};

const goal: ReadingGoalWidgetData = { goalBooks: 24, completedBooks: 18, year: 2026 };

const streak: ReadingStreakWidgetData = {
  currentStreak: 6,
  longestStreak: 31,
  lastSevenDays: [false, true, true, true, true, true, true],
};

const currentlyReading: CurrentlyReadingWidgetData = {
  books: [
    { bookId: 1, title: "The Left Hand of Darkness", authors: ["Ursula K. Le Guin"], progress: 72, hasCover: true, fileId: 11, fileFormat: "EPUB", readFileId: 11, readFileFormat: "EPUB", hasAudio: false },
    { bookId: 2, title: "Project Hail Mary", authors: ["Andy Weir"], progress: 41, hasCover: true, fileId: 12, fileFormat: "AUDIOBOOK", readFileId: null, readFileFormat: null, hasAudio: true },
    { bookId: 3, title: "Dune", authors: ["Frank Herbert"], progress: 18, hasCover: true, fileId: 13, fileFormat: "PDF", readFileId: 13, readFileFormat: "PDF", hasAudio: false },
  ],
};

const challenge: MonthlyChallengeWidgetData = {
  challengeType: "genre-explorer",
  title: "Read a hard science-fiction book",
  description: "Finish a book from a genre you haven't touched this month.",
  progress: 1,
  target: 1,
  completed: true,
  month: 10,
  year: 2026,
};

const projection: YearProjectionWidgetData = {
  projectedBooks: 27,
  projectedPages: 8900,
  projectedHours: 312,
  booksCompletedYtd: 18,
  daysRemaining: 85,
  trend: "up",
};

const highlightOfTheDay: HighlightOfTheDayWidgetData = {
  text: "It is good to have an end to journey toward; but it is the journey that matters, in the end.",
  note: null,
  bookTitle: "The Left Hand of Darkness",
  bookId: 1,
  hasCover: true,
  chapterTitle: "Chapter 5",
  createdAt: "2026-10-04T19:23:00.000Z",
};

const wantToReadBooks: BookCard[] = [
  { id: 101, status: "ok", title: "Hyperion", authors: ["Dan Simmons"], genres: ["Science Fiction"], rating: null, readingProgress: null, readStatus: "WANT_TO_READ", addedAt: "2026-08-01T00:00:00.000Z", pageCount: 482, publishedYear: 1989, language: "English" },
  { id: 102, status: "ok", title: "The Name of the Wind", authors: ["Patrick Rothfuss"], genres: ["Fantasy"], rating: null, readingProgress: null, readStatus: "WANT_TO_READ", addedAt: "2026-07-12T00:00:00.000Z", pageCount: 662, publishedYear: 2007, language: "English" },
  { id: 103, status: "ok", title: "The Three-Body Problem", authors: ["Cixin Liu"], genres: ["Science Fiction"], rating: null, readingProgress: null, readStatus: "WANT_TO_READ", addedAt: "2026-09-20T00:00:00.000Z", pageCount: 302, publishedYear: 2008, language: "English" },
];

const wantToReadScroller: DashboardScrollerResponse = { books: wantToReadBooks, total: 9 };

const recentSessions: UserSessionTimelineItem[] = [
  { sessionId: 9001, bookId: 1, bookTitle: "The Left Hand of Darkness", bookFormat: "EPUB", bookSource: "koreader", startedAt: "2026-10-04T20:05:00.000Z", endedAt: "2026-10-04T20:47:00.000Z", durationSeconds: 2520 },
  { sessionId: 9002, bookId: 2, bookTitle: "Project Hail Mary", bookFormat: "AUDIOBOOK", bookSource: "web", startedAt: "2026-10-05T07:12:00.000Z", endedAt: "2026-10-05T07:58:00.000Z", durationSeconds: 2760 },
  { sessionId: 9003, bookId: 1, bookTitle: "The Left Hand of Darkness", bookFormat: "EPUB", bookSource: "koreader", startedAt: "2026-10-05T21:01:00.000Z", endedAt: "2026-10-05T21:40:00.000Z", durationSeconds: 2340 },
];

const completionTimeline: UserCompletionTimelinePoint[] = (() => {
  const points: UserCompletionTimelinePoint[] = [];
  for (let y = 2022; y <= 2026; y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      if (y === 2026 && m > 10) continue;
      const count = y === 2022 ? between(2, 6) : between(3, 9);
      points.push({ year: y, month: m, count });
    }
  }
  return points;
})();

const libraryOverview: LibraryOverviewWidgetData = {
  totalBooks: 128,
  totalAuthors: 86,
  totalSeries: 31,
  totalStorageBytes: 14_221_447_168,
  booksAddedThisYear: 22,
};

const librarySummary: StatisticsSummary = {
  totalBooks: 128,
  totalAuthors: 86,
  totalSeries: 31,
  totalPublishers: 74,
  totalStorageBytes: 14_221_447_168,
  totalGenres: 18,
  totalLanguages: 6,
  publicationYearMin: 1942,
  publicationYearMax: 2025,
  booksAddedThisYear: 22,
};

const formats: FormatDistributionItem[] = [
  { format: "EPUB", count: 89 },
  { format: "AUDIOBOOK", count: 21 },
  { format: "PDF", count: 12 },
  { format: "COMIC", count: 6 },
];

const genres: GenreDistributionItem[] = [
  { genre: "Science Fiction", count: 34 },
  { genre: "Fantasy", count: 28 },
  { genre: "Nonfiction", count: 19 },
  { genre: "Mystery", count: 12 },
  { genre: "Romance", count: 9 },
  { genre: "History", count: 7 },
  { genre: "Poetry", count: 4 },
  { genre: "Horror", count: 3 },
];

const topAuthors: TopAuthorItem[] = [
  { name: "Ursula K. Le Guin", count: 9 },
  { name: "Terry Pratchett", count: 7 },
  { name: "Isaac Asimov", count: 6 },
  { name: "Agatha Christie", count: 5 },
  { name: "Andy Weir", count: 4 },
];

const booksAdded: BooksAddedDataPoint[] = (() => {
  const points: BooksAddedDataPoint[] = [];
  for (let y = 2021; y <= 2026; y += 1) {
    const m = y === 2026 ? 10 : 12;
    for (let i = 1; i <= m; i += 1) {
      points.push({ year: y, month: i, count: between(1, 14) });
    }
  }
  return points;
})();

const annotationsSample: AnnotationHubItem[] = [
  {
    id: 5001,
    bookId: 1,
    text: "The only thing that makes life possible is permanent, intolerable uncertainty: not knowing what comes next.",
    note: null,
    color: "yellow",
    style: "highlight",
    chapterTitle: "Chapter 3",
    origin: "koreader",
    highlightedAt: "2026-09-12T19:02:00.000Z",
    createdAt: "2026-09-12T19:02:11.000Z",
    bookTitle: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    deletedAt: null,
    jumpFileFormat: null,
  },
  {
    id: 5002,
    bookId: 1,
    text: "When action grows unprofitable, gather information; when information grows unprofitable, sleep.",
    note: "A good rule for pacing long projects.",
    color: "green",
    style: "highlight",
    chapterTitle: "Chapter 8",
    origin: "koreader",
    highlightedAt: "2026-09-19T21:34:00.000Z",
    createdAt: "2026-09-19T21:34:05.000Z",
    bookTitle: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    deletedAt: null,
    jumpFileFormat: null,
  },
  {
    id: 5003,
    bookId: 2,
    text: "There's nothing in a caterpillar that tells you it's going to be a butterfly.",
    note: null,
    color: "blue",
    style: "highlight",
    chapterTitle: null,
    origin: "web",
    highlightedAt: "2026-10-01T08:15:00.000Z",
    createdAt: "2026-10-01T08:15:33.000Z",
    bookTitle: "Project Hail Mary",
    author: "Andy Weir",
    deletedAt: null,
    jumpFileFormat: null,
  },
  {
    id: 5004,
    bookId: 2,
    text: "I have a bad feeling about this.",
    note: "Classic.",
    color: "red",
    style: "highlight",
    chapterTitle: "Chapter 22",
    origin: "web",
    highlightedAt: "2026-10-03T22:40:00.000Z",
    createdAt: "2026-10-03T22:40:12.000Z",
    bookTitle: "Project Hail Mary",
    author: "Andy Weir",
    deletedAt: null,
    jumpFileFormat: null,
  },
];

function buildHighlightsData() {
  const byBook = new Map<number, AnnotationHubItem[]>();
  for (const item of annotationsSample) {
    const list = byBook.get(item.bookId) ?? [];
    list.push(item);
    byBook.set(item.bookId, list);
  }
  const books = [...byBook.entries()]
    .map(([bookId, highlights]) => {
      const first = highlights[0];
      return {
        bookId,
        title: first.bookTitle,
        author: first.author,
        highlights: [...highlights].sort((a, b) => a.highlightedAt.localeCompare(b.highlightedAt)),
      };
    })
    .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  return {
    highlightOfTheDay,
    books,
    totalHighlights: annotationsSample.length,
    totalWithNotes: annotationsSample.filter((a) => a.note).length,
  };
}

/* ------------------------------------------------------------------ */
/* Render + write                                                      */
/* ------------------------------------------------------------------ */

const generatedAt = "2026-10-05T06:00:00.000Z";

const files: Array<[string, string]> = [
  ["BookOrbit Dashboard.md", renderOverview({
    summary,
    goal,
    streak,
    currentlyReading,
    challenge,
    projection,
    highlightOfTheDay,
  }, generatedAt)],
  ["Reading Heatmap.md", renderHeatmap({ days: makeDailyStats(365), includeDailyTable: false }, generatedAt, 365)],
  ["Reading Log.md", renderBooks({
    summary,
    currentlyReading,
    wantToRead: wantToReadScroller,
    recentSessions,
    completionTimeline,
  }, generatedAt)],
  ["Library Stats.md", renderLibrary({
    overview: libraryOverview,
    summary: librarySummary,
    formats,
    genres,
    topAuthors,
    booksAdded,
  }, generatedAt)],
];

// Highlights: index + one note per annotated book.
const highlightsData = buildHighlightsData();
const highlightsIndex = renderHighlightsIndex(highlightsData, generatedAt);
const highlightBooks: Array<[string, string]> = highlightsData.books.map((book) => {
  const slug = book.title ?? `Book ${book.bookId}`;
  return [`Highlights/${slug}-${book.bookId}.md`, renderBookHighlightNote(book, generatedAt)];
});
const allFiles: Array<[string, string]> = [
  ...files,
  ["Highlights.md", highlightsIndex],
  ...highlightBooks,
];

const outDir = join(process.cwd(), "sample-out");
console.log(`Writing sample notes into ${outDir}\n`);
for (const [name, content] of allFiles) {
  const path = join(outDir, name);
  await writeFileAtomic(path, content);
  console.log(`  ✓ ${path}`);
}
console.log("\nDone. Open these in Obsidian (or any Markdown viewer) to preview the format.");