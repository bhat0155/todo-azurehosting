# Docker Context for the Todo Azure Project

## Purpose of this document

This document explains what Docker is, why it is useful for this project, and how to add Docker support so the full application can run with one command.

Assume you are onboarding as a junior engineer. The goal is not only to copy commands, but to understand why each Docker piece exists and how it maps to this app.

## Current project shape

This repository is a three-tier todo application:

```text
todo-azure/
├── frontend/          # React + Vite UI
├── backend/           # Node.js + Express + Prisma API
├── backend/prisma/    # Prisma schema and migrations
├── infra/             # Terraform Azure infrastructure
├── README.md
└── AZURE_DEPLOYMENT.md
```

The runtime services are:

| Layer | Technology | Local port |
| --- | --- | --- |
| Frontend | React built by Vite, served by a web server | `8080` when Dockerized |
| Backend | Node.js, Express, Prisma | `3001` |
| Database | PostgreSQL | `5432` inside Docker network, optionally exposed locally |

Without Docker, a developer needs Node.js, npm, PostgreSQL, the right database user, Prisma migrations, and multiple terminal sessions. Docker packages these moving parts into repeatable containers.

## What Docker is

Docker is a platform for building and running applications inside containers.

A container is a lightweight, isolated runtime environment. It contains the application code, operating system libraries, dependencies, environment variables, and startup command needed to run one service.

Docker commonly uses these pieces:

| Docker concept | Meaning in this project |
| --- | --- |
| Image | A reusable package for a service, such as the backend image or frontend image |
| Container | A running instance of an image |
| Dockerfile | Instructions for building an image |
| Docker Compose | A YAML file that starts multiple containers together |
| Volume | Persistent storage, used here for PostgreSQL data |
| Network | Private communication between containers, used here so backend can reach Postgres by service name |

Think of Docker as a way to define the app runtime as code. If the Docker files are correct, every developer and deployment machine can run the same app in the same way.

## Why Docker benefits this project

### 1. Consistent local development

This app depends on specific runtime pieces:

- Node.js for the frontend and backend
- npm dependencies for both apps
- PostgreSQL for data
- Prisma Client generation
- Prisma database migrations
- environment variables such as `DATABASE_URL` and `VITE_API_URL`

Docker removes most "works on my machine" problems because these dependencies are installed inside images instead of relying on each developer's laptop setup.

### 2. One command starts the whole stack

Instead of manually starting PostgreSQL, then the backend, then the frontend, Docker Compose can start everything:

```bash
docker compose up --build
```

That command can build images, create a database container, run the API, and serve the frontend.

### 3. Clear service boundaries

The project already has a clean three-tier design:

- frontend container
- backend container
- database container

Docker makes those boundaries explicit. This is helpful when moving from local development to Azure because Azure deployments also care about service boundaries, ports, networking, logs, and environment variables.

### 4. Safer dependency management

The backend and frontend each have their own `package-lock.json`. Docker can use those lock files with `npm ci`, which installs the exact dependency versions from the lock file.

That is more reliable than `npm install` in deployment-style environments.

### 5. Better production parity

The frontend should not normally be served by the Vite development server in production. A better production pattern is:

1. Build React static assets with Vite.
2. Serve the generated files through Nginx.

Docker makes this clean by using a multi-stage frontend image.

### 6. Easier future CI/CD

Once Docker exists, a pipeline can:

1. Build the images.
2. Run tests or linting.
3. Push images to a registry.
4. Deploy those images to Azure.

That is easier to automate than SSHing into machines and manually installing packages.

## Recommended Docker architecture

For this project, use Docker Compose locally with three services:

```text
Browser
  |
  | http://localhost:8080
  v
frontend container: Nginx serving React build
  |
  | API requests to http://localhost:3001
  v
backend container: Express + Prisma
  |
  | DATABASE_URL=postgresql://postgres:postgres@postgres:5432/tododb
  v
postgres container: PostgreSQL database
```

The important Docker networking idea is this:

- From your laptop, you use `localhost`.
- From one container to another container, use the Compose service name.

So the backend connects to the database with host `postgres`, not `localhost`.

## Files to add

Add these files to the project:

```text
todo-azure/
├── docker-compose.yml
├── .dockerignore
├── backend/
│   └── Dockerfile
└── frontend/
    ├── Dockerfile
    └── nginx.conf
```

You do not need to modify the application code to get a basic Docker setup running.

## Step 1: Initialize Docker on your machine

### Install Docker

On macOS or Windows, install Docker Desktop:

```text
https://www.docker.com/products/docker-desktop/
```

