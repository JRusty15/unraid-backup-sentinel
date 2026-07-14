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
        
        const container = document.getElementById('backups-container');
        container.innerHTML = '';
        
        if (data.length === 0) {
            container.innerHTML = '<p class="meta-text" style="grid-column: 1 / -1; text-align: center; padding: 2rem;">No backups registered yet.</p>';
            return;
        }

        let systemHealth = 'healthy';
        
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
            } else if (id.toLowerCase().includes('duplicacy') || id.toLowerCase().includes('offsite')) {
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
            container.appendChild(card);
        });
        
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
        const diffMin = Math.floor(diffMs / 60000);
        const diffHrs = Math.floor(diffMin / 600);
        
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

// Initial Bootstrap load
window.addEventListener('DOMContentLoaded', () => {
    refreshDashboardData();
});
