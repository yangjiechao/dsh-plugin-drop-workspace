/**
 * Candidate resolution for a dropped folder.
 *
 * The browser exposes no absolute host path for a dropped directory, only its
 * name and its children's names. This module scans a bounded set of host roots
 * (the home directory plus the parents of registered Workspaces) for
 * directories whose basename matches, ranks them by how many of the dropped
 * folder's top-level entries they contain, and returns the best few.
 *
 * The scan is a bounded breadth-first walk: a per-run directory budget and a
 * wall-clock deadline keep one drop from turning into an unbounded filesystem
 * crawl, and `truncated` reports that the answer is partial.
 */
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

/** Directories that never contain a droppable project and cost the most to walk. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.cache', '.npm', '.nvm',
  '.pnpm-store', '.yarn', '.bun', '.deno', '.pyenv', '.rustup', '.cargo', '.gradle',
  '.m2', '.ivy2', '.sbt', '.conda', 'venv', '.venv', 'env', 'target', 'dist', 'build',
  'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', '.terraform',
  'Library', 'Applications', '.Trash', '.Trashes', 'Movies', 'Music', 'Photos Library.photoslibrary',
  'System', 'Volumes', 'private', 'proc', 'sys', 'dev', 'run',
]);

/** How deep below one root a match may sit. */
const ROOT_DEPTH = { home: 4, hint: 3 };
/** Total directories one request may read. */
const MAX_DIRS = 24000;
/** Wall-clock deadline for one request. */
const TIME_BUDGET_MS = 1600;
/** Directories read concurrently per wave. */
const CONCURRENCY = 16;
/** How many candidate paths one request returns. */
const MAX_RESULTS = 8;
/** How many child names a scored candidate may contribute. */
const MAX_CHILD_NAMES = 400;

/**
 * Normalize the dropped folder's top-level entry names for comparison.
 * @param entries - raw names reported by the browser.
 * @param limit - maximum names kept.
 * @returns lowercased, de-duplicated names without filesystem noise.
 */
export function normalizeEntries(entries, limit = 60) {
  const names = [];
  const seen = new Set();
  for (const raw of Array.isArray(entries) ? entries : []) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (name === '' || name === '.DS_Store' || name === '.localized') continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(key);
    if (names.length >= limit) break;
  }
  return names;
}

/**
 * Build the search roots: parents of registered Workspaces first (siblings are
 * the likeliest drop target), then the home directory (skipped when a hint
 * already covers it).
 * @param hints - absolute directories supplied by the browser.
 * @returns ordered roots with their depth budget.
 */
export function buildRoots(hints) {
  const roots = [];
  const seen = new Set();
  const push = (dir, maxDepth) => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push({ dir: resolved, maxDepth });
  };
  for (const hint of Array.isArray(hints) ? hints : []) push(hint, ROOT_DEPTH.hint);
  const home = homedir();
  const temp = tmpdir();
  // A home directory already covered by a hint (or a temp root under home)
  // needs no second root row: the narrower root reaches the same directories.
  if (!seen.has(path.resolve(home)) && home !== temp) push(home, ROOT_DEPTH.home);
  return roots;
}

/**
 * Score one candidate directory against the dropped folder's entry names.
 * @param dirPath - candidate directory.
 * @param wanted - normalized entry names of the dropped folder.
 * @returns matched entry count and a 0..1 overlap ratio.
 */
async function scoreCandidate(dirPath, wanted) {
  let names;
  try {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    names = dirents.slice(0, MAX_CHILD_NAMES).map((entry) => entry.name.toLowerCase());
  } catch {
    return { matched: 0, score: 0 };
  }
  if (wanted.size === 0) return { matched: 0, score: 0 };
  let matched = 0;
  for (const name of names) if (wanted.has(name)) matched += 1;
  return { matched, score: Math.min(1, matched / wanted.size) };
}

/**
 * Walk one root breadth-first, collecting directories whose basename matches.
 * @param root - root row from {@link buildRoots}.
 * @param target - lowercased dropped folder name.
 * @param state - shared budget and deadline.
 * @returns matched absolute paths.
 */
async function scanRoot(root, target, state) {
  const found = [];
  let queue = [{ dir: root.dir, depth: 0 }];
  while (queue.length > 0) {
    if (Date.now() > state.deadline || state.scanned >= MAX_DIRS) {
      state.truncated = true;
      return found;
    }
    const wave = queue.splice(0, CONCURRENCY);
    const listings = await Promise.all(
      wave.map(async (node) => {
        state.scanned += 1;
        try {
          return { node, dirents: await fs.readdir(node.dir, { withFileTypes: true }) };
        } catch {
          return { node, dirents: null };
        }
      }),
    );
    const next = [];
    for (const { node, dirents } of listings) {
      if (dirents === null) continue;
      for (const dirent of dirents) {
        const isDirectory = dirent.isDirectory();
        if (!isDirectory && !dirent.isSymbolicLink()) continue;
        const childPath = path.join(node.dir, dirent.name);
        if (dirent.name.toLowerCase() === target) found.push(childPath);
        if (!isDirectory) continue;
        if (node.depth + 1 > root.maxDepth) continue;
        if (SKIP_DIRS.has(dirent.name)) continue;
        if (dirent.name.startsWith('.') && dirent.name !== '.config') continue;
        next.push({ dir: childPath, depth: node.depth + 1 });
      }
    }
    // Keep the siblings this wave did not reach: the queue carries every
    // directory still to visit, not just the children of the last wave.
    queue.push(...next);
  }
  return found;
}

/**
 * Resolve candidate host directories for one dropped folder.
 * @param request - dropped name, its top-level entry names, and workspace parents.
 * @returns ranked candidates plus scan bookkeeping.
 */
export async function resolveCandidates({ name, entries, hints } = {}) {
  const rawName = typeof name === 'string' ? name.trim() : '';
  if (rawName === '') return { candidates: [], scanned: 0, truncated: false };
  const target = rawName.toLowerCase();
  const entryList = normalizeEntries(entries);
  const wanted = new Set(entryList);
  const state = { scanned: 0, truncated: false, deadline: Date.now() + TIME_BUDGET_MS };
  const paths = new Set();
  for (const root of buildRoots(hints)) {
    const hits = await scanRoot(root, target, state);
    for (const hit of hits) paths.add(hit);
    if (paths.size > 0 && Date.now() > state.deadline) break;
  }
  const candidates = [];
  for (const candidatePath of paths) {
    const { matched, score } = await scoreCandidate(candidatePath, wanted);
    candidates.push({
      path: candidatePath,
      title: path.basename(candidatePath),
      matched,
      total: wanted.size,
      score: Math.round(score * 100) / 100,
    });
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.path.length - right.path.length ||
      left.path.localeCompare(right.path),
  );
  return { candidates: candidates.slice(0, MAX_RESULTS), scanned: state.scanned, truncated: state.truncated };
}