On Linux, install Docker Engine and the Compose plugin using your distribution's package manager.

### Start Docker

Open Docker Desktop and wait until it says Docker is running.

Verify the Docker CLI works:

```bash
docker --version
docker compose version
docker info
```

If `docker info` fails, Docker is not running or your user does not have permission to access the Docker daemon.

## Step 2: Add a root `.dockerignore`

Create `.dockerignore` at the repository root:

```dockerignore
.git
.github
node_modules
frontend/node_modules
backend/node_modules
azureuser@52.146.16.213/node_modules
dist
frontend/dist
npm-debug.log
.DS_Store
.env
backend/.env
frontend/.env
*.md
```

Why this matters:

- It keeps images smaller.
- It prevents local dependencies from being copied into containers.
- It avoids accidentally baking local secrets into images.

If you want Markdown files inside images for some reason, remove `*.md`. For this app, runtime containers do not need documentation files.

## Step 3: Add the backend Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY server.js ./

EXPOSE 3001

CMD ["node", "server.js"]
```

What this does:

- Starts from a small Node.js 20 Linux image.
- Installs backend dependencies from `package-lock.json`.
- Copies the Prisma schema and generates Prisma Client.
- Copies the Express server.
- Starts the API on port `3001`.

Important: Prisma needs `DATABASE_URL` at runtime for queries. The value will come from `docker-compose.yml`.

## Step 4: Add the frontend Dockerfile

Create `frontend/Dockerfile`:

```dockerfile
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

What this does:

- Uses Node.js only to build the React app.
- Produces static files in `frontend/dist`.
- Copies those files into a smaller Nginx image.
- Serves the frontend on container port `80`.

The frontend currently reads:

```js
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
```

Vite injects `VITE_API_URL` at build time, not runtime. That means changing the Compose environment after the frontend image is built will not change the URL unless you rebuild the frontend image.

For local Docker, `http://localhost:3001` works because the browser runs on your laptop and can reach the backend through the published backend port.

## Step 5: Add the frontend Nginx config

Create `frontend/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Why this matters:

- Nginx serves the compiled React files.
- `try_files` allows React routing to work if routes are added later.

## Step 6: Add Docker Compose

Create `docker-compose.yml` at the repository root:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: todo-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: tododb
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d tododb"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build:
      context: ./backend
    container_name: todo-backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/tododb?schema=public
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy
    command: sh -c "npx prisma migrate deploy && node server.js"

  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_URL: http://localhost:3001
    container_name: todo-frontend
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      - backend

volumes:
  postgres_data:
```

What Compose does here:

- Creates a private Docker network for all services.
- Starts PostgreSQL first.
- Waits until PostgreSQL is healthy.
- Starts the backend.
- Runs Prisma migrations before starting Express.
- Builds and starts the frontend.
- Persists PostgreSQL data in the `postgres_data` volume.

## Step 7: Build and run the full app

From the repository root:

```bash
docker compose up --build
```

The first run will take longer because Docker needs to download base images and install npm dependencies.

When everything is running:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:3001`
- Backend todos API: `http://localhost:3001/todos`
- PostgreSQL: `localhost:5432`

Open the frontend in your browser:

```text
http://localhost:8080
```

Create a todo. If it appears in the list and survives a browser refresh, the frontend, backend, Prisma, and PostgreSQL are working together.

## Step 8: Useful Docker commands

Start the app:

```bash
docker compose up
```

Start the app and rebuild images:

```bash
docker compose up --build
```

Run in the background:

```bash
docker compose up -d
```

Stop containers but keep database data:

```bash
docker compose down
```

Stop containers and delete database data:

```bash
docker compose down -v
```

View logs for all services:

```bash
docker compose logs -f
```

View backend logs only:

```bash
docker compose logs -f backend
```

View frontend logs only:

```bash
docker compose logs -f frontend
```

View database logs only:

```bash
docker compose logs -f postgres
```

Open a shell inside the backend container:

```bash
docker compose exec backend sh
```

Run Prisma manually inside the backend container:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma studio
```

Note: Prisma Studio usually needs an exposed port to be useful from your host machine. It is not required for the app to run.

## Step 9: Validate the app from the terminal

Check backend root route:

```bash
curl http://localhost:3001/
```

Check todos endpoint:

```bash
curl http://localhost:3001/todos
```

Create a todo:

```bash
curl -X POST http://localhost:3001/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"Learn Docker"}'
```

Check that the frontend container serves HTML:

```bash
curl -I http://localhost:8080
```

Expected result:

- Backend root returns the sample backend message.
- `/todos` returns JSON.
- Creating a todo returns a JSON object with an `id`.
- Frontend returns an HTTP `200 OK`.

## Environment variable notes

### Backend

The backend needs:

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/tododb?schema=public
```

