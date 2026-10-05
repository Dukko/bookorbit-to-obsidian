import type { BookOrbitClient } from "../api.js";
import {
  frontmatter,
  formatDuration,
  formatHours,
  HEATMAP_CHARS,
  inlineField,
  intensityFor,
  isoDayKey,
  mdTable,
  monthAbbr,
  parseIsoDate,
} from "../markdown.js";
import type { UserDailyReadingStat } from "../types.js";

export interface HeatmapData {
  days: UserDailyReadingStat[]; // ordered by day ascending, trailing `days` window
  includeDailyTable: boolean;
}

export async function fetchHeatmapData(client: BookOrbitClient, windowDays: number): Promise<HeatmapData> {
  const days = await client.getReadingHeatmap(windowDays).catch(() => [] as UserDailyReadingStat[]);
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { days, includeDailyTable: true };
}

/** Build a GitHub-style contribution grid from daily stats. Columns = ISO weeks, rows = Mon..Sun. */
function renderContributionGrid(days: UserDailyReadingStat[]): string {
  if (!days.length) return "_No reading days in this window._";

  const byDay = new Map(days.map((d) => [d.day, d]));
  const first = parseIsoDate(days[0].day);
  const last = parseIsoDate(days[days.length - 1].day);
  const start = new Date(Date.UTC(first.year, first.month - 1, first.day));
  const monday = mondayOf(start);
  // End after the last day's week.
  const lastDate = new Date(Date.UTC(last.year, last.month - 1, last.day));
  const weeks: Date[] = [];
  for (const w = new Date(monday); w.getTime() <= lastDate.getTime(); w.setUTCDate(w.getUTCDate() + 7)) {
    weeks.push(new Date(w));
  }

  const maxMinutes = Math.max(...days.map((d) => d.readingSeconds / 60), 1);
  const dayIndex = new Map<number, string>([
    [1, "Mon"],
    [2, "Tue"],
    [3, "Wed"],
    [4, "Thu"],
    [5, "Fri"],
    [6, "Sat"],
    [0, "Sun"],
  ]);

  // Month labels: render the 3-letter month where a week starts that month.
  let prevMonth = -1;
  const monthHeader = weeks
    .map((w) => {
      const month = w.getUTCMonth() + 1;
      if (month !== prevMonth) {
        prevMonth = month;
        return monthAbbr(month).padEnd(2, " ");
      }
      return "  ";
    })
    .join("");

  const rows: string[] = [`\`\`\`\n${monthHeader}`];
  for (let dow = 1; dow <= 7; dow += 1) {
    const label = dayIndex.get(dow % 7) ?? "";
    const cells = weeks.map((weekStart) => {
      const date = new Date(weekStart);
      date.setUTCDate(weekStart.getUTCDate() + (dow % 7) - 1);
      const key = isoDayKey(date);
      if (key > days[days.length - 1].day || key < days[0].day) return " ";
      const stat = byDay.get(key);
      const minutes = stat ? stat.readingSeconds / 60 : 0;
      return HEATMAP_CHARS[intensityFor(minutes, maxMinutes)];
    });
    rows.push(`${label} ${cells.join("")}`);
  }
  rows.push("```");
  rows.push("");
  rows.push(`Legend: ${HEATMAP_CHARS.join(" ")} (least → most minutes)`);
  return rows.join("\n");
}

export function renderHeatmap(data: HeatmapData, generatedAt: string, windowDays: number): string {
  const { days } = data;
  const parts: string[] = [];

  const totalMinutes = days.reduce((sum, d) => sum + d.readingSeconds / 60, 0);
  const activeDays = days.filter((d) => d.readingSeconds > 0).length;
  const bestDay = days.reduce<UserDailyReadingStat | null>(
    (best, d) => (!best || d.readingSeconds > best.readingSeconds ? d : best),
    null,
  );

  parts.push(
    frontmatter({
      tags: ["bookorbit", "heatmap"],
      generated: generatedAt,
      "bookorbit-note": "heatmap",
      "heatmap-days": windowDays,
    }),
    "# 🔥 Reading Heatmap",
    "",
    `> Last ${windowDays} days of reading activity, synced ${generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}.`,
    "",
  );

  parts.push("## Summary", "");
  parts.push(inlineField("heatmap-total-time", formatHours(totalMinutes * 60) + "h"));
  parts.push(inlineField("heatmap-active-days", activeDays));
  parts.push(inlineField("heatmap-avg-daily-minutes", Math.round(totalMinutes / Math.max(days.length, 1))));
  if (bestDay) {
    parts.push(inlineField("heatmap-best-day", bestDay.day));
    parts.push(inlineField("heatmap-best-day-minutes", Math.round(bestDay.readingSeconds / 60)));
  }
  parts.push("");

  if (days.length) {
    /* ---- Monthly rollup ---- */
    const months = new Map<string, { minutes: number; days: number; sessions: number }>();
    for (const d of days) {
      const ym = d.day.slice(0, 7);
      const bucket = months.get(ym) ?? { minutes: 0, days: 0, sessions: 0 };
      bucket.minutes += d.readingSeconds / 60;
      if (d.readingSeconds > 0) bucket.days += 1;
      bucket.sessions += d.eventsCount;
      months.set(ym, bucket);
    }
    const monthRows = [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, m]) => [ym, Math.round(m.minutes), `${formatDuration(m.minutes * 60)}`, m.days, m.sessions]);

    parts.push("## By month", "");
    parts.push(mdTable(["Month", "Minutes", "Duration", "Active days", "Sessions"], monthRows), "");

    /* ---- Contribution grid ---- */
    parts.push("## Contribution grid", "");
    parts.push(renderContributionGrid(days), "");
  }

  /* ---- Daily table ---- */
  if (data.includeDailyTable) {
    const dailyRows = days
      .slice()
      .reverse()
      .map((d) => [
        d.day,
        Math.round(d.readingSeconds / 60),
        d.progressDelta,
        d.eventsCount,
        d.bySource && Object.keys(d.bySource).length
          ? Object.entries(d.bySource)
              .filter(([, s]) => s > 0)
              .map(([src, s]) => `${src}: ${Math.round(s / 60)}m`)
              .join(", ")
          : "—",
      ]);
    parts.push("## Daily log (newest first)", "");
    parts.push(mdTable(["Date", "Minutes", "Pages Δ", "Events", "By source"], dailyRows), "");
  }

  return parts.join("\n");
}

function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}