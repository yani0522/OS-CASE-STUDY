// =============================================================================
// cpu_scheduling_algorithms.js
// =============================================================================
// Responsible for:
//   1. Running each scheduling algorithm and producing a frame-by-frame
//      simulation log (an array of "frames").
//   2. Deriving the Gantt chart block list from those frames.
//   3. Computing per-process statistics (completion time, TAT, WT) and averages.
//
// A "frame" represents one clock-tick snapshot:
//   { time, process, remainingBurstTime, queue[] }
//
// The simulation engine (cpu_scheduling_simulation.js) consumes these frames
// one tick at a time to drive the UI animation.
// =============================================================================


// -----------------------------------------------------------------------------
// Utility helpers shared by all algorithms
// -----------------------------------------------------------------------------

/**
 * cloneJobs(processes)
 *
 * Creates a deep-enough copy of the process list so algorithms can mutate
 * remainingBurstTime without affecting the original data held by ProcessEditor.
 *
 * Each clone gets a fresh `remainingBurstTime` property set to the process's
 * full burstTime so it counts down correctly during simulation.
 *
 * @param  {Object[]} processes - Raw process objects from ProcessEditor.
 * @returns {Object[]}          - Cloned jobs ready for scheduling.
 */
function cloneJobs(processes) {
    return processes.map(p => ({...p, remainingBurstTime: p.burstTime}));
}

/**
 * pushFrame(frames, time, process, remainingBurstTime, queue)
 *
 * Appends one clock-tick snapshot to the frames array.
 * The queue is snapshotted here (mapped to plain objects) so that later
 * mutations to the live queue don't retroactively change earlier frames.
 *
 * @param {Object[]} frames             - The growing frames array to append to.
 * @param {number}   time               - Current clock value (integer, ≥ 0).
 * @param {string}   process            - Name of the running process, or 'idle'.
 * @param {number}   remainingBurstTime - Remaining burst for the running process.
 * @param {Object[]} queue              - Snapshot of the ready queue at this tick.
 */
function pushFrame(frames, time, process, remainingBurstTime, queue) {
    frames.push({
        time,
        process,
        remainingBurstTime,
        // Snapshot only the fields the UI needs; avoids storing the full job object.
        queue: queue.map(j => ({
            name: j.name,
            remainingBurstTime: j.remainingBurstTime,
            priority: j.priority ?? null,
        })),
    });
}


// -----------------------------------------------------------------------------
// Algorithm implementations
// Each function returns the complete frames array for the full simulation run.
// -----------------------------------------------------------------------------

/**
 * fcfsAlgorithm - First Come First Served (non-preemptive)
 *
 * Selection rule: among all arrived processes, pick the one that arrived
 * earliest (ties broken arbitrarily by array position after the initial sort).
 * Once selected, it runs to completion without interruption.
 *
 * How it works tick-by-tick:
 *   1. Filter jobs that have arrived and still have burst time remaining.
 *   2. If none are ready, emit an 'idle' frame and advance time.
 *   3. Otherwise, take the first (earliest-arrived) job and run it for its
 *      entire remaining burst, emitting one frame per tick.
 *   4. After the loop, mark the job's remainingBurstTime as 0 (done).
 *
 * @param  {Object[]} processes - Original process list.
 * @returns {Object[]} frames
 */
function fcfsAlgorithm(processes) {
    // Sort by arrival time so ready-queue filtering naturally yields FCFS order.
    const jobs = cloneJobs(processes).sort((a, b) => a.arrivalTime - b.arrivalTime);
    const frames = [];
    let time = 0;

    while (jobs.some(j => j.remainingBurstTime > 0)) {
        // All jobs that have arrived and still need CPU time.
        const ready = jobs.filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0);

        if (!ready.length) {
            // CPU gap: no process is ready yet - advance one tick in idle.
            pushFrame(frames, time, 'idle', 0, []);
            time++;
            continue;
        }

        // Pick the head of the ready list (earliest arrival due to the initial sort).
        const running = ready[0];

        // Run for the full burst - FCFS never preempts.
        // `i` counts ticks elapsed, so remaining = original - i.
        for (let i = 0; i < running.remainingBurstTime; i++) {
            // Live queue snapshot excludes the currently running process.
            const liveQueue = jobs
                .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0 && j.name !== running.name);
            pushFrame(frames, time, running.name, running.remainingBurstTime - i, liveQueue);
            time++;
        }

        // Mark as finished so it won't be picked again.
        running.remainingBurstTime = 0;
    }

    return frames;
}

