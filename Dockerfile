FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if any are needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend code
COPY backend/ /app/backend/

# Copy frontend assets
COPY frontend/ /app/frontend/

# Set working directory to backend folder so relative paths (../frontend) match correctly
WORKDIR /app/backend

# Create environment variable defaults
RUN mkdir -p /app/data
ENV PORT=8080
ENV LOG_DIR_SYSLOG=/app/logs/syslog
ENV LOG_DIR_DUPLICACY=/app/logs/duplicacy
ENV LOG_DIR_RSYNC=/app/logs/rsync
ENV DB_PATH=/app/data/sentinel.db

EXPOSE 8080

CMD ["python", "main.py"]
