/**
 * The development server, without the Nest CLI's restart.
 *
 * `nest start --watch` compiles and restarts in one process, and on Windows
 * the restart is where it breaks: it shells out to `taskkill /pid N /T /F`
 * and throws if that pid has already gone. The parent then dies while the
 * child it meant to kill keeps listening, so the API goes on serving the
 * build from *before* the edit. Nothing reports an error — the port answers,
 * the responses are just stale — and the next person to test a change sees it
 * fail for reasons that are not in the code. It cost three false bug reports
 * in one day before it was understood.
 *
 * The two halves are separated here instead. `nest build --watch` only ever
 * compiles, so it has no process to kill, and `node --watch` does the
 * restarting — that is built into Node, it watches the files it actually
 * loaded, and it has no opinion about how to end a process on Windows.
 *
 * Compilation stays with the Nest CLI, which runs `tsc`. That matters more
 * than it looks: Nest resolves constructor dependencies from
 * `emitDecoratorMetadata`, which only `tsc` emits. Running the sources
 * directly through tsx is quicker and fails immediately —
 * "Nest can't resolve dependencies of the UserAdminService (?, …)", where the
 * `?` is the metadata esbuild never wrote.
 */
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(apiRoot, 'dist/main.js');

/** How long to wait for the first compile before giving up on it. */
const FIRST_BUILD_TIMEOUT_MS = 180_000;
const POLL_MS = 250;

const children = [];

function run(commandLine, label) {
  // One string rather than a command and an argv: `shell: true` concatenates
  // them anyway, and passing them separately earns a deprecation warning for
  // the escaping it does not do. Nothing here is user input.
  const child = spawn(commandLine, { cwd: apiRoot, stdio: 'inherit', shell: true });
  children.push(child);
  child.on('exit', (code, signal) => {
    // One half dying makes the other half a liar — a compiler with nothing to
    // restart, or a server that will never see another change. Stop both.
    if (!shuttingDown) {
      console.error(`[dev] ${label} exited (code ${code ?? signal}). Stopping.`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

const startedAt = Date.now();

run('nest build --watch --preserveWatchOutput', 'compiler');

/*
  The server waits for a build produced by *this* run.

  Waiting merely for the file to exist is not enough, and failing that way is
  how this script went wrong the first time: `nest build --watch` empties
  `dist` before it compiles, so the previous run's `main.js` is sitting there
  at startup, passes the check, and is deleted a moment later. `node --watch`
  then cannot load its entry — and because it never loaded anything, it has
  no file list to watch, so it waits for a change that by definition cannot
  reach it. The API never starts and nothing says why.

  Comparing against the launcher's own start time means only a freshly
  emitted `main.js` will do. The settle delay covers the gap between the file
  appearing and being finished with.
*/
const SETTLE_MS = 400;
const waitForEntry = setInterval(() => {
  try {
    const built = statSync(entry);
    if (built.mtimeMs > startedAt && Date.now() - built.mtimeMs > SETTLE_MS) {
      clearInterval(waitForEntry);
      run(`node --watch "${entry}"`, 'server');
      return;
    }
  } catch {
    // Not emitted yet. `nest build` reports its own errors, so there is
    // nothing useful to say until the timeout below.
  }
  if (Date.now() - startedAt > FIRST_BUILD_TIMEOUT_MS) {
    clearInterval(waitForEntry);
    console.error(`[dev] No build appeared at ${entry}. Is the compiler failing?`);
    shutdown(1);
  }
}, POLL_MS);
