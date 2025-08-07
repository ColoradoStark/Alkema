FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for PostgreSQL and image processing
RUN apt-get update && \
    apt-get install -y \
    gcc \
    libjpeg-dev \
    zlib1g-dev \
    libpq-dev \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Use Python startup script
CMD ["python", "startup.py"]