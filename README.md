<div align="center">

# ATLAS

**Asset Tracking & Lifecycle Administration System**

A self-hosted, open-source IT Asset Management platform built for organizations that need full control over their hardware inventory, employee asset assignments, procurement workflows, and handover documentation — without depending on third-party SaaS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stack: Next.js + Fastify](https://img.shields.io/badge/Stack-Next.js%20%2B%20Fastify-black)](#tech-stack)
[![Database: PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2016-336791)](#tech-stack)
[![Runtime: Docker Compose](https://img.shields.io/badge/Runtime-Docker%20Compose-2496ED)](#quick-start)

</div>

---

## Table of Contents

- [What is ATLAS?](#what-is-atlas)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Authentication Modes](#authentication-modes)
- [Google Workspace Integration](#google-workspace-integration)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [API Overview](#api-overview)
- [Deployment Guide](#deployment-guide)
- [Nginx & HTTPS](#nginx--https)
- [Backup & Restore](#backup--restore)
- [Cron Jobs](#cron-jobs)
- [Ops Scripts Reference](#ops-scripts-reference)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## What is ATLAS?

ATLAS is a self-hosted **IT Asset Management (ITAM)** system originally built to replace a Google Apps Script-based workflow. It handles the full lifecycle of IT assets — from procurement requests through active assignments to handover and retirement — all in one place.

**ATLAS is for you if:**
- Your team manages hundreds or thousands of IT assets across multiple departments or accounts
- You need documented, auditable handover records (BAST / serah terima)
- You want procurement requests to flow through a structured approval and fulfillment pipeline
- You need to sync your employee directory from Google Workspace automatically
- You want everything on-prem inside your own network, not in someone else's cloud

---

## Features

| Module | Description |
|---|---|
| **Asset Registry** | Full asset inventory with tags, serial numbers, categories, specs, and ownership |
| **Handover / BAST** | Create, sign, and finalize asset handover documents with PDF generation |
| **Procurement** | Submit and track IT procurement requests with optional AI-assisted parsing |
| **Employee Directory** | Employee profiles linked to asset assignments, optionally synced from Google Workspace |
| **Catalog Management** | Maintain an approved catalog of IT items with SKUs, accounts, and price estimates |
| **Master Reference** | Shared reference data (locations, departments, asset types) used across modules |
| **Admin Portal** | User management, role assignments, workbook imports, system configuration |
| **Audit Log** | Every write action is recorded with actor, timestamp, and payload |
| **Google OAuth** | Optional login via Google Workspace corporate accounts with hosted domain restriction |
| **GWS Directory Sync** | Scheduled sync of employee data from Google Workspace Admin Directory API |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript |
| Backend API | Fastify, TypeScript, Prisma ORM |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Reverse Proxy | Nginx 1.27 |
| Runtime | Docker, Docker Compose |
| Auth | Session-based (local) + OAuth 2.0 (Google) |
| AI (optional) | Google Gemini API — procurement request parsing only |

---

## Architecture Overview

```
Browser
   │
   ▼
Nginx (port 80/443)
   ├──/api/*  ──▶  Fastify API  (port 4000)
   │                    │
   │              ┌─────┴──────┐
   │           PostgreSQL    Redis
   │
   └──/*  ──────▶  Next.js Web  (port 3000)
```

All four services run as Docker containers on a single host and communicate over an internal Docker network (`atlas_net`). Nothing is exposed to the host except Nginx on port 80 (and 443 if you add TLS).

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|---|---|---|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose Plugin | v2 | `docker compose version` |
| Linux host | Ubuntu 22.04+ recommended | Script provided for setup |
| RAM | 2 GB | 4 GB recommended for builds |
| Disk | 10 GB free | Logs and backups grow over time |

> **No Node.js required on the host.** All build and runtime processes happen inside Docker containers.

---

## Quick Start

### 1. Provision the host (first time only)

If you are starting from a fresh Ubuntu server, run the host bootstrap script as root:

```bash
sudo bash ops/install-host.sh
```

This installs Docker, configures UFW firewall (ports 22 and 80 open), and creates the `/var/www/ATLAS` directory.

### 2. Clone the repository

```bash
git clone https://github.com/rickopra/ATLAS.git /var/www/ATLAS
cd /var/www/ATLAS
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env   # or use your preferred editor
```

At minimum, fill in:
- `POSTGRES_PASSWORD` — strong random password
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_COOKIE_SECRET` — min 32 random characters each
- `APP_URL`, `APP_ORIGIN`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL` — your server's domain or IP
- `DEFAULT_ADMIN_EMAIL`, `LOCAL_SUPERADMIN_EMAIL`, `LOCAL_SUPERADMIN_PASSWORD`

See [Environment Variables](#environment-variables) for the full reference.

### 4. Deploy

```bash
bash ops/deploy.sh
```

This script:
1. Builds the Docker images
2. Starts PostgreSQL and Redis first
3. Runs Prisma migrations (`db:deploy`)
4. Starts the API, Web, and Nginx services
5. Polls the API health endpoint until ready

### 5. Log in

Open `http://your-server-ip` in a browser and sign in with the `LOCAL_SUPERADMIN_EMAIL` and `LOCAL_SUPERADMIN_PASSWORD` you set in `.env`.

---

## Environment Variables

All configuration lives in a single `.env` file at the repository root. Copy `.env.example` and fill in all `CHANGE_ME_*` values before first deploy.

### Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `production` | Runtime environment |
| `TZ` | No | `Asia/Jakarta` | Timezone for containers |
| `APP_URL` | **Yes** | — | Full public URL e.g. `https://atlas.yourdomain.com` |
| `APP_ORIGIN` | **Yes** | — | Same as `APP_URL` (used for CORS) |
| `NEXT_PUBLIC_APP_URL` | **Yes** | — | Baked into the Next.js build |
| `NEXT_PUBLIC_API_URL` | **Yes** | — | API base URL as seen from the browser |

### Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_DB` | No | `atlas` | Database name |
| `POSTGRES_USER` | No | `atlas_app` | Database user |
| `POSTGRES_PASSWORD` | **Yes** | — | Strong random password |
| `DATABASE_URL` | **Yes** | — | Prisma connection string — must match the three values above |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection string |

### Secrets

> Generate with: `openssl rand -base64 48`

| Variable | Required | Description |
|---|---|---|
| `JWT_ACCESS_SECRET` | **Yes** | Signs short-lived access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | **Yes** | Signs refresh tokens (min 32 chars) |
| `SESSION_COOKIE_SECRET` | **Yes** | Signs session cookies (min 32 chars) |

### Local Auth

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOCAL_AUTH_ENABLED` | No | `true` | Enable username/password login |
| `LOCAL_SUPERADMIN_EMAIL` | **Yes** | — | Email of the first admin account |
| `LOCAL_SUPERADMIN_NAME` | No | `Admin` | Display name |
| `LOCAL_SUPERADMIN_USERNAME` | No | — | Optional username (email used if blank) |
| `LOCAL_SUPERADMIN_PASSWORD` | **Yes** | — | Initial admin password |

### Google OAuth (optional)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_OAUTH_ENABLED` | No | `false` | Set `true` to enable Google login |
| `GOOGLE_CLIENT_ID` | If enabled | — | OAuth 2.0 Client ID from GCP Console |
| `GOOGLE_CLIENT_SECRET` | If enabled | — | OAuth 2.0 Client Secret |
| `GOOGLE_HOSTED_DOMAIN` | If enabled | `yourdomain.com` | Restrict login to this Google Workspace domain |
| `GOOGLE_CALLBACK_URL` | If enabled | — | Must be `https://atlas.yourdomain.com/api/auth/google/callback` |

### Google Workspace Directory Sync (optional)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_WORKSPACE_DIRECTORY_ENABLED` | No | `false` | Enable employee sync from GWS Admin API |
| `GOOGLE_WORKSPACE_DIRECTORY_PROJECT_ID` | If enabled | — | GCP project ID |
| `GOOGLE_WORKSPACE_DIRECTORY_SERVICE_ACCOUNT_EMAIL` | If enabled | — | Service account email |
| `GOOGLE_WORKSPACE_DIRECTORY_DELEGATED_ADMIN_EMAIL` | If enabled | — | Admin email for domain-wide delegation |
| `GOOGLE_WORKSPACE_DIRECTORY_KEY_FILE` | If enabled | — | Path to service account JSON key (e.g. `/var/www/ATLAS/secure/gws.json`) |

### AI / Gemini (optional)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | No | — | Google AI Studio API key — enables AI-assisted procurement parsing |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model to use |

---

## Authentication Modes

ATLAS supports two authentication modes that can be enabled simultaneously.

### Local Auth (default)

Username and password login. The superadmin account is bootstrapped automatically from `LOCAL_SUPERADMIN_*` environment variables on first startup. Additional users can be created through the Admin Portal.

No external dependencies required.

### Google OAuth

When `GOOGLE_OAUTH_ENABLED=true`, users can sign in with their Google Workspace account. Access is restricted to the `GOOGLE_HOSTED_DOMAIN` domain — accounts outside that domain are rejected.

**Setup steps:**
1. Go to [GCP Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add `https://atlas.yourdomain.com/api/auth/google/callback` as an authorized redirect URI
4. Copy the Client ID and Secret into `.env`
5. Set `GOOGLE_OAUTH_ENABLED=true`

> Both auth modes can run concurrently. Users can have accounts created locally or via OAuth.

---

## Google Workspace Integration

### Directory Sync

ATLAS can sync your Google Workspace employee list into the Employee Directory module. This runs as a scheduled cron job and keeps the local employee table up to date (names, emails, departments, titles).

**Setup steps:**
1. In GCP Console → IAM → Service Accounts, create a service account
2. Grant it **Read-only** access to the Admin SDK Directory API via domain-wide delegation
3. In Google Admin Console → Security → API Controls → Domain-wide delegation, authorize the service account with scope: `https://www.googleapis.com/auth/admin.directory.user.readonly`
4. Download the JSON key and place it in `secure/` (e.g. `secure/google-workspace-directory.json`)
5. Fill in `GOOGLE_WORKSPACE_DIRECTORY_*` variables in `.env`
6. Set `GOOGLE_WORKSPACE_DIRECTORY_ENABLED=true`
7. Install the cron job (see [Cron Jobs](#cron-jobs))

The `secure/` directory is gitignored and never committed. It is bind-mounted into the API container as read-only.

---

## Project Structure

```
ATLAS/
├── apps/
│   ├── api/                    # Fastify API server
│   │   ├── src/
│   │   │   ├── index.ts        # Server entry point, route registration
│   │   │   ├── auth.ts         # Auth middleware and session handling
│   │   │   ├── config.ts       # Environment variable schema and validation
│   │   │   ├── db.ts           # Prisma client singleton
│   │   │   ├── services/       # Business logic per module
│   │   │   │   ├── asset-list.ts
│   │   │   │   ├── handover-submit.ts
│   │   │   │   ├── procurement-submit.ts
│   │   │   │   ├── employee-directory.ts
│   │   │   │   ├── catalog-management.ts
│   │   │   │   ├── master-reference.ts
│   │   │   │   ├── new-po.ts
│   │   │   │   ├── google-workspace-directory.ts
│   │   │   │   └── atlas-parity.ts
│   │   │   └── scripts/
│   │   │       ├── import-workbook.ts       # Bulk import from Excel/CSV
│   │   │       └── sync-google-workspace-directory.ts
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Database schema
│   │   └── Dockerfile
│   └── web/                    # Next.js frontend
│       ├── app/
│       │   ├── page.tsx        # Main application shell (all modules)
│       │   ├── layout.tsx      # Root layout
│       │   ├── globals.css     # Global styles
│       │   ├── lib/
│       │   │   └── atlas-rpc.ts   # Typed API client
│       │   └── components/
│       │       ├── admin-portal.tsx
│       │       ├── handover-form.tsx
│       │       └── new-po-portal.tsx
│       └── Dockerfile
├── infra/
│   ├── nginx/
│   │   └── default.conf        # Nginx reverse proxy config
│   ├── cron/
│   │   └── atlas-stack.cron    # Cron job definitions
│   └── scripts/
│       ├── atlas-gws-employee-sync.sh   # GWS sync trigger with locking
│       └── atlas-stack-autostart.sh     # Stack autostart on boot
├── ops/
│   ├── install-host.sh         # One-time host bootstrap (Docker, UFW)
│   ├── deploy.sh               # Full build + deploy script
│   ├── backup-postgres.sh      # Database backup with rotation
│   └── import-workbook.sh      # Trigger workbook import inside container
├── docs/
│   ├── ATLAS_Handover_User_Guide.html      # End-user handover guide
│   └── ATLAS_Handover_User_Guide_Slides.html
├── secure/                     # Gitignored — place GCP service account keys here
├── docker-compose.yml
├── .env.example
└── package.json                # Root workspace (npm workspaces)
```

---

## Database Schema

ATLAS uses PostgreSQL with Prisma ORM. The schema is located at `apps/api/prisma/schema.prisma`.

### Core Models

| Model | Purpose |
|---|---|
| `User` | Application user accounts (local or OAuth) |
| `Role` | Roles: `admin`, `viewer`, `procurement`, etc. |
| `UserRole` | Many-to-many: users ↔ roles |
| `Session` | Server-side session storage |
| `Employee` | Employee directory, optionally synced from Google Workspace |
| `Asset` | Core asset registry — every physical IT item |
| `AssetRevision` | Full revision history for every asset change |
| `HandoverDocument` | Handover / BAST documents with status lifecycle |
| `HandoverItem` | Individual asset line items within a handover document |
| `ProcurementRequest` | Procurement requests through intake → fulfillment |
| `CatalogItem` | Approved IT catalog with SKUs and price estimates |
| `MasterReference` | Shared reference values (departments, asset types, etc.) |
| `MasterLocation` | Location and floor registry |
| `Supplier` | Vendor/supplier registry |
| `AuditLog` | Immutable write audit trail |
| `WorkbookImportBatch` | Tracks bulk import jobs |

### Running Migrations

```bash
# Apply all pending migrations (production)
docker compose exec api npm run db:deploy

# Generate and apply a new migration (development)
docker compose exec api npm run db:migrate -- --name your_migration_name

# Open Prisma Studio (visual database browser)
docker compose exec api npm run db:studio
```

---

## API Overview

The Fastify API is mounted at `/api/` through Nginx. All routes require authentication unless stated otherwise.

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Returns `{ status: "ok" }` |

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | No | Local login with email/password |
| `POST` | `/api/auth/logout` | Yes | Invalidate session |
| `GET` | `/api/auth/me` | Yes | Current user + roles |
| `GET` | `/api/auth/google` | No | Redirect to Google OAuth |
| `GET` | `/api/auth/google/callback` | No | OAuth callback |

### Assets

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/assets` | Yes | List assets with filters and pagination |
| `GET` | `/api/assets/:id` | Yes | Get single asset |
| `POST` | `/api/assets` | Yes | Create asset |
| `PATCH` | `/api/assets/:id` | Yes | Update asset fields |
| `DELETE` | `/api/assets/:id` | Yes | Soft-delete asset |

### Handover

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/handover` | Yes | List handover documents |
| `POST` | `/api/handover` | Yes | Create handover document |
| `GET` | `/api/handover/:id` | Yes | Get handover with items |
| `PATCH` | `/api/handover/:id/finalize` | Yes | Finalize and lock document |

### Procurement

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/procurement` | Yes | List procurement requests |
| `POST` | `/api/procurement` | Yes | Submit new request (with optional AI parsing) |
| `PATCH` | `/api/procurement/:id` | Yes | Update status or notes |

### Employees

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/employees` | Yes | List employees |
| `POST` | `/api/employees/sync` | Admin | Trigger Google Workspace sync |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/users` | Admin | List all users |
| `POST` | `/api/admin/users` | Admin | Create user |
| `PATCH` | `/api/admin/users/:id/roles` | Admin | Update user roles |
| `POST` | `/api/admin/import` | Admin | Trigger workbook import |

---

## Deployment Guide

### Initial Deploy

```bash
# 1. SSH into your server
ssh user@your-server-ip

# 2. Clone
git clone https://github.com/rickopra/ATLAS.git /var/www/ATLAS
cd /var/www/ATLAS

# 3. Configure
cp .env.example .env
nano .env

# 4. Deploy
bash ops/deploy.sh
```

### Redeploy After Code Changes

```bash
cd /var/www/ATLAS
git pull
bash ops/deploy.sh
```

`deploy.sh` rebuilds images, runs any new migrations, and restarts only changed containers.

### Check Service Status

```bash
docker compose ps
docker compose logs -f api     # Stream API logs
docker compose logs -f web     # Stream frontend logs
docker compose logs -f nginx   # Stream nginx logs
```

### Stop / Start

```bash
docker compose down       # Stop all services (data preserved in volumes)
docker compose up -d      # Start all services
```

---

## Nginx & HTTPS

The default Nginx config listens on port 80. For production, you should add TLS.

### Option A — Certbot (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d atlas.yourdomain.com
```

Certbot will modify `infra/nginx/default.conf` or your system nginx config automatically and set up auto-renewal.

### Option B — Existing certificate

Edit `infra/nginx/default.conf` to add a `server` block on port 443:

```nginx
server {
  listen 443 ssl;
  server_name atlas.yourdomain.com;

  ssl_certificate     /etc/ssl/certs/atlas.crt;
  ssl_certificate_key /etc/ssl/private/atlas.key;

  # ... same proxy_pass blocks as the port 80 config
}
```

Then expose port 443 in `docker-compose.yml`:

```yaml
nginx:
  ports:
    - "${NGINX_PORT}:80"
    - "443:443"
  volumes:
    - ./infra/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    - /etc/ssl:/etc/ssl:ro
```

After any nginx config change:

```bash
docker compose restart nginx
```

---

## Backup & Restore

### Automated Backup

`ops/backup-postgres.sh` dumps the database, compresses it with gzip, and keeps the last 14 backups (deleting older ones).

```bash
bash ops/backup-postgres.sh
```

Backups are saved to `backups/atlas-YYYYMMDD-HHMMSS.sql.gz`.

### Schedule Backups via Cron

```bash
# Add to crontab (runs daily at 02:00)
0 2 * * * /var/www/ATLAS/ops/backup-postgres.sh >> /var/www/ATLAS/infra/logs/backup.log 2>&1
```

### Restore from Backup

```bash
# Decompress and restore
gunzip -c backups/atlas-20260101-020000.sql.gz | \
  docker compose exec -T postgres psql -U atlas_app -d atlas
```

---

## Cron Jobs

Install the provided cron file to enable scheduled tasks:

```bash
sudo crontab -u root infra/cron/atlas-stack.cron
```

Included jobs:

| Schedule | Script | Purpose |
|---|---|---|
| `@reboot` | `atlas-stack-autostart.sh` | Start Docker stack after server reboot |
| Every hour | `atlas-gws-employee-sync.sh` | Sync employee directory from Google Workspace |

The sync script uses a lock directory to prevent overlapping runs.

---

## Ops Scripts Reference

| Script | Usage | Description |
|---|---|---|
| `ops/install-host.sh` | `sudo bash ops/install-host.sh` | Bootstrap a fresh Ubuntu server with Docker and UFW |
| `ops/deploy.sh` | `bash ops/deploy.sh` | Full build + migrate + start |
| `ops/backup-postgres.sh` | `bash ops/backup-postgres.sh` | Dump and compress the database |
| `ops/import-workbook.sh` | `bash ops/import-workbook.sh path/to/file.xlsx` | Import asset data from an Excel workbook |
| `infra/scripts/atlas-stack-autostart.sh` | (via cron) | Start stack on boot |
| `infra/scripts/atlas-gws-employee-sync.sh` | (via cron) | Trigger GWS employee sync |

---

## Upgrading

```bash
cd /var/www/ATLAS

# Pull latest code
git pull

# Rebuild and apply migrations
bash ops/deploy.sh
```

Prisma migrations are applied automatically by `deploy.sh` before services restart. If a migration fails, the deploy stops before touching running containers.

---

## Troubleshooting

### Containers won't start

```bash
docker compose logs postgres   # Check DB startup errors
docker compose logs api        # Check API startup / migration errors
```

Common causes:
- Wrong `DATABASE_URL` — must match `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- Missing required env vars — check `apps/api/src/config.ts` for the full schema

### API returns 502 Bad Gateway

The API container may not be healthy yet. Check:

```bash
docker compose ps              # Is the api container healthy?
docker compose logs api        # Any crash logs?
```

### Database migration failed

```bash
docker compose run --rm api npm run db:deploy
```

If the schema is out of sync after a forced reset:

```bash
docker compose run --rm api npm run db:push --force-reset
```

> ⚠️ `--force-reset` drops all data. Use only on a fresh instance or after restoring from backup.

### Google OAuth not working

- Confirm `GOOGLE_OAUTH_ENABLED=true` in `.env`
- Confirm the callback URL in GCP matches exactly: `https://atlas.yourdomain.com/api/auth/google/callback`
- Check that the user's email domain matches `GOOGLE_HOSTED_DOMAIN`

### Gemini AI parsing not working

- `GEMINI_API_KEY` must be set in `.env`
- The API key must have access to the Gemini API (enable at [aistudio.google.com](https://aistudio.google.com))
- Disable by leaving `GEMINI_API_KEY` blank — procurement still works without it, just without AI parsing

### View all container resource usage

```bash
docker stats
```

---

## Contributing

Contributions are welcome. To contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m "feat: describe your change"`
4. Push to your fork: `git push origin feat/your-feature`
5. Open a Pull Request against `main`

**Commit message convention:** `type: description` where type is one of `feat`, `fix`, `chore`, `docs`, `refactor`.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

Built with care for IT teams who prefer to own their own tools.

</div>
