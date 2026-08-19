// Frontend logic for Unraid Backup & Log Sentinel

// State variables
let currentTab = 'dashboard';
const API_BASE = ''; // Same host
const expandedCards = new Set();
// Persist AI analysis across page reloads using localStorage
const aiAnalysisCache = {
    get: (id) => localStorage.getItem(`ai_analysis_${id}`),
    set: (id, val) => localStorage.setItem(`ai_analysis_${id}`, val),
    has: (id) => localStorage.getItem(`ai_analysis_${id}`) !== null
};
const activeAnalyses = new Set();

// Tab Switcher
function switchTab(tabId) {
    // Hide all panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    // Deactivate all buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show current pane
    const targetPane = document.getElementById(`tab-${tabId}`);
    if (targetPane) targetPane.classList.add('active');

    // Activate current button
    const activeBtn = document.getElementById(`btn-nav-${tabId}`);
    if (activeBtn) activeBtn.classList.add('active');

    currentTab = tabId;

    // Update titles
    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');
    
    if (tabId === 'dashboard') {
        titleEl.textContent = 'Operational Overview';
        subtitleEl.textContent = 'Real-time status of backups and storage array integrity.';
        refreshDashboardData();
    } else if (tabId === 'ai') {
        titleEl.textContent = 'AI Sentinel Diagnostics';
        subtitleEl.textContent = 'AI-driven analysis of storage arrays, file structures, and backup integrity.';
        loadLatestAIAnalysis();
    } else if (tabId === 'syslog') {
        titleEl.textContent = 'Logs & Syslog Inspector';
        subtitleEl.textContent = 'Raw output streams from server syslogs and backup tasks.';
        loadRawLogs();
    } else if (tabId === 'tokens') {
        titleEl.textContent = 'Gemini Cost & Usage';
        subtitleEl.textContent = 'Financial auditing and token counts of AI engine operations.';
        loadCostUsageData();
    } else if (tabId === 'docker') {
        titleEl.textContent = 'Docker Services';
        subtitleEl.textContent = 'Operational health, container states, and responsive checks.';
        loadDockerStatus();
    } else if (tabId === 'systems') {
        titleEl.textContent = 'Remote Systems';
        subtitleEl.textContent = 'Operational health, hardware utilization, and core system logs of remote servers.';
        loadSystemsStatus();
    } else if (tabId === 'settings') {
        titleEl.textContent = 'System Settings';
        subtitleEl.textContent = 'Integration aids and database maintenance controls.';
        loadSettingsData();
    }
}

// Refresh Dashboard Data
async function refreshDashboardData() {
    await loadBackupStatuses();
}