/**
 * sjfAlgorithm - Shortest Job First (non-preemptive)
 *
 * Selection rule: among arrived processes, pick the one with the smallest
 * *original* burstTime. Ties broken by arrival time.
 * Once selected, it runs to completion (non-preemptive).
 *
 * Difference from FCFS: the ready list is sorted by burstTime instead of
 * arrivalTime, so the shortest job wins the CPU each scheduling decision.
 *
 * @param  {Object[]} processes
 * @returns {Object[]} frames
 */
function sjfAlgorithm(processes) {
    const jobs = cloneJobs(processes).sort((a, b) => a.arrivalTime - b.arrivalTime);
    const frames = [];
    let time = 0;

    while (jobs.some(j => j.remainingBurstTime > 0)) {
        // Sort ready processes by original burstTime (shortest first).
        // arrivalTime as a secondary key resolves ties deterministically.
        const ready = jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0)
            .sort((a, b) => a.burstTime - b.burstTime || a.arrivalTime - b.arrivalTime);

        if (!ready.length) {
            pushFrame(frames, time, 'idle', 0, []);
            time++;
            continue;
        }

        const running = ready[0]; // Shortest job among all currently arrived.

        // Non-preemptive: run the full burst without interruption.
        for (let i = 0; i < running.remainingBurstTime; i++) {
            // Queue snapshot keeps the same SJF sort so the UI shows the correct order.
            const liveQueue = jobs
                .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0 && j.name !== running.name)
                .sort((a, b) => a.burstTime - b.burstTime || a.arrivalTime - b.arrivalTime);
            pushFrame(frames, time, running.name, running.remainingBurstTime - i, liveQueue);
            time++;
        }

        running.remainingBurstTime = 0;
    }

    return frames;
}

/**
 * srtfAlgorithm - Shortest Remaining Time First (preemptive SJF)
 *
 * Selection rule: each tick, pick the arrived process with the smallest
 * *remaining* burst time. A newly arrived shorter job immediately preempts
 * the running one.
 *
 * Key difference from SJF: only one frame is pushed per tick (not per full
 * burst), and remainingBurstTime is decremented one unit at a time. The
 * scheduling decision is re-evaluated every tick, enabling preemption.
 *
 * @param  {Object[]} processes
 * @returns {Object[]} frames
 */
function srtfAlgorithm(processes) {
    const jobs = cloneJobs(processes).sort((a, b) => a.arrivalTime - b.arrivalTime);
    const frames = [];
    let time = 0;

    while (jobs.some(j => j.remainingBurstTime > 0)) {
        // Re-sort every tick by *remaining* burst time - enables preemption.
        const ready = jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0)
            .sort((a, b) => a.remainingBurstTime - b.remainingBurstTime || a.arrivalTime - b.arrivalTime);

        if (!ready.length) {
            pushFrame(frames, time, 'idle', 0, []);
            time++;
            continue;
        }

        const running = ready[0]; // Process with the shortest remaining time.

        const liveQueue = jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0 && j.name !== running.name)
            .sort((a, b) => a.remainingBurstTime - b.remainingBurstTime || a.arrivalTime - b.arrivalTime);

        // One tick only - the loop will re-evaluate the winner next iteration.
        pushFrame(frames, time, running.name, running.remainingBurstTime, liveQueue);
        running.remainingBurstTime--;
        time++;
    }

    return frames;
}

/**
 * rrAlgorithm - Round Robin
 *
 * Selection rule: processes share the CPU in circular order. Each gets at
 * most `quantum` ticks before being moved to the back of the queue.
 *
 * Design notes:
 *   - A FIFO `queue` array is the scheduling queue; `inQueue` Set prevents
 *     a process from being enqueued more than once at the same time.
 *   - `enqueue(time)` is called at key moments to admit any newly arrived
 *     processes before making scheduling decisions.
 *   - After a quantum expires, if the process still has remaining burst it
 *     is re-added to the back of the queue (classic RR behavior).
 *   - If it finished, it is removed from `inQueue` so it won't be re-admitted.
 *
 * @param  {Object[]} processes
 * @param  {Object}   options         - { quantum: number }
 * @returns {Object[]} frames
 */
