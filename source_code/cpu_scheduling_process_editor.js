// =============================================================================
// cpu_scheduling_process_editor.js
// =============================================================================
// Responsible for:
//   1. Maintaining the in-memory list of process rows (`rows`).
//   2. Rendering that list into the process table in the DOM.
//   3. Handling add / remove row actions.
//   4. Keeping `rows` in sync as the user edits individual input fields.
//   5. Validating all inputs - both live (per-field, on every keystroke) and
//      on-submit (full pass before a simulation run).
//   6. Exposing `getProcesses()` so the Scheduler can read the final values
//      right before it runs an algorithm.
//
// Exported as an IIFE (Immediately Invoked Function Expression) assigned to
// `ProcessEditor`. This keeps all internal state and helpers private while
// exposing only the methods the HTML and Scheduler actually need.
//
// Initialization order (bottom of this file):
//   1. `render()` is called inside the IIFE to populate the table immediately.
//   2. `Scheduler.init(ProcessEditor)` wires the two modules together.
// =============================================================================


const ProcessEditor = (() => {

    // -------------------------------------------------------------------------
    // Private state
    // -------------------------------------------------------------------------

    /**
     * rows
     *
     * The source-of-truth list of process definitions. Each entry mirrors one
     * table row and holds the values the user has typed in (or the defaults).
     *
     * Fields:
     *   name        {string} - Display name shown in the table and Gantt chart.
     *   arrivalTime {number} - Clock tick at which the process enters the system.
     *   burstTime   {number} - Total CPU time the process needs to complete.
     *   priority    {number} - Lower number = higher priority (only used by
     *                          priority-based algorithms; ignored otherwise).
     *
     * These defaults give a meaningful first simulation without any user input.
     */
    let rows = [
        { name: 'P1', arrivalTime: 0,  burstTime: 6, priority: 2 },
        { name: 'P2', arrivalTime: 8,  burstTime: 4, priority: 3 },
        { name: 'P3', arrivalTime: 9,  burstTime: 3, priority: 1 },
        { name: 'P4', arrivalTime: 10, burstTime: 5, priority: 2 }
    ];

    /**
     * showPriority
     *
     * Controls whether the Priority column is visible in the table.
     * Toggled by `setPriorityVisible()`, which is called by the Scheduler
     * whenever the selected algorithm changes to one that needs priority values.
     */
    let showPriority = false;


    // -------------------------------------------------------------------------
    // DOM rendering
    // -------------------------------------------------------------------------

    /**
     * render()
     *
     * Fully rebuilds the process table body from the current `rows` array.
     * Called after any structural change (add, remove, color repaint, or
     * priority column toggle). Input-level edits don't call render() -
     * they update `rows` directly via `setField()` to avoid losing focus.
     *
     * For each row it:
     *   - Assigns a color from the palette (consistent with the Gantt chart).
     *   - Injects a color dot and row number in the first cell.
     *   - Creates editable inputs for name, arrival, burst, and priority.
     *   - Wires each input's `oninput` to both `setField` (updates `rows`) and
     *     `validateField` (highlights the border red if the value is invalid).
     *   - Disables the remove button when only 3 rows remain (minimum enforced).
     *
     * The Priority <td> always exists in the HTML but is hidden via
     * `display:none` when `showPriority` is false. A second pass at the bottom
     * of render() re-applies this to any `.col-priority` cells the browser
     * might not have picked up from the inline style.
     */
    function render() {
        const tbody = document.getElementById('proc-tbody');
        tbody.innerHTML = ''; // Wipe and rebuild from scratch.

        rows.forEach((r, i) => {
            const color = getColorPalette(i); // From cpu_scheduling_simulation.js
            const trow = document.createElement('tr');
            trow.dataset.index = i;

            // Guard: if a name was cleared (e.g., user deleted all characters),
            // fall back to the auto-generated "P{n}" label so the row is never nameless.
            if (!r.name || !r.name.trim()) {
                r.name = `P${i + 1}`;
            }

            // Build the row's inner HTML.
            // oninput fires on every keystroke:
            //   setField   - persists the new value into `rows[i]`
            //   validateField - immediately updates the input border color
            trow.innerHTML = `
                <td style="color:var(--text2);font-size:12px">
                <span class="proc-color-dot" style="background:${color.bg};border-color:${color.border}"></span>
                ${i + 1}
                </td>
                <td>
                <input type="text" value="${esc(r.name)}" maxlength="6"
                        oninput="ProcessEditor.setField(${i},'name',this.value); ProcessEditor.validateField(this,'name')"
                        style="max-width:80px">
                </td>
                <td>
                <input type="number" value="${r.arrivalTime}" min="0" max="999"
                        oninput="ProcessEditor.setField(${i},'arrival',+this.value); ProcessEditor.validateField(this,'arrival')"
                        style="max-width:75px">
                </td>
                <td>
                <input type="number" value="${r.burstTime}" min="1" max="999"
                        oninput="ProcessEditor.setField(${i},'burst',+this.value); ProcessEditor.validateField(this,'burst')"
                        style="max-width:75px">
                </td>
                <td class="col-priority" style="display:${showPriority ? '' : 'none'}">
                <input type="number" value="${r.priority ?? 1}" min="1" max="99"
                        oninput="ProcessEditor.setField(${i},'priority',+this.value); ProcessEditor.validateField(this,'priority')"
                        style="max-width:75px">
                </td>
                <td>
                <button class="btn btn-danger" onclick="ProcessEditor.removeRow(${i})"
                        title="Remove process" ${rows.length <= 3 ? 'disabled' : ''}>✕</button>
                </td>
            `;
            tbody.appendChild(trow);
        });

        // Second pass: ensure every priority cell's visibility is in sync.
        // Needed because querySelector picks up cells added in the loop above.
        document.querySelectorAll('.col-priority').forEach(e => {
            e.style.display = showPriority ? '' : 'none';
        });
    }

    /**
     * esc(s)
     *
     * Minimal HTML-attribute escaper for process names injected into
     * input value="..." attributes via innerHTML. Prevents a name containing
     * a double-quote from breaking out of the attribute string.
     *
     * Only double-quotes need escaping here because the attribute uses
     * double-quote delimiters and the value won't be parsed as full HTML.
     *
     * @param  {*}      s - Value to escape (coerced to string if needed).
     * @returns {string}
     */
    function esc(s) {
        return String(s).replace(/"/g, '&quot;');
    }


    // -------------------------------------------------------------------------
    // Row management
    // -------------------------------------------------------------------------

    /**
     * addRow()
     *
     * Appends a new process row with safe defaults and re-renders the table.
     *
     * Name generation: starts at "P{rows.length + 1}" and increments until a
     * name is found that doesn't already exist in the table. This prevents
     * duplicate names if the user has manually renamed earlier rows.
     *
     * After adding, the Scheduler's quantum field and error toast are reset
     * because the table state changed and any prior validation errors no longer
     * apply to the new configuration.
     */
    function addRow() {
        let n = rows.length + 1;
        const existingNames = new Set(rows.map(r => r.name));
        // Skip over any auto-names that are already taken.
        while (existingNames.has(`P${n}`)) n++;
        rows.push({ name: `P${n}`, arrivalTime: 0, burstTime: 1, priority: 1 });
        render();
        // Defensive checks: Scheduler may not be defined yet during initial load.
        if (typeof Scheduler !== 'undefined') {
            if (Scheduler.resetQuantumField) Scheduler.resetQuantumField();
            if (Scheduler.clearError)        Scheduler.clearError();
        }
    }

    /**
     * removeRow(index)
     *
     * Removes the row at the given index from `rows` and re-renders the table.
     * Enforces a minimum of 3 rows - the remove button is also disabled in the
     * DOM when this limit is reached, so this is a safety guard for programmatic
     * calls.
     *
     * After removing, resets the Scheduler's quantum field and error toast for
     * the same reason as `addRow()`.
     *
     * @param {number} index - Zero-based index of the row to remove.
     */
    function removeRow(index) {
        if (rows.length <= 3) return; // Minimum 3 processes enforced.
        rows.splice(index, 1);
        render();
        if (typeof Scheduler !== 'undefined') {
            if (Scheduler.resetQuantumField) Scheduler.resetQuantumField();
            if (Scheduler.clearError)        Scheduler.clearError();
        }
    }


    // -------------------------------------------------------------------------
    // Field synchronization
    // -------------------------------------------------------------------------

    /**
     * setField(index, field, value)
     *
     * Updates a single property on `rows[index]` whenever the user edits an
     * input. Called on every `oninput` event from the table cells.
     *
     * Each numeric field clamps and floors the incoming value to stay within
     * valid bounds, guarding against NaN (empty box mid-edit) without
     * triggering a validation error - the visual error is handled separately
     * by `validateField()`.
     *
     * Field mapping:
     *   'arrival'  -> rows[index].arrivalTime  (min 0, integer)
     *   'burst'    -> rows[index].burstTime    (min 1, integer)
     *   'priority' -> rows[index].priority     (min 1, integer)
     *   'name'     -> rows[index].name         (raw string, no clamping)
     *   anything else -> stored as-is (future extensibility)
     *
     * @param {number} index - Row index.
     * @param {string} field - One of 'arrival', 'burst', 'priority', 'name'.
     * @param {*}      value - New value (number or string depending on field).
     */
    function setField(index, field, value) {
        if (field === 'arrival') {
            rows[index].arrivalTime = Math.max(0, isNaN(value) ? 0 : Math.floor(value));
        } else if (field === 'burst') {
            rows[index].burstTime = Math.max(1, isNaN(value) ? 1 : Math.floor(value));
        } else if (field === 'priority') {
            rows[index].priority = Math.max(1, isNaN(value) ? 1 : Math.floor(value));
        } else if (field === 'name') {
            // Names are stored as-is (trimming happens at read-time in getProcesses).
            rows[index].name = typeof value === 'string' ? value : String(value);
        } else {
            rows[index][field] = value;
        }
    }

    /**
     * validateField(input, field)
     *
     * Provides immediate visual feedback on a single input by turning its
     * border red if the current value is invalid. Called on every keystroke
     * alongside `setField`.
     *
     * Validation rules per field:
     *   'name'     - must not be blank.
     *   'arrival'  - must be a finite whole number ≥ 0.
     *   'burst'    - must be a finite whole number ≥ 1.
     *   'priority' - must be a finite whole number ≥ 1.
     *
     * If the field becomes valid, the error toast shown by the Scheduler is
     * also cleared (in case the user fixed the issue that caused a failed run).
     *
     * Note: this only sets/clears the red border - it does NOT block the user
     * from continuing to type. The full blocking validation happens in
     * `validate()` when the Run button is pressed.
     *
     * @param {HTMLInputElement} input - The input element that just changed.
     * @param {string}           field - Field type: 'name'|'arrival'|'burst'|'priority'.
     */
    function validateField(input, field) {
        const raw = input.value.trim();
        let invalid = false;

        if (field === 'name') {
            invalid = raw === '';
        } else if (field === 'arrival') {
            const v = Number(raw);
            // Must be non-empty, a real number, a whole number, and non-negative.
            invalid = raw === '' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0;
        } else if (field === 'burst') {
            const v = Number(raw);
            // Must be non-empty, a real whole number, and at least 1.
            invalid = raw === '' || !Number.isFinite(v) || !Number.isInteger(v) || v < 1;
        } else if (field === 'priority') {
            const v = Number(raw);
            invalid = raw === '' || !Number.isFinite(v) || !Number.isInteger(v) || v < 1;
        }

        // Highlight the input border red when invalid; clear it when valid.
        input.style.borderColor = invalid ? 'var(--danger)' : '';

        // If this fix resolved the last remaining issue, dismiss the Scheduler's error toast.
        if (!invalid && typeof Scheduler !== 'undefined' && Scheduler.clearError) {
            Scheduler.clearError();
        }
    }


    // -------------------------------------------------------------------------
    // Utility / integration helpers
    // -------------------------------------------------------------------------

    /**
     * repaintColors()
     *
     * Triggers a full re-render of the table. Called by the simulation engine
     * when the OS color scheme changes (light ↔ dark) so the color dots in the
     * Name column update to match the new palette.
     *
     * A full render is used here (rather than just patching the dots) because
     * it's simpler and the table is small - the cost is negligible.
     */
    function repaintColors() {
        render();
    }

    /**
     * setPriorityVisible(value)
     *
     * Shows or hides the Priority column depending on whether the currently
     * selected algorithm uses priority values. Called by the Scheduler whenever
     * the algorithm dropdown changes.
     *
     * @param {boolean} value - true = show Priority column, false = hide it.
     */
    function setPriorityVisible(value) {
        showPriority = value;
        render(); // Re-render so the column visibility change takes effect.
    }

    /**
     * getProcesses()
     *
     * Reads the current input values directly from the DOM and returns a clean
     * array of process objects ready for the scheduling algorithms.
     *
     * Why read from the DOM instead of from `rows`?
     * Reading from the DOM ensures the returned values reflect exactly what the
     * user sees in the table at the moment Run is pressed, including any edits
     * that may not have synced to `rows` yet (e.g., rapid typing).
     *
     * Fallback behavior:
     *   - Name: empty string -> auto-name "P{i+1}".
     *   - Arrival: invalid/missing -> 0.
     *   - Burst: invalid/missing -> 1.
     *   - Priority: missing input element -> 1 (for non-priority algorithms).
     *
     * @returns {Object[]} Array of { name, arrivalTime, burstTime, priority }.
     */
    function getProcesses() {
        const tbody = document.getElementById('proc-tbody');
        const out   = [];
        tbody.querySelectorAll('tr').forEach((tr, i) => {
            const inputs = tr.querySelectorAll('input');
            // inputs[0] = name, [1] = arrival, [2] = burst, [3] = priority (may be absent)
            out.push({
                name:        inputs[0].value.trim() || `P${i + 1}`,
                arrivalTime: Math.max(0, parseInt(inputs[1].value, 10) || 0),
                burstTime:   Math.max(1, parseInt(inputs[2].value, 10) || 1),
                priority:    inputs[3] ? Math.max(1, parseInt(inputs[3].value, 10) || 1) : 1,
            });
        });
        return out;
    }

    /**
     * validate()
     *
     * Performs a full blocking validation pass over all rows before a simulation
     * run. Returns an error message string if any issue is found, or null if
     * everything is valid.
     *
     * Checked in order:
     *   1. Name not empty.
     *   2. Arrival time: present, finite, whole number, ≥ 0.
     *   3. Burst time: present, finite, whole number, ≥ 1.
     *   4. Priority (only when the column is visible): present, finite,
     *      whole number, ≥ 1. The visibility check uses the cell's inline
     *      display style so hidden-column values are never validated.
     *   5. After all rows pass: duplicate name check across the full process list.
     *
     * Why check the DOM's display style for priority?
     * The priority <td> always exists in the DOM. When a non-priority algorithm
     * is selected the cell is hidden (`display:none`). Checking the style
     * prevents false validation errors when the user has entered values in the
     * priority column but then switched to a non-priority algorithm.
     *
     * @returns {string|null} Error message, or null if all inputs are valid.
     */
    function validate() {
        const tbody = document.getElementById('proc-tbody');
        const trows = tbody.querySelectorAll('tr');

        for (let i = 0; i < trows.length; i++) {
            const inputs = trows[i].querySelectorAll('input');

            const name         = inputs[0]?.value.trim();
            const arrivalRaw   = inputs[1]?.value.trim();
            const burstRaw     = inputs[2]?.value.trim();
            const priorityRaw  = inputs[3]?.value.trim();

            // --- Name ---
            if (!name) return `Row ${i + 1}: Process name cannot be empty.`;

            // --- Arrival time ---
            if (arrivalRaw === '' || arrivalRaw === undefined)
                return `Row ${i + 1}: Arrival time cannot be empty.`;
            const arrival = Number(arrivalRaw);
            if (!Number.isFinite(arrival) || !Number.isInteger(arrival))
                return `Row ${i + 1}: Arrival time must be a whole number.`;
            if (arrival < 0)
                return `Row ${i + 1}: Arrival time cannot be negative.`;

            // --- Burst time ---
            if (burstRaw === '' || burstRaw === undefined)
                return `Row ${i + 1}: Burst time cannot be empty.`;
            const burst = Number(burstRaw);
            if (!Number.isFinite(burst) || !Number.isInteger(burst))
                return `Row ${i + 1}: Burst time must be a whole number.`;
            if (burst < 1)
                return `Row ${i + 1}: Burst time must be at least 1.`;

            // --- Priority (only when the column is actually visible) ---
            if (inputs[3] && inputs[3].closest('td')?.style.display !== 'none') {
                if (priorityRaw === '' || priorityRaw === undefined)
                    return `Row ${i + 1}: Priority cannot be empty.`;
                const priority = Number(priorityRaw);
                if (!Number.isFinite(priority) || !Number.isInteger(priority))
                    return `Row ${i + 1}: Priority must be a whole number.`;
                if (priority < 1)
                    return `Row ${i + 1}: Priority must be at least 1.`;
            }
        }

        // --- Duplicate name check (cross-row) ---
        // Done after the per-field loop so individual field errors surface first.
        const processes = getProcesses();
        const names = processes.map(p => p.name);
        const seen = new Set();
        for (let i = 0; i < names.length; i++) {
            if (seen.has(names[i])) return `Row ${i + 1}: Name "${names[i]}" is already used.`;
            seen.add(names[i]);
        }

        return null; // All validations passed.
    }


    // -------------------------------------------------------------------------
    // Initialization & public API
    // -------------------------------------------------------------------------

    // Build the initial table as soon as the IIFE executes (page load).
    render();

    /**
     * Public API returned to the `ProcessEditor` variable.
     * Only these methods are accessible outside this module.
     *
     *   addRow()                 - Append a new process row.
     *   removeRow(index)         - Remove a row by index.
     *   setField(i, field, val)  - Update one field in `rows` (called by oninput).
     *   validateField(input, f)  - Live per-input border feedback (called by oninput).
     *   setPriorityVisible(bool) - Show/hide the Priority column.
     *   getProcesses()           - Return final process array for the Scheduler.
     *   validate()               - Full blocking validation; returns error or null.
     *   repaintColors()          - Re-render the table after a color-scheme change.
     */
    return { addRow, removeRow, setField, validateField, setPriorityVisible, getProcesses, validate, repaintColors };
})();

// Wire ProcessEditor into the Scheduler so it can call getProcesses() and
// validate() when the Run button is pressed. This must come after both modules
// are defined (cpu_scheduling_simulation.js loads before this file).
Scheduler.init(ProcessEditor);