// Helper to escape HTML characters
function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return "";
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Helper to format ID to display title
function formatBackupId(id) {
    return id
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Load Backup Statuses
async function loadBackupStatuses() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (!res.ok) throw new Error('Failed to fetch backup statuses');
        const data = await res.json();
        
        // Populate log selector dropdown dynamically
        const logSelector = document.getElementById('log-selector');
        if (logSelector) {
            const currentVal = logSelector.value;
            logSelector.innerHTML = `
                <option value="syslog">Unraid Syslog (24h)</option>
                <option value="duplicacy">Duplicacy (All Backup Jobs)</option>
            `;
            data.forEach(backup => {
                const option = document.createElement('option');
                option.value = backup.id;
                let prefix = '';
                if (backup.id.toLowerCase().includes('rsync')) {
                    prefix = 'Local Rsync: ';
                } else if (backup.id.toLowerCase().includes('duplicacy')) {
                    prefix = 'Offsite Duplicacy: ';
                } else {
                    prefix = 'Backup: ';
                }
                option.textContent = `${prefix}${formatBackupId(backup.id)}`;
                logSelector.appendChild(option);
            });
            // Restore selection if it still exists
            if ([...logSelector.options].some(o => o.value === currentVal)) {
                logSelector.value = currentVal;
            }
        }
        
        const rsyncContainer = document.getElementById('rsync-backups-container');
        const duplicacyContainer = document.getElementById('duplicacy-backups-container');
        const otherContainer = document.getElementById('other-backups-container');
        
        if (rsyncContainer) rsyncContainer.innerHTML = '';
        if (duplicacyContainer) duplicacyContainer.innerHTML = '';
        if (otherContainer) otherContainer.innerHTML = '';
        
        const emptyState = document.getElementById('dashboard-empty-state');
        if (data.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'block';
                emptyState.innerHTML = '<p class="meta-text">No backups registered yet.</p>';
            }
            document.getElementById('group-rsync-wrapper').style.display = 'none';
            document.getElementById('group-duplicacy-wrapper').style.display = 'none';
            document.getElementById('group-other-wrapper').style.display = 'none';
            return;
        } else {
            if (emptyState) emptyState.style.display = 'none';
        }

        // Sort backups alphabetically by ID
        data.sort((a, b) => a.id.localeCompare(b.id));

        let systemHealth = 'healthy';
        let rsyncCount = 0;
        let duplicacyCount = 0;
        let otherCount = 0;
        
        data.forEach(backup => {
            const id = backup.id;
            const status = backup.status.toLowerCase();
            const lastRun = backup.last_run;
            const message = backup.message || 'No message provided.';
            
            const duration = backup.duration;
            const lastSuccess = backup.last_success;
            
            // Choose icons and colors
            let iconClass = 'fa-solid fa-server';
            let iconColor = 'var(--text-secondary)';
            
            if (id.toLowerCase().includes('rsync')) {
                iconClass = 'fa-solid fa-server';
            } else if (id.toLowerCase().includes('duplicacy') || 
                       id.toLowerCase().includes('offsite') || 
                       id.toLowerCase().includes('samba') || 
                       id.toLowerCase().includes('music') || 
                       id.toLowerCase().includes('tvshow')) {
                iconClass = 'fa-solid fa-cloud-arrow-up';
            } else {
                iconClass = 'fa-solid fa-box-archive';
            }

            if (status === 'success') {
                iconColor = 'var(--color-success)';
            } else if (status === 'failed') {
                iconClass = 'fa-solid fa-triangle-exclamation';
                iconColor = 'var(--color-failed)';
                systemHealth = 'critical';
            } else if (status === 'warning' || status === 'stale') {
                iconClass = 'fa-solid fa-circle-exclamation';
                iconColor = status === 'warning' ? 'var(--color-warning)' : 'var(--color-stale)';
                if (systemHealth !== 'critical') systemHealth = 'warning';
            }

            const offset = (status === 'unknown') ? '314' : '0';
            const displayTitle = formatBackupId(id);

            const card = document.createElement('div');
            card.className = 'card status-card';
            card.id = `card-${id}`;
            card.innerHTML = `
                <div class="card-header">
                    <h3>${escapeHtml(displayTitle)}</h3>
                    <span class="badge ${status}">${escapeHtml(status)}</span>
                </div>
                <div class="card-body status-body">
                    <div class="ring-container">
                        <svg class="status-ring" viewBox="0 0 120 120">
                            <circle class="ring-bg" cx="60" cy="60" r="50" />
                            <circle class="ring-fg ${status}" id="ring-${id}-fg" cx="60" cy="60" r="50" style="stroke-dashoffset: ${offset};" />
                        </svg>
                        <div class="ring-inner">
                            <i class="${iconClass} status-icon" id="icon-${id}-status" style="color: ${iconColor};"></i>
                        </div>
                    </div>
                    <div class="status-details">
                        <p class="timestamp-label">Last Run</p>
                        <p class="timestamp-value" id="${id}-last-run">${formatDate(lastRun)}</p>
                        ${duration ? `
                            <p class="timestamp-label" style="margin-top: 0.25rem;">Run Duration</p>
                            <p class="timestamp-value" id="${id}-duration">${escapeHtml(duration)}</p>
                        ` : ''}
                        ${lastSuccess ? `
                            <p class="timestamp-label" style="margin-top: 0.25rem;">Last Success</p>
                            <p class="timestamp-value" id="${id}-last-success">${formatDate(lastSuccess)}</p>
                        ` : ''}
                        <p class="message-value" id="${id}-message" title="${escapeHtml(message)}" style="margin-top: 0.25rem;">${escapeHtml(message)}</p>
                    </div>
                </div>
            `;

            
            if (id.toLowerCase().includes('rsync')) {
                if (rsyncContainer) rsyncContainer.appendChild(card);
                rsyncCount++;
            } else if (id.toLowerCase().includes('duplicacy') || 
                       id.toLowerCase().includes('offsite') || 
                       id.toLowerCase().includes('samba') || 
                       id.toLowerCase().includes('music') || 
                       id.toLowerCase().includes('tvshow')) {
                if (duplicacyContainer) duplicacyContainer.appendChild(card);
                duplicacyCount++;
            } else {
                if (otherContainer) otherContainer.appendChild(card);
                otherCount++;
            }
        });
        
        document.getElementById('group-rsync-wrapper').style.display = rsyncCount > 0 ? 'block' : 'none';
        document.getElementById('group-duplicacy-wrapper').style.display = duplicacyCount > 0 ? 'block' : 'none';
        document.getElementById('group-other-wrapper').style.display = otherCount > 0 ? 'block' : 'none';
        
        // Update overall system status indicator
        const sysLabel = document.getElementById('system-overall-health');
        const sysPulse = document.querySelector('.status-pulse-dot');
        
        if (systemHealth === 'healthy') {
            sysLabel.textContent = 'Active & Healthy';
            sysPulse.className = 'status-pulse-dot ok';
        } else if (systemHealth === 'warning') {
            sysLabel.textContent = 'Warnings Detected';
            sysPulse.className = 'status-pulse-dot warning';
        } else {
            sysLabel.textContent = 'Attention Required';
            sysPulse.className = 'status-pulse-dot failed';
        }
        
    } catch (err) {
        console.error('Error fetching backup status:', err);
    }
}

// Load Latest AI Analysis
async function loadLatestAIAnalysis() {
    try {
        const res = await fetch(`${API_BASE}/api/analysis`);
        if (!res.ok) throw new Error('Failed to fetch AI analysis');
        const data = await res.json();
        
        const timestampEl = document.getElementById('ai-last-run');
        const statusBadge = document.getElementById('ai-health-status');
        const contentEl = document.getElementById('ai-markdown-content');
        
        if (!data.timestamp) {
            timestampEl.textContent = 'Last updated: Never';
            statusBadge.textContent = 'Unknown';
            statusBadge.className = 'ai-badge unknown';
            contentEl.innerHTML = '<p>No analysis reports found. Click "Run Analysis" in the card header to start your first diagnostics run.</p>';
            return;
        }
        
        timestampEl.textContent = `Last updated: ${formatDate(data.timestamp)}`;
        
        const status = data.status.toLowerCase();
        statusBadge.textContent = status;
        statusBadge.className = `ai-badge ${status}`;
        
        // Format and render markdown
        let rawMarkdown = data.report;
        
        // Process GitHub alert blocks before marked renders
        rawMarkdown = rawMarkdown
            .replace(/>\s*\[!NOTE\]/gi, '> **NOTE:**')
            .replace(/>\s*\[!WARNING\]/gi, '> **WARNING:**')
            .replace(/>\s*\[!CAUTION\]/gi, '> **CAUTION:**');
            
        contentEl.innerHTML = marked.parse(rawMarkdown);
        
        // Apply custom alert classes post-render
        contentEl.querySelectorAll('blockquote').forEach(bq => {
            const text = bq.textContent.toUpperCase();
            if (text.includes('NOTE:')) {
                bq.classList.add('alert-note');
            } else if (text.includes('WARNING:')) {
                bq.classList.add('alert-warning');
            } else if (text.includes('CAUTION:')) {
                bq.classList.add('alert-caution');
            }
        });
        
    } catch (err) {
        console.error('Error fetching AI analysis:', err);
    }
}