function rrAlgorithm(processes, options = {}) {
    const quantum = options.quantum || 2;
    const jobs = cloneJobs(processes).sort((a, b) => a.arrivalTime - b.arrivalTime);
    const frames = [];
    const queue = [];       // Active FIFO scheduling queue.
    const inQueue = new Set(); // Tracks which process names are currently queued.
    let time = 0;

    /**
     * enqueue(time)
     * Scans all jobs and adds any that have now arrived and aren't already
     * in the queue (or currently running). Called before each scheduling
     * decision and after each tick so late-arriving processes join promptly.
     */
    function enqueue(time) {
        jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0 && !inQueue.has(j.name))
            .forEach(j => { 
                queue.push(j); 
                inQueue.add(j.name); 
            });
    }

    enqueue(0); // Admit processes that arrive at time 0 before the main loop.

    while (jobs.some(j => j.remainingBurstTime > 0)) {
        enqueue(time); // Admit any new arrivals before scheduling.

        if (!queue.length) {
            // CPU gap: nothing ready yet.
            pushFrame(frames, time, 'idle', 0, []);
            time++;
            enqueue(time);
            continue;
        }

        const running = queue.shift(); // Dequeue the next process (FIFO order).
        // Run for at most `quantum` ticks, or until the process finishes.
        const run = Math.min(quantum, running.remainingBurstTime);

        for (let i = 0; i < run; i++) {
            // Spread the queue array so the snapshot is a point-in-time copy.
            pushFrame(frames, time, running.name, running.remainingBurstTime - i, [...queue]);
            time++;
            enqueue(time); // Admit arrivals that happened during this tick.
        }

        running.remainingBurstTime -= run;

        if (running.remainingBurstTime > 0) {
            // Quantum expired but job isn't done - cycle it to the back.
            queue.push(running);
        } else {
            // Job finished - remove from the tracked set so it won't re-enter.
            inQueue.delete(running.name);
        }

        // One final enqueue after the quantum in case new jobs arrived exactly
        // at the moment the running job's slice ended.
        enqueue(time);
    }

    return frames;
}

/**
 * pnpAlgorithm - Priority (Non-Preemptive)
 *
 * Selection rule: among arrived processes, pick the one with the lowest
 * priority number (lower number = higher priority). Ties broken by arrival time.
 * Once selected, it runs to completion without interruption.
 *
 * Structurally identical to SJF but sorted by `priority` instead of `burstTime`.
 *
 * @param  {Object[]} processes
 * @returns {Object[]} frames
 */
function pnpAlgorithm(processes) {
    const jobs = cloneJobs(processes).sort((a, b) => a.arrivalTime - b.arrivalTime);
    const frames = [];
    let time = 0;

    while (jobs.some(j => j.remainingBurstTime > 0)) {
        // Sort ready list by priority number (ascending = higher priority wins).
        const ready = jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0)
            .sort((a, b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime);

        if (!ready.length) {
            pushFrame(frames, time, 'idle', 0, []);
            time++;
            continue;
        }

        const running = ready[0]; // Highest-priority process.

        // Non-preemptive: run the entire burst before reconsidering.
        for (let i = 0; i < running.remainingBurstTime; i++) {
            const liveQueue = jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0 && j.name !== running.name)
            .sort((a, b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime);
            pushFrame(frames, time, running.name, running.remainingBurstTime - i, liveQueue);
            time++;
        }

        running.remainingBurstTime = 0;
    }

    return frames;
}

/**
 * ppAlgorithm - Priority (Preemptive)
 *
 * Selection rule: each tick, pick the arrived process with the highest
 * priority (lowest number). A newly arrived higher-priority job immediately
 * preempts the running one.
 *
 * Structurally identical to SRTF but sorted by `priority` instead of
 * `remainingBurstTime`. One frame per tick; the winner is re-evaluated
 * each iteration.
 *
 * @param  {Object[]} processes
 * @returns {Object[]} frames
 */
function ppAlgorithm(processes) {
    const jobs = cloneJobs(processes).sort((a, b) => a.arrivalTime - b.arrivalTime);
    const frames = [];
    let time = 0;

    while (jobs.some(j => j.remainingBurstTime > 0)) {
        // Re-sort every tick - any new arrival can preempt the current runner.
        const ready = jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0)
            .sort((a, b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime);

        if (!ready.length) {
            pushFrame(frames, time, 'idle', 0, []);
            time++;
            continue;
        }

        const running = ready[0];

        const liveQueue = jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0 && j.name !== running.name)
            .sort((a, b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime);

        // Single tick - enables preemption on the very next iteration.
        pushFrame(frames, time, running.name, running.remainingBurstTime, liveQueue);
        running.remainingBurstTime--;
        time++;
    }
    
    return frames;
}

