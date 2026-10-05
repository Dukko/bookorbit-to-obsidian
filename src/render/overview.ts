import type { BookOrbitClient } from "../api.js";
import { frontmatter, inlineField, mdTable } from "../markdown.js";
import type {
  CurrentlyReadingWidgetData,
  HighlightOfTheDayWidgetData,
  MonthlyChallengeWidgetData,
  ReadingGoalWidgetData,
  ReadingStreakWidgetData,
  UserStatisticsSummary,
  YearProjectionWidgetData,
} from "../types.js";

export interface OverviewData {
  summary: UserStatisticsSummary;
  goal: ReadingGoalWidgetData | null;
  streak: ReadingStreakWidgetData | null;
  currentlyReading: CurrentlyReadingWidgetData | null;
  challenge: MonthlyChallengeWidgetData | null;
  projection: YearProjectionWidgetData | null;
  highlightOfTheDay: HighlightOfTheDayWidgetData | null;
}

export async function fetchOverviewData(client: BookOrbitClient): Promise<OverviewData> {
  const [summary, goal, streak, currentlyReading, challenge, projection, highlightOfTheDay] = await Promise.all([
    client.getUserSummary().catch(() => null),
    client.getReadingGoal().catch(() => null),
    client.getReadingStreak().catch(() => null),
    client.getCurrentlyReading().catch(() => null),
    client.getMonthlyChallenge().catch(() => null),
    client.getYearProjection().catch(() => null),
    client.getHighlightOfTheDay().catch(() => null),
  ]);
  return {
    summary: summary ?? {
      trackedBooks: 0,
      startedBooks: 0,
      inProgressBooks: 0,
      completedBooks: 0,
      meanProgressPercent: 0,
    },
    goal,
    streak,
    currentlyReading,
    challenge,
    projection,
    highlightOfTheDay,
  };
}

function streakLine(days: boolean[]): string {
  return days
    .map((read, i) => `${i === days.length - 1 ? "today " : ""}${read ? "▰" : "▱"}`)
    .join(" ");
}

export function renderOverview(data: OverviewData, generatedAt: string): string {
  const { summary, goal, streak, currentlyReading, challenge, projection, highlightOfTheDay } = data;
  const parts: string[] = [];

  parts.push(
    frontmatter({
      tags: ["bookorbit", "dashboard"],
      generated: generatedAt,
      "bookorbit-note": "overview",
    }),
    "# 📊 BookOrbit Dashboard",
    "",
    `> Synced ${generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}`,
    "",
  );

  /* ---- Reading stats ---- */
  parts.push("## Reading Stats", "");
  parts.push(inlineField("tracked-books", summary.trackedBooks));
  parts.push(inlineField("started-books", summary.startedBooks));
  parts.push(inlineField("in-progress-books", summary.inProgressBooks));
  parts.push(inlineField("completed-books", summary.completedBooks));
  parts.push(inlineField("mean-progress-percent", `${summary.meanProgressPercent}%`));
  parts.push("");

  /* ---- Reading goal ---- */
  if (goal) {
    parts.push("## 🎯 Reading Goal", "");
    parts.push(inlineField("goal-books", goal.goalBooks ?? "no goal set"));
    parts.push(inlineField("goal-completed", goal.completedBooks));
    parts.push(inlineField("goal-year", goal.year));
    if (goal.goalBooks) {
      parts.push(
        "",
        `Progress: ${goal.completedBooks} / ${goal.goalBooks} ` +
          `(${Math.round((goal.completedBooks / goal.goalBooks) * 100)}%)`,
      );
    }
    parts.push("");
  }

  /* ---- Streak ---- */
  if (streak) {
    parts.push("## 🔥 Reading Streak", "");
    parts.push(inlineField("current-streak", streak.currentStreak));
    parts.push(inlineField("longest-streak", streak.longestStreak));
    parts.push("", `Last 7 days:  ${streakLine(streak.lastSevenDays)}`, "");
  }

  /* ---- Currently reading ---- */
  if (currentlyReading && currentlyReading.books.length) {
    parts.push("## 📖 Currently Reading", "");
    const rows = currentlyReading.books.map((b) => [
      b.title ?? "(untitled)",
      b.authors.join(", ") || "—",
      `${Math.round(b.progress)}%`,
      b.fileFormat ?? "—",
    ]);
    parts.push(mdTable(["Book", "Author(s)", "Progress", "Format"], rows), "");
  }

  /* ---- Monthly challenge ---- */
  if (challenge) {
    parts.push("## 🏅 Monthly Challenge", "");
    parts.push(inlineField("challenge-title", challenge.title));
    parts.push(inlineField("challenge-progress", `${challenge.progress}/${challenge.target}`));
    parts.push(inlineField("challenge-completed", challenge.completed));
    parts.push("", challenge.description, "");
  }

  /* ---- Year projection ---- */
  if (projection) {
    parts.push("## 📈 Year Projection", "");
    parts.push(inlineField("projected-books", projection.projectedBooks));
    parts.push(inlineField("projected-hours", projection.projectedHours));
    parts.push(inlineField("projected-pages", projection.projectedPages));
    parts.push(inlineField("books-completed-ytd", projection.booksCompletedYtd));
    parts.push(inlineField("days-remaining", projection.daysRemaining));
    parts.push(inlineField("projection-trend", projection.trend));
    parts.push("");
  }

  /* ---- Highlight of the day ---- */
  if (highlightOfTheDay) {
    parts.push("## 🖍 Highlight of the Day", "");
    parts.push(`> ${highlightOfTheDay.text}`);
    if (highlightOfTheDay.note) parts.push("", `> — *${highlightOfTheDay.note}*`);
    if (highlightOfTheDay.bookTitle) {
      parts.push("", `— ${highlightOfTheDay.bookTitle}${highlightOfTheDay.chapterTitle ? ` · ${highlightOfTheDay.chapterTitle}` : ""}`);
    }
    parts.push("");
  }

  /* ---- Navigation ---- */
  parts.push(
    "## Related notes",
    "",
    "- [[Reading Heatmap]] — daily reading time",
    "- [[Reading Log]] — currently reading, recent sessions, finishes",
    "- [[Library Stats]] — formats, genres, authors",
    "- [[Highlights]] — annotations & highlights",
    "",
  );

  return parts.join("\n");
}