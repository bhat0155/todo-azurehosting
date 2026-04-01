# Todo App on Azure

A full-stack todo application with a React frontend, Express/Prisma backend, and PostgreSQL database — built to demonstrate three-tier architecture on Azure.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Tech Stack](#tech-stack)
3. [Local Development](#local-development)
4. [API Reference](#api-reference)
5. [Azure Deployment](#azure-deployment)

---

## Project Structure

```
todo-azure/
├── frontend/               # React + Vite frontend
│   └── src/
│       ├── App.jsx         # Main component
│       ├── api.js          # API client functions
│       └── index.css       # Styling
├── backend/                # Express + Prisma API
│   ├── server.js           # Server and route handlers
│   └── prisma/
│       └── schema.prisma   # Database schema
└── AZURE_DEPLOYMENT.md     # Full Azure deployment guide
```

---

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 19, Vite 8                    |
| Backend  | Node.js, Express 5, Prisma 5        |
| Database | PostgreSQL                          |
| Deploy   | Azure VMs, Nginx, PM2               |

---

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL running locally

### 1. Backend

```bash
cd backend
npm install
```

Create a `.env` file:

```env
DATABASE_URL="postgresql://<user>@localhost:5432/tododb?schema=public"
```

Run migrations and start the server:

```bash
npx prisma migrate deploy
node server.js
# Server runs on http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# App runs on http://localhost:5173
```

The frontend points to `http://localhost:3001` by default (set in `src/api.js`).

---

## API Reference

Base URL: `http://localhost:3001`

| Method | Endpoint       | Description          | Body                    |
|--------|----------------|----------------------|-------------------------|
| GET    | `/todos`       | Get all todos        | —                       |
| GET    | `/todos/:id`   | Get a single todo    | —                       |
| POST   | `/todos`       | Create a todo        | `{ "title": "string" }` |
| PATCH  | `/todos/:id`   | Toggle completion    | `{ "completed": bool }` |
| DELETE | `/todos/:id`   | Delete a todo        | —                       |

### Database Schema

| Column      | Type      | Default            |
|-------------|-----------|--------------------|
| id          | Int (PK)  | Auto-increment     |
| title       | String    | —                  |
| completed   | Boolean   | `false`            |
| createdAt   | DateTime  | `now()`            |

---

## Azure Deployment

The app is designed for a **three-tier Azure architecture**:

- **VM1** — Nginx serving the React build + reverse proxy to backend
- **VM2** — Node.js backend managed by PM2
- **VM3** — PostgreSQL database on a private subnet

See [AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md) for the full step-by-step guide covering VNets, NSGs, NAT Gateway, Nginx config, and PM2 setup.
