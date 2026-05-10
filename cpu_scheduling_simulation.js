// =============================================================================
// cpu_scheduling_simulation.js
// =============================================================================
// Responsible for:
//   1. Defining the color palettes (light + dark) used consistently across
//      every UI element that represents a process (table dots, CPU box, queue
//      chips, Gantt bars, stats badges).
//   2. Providing `getColorPalette(processIndex)` - the single source of truth
//      for which color a process gets - and listening for OS theme changes so
//      all colored elements repaint automatically.
//   3. The `Scheduler` IIFE - the central animation engine that:
//        a. Validates inputs and calls the selected algorithm to produce frames.
//        b. Steps through frames tick-by-tick using setTimeout, with pause,
//           resume, and manual step-forward controls.
//        c. Updates the CPU box, ready queue, Gantt chart, and tick labels
//           on every frame.
//        d. Shows the results stats panel once the simulation finishes.
//
// Load order dependency:
//   This file must load BEFORE cpu_scheduling_process_editor.js because
//   ProcessEditor calls `Scheduler.init()` at the bottom of its file, and
//   Scheduler must exist by then.
//   It must load AFTER cpu_scheduling_algorithms.js because it calls
//   `computeGantt`, `computeStats`, and `computeAverages` from that file.
// =============================================================================


// -----------------------------------------------------------------------------
// Color palettes
// -----------------------------------------------------------------------------

/**
 * lightColorPalette / darkColorPalette
 *
 * Each palette is an array of 7 color tokens. Each token has three roles:
 *   bg     - fill color for the process chip / bar background.
 *   border - stroke color for chip borders and the CPU box border.
 *   text   - foreground color for labels inside chips and bars.
 *
 * Light and dark palettes share the same border colors but swap the bg/text
 * values so that backgrounds are light-on-dark in dark mode and dark-on-light
 * in light mode, maintaining readable contrast in both themes.
 *
 * The palettes are intentionally aligned: index 0 in both arrays always
 * represents the same "blue" process, so colors stay consistent when the
 * theme changes - only the shade flips.
 *
 * 7 colors covers most typical process sets. If more than 7 processes exist,
 * `getColorPalette` wraps around with modulo so colors repeat rather than
 * crashing.
 */
const lightColorPalette = [
    { bg: '#E6F1FB', border: '#378ADD', text: '#0C447C' }, // Blue
    { bg: '#E1F5EE', border: '#1D9E75', text: '#085041' }, // Green
    { bg: '#FAEEDA', border: '#BA7517', text: '#633806' }, // Amber
    { bg: '#FBEAF0', border: '#D4537E', text: '#72243E' }, // Pink
    { bg: '#EEEDFE', border: '#7F77DD', text: '#3C3489' }, // Purple
    { bg: '#FAECE7', border: '#D85A30', text: '#712B13' }, // Orange
    { bg: '#EAF3DE', border: '#639922', text: '#27500A' }  // Lime
];

const darkColorPalette = [
    { bg: '#0C447C', border: '#378ADD', text: '#B5D4F4' }, // Blue
    { bg: '#085041', border: '#1D9E75', text: '#9FE1CB' }, // Green
    { bg: '#633806', border: '#BA7517', text: '#FAC775' }, // Amber
    { bg: '#72243E', border: '#D4537E', text: '#F4C0D1' }, // Pink
    { bg: '#3C3489', border: '#7F77DD', text: '#CECBF6' }, // Purple
    { bg: '#712B13', border: '#D85A30', text: '#F5C4B3' }, // Orange
    { bg: '#27500A', border: '#639922', text: '#C0DD97' }  // Lime
];

/**
 * getColorPalette(processIndex)
 *
 * Returns the color token for a given process index, automatically selecting
 * the light or dark palette based on the current OS color scheme.
 *
 * Called by every rendering function that needs to color a process - CPU box,
 * queue chips, Gantt bars, table dots, and stats badges - so all elements
 * always use the exact same color for the same process.
 *
 * The modulo (`%`) ensures that process indices beyond 6 wrap back to index 0
 * rather than returning undefined.
 *
 * @param  {number} processIndex - Zero-based index of the process in the
 *                                 original `processes` array.
 * @returns {{ bg: string, border: string, text: string }}
 */
function getColorPalette(processIndex) {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const colorPalette = isDarkMode ? darkColorPalette : lightColorPalette;
    return colorPalette[processIndex % colorPalette.length];
}

/**
 * OS color-scheme change listener
 *
 * Fires when the user switches between light and dark mode at the OS level.
 * Triggers a repaint of all colored elements in both modules so they
 * immediately reflect the new palette without requiring a page reload or a
 * new simulation run.
 *
 * Defensive `typeof` checks guard against the unlikely case where one module
 * failed to load - repaintColors on the other can still proceed safely.
 */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (typeof ProcessEditor !== 'undefined' && ProcessEditor.repaintColors) {
        ProcessEditor.repaintColors(); // Repaints the color dots in the process table.
    }

    if (typeof Scheduler !== 'undefined' && Scheduler.repaintColors) {
        Scheduler.repaintColors(); // Repaints Gantt bars, queue chips, and stats badges.
    }
});


// -----------------------------------------------------------------------------
// Scheduler IIFE
// -----------------------------------------------------------------------------

/**
 * Scheduler
 *
 * The central animation engine. Wrapped in an IIFE so all internal state and
 * helper functions are private; only the methods listed in the final `return`
 * statement are accessible from HTML event handlers and ProcessEditor.
 */