// Trigger Gemini AI Analysis Manually
async function triggerAIAnalysis() {
    const btn = document.getElementById('btn-analyze');
    const loadingEl = document.getElementById('ai-loading');
    const contentEl = document.getElementById('ai-markdown-content');
    
    // UI Loading State
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    loadingEl.style.display = 'flex';
    contentEl.style.display = 'none';
    
    try {
        const res = await (await fetch(`${API_BASE}/api/analysis/trigger`, { method: 'POST' })).json();
        
        // Poll for completion
        let attempts = 0;
        const interval = setInterval(async () => {
            attempts++;
            const checkRes = await fetch(`${API_BASE}/api/analysis`);
            const data = await checkRes.json();
            
            // If timestamp changed (i.e. updated within the last 15 seconds), we know it finished
            if (data.timestamp) {
                const elapsedSec = (new Date() - new Date(data.timestamp)) / 1000;
                if (elapsedSec < 15 || attempts > 20) {
                    clearInterval(interval);
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Run Analysis';
                    loadingEl.style.display = 'none';
                    contentEl.style.display = 'block';
                    loadLatestAIAnalysis();
                    loadCostUsageData(); // Refresh spend
                }
            }
        }, 3000);
        
    } catch (err) {
        console.error('Error triggering AI analysis:', err);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI Analysis';
        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    }
}

// Load Raw Logs
async function loadRawLogs() {
    const source = document.getElementById('log-selector').value;
    const term = document.getElementById('log-terminal-output');
    
    term.textContent = `Fetching raw data streams for ${source}...`;
    
    try {
        const res = await fetch(`${API_BASE}/api/logs?source=${source}`);
        if (!res.ok) throw new Error('Failed to fetch logs');
        const data = await res.json();
        term.textContent = data.content;
        term.scrollTop = term.scrollHeight; // Scroll to bottom
    } catch (err) {
        term.textContent = `Error loading logs: ${err.message}`;
    }
}

// Load Gemini Cost Usage Audit Data
async function loadCostUsageData() {
    try {
        const res = await fetch(`${API_BASE}/api/usage`);
        if (!res.ok) throw new Error('Failed to fetch token usage data');
        const data = await res.json();
        
        // Update cards
        document.getElementById('cost-total-spend').textContent = `$${data.totals.cost.toFixed(4)}`;
        document.getElementById('tokens-input').textContent = data.totals.prompt_tokens.toLocaleString();
        document.getElementById('tokens-output').textContent = data.totals.completion_tokens.toLocaleString();
        
        // Update Table
        const tbody = document.getElementById('usage-table-body');
        tbody.innerHTML = '';
        
        if (data.recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No token usage recorded.</td></tr>';
            return;
        }
        
        data.recent.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(log.timestamp)}</td>
                <td><strong>${log.action}</strong></td>
                <td>${log.prompt_tokens.toLocaleString()}</td>
                <td>${log.completion_tokens.toLocaleString()}</td>
                <td><span style="color: var(--color-success); font-weight:600;">$${log.cost.toFixed(4)}</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error loading usage logs:', err);
    }
}

// General helper to sync all tabs
function refreshData() {
    const btn = document.getElementById('btn-refresh');
    btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Syncing...';
    
    setTimeout(async () => {
        if (currentTab === 'dashboard') {
            await refreshDashboardData();
        } else if (currentTab === 'ai') {
            await loadLatestAIAnalysis();
        } else if (currentTab === 'syslog') {
            await loadRawLogs();
        } else if (currentTab === 'tokens') {
            await loadCostUsageData();
        } else if (currentTab === 'systems') {
            await loadSystemsStatus();
        } else if (currentTab === 'settings') {
            loadSettingsData();
        }
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync Data';
    }, 500);
}

// Format ISO string into clean relative/absolute string
function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
        const date = new Date(isoStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.max(0, Math.floor(diffMs / 60000));
        const diffHrs = Math.floor(diffMin / 60);
        
        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHrs < 24) {
            const hours = Math.floor(diffMin / 60);
            const mins = diffMin % 60;
            return `${hours}h ${mins}m ago`;
        }
        
        return date.toLocaleString();
    } catch (err) {
        return isoStr;
    }
}

// Load Settings Data
function loadSettingsData() {
    const host = window.location.hostname || 'YOUR_SERVER_IP';
    const port = window.location.port || '8080';
    document.getElementById('settings-host-ip').textContent = host;
    document.getElementById('settings-host-port').textContent = port;
}

