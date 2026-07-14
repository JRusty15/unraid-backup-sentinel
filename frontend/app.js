// Frontend logic for Unraid Backup & Log Sentinel

// State variables
let currentTab = 'dashboard';
const API_BASE = ''; // Same host

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
    if (!unsafe) return "";
    return unsafe
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

        let systemHealth = 'healthy';
        let rsyncCount = 0;
        let duplicacyCount = 0;
        let otherCount = 0;
        
        data.forEach(backup => {
            const id = backup.id;
            const status = backup.status.toLowerCase();
            const lastRun = backup.last_run;
            const message = backup.message || 'No message provided.';
            
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
                        <p class="message-value" id="${id}-message" title="${escapeHtml(message)}">${escapeHtml(message)}</p>
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
            } else if (apiHealth === 'unresponsive' || status === 'error') {
                statusClass = 'warning';
                iconClass = 'fa-solid fa-circle-exclamation';
                iconColor = 'var(--color-warning)';
            }
            
            const offset = (statusClass === 'unknown') ? '314' : '0';
            const card = document.createElement('div');
            card.className = 'card status-card docker-card';
            card.innerHTML = `
                <div class="docker-status-header">
                    <h3 style="margin: 0; font-size: 1.1rem;">${escapeHtml(name)}</h3>
                    <div class="docker-badges">
                        <span class="docker-badge ${status}">${escapeHtml(status)}</span>
                        <span class="docker-badge ${apiHealth}">${escapeHtml(apiHealth)}</span>
                    </div>
                </div>
                
                <div class="card-body status-body" style="padding: 0; flex-grow: 0;">
                    <div class="ring-container">
                        <svg class="status-ring" viewBox="0 0 120 120">
                            <circle class="ring-bg" cx="60" cy="60" r="50" />
                            <circle class="ring-fg ${statusClass}" cx="60" cy="60" r="50" style="stroke-dashoffset: ${offset};" />
                        </svg>
                        <div class="ring-inner">
                            <i class="${iconClass} status-icon" style="color: ${iconColor};"></i>
                        </div>
                    </div>
                    <div class="status-details">
                        <p class="timestamp-label" style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">${escapeHtml(message)}</p>
                        <div class="docker-meta">
                            <span><i class="fa-solid fa-link" style="width: 14px; font-size: 0.75rem;"></i> Connection: ${escapeHtml(hostIp)}:${port}</span>
                            <span><i class="fa-solid fa-box" style="width: 14px; font-size: 0.75rem;"></i> Container: ${escapeHtml(cName)}</span>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%;">
                    <button class="docker-log-toggle" id="btn-toggle-${id}" onclick="toggleDockerLogs('${id}')">
                        <i class="fa-solid fa-terminal"></i> Show Container Logs
                    </button>
                    <div class="docker-log-panel" id="log-panel-${id}">${escapeHtml(logs)}</div>
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

// Toggle raw container logs display in cards
function toggleDockerLogs(serviceId) {
    const panel = document.getElementById(`log-panel-${serviceId}`);
    const btn = document.getElementById(`btn-toggle-${serviceId}`);
    if (!panel || !btn) return;
    
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        btn.innerHTML = '<i class="fa-solid fa-terminal"></i> Show Container Logs';
        btn.classList.remove('active');
    } else {
        panel.style.display = 'block';
        btn.innerHTML = '<i class="fa-solid fa-terminal"></i> Hide Container Logs';
        btn.classList.add('active');
        panel.scrollTop = panel.scrollHeight; 
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

// Initial Bootstrap load
window.addEventListener('DOMContentLoaded', () => {
    refreshDashboardData();
});
