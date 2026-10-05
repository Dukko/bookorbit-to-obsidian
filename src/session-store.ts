/**
 * Persistent storage for the BookOrbit session credentials.
 *
 * The refresh token is as sensitive as a password (it can mint access tokens
 * until it expires or is revoked), so the file is written with mode 0600 and
 * lives outside the vault. Delete or corrupt files are treated as "no session"
 * — the client falls back to a fresh login.
 */

import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TokenCredentials } from "./types.js";

export async function loadSessionFile(path: string): Promise<TokenCredentials | null> {
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as TokenCredentials;
    if (typeof data?.accessToken === "string" && typeof data?.refreshToken === "string") {
      return data;
    }
  } catch {
    // Missing or unreadable/corrupt — no usable session.
  }
  return null;
}

export async function saveSessionFile(path: string, creds: TokenCredentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify({ version: 1, ...creds }, null, 2) + "\n", { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } catch (error) {
    // Best-effort: an unwritable session file must not fail the whole sync,
    // it only means the next run logs in again.
    console.error(`⚠  could not persist session to ${path}: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await unlink(tmp);
    } catch {
      // ignore
    }
  }
}