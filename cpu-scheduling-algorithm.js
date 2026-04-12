const defaultInputFields = [{
    arrivalTime: '',
    burstTime: '',
    priority: ''
}, {
    arrivalTime: '',
    burstTime: '',
    priority: ''
}, {
    arrivalTime: '',
    burstTime: '',
    priority: ''
}];

const inputFields = JSON.parse(localStorage.getItem('inputFields')) || defaultInputFields;

loadQuantum();
renderInputFields();

// This function renders the input fields for each process based on the current state of the inputFields array.
function renderInputFields() {
    let inputFieldsHTML = '';

    for (let i = 0; i < inputFields.length; i++) {
        const inputObject = inputFields[i];

        const arrivalTime = inputObject.arrivalTime;
        const burstTime = inputObject.burstTime;
        const priority = inputObject.priority;

        const html = `
            <tr>
                <td>P${i + 1}</td>
                <td><input type="number" class="arrival-time" placeholder="0" value="${arrivalTime}" oninput="
                    updateInputFields(${i}, 'arrivalTime', this.value);
                "></td>
                <td><input type="number" class="burst-time" placeholder="0" value="${burstTime}" oninput="
                    updateInputFields(${i}, 'burstTime', this.value);
                "></td>
                <td class="priority-cell"><input type="number" class="priority" placeholder="0" value="${priority}" oninput="
                    updateInputFields(${i}, 'priority', this.value);
                "></td>
                <td><button id="remove-process" onclick="
                    removeProcess(${i});
                ">Remove</button></td>
            </tr>
        `;

        inputFieldsHTML += html;
    }

    document.getElementById('input-fields-js').innerHTML = inputFieldsHTML;

    selectSchedulingAlgorithm();
}

// This function adds a new process to the inputFields array and updates the display accordingly.
function addProcess() {
    inputFields.push({
        arrivalTime: '',
        burstTime: '',
        priority: ''
    });

    renderInputFields();
    saveInputFields();
    clearOutput();
}

// This function removes a process from the inputFields array based on the given index and updates the display accordingly.
function removeProcess(index) {
    if (inputFields.length == 3) {
        alert("At least three processes are required.");
        return;
    }
    
    inputFields.splice(index, 1);

    renderInputFields();
    saveInputFields();
    clearOutput();
}

// This function resets all input fields to their default empty state and updates the display accordingly.
function resetValues() {
    for (let i = 0; i < inputFields.length; i++) {
        inputFields[i].arrivalTime = '';
        inputFields[i].burstTime = '';
        inputFields[i].priority = '';
    }

    document.getElementById('quantum-input').value = '';

    renderInputFields();
    saveInputFields();
    saveQuantum();
    clearOutput();
}

// This function saves the current state of the inputFields array to localStorage whenever it is updated.
function saveInputFields() {
    localStorage.setItem('inputFields', JSON.stringify(inputFields));
}

// This function updates the inputFields array whenever the user changes any of the input values.
function updateInputFields(index, field, value) {
    inputFields[index][field] = value === '' ? '' : Number(value);

    saveInputFields();
    clearOutput();
}

// This function saves the current value of the time quantum input field to localStorage whenever it is updated.
function saveQuantum() {
    const quantum = document.getElementById('quantum-input').value;
    localStorage.setItem('quantum', quantum);
}

// This function loads the saved value of the time quantum input field from localStorage when the page is loaded.
function loadQuantum() {
    const saved = localStorage.getItem('quantum');
    if (saved !== null) {
        document.getElementById('quantum-input').value = saved;
    }
}

// This function allows default values to be used if the user leaves any fields blank.
function normalizeInput() {
    const normalizedInput = [];

    for (let i = 0; i < inputFields.length; i++) {
        const p = inputFields[i];

        normalizedInput.push({
            processID: `P${i + 1}`,
            arrivalTime: p.arrivalTime === '' ? 0 : (p.arrivalTime),
            burstTime: p.burstTime === '' ? null : (p.burstTime),
            priority: p.priority === '' ? 0 : (p.priority)
        });
    }
    return normalizedInput;
}

