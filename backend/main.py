import os
import sqlite3
import datetime
import asyncio
import logging
from typing import Optional, List, Dict
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("sentinel")

# Configuration Constants
DB_PATH = os.getenv("DB_PATH", "sentinel.db")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
LOG_DIR_SYSLOG = os.getenv("LOG_DIR_SYSLOG", "/app/logs/syslog")
LOG_DIR_DUPLICACY = os.getenv("LOG_DIR_DUPLICACY", "/app/logs/duplicacy")
LOG_DIR_RSYNC = os.getenv("LOG_DIR_RSYNC", "/app/logs/rsync")
PORT = int(os.getenv("PORT", "8080"))

# Heartbeat configuration (stale warning time in hours)
HEARTBEAT_RSYNC_HOURS = int(os.getenv("HEARTBEAT_RSYNC_HOURS", "26"))
HEARTBEAT_DUPLICACY_HOURS = int(os.getenv("HEARTBEAT_DUPLICACY_HOURS", "26"))

# Cost tracking constants (Gemini 1.5 Flash prices)
# Input: $0.075 / 1M tokens ($0.000000075 per token)
# Output: $0.30 / 1M tokens ($0.000000300 per token)
PRICE_INPUT_TOKEN = 0.000000075
PRICE_OUTPUT_TOKEN = 0.000000300

app = FastAPI(title="Unraid Backup & Log Sentinel")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic schemas
class BackupReport(BaseModel):
    id: str  # e.g., 'local_rsync', 'offsite_duplicacy'
    status: str  # 'success', 'failed', 'warning'
    message: Optional[str] = ""
    heartbeat_hours: Optional[int] = None
    log_content: Optional[str] = None