const Scheduler = (() => {

    // -------------------------------------------------------------------------
    // Private state
    // -------------------------------------------------------------------------

    /**
     * processes   - The process list captured at the moment Run is pressed.
     *               Held here (not just in ProcessEditor) so rendering
     *               functions can look up colors by process name during and
     *               after the simulation.
     *
     * editor      - Reference to the ProcessEditor module, set by `init()`.
     *               null if Scheduler is used without a live editor (e.g., tests).
     *
     * frames      - The full tick-by-tick simulation log produced by the
     *               elected algorithm. Each entry is one clock-tick snapshot.
     *
     * ganttBlocks - Compressed list of Gantt bar segments derived from frames
     *               by computeGantt(). Used to build and animate the Gantt chart.
     *
     * frameIndex  - Index of the next frame to apply. Increments after each
     *               tick; when it reaches frames.length the simulation ends.
     *
     * timer       - The setTimeout handle for the current pending tick.
     *               Stored so it can be cancelled on pause or reset.
     *
     * isRunning   - True from the moment Run is pressed until finish() is
     *               called. Controls whether pause/step/reset are meaningful.
     *
     * isPaused    - True while the simulation is suspended mid-run.
     *               scheduleNextFrame() is a no-op while this is true.
     *
     * speedMs     - Milliseconds between frames, derived from the speed
     *               slider. Calculated as 600 / sliderValue so that slider
     *               max (10) = 60 ms (fast) and slider min (1) = 600 ms (slow).
     *
     * previousQueueNames - Names of processes that were in the ready queue
     *                      on the previous frame. Used by renderQueue() to
     *                      determine which chips to add, update, or remove
     *                      without rebuilding the entire queue DOM from scratch.
     *
     * currentQuantum - The time quantum value currently entered in the quantum
     *                  input. Updated live as the user types; read when Run is
     *                  pressed to pass to RR / PRR algorithms.
     */
    let processes = [];
    let editor = null;
    let frames = [];
    let ganttBlocks = [];
    let frameIndex = 0;
    let timer = null;
    let isRunning = false;
    let isPaused = false;
    let speedMs = 200;
    let previousQueueNames = [];
    let currentQuantum = 2;


    // -------------------------------------------------------------------------
    // DOM utility helpers
    // -------------------------------------------------------------------------

    /**
     * getElement(id)
     * Thin wrapper around getElementById to keep call-sites concise.
     */
    function getElement(id) {
        return document.getElementById(id);
    }

    /**
     * hideElement(id)
     * Sets display:none on an element by id. Null-safe - does nothing if the
     * element doesn't exist (guards against typos or optional DOM elements).
     */
    function hideElement(id) {
        const element = getElement(id);
        if (element) element.style.display = 'none';
    }

    /**
     * setText(id, value)
     * Sets the textContent of an element by id. Null-safe for the same reason
     * as hideElement.
     */
    function setText(id, value) {
        const element = getElement(id);
        if (element) element.textContent = value;
    }


    // -------------------------------------------------------------------------
    // Error toast
    // -------------------------------------------------------------------------

    /**
     * showError(message)
     *
     * Displays a validation error inside the red toast banner above the process
     * table. Prepends a warning icon to the message for visual clarity.
     * Called when Run is pressed and validation fails (invalid fields or
     * bad quantum value).
     */
    function showError(message) {
        const element = getElement('error-toast');
        if (!element) return;
        element.textContent = '⚠ ' + message;
        element.style.display = 'block';
    }

    /**
     * hideError()
     *
     * Clears and hides the error toast. Called when:
     *   - A previously invalid field becomes valid (from validateField).
     *   - The algorithm dropdown changes.
     *   - A simulation run starts successfully.
     *
     * Also exposed in the public API as `clearError` so ProcessEditor can
     * trigger it after row add/remove actions.
     */
    function hideError() {
        const element = getElement('error-toast');
        if (element) element.style.display = 'none';
    }


    // -------------------------------------------------------------------------
    // Button state management
    // -------------------------------------------------------------------------

    /**
     * setButtonStates(running)
     *
     * Enables or disables the Pause and Step buttons depending on whether a
     * simulation is actively running. Also keeps the Pause button label in
     * sync with the current `isPaused` state (shows "Resume" when paused).
     *
     * @param {boolean} running - true = simulation in progress, false = idle/finished.
     */
    function setButtonStates(running) {
        getElement('btn-pause').disabled = !running;
        getElement('btn-step').disabled = !running;
        getElement('btn-pause').textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    }


    // -------------------------------------------------------------------------
    // Algorithm & options helpers
    // -------------------------------------------------------------------------

    /**
     * getSelectedAlgorithm()
     *
     * Reads the current value of the algorithm dropdown and returns both the
     * key string and the algorithm object from the `algorithms` registry
     * (defined in cpu_scheduling_algorithms.js).
     *
     * Throws if the key is unrecognized - this would indicate a mismatch
     * between the HTML <option> values and the registry, which is a developer
     * error rather than a user error.
     *
     * @returns {{ key: string, algorithm: Object }}
     */
    function getSelectedAlgorithm() {
        const key = getElement('algo-select')?.value || 'fcfs';
        const algorithm = algorithms[key];
        if (!algorithm) throw new Error(`Unknown algorithm selected: "${key}"`);
        return { key, algorithm };
    }

    /**
     * getAlgorithmOptions()
     *
     * Bundles the current configuration values into the options object passed
     * to algorithm `run()` functions. Currently only contains `quantum`, but
     * structured as an object so additional options can be added here without
     * changing every algorithm's signature.
     *
     * @returns {{ quantum: number }}
     */
    function getAlgorithmOptions() {
        return { quantum: currentQuantum };
    }

    /**
     * resetQuantumField()
     *
     * Restores the quantum input to the last valid `currentQuantum` value and
     * clears any red border left by a previous failed validation. Called when
     * the algorithm changes or a row is added/removed, so the field never
     * shows stale error state after a context switch.
     */
    function resetQuantumField() {
        const input = getElement('rr-quantum');
        if (!input) return;
        input.value = currentQuantum;
        input.style.borderColor = '';
    }

    /**
     * validateQuantum()
     *
     * Validates the time quantum input and updates its border color.
     * Returns an error string if invalid, or null if valid.
     *
     * Rules: non-empty, a whole number, at least 1.
     *
     * Note: this only validates - it does not update `currentQuantum`.
     * `currentQuantum` is updated inside the `input` event listener attached
     * in `onAlgorithmChange()`, but only when the value is already valid, so
     * the field can be mid-edit without corrupting the stored quantum.
     *
     * @returns {string|null} Error message, or null if valid.
     */
    function validateQuantum() {
        const input = getElement('rr-quantum');
        if (!input) return null;

        const raw    = input.value.trim();
        const parsed = parseInt(raw, 10);
        let error    = null;

        if (raw === '') {
            error = 'Time quantum cannot be empty.';
        } else if (!Number.isInteger(parsed) || isNaN(parsed)) {
            error = 'Time quantum must be a whole number.';
        } else if (parsed < 1) {
            error = 'Time quantum must be at least 1.';
        }

        // Immediately reflect validity in the input border color.
        input.style.borderColor = error ? 'var(--danger)' : '';
        return error;
    }


    // -------------------------------------------------------------------------
    // Algorithm change handler
    // -------------------------------------------------------------------------

    /**
     * onAlgorithmChange()
     *
     * Called whenever the algorithm dropdown value changes (and also during
     * `init()` to set up the initial state). Handles all UI side-effects of
     * switching algorithms:
     *
     *   1. Shows or hides the Time Quantum input wrapper based on `needsQuantum`.
     *   2. Attaches the quantum input's `input` event listener exactly once
     *      (guarded by `dataset.validated`) to avoid stacking duplicate listeners
     *      each time the dropdown changes. The listener updates `currentQuantum`
     *      only on valid values, and clears the error toast when valid.
     *   3. Clears any error toast and resets the quantum field to its last
     *      valid value.
     *   4. Clears a lingering red border on the quantum input if the newly
     *      selected algorithm doesn't need a quantum (so the hidden field
     *      doesn't carry forward a stale error).
     *   5. Tells ProcessEditor to show or hide the Priority column based on
     *      `needsPriority`. Falls back to a direct DOM query if editor isn't
     *      wired up yet (e.g., during initial load before ProcessEditor runs).
     *   6. Calls `reset()` to clear any previous simulation state.
     */
    function onAlgorithmChange() {
        const key = getElement('algo-select')?.value || 'fcfs';
        const algorithm = algorithms[key];
        if (!algorithm) return;

        const quantumWrap  = getElement('quantum-wrap');
        const quantumInput = getElement('rr-quantum');

        // Show the quantum input row only for algorithms that need it.
        if (quantumWrap) quantumWrap.style.display = algorithm.needsQuantum ? 'flex' : 'none';

        // Attach the quantum live-update listener once, using a data attribute
        // as a flag so subsequent algorithm changes don't stack more listeners.
        if (quantumInput && !quantumInput.dataset.validated) {
            quantumInput.dataset.validated = 'true';

            quantumInput.addEventListener('input', () => {
                const parsed = parseInt(quantumInput.value.trim(), 10);
                // Only commit to currentQuantum when the value is fully valid.
                if (Number.isInteger(parsed) && parsed >= 1) {
                    currentQuantum = parsed;
                }
                const qError = validateQuantum();
                if (!qError) hideError();
            });
        }

        hideError();
        resetQuantumField();

        // Clear any red border on the quantum input for algorithms that don't use it.
        if (!algorithm.needsQuantum && quantumInput) {
            quantumInput.style.borderColor = '';
        }

        // Delegate priority column visibility to ProcessEditor if available.
        if (editor && editor.setPriorityVisible) {
            editor.setPriorityVisible(algorithm.needsPriority);
        } else {
            // Fallback: direct DOM manipulation during initial load.
            document.querySelectorAll('.col-priority').forEach(e => {
                e.style.display = algorithm.needsPriority ? '' : 'none';
            });
        }

        reset();
    }


    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    /**
     * init(processEditor)
     *
     * Wires the Scheduler to the ProcessEditor module and triggers the initial
     * algorithm-change setup. Called once at the bottom of
     * cpu_scheduling_process_editor.js after both modules are fully defined.
     *
     * Accepts either a ProcessEditor-compatible object (with `getProcesses`)
     * or a raw processes array (for testing / embedding without the editor UI).
     *
     * @param {Object|Array} processEditor - ProcessEditor module or raw process array.
     */
    function init(processEditor) {
        if (processEditor && typeof processEditor.getProcesses === 'function') {
            editor = processEditor;
            processes = editor.getProcesses(); // Pre-load default processes.
        } else {
            // Fallback: accept a plain array of process objects directly.
            editor = null;
            processes = processEditor || [];
        }

        onAlgorithmChange(); // Apply initial dropdown state and reset UI.
    }


    // -------------------------------------------------------------------------
    // Simulation lifecycle: run / pause / step / reset
    // -------------------------------------------------------------------------

    /**
     * run()
     *
     * Entry point for starting a simulation. Called when the Run button is
     * clicked. Performs validation, builds the frame log, then starts the
     * animation loop.
     *
     * Steps:
     *   1. Run full blocking validation via ProcessEditor.validate(). If any
     *      field is invalid, show the error and abort.
     *   2. Capture the current process list from the editor DOM (fresh read so
     *      any last-second edits are included).
     *   3. Validate the quantum input if the current algorithm needs one.
     *   4. Call the algorithm's `run()` function to produce the frames array.
     *   5. Derive Gantt blocks from frames and pre-build the Gantt bar DOM.
     *   6. Disable the Run button, enable Pause/Step, hide the old stats panel.
     *   7. Start the animation with `scheduleNextFrame()`.
     */
    function run() {
        if (editor) {
            const error = editor.validate();
            if (error) { showError(error); return; }
            processes = editor.getProcesses(); // Re-read at run time for accuracy.
        }

        const { algorithm } = getSelectedAlgorithm();
        if (algorithm.needsQuantum) {
            const qError = validateQuantum();
            if (qError) { showError(qError); return; }
        }

        hideError();
        reset(); // Clear any leftover state from a previous run.

        const options = getAlgorithmOptions();
        frames = algorithm.run(processes, options);

        if (!frames.length) return; // Edge case: no processes produced no frames.

        ganttBlocks = computeGantt(frames);
        buildGanttSkeleton(); // Pre-creates all bar elements at width:0.

        isRunning = true;
        isPaused = false;

        getElement('btn-run').disabled = true; // Prevent double-starting.
        setButtonStates(true);
        hideElement('stats-area'); // Clear previous results.

        scheduleNextFrame();
    }

    /**
     * togglePause()
     *
     * Pauses the simulation if running, or resumes it if paused. Updates the
     * Pause button label and restarts the frame schedule when resuming.
     * No-op if the simulation hasn't started.
     */
    function togglePause() {
        if (!isRunning) return;
        isPaused = !isPaused;
        getElement('btn-pause').textContent = isPaused ? '▶ Resume' : '⏸ Pause';
        // Only restart the timer loop when resuming; pausing lets the current
        // setTimeout expire naturally (scheduleNextFrame checks isPaused at its top).
        if (!isPaused) scheduleNextFrame();
    }

    /**
     * stepForward()
     *
     * Advances the simulation by exactly one frame while in paused state.
     * Ensures the simulation is marked as paused (so the loop doesn't auto-
     * advance), cancels any pending timer, applies the next frame, then
     * increments the index ready for the next manual step.
     *
     * If the simulation wasn't paused before, this also pauses it - so
     * clicking Step mid-run suspends auto-play and advances by one tick.
     */
    function stepForward() {
        if (!isRunning) return;
        isPaused = true;
        getElement('btn-pause').textContent = '▶ Resume';
        clearTimeout(timer); // Cancel any pending auto-advance.
        applyFrame(frameIndex);
        frameIndex++;
    }

    /**
     * reset()
     *
     * Returns the entire simulation to its initial state. Cancels any pending
     * timer, zeros all state variables, re-enables the Run button, and clears
     * all simulation UI elements (Gantt, ticks, CPU box, queue, stats).
     *
     * Called explicitly by the Reset button, and also internally at the start
     * of every `run()` call to ensure a clean slate.
     */
    function reset() {
        clearTimeout(timer);
        isRunning = false;
        isPaused = false;
        frameIndex = 0;
        frames = [];
        ganttBlocks = [];

        getElement('btn-run').disabled = false;
        setButtonStates(false);
        setText('time-display', 'Time: 0');
        getElement('gantt').innerHTML = '';
        getElement('gantt-ticks').innerHTML = '';
        previousQueueNames = [];
        hideElement('stats-area');
        resetCPU();
        resetQueue();
    }

    /**
     * setSpeed(value)
     *
     * Converts the speed slider's raw value (1–10) into a millisecond delay
     * between frames. The inverse relationship (600 / value) means a higher
     * slider value = smaller delay = faster animation.
     *
     * Speed 1  -> 600 ms per tick (slow, easy to follow)
     * Speed 5  -> 120 ms per tick (default)
     * Speed 10 ->  60 ms per tick (fast)
     *
     * @param {number|string} value - Slider value from the HTML range input.
     */
    function setSpeed(value) {
        speedMs = Math.round(600 / value);
    }


    // -------------------------------------------------------------------------
    // Animation loop
    // -------------------------------------------------------------------------

    /**
     * scheduleNextFrame()
     *
     * The core animation loop - called recursively via setTimeout to advance
     * one frame per tick at the current speed.
     *
     * Flow:
     *   1. Guard: bail immediately if not running or paused.
     *   2. Apply the current frame to the UI.
     *   3. Increment the frame index.
     *   4. If there are more frames (or we just hit the final one to trigger
     *      finish()), schedule another call after `speedMs` milliseconds.
     *
     * The condition `frameIndex <= frames.length` (not `< frames.length`)
     * ensures that `applyFrame` is called one extra time with index equal to
     * `frames.length`, which triggers the "simulation complete" branch inside
     * `applyFrame` that calls `finish()`.
     */
    function scheduleNextFrame() {
        if (!isRunning || isPaused) return;
        applyFrame(frameIndex);
        frameIndex++;
        
        if (frameIndex <= frames.length) {
            timer = setTimeout(scheduleNextFrame, speedMs);
        }
    }

    /**
     * applyFrame(index)
     *
     * Applies one frame of the simulation to the UI. Handles two cases:
     *
     * Case 1 - Normal frame (index < frames.length):
     *   Updates the clock display, CPU box, ready queue, Gantt bars, and tick
     *   labels to reflect the state at this tick.
     *
     * Case 2 - Past-the-end (index >= frames.length):
     *   The simulation has finished. This branch:
     *     - Sets the clock to the final completion time (last frame's time + 1).
     *     - Forces all Gantt bars to their full width (in case any are still
     *       partially animated due to timing).
     *     - Renders all remaining ticks.
     *     - Resets the CPU box and queue to idle/empty.
     *     - Calls finish() to show the results panel and restore button states.
     *
     * @param {number} index - Frame index to apply (may equal frames.length).
     */
    function applyFrame(index) {
        
        if (index >= frames.length) {
            // Simulation complete - snap everything to its final state.
            const finalTime = frames[frames.length - 1].time + 1;
            const total     = frames.length;

            setText('time-display', 'Time: ' + finalTime);

            // Force all bars to their full final width in case any are still growing.
            ganttBlocks.forEach(b => {
                const bar = getElement('gb-' + b.start + '-' + b.end);
                if (bar) bar.style.width = ((b.end - b.start) / total * 100).toFixed(2) + '%';
            });

            renderTicks(finalTime, total);
            resetCPU();
            resetQueue();
            finish();
            return;
        }

        // Normal tick: update all UI sections from the current frame's data.
        const frame = frames[index];
        const total = frames.length;

        setText('time-display', 'Time: ' + frame.time);
        renderCPU(frame);
        renderQueue(frame.queue);
        renderGantt(frame.time, total);
        renderTicks(frame.time, total);
    }


    // -------------------------------------------------------------------------
    // CPU box rendering
    // -------------------------------------------------------------------------

    /**
     * renderCPU(frame)
     *
     * Updates the CPU box to display the currently running process for this
     * tick, or shows an "Idle" state if no process is running.
     *
     * When active: applies the process's color palette (background, border,
     * text) and shows the process name and remaining burst time below the box.
     * When idle: clears all inline styles so the CSS `.idle` class takes over,
     * which renders the box as a neutral gray.
     *
     * `cpu-proc` and `cpu-rem` are optional elements (checked with `if`). They
     * exist in the DOM but could be absent in stripped-down test environments.
     *
     * @param {Object} frame - One frame object from the frames array.
     */
    function renderCPU(frame) {
        const box = getElement('cpu-box');
        const processSpan = getElement('cpu-proc');
        const remainingBurstSpan = getElement('cpu-rem');

        if (frame.process === 'idle') {
            // Clear inline styles so the `.idle` CSS class controls the appearance.
            box.style.background = '';
            box.style.borderColor = '';
            box.style.color = '';
            box.classList.add('idle');
            box.textContent = 'Idle';
            if (processSpan) processSpan.textContent = '—';
            if (remainingBurstSpan) remainingBurstSpan.textContent = '—';
        } else {
            const index = processes.findIndex(p => p.name === frame.process);
            const color = getColorPalette(index);

            box.style.background = color.bg;
            box.style.borderColor = color.border;
            box.style.color = color.text;
            box.classList.remove('idle');
            box.textContent = frame.process;
            if (processSpan) processSpan.textContent = frame.process;
            if (remainingBurstSpan) remainingBurstSpan.textContent = frame.remainingBurstTime + ' units';
        }
    }

    /**
     * resetCPU()
     *
     * Returns the CPU box to its idle appearance. Called at the end of a
     * simulation run (in `applyFrame`'s finish branch) and on `reset()`.
     * Explicitly clears inline styles to ensure the `.idle` CSS class governs.
     */
    function resetCPU() {
        const box = getElement('cpu-box');
        box.style.background = '';
        box.style.borderColor = '';
        box.style.color = '';
        box.classList.add('idle');
        box.textContent = 'Idle';
        setText('cpu-proc', '—');
        setText('cpu-rem', '—');
    }


    // -------------------------------------------------------------------------
    // Ready queue rendering
    // -------------------------------------------------------------------------

    /**
     * renderQueue(queueSnapshot)
     *
     * Updates the ready queue display to match the current frame's queue
     * snapshot. Uses a diff-style approach rather than rebuilding the DOM from
     * scratch every tick, which enables CSS entry animations for new chips.
     *
     * Algorithm:
     *   1. If the snapshot is empty, show the "Empty" placeholder and bail.
     *   2. Remove chips for processes that were in the queue last tick but
     *      aren't in this tick's snapshot (they've been picked up by the CPU
     *      or finished).
     *   3. Remove the "Empty" placeholder span if it's still in the DOM.
     *   4. For each process in the snapshot:
     *      - If it's new (not in `previousQueueNames`): create a fresh chip
     *        with the `.entering` class (CSS slides it in from the right), then
     *        remove the class on the next two animation frames so the transition
     *        plays. The double `requestAnimationFrame` ensures the browser has
     *        painted the initial transform before the class removal triggers.
     *      - If it already exists: update its inner HTML in place (updates the
     *        remaining burst time label without recreating the element).
     *   5. Re-append chips in snapshot order so the DOM order matches the
     *      algorithm's queue order (important for RR where order matters).
     *   6. Update `previousQueueNames` for the next frame's diff.
     *
     * Priority badges (★N) are shown only for algorithms that use priority.
     *
     * @param {Object[]|null} queueSnapshot - Array of { name, remainingBurstTime,
     *                                        priority } from the current frame.
     */
    function renderQueue(queueSnapshot) {
        const area = getElement('queue-area');

        if (!queueSnapshot || !queueSnapshot.length) {
            area.innerHTML = '<span class="queue-empty">Empty</span>';
            previousQueueNames = [];
            return;
        }

        const { key } = getSelectedAlgorithm();
        const showPriority = algorithms[key].needsPriority;

        const snapNames = queueSnapshot.map(qp => qp.name);

        // Step 1: Remove chips that have left the queue since the last frame.
        previousQueueNames
            .filter(n => !snapNames.includes(n))
            .forEach(n => {
                const element = area.querySelector(`[data-process="${n}"]`);
                if (element) element.remove();
            });

        // Step 2: Remove "Empty" placeholder if it's still showing.
        const emptySpan = area.querySelector('.queue-empty');
        if (emptySpan) emptySpan.remove();

        // Step 3: Add new chips or update existing ones.
        queueSnapshot.forEach(qp => {
            const isNew = !previousQueueNames.includes(qp.name);
            let chip = area.querySelector(`[data-process="${qp.name}"]`);

            const badge = showPriority && qp.priority != null ? `<div class="chip-priority">★${qp.priority}</div>` : '';
            const innerContent = `
                <div class="chip-name">${qp.name}</div>
                <div class="chip-rem">${qp.remainingBurstTime}u</div>
                ${badge}
            `;

            if (isNew) {
                // Create a new chip and animate it sliding in.
                const index = processes.findIndex(p => p.name === qp.name);
                const color = getColorPalette(index);

                chip = document.createElement('div');
                chip.className = 'q-chip entering'; // `.entering` applies the initial offset.
                chip.dataset.process = qp.name;     // Used as the selector key for future diff lookups.
                chip.style.cssText = `background:${color.bg};border-color:${color.border};color:${color.text}`;

                chip.innerHTML = innerContent;
                area.appendChild(chip);

                // Double rAF: ensures the browser renders the `.entering` state
                // before removing the class, so the CSS transition actually plays.
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => chip.classList.remove('entering'))
                );
            } else {
                // Existing chip: just refresh the inner content (burst count may have changed).
                chip.innerHTML = innerContent;
            }
        });

        // Step 4: Re-order chips in the DOM to match the snapshot order.
        // appendChild moves existing nodes, so this re-sorts without recreating.
        queueSnapshot.forEach(qp => {
            const chip = area.querySelector(`[data-process="${qp.name}"]`);
            if (chip) area.appendChild(chip);
        });

        // Safety fallback: if somehow all chips were removed, show "Empty".
        if (!area.querySelector('.q-chip')) {
            area.innerHTML = '<span class="queue-empty">Empty</span>';
        }

        // Step 5: Record current names for next frame's diff.
        previousQueueNames = [...snapNames];
    }

    /**
     * resetQueue()
     *
     * Clears the ready queue area and resets the diff tracker. Called at the
     * end of a run and on reset().
     */
    function resetQueue() {
        getElement('queue-area').innerHTML = '<span class="queue-empty">Empty</span>';
        previousQueueNames = [];
    }


    // -------------------------------------------------------------------------
    // Gantt chart rendering
    // -------------------------------------------------------------------------

    /**
     * buildGanttSkeleton()
     *
     * Pre-creates all Gantt bar elements before the animation starts, each
     * beginning at width:0. During the animation, `renderGantt()` gradually
     * widens each bar as time progresses - this creates the "growing bar" effect.
     *
     * Each bar element is given:
     *   - An `id` of "gb-{start}-{end}" so `renderGantt()` can find it quickly.
     *   - A `max-width` set to the bar's full final percentage width. This acts
     *     as a CSS cap so the bar can never grow past its correct size regardless
     *     of floating point rounding in the width calculations.
     *   - The process's color palette (or no color for idle blocks).
     *   - The process name as text content (or "—" for idle).
     *
     * Called once at the start of each simulation run, after ganttBlocks is populated.
     */
    function buildGanttSkeleton() {
        const ganttElement = getElement('gantt');
        ganttElement.innerHTML = '';
        const total = frames.length || 1; // Guard against division by zero.

        ganttBlocks.forEach(b => {
            const index = processes.findIndex(p => p.name === b.name);
            // index will be -1 for idle blocks - color will be null, no styles applied.
            const color = index >= 0 ? getColorPalette(index) : null;
            const maxPercentage = ((b.end - b.start) / total * 100).toFixed(2) + '%';

            const bar = document.createElement('div');
            bar.className = 'g-block' + (b.name === 'idle' ? ' idle' : '');
            bar.id = 'gb-' + b.start + '-' + b.end;
            // Build the style string, filtering out empty entries for idle blocks.
            bar.style.cssText = [
                'width:0',                                      // Starts invisible; grows during animation.
                'max-width:' + maxPercentage,                   // Hard cap at the correct final size.
                color ? `background:${color.bg}` : '',
                color ? `border-color:${color.border}` : '',
                color ? `color:${color.text}` : '',
            ].filter(Boolean).join(';');

            bar.textContent = b.name === 'idle' ? '—' : b.name;
            ganttElement.appendChild(bar);
        });
    }

    /**
     * renderGantt(time, total)
     *
     * Updates the widths of Gantt bars to reflect how far the simulation has
     * progressed at the current clock tick.
     *
     * For each block:
     *   - Fully past (b.end <= time): set to its full final width.
     *   - Currently active (b.start < time): grow proportionally to how many
     *     ticks of it have elapsed (time - b.start).
     *   - Not yet started (b.start >= time): leave at width:0 (untouched).
     *
     * Widths are expressed as a percentage of total simulation time so the
     * chart always fills the container regardless of how long the simulation is.
     *
     * @param {number} time  - Current clock tick being displayed.
     * @param {number} total - Total number of frames (= total simulation time).
     */
    function renderGantt(time, total) {
        ganttBlocks.forEach(b => {
            const bar = getElement('gb-' + b.start + '-' + b.end);
            if (!bar) return;

            if (b.end <= time) {
                // Block is fully in the past - show at its complete width.
                bar.style.width = ((b.end - b.start) / total * 100).toFixed(2) + '%';
            } else if (b.start < time) {
                // Block is currently active - show only the elapsed portion.
                bar.style.width = ((time - b.start) / total * 100).toFixed(2) + '%';
            }
            // b.start >= time: block hasn't started yet, leave at width:0.
        });
    }

    /**
     * renderTicks(currentTime, total)
     *
     * Rebuilds the tick label row below the Gantt chart to show time markers
     * only for block boundaries that have been reached so far. Rebuilds from
     * scratch each frame to keep it simple (the tick row is small).
     *
     * A `seen` Set prevents duplicate tick labels when multiple blocks share
     * the same start time (which can't happen in practice but guards against it).
     *
     * The final tick (at `total`) is appended separately because no Gantt block
     * starts at that time - it's the end time of the last block, representing
     * when the simulation fully completes.
     *
     * @param {number} currentTime - The current clock value being displayed.
     * @param {number} total       - The total simulation time (last tick value).
     */
    function renderTicks(currentTime, total) {
        const tickElement = getElement('gantt-ticks');
        tickElement.innerHTML = '';

        const seen = new Set();

        ganttBlocks.forEach(b => {
            if (b.start > currentTime || seen.has(b.start)) return;
            seen.add(b.start);
            appendTick(tickElement, b.start, total);
        });

        // Append the final "end of simulation" tick once all frames have played.
        if (currentTime === total && !seen.has(total)) {
            appendTick(tickElement, total, total);
        }
    }

    /**
     * appendTick(container, time, total)
     *
     * Creates and positions one tick label as an absolutely positioned <span>
     * inside the tick row. The `left` percentage aligns the label with the
     * corresponding Gantt bar boundary above it.
     *
     * @param {HTMLElement} container - The gantt-ticks div to append into.
     * @param {number}      time      - The clock value this tick represents.
     * @param {number}      total     - Total simulation time (used for % calculation).
     */
    function appendTick(container, time, total) {
        const span = document.createElement('span');
        span.className = 'tick';
        span.style.left = (time / total * 100).toFixed(2) + '%';

        // Determine the correct alignment once, at creation time.
        // This avoids :first-child/:last-child shifting when new ticks are inserted.
        if (time === 0) {
            span.style.transform = 'none';                // flush left — never shifts
        } else if (time === total) {
            span.style.transform = 'translateX(-100%)';   // flush right — only ever the final tick
        } else {
            span.style.transform = 'translateX(-50%)';    // centered — stable from creation
        }

        span.textContent = time;
        container.appendChild(span);
    }


    // -------------------------------------------------------------------------
    // Color repaint (theme change)
    // -------------------------------------------------------------------------

    /**
     * repaintColors()
     *
     * Re-applies the correct palette colors to all currently visible colored
     * elements managed by the Scheduler: Gantt bars, queue chips, and stats
     * badges. Called by the OS color-scheme change listener at the top of this
     * file.
     *
     * Idle Gantt blocks are skipped (they have no process color).
     * Elements whose process name can't be found in `processes` are skipped
     * (shouldn't happen in normal use, but guards against stale DOM).
     *
     * Does not re-render the table - that's handled by ProcessEditor.repaintColors().
     */
    function repaintColors() {
        // Gantt bars.
        ganttBlocks.forEach(b => {
            const bar = getElement('gb-' + b.start + '-' + b.end);
            if (!bar || b.name === 'idle') return;
            const index = processes.findIndex(p => p.name === b.name);
            if (index < 0) return;
            const color = getColorPalette(index);
            bar.style.background   = color.bg;
            bar.style.borderColor  = color.border;
            bar.style.color        = color.text;
        });

        // Ready queue chips.
        const area = getElement('queue-area');
        if (area) {
            area.querySelectorAll('.q-chip').forEach(chip => {
                const name  = chip.dataset.process; // Process name stored in data attribute.
                const index = processes.findIndex(p => p.name === name);
                if (index < 0) return;
                const color = getColorPalette(index);
                chip.style.background  = color.bg;
                chip.style.borderColor = color.border;
                chip.style.color       = color.text;
            });
        }

        // Stats table process badges.
        const statsArea = getElement('stats-area');
        if (statsArea) {
            statsArea.querySelectorAll('.proc-badge').forEach(badge => {
                const name  = badge.textContent.trim(); // Process name is the badge's text.
                const index = processes.findIndex(p => p.name === name);
                if (index < 0) return;
                const color = getColorPalette(index);
                badge.style.background  = color.bg;
                badge.style.borderColor = color.border;
                badge.style.color       = color.text;
            });
        }
    }


    // -------------------------------------------------------------------------
    // Simulation completion
    // -------------------------------------------------------------------------

    /**
     * finish()
     *
     * Called once all frames have been applied. Cleans up the animation state
     * and transitions the UI to the "completed" state:
     *   - Cancels any lingering timer.
     *   - Marks the simulation as no longer running.
     *   - Re-enables the Run button and disables Pause/Step.
     *   - Renders the results stats panel.
     */
    function finish() {
        clearTimeout(timer);
        isRunning = false;
        isPaused  = false;

        getElement('btn-run').disabled = false;
        setButtonStates(false);
        renderStats(); // Build and show the stats panel below the simulation card.
    }

    /**
     * renderStats()
     *
     * Builds and displays the results panel after a simulation completes.
     * Constructs the entire panel programmatically (no static HTML template)
     * so it can adapt to whether priority columns are needed.
     *
     * Panel structure:
     *   1. Algorithm label line ("Results — [Algorithm Name]").
     *   2. Summary cards: average turnaround time and average waiting time.
     *   3. Per-process table with columns: Process, Arrival, Burst,
     *      [Priority if needed], Finish, TAT (turnaround), WT (waiting).
     *      Each process name is wrapped in a colored `.proc-badge` span.
     *
     * Data comes from `computeStats()` and `computeAverages()` in
     * cpu_scheduling_algorithms.js, which derive all metrics from the
     * completed `frames` array.
     */
    function renderStats() {
        const stats = computeStats(processes, frames);
        const averages = computeAverages(stats);
        const area = getElement('stats-area');
        const { key } = getSelectedAlgorithm();

        // Clear any previous results and set up flex column layout.
        area.innerHTML = '';
        area.style.display = 'flex';
        area.style.flexDirection = 'column';
        area.style.gap = '12px';

        // Algorithm label.
        const algorithmLabel = document.createElement('div');
        algorithmLabel.className = 'stat-algo-label';
        algorithmLabel.textContent = 'Results - ' + algorithms[key].label;
        area.appendChild(algorithmLabel);

        // Summary cards (avg TAT and avg WT).
        const summaryRow = document.createElement('div');
        summaryRow.className = 'stat-summary-row';
        [
            ['Average Turnaround Time', averages.averageTurnaroundTime + ' units'],
            ['Average Waiting Time', averages.averageWaitingTime + ' units']
        ].forEach(([label, value]) => {
            const card = document.createElement('div');
            card.className = 'stat-card';
            card.innerHTML = `
                <div class="stat-label">${label}</div>
                <div class="stat-value">${value}</div>
            `;
            summaryRow.appendChild(card);
        });
        area.appendChild(summaryRow);

        // Per-process detail table.
        // Priority column is included only for algorithms that use it.
        const showPriority = algorithms[key].needsPriority;
        const table = document.createElement('table');
        table.className = 'stat-table';

        const headers = ['Process', 'Arrival Time', 'Burst Time', ...(showPriority ? ['Priority'] : []), 'Completion Time', 'TAT', 'WT'];
        table.innerHTML = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody></tbody>`;

        const tbody = table.querySelector('tbody');
        stats.forEach(s => {
            const index = processes.findIndex(p => p.name === s.name);
            const color = getColorPalette(index);
            const trow = document.createElement('tr');

            const cells = [
                `<td><span class="proc-badge" style="background:${color.bg};border-color:${color.border};color:${color.text}">${s.name}</span></td>`,
                `<td>${s.arrivalTime}</td>`,
                `<td>${s.burstTime}</td>`,
                ...(showPriority ? [`<td>${s.priority}</td>`] : []),
                `<td>${s.completionTime}</td>`,
                `<td>${s.turnaroundTime}</td>`,
                `<td>${s.waitingTime}</td>`
            ];

            trow.innerHTML = cells.join('');
            tbody.appendChild(trow);
        });

        // Wrap table in a scroll container for narrow viewports (mobile).
        const tableWrap = document.createElement('div');
        tableWrap.className = 'stat-table-wrap';
        tableWrap.appendChild(table);
        area.appendChild(tableWrap);
    }


    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Methods exposed to the rest of the application:
     *
     *   init(processEditor) - Wire up ProcessEditor; call once on page load.
     *   run()               - Validate, build frames, and start animation.
     *   togglePause()       - Pause or resume the running simulation.
     *   stepForward()       - Advance one tick while paused.
     *   reset()             - Clear all simulation state and UI.
     *   setSpeed(value)     - Update animation speed from the range slider.
     *   onAlgorithmChange() - Handle algorithm dropdown change.
     *   validateQuantum()   - Validate the quantum input; return error or null.
     *   resetQuantumField() - Restore quantum input to last valid value.
     *   clearError          - Alias for hideError(); used by ProcessEditor.
     *   repaintColors()     - Re-apply palette after OS theme change.
     */
    return { init, run, togglePause, stepForward, reset, setSpeed, onAlgorithmChange, validateQuantum, resetQuantumField, clearError: hideError, repaintColors };
})();
