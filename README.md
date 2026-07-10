# Unraid Backup & Log Sentinel

A self-hosted, premium dashboard designed for Unraid servers to monitor backups (rsync and Duplicacy) and perform AI-driven log analysis using Google Gemini.

---

## How to Run Locally (Preview Dashboard)

To see what the dashboard looks like on your local Windows PC, you can run it using **Docker Desktop**:

1.  Make sure you have **Docker Desktop** installed and running on your computer.
2.  Open your terminal/PowerShell in this directory.
3.  Run the following command:
    ```bash
    docker compose up --build
    ```
4.  Once the build completes, open your browser and navigate to:
    **`http://localhost:8080`**

### Mock Data & Offline Mode
When running locally, the project mounts the `./mock_logs/` folder to simulate your server syslog, Duplicacy runs, and Rsync actions.
*   The SQLite database (`sentinel.db`) is automatically initialized.
*   To preview the dashboard with pre-filled statuses, mock log entries, and a sample AI diagnostic report without needing a Gemini API key:
    1. Open terminal on your host or execute inside the container:
       ```bash
       docker exec -it unraid-backup-sentinel python verify.py
       ```
    2. Refresh your web browser page to load the mock indicators.

---

## Pushing to GitHub & Building Docker Image

We have set up a GitHub Actions workflow (`.github/workflows/docker-image.yml`) that builds and publishes a Docker image automatically to the free **GitHub Container Registry (GHCR)** whenever you push code.

### 1. Initialize Git and Push to your GitHub Repo
Run these commands in your local directory (replace your URL and username):

```bash
# Initialize git repository
git init -b main

# Add all project files
git add .
git commit -m "feat: initial commit of backup sentinel dashboard"

# Link to your new personal repository
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/unraid-backup-sentinel.git

# Push changes (triggers the GitHub Action)
git push -u origin main
```

### 2. Verify GitHub Packages
Once pushed, go to your GitHub account under **Repository -> Actions** to watch the build. When complete, the package will be available on your profile under **Packages** or your Repository front page.

*   Image URL format: `ghcr.io/your_github_username/unraid-backup-sentinel:latest`
*   *Note: In GHCR, package names are converted to lowercase.*

---

## Deploying on Unraid via GHCR Image

Once the GitHub Action builds the image, you do not need to compile anything on your Unraid server. You can pull the image directly.

Create a new **Docker Compose** stack on Unraid with this configuration:

```yaml
version: '3.8'

services:
  sentinel:
    # Point to your built GitHub Container Registry image (lowercase username)
    image: ghcr.io/YOUR_GITHUB_USERNAME/unraid-backup-sentinel:latest
    container_name: unraid-backup-sentinel
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
      - LOG_DIR_SYSLOG=/app/logs/syslog
      - LOG_DIR_DUPLICACY=/app/logs/duplicacy
      - LOG_DIR_RSYNC=/app/logs/rsync
      - HEARTBEAT_RSYNC_HOURS=26
      - HEARTBEAT_DUPLICACY_HOURS=26
      - DB_PATH=/app/backend/sentinel.db
    volumes:
      # Bind-mount host files for read-only log auditing
      - /var/log:/app/logs/syslog:ro
      - /mnt/user/appdata/duplicacy/logs:/app/logs/duplicacy:ro
      - /mnt/user/appdata/unraid-backup-sentinel/logs:/app/logs/rsync:ro
      # Persist the internal dashboard state/DB on your array/appdata cache
      - /mnt/user/appdata/unraid-backup-sentinel/data:/app/backend
```

Run the compose project on Unraid, and the server will run using the compiled image.
