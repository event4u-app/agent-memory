import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

export interface FileChange {
  filePath: string;
  linesAdded: number;
  linesDeleted: number;
  /** true if file was added (new file) */
  isNew: boolean;
  /** true if file was deleted */
  isDeleted: boolean;
  /** true if file was renamed */
  isRenamed: boolean;
  /** old path if renamed */
  oldPath?: string;
}

export interface DiffResult {
  fromRef: string;
  toRef: string;
  changes: FileChange[];
  totalFilesChanged: number;
}

/**
 * Read git diff between two refs (commits, branches, tags).
 * Returns structured list of changed files with line counts.
 */
export async function readGitDiff(
  root: string,
  fromRef: string,
  toRef = "HEAD",
): Promise<DiffResult> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--numstat", "--diff-filter=ADRM", "-M", fromRef, toRef],
      { cwd: root, maxBuffer: 1024 * 1024 },
    );

    const changes = parseNumstat(stdout);

    // Detect renames
    const { stdout: renameOut } = await execFileAsync(
      "git",
      ["diff", "--name-status", "--diff-filter=R", "-M", fromRef, toRef],
      { cwd: root },
    );
    const renames = parseRenames(renameOut);
    for (const change of changes) {
      const rename = renames.get(change.filePath);
      if (rename) {
        change.isRenamed = true;
        change.oldPath = rename;
      }
    }

    logger.debug({ fromRef, toRef, fileCount: changes.length }, "Git diff read");

    return { fromRef, toRef, changes, totalFilesChanged: changes.length };
  } catch (err) {
    logger.warn({ fromRef, toRef, err }, "Failed to read git diff");
    return { fromRef, toRef, changes: [], totalFilesChanged: 0 };
  }
}

/**
 * Get files changed since a date (ISO format).
 */
export async function readGitDiffSince(
  root: string,
  sinceDate: string,
): Promise<DiffResult> {
  try {
    // Find the commit closest to the date
    const { stdout: hashOut } = await execFileAsync(
      "git",
      ["log", `--since=${sinceDate}`, "--reverse", "--format=%H", "-1"],
      { cwd: root },
    );
    const hash = hashOut.trim();
    if (!hash) {
      return { fromRef: sinceDate, toRef: "HEAD", changes: [], totalFilesChanged: 0 };
    }
    return readGitDiff(root, `${hash}~1`, "HEAD");
  } catch {
    return { fromRef: sinceDate, toRef: "HEAD", changes: [], totalFilesChanged: 0 };
  }
}

function parseNumstat(output: string): FileChange[] {
  const changes: FileChange[] = [];
  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const [added, deleted, filePath] = parts;
    const linesAdded = added === "-" ? 0 : parseInt(added!, 10);
    const linesDeleted = deleted === "-" ? 0 : parseInt(deleted!, 10);

    changes.push({
      filePath: filePath!,
      linesAdded,
      linesDeleted,
      isNew: linesDeleted === 0 && linesAdded > 0,
      isDeleted: linesAdded === 0 && linesDeleted > 0,
      isRenamed: false,
    });
  }
  return changes;
}

function parseRenames(output: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^R\d*\t(.+)\t(.+)$/);
    if (match) {
      renames.set(match[2]!, match[1]!); // newPath → oldPath
    }
  }
  return renames;
}