// Reset Database API Call
async function resetAppDatabase() {
    const check = confirm("DANGER: Are you sure you want to completely clear the Sentinel database? This deletes all backup status records, log history, and cost stats. This cannot be undone.");
    if (!check) return;
    
    const btn = document.getElementById('btn-reset-db');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Clearing Database...';
    
    try {
        const res = await fetch(`${API_BASE}/api/reset`, { method: 'POST' });
        if (!res.ok) throw new Error('API request failed');
        const data = await res.json();
        
        alert("Database reset successfully! All status cards and history logs have been cleared.");
        switchTab('dashboard');
    } catch (err) {
        alert("Failed to reset database: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Clear Database';
    }
}

// Load Docker Services status
async function loadDockerStatus() {
    const container = document.getElementById('docker-services-container');
    if (!container) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/docker/status`);
        if (!res.ok) throw new Error('Failed to fetch Docker status');
        const data = await res.json();
        
        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<p class="meta-text" style="grid-column: 1 / -1; text-align: center; padding: 2rem;">No Docker services monitored yet.</p>';
            return;
        }
        
        let latestTime = null;
        
        // Sort Docker services alphabetically by name
        data.sort((a, b) => a.name.localeCompare(b.name));
        
        data.forEach(service => {
            const id = service.id;
            const name = service.name;
            const cName = service.container_name;
            const port = service.port;
            const hostIp = service.host_ip;
            const status = service.status;          
            const apiHealth = service.api_health;    
            const lastRun = service.last_run;
            const message = service.message || '';
            const logs = service.log_snippet || 'No logs available.';
            
            if (lastRun) {
                const checkTime = new Date(lastRun);
                if (!latestTime || checkTime > latestTime) latestTime = checkTime;
            }
            
            let statusClass = 'unknown';
            let iconClass = 'fa-solid fa-cube';
            let iconColor = 'var(--text-secondary)';
            
            if (status === 'running' && apiHealth === 'healthy') {
                statusClass = 'success';
                iconColor = 'var(--color-success)';
            } else if (status === 'stopped' || apiHealth === 'unhealthy' || status === 'not_found') {
                statusClass = 'failed';
                iconClass = 'fa-solid fa-triangle-exclamation';
                iconColor = 'var(--color-failed)';
            } else if (apiHealth === 'unresponsive' || status === 'error' || apiHealth === 'warning') {
                statusClass = 'warning';
                iconClass = 'fa-solid fa-circle-exclamation';
                iconColor = 'var(--color-warning)';
            }
            
            const offset = (statusClass === 'unknown') ? '314' : '0';
            const card = document.createElement('div');
            card.className = 'card status-card docker-card';
            card.id = `docker-card-${id}`;
            
            // Retain card expansion state during auto-polling re-renders
            if (expandedCards.has(id)) {
                card.classList.add('expanded');
            }
            
            // Parse ignore patterns list
            const ignorePatternsStr = service.ignore_patterns || '';
            const ignorePatterns = ignorePatternsStr.split(',').filter(p => p.trim().length > 0);
            
            // Retrieve cached AI analysis if exists
            const cachedAnalysis = aiAnalysisCache.get(id);
            const aiDisplay = cachedAnalysis ? 'block' : 'none';
            const aiText = cachedAnalysis ? parseSimpleMarkdown(cachedAnalysis) : '';
            
            card.innerHTML = `
                <div class="docker-card-summary" onclick="toggleDockerCardExpand('${id}')">
                    <div class="docker-card-title-group">
                        <span class="status-indicator-dot ${statusClass}"></span>
                        <h4 class="docker-card-title">${escapeHtml(name)}</h4>
                    </div>
                    <i class="fa-solid fa-chevron-down expand-chevron"></i>
                </div>
                
                <div class="docker-card-details" onclick="event.stopPropagation()">
                    <div class="docker-status-header" style="border: none; padding: 0;">
                        <div class="docker-badges" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <span class="docker-badge ${status}">${escapeHtml(status)}</span>
                            <span class="docker-badge ${apiHealth}">${escapeHtml(apiHealth)}</span>
                            ${(statusClass === 'warning' || statusClass === 'failed') ? `
                                <button class="btn-ack-service" onclick="acknowledgeDockerService('${id}')" title="Clear alerts & acknowledge current warnings/errors">
                                    <i class="fa-solid fa-circle-check"></i> Clear Alert
                                </button>
                            ` : ''}
                            <button class="btn-remove-service" onclick="removeDockerService('${id}')" title="Stop monitoring this container" style="margin-left: auto;">
                                <i class="fa-solid fa-trash-can"></i> Delete
                            </button>
                        </div>
                    </div>
                    
                    <p class="timestamp-label" style="font-weight: 600; color: var(--text-primary); margin: 0;">${escapeHtml(message)}</p>
                    
                    <div class="docker-meta" style="margin-top: -0.25rem;">
                        <span><i class="fa-solid fa-link" style="width: 14px; font-size: 0.75rem;"></i> Connection: ${escapeHtml(hostIp)}:${port}</span>
                        <span><i class="fa-solid fa-box" style="width: 14px; font-size: 0.75rem;"></i> Container: ${escapeHtml(cName)}</span>
                    </div>
                    
                    <div class="docker-log-panel" id="log-panel-${id}">${escapeHtml(logs)}</div>
                    
                    <!-- AI Diagnostics Explanation Container -->
                    <div id="ai-analysis-container-${id}" style="display: ${aiDisplay}; background: hsla(262, 85%, 65%, 0.05); border: 1px solid hsla(262, 85%, 65%, 0.2); border-radius: 8px; padding: 0.75rem 1rem; margin-top: 0.5rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; color: hsl(262, 85%, 65%); font-weight: 600; font-size: 0.95rem;">
                                <i class="fa-solid fa-brain"></i> AI Diagnostics Explanation
                            </div>
                            <span onclick="clearCachedAIAnalysis('${id}')" style="font-size: 0.7rem; color: var(--text-muted); cursor: pointer; text-decoration: underline;" title="Clear this analysis from cache">Clear</span>
                        </div>
                        <div id="ai-analysis-text-${id}" class="markdown-body" style="font-size: 0.8rem; line-height: 1.5; color: var(--text-secondary); text-align: left;">${aiText}</div>
                    </div>
                    
                    <!-- Diagnostics & Mute Actions Row -->
                    <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem;">
                        <button class="btn btn-secondary" onclick="analyzeLogsWithAI('${id}')" id="btn-ai-analyze-${id}" style="font-size: 0.75rem; padding: 0.4rem 0.75rem; background-color: hsla(262, 85%, 65%, 0.1); border-color: hsla(262, 85%, 65%, 0.3); color: hsl(262, 85%, 65%); flex-grow: 1;">
                            <i class="fa-solid fa-brain"></i> Analyze Logs with AI
                        </button>
                        <button class="btn btn-secondary" onclick="toggleIgnorePatternUI('${id}')" style="font-size: 0.75rem; padding: 0.4rem 0.75rem; flex-grow: 1;">
                            <i class="fa-solid fa-filter-circle-xmark"></i> Mute Log Alert
                        </button>
                    </div>
                    
                    <!-- Ignore Pattern Form -->
                    <div id="ignore-pattern-ui-${id}" style="display: none; flex-direction: column; gap: 0.5rem; border: 1px dashed var(--border-card); padding: 0.75rem; border-radius: 6px; background-color: hsla(220, 15%, 15%, 0.2);">
                        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-primary); text-align: left;">Mute alerts for matching strings (case-insensitive):</div>
                        <div style="display: flex; gap: 0.5rem; width: 100%;">
                            <input type="text" id="input-ignore-${id}" placeholder="e.g. parsing size failed" style="flex-grow: 1; font-size: 0.75rem; padding: 0.4rem; background: var(--bg-body); border: 1px solid var(--border-card); border-radius: 4px; color: var(--text-primary);">
                            <button class="btn btn-secondary" onclick="addIgnorePattern('${id}')" style="font-size: 0.75rem; padding: 0.4rem 0.75rem; background: var(--color-success); border: none; color: white;">Add</button>
                        </div>
                        <div id="ignore-patterns-list-${id}" style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.25rem; text-align: left;">
                            ${ignorePatterns.length === 0 ? '<span style="font-size: 0.7rem; color: var(--text-muted);">No muted patterns yet.</span>' : 
                                ignorePatterns.map(p => `
                                    <span class="docker-badge" style="background-color: hsla(0, 0%, 20%, 0.6); color: var(--text-secondary); display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.7rem; border: 1px solid var(--border-card); padding: 0.2rem 0.5rem; border-radius: 4px; text-transform: none;">
                                        "${escapeHtml(p)}"
                                        <i class="fa-solid fa-xmark" onclick="removeIgnorePattern('${id}', '${p}')" style="cursor: pointer; color: var(--color-failed); font-size: 0.75rem;"></i>
                                    </span>
                                `).join('')
                            }
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
        
        const timeLabel = document.getElementById('docker-last-probed');
        if (timeLabel) {
            if (latestTime) {
                timeLabel.textContent = `Last checked: ${formatDate(latestTime.toISOString())}`;
            } else {
                timeLabel.textContent = 'Last checked: Never';
            }
        }
        
    } catch (err) {
        container.innerHTML = `<p class="meta-text" style="grid-column: 1 / -1; text-align: center; color: var(--color-failed); padding: 2rem;">Error loading Docker statuses: ${escapeHtml(err.message)}</p>`;
    }
}

