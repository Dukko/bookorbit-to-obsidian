/**
 * Type definitions for the BookOrbit API responses we consume.
 * Shapes mirror `@bookorbit/types` in the upstream repo (packages/types/src).
 */

/** Full credentials returned by a native-mode login/refresh (tokens in the body). */
export interface TokenCredentials {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: number | null;
}

export interface LoginResponse extends TokenCredentials {
  user: unknown;
}

export interface UserStatisticsSummary {
  trackedBooks: number;
  startedBooks: number;
  inProgressBooks: number;
  completedBooks: number;
  meanProgressPercent: number;
}

export interface UserDailyReadingStat {
  day: string; // YYYY-MM-DD
  readingSeconds: number;
  progressDelta: number;
  eventsCount: number;
  bySource?: Record<string, number>;
}

export interface UserCompletionTimelinePoint {
  year: number;
  month: number; // 1-12
  count: number;
}

export interface UserGenreReadingTimeItem {
  genre: string;
  readingSeconds: number;
  bySource: Record<string, number>;
}

export interface UserSessionTimelineItem {
  sessionId: number;
  bookId: number;
  bookTitle: string | null;
  bookFormat: string | null;
  bookSource: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

export interface UserSessionTimeline {
  year: number;
  week: number;
  weekStart: string;
  weekEnd: string;
  items: UserSessionTimelineItem[];
}

/* ------------------------------------------------------------------ */
/* Dashboard widgets                                                   */
/* ------------------------------------------------------------------ */

export interface ReadingGoalWidgetData {
  goalBooks: number | null;
  completedBooks: number;
  year: number;
}

export interface CurrentlyReadingBook {
  bookId: number;
  title: string | null;
  authors: string[];
  progress: number;
  hasCover: boolean;
  fileId: number | null;
  fileFormat: string | null;
  readFileId: number | null;
  readFileFormat: string | null;
  hasAudio: boolean;
}

export interface CurrentlyReadingWidgetData {
  books: CurrentlyReadingBook[];
}

export interface ReadingStreakWidgetData {
  currentStreak: number;
  longestStreak: number;
  lastSevenDays: boolean[];
}

export interface LibraryOverviewWidgetData {
  totalBooks: number;
  totalAuthors: number;
  totalSeries: number;
  totalStorageBytes: number;
  booksAddedThisYear: number;
}

export interface MonthlyChallengeWidgetData {
  challengeType: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  completed: boolean;
  month: number;
  year: number;
}

export interface YearProjectionWidgetData {
  projectedBooks: number;
  projectedPages: number;
  projectedHours: number;
  booksCompletedYtd: number;
  daysRemaining: number;
  trend: "up" | "down" | "stable";
}

export interface HighlightOfTheDayWidgetData {
  text: string;
  note: string | null;
  bookTitle: string | null;
  bookId: number;
  hasCover: boolean;
  chapterTitle: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Library statistics                                                  */
/* ------------------------------------------------------------------ */

export interface StatisticsSummary {
  totalBooks: number;
  totalAuthors: number;
  totalSeries: number;
  totalPublishers: number;
  totalStorageBytes: number;
  totalGenres: number;
  totalLanguages: number;
  publicationYearMin: number | null;
  publicationYearMax: number | null;
  booksAddedThisYear: number;
}

export interface StatisticsResult<T> {
  items: T[];
  unknownCount: number;
}

export interface FormatDistributionItem {
  format: string;
  count: number;
}

export interface GenreDistributionItem {
  genre: string;
  count: number;
}

export interface TopAuthorItem {
  name: string;
  count: number;
}

export interface BooksAddedDataPoint {
  year: number;
  month: number;
  count: number;
}

/* ------------------------------------------------------------------ */
/* Library shelves / scrollers                                         */
/* ------------------------------------------------------------------ */

export interface BookCard {
  id: number;
  status: string;
  title: string | null;
  authors: string[];
  genres: string[];
  rating: number | null;
  readingProgress: number | null;
  readStatus: string | null;
  addedAt: string;
  pageCount: number | null;
  publishedYear: number | null;
  language: string | null;
}

export interface DashboardScrollerResponse {
  books: BookCard[];
  total: number | null;
}

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* ------------------------------------------------------------------ */

export interface AnnotationItem {
  id: number;
  bookId: number;
  text: string;
  note: string | null;
  color: string;
  style: string;
  chapterTitle: string | null;
  origin: "web" | "koreader" | "kobo";
  highlightedAt: string;
  createdAt: string;
}

export interface AnnotationHubItem extends AnnotationItem {
  bookTitle: string | null;
  author: string | null;
  deletedAt: string | null;
  jumpFileFormat: string | null;
}

export interface AnnotationHubStats {
  books: number;
  withNotes: number;
  originBreakdown: { origin: string; count: number }[];
}

export interface AnnotationHubResponse {
  items: AnnotationHubItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: AnnotationHubStats;
}

export interface AnnotationHubBookFacet {
  bookId: number;
  bookTitle: string | null;
  author: string | null;
  count: number;
}