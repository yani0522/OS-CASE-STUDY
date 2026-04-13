/**
 * Complete CPU Scheduling Algorithms
 * ─────────────────────────────────────────────────────────────────────────────
 * Algorithms included:
 *   1. FCFS               — First Come First Serve (non-preemptive)
 *   2. SJF                — Shortest Job First (non-preemptive)
 *   3. SRTF               — Shortest Remaining Time First (preemptive SJF)
 *   4. RR                 — Round Robin (preemptive, time-sliced)
 *   5. Priority NP        — Priority Non-Preemptive
 *   6. Priority P         — Priority Preemptive
 *   7. Priority RR        — Priority Round Robin (priority-grouped RR queues)
 *
 * Every function returns the same frame shape:
 *   { time, proc, queue: [{ name, rem, priority? }], rem }
 *
 * Lower priority number = higher priority (e.g. priority 1 runs before 2).
 * ─────────────────────────────────────────────────────────────────────────────
 */


// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Deep-clone a process list and attach a `rem` (remaining burst) field.
 */
function cloneJobs(processes) {
  return processes.map(p => ({ ...p, rem: p.burst }));
}

/**
 * Push a frame onto the frames array.
 */
function pushFrame(frames, time, proc, rem, queue) {
  frames.push({
    time,
    proc,
    rem,
    queue: queue.map(j => ({
      name:     j.name,
      rem:      j.rem,
      priority: j.priority ?? null,
    })),
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// 1. FCFS — First Come First Serve (non-preemptive)
//    Picks the process that arrived earliest. Runs it to completion.
// ═══════════════════════════════════════════════════════════════════════════════

function algoFCFS(processes) {
  const jobs   = cloneJobs(processes).sort((a, b) => a.arrival - b.arrival);
  const frames = [];
  let t = 0;

  while (jobs.some(j => j.rem > 0)) {
    const ready = jobs.filter(j => j.arrival <= t && j.rem > 0);

    if (!ready.length) {
      pushFrame(frames, t, 'idle', 0, []);
      t++;
      continue;
    }

    // Already sorted by arrival — first element is earliest arrival
    const running = ready[0];
    const queue   = ready.slice(1);

    for (let u = 0; u < running.rem; u++) {
      pushFrame(frames, t, running.name, running.rem - u, queue);
      t++;
    }
    running.rem = 0;
  }
  return frames;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 2. SJF — Shortest Job First (non-preemptive)
//    Among arrived processes, picks the one with the shortest TOTAL burst.
//    Once running, it is never interrupted.
// ═══════════════════════════════════════════════════════════════════════════════

function algoSJF(processes) {
  const jobs   = cloneJobs(processes).sort((a, b) => a.arrival - b.arrival);
  const frames = [];
  let t = 0;

  while (jobs.some(j => j.rem > 0)) {
    const ready = jobs
      .filter(j => j.arrival <= t && j.rem > 0)
      .sort((a, b) => a.burst - b.burst || a.arrival - b.arrival); // tie-break: arrival

    if (!ready.length) {
      pushFrame(frames, t, 'idle', 0, []);
      t++;
      continue;
    }

    const running = ready[0];
    const queue   = ready.slice(1);

    for (let u = 0; u < running.rem; u++) {
      pushFrame(frames, t, running.name, running.rem - u, queue);
      t++;
    }
    running.rem = 0;
  }
  return frames;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. SRTF — Shortest Remaining Time First (preemptive SJF)
//    Every tick, the process with the LEAST remaining time is chosen.
//    A newly arrived process with a shorter remaining time preempts the CPU.
// ═══════════════════════════════════════════════════════════════════════════════

function algoSRTF(processes) {
  const jobs   = cloneJobs(processes).sort((a, b) => a.arrival - b.arrival);
  const frames = [];
  let t = 0;

  while (jobs.some(j => j.rem > 0)) {
    const ready = jobs
      .filter(j => j.arrival <= t && j.rem > 0)
      .sort((a, b) => a.rem - b.rem || a.arrival - b.arrival); // tie-break: arrival

    if (!ready.length) {
      pushFrame(frames, t, 'idle', 0, []);
      t++;
      continue;
    }

    const running = ready[0];
    const queue   = ready.slice(1);

    // Run for exactly 1 tick, then re-evaluate (preemptive)
    pushFrame(frames, t, running.name, running.rem, queue);
    running.rem--;
    t++;
  }
  return frames;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. RR — Round Robin (preemptive, time-sliced)
//    Processes take turns on the CPU for at most `quantum` ticks each.
//    New arrivals join the back of the queue.
//    @param {number} options.quantum - time slice (default 2)
// ═══════════════════════════════════════════════════════════════════════════════

function algoRR(processes, options = {}) {
  const quantum = options.quantum || 2;
  const jobs    = cloneJobs(processes).sort((a, b) => a.arrival - b.arrival);
  const frames  = [];
  const queue   = [];
  const inQueue = new Set();
  let t = 0;
 
  function enqueue(time) {
    jobs
      .filter(j => j.arrival <= time && j.rem > 0 && !inQueue.has(j.name))
      .forEach(j => { queue.push(j); inQueue.add(j.name); });
  }
 
  enqueue(0);
 
  while (jobs.some(j => j.rem > 0)) {
 
    // ── FIX: check for new arrivals BEFORE deciding to go idle ──────────────
    enqueue(t);
 
    if (!queue.length) {
      pushFrame(frames, t, 'idle', 0, []);
      t++;
      enqueue(t); // also check at the next tick boundary
      continue;
    }
    // ────────────────────────────────────────────────────────────────────────
 
    const running = queue.shift();
    const run     = Math.min(quantum, running.rem);
 
    for (let u = 0; u < run; u++) {
      pushFrame(frames, t, running.name, running.rem - u, [...queue]);
      t++;
      enqueue(t); // catch arrivals mid-quantum
    }
 
    running.rem -= run;
 
    if (running.rem > 0) {
      queue.push(running);        // re-enqueue at the back (not finished)
    } else {
      inQueue.delete(running.name); // finished — allow re-entry if ever needed
    }
 
    enqueue(t);
  }
 
  return frames;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 5. PRIORITY NP — Priority Non-Preemptive
//    Picks the highest-priority arrived process (lowest priority number).
//    Once running, it is never interrupted.
//    @requires process.priority field
// ═══════════════════════════════════════════════════════════════════════════════

function algoPriorityNP(processes) {
  const jobs   = cloneJobs(processes).sort((a, b) => a.arrival - b.arrival);
  const frames = [];
  let t = 0;

  while (jobs.some(j => j.rem > 0)) {
    const ready = jobs
      .filter(j => j.arrival <= t && j.rem > 0)
      .sort((a, b) => a.priority - b.priority || a.arrival - b.arrival); // tie-break: arrival

    if (!ready.length) {
      pushFrame(frames, t, 'idle', 0, []);
      t++;
      continue;
    }

    const running = ready[0];
    const queue   = ready.slice(1);

    for (let u = 0; u < running.rem; u++) {
      pushFrame(frames, t, running.name, running.rem - u, queue);
      t++;
    }
    running.rem = 0;
  }
  return frames;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 6. PRIORITY P — Priority Preemptive
//    Every tick, the highest-priority arrived process takes the CPU.
//    A newly arrived higher-priority process immediately preempts the current one.
//    @requires process.priority field
// ═══════════════════════════════════════════════════════════════════════════════

function algoPriorityP(processes) {
  const jobs   = cloneJobs(processes).sort((a, b) => a.arrival - b.arrival);
  const frames = [];
  let t = 0;

  while (jobs.some(j => j.rem > 0)) {
    const ready = jobs
      .filter(j => j.arrival <= t && j.rem > 0)
      .sort((a, b) => a.priority - b.priority || a.arrival - b.arrival);

    if (!ready.length) {
      pushFrame(frames, t, 'idle', 0, []);
      t++;
      continue;
    }

    const running = ready[0];
    const queue   = ready.slice(1);

    // Run for exactly 1 tick, then re-evaluate (preemptive)
    pushFrame(frames, t, running.name, running.rem, queue);
    running.rem--;
    t++;
  }
  return frames;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 7. PRIORITY RR — Priority Round Robin
//    Processes are grouped into separate queues by priority level.
//    The highest-priority non-empty queue is served first.
//    Within each priority queue, processes rotate with a shared quantum.
//    A higher-priority arrival preempts when the current quantum expires.
//    @requires process.priority field
//    @param {number} options.quantum - time slice per priority group (default 2)
// ═══════════════════════════════════════════════════════════════════════════════

function algoPriorityRR(processes, options = {}) {
  const quantum       = options.quantum || 2;
  const jobs          = cloneJobs(processes).sort((a, b) => a.arrival - b.arrival);
  const frames        = [];
  const queues        = {};   // { [priorityLevel]: Job[] }
  const inQueue       = new Set();
  let t = 0;
 
  const priorityLevels = [...new Set(processes.map(p => p.priority))].sort((a, b) => a - b);
  priorityLevels.forEach(lvl => { queues[lvl] = []; });
 
  function enqueue(time) {
    jobs
      .filter(j => j.arrival <= time && j.rem > 0 && !inQueue.has(j.name))
      .forEach(j => {
        queues[j.priority].push(j);
        inQueue.add(j.name);
      });
  }
 
  function getActiveQueue() {
    for (const lvl of priorityLevels) {
      if (queues[lvl].length > 0) return queues[lvl];
    }
    return null;
  }
 
  function getQueueSnapshot(excludeName) {
    const snap = [];
    for (const lvl of priorityLevels) {
      queues[lvl]
        .filter(j => j.name !== excludeName)
        .forEach(j => snap.push(j));
    }
    return snap;
  }
 
  enqueue(0);
 
  while (jobs.some(j => j.rem > 0)) {
 
    // ── FIX: check for new arrivals BEFORE deciding to go idle ──────────────
    enqueue(t);
 
    if (!getActiveQueue()) {
      pushFrame(frames, t, 'idle', 0, []);
      t++;
      enqueue(t); // also check at the next tick boundary
      continue;
    }
    // ────────────────────────────────────────────────────────────────────────
 
    const activeQueue = getActiveQueue();
    const running     = activeQueue.shift();
    const run         = Math.min(quantum, running.rem);
 
    for (let u = 0; u < run; u++) {
      const qSnap = getQueueSnapshot(running.name);
      pushFrame(frames, t, running.name, running.rem - u, qSnap);
      t++;
      enqueue(t);
    }
 
    running.rem -= run;
 
    if (running.rem > 0) {
      queues[running.priority].push(running); // re-enqueue in its priority group
    } else {
      inQueue.delete(running.name);
    }
 
    enqueue(t);
  }
 
  return frames;
}


// ═══════════════════════════════════════════════════════════════════════════════
// ALGORITHM REGISTRY
// Add a new algorithm: write the function above, add one entry here,
// add one <option> in your HTML. The animation engine needs zero changes.
// ═══════════════════════════════════════════════════════════════════════════════

const ALGORITHMS = {
  fcfs:        { label: 'FCFS',                         run: algoFCFS,       needsPriority: false, needsQuantum: false },
  sjf:         { label: 'SJF (non-preemptive)',         run: algoSJF,        needsPriority: false, needsQuantum: false },
  srtf:        { label: 'SRTF (preemptive SJF)',        run: algoSRTF,       needsPriority: false, needsQuantum: false },
  rr:          { label: 'Round Robin',                  run: algoRR,         needsPriority: false, needsQuantum: true  },
  priority_np: { label: 'Priority (non-preemptive)',    run: algoPriorityNP, needsPriority: true,  needsQuantum: false },
  priority_p:  { label: 'Priority (preemptive)',        run: algoPriorityP,  needsPriority: true,  needsQuantum: false },
  priority_rr: { label: 'Priority Round Robin',         run: algoPriorityRR, needsPriority: true,  needsQuantum: true  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Collapse consecutive same-process frames into Gantt chart blocks */
function computeGantt(frames) {
  const blocks = [];
  let current  = null;

  for (const f of frames) {
    if (!current || current.name !== f.proc) {
      if (current) blocks.push(current);
      current = { name: f.proc, start: f.time, end: f.time + 1 };
    } else {
      current.end = f.time + 1;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** Per-process: finish time, turnaround time, waiting time */
function computeStats(processes, frames) {
  return processes.map(p => {
    const pFrames = frames.filter(f => f.proc === p.name);
    if (!pFrames.length) return null;

    const finishTime     = pFrames[pFrames.length - 1].time + 1;
    const turnaroundTime = finishTime - p.arrival;
    const waitingTime    = turnaroundTime - p.burst;

    return {
      name: p.name,
      arrival: p.arrival,
      burst: p.burst,
      priority: p.priority ?? '—',
      finishTime,
      turnaroundTime,
      waitingTime,
    };
  }).filter(Boolean);
}

/** Average turnaround time and average waiting time */
function computeAverages(stats) {
  const n = stats.length;
  return {
    avgTurnaround: (stats.reduce((s, r) => s + r.turnaroundTime, 0) / n).toFixed(2),
    avgWaiting:    (stats.reduce((s, r) => s + r.waitingTime,    0) / n).toFixed(2),
  };
}
