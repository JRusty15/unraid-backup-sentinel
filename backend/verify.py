import sqlite3
import datetime
import os

def populate_mock_data():
    db_path = os.getenv("DB_PATH", "sentinel.db")
    print(f"Populating database: {db_path}")
    
    conn = sqlite3.connect(db_path)
    
    # Ensure tables exist
    conn.execute("""
        CREATE TABLE IF NOT EXISTS backups (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            last_run TEXT NOT NULL,
            message TEXT
        )
    """)
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

    # Clear old data for verification run
    conn.execute("DELETE FROM backups")
    conn.execute("DELETE FROM analysis_history")
    conn.execute("DELETE FROM api_usage")

    # Insert mock backup data
    conn.execute("INSERT OR REPLACE INTO backups (id, status, last_run, message) VALUES (?, ?, ?, ?)",
                 ("local_rsync", "warning", (datetime.datetime.now() - datetime.timedelta(hours=2)).isoformat(), 
                  "Rsync completed but warnings were reported (partial transfer code 23)."))
    
    conn.execute("INSERT OR REPLACE INTO backups (id, status, last_run, message) VALUES (?, ?, ?, ?)",
                 ("offsite_duplicacy", "success", (datetime.datetime.now() - datetime.timedelta(hours=4)).isoformat(), 
                  "Backup successfully completed. Revision 42, transferred 45.2 GB."))
    
    # Insert mock API usage logs
    conn.execute("INSERT INTO api_usage (timestamp, action, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?)",
                 ((datetime.datetime.now() - datetime.timedelta(hours=2)).isoformat(), "Daily Log Analysis", 1200, 350, 0.000195))
    conn.execute("INSERT INTO api_usage (timestamp, action, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?)",
                 ((datetime.datetime.now() - datetime.timedelta(days=1)).isoformat(), "Daily Log Analysis", 1150, 290, 0.0001733))
    
    # Insert mock analysis report
    report = """# AI Health Sentinel Report

> [!WARNING]
> Minor warnings detected during backup synchronization. The storage array is stable but has triggered warnings.

## Executive Summary
All backup routines ran in the last 24 hours. The local Rsync backup completed with a partial transfer status warning (code 23). The offsite Duplicacy backup ran successfully. Storage integrity shows a single I/O reference block warning which needs observation.

## Backup Status Details
*   **Local Rsync Backup:** Finished with warning status. Exit code 23 indicates some files or attributes could not be transferred. This is often caused by locked files, temporary system locks, or permissions mismatch on target shares.
*   **Offsite Duplicacy Backup:** Completed successfully. Transferred 45.2 GB in 5m34s. Revision 42 created.

## Server & Disk Health Diagnostics
*   **Drive Health:** Unraid syslog reports a BTRFS error on disk `sdc1` (`btrfs_run_delayed_refs:2145: errno=-5 IO failure`). While the recovery thread finished parity sync successfully, IO failures are early indicators of disk or cable problems.

## Recommendations
1.  **Check Rsync Mappings:** Inspect file permissions on the target share or ensure files are not in use during the backup window.
2.  **Monitor sdc1 SATA Connection:** The BTRFS IO failure on `sdc1` is a warning. Check your Unraid dashboard for SMART errors on `sdc1`. Consider replacing the SATA cable if CRC errors start accumulating.
"""
    conn.execute("INSERT INTO analysis_history (timestamp, report, status, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)",
                 ((datetime.datetime.now() - datetime.timedelta(hours=2)).isoformat(), report, "warning", 2350, 640, 0.000368))
    conn.commit()
    conn.close()
    print("Verification data populated successfully.")

if __name__ == "__main__":
    populate_mock_data()