// Toggle Docker card expansion state
function toggleDockerCardExpand(serviceId) {
    const card = document.getElementById(`docker-card-${serviceId}`) || document.getElementById(`system-card-${serviceId}`);
    if (!card) return;
    
    const isExpanded = card.classList.toggle('expanded');
    if (isExpanded) {
        expandedCards.add(serviceId);
        // Scroll logs to bottom immediately upon expansion
        const panel = document.getElementById(`log-panel-${serviceId}`) || document.getElementById(`system-log-panel-${serviceId}`);
        if (panel) {
            panel.scrollTop = panel.scrollHeight;
        }
    } else {
        expandedCards.delete(serviceId);
    }
}

// Trigger manual Docker verify check
async function triggerDockerProbe() {
    const btn = document.getElementById('btn-probe-docker');
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking Health...';
    
    try {
        const res = await fetch(`${API_BASE}/api/docker/verify`, { method: 'POST' });
        if (!res.ok) throw new Error('API probe call failed');
        
        setTimeout(async () => {
            await loadDockerStatus();
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Check Health Now';
        }, 3000);
        
    } catch (err) {
        alert("Failed to run Docker prober: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Check Health Now';
    }
}

// Trigger Docker container auto-discovery
async function discoverDockerContainers() {
    const btn = document.getElementById('btn-discover-docker');
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Discovering...';
    
    try {
        const res = await fetch(`${API_BASE}/api/docker/discover`, { method: 'POST' });
        if (!res.ok) throw new Error('API discovery call failed');
        const data = await res.json();
        
        alert(data.message);
        await loadDockerStatus();
        
    } catch (err) {
        alert("Failed to discover containers: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Discover Containers';
    }
}

// Remove a Docker service from monitoring
async function removeDockerService(serviceId) {
    const check = confirm(`Are you sure you want to stop monitoring this container? This will remove it from the Sentinel database.`);
    if (!check) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/docker/service/${serviceId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('API delete call failed');
        const data = await res.json();
        
        await loadDockerStatus();
    } catch (err) {
        alert("Failed to remove service: " + err.message);
    }
}

// Acknowledge warnings or errors for a service
async function acknowledgeDockerService(serviceId) {
    try {
        const res = await fetch(`${API_BASE}/api/docker/service/${serviceId}/acknowledge`, { method: 'POST' });
        if (!res.ok) throw new Error('API acknowledgment call failed');
        const data = await res.json();
        
        await loadDockerStatus();
    } catch (err) {
        alert("Failed to clear alerts: " + err.message);
    }
}
// Analyze specific Docker service logs using AI
async function analyzeLogsWithAI(serviceId) {
    const btn = document.getElementById(`btn-ai-analyze-${serviceId}`);
    if (!btn) return;
    
    // Add to active analyses to block auto-polling re-renders
    activeAnalyses.add(serviceId);
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Logs...';
    
    try {
        const res = await fetch(`${API_BASE}/api/docker/service/${serviceId}/analyze`, { method: 'POST' });
        if (!res.ok) throw new Error('API analysis call failed');
        const data = await res.json();
        
        // Cache the analysis text globally
        aiAnalysisCache.set(serviceId, data.analysis);
        
        // Retrieve fresh DOM elements from active document (prevents stale reference updates)
        const container = document.getElementById(`ai-analysis-container-${serviceId}`);
        const textEl = document.getElementById(`ai-analysis-text-${serviceId}`);
        if (container && textEl) {
            textEl.innerHTML = parseSimpleMarkdown(data.analysis);
            container.style.display = 'block';
            container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (err) {
        alert("Failed to analyze logs: " + err.message);
    } finally {
        activeAnalyses.delete(serviceId);
        
        // Get fresh reference to button to restore status
        const freshBtn = document.getElementById(`btn-ai-analyze-${serviceId}`);
        if (freshBtn) {
            freshBtn.disabled = false;
            freshBtn.innerHTML = '<i class="fa-solid fa-brain"></i> Analyze Logs with AI';
        }
    }
}

// Clear the cached AI analysis report for a container
function clearCachedAIAnalysis(serviceId) {
    localStorage.removeItem(`ai_analysis_${serviceId}`);
    const container = document.getElementById(`ai-analysis-container-${serviceId}`);
    const textEl = document.getElementById(`ai-analysis-text-${serviceId}`);
    if (container) container.style.display = 'none';
    if (textEl) textEl.innerHTML = '';
}

// Toggle display of ignore patterns UI form
function toggleIgnorePatternUI(serviceId) {
    const panel = document.getElementById(`ignore-pattern-ui-${serviceId}`);
    if (!panel) return;
    panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
}

// Add a permanent ignore log string pattern
async function addIgnorePattern(serviceId) {
    const input = document.getElementById(`input-ignore-${serviceId}`);
    if (!input || !input.value.trim()) return;
    
    const pattern = input.value.trim();
    try {
        const res = await fetch(`${API_BASE}/api/docker/service/${serviceId}/ignore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pattern })
        });
        if (!res.ok) throw new Error('Failed to save ignore pattern');
        
        input.value = '';
        await loadDockerStatus();
        
        // Retain ignore UI visibility after reload
        setTimeout(() => {
            const panel = document.getElementById(`ignore-pattern-ui-${serviceId}`);
            if (panel) panel.style.display = 'flex';
        }, 100);
        
    } catch (err) {
        alert("Failed to add ignore pattern: " + err.message);
    }
}

// Remove an ignored pattern
async function removeIgnorePattern(serviceId, pattern) {
    try {
        const res = await fetch(`${API_BASE}/api/docker/service/${serviceId}/ignore?pattern=${encodeURIComponent(pattern)}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete ignore pattern');
        
        await loadDockerStatus();
        
        // Retain ignore UI visibility after reload
        setTimeout(() => {
            const panel = document.getElementById(`ignore-pattern-ui-${serviceId}`);
            if (panel) panel.style.display = 'flex';
        }, 100);
        
    } catch (err) {
        alert("Failed to remove ignore pattern: " + err.message);
    }
}

// Simple client-side Markdown formatter
function parseSimpleMarkdown(mdText) {
    if (!mdText) return '';
    let html = mdText;
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h5 style="margin-top: 0.75rem; margin-bottom: 0.4rem; color: var(--text-primary); font-size: 0.85rem; text-align: left;">$1</h5>');
    html = html.replace(/^## (.*$)/gim, '<h4 style="margin-top: 0.75rem; margin-bottom: 0.4rem; color: var(--text-primary); font-size: 0.9rem; text-align: left;">$1</h4>');
    html = html.replace(/^# (.*$)/gim, '<h3 style="margin-top: 0.75rem; margin-bottom: 0.4rem; color: var(--text-primary); font-size: 0.95rem; text-align: left;">$1</h3>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--text-primary);">$1</strong>');
    
    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre style="background: hsla(0,0%,0%,0.35); padding: 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; word-break: break-all; color: var(--text-primary); margin: 0.5rem 0; border: 1px solid var(--border-card);">$1</pre>');
    
    // Inline code
    html = html.replace(/`(.*?)`/g, '<code style="background: hsla(0,0%,0%,0.2); padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; word-break: break-word; color: hsl(200, 80%, 75%);">$1</code>');
    
    // Lists
    html = html.replace(/^\* (.*$)/gim, '<li style="margin-left: 1rem; list-style-type: disc; margin-bottom: 0.25rem; text-align: left;">$1</li>');
    html = html.replace(/^- (.*$)/gim, '<li style="margin-left: 1rem; list-style-type: disc; margin-bottom: 0.25rem; text-align: left;">$1</li>');
    html = html.replace(/^\d+\.\s+(.*$)/gim, '<li style="margin-left: 1rem; list-style-type: decimal; margin-bottom: 0.25rem; text-align: left;">$1</li>');
    
    // Paragraph spacing / double breaks
    html = html.replace(/\n\n/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

// Load Remote Systems Status
async function loadSystemsStatus() {
    const container = document.getElementById('systems-container');
    if (!container) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/systems`);
        if (!res.ok) throw new Error('Failed to fetch remote systems status');
        const data = await res.json();
        
        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<p class="meta-text" style="grid-column: 1 / -1; text-align: center; padding: 2rem;">No remote systems monitored yet.</p>';
            return;
        }
        
        let latestTime = null;
        data.sort((a, b) => a.name.localeCompare(b.name));
        
        data.forEach(system => {
            const id = system.id;
            const name = system.name;
            const status = (system.status || 'unknown').toLowerCase();
            const lastRun = system.last_run;
            const message = system.message || '';
            const logs = system.log_snippet || 'No logs available.';
            
            if (lastRun) {
                const checkTime = new Date(lastRun);
                if (!latestTime || checkTime > latestTime) latestTime = checkTime;
            }
            
            let metrics = {};
            try {
                metrics = typeof system.metrics === 'string' ? JSON.parse(system.metrics) : system.metrics || {};
            } catch(e) {
                console.error("Failed to parse metrics for " + id, e);
            }
            
            let metadata = {};
            try {
                metadata = typeof system.metadata === 'string' ? JSON.parse(system.metadata) : system.metadata || {};
            } catch(e) {
                console.error("Failed to parse metadata for " + id, e);
            }
            
            let statusClass = 'unknown';
            let iconClass = 'fa-solid fa-server';
            let iconColor = 'var(--text-secondary)';
            
            if (id === 'home_assistant') {
                iconClass = 'fa-solid fa-house-laptop';
            }
            
            if (status === 'healthy') {
                statusClass = 'success';
                iconColor = 'var(--color-success)';
            } else if (status === 'critical') {
                statusClass = 'failed';
                iconClass = 'fa-solid fa-triangle-exclamation';
                iconColor = 'var(--color-failed)';
            } else if (status === 'warning') {
                statusClass = 'warning';
                iconClass = 'fa-solid fa-circle-exclamation';
                iconColor = 'var(--color-warning)';
            }
            
            const offset = (statusClass === 'unknown') ? '314' : '0';
            const card = document.createElement('div');
            card.className = 'card status-card docker-card'; // Reuse styled docker-card layout
            card.id = `system-card-${id}`;
            
            if (expandedCards.has(id)) {
                card.classList.add('expanded');
            }
            
            // Build metrics UI
            let metricsHtml = '';
            if (metrics && (metrics.cpu !== undefined || metrics.ram !== undefined || metrics.disk !== undefined)) {
                metricsHtml = `
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin: 1rem 0; width: 100%;">
                        ${metrics.cpu !== null && metrics.cpu !== undefined ? `
                            <div style="background: hsla(220,15%,15%,0.3); padding: 0.6rem 0.8rem; border-radius: 8px; border: 1px solid var(--border-card);">
                                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.25rem;">
                                    <span>CPU Util</span>
                                    <span style="font-weight:600; color:var(--text-primary);">${metrics.cpu}${metrics.cpu_unit || '%'}</span>
                                </div>
                                <div style="width:100%; height:6px; background:hsla(0,0%,100%,0.08); border-radius:3px; overflow:hidden;">
                                    <div style="width:${metrics.cpu}%; height:100%; background:var(--color-success); border-radius:3px;"></div>
                                </div>
                            </div>
                        ` : ''}
                        ${metrics.ram !== null && metrics.ram !== undefined ? `
                            <div style="background: hsla(220,15%,15%,0.3); padding: 0.6rem 0.8rem; border-radius: 8px; border: 1px solid var(--border-card);">
                                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.25rem;">
                                    <span>Memory Usage</span>
                                    <span style="font-weight:600; color:var(--text-primary);">${metrics.ram}${metrics.ram_unit || '%'}</span>
                                </div>
                                <div style="width:100%; height:6px; background:hsla(0,0%,100%,0.08); border-radius:3px; overflow:hidden;">
                                    <div style="width:${metrics.ram}%; height:100%; background:hsl(200, 80%, 50%); border-radius:3px;"></div>
                                </div>
                            </div>
                        ` : ''}
                        ${metrics.disk !== null && metrics.disk !== undefined ? `
                            <div style="background: hsla(220,15%,15%,0.3); padding: 0.6rem 0.8rem; border-radius: 8px; border: 1px solid var(--border-card);">
                                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.25rem;">
                                    <span>Disk Space</span>
                                    <span style="font-weight:600; color:var(--text-primary);">${metrics.disk}${metrics.disk_unit || '%'}</span>
                                </div>
                                <div style="width:100%; height:6px; background:hsla(0,0%,100%,0.08); border-radius:3px; overflow:hidden;">
                                    <div style="width:${metrics.disk}%; height:100%; background:hsl(262, 85%, 65%); border-radius:3px;"></div>
                                </div>
                            </div>
                        ` : ''}
                        ${metrics.cpu_temp !== null && metrics.cpu_temp !== undefined ? `
                            <div style="background: hsla(220,15%,15%,0.3); padding: 0.6rem 0.8rem; border-radius: 8px; border: 1px solid var(--border-card);">
                                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.25rem;">
                                    <span>CPU Temp</span>
                                    <span style="font-weight:600; color:var(--text-primary);">${metrics.cpu_temp}${metrics.cpu_temp_unit || '°C'}</span>
                                </div>
                                <div style="width:100%; height:6px; background:hsla(0,0%,100%,0.08); border-radius:3px; overflow:hidden;">
                                    <div style="width:${Math.min(100, (metrics.cpu_temp / 100) * 100)}%; height:100%; background:var(--color-warning); border-radius:3px;"></div>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
            }
            
            // Build updates banner HTML
            let updatesHtml = '';
            if (metadata.update_available && metadata.updates && metadata.updates.length > 0) {
                updatesHtml = `
                    <div style="margin: 0.75rem 0; padding: 0.75rem 1rem; border-radius: 10px; background: hsla(40, 90%, 50%, 0.08); border: 1px solid hsla(40, 90%, 50%, 0.25); text-align: left;">
                        <div style="font-weight:700; font-size:0.85rem; color:var(--color-warning); display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
                            <i class="fa-solid fa-gift"></i> Update Available!
                        </div>
                        ${metadata.updates.map(u => `
                            <div style="font-size: 0.8rem; line-height:1.4; margin-bottom: 0.5rem; border-bottom: 1px dashed hsla(220,15%,20%,0.5); padding-bottom:0.5rem; &:last-child { border:none; margin:0; padding:0; }">
                                <strong style="color:var(--text-primary);">${escapeHtml(u.name)}</strong><br>
                                <span style="color:var(--text-secondary);">Installed: <code>${escapeHtml(u.installed_version)}</code> ➡️ Latest: <code>${escapeHtml(u.latest_version)}</code></span>
                                ${u.release_summary ? `<p style="margin-top:0.25rem; font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(u.release_summary)}</p>` : ''}
                                ${u.release_url ? `<a href="${escapeHtml(u.release_url)}" target="_blank" style="display:inline-block; margin-top:0.25rem; font-size:0.75rem; color:hsl(200, 80%, 60%); text-decoration:underline;"><i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i> View Changelog</a>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            
            // Build repairs/issues UI
            let repairsHtml = '';
            if (metadata.issues && metadata.issues.length > 0) {
                repairsHtml = `
                    <div style="margin: 0.75rem 0; padding: 0.75rem 1rem; border-radius: 10px; background: hsla(0, 90%, 50%, 0.05); border: 1px solid hsla(0, 90%, 50%, 0.2); text-align: left;">
                        <div style="font-weight:700; font-size:0.85rem; color:var(--color-failed); display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
                            <i class="fa-solid fa-triangle-exclamation"></i> Active Repair Issues / Warnings
                        </div>
                        ${metadata.issues.map(issue => {
                            const domain = issue.domain || 'system';
                            const title = issue.title || 'System issue';
                            const desc = issue.description || '';
                            const severity = issue.severity || 'warning';
                            const color = severity === 'error' || severity === 'critical' ? 'var(--color-failed)' : 'var(--color-warning)';
                            return `
                                <div style="font-size: 0.8rem; line-height:1.4; margin-bottom: 0.5rem; border-bottom: 1px dashed hsla(220,15%,20%,0.5); padding-bottom:0.5rem; &:last-child { border:none; margin:0; padding:0; }">
                                    <strong style="color:var(--text-primary);"><span style="color:${color};">[${domain.toUpperCase()}]</span> ${escapeHtml(title)}</strong>
                                    ${desc ? `<p style="margin-top:0.15rem; font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(desc)}</p>` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
            
            card.innerHTML = `
                <div class="docker-card-summary" onclick="toggleDockerCardExpand('${id}')">
                    <div class="docker-card-title-group">
                        <span class="status-indicator-dot ${statusClass}"></span>
                        <h4 class="docker-card-title">${escapeHtml(name)}</h4>
                    </div>
                    <i class="fa-solid fa-chevron-down expand-chevron"></i>
                </div>
                
                <div class="docker-card-details" onclick="event.stopPropagation()">
                    <div class="docker-status-header" style="border: none; padding: 0;">
                        <div class="docker-badges" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <span class="docker-badge ${statusClass === 'success' ? 'running' : statusClass}">${escapeHtml(status)}</span>
                            ${metadata.core_version ? `<span class="docker-badge" style="background: hsla(220,15%,20%,0.6); color: var(--text-secondary); text-transform:none; border:1px solid var(--border-card);">Core: v${escapeHtml(metadata.core_version)}</span>` : ''}
                            ${metadata.os_version ? `<span class="docker-badge" style="background: hsla(220,15%,20%,0.6); color: var(--text-secondary); text-transform:none; border:1px solid var(--border-card);">OS: v${escapeHtml(metadata.os_version)}</span>` : ''}
                        </div>
                    </div>
                    
                    <p class="timestamp-label" style="font-weight: 600; color: var(--text-primary); margin: 0; margin-top:0.25rem;">${escapeHtml(message)}</p>
                    
                    ${metricsHtml}
                    ${updatesHtml}
                    ${repairsHtml}
                    
                    <div class="timestamp-label" style="margin-top:0.5rem; font-size:0.75rem;">Error / Warning Logs</div>
                    <div class="docker-log-panel" id="system-log-panel-${id}" style="font-family: monospace; font-size:0.75rem; white-space:pre-wrap; word-break:break-all; max-height:160px; height:160px;">${escapeHtml(logs)}</div>
                    
                    <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.75rem;">
                        <button class="btn btn-secondary" onclick="triggerSystemSingleProbe('${id}')" id="btn-system-probe-${id}" style="font-size: 0.75rem; padding: 0.4rem 0.75rem; flex-grow: 1;">
                            <i class="fa-solid fa-arrows-rotate"></i> Check Health Now
                        </button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
        
        const timeLabel = document.getElementById('systems-last-checked');
        if (timeLabel) {
            if (latestTime) {
                timeLabel.textContent = `Last checked: ${formatDate(latestTime.toISOString())}`;
            } else {
                timeLabel.textContent = 'Last checked: Never';
            }
        }
        
    } catch(err) {
        container.innerHTML = `<p class="meta-text" style="grid-column: 1 / -1; text-align: center; color: var(--color-failed); padding: 2rem;">Error loading remote systems: ${escapeHtml(err.message)}</p>`;
    }
}

async function triggerSystemsProbe() {
    const btn = document.getElementById('btn-probe-systems');
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
    
    try {
        await fetch(`${API_BASE}/api/systems/home_assistant/probe`, { method: 'POST' });
        setTimeout(async () => {
            await loadSystemsStatus();
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Check All Now';
        }, 3000);
    } catch(err) {
        alert("Failed to probe remote systems: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Check All Now';
    }
}

async function triggerSystemSingleProbe(systemId) {
    const btn = document.getElementById(`btn-system-probe-${systemId}`);
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Probing...';
    
    try {
        await fetch(`${API_BASE}/api/systems/${systemId}/probe`, { method: 'POST' });
        setTimeout(async () => {
            await loadSystemsStatus();
        }, 3000);
    } catch(err) {
        alert("Failed to probe system: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Check Health Now';
    }
}

// Initial Bootstrap load
window.addEventListener('DOMContentLoaded', () => {
    refreshDashboardData();
    
    // Auto-refresh active panel data every 10 seconds (skip if any active AI diagnostics is running)
    setInterval(() => {
        if (activeAnalyses.size > 0) return;
        if (currentTab === 'dashboard') {
            loadBackupStatuses();
        } else if (currentTab === 'docker') {
            loadDockerStatus();
        } else if (currentTab === 'systems') {
            loadSystemsStatus();
        }
    }, 10000);
});