/**
 * prrAlgorithm - Priority Round Robin
 *
 * A hybrid algorithm: processes are grouped into separate per-priority FIFO
 * queues. The highest-priority non-empty queue is always served first. Within
 * that queue, processes share the CPU in Round Robin fashion (time quantum).
 * A higher-priority process arriving mid-quantum preempts the running one.
 *
 * Data structures:
 *   queues         - Object keyed by priority level; each value is a FIFO array.
 *   inQueue        - Set of names currently sitting in any priority queue.
 *   priorityLevels - Sorted (ascending) unique priority values extracted once
 *                    from the process list and used for ordered iteration.
 *
 * Inner helpers:
 *   enqueue(time)      - Admits newly arrived processes into their priority queue.
 *   getActiveQueue()   - Returns the non-empty queue with the lowest priority
 *                        number (= highest urgency).
 *   getQueueSnapshot() - Flattens all queues into one ordered list for the
 *                        frame's queue snapshot, excluding the running process.
 *
 * Preemption logic (inside the per-quantum tick loop):
 *   After each tick, enqueue() is called to admit any new arrivals. If any
 *   process with a *lower* priority number than the running process is now
 *   queued, the loop breaks early - the running process is re-queued at its
 *   own priority level and the higher-priority newcomer wins next iteration.
 *
 * @param  {Object[]} processes
 * @param  {Object}   options   - { quantum: number }
 * @returns {Object[]} frames
 */
function prrAlgorithm(processes, options = {}) {
    const quantum = options.quantum || 2;
    const jobs = cloneJobs(processes).sort((a, b) => a.arrivalTime - b.arrivalTime);
    const frames = [];
    const queues = {};      // { [priorityLevel]: job[] }
    const inQueue = new Set();
    let time = 0;

    // Build one empty FIFO queue for each distinct priority level.
    const priorityLevels = [...new Set(processes.map(p => p.priority))].sort((a, b) => a - b);
    priorityLevels.forEach(level => { queues[level] = []; });

    /** Admits all newly arrived (and not yet queued) jobs into their priority queues. */
    function enqueue(time) {
        jobs
            .filter(j => j.arrivalTime <= time && j.remainingBurstTime > 0 && !inQueue.has(j.name))
            .forEach(j => {
                queues[j.priority].push(j);
                inQueue.add(j.name);
            });
    }

    /**
     * Returns the first non-empty priority queue (lowest number = highest priority),
     * or null if all queues are empty (CPU should go idle).
     */
    function getActiveQueue() {
        for (const level of priorityLevels) {
            if (queues[level].length > 0) return queues[level];
        }

        return null;
    }

    /**
     * Builds a flat ordered snapshot of every waiting job across all queues,
     * excluding the currently running process (passed as `excludeName`).
     * Used to populate the queue display in each frame.
     */
    function getQueueSnapshot(excludeName) {
        const snap = [];
        for (const level of priorityLevels) {
            queues[level]
                .filter(j => j.name !== excludeName)
                .forEach(j => snap.push(j));
        }

        return snap;
    }

    enqueue(0); // Seed initial queue.

    while (jobs.some(j => j.remainingBurstTime > 0)) {
        enqueue(time);

        if (!getActiveQueue()) {
            // All queues empty - CPU idle.
            pushFrame(frames, time, 'idle', 0, []);
            time++;
            enqueue(time);
            continue;
        }

        const activeQueue = getActiveQueue();
        const running = activeQueue.shift(); // Dequeue from the highest-priority queue.
        // Run for at most `quantum` ticks, or until process finishes.
        const run = Math.min(quantum, running.remainingBurstTime);

        let ticksRun = 0;
        for (let i = 0; i < run; i++) {
            const queueSnap = getQueueSnapshot(running.name);
            pushFrame(frames, time, running.name, running.remainingBurstTime - i, queueSnap);
            time++;
            ticksRun++;
            enqueue(time); // Check for new arrivals after each tick.

            // Preemption check: if a higher-priority process just arrived,
            // stop the current quantum early.
            const currentLevel = running.priority;
            const higherArrived = priorityLevels.some(
                lvl => lvl < currentLevel && queues[lvl].length > 0
            );
            if (higherArrived) break;
        }

        running.remainingBurstTime -= ticksRun;

        if (running.remainingBurstTime > 0) {
            // Not done - re-queue at the same priority level (back of that queue).
            queues[running.priority].push(running);
        } else {
            // Finished - remove from the tracking set.
            inQueue.delete(running.name);
        }

        enqueue(time);
    }

    return frames;
}


// -----------------------------------------------------------------------------
// Algorithm registry
// -----------------------------------------------------------------------------

