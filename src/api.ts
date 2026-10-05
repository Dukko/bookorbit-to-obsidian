/**
 * BookOrbit REST client. Auth flow:
 *
 *   POST /auth/login {username, password, clientKind:'native', deviceLabel}  -> full credentials
 *   POST /auth/refresh {refreshToken}                                        -> rotated credentials
 *
 * The access token is sent as `Authorization: Bearer <token>`. Because login
 * is issued with `clientKind: 'native'`, the refresh token comes back in the
 * response body (not just a cookie), so we can persist it and reuse it across
 * runs. Each successful refresh *rotates* the session's refresh token and
 * slides its 7-day lifetime, so an hourly cron keeps one session alive forever
 * instead of logging in every hour.
 *
 * Token flow per client instance, in order:
 *   1. reuse an in-memory access token if still valid (< 30 s from expiry),
 *   2. exchange a persisted refresh token for fresh credentials,
 *   3. fall back to a full login (first run, expired session, revoked token).
 * On any 401 from the API we re-enter that flow once and retry the request.
 */

import { loadSessionFile, saveSessionFile } from "./session-store.js";
import type {
  AnnotationHubItem,
  AnnotationHubResponse,
  BooksAddedDataPoint,
  CurrentlyReadingWidgetData,
  DashboardScrollerResponse,
  FormatDistributionItem,
  GenreDistributionItem,
  HighlightOfTheDayWidgetData,
  LibraryOverviewWidgetData,
  LoginResponse,
  MonthlyChallengeWidgetData,
  ReadingGoalWidgetData,
  ReadingStreakWidgetData,
  StatisticsResult,
  StatisticsSummary,
  TokenCredentials,
  TopAuthorItem,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserGenreReadingTimeItem,
  UserSessionTimeline,
  UserSessionTimelineItem,
  UserStatisticsSummary,
  YearProjectionWidgetData,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_SKEW_MS = 30_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  accept?: string;
}

export interface ClientOptions {
  /** Path to the persisted session file (opaque JSON, mode 0600). */
  sessionFile?: string;
  /** Label shown in BookOrbit's Sessions list for this device. */
  deviceLabel?: string;
}

export class BookOrbitClient {
  private readonly baseUrl: string;
  private readonly sessionFile?: string;
  private readonly deviceLabel: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private sessionBusy: Promise<void> | null = null;

  constructor(
    base: string,
    private readonly username: string,
    private readonly password: string,
    options: ClientOptions = {},
  ) {
    this.baseUrl = `${base.replace(/\/+$/, "")}/api/v1`;
    this.sessionFile = options.sessionFile;
    this.deviceLabel = options.deviceLabel ?? "bookorbit-to-obsidian sync";
  }

  /* ------------------------------------------------------------------ */
  /* Session management                                                  */
  /* ------------------------------------------------------------------ */

  /** Ensure we hold a usable access token: in-memory → refresh → login. */
  async ensureSession(): Promise<void> {
    if (this.sessionBusy) return this.sessionBusy;
    this.sessionBusy = this.doEnsureSession().finally(() => {
      this.sessionBusy = null;
    });
    return this.sessionBusy;
  }

  private async doEnsureSession(): Promise<void> {
    if (this.accessToken && this.tokenExpiresAt !== null && Date.now() < this.tokenExpiresAt - TOKEN_SKEW_MS) {
      return;
    }
    if (this.sessionFile) {
      const stored = await loadSessionFile(this.sessionFile);
      if (stored) {
        // Reuse the persisted access token when it is still valid (avoids a
        // refresh call on every run, and keeps the session alive regardless).
        const exp = Date.parse(stored.accessTokenExpiresAt);
        if (Number.isFinite(exp) && exp > Date.now() + TOKEN_SKEW_MS) {
          this.accessToken = stored.accessToken;
          this.tokenExpiresAt = exp;
          return;
        }
        if (stored.refreshToken) {
          try {
            await this.exchangeRefresh(stored.refreshToken);
            return;
          } catch {
            // Stale/expired/revoked — fall through to a fresh login.
          }
        }
      }
    }
    await this.login();
  }

  private async login(): Promise<void> {
    const res = await this.rawFetch("/auth/login", {
      method: "POST",
      body: {
        username: this.username,
        password: this.password,
        clientKind: "native",
        deviceLabel: this.deviceLabel,
      },
    });
    if (!res.ok) {
      throw new ApiError(`Login failed (${res.status}). Check BOOKORBIT_URL / credentials.`, res.status);
    }
    const data = (await res.json()) as LoginResponse;
    if (!data.accessToken || !data.refreshToken) {
      throw new ApiError("Login succeeded but no tokens were returned (server too old for native mode?).");
    }
    await this.applyCredentials(data);
  }

