// Coalesce streamed DOM changes without overlapping asynchronous refreshes.
export function createRenderQueue(render, {onError = console.error, delay = 40} = {}) {
  let timer = null, busy = false, disposed = false, all = false, revision = 0, scope = null;
  const ids = new Set();
  function arm() {
    if (disposed || busy || timer !== null || !all && !ids.size) return;
    timer = setTimeout(run, delay);
  }
  async function run() {
    timer = null;
    if (disposed) return;
    busy = true;
    const ticket = revision, only = all ? null : new Set(ids);
    scope = only;
    all = false; ids.clear();
    try { await render(only, () => !disposed && ticket === revision); }
    catch (error) { if (!disposed) onError(error); }
    finally { busy = false; scope = null; arm(); }
  }
  return {
    schedule(only) {
      if (disposed) return;
      revision++;
      // An invalidated pass may not have updated all its floors yet.
      if (busy) { if (scope) for (const id of scope) ids.add(id); else all = true; }
      if (only) for (const id of only) ids.add(id); else all = true;
      arm();
    },
    dispose() {
      disposed = true; revision++;
      clearTimeout(timer); timer = null; all = false; ids.clear();
    },
  };
}

// Only a few cache reads retain state at a time. Wait for every running worker
// even after a failure, so the next refresh cannot overlap unfinished reads.
export async function runRenderJobs(jobs, current) {
  let next = 0;
  const errors = [];
  await Promise.all(Array.from({length: Math.min(4, jobs.length)}, async () => {
    while (current() && !errors.length && next < jobs.length) {
      try { await jobs[next++](); } catch (error) { errors.push(error); }
    }
  }));
  if (errors.length) throw errors[0];
}
