# ATLAS On-Prem Platform

Production-oriented monorepo for migrating ATLAS from Google Apps Script to an on-prem stack.

## Stack

- Frontend: Next.js 15 + React 19 + TypeScript
- API: Fastify + TypeScript + Prisma
- Database: PostgreSQL 16
- Cache / queue-ready: Redis 7
- Reverse proxy: Nginx
- Runtime: Docker Compose

## Structure

- `apps/web`: frontend shell for ATLAS modules
- `apps/api`: API, auth readiness, data layer, health endpoints
- `infra/nginx`: reverse proxy configuration
- `ops`: deployment and backup scripts

## Bootstrapping

1. Copy `.env.example` to `.env`
2. Fill secrets and Google OAuth values
3. Run `docker compose up -d --build`
4. Run `docker compose exec api npm run db:deploy`

## Current Scope

This baseline includes:

- secure runtime topology
- database schema for core ATLAS modules excluding PO
- health endpoints
- frontend shell reflecting active ATLAS modules
- deployment and backup scripts

Module-by-module business logic migration is the next phase.
