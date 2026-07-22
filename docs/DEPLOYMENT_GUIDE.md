# 🚀 Artha AI 2.0 — Production Deployment Guide

This guide outlines the step-by-step instructions for deploying **Artha AI 2.0** to production cloud environments (AWS EC2, DigitalOcean, Hetzner, or any Linux VPS).

---

## 🐋 Option 1: Docker Compose Deployment (Recommended)

The simplest, most reliable way to launch Artha AI in production using containerization.

### Prerequisites
- Linux Server (Ubuntu 22.04 LTS / 24.04 LTS recommended, min 2GB RAM)
- Docker & Docker Compose installed (`docker --version` >= 24.0)

### Step 1: Clone Repository & Setup Environment
```bash
git clone https://github.com/your-org/artha-ai-copilot.git
cd artha-ai-copilot

# Copy production env template
cp .env.production.example .env.production
nano .env.production  # Fill in your production credentials
```

### Step 2: Build and Launch Containers
```bash
docker compose --env-file .env.production up -d --build
```

### Step 3: Verify Container Health
```bash
docker compose ps
docker compose logs -f api
```

Health check URLs:
- **API Health**: `http://<YOUR_SERVER_IP>:4000/api/health`
- **Frontend App**: `http://<YOUR_SERVER_IP>:80/`

---

## ⚡ Option 2: PM2 & Nginx Deployment (Bare Metal / VPS)

Used for maximum performance directly on host OS without Docker overhead.

### Step 1: Install Node.js 20 & PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

### Step 2: Build & Start API Service
```bash
npm ci
npm run build --workspace=apps/api

# Start via PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### Step 3: Serve Frontend & Configure Nginx SSL
```bash
npm run build --workspace=apps/web
sudo cp -r apps/web/dist/* /var/www/html/

# Obtain SSL Certificate via Let's Encrypt
sudo certbot --nginx -d artha-ai.yourdomain.com
```

---

## 🛡️ Production Hardening Checklist

| Task | Status | Notes |
|---|---|---|
| **Health Check Monitored** | ✅ | Automated 30s liveness ping on `/api/health` |
| **Gzip & Brotli Compression** | ✅ | Enabled in Nginx container for fast asset loading |
| **Security Headers** | ✅ | HSTS, X-Frame-Options, X-Content-Type-Options active |
| **SSE / WebSocket Proxying** | ✅ | No-buffering proxy configured for `/api/signals/stream` |
| **Persistent SQLite Data** | ✅ | Volume mounted to `apps/api/data/artha_db.json` |
| **Auto-Restart Policy** | ✅ | Docker `restart: always` / PM2 `autorestart: true` |

---

## 📊 Useful Maintenance Commands

- **View Live API Logs**: `docker logs -f artha-api` or `pm2 logs artha-api`
- **Trigger Emergency Recovery**: `POST http://localhost:4000/api/system/recovery`
- **Inspect DB Health History**: `GET http://localhost:4000/api/system/health`
