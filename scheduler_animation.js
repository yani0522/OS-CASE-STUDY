/**
 * Universal CPU Scheduling Animation System
 * ─────────────────────────────────────────────────────────────────────────────
 * Works with all 7 algorithms defined in scheduling_algorithms.js.
 * Load scheduling_algorithms.js FIRST, then this file.
 *
 * ─── Required HTML ───────────────────────────────────────────────────────────
 *
 *  <!-- Algorithm selector -->
 *  <select id="algo-select" onchange="Scheduler.onAlgoChange()">
 *    <option value="fcfs">FCFS</option>
 *    <option value="sjf">SJF (non-preemptive)</option>
 *    <option value="srtf">SRTF (preemptive SJF)</option>
 *    <option value="rr">Round Robin</option>
 *    <option value="priority_np">Priority (non-preemptive)</option>
 *    <option value="priority_p">Priority (preemptive)</option>
 *    <option value="priority_rr">Priority Round Robin</option>
 *  </select>
 *
 *  <!-- Quantum (shown only for RR and Priority RR) -->
 *  <div id="quantum-wrap" style="display:none">
 *    Quantum: <input id="rr-quantum" type="number" value="2" min="1" max="20">
 *  </div>
 *
 *  <!-- CPU display -->
 *  <div id="cpu-box">Idle</div>
 *  <span id="cpu-proc">—</span>
 *  <span id="cpu-rem">—</span>
 *
 *  <!-- Ready queue -->
 *  <div id="queue-area"></div>
 *
 *  <!-- Gantt chart -->
 *  <div id="gantt"></div>
 *  <div id="gantt-ticks"></div>
 *
 *  <!-- Controls -->
 *  <button onclick="Scheduler.run()">Run</button>
 *  <button id="btn-pause" onclick="Scheduler.togglePause()" disabled>Pause</button>
 *  <button id="btn-step"  onclick="Scheduler.step()"        disabled>Step</button>
 *  <button onclick="Scheduler.reset()">Reset</button>
 *  <input  id="speed-slider" type="range" min="1" max="10" value="5"
 *          oninput="Scheduler.setSpeed(this.value)">
 *  <span id="time-display">Time: 0</span>
 *
 *  <!-- Results (hidden until sim ends) -->
 *  <div id="stats-area" style="display:none"></div>
 */


// ═══════════════════════════════════════════════════════════════════════════════
// COLOUR PALETTE  (light + dark variants, 7 colours)
// ═══════════════════════════════════════════════════════════════════════════════

const PALETTE_LIGHT = [
  { bg: '#E6F1FB', border: '#378ADD', text: '#0C447C' },
  { bg: '#E1F5EE', border: '#1D9E75', text: '#085041' },
  { bg: '#FAEEDA', border: '#BA7517', text: '#633806' },
  { bg: '#FBEAF0', border: '#D4537E', text: '#72243E' },
  { bg: '#EEEDFE', border: '#7F77DD', text: '#3C3489' },
  { bg: '#FAECE7', border: '#D85A30', text: '#712B13' },
  { bg: '#EAF3DE', border: '#639922', text: '#27500A' },
];

const PALETTE_DARK = [
  { bg: '#0C447C', border: '#378ADD', text: '#B5D4F4' },
  { bg: '#085041', border: '#1D9E75', text: '#9FE1CB' },
  { bg: '#633806', border: '#BA7517', text: '#FAC775' },
  { bg: '#72243E', border: '#D4537E', text: '#F4C0D1' },
  { bg: '#3C3489', border: '#7F77DD', text: '#CECBF6' },
  { bg: '#712B13', border: '#D85A30', text: '#F5C4B3' },
  { bg: '#27500A', border: '#639922', text: '#C0DD97' },
];

function getColor(processIndex) {
  const dark    = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;
  return palette[processIndex % palette.length];
}


// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

