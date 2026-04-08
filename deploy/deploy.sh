#!/bin/bash
set -e

REPO_DIR="/home/ubuntu/Alkema-Backend"

echo "=== Deploying Alkema ==="

# Pull latest code
cd "$REPO_DIR"
git pull origin master

# Build and restart containers
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Reload Caddy to pick up any config changes
docker exec wordpress-mega-merger_caddy_1 caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true

echo "=== Deploy complete ==="
docker-compose -f docker-compose.prod.yml ps