# Database helper functions
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS backups (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                last_run TEXT NOT NULL,
                message TEXT,
                heartbeat_hours INTEGER
            )
        """)
        
        # Migration for existing databases: add heartbeat_hours column
        try:
            conn.execute("ALTER TABLE backups ADD COLUMN heartbeat_hours INTEGER")
        except sqlite3.OperationalError:
            pass # Column already exists
            
        conn.execute("""
            CREATE TABLE IF NOT EXISTS analysis_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                report TEXT NOT NULL,
                status TEXT NOT NULL,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                cost REAL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS api_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                cost REAL
            )
        """)
        
        # Populate initial empty states if they don't exist
        for backup_id in ["local_rsync"]:
            cursor = conn.execute("SELECT 1 FROM backups WHERE id = ?", (backup_id,))
            if not cursor.fetchone():
                conn.execute(
                    "INSERT INTO backups (id, status, last_run, message, heartbeat_hours) VALUES (?, ?, ?, ?, ?)",
                    (backup_id, "unknown", datetime.datetime.now().isoformat(), "No backup reports received yet.", None)
                )
        conn.commit()
    logger.info("Database initialized successfully.")

# Helper to check if a backup has gone stale
def check_stale_status(last_run_str: str, max_hours: int) -> bool:
    try:
        last_run = datetime.datetime.fromisoformat(last_run_str)
        delta = datetime.datetime.now() - last_run
        return delta > datetime.timedelta(hours=max_hours)
    except Exception:
        return False

# Log Reader Utilities
def parse_syslog_line_date(line: str, current_year: int) -> Optional[datetime.datetime]:
    try:
        if len(line) < 15:
            return None
        date_str = line[:15]
        # Syslog month days can have double spaces (e.g. "Jul  9 12:00:00")
        # strptime handles multiple spaces automatically under %b %d
        dt = datetime.datetime.strptime(f"{current_year} {date_str}", "%Y %b %d %H:%M:%S")
        
        # Adjust year if it wraps around
        now = datetime.datetime.now()
        if dt > now + datetime.timedelta(days=1):
            dt = dt.replace(year=current_year - 1)
        return dt
    except Exception:
        return None

def get_syslog_last_24h() -> str:
    # Try looking for syslog files in LOG_DIR_SYSLOG
    # Could be named syslog, syslog.1, or /var/log/syslog directly
    syslog_paths = [
        os.path.join(LOG_DIR_SYSLOG, "syslog"),
        "/var/log/syslog",
        "/var/log/messages"
    ]
    
    syslog_file = None
    for path in syslog_paths:
        if os.path.exists(path) and os.path.isfile(path):
            syslog_file = path
            break
            
    if not syslog_file:
        logger.warning("Syslog file not found. Checked: %s", syslog_paths)
        return "Syslog file not found."

    now = datetime.datetime.now()
    cutoff = now - datetime.timedelta(hours=24)
    lines_collected = []
    
    try:
        with open(syslog_file, "r", encoding="utf-8", errors="ignore") as f:
            # We read from the end or just read all if the file is small.
            # For simplicity and robust parsing, read lines and filter.
            # If the syslog is huge, reading all might take memory, so let's limit to last 20,000 lines first.
            all_lines = f.readlines()
            recent_lines = all_lines[-20000:]
            
            for line in recent_lines:
                dt = parse_syslog_line_date(line, now.year)
                if dt and dt >= cutoff:
                    lines_collected.append(line.strip())
                    
        return "\n".join(lines_collected) if lines_collected else "No syslog entries found in the last 24 hours."
    except Exception as e:
        logger.error("Error reading syslog: %s", e)
        return f"Error reading syslog: {str(e)}"

def get_duplicacy_recent_logs() -> str:
    # List files in the duplicacy log folder
    if not os.path.exists(LOG_DIR_DUPLICACY):
        logger.warning("Duplicacy log directory not found at: %s", LOG_DIR_DUPLICACY)
        return "Duplicacy log directory not found."
        
    try:
        # Check if a 'backup' subdirectory exists (standard for Duplicacy Web Edition detailed run logs)
        search_dir = LOG_DIR_DUPLICACY
        backup_sub = os.path.join(LOG_DIR_DUPLICACY, "backup")
        if os.path.exists(backup_sub) and os.path.isdir(backup_sub):
            search_dir = backup_sub
            
        log_files = []
        for f in os.listdir(search_dir):
            full_path = os.path.join(search_dir, f)
            if os.path.isfile(full_path) and f.endswith(".log"):
                log_files.append((full_path, os.path.getmtime(full_path)))
                
        # Fall back to root directory if no files are found in backup subfolder
        if not log_files and search_dir != LOG_DIR_DUPLICACY:
            search_dir = LOG_DIR_DUPLICACY
            for f in os.listdir(search_dir):
                full_path = os.path.join(search_dir, f)
                if os.path.isfile(full_path) and f.endswith(".log"):
                    log_files.append((full_path, os.path.getmtime(full_path)))

        if not log_files:
            return "No Duplicacy log files found."
            
        # Sort by modification time descending
        log_files.sort(key=lambda x: x[1], reverse=True)
        
        # Read the latest 3 log files to capture multiple parallel/sequential backup jobs
        recent_logs_content = []
        for i in range(min(3, len(log_files))):
            file_path = log_files[i][0]
            logger.info("Reading Duplicacy log: %s", file_path)
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                # Truncate each content to 15k chars to fit context nicely
                if len(content) > 15000:
                    content = "[TRUNCATED...]\n" + content[-15000:]
                recent_logs_content.append(f"--- File: {os.path.basename(file_path)} ---\n{content}")
                
        return "\n\n".join(recent_logs_content)
    except Exception as e:
        logger.error("Error reading Duplicacy logs: %s", e)
        return f"Error reading Duplicacy logs: {str(e)}"

def get_rsync_recent_logs() -> str:
    # Rsync logs can be a file or multiple files in a directory
    rsync_file = None
    if os.path.isfile(LOG_DIR_RSYNC):
        rsync_file = LOG_DIR_RSYNC
    elif os.path.isdir(LOG_DIR_RSYNC):
        # Look for rsync.log or latest log file
        log_files = []
        for f in os.listdir(LOG_DIR_RSYNC):
            full_path = os.path.join(LOG_DIR_RSYNC, f)
            if os.path.isfile(full_path) and (f.endswith(".log") or f == "rsync"):
                log_files.append((full_path, os.path.getmtime(full_path)))
        if log_files:
            log_files.sort(key=lambda x: x[1], reverse=True)
            rsync_file = log_files[0][0]
            
    if not rsync_file or not os.path.exists(rsync_file):
        logger.warning("Rsync log file not found. Checked path: %s", LOG_DIR_RSYNC)
        return "Rsync log file not found."
        
    try:
        logger.info("Reading Rsync log: %s", rsync_file)
        with open(rsync_file, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            # Grab the last 500 lines of the rsync run
            recent_lines = lines[-500:]
            return f"--- File: {os.path.basename(rsync_file)} ---\n" + "".join(recent_lines)
    except Exception as e:
        logger.error("Error reading Rsync logs: %s", e)
        return f"Error reading Rsync logs: {str(e)}"

# Core AI Analysis Runner
async def run_log_analysis():
    logger.info("Starting log analysis job...")
    
    # 1. Gather all logs
    syslog_data = get_syslog_last_24h()
    duplicacy_data = get_duplicacy_recent_logs()
    rsync_data = get_rsync_recent_logs()
    
    # Pre-filter syslog data to reduce tokens and only include errors/warnings
    syslog_lines = syslog_data.split("\n")
    filtered_syslog_lines = []
    keywords = ["error", "fail", "warn", "critical", "disk", "sector", "oom", "timeout", "abort", "unclean", "btrfs", "xfs", "ata"]
    for line in syslog_lines:
        lower_line = line.lower()
        if any(kw in lower_line for kw in keywords):
            filtered_syslog_lines.append(line)
            
    filtered_syslog = "\n".join(filtered_syslog_lines)
    if not filtered_syslog:
        filtered_syslog = "No error/warning log entries found in Syslog."
    elif len(filtered_syslog) > 40000:
        filtered_syslog = "[TRUNCATED...]\n" + filtered_syslog[-40000:]
        
    # 2. Query Gemini API
    if not GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY is not set. Generating a mock analysis report.")
        mock_report = """# AI Health Sentinel Report (MOCK - API Key Missing)
        