// This function checks if the normalized input values are valid before running the scheduling algorithm.
function validateNormalizedInput(processes) {
    for (let p of processes) {

        // Check if Arrival Time >= 0.
        if (p.arrivalTime < 0) {
            alert(`Process ${p.processID}: Arrival Time cannot be negative.`);
            return false;
        }

        // Check if Burst Time > 0.
        if (p.burstTime <= 0) {
            alert(`Process ${p.processID}: Burst Time must be greater than 0.`);
            return false;
        }

        // Check if Priority >= 0.
        if (p.priority < 0) {
            alert(`Process ${p.processID}: Priority cannot be negative.`);
            return false;
        }
    }

    return true;
}


// This function is called when the user selects a different scheduling algorithm from the dropdown menu.
function selectSchedulingAlgorithm() {
    const selectedAlgorithm = document.getElementById('algorithm').value;
    const tbody = document.getElementById('input-fields-js');
    const quantumContainer = document.getElementById('time-quantum-container');
    const rows = tbody.querySelectorAll('tr');

    // Toggle priority input fields based on the selected algorithm
    rows.forEach(row => {
        const priorityInputField = row.querySelector('.priority-cell');
        const priorityHeader = document.getElementById('priority-header');
        if (selectedAlgorithm.includes('ps')) {
            priorityInputField.style.display = 'table-cell';      // enable for priority algorithms
            priorityHeader.style.display = 'table-cell';     // show the priority label

        } else {
            priorityInputField.style.display = 'none';       // disable for non-priority algorithms
            priorityHeader.style.display = 'none';      // hide the priority label
        }
    });

    // Toggle time quantum input field visibility for Round Robin algorithms
    if (selectedAlgorithm.includes('rr')) {
        quantumContainer.style.display = 'block'; // show for Round Robin algorithms
    } else {
        quantumContainer.style.display = 'none'; // hide for non-Round Robin algorithms
    }

    clearOutput();
}

// This function runs the selected scheduling algorithm using the normalized input values and displays the results in a tabular summary and Gantt chart.
function runSchedulingAlgorithm() {
    const processes = normalizeInput();
    const selectedAlgorithm = document.getElementById('algorithm').value;
    const quantumInput = document.getElementById('quantum-input');

    if (!validateNormalizedInput(processes)) return;

    let quantum = null;

    // If the selected algorithm is a Round Robin variant, validate the time quantum input and store it in the "quantum" variable.
    if (selectedAlgorithm.includes('rr')) {
        quantum = Number(quantumInput.value);

        if (!quantum || quantum <= 0) {
            alert('Time quantum must be a positive number.');
            return;
        }
    }

    let output;

    // Run the appropriate scheduling algorithm based on the user's selection and store the results in the "output" variable.
    switch (selectedAlgorithm) {
        case 'fcfs':
            output = fcfsScheduling(processes);
            break;

        case 'sjf':
            output = sjfScheduling(processes);
            break;

        case 'srtf':
            output = srtfScheduling(processes);
            break;

        case 'rr':
            output = roundRobinScheduling(processes, quantum);
            break;
        case 'psnp':
            output = prioritySchedulingNP(processes);
            break;

        case 'psp':
            output = prioritySchedulingP(processes);
            break;

        case 'psrr':
            output = priorityRoundRobin(processes, quantum);
            break;
    }

    clearOutput();

    console.log(processes); // For troubleshooting, log the normalized input processes to the console.

    displayTabularSummary(output.result, selectedAlgorithm);
    displayGanttChart(output.gantt, selectedAlgorithm);
}

// This function removes any previously displayed output (tabular summary and Gantt chart) from the page before displaying new results.
function clearOutput() {
    const oldTables = document.querySelectorAll('.output');
    oldTables.forEach(el => el.remove());
}


function fcfsScheduling(processes) {
    // Sort processes by arrival time, then by process ID for tie-breaking
    processes.sort((a, b) =>
        a.arrivalTime - b.arrivalTime || a.processID.localeCompare(b.processID)
    );

    let currentTime = 0;
    const result = [];
    const gantt = [];

    // Iterate through the sorted processes and calculate start time, completion time, turnaround time, and waiting time for each process.
    for (let p of processes) {
        const startTime = Math.max(currentTime, p.arrivalTime);
        
        // Add the process execution to the Gantt chart with its start time and end time.
        gantt.push({
            processID: p.processID,
            startTime,
            endTime: startTime + p.burstTime
        });

        const completionTime = startTime + p.burstTime;

        // Store the results for each process for the Tabular Summary.
        result.push({
            ...p,
            startTime,
            completionTime,
            turnaroundTime: completionTime - p.arrivalTime,
            waitingTime: completionTime - p.arrivalTime - p.burstTime
        });

        currentTime = completionTime;
    }

    return { result, gantt };
}