const Scheduler = (() => {

  // ── Internal state ─────────────────────────────────────────────────────────
  let processes   = [];
  let frames      = [];
  let ganttBlocks = [];
  let frameIndex  = 0;
  let timer       = null;
  let isRunning   = false;
  let isPaused    = false;
  let speedMs     = 200;

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function getEl(id)       { return document.getElementById(id); }
  function hide(id)        { const e = getEl(id); if (e) e.style.display = 'none'; }
  function setText(id, v)  { const e = getEl(id); if (e) e.textContent = v; }

  function setButtonStates(running) {
    getEl('btn-pause').disabled    = !running;
    getEl('btn-step').disabled     = !running;
    getEl('btn-pause').textContent = isPaused ? 'Resume' : 'Pause';
  }

  // ── Read algorithm selection from DOM ──────────────────────────────────────

  function getSelectedAlgo() {
    const key  = getEl('algo-select')?.value || 'fcfs';
    const algo = ALGORITHMS[key];
    if (!algo) throw new Error(`Unknown algorithm: "${key}"`);
    return { key, algo };
  }

  function getAlgoOptions() {
    return {
      quantum: parseInt(getEl('rr-quantum')?.value, 10) || 2,
    };
  }

  // ── PUBLIC: called by the algo <select> onchange ───────────────────────────

  function onAlgoChange() {
    const key  = getEl('algo-select')?.value || 'fcfs';
    const algo = ALGORITHMS[key];
    if (!algo) return;

    // Show quantum input only for algorithms that need it
    const qWrap = getEl('quantum-wrap');
    if (qWrap) qWrap.style.display = algo.needsQuantum ? 'flex' : 'none';

    // Show/hide priority column in the process table
    const priCols = document.querySelectorAll('.col-priority');
    priCols.forEach(el => {
      el.style.display = algo.needsPriority ? '' : 'none';
    });

    reset();
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────────

  function init(procs) {
    processes = procs;
    onAlgoChange();
    reset();
  }

  function run() {
    if (isRunning) return;
    reset();

    const { algo } = getSelectedAlgo();
    const options  = getAlgoOptions();

    // ── Only this line changes between algorithms ──
    frames = algo.run(processes, options);
    // ───────────────────────────────────────────────

    if (!frames.length) return;

    ganttBlocks = computeGantt(frames);
    buildGanttSkeleton();

    isRunning = true;
    isPaused  = false;
    setButtonStates(true);
    hide('stats-area');

    scheduleNext();
  }

  function togglePause() {
    if (!isRunning) return;
    isPaused = !isPaused;
    getEl('btn-pause').textContent = isPaused ? 'Resume' : 'Pause';
    if (!isPaused) scheduleNext();
  }

  function step() {
    if (!isRunning) return;
    isPaused = true;
    getEl('btn-pause').textContent = 'Resume';
    clearTimeout(timer);
    applyFrame(frameIndex);
    frameIndex++;
    if (frameIndex > frames.length) finish();
  }

  function reset() {
    clearTimeout(timer);
    isRunning   = false;
    isPaused    = false;
    frameIndex  = 0;
    frames      = [];
    ganttBlocks = [];

    setButtonStates(false);
    setText('time-display', 'Time: 0');
    getEl('gantt').innerHTML       = '';
    getEl('gantt-ticks').innerHTML = '';
    hide('stats-area');
    resetCPU();
    resetQueue();
  }

  function setSpeed(level) {
    speedMs = Math.round(600 / level);
  }

  // ── Core tick loop ─────────────────────────────────────────────────────────

  function scheduleNext() {
    if (!isRunning || isPaused) return;
    applyFrame(frameIndex);
    frameIndex++;
    if (frameIndex <= frames.length) {
      timer = setTimeout(scheduleNext, speedMs);
    } else {
      finish();
    }
  }

  // ── Frame renderer ─────────────────────────────────────────────────────────

  function applyFrame(fi) {
    if (fi >= frames.length) { finish(); return; }
    const f     = frames[fi];
    const total = frames.length;

    setText('time-display', 'Time: ' + f.time);
    renderCPU(f);
    renderQueue(f.queue);
    renderGantt(f.time + 1, total);
    renderTicks(f.time, total);
  }

  // ── CPU zone ───────────────────────────────────────────────────────────────

  function renderCPU(frame) {
    const box      = getEl('cpu-box');
    const procSpan = getEl('cpu-proc');
    const remSpan  = getEl('cpu-rem');

    if (frame.proc === 'idle') {
      box.style.background  = '';
      box.style.borderColor = '';
      box.style.color       = '';
      box.classList.add('idle');
      box.textContent       = 'Idle';
      procSpan.textContent  = '—';
      remSpan.textContent   = '—';
    } else {
      const idx = processes.findIndex(p => p.name === frame.proc);
      const c   = getColor(idx);

      box.style.background  = c.bg;
      box.style.borderColor = c.border;
      box.style.color       = c.text;
      box.classList.remove('idle');
      box.textContent       = frame.proc;
      procSpan.textContent  = frame.proc;
      remSpan.textContent   = frame.rem + ' units';
    }
  }

  function resetCPU() {
    const box = getEl('cpu-box');
    box.style.background  = '';
    box.style.borderColor = '';
    box.style.color       = '';
    box.classList.add('idle');
    box.textContent = 'Idle';
    setText('cpu-proc', '—');
    setText('cpu-rem',  '—');
  }

  // ── Ready Queue zone ───────────────────────────────────────────────────────

  function renderQueue(queueSnapshot) {
    const area = getEl('queue-area');
    area.innerHTML = '';

    if (!queueSnapshot || !queueSnapshot.length) {
      area.innerHTML = '<span class="queue-empty">Empty</span>';
      return;
    }

    const { key }      = getSelectedAlgo();
    const showPriority = ALGORITHMS[key].needsPriority;

    queueSnapshot.forEach(qp => {
      const idx  = processes.findIndex(p => p.name === qp.name);
      const c    = getColor(idx);
      const chip = document.createElement('div');

      chip.className = 'q-chip entering';
      chip.style.cssText = `background:${c.bg};border-color:${c.border};color:${c.text}`;

      const badge = showPriority && qp.priority != null
        ? `<div class="chip-priority">P${qp.priority}</div>`
        : '';

      chip.innerHTML = `
        <div class="chip-name">${qp.name}</div>
        <div class="chip-rem">${qp.rem}u</div>
        ${badge}
      `;

      area.appendChild(chip);

      // Double rAF triggers the CSS slide-in transition
      requestAnimationFrame(() =>
        requestAnimationFrame(() => chip.classList.remove('entering'))
      );
    });
  }

  function resetQueue() {
    getEl('queue-area').innerHTML = '<span class="queue-empty">Empty</span>';
  }

  // ── Gantt Chart zone ───────────────────────────────────────────────────────

  function buildGanttSkeleton() {
    const ganttEl = getEl('gantt');
    ganttEl.innerHTML = '';
    const total = frames.length || 1;

    ganttBlocks.forEach(b => {
      const idx    = processes.findIndex(p => p.name === b.name);
      const c      = idx >= 0 ? getColor(idx) : null;
      const maxPct = ((b.end - b.start) / total * 100).toFixed(2) + '%';

      const bar = document.createElement('div');
      bar.className = 'g-block' + (b.name === 'idle' ? ' idle' : '');
      // Unique ID: start + end handles preemptive algorithms where the
      // same process can appear multiple times at different intervals.
      bar.id        = 'gb-' + b.start + '-' + b.end;
      bar.style.cssText = [
        'width:0',
        'max-width:' + maxPct,
        c ? `background:${c.bg}`       : '',
        c ? `border-color:${c.border}` : '',
        c ? `color:${c.text}`          : '',
      ].filter(Boolean).join(';');

      bar.textContent = b.name === 'idle' ? '—' : b.name;
      ganttEl.appendChild(bar);
    });
  }

  function renderGantt(t, total) {
    ganttBlocks.forEach(b => {
      const bar = getEl('gb-' + b.start + '-' + b.end);
      if (!bar) return;

      if (b.end <= t) {
        bar.style.width = ((b.end - b.start) / total * 100).toFixed(2) + '%';
      } else if (b.start < t) {
        bar.style.width = ((t - b.start) / total * 100).toFixed(2) + '%';
      }
    });
  }

  // ── Tick labels ────────────────────────────────────────────────────────────

  function renderTicks(currentTime, total) {
    const tickEl = getEl('gantt-ticks');
    tickEl.innerHTML = '';

    // Deduplicate tick positions so overlapping blocks don't create double labels
    const seen = new Set();

    ganttBlocks.forEach(b => {
      if (b.start > currentTime || seen.has(b.start)) return;
      seen.add(b.start);
      appendTick(tickEl, b.start, total);
    });

    if (currentTime + 1 >= total && !seen.has(total)) {
      appendTick(tickEl, total, total);
    }
  }

  function appendTick(container, time, total) {
    const span = document.createElement('span');
    span.className   = 'tick';
    span.style.left  = (time / total * 100).toFixed(2) + '%';
    span.textContent = time;
    container.appendChild(span);
  }

  // ── Finish + Results ───────────────────────────────────────────────────────

  function finish() {
    clearTimeout(timer);
    isRunning = false;
    isPaused  = false;
    setButtonStates(false);
    renderStats();
  }

  function renderStats() {
    const stats    = computeStats(processes, frames);
    const averages = computeAverages(stats);
    const area     = getEl('stats-area');
    const { key }  = getSelectedAlgo();

    area.innerHTML = '';
    area.style.display       = 'flex';
    area.style.flexDirection = 'column';
    area.style.gap           = '12px';

    // Algorithm label
    const algoLabel = document.createElement('div');
    algoLabel.className = 'stat-algo-label';
    algoLabel.textContent = 'Results — ' + ALGORITHMS[key].label;
    area.appendChild(algoLabel);

    // Average cards
    const summaryRow = document.createElement('div');
    summaryRow.className = 'stat-summary-row';
    [
      ['Avg turnaround time', averages.avgTurnaround + ' units'],
      ['Avg waiting time',    averages.avgWaiting    + ' units'],
    ].forEach(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `<div class="stat-label">${label}</div>
                        <div class="stat-value">${value}</div>`;
      summaryRow.appendChild(card);
    });
    area.appendChild(summaryRow);

    // Per-process table
    const showPriority = ALGORITHMS[key].needsPriority;
    const table = document.createElement('table');
    table.className = 'stat-table';

    const headers = ['Process', 'Arrival', 'Burst', ...(showPriority ? ['Priority'] : []), 'Finish', 'TAT', 'WT'];
    table.innerHTML = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody></tbody>`;

    const tbody = table.querySelector('tbody');
    stats.forEach(s => {
      const idx = processes.findIndex(p => p.name === s.name);
      const c   = getColor(idx);
      const tr  = document.createElement('tr');

      const cells = [
        `<td><span class="proc-badge" style="background:${c.bg};border-color:${c.border};color:${c.text}">${s.name}</span></td>`,
        `<td>${s.arrival}</td>`,
        `<td>${s.burst}</td>`,
        ...(showPriority ? [`<td>${s.priority}</td>`] : []),
        `<td>${s.finishTime}</td>`,
        `<td>${s.turnaroundTime}</td>`,
        `<td>${s.waitingTime}</td>`,
      ];

      tr.innerHTML = cells.join('');
      tbody.appendChild(tr);
    });

    area.appendChild(table);
  }

  // ── Public interface ───────────────────────────────────────────────────────
  return { init, run, togglePause, step, reset, setSpeed, onAlgoChange };

})();


// ═══════════════════════════════════════════════════════════════════════════════
// SUGGESTED CSS
// ═══════════════════════════════════════════════════════════════════════════════
/*
  --- Queue chips ---
  .q-chip {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    min-width: 52px; padding: 4px 8px;
    border-radius: 8px; border: 0.5px solid;
    font-size: 12px; font-weight: 500;
    transition: transform 0.3s ease, opacity 0.3s ease;
    gap: 2px;
  }
  .q-chip.entering { transform: translateX(40px); opacity: 0; }
  .chip-name     { font-size: 12px; font-weight: 500; }
  .chip-rem      { font-size: 10px; opacity: 0.7; }
  .chip-priority { font-size: 10px; opacity: 0.8; }

  --- Gantt bars ---
  .g-block {
    display: flex; align-items: center; justify-content: center;
    min-height: 48px; font-size: 12px; font-weight: 500;
    border-right: 2px solid var(--color-background-primary);
    overflow: hidden; white-space: nowrap;
    transition: width 0.15s linear;
  }
  .g-block.idle { opacity: 0.4; }

  --- Ticks ---
  #gantt-ticks { position: relative; height: 18px; margin-top: 2px; font-size: 11px; }
  .tick        { position: absolute; transform: translateX(-50%); }

  --- CPU ---
  #cpu-box {
    width: 72px; height: 52px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 8px; border: 1.5px solid;
    font-size: 13px; font-weight: 500;
    transition: background 0.2s, border-color 0.2s, color 0.2s;
  }
  #cpu-box.idle { background: var(--color-background-secondary) !important; }

  --- Results ---
  .stat-algo-label  { font-size: 13px; font-weight: 500; color: var(--color-text-secondary); }
  .stat-summary-row { display: flex; flex-wrap: wrap; gap: 10px; }
  .stat-card        { background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary); border-radius: 8px; padding: 8px 14px; }
  .stat-label       { font-size: 12px; color: var(--color-text-secondary); }
  .stat-value       { font-size: 18px; font-weight: 500; margin-top: 2px; }
  .stat-table       { width: 100%; border-collapse: collapse; font-size: 13px; }
  .stat-table th    { text-align: left; color: var(--color-text-secondary); font-weight: 400; padding: 4px 10px 8px; }
  .stat-table td    { padding: 6px 10px; border-top: 0.5px solid var(--color-border-tertiary); }
  .proc-badge       { display: inline-block; padding: 2px 8px; border-radius: 5px; border: 0.5px solid; font-size: 12px; font-weight: 500; }
*/


// ═══════════════════════════════════════════════════════════════════════════════
// WIRING EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════════
/*
  const myProcesses = [
    { name: 'P1', arrival: 0, burst: 6, priority: 2 },
    { name: 'P2', arrival: 1, burst: 4, priority: 1 },
    { name: 'P3', arrival: 2, burst: 3, priority: 3 },
    { name: 'P4', arrival: 4, burst: 5, priority: 2 },
  ];

  window.addEventListener('DOMContentLoaded', () => {
    Scheduler.init(myProcesses);
  });
*/