> [!WARNING]
> Gemini API key is missing. This is a placeholder report using local rule checks.

## Backup Review
*   **Local Rsync Backup:** Appears active (last updated recently).
*   **Offsite Duplicacy Backup:** Appears active.

## Syslog Analysis
*   No raw drive read/write sector failures detected in local check logs.
*   Please provide a `GEMINI_API_KEY` in environment variables to enable full AI diagnostics.
"""
        with get_db() as conn:
            conn.execute(
                "INSERT INTO analysis_history (timestamp, report, status, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)",
                (datetime.datetime.now().isoformat(), mock_report, "warning", 0, 0, 0.0)
            )
            conn.commit()
        return

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        prompt = f"""
        You are an expert Unraid server administrator and storage engineer.
        Analyze the logs below and provide a concise, high-impact report on the server health and backup status.
        
        --- UNRAID SYSLOG (LAST 24 HOURS - FILTERED FOR ISSUES) ---
        {filtered_syslog}
        
        --- RECENT DUPLICACY OFFSITE BACKUP LOG ---
        {duplicacy_data}
        
        --- RECENT LOCAL RSYNC BACKUP LOG ---
        {rsync_data}
        
        --- REPORT FORMAT GUIDELINES ---
        Use markdown. Keep lines short and easily readable. 
        Start with a clean header: "# AI Health Sentinel Report" followed by a Github-style alert box summarising overall status:
        - Use "> [!NOTE]" if everything is completely healthy.
        - Use "> [!WARNING]" if there are minor issues or warnings.
        - Use "> [!CAUTION]" if there are critical errors, failed backups, or disk failure warnings.
        
        Organize sections:
        ## Executive Summary
        A short 2-3 sentence summary of current system health and backup status.
        
        ## Backup Status Details
        Brief details about the local rsync and offsite Duplicacy backups. Were they successful? Did you spot any timeouts or file locks?
        
        ## Server & Disk Health Diagnostics
        Look closely at the Syslog. Identify any drive issues (e.g., read/write errors, CRC error counts, ATA bus resets, BTRFS/XFS file system corruptions).
        
        ## Recommendations
        Bullet points of exact fixes if any warnings or errors are found. Keep it action-oriented.
        """
        
        # Call Gemini model
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        
        report_text = response.text or "Error: Gemini returned empty content."
        
        # Token usage and cost tracking
        prompt_tokens = 0
        completion_tokens = 0
        if response.usage_metadata:
            prompt_tokens = response.usage_metadata.prompt_token_count or 0
            completion_tokens = response.usage_metadata.candidates_token_count or 0
            
        cost = (prompt_tokens * PRICE_INPUT_TOKEN) + (completion_tokens * PRICE_OUTPUT_TOKEN)
        
        # Determine status of the report
        status = "healthy"
        if "![CAUTION]" in report_text or "caution" in report_text.lower() or "critical" in report_text.lower():
            status = "critical"
        elif "![WARNING]" in report_text or "warning" in report_text.lower():
            status = "warning"
            
        timestamp = datetime.datetime.now().isoformat()
        
        # Log to Database
        with get_db() as conn:
            conn.execute(
                "INSERT INTO analysis_history (timestamp, report, status, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)",
                (timestamp, report_text, status, prompt_tokens, completion_tokens, cost)
            )
            conn.execute(
                "INSERT INTO api_usage (timestamp, action, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?)",
                (timestamp, "Daily Log Analysis", prompt_tokens, completion_tokens, cost)
            )
            conn.commit()
            
        logger.info("Log analysis completed successfully. Tokens: In=%d, Out=%d. Cost: $%f", prompt_tokens, completion_tokens, cost)
        
    except Exception as e:
        logger.error("Failed to run Gemini analysis: %s", e)
        error_report = f"# AI Health Sentinel Report (Failed)\n\nAn error occurred while calling the Gemini API:\n```\n{str(e)}\n```"
        with get_db() as conn:
            conn.execute(
                "INSERT INTO analysis_history (timestamp, report, status, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)",
                (datetime.datetime.now().isoformat(), error_report, "failed", 0, 0, 0.0)
            )
            conn.commit()

# Hourly background checker
async def start_background_loop():
    logger.info("Starting background scheduler loop...")
    await asyncio.sleep(5) # Let DB initialize
    while True:
        try:
            now = datetime.datetime.now()
            # 1. Look up last analysis run
            with get_db() as conn:
                cursor = conn.execute("SELECT timestamp FROM analysis_history ORDER BY id DESC LIMIT 1")
                row = cursor.fetchone()
                
            run_needed = False
            if not row:
                run_needed = True
            else:
                last_run = datetime.datetime.fromisoformat(row["timestamp"])
                # Run if last run is older than 24 hours
                if now - last_run >= datetime.timedelta(hours=24):
                    run_needed = True
                    
            if run_needed:
                logger.info("Scheduler triggered automatic daily log analysis.")
                await run_log_analysis()
                
        except Exception as e:
            logger.error("Error in background loop: %s", e)
            
        await asyncio.sleep(3600) # Check hourly

# API Endpoints
@app.post("/api/report")
def receive_report(report: BackupReport):
    if report.status not in ["success", "failed", "warning"]:
        raise HTTPException(status_code=400, detail="Invalid status. Use 'success', 'failed', or 'warning'.")
        
    timestamp = datetime.datetime.now().isoformat()
    
    with get_db() as conn:
        # Fetch existing record to check heartbeat_hours
        cursor = conn.execute("SELECT heartbeat_hours FROM backups WHERE id = ?", (report.id,))
        row = cursor.fetchone()
        existing_heartbeat = row["heartbeat_hours"] if row else None
        
        heartbeat_to_save = report.heartbeat_hours if report.heartbeat_hours is not None else existing_heartbeat
        
        conn.execute(
            "INSERT OR REPLACE INTO backups (id, status, last_run, message, heartbeat_hours) VALUES (?, ?, ?, ?, ?)",
            (report.id, report.status, timestamp, report.message, heartbeat_to_save)
        )
        conn.commit()
        
    # Write pushed log content to file
    if report.log_content:
        try:
            os.makedirs(LOG_DIR_RSYNC, exist_ok=True)
            log_filename = f"{report.id}.log" if report.id == "local_rsync" else f"rsync_{report.id}.log"
            log_filepath = os.path.join(LOG_DIR_RSYNC, log_filename)
            with open(log_filepath, "w", encoding="utf-8") as f:
                f.write(report.log_content)
            logger.info("Saved pushed log content for %s to %s", report.id, log_filepath)
        except Exception as e:
            logger.error("Failed to save pushed log content for %s: %s", report.id, e)
            
    logger.info("Received backup report for %s: %s", report.id, report.status)
    return {"message": "Report received successfully", "id": report.id, "status": report.status, "timestamp": timestamp}

@app.get("/api/status")
def get_status():
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM backups")
        backups = [dict(row) for row in cursor.fetchall()]
        
    # Check if any backup status should be considered stale
    for b in backups:
        # Determine which heartbeat to use (record level first, then env level default)
        hb_hours = b.get("heartbeat_hours")
        if hb_hours is None:
            if b["id"] == "local_rsync":
                hb_hours = HEARTBEAT_RSYNC_HOURS
            else:
                hb_hours = HEARTBEAT_DUPLICACY_HOURS
                
        is_stale = check_stale_status(b["last_run"], hb_hours)
        if is_stale and b["status"] != "failed":
            b["status"] = "stale"
            b["message"] = f"Warning: No backup reports received in the last {hb_hours} hours."
            
    return backups

@app.get("/api/analysis")
def get_latest_analysis():
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM analysis_history ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        
    if not row:
        return {"report": "No AI Analysis reports run yet.", "timestamp": None, "status": "unknown"}
    return dict(row)

@app.post("/api/analysis/trigger")
def trigger_analysis(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_log_analysis)
    return {"message": "AI Log analysis triggered in background."}

@app.get("/api/logs")
def get_raw_logs(source: str):
    if source == "syslog":
        return {"content": get_syslog_last_24h()}
    elif source == "duplicacy":
        return {"content": get_duplicacy_recent_logs()}
    elif source == "rsync":
        return {"content": get_rsync_recent_logs()}
    else:
        raise HTTPException(status_code=400, detail="Invalid log source.")

@app.get("/api/usage")
def get_usage():
    with get_db() as conn:
        # Get total costs and token usage
        cursor = conn.execute("SELECT SUM(prompt_tokens) as total_prompt_tokens, SUM(completion_tokens) as total_completion_tokens, SUM(cost) as total_cost FROM api_usage")
        totals = dict(cursor.fetchone())
        
        # Get monthly usage
        cursor_monthly = conn.execute("""
            SELECT strftime('%Y-%m', timestamp) as month, 
                   SUM(prompt_tokens) as prompt_tokens, 
                   SUM(completion_tokens) as completion_tokens, 
                   SUM(cost) as cost,
                   COUNT(*) as call_count
            FROM api_usage 
            GROUP BY month
            ORDER BY month DESC
        """)
        monthly = [dict(row) for row in cursor_monthly.fetchall()]
        
        # Get list of recent operations
        cursor_recent = conn.execute("SELECT * FROM api_usage ORDER BY id DESC LIMIT 50")
        recent = [dict(row) for row in cursor_recent.fetchall()]
        
    return {
        "totals": {
            "prompt_tokens": totals.get("total_prompt_tokens") or 0,
            "completion_tokens": totals.get("total_completion_tokens") or 0,
            "cost": totals.get("total_cost") or 0.0
        },
        "monthly": monthly,
        "recent": recent
    }

@app.post("/api/reset")
def reset_database():
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM backups")
            conn.execute("DELETE FROM analysis_history")
            conn.execute("DELETE FROM api_usage")
            conn.commit()
        init_db()
        logger.info("Database reset triggered via API.")
        return {"message": "Database reset successfully."}
    except Exception as e:
        logger.error("Failed to reset database: %s", e)
        raise HTTPException(status_code=500, detail=f"Database reset failed: {str(e)}")

# Start the background task scheduler upon startup
@app.on_event("startup")
async def on_startup():
    init_db()
    asyncio.create_task(start_background_loop())

# Serve static files for frontend
# Ensure frontend directory exists
os.makedirs("../frontend", exist_ok=True)
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Unraid Backup Sentinel Backend on port %d", PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