/**
 * algorithms
 *
 * Central lookup table used by the simulation engine and UI to:
 *   - Populate the algorithm dropdown (label).
 *   - Call the correct scheduling function (run).
 *   - Show/hide the Priority column (needsPriority).
 *   - Show/hide the Time Quantum input (needsQuantum).
 *
 * Keys match the <option value="..."> in cpu_scheduling.html.
 */
const algorithms = {
    fcfs: { label: 'First Come First Served',              run: fcfsAlgorithm, needsPriority: false, needsQuantum: false },
    sjf:  { label: 'Shortest Job First',                   run: sjfAlgorithm,  needsPriority: false, needsQuantum: false },
    srtf: { label: 'Shortest Remaining Time First',        run: srtfAlgorithm, needsPriority: false, needsQuantum: false },
    rr:   { label: 'Round Robin',                          run: rrAlgorithm,   needsPriority: false, needsQuantum: true  },
    pnp:  { label: 'Priority Scheduling (Non-Preemptive)', run: pnpAlgorithm,  needsPriority: true,  needsQuantum: false },
    pp:   { label: 'Priority Scheduling (Preemptive)',     run: ppAlgorithm,   needsPriority: true,  needsQuantum: false },
    prr:  { label: 'Priority Scheduling with Round Robin', run: prrAlgorithm,  needsPriority: true,  needsQuantum: true  }
};


// -----------------------------------------------------------------------------
// Post-simulation computations (consumed by the stats panel)
// -----------------------------------------------------------------------------

/**
 * computeGantt(frames)
 *
 * Collapses the tick-level frames array into a compact list of Gantt blocks,
 * where consecutive frames belonging to the same process are merged into one
 * block with a start and end time.
 *
 * Example: frames for P1 at t=0,1,2 -> { name:'P1', start:0, end:3 }
 *
 * This is used by the simulation engine to pre-build the Gantt bar DOM
 * elements before the animation starts, with their final widths calculated
 * as percentages of total simulation time.
 *
 * @param  {Object[]} frames - Full frames array produced by an algorithm.
 * @returns {Object[]} blocks - [{ name, start, end }, ...]
 */
function computeGantt(frames) {
    const blocks = [];
    let current = null;

    for (const frame of frames) {
        if (!current || current.name !== frame.process) {
            // Process changed (or first frame) - push the previous block and start a new one.
            if (current) blocks.push(current);
            current = { name: frame.process, start: frame.time, end: frame.time + 1 };
        } else {
            // Same process as the previous frame - extend the current block by one tick.
            current.end = frame.time + 1;
        }
    }

    if (current) blocks.push(current); // Don't forget the final block.
    return blocks;
}

/**
 * computeStats(processes, frames)
 *
 * Derives per-process scheduling metrics from the completed frames log.
 *
 * Metrics calculated:
 *   completionTime  = time of the last frame for this process + 1
 *   turnaroundTime  = completionTime − arrivalTime
 *   waitingTime     = turnaroundTime − burstTime
 *
 * Processes with no frames (never ran) are filtered out via `.filter(Boolean)`.
 *
 * @param  {Object[]} processes - Original process list (for arrivalTime, burstTime).
 * @param  {Object[]} frames    - Full frames array from the algorithm.
 * @returns {Object[]} stats    - One stats object per process that ran.
 */
function computeStats(processes, frames) {
    return processes.map(p => {
        const processFrames = frames.filter(f => f.process === p.name);
        if (!processFrames.length) return null; // Process never ran - skip.

        // Last frame's time + 1 gives the moment the process fully completes.
        const completionTime = processFrames[processFrames.length - 1].time + 1;
        const turnaroundTime = completionTime - p.arrivalTime;
        const waitingTime = turnaroundTime - p.burstTime;

        return {
            name: p.name,
            arrivalTime: p.arrivalTime,
            burstTime: p.burstTime,
            priority: p.priority ?? '—', // '—' for algorithms that don't use priority.
            completionTime,
            turnaroundTime,
            waitingTime
        };
    }).filter(Boolean);
}

/**
 * computeAverages(summary)
 *
 * Computes mean turnaround time and mean waiting time across all processes.
 * Results are rounded to 2 decimal places for the stats panel display.
 *
 * @param  {Object[]} summary - Array of per-process stats from computeStats().
 * @returns {{ averageTurnaroundTime: string, averageWaitingTime: string }}
 */
function computeAverages(summary) {
    const total = summary.length;
    return {
        averageTurnaroundTime: (summary.reduce((s, r) => s + r.turnaroundTime, 0) / total).toFixed(2),
        averageWaitingTime: (summary.reduce((s, r) => s + r.waitingTime, 0) / total).toFixed(2)
    };
}