  private async exchangeRefresh(refreshToken: string): Promise<void> {
    const res = await this.rawFetch("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });
    if (!res.ok) {
      throw new ApiError(`Refresh failed (${res.status}).`, res.status);
    }
    const data = (await res.json()) as TokenCredentials;
    await this.applyCredentials(data);
  }

  private async applyCredentials(creds: TokenCredentials): Promise<void> {
    this.accessToken = creds.accessToken;
    const exp = Date.parse(creds.accessTokenExpiresAt);
    this.tokenExpiresAt = Number.isFinite(exp) ? exp : null;
    if (this.sessionFile) {
      await saveSessionFile(this.sessionFile, creds);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Request plumbing                                                    */
  /* ------------------------------------------------------------------ */

  private async rawFetch(path: string, opts: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { Accept: opts.accept ?? "application/json" };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
      return await fetch(`${this.baseUrl}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(path: string, opts: RequestOptions = {}, retried = false): Promise<Response> {
    await this.ensureSession();
    const res = await this.rawFetch(path, opts);
    if (res.status === 401 && !retried) {
      this.accessToken = null;
      this.tokenExpiresAt = null;
      await this.ensureSession();
      return this.request(path, opts, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(
        `${opts.method ?? "GET"} ${path} failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
        res.status,
      );
    }
    return res;
  }

  private async getJSON<T>(path: string): Promise<T> {
    const res = await this.request(path);
    return (await res.json()) as T;
  }

  private async getText(path: string): Promise<string> {
    const res = await this.request(path, { accept: "*/*" });
    return res.text();
  }

  /* ------------------------------------------------------------------ */
  /* Reading / user statistics                                           */
  /* ------------------------------------------------------------------ */

  getUserSummary(): Promise<UserStatisticsSummary> {
    return this.getJSON("/user-statistics/summary");
  }

  /** `days` is a trailing window (e.g. 365 = last year). */
  getReadingHeatmap(days: number): Promise<UserDailyReadingStat[]> {
    return this.getJSON(`/user-statistics/reading-heatmap?days=${days}`);
  }

  getCompletionTimeline(days: number): Promise<UserCompletionTimelinePoint[]> {
    return this.getJSON(`/user-statistics/completion-timeline?days=${days}`);
  }

  getGenreReadingTime(days: number): Promise<UserGenreReadingTimeItem[]> {
    return this.getJSON(`/user-statistics/genre-reading-time?days=${days}`);
  }

  getSessionTimeline(year: number, week: number): Promise<UserSessionTimeline> {
    return this.getJSON(`/user-statistics/session-timeline?year=${year}&week=${week}`);
  }

  /** Raw reading sessions across the last `weeks` ISO weeks, deduped and chronological. */
  async getRecentSessions(weeks = 4): Promise<UserSessionTimelineItem[]> {
    const now = new Date();
    const monday = mondayOfUtc(now);
    const byId = new Map<number, UserSessionTimelineItem>();
    for (let offset = 0; offset < weeks; offset += 1) {
      const weekStart = new Date(monday);
      weekStart.setUTCDate(monday.getUTCDate() - 7 * offset);
      const { year, week } = isoWeekOf(weekStart);
      const timeline = await this.getSessionTimeline(year, week).catch(() => null);
      for (const item of timeline?.items ?? []) {
        if (!byId.has(item.sessionId)) byId.set(item.sessionId, item);
      }
    }
    return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard widgets                                                   */
  /* ------------------------------------------------------------------ */

  getReadingGoal(): Promise<ReadingGoalWidgetData> {
    return this.getJSON("/dashboard/widgets/reading-goal");
  }

  getCurrentlyReading(): Promise<CurrentlyReadingWidgetData> {
    return this.getJSON("/dashboard/widgets/currently-reading");
  }

  getReadingStreak(): Promise<ReadingStreakWidgetData> {
    return this.getJSON("/dashboard/widgets/reading-streak");
  }

  getLibraryOverview(): Promise<LibraryOverviewWidgetData> {
    return this.getJSON("/dashboard/widgets/library-overview");
  }

  getMonthlyChallenge(): Promise<MonthlyChallengeWidgetData> {
    return this.getJSON("/dashboard/widgets/monthly-challenge");
  }

  getYearProjection(): Promise<YearProjectionWidgetData> {
    return this.getJSON("/dashboard/widgets/year-projection");
  }

  getHighlightOfTheDay(): Promise<HighlightOfTheDayWidgetData | null> {
    return this.getJSON("/dashboard/widgets/highlight-of-the-day");
  }

  getScroller(type: string, limit: number): Promise<DashboardScrollerResponse> {
    return this.getJSON(`/dashboard/scrollers/${type}?limit=${limit}`);
  }

  /* ------------------------------------------------------------------ */
  /* Library statistics                                                  */
  /* ------------------------------------------------------------------ */

  getLibrarySummary(): Promise<StatisticsSummary> {
    return this.getJSON("/statistics/summary");
  }

  getFormatDistribution(): Promise<StatisticsResult<FormatDistributionItem>> {
    return this.getJSON("/statistics/format-distribution");
  }

  getGenreDistribution(): Promise<StatisticsResult<GenreDistributionItem>> {
    return this.getJSON("/statistics/genre-distribution");
  }

  getTopAuthors(): Promise<StatisticsResult<TopAuthorItem>> {
    return this.getJSON("/statistics/top-authors");
  }

  getBooksAddedOverTime(): Promise<StatisticsResult<BooksAddedDataPoint>> {
    return this.getJSON("/statistics/books-added-over-time?granularity=yearly&range=all-time");
  }

  /* ------------------------------------------------------------------ */
  /* Annotations                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * All active annotations across the library, paged through the annotation
   * hub (each item already carries its book title + author).
   */
  async listAllAnnotations(): Promise<AnnotationHubItem[]> {
    const items: AnnotationHubItem[] = [];
    const pageSize = 100;
    let page = 1;
    // Safety cap: 100 pages × 100 items = 10k highlights max.
    for (let guard = 0; guard < 100; guard += 1) {
      const res = await this.getJSON<AnnotationHubResponse>(`/annotations?page=${page}&pageSize=${pageSize}`);
      items.push(...res.items);
      if (items.length >= res.total || res.items.length === 0) break;
      page += 1;
    }
    return items;
  }

  /** Deprecated convenience kept for scripts that want the raw built-in export. */
  getAnnotationsMarkdown(): Promise<string> {
    return this.getText("/annotations/export?format=md");
  }
}

/* ISO week helpers reused from markdown.ts (kept local to avoid a circular import). */
function mondayOfUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function isoWeekOf(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}