Inside Docker Compose, `postgres` is the hostname because the database service is named `postgres`.

Do not use this inside the backend container:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tododb?schema=public
```

Inside a container, `localhost` means the same container, not your laptop and not the Postgres container.

### Frontend

The frontend needs:

```env
VITE_API_URL=http://localhost:3001
```

This is correct for local Docker because the browser is outside Docker and calls the backend through the host-published port.

For Azure or another hosted environment, this should become the public API URL or reverse-proxied path, for example:

```env
VITE_API_URL=https://example.com/api
```

Because Vite injects this at build time, rebuild the frontend image after changing it:

```bash
docker compose build frontend
docker compose up -d frontend
```

## Development workflow with Docker

The Docker setup above is production-like: it builds the frontend and serves static files. That is good for validating the full app, but it does not provide frontend hot reload.

For everyday development, there are two common options.

### Option A: Use Docker only for database

Run PostgreSQL in Docker, but run frontend and backend directly on your machine:

```bash
docker compose up postgres
```

Then in another terminal:

```bash
cd backend
npm install
npx prisma migrate deploy
node server.js
```

And in another terminal:

```bash
cd frontend
npm install
npm run dev
```

This gives you Vite hot reload while avoiding local PostgreSQL setup.

### Option B: Add development-specific Docker Compose later

You can add `docker-compose.dev.yml` with bind mounts and Vite dev server support. That is useful on larger teams, but the initial Compose file should stay simple and reliable.

## Production considerations

The local Compose setup is a strong starting point, but a production Docker deployment should improve several areas:

### Use real secrets

Do not use this password in production:

```env
POSTGRES_PASSWORD=postgres
```

Use a secret manager, CI/CD protected variables, or Azure Key Vault.

### Do not expose Postgres publicly

For local development, exposing `5432:5432` is convenient.

In production, the database should usually stay private. The backend should be able to reach it, but the internet should not.

### Add backend health checks

The backend currently has `/`, but a dedicated `/health` endpoint is better. A health endpoint should return quickly and avoid expensive dependencies unless you intentionally want a deep health check.

Example future route:

```js
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' })
})
```

Then Compose or Azure can use it to decide if the service is healthy.

### Run as a non-root user

For production hardening, configure the backend image to run as a non-root user. The simple Dockerfile above is acceptable for learning and local validation, but production images should reduce privileges.

### Use image tags

In CI/CD, tag images with the Git commit SHA or release version:

```text
todo-backend:2026-05-18-abcdef
todo-frontend:2026-05-18-abcdef
```

Avoid relying only on `latest` for production rollbacks.

## Common problems and fixes

### Problem: backend cannot connect to database

Likely causes:

- `DATABASE_URL` uses `localhost` instead of `postgres`.
- PostgreSQL is not healthy yet.
- The database password, user, or database name does not match Compose.

Check logs:

```bash
docker compose logs -f backend
docker compose logs -f postgres
```

### Problem: frontend loads but todos do not appear

Likely causes:

- Backend is not running.
- `VITE_API_URL` was built with the wrong value.
- Browser cannot reach `http://localhost:3001`.

Check:

```bash
curl http://localhost:3001/todos
```

If you changed `VITE_API_URL`, rebuild the frontend:

```bash
docker compose build frontend
docker compose up -d frontend
```

### Problem: Prisma table does not exist

The backend Compose command runs:

```bash
npx prisma migrate deploy
```

If migrations failed, inspect backend logs:

```bash
docker compose logs backend
```

You can also run migrations manually:

```bash
docker compose exec backend npx prisma migrate deploy
```

### Problem: old database state keeps coming back

Docker volumes persist data. That is normally good.

If you want a clean database:

```bash
docker compose down -v
docker compose up --build
```

Be careful: `docker compose down -v` deletes the local database volume for this Compose project.

## Final expected runbook

After adding the Docker files, a new engineer should be able to run the entire app like this:

```bash
git clone <repo-url>
cd todo-azure
docker compose up --build
```

Then visit:

```text
http://localhost:8080
```

The frontend should load, the backend should respond on `http://localhost:3001`, and PostgreSQL should store todos through Prisma.

That is the main value Docker brings here: the whole app becomes a repeatable, documented runtime instead of a set of manual setup steps spread across multiple machines and terminals.
