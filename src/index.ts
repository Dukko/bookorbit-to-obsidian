#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BookOrbitClient } from "./api.js";
import { loadConfig, loadEnvFile, type Config, type NoteName } from "./config.js";
import { fetchBooksData, renderBooks } from "./render/books.js";
import { fetchHeatmapData, renderHeatmap } from "./render/heatmap.js";
import { fetchHighlightsData, writeHighlights } from "./render/highlights.js";
import { fetchLibraryData, renderLibrary } from "./render/library.js";
import { fetchOverviewData, renderOverview } from "./render/overview.js";
import { writeFileAtomic } from "./writer.js";

const DEFAULT_FILENAMES: Record<NoteName, string> = {
  overview: "BookOrbit Dashboard.md",
  heatmap: "Reading Heatmap.md",
  books: "Reading Log.md",
  library: "Library Stats.md",
  highlights: "Highlights.md",
};

interface JobResult {
  path: string;
  content: string;
}

type Job = {
  name: NoteName;
  render: () => Promise<JobResult>;
};

function buildJobs(client: BookOrbitClient, config: Config): Job[] {
  const jobs: Job[] = [];
  const selected = config.only ?? (["overview", "heatmap", "books", "library", "highlights"] as NoteName[]);
  const want = new Set(selected);
  const outDir = () => join(config.vaultPath, config.outputDir);
  const generatedAt = () => new Date().toISOString();

  if (want.has("overview")) {
    jobs.push({
      name: "overview",
      render: async () => {
        const data = await fetchOverviewData(client);
        const content = renderOverview(data, generatedAt());
        return { path: join(outDir(), DEFAULT_FILENAMES.overview), content };
      },
    });
  }
  if (want.has("heatmap")) {
    jobs.push({
      name: "heatmap",
      render: async () => {
        const data = await fetchHeatmapData(client, config.heatmapDays);
        const content = renderHeatmap(data, generatedAt(), config.heatmapDays);
        return { path: join(outDir(), DEFAULT_FILENAMES.heatmap), content };
      },
    });
  }
  if (want.has("books")) {
    jobs.push({
      name: "books",
      render: async () => {
        const data = await fetchBooksData(client, { showWantToRead: config.showWantToRead });
        const content = renderBooks(data, generatedAt());
        return { path: join(outDir(), DEFAULT_FILENAMES.books), content };
      },
    });
  }
  if (want.has("library")) {
    jobs.push({
      name: "library",
      render: async () => {
        const data = await fetchLibraryData(client);
        const content = renderLibrary(data, generatedAt());
        return { path: join(outDir(), DEFAULT_FILENAMES.library), content };
      },
    });
  }
  if (want.has("highlights")) {
    jobs.push({
      name: "highlights",
      // The highlights job writes the index AND one note per book, and prunes
      // stale generated notes — so it writes itself and returns the index path.
      render: async () => {
        const data = await fetchHighlightsData(client);
        const index = await writeHighlights(data, outDir(), generatedAt());
        const content = await readFile(index, "utf8");
        return { path: index, content };
      },
    });
  }
  return jobs;
}

function log(config: Config, message: string): void {
  if (!config.quiet) console.log(message);
}

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig(process.argv.slice(2));
  const client = new BookOrbitClient(config.url, config.username, config.password, {
    sessionFile: config.sessionFile,
    deviceLabel: config.deviceLabel,
  });

  log(config, `→ Connecting to ${config.url} as ${config.username} …`);
  try {
    await client.ensureSession();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  log(config, "✓ Authenticated");

  const jobs = buildJobs(client, config);
  const outDir = join(config.vaultPath, config.outputDir);
  log(config, `→ Rendering ${jobs.length} note(s) into ${outDir}`);

  let ok = 0;
  let failed = 0;
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      const { path, content } = await job.render();
      await writeFileAtomic(path, content);
      return path;
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      ok += 1;
      log(config, `  ✓ ${result.value}`);
    } else {
      failed += 1;
      console.error(`  ✗ ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  }

  if (failed === 0) {
    log(config, `\nDone — ${ok} note(s) written. Open Obsidian to see them.`);
  } else {
    console.error(`\n${failed} note(s) failed while ${ok} succeeded.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});