function sjfScheduling(processes) {
    const n = processes.length;
    const isDone = new Array(n).fill(false);

    let currentTime = 0, completed = 0;
    const result = [], gantt = [];

    // Loop until all processes are completed, at each step selecting the process with the shortest burst time that has arrived and is not yet completed.
    while (completed < n) {
        let idx = -1;

        for (let i = 0; i < n; i++) {
            if (
                !isDone[i] &&
                processes[i].arrivalTime <= currentTime &&
                (
                    idx === -1 ||
                    processes[i].burstTime < processes[idx].burstTime ||
                    (
                        processes[i].burstTime === processes[idx].burstTime &&
                        processes[i].arrivalTime < processes[idx].arrivalTime
                    )
                )
            ) {
                idx = i;
            }
        }

        // If no process is ready to execute, increment the current time and continue to the next iteration.
        if (idx === -1) {
            currentTime++;
            continue;
        }

        const p = processes[idx];
        const startTime = currentTime;

        // Add the process execution to the Gantt chart with its start time and end time.
        gantt.push({
            processID: p.processID,
            startTime,
            endTime: startTime + p.burstTime
        });

        const completionTime = startTime + p.burstTime;

        // Store the results for each process for the Tabular Summary.
        result.push({
            ...p,
            startTime,
            completionTime,
            turnaroundTime: completionTime - p.arrivalTime,
            waitingTime: completionTime - p.arrivalTime - p.burstTime
        });

        currentTime = completionTime;
        isDone[idx] = true;
        completed++;
    }

    return { result, gantt };
}


function srtfScheduling(processes) {
    const n = processes.length;
    // Remaining burst times and first start tracking
    let remaining = processes.map(p => p.burstTime);
    let firstStart = new Array(n).fill(null);

    let currentTime = 0, completed = 0;
    const result = [], gantt = [];
    let last = -1;

    // Loop until all processes are completed, at each step selecting the process with the shortest remaining burst time that has arrived and is not yet completed. This allows for preemption if a new process arrives with a shorter burst time.
    while (completed < n) {
        let idx = -1;

        for (let i = 0; i < n; i++) {
            if (
                processes[i].arrivalTime <= currentTime &&
                remaining[i] > 0 &&
                (idx === -1 || remaining[i] < remaining[idx])
            ) {
                idx = i;
            }
        }

        // If no process is ready to execute, increment the current time and continue to the next iteration.
        if (idx === -1) {
            currentTime++;
            continue;
        }

        // Track the first start time for each process to calculate waiting time and turnaround time later.
        if (firstStart[idx] === null) firstStart[idx] = currentTime;

        // Add the process execution to the Gantt chart if we are switching to a different process than the last one executed.
        if (last !== idx) {
            gantt.push({ processID: processes[idx].processID, startTime: currentTime });
            last = idx;
        }

        remaining[idx]--;
        currentTime++;

        // If the process has completed, update the results and increment the completed count.
        if (remaining[idx] === 0) {
            completed++;
            const ct = currentTime;

            // Store the results for each process for the Tabular Summary.
            result.push({
                ...processes[idx],
                startTime: firstStart[idx],
                completionTime: ct,
                turnaroundTime: ct - processes[idx].arrivalTime,
                waitingTime: ct - processes[idx].arrivalTime - processes[idx].burstTime
            });
        }
    }

    // Finalize Gantt end times based on the start time of the next process or the final current time if it's the last process.
    gantt.forEach((g, i) => {
        g.endTime = (gantt[i + 1]?.startTime ?? currentTime);
    });

    return { result, gantt };
}


function roundRobinScheduling(processes, quantum) {
    const n = processes.length;
    // Sort processes by arrival time to ensure they are added to the queue in the correct order.
    processes.sort((a, b) => a.arrivalTime - b.arrivalTime);

    // Remaining burst times and first start tracking
    let remaining = processes.map(p => p.burstTime);
    let firstStart = new Array(n).fill(null);
    let visited = new Array(n).fill(false);

    let currentTime = 0;
    let queue = [], result = [], gantt = [];
    let lastProcess = -1; // tracks last executing process for merging

    // Start with the first process (earliest arrival)
    queue.push(0);
    visited[0] = true;

    // Loop until all processes are completed, at each step executing the process at the front of the queue for a time slice equal to the quantum or the remaining burst time, whichever is smaller.
    while (queue.length > 0) {
        const idx = queue.shift();
        const p = processes[idx];

        // Track the first start time for each process to calculate waiting time and turnaround time later.
        if (firstStart[idx] === null) firstStart[idx] = currentTime;

        // Only push to Gantt if switching process
        if (lastProcess !== idx) {
            gantt.push({ processID: p.processID, startTime: currentTime });
            lastProcess = idx;
        }

        // Execute process for quantum or remaining time
        const exec = Math.min(quantum, remaining[idx]);
        remaining[idx] -= exec;
        currentTime += exec;

        // Add new arrivals during execution
        for (let i = 0; i < n; i++) {
            if (!visited[i] && processes[i].arrivalTime <= currentTime) {
                queue.push(i);
                visited[i] = true;
            }
        }

        // If process not finished, re-add to queue
        if (remaining[idx] > 0) {
            queue.push(idx);
        } else {
            const ct = currentTime;
            result.push({
                ...p,
                startTime: firstStart[idx],
                completionTime: ct,
                turnaroundTime: ct - p.arrivalTime,
                waitingTime: ct - p.arrivalTime - p.burstTime
            });
        }

        // If queue empty but there are unvisited arrivals, fast-forward
        if (queue.length === 0) {
            for (let i = 0; i < n; i++) {
                if (!visited[i]) {
                    queue.push(i);
                    visited[i] = true;
                    currentTime = Math.max(currentTime, processes[i].arrivalTime);
                    break;
                }
            }
        }
    }

    // Finalize Gantt end times
    gantt.forEach((g, i) => {
        g.endTime = gantt[i + 1]?.startTime ?? currentTime;
    });

    return { result, gantt };
}


function prioritySchedulingNP(processes) {
    // Sort processes by arrival time, then by priority, then by process ID for tie-breaking
    const n = processes.length;
    const isDone = new Array(n).fill(false);

    let currentTime = 0, completed = 0;
    const result = [], gantt = [];

    // Loop until all processes are completed, at each step selecting the process with the highest priority (lowest priority number) that has arrived and is not yet completed. This is a non-preemptive algorithm, so once a process starts executing, it runs to completion before the next process is selected.
    while (completed < n) {
        let idx = -1;

        for (let i = 0; i < n; i++) {
            if (
                !isDone[i] &&
                processes[i].arrivalTime <= currentTime &&
                (
                    idx === -1 ||
                    processes[i].priority < processes[idx].priority ||
                    (
                        processes[i].priority === processes[idx].priority &&
                        processes[i].arrivalTime < processes[idx].arrivalTime
                    )
                )
            ) {
                idx = i;
            }
        }

        // If no process is ready to execute, increment the current time and continue to the next iteration.
        if (idx === -1) {
            currentTime++;
            continue;
        }

        const p = processes[idx];
        const startTime = currentTime;

        // Add the process execution to the Gantt chart with its start time and end time.
        gantt.push({
            processID: p.processID,
            startTime,
            endTime: startTime + p.burstTime
        });

        const ct = startTime + p.burstTime;

        // Store the results for each process for the Tabular Summary.
        result.push({
            ...p,
            priority: p.priority,
            startTime,
            completionTime: ct,
            turnaroundTime: ct - p.arrivalTime,
            waitingTime: ct - p.arrivalTime - p.burstTime
        });

        currentTime = ct;
        isDone[idx] = true;
        completed++;
    }

    return { result, gantt };
}


function prioritySchedulingP(processes) {
    // Sort processes by arrival time, then by priority, then by process ID for tie-breaking
    const n = processes.length;
    let remaining = processes.map(p => p.burstTime);
    let firstStart = new Array(n).fill(null);

    let currentTime = 0, completed = 0;
    const result = [], gantt = [];
    let last = -1;

    // Loop until all processes are completed, at each step selecting the process with the highest priority (lowest priority number) that has arrived and is not yet completed. This is a preemptive algorithm, so if a new process arrives with a higher priority than the currently executing process, the CPU will switch to the new process immediately.
    while (completed < n) {
        let idx = -1;

        for (let i = 0; i < n; i++) {
            if (
                processes[i].arrivalTime <= currentTime &&
                remaining[i] > 0 &&
                (
                    idx === -1 ||
                    processes[i].priority < processes[idx].priority
                )
            ) {
                idx = i;
            }
        }

        // If no process is ready to execute, increment the current time and continue to the next iteration.
        if (idx === -1) {
            currentTime++;
            continue;
        }

        // Track the first start time for each process to calculate waiting time and turnaround time later.
        if (firstStart[idx] === null) firstStart[idx] = currentTime;

        if (last !== idx) {
            gantt.push({ processID: processes[idx].processID, startTime: currentTime });
            last = idx;
        }

        remaining[idx]--;
        currentTime++;

        // If the process has completed, update the results and increment the completed count.
        if (remaining[idx] === 0) {
            completed++;
            const ct = currentTime;

            // Store the results for each process for the Tabular Summary.
            result.push({
                ...processes[idx],
                priority: processes[idx].priority,
                startTime: firstStart[idx],
                completionTime: ct,
                turnaroundTime: ct - processes[idx].arrivalTime,
                waitingTime: ct - processes[idx].arrivalTime - processes[idx].burstTime
            });
        }
    }

    // Finalize Gantt end times based on the start time of the next process or the final current time if it's the last process.
    gantt.forEach((g, i) => {
        g.endTime = (gantt[i + 1]?.startTime ?? currentTime);
    });

    return { result, gantt };
}


function priorityRoundRobin(processes, quantum) {
    const n = processes.length;

    // Remaining burst times and first start tracking
    let remaining = processes.map(p => p.burstTime);
    let firstStart = new Array(n).fill(null);
    let completed = 0;
    let currentTime = 0;

    const gantt = [];
    const result = [];

    // Queues grouped by priority: {priority: [indexes]}
    let queues = {};

    // Tracks which process is already in queues
    let visited = new Array(n).fill(false);

    let lastProcess = -1;

    // Main scheduling loop
    while (completed < n) {

        // Add newly arrived processes
        for (let i = 0; i < n; i++) {
            if (!visited[i] && processes[i].arrivalTime <= currentTime) {
                const prio = processes[i].priority;
                if (!queues[prio]) queues[prio] = [];
                queues[prio].push(i);
                visited[i] = true;
            }
        }

        // Find highest-priority queue with ready processes
        const availablePriorities = Object.keys(queues)
            .map(Number)
            .filter(p => queues[p].length > 0)
            .sort((a, b) => a - b); // smaller number = higher priority

        // CPU idle
        if (availablePriorities.length === 0) {
            currentTime++;
            continue;
        }

        const highestPriority = availablePriorities[0];
        const queue = queues[highestPriority];

        // Pick process at the front of queue
        const idx = queue.shift();

        // Track first start time
        if (firstStart[idx] === null) firstStart[idx] = currentTime;

        // Update Gantt if switching process
        if (lastProcess !== idx) {
            gantt.push({ processID: processes[idx].processID, startTime: currentTime });
            lastProcess = idx;
        }

        // Execute for quantum or remaining time
        let execTime = Math.min(quantum, remaining[idx]);
        for (let t = 0; t < execTime; t++) {
            remaining[idx]--;
            currentTime++;

            // Check for new arrivals during execution
            for (let i = 0; i < n; i++) {
                if (!visited[i] && processes[i].arrivalTime <= currentTime) {
                    const prio = processes[i].priority;
                    if (!queues[prio]) queues[prio] = [];
                    queues[prio].push(i);
                    visited[i] = true;
                }
            }

            // Preemption: break if a higher-priority process arrived
            const newAvailablePriorities = Object.keys(queues)
                .map(Number)
                .filter(p => queues[p].length > 0)
                .sort((a, b) => a - b);

            if (newAvailablePriorities[0] < highestPriority) {
                break;
            }

            if (remaining[idx] === 0) break;
        }

        // If process finished
        if (remaining[idx] === 0) {
            completed++;
            const ct = currentTime;

            // Store the results for each process for the Tabular Summary.
            result.push({
                ...processes[idx],
                priority: processes[idx].priority,
                startTime: firstStart[idx],
                completionTime: ct,
                turnaroundTime: ct - processes[idx].arrivalTime,
                waitingTime: ct - processes[idx].arrivalTime - processes[idx].burstTime
            });
        } else {
            // Not finished: requeue at same priority
            queue.push(idx);
        }
    }

    // Finalize Gantt end times based on the start time of the next process or the final current time if it's the last process.
    gantt.forEach((g, i) => {
        g.endTime = gantt[i + 1]?.startTime ?? currentTime;
    });

    return { result, gantt };
}

// This function takes the results from the scheduling algorithm and generates an HTML table to display the process information in a tabular format.
function displayTabularSummary(result, selectedAlgorithm) {
    const sortedResult = [...result].sort((a, b) =>
        a.processID.localeCompare(b.processID)
    );

    let priorityVisible = 'none';
    let cellNumber = 5; // default number of cells before priority column

    if (selectedAlgorithm.includes('ps')) {
        priorityVisible = 'table-cell';
        cellNumber = 6; // increase cell number to accommodate priority column
    }

    let html = `<div class="output"><table border="1">
        <tr>
            <th>Process ID</th>
            <th>Arrival Time</th>
            <th>Burst Time</th>
            <th style="display: ${priorityVisible}">Priority</th>
            <th>Start Time</th>
            <th>Completion Time</th>
            <th>Waiting Time</th>
            <th>Turnaround Time</th>
        </tr>`;

    let totalWaitingTime = 0;
    let totalTurnaroundTime = 0;
    let watingTimeExpression = '';
    let turnaroundTimeExpression = '';

    sortedResult.forEach((p, index) => {
        totalWaitingTime += p.waitingTime;
        totalTurnaroundTime += p.turnaroundTime;
        watingTimeExpression += `${p.waitingTime}`;
        turnaroundTimeExpression += `${p.turnaroundTime}`;

        if (index < sortedResult.length - 1) {
            watingTimeExpression += ' + ';
            turnaroundTimeExpression += ' + ';
        }

        html += `
        <tr>
            <td>${p.processID}</td>
            <td>${p.arrivalTime}</td>
            <td>${p.burstTime}</td>
            <td style="display: ${priorityVisible}">${p.priority}</td>
            <td>${p.startTime ?? '-'}</td>
            <td>${p.completionTime}</td>
            <td>${p.waitingTime}</td>
            <td>${p.turnaroundTime}</td>
        </tr>`;
    });

    const n = sortedResult.length;
    const avgWaitingTime = (totalWaitingTime / n).toFixed(2);
    const avgTurnaroundTime = (totalTurnaroundTime / n).toFixed(2);

    html += `
            <tr>
                <td colspan="${cellNumber}"><strong>Averages</strong></td>
                <td><strong>${avgWaitingTime}</strong></td>
                <td><strong>${avgTurnaroundTime}</strong></td>
            </tr>
        </table>

        <p><strong>Average Waiting Time:</strong> ${watingTimeExpression} / ${n} = ${avgWaitingTime}</p>
        <p><strong>Average Turnaround Time:</strong> ${turnaroundTimeExpression} / ${n} = ${avgTurnaroundTime}</p>
        `;

    document.body.insertAdjacentHTML('beforeend', html);

    console.log(sortedResult); // For troubleshooting, log the sorted result to the console.
}

// This function takes the Gantt chart data from the scheduling algorithm and generates a visual representation of the process execution timeline using HTML and CSS.
function displayGanttChart(gantt) {
    let html = `<div class="output">`;
    html += `<div style="display:flex;">`;

    gantt.forEach(block => {
        const duration = block.endTime - block.startTime;

        html += `
        <div style="
            border:1px solid black;
            padding:10px;
            min-width:${duration * 30}px;
            text-align:center;">
            ${block.processID}
        </div>`;
    });

    html += `</div><div style="display:flex;">`;

    gantt.forEach(block => {
        html += `
            <div style="min-width:${(block.endTime - block.startTime) * 30}px;">
                ${block.startTime}
            </div>`;
    });

    html += `<div>${gantt[gantt.length - 1].endTime}</div>`;
    html += `</div></div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    console.log(gantt); // For troubleshooting, log the Gantt chart data to the console.
}
