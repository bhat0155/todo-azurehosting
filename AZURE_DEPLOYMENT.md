# Deploying Your Todo App to Azure — A Three-Tier Architecture Guide

> A senior developer's guide for junior developers. Every concept is explained before every command. No assumed knowledge.

---

## Table of Contents

1. [What Is Three-Tier Architecture?](#1-what-is-three-tier-architecture)
2. [Azure Infrastructure Setup](#2-azure-infrastructure-setup)
3. [Database Deployment on VM3](#3-database-deployment-on-vm3)
4. [Backend Deployment on VM2](#4-backend-deployment-on-vm2)
5. [Frontend Deployment on VM1](#5-frontend-deployment-on-vm1)
6. [Nginx Reverse Proxy Configuration](#6-nginx-reverse-proxy-configuration)
7. [End-to-End Testing](#7-end-to-end-testing)

---

## 1. What Is Three-Tier Architecture?

### The Concept

Your entire app runs on one machine locally — your laptop. The React frontend, Express backend, and PostgreSQL database all live together. This works locally but is a bad idea for production because:

- If your laptop crashes, everything goes down.
- Anyone who reaches your frontend can theoretically reach your database too.
- You can't scale one part independently of the others.

**Three-tier architecture** splits your app across three isolated layers, each running on its own machine:

```
Internet
    │
    ▼
┌─────────────────────────────┐
│  VM1 — Frontend (Nginx)     │  ← Tier 1: Presentation
│  Public IP, frontendsubnet  │    The only machine the internet can reach
└────────────┬────────────────┘
             │ private IP (10.0.1.4)
             ▼
┌─────────────────────────────┐
│  VM2 — Backend (Node/PM2)   │  ← Tier 2: Application Logic
│  No public IP, backendsubnet│    Only reachable from frontendsubnet
└────────────┬────────────────┘
             │ private IP (10.0.2.4)
             ▼
┌─────────────────────────────┐
│  VM3 — Database (PostgreSQL)│  ← Tier 3: Data
│  No public IP, databasesubnet    Can only be reached from backendsubnet
└─────────────────────────────┘
```

### Why Private IPs Between Layers?

When traffic flows from VM1 → VM2 → VM3, it uses **private IP addresses**. These addresses only exist inside your Azure Virtual Network — invisible and unreachable from the public internet. This means:

- Someone on the internet can hit VM1 (your frontend).
- They **cannot** hit VM2 directly — `10.0.1.4` doesn't exist outside Azure.
- They **cannot** hit VM3 at all — even VM1 can't reach it directly.

This is defense-in-depth: even if an attacker gets into VM1, your database is still protected by a second layer.

### What Are NSGs?

**Network Security Groups (NSGs)** are Azure's firewall rules. You attach one to each subnet and define exactly what traffic is allowed in and out. Think of it as a bouncer at a door — every incoming packet gets checked against the rules list, and anything not explicitly allowed gets dropped.

Each rule has:
- **Priority** (100–4096) — lower number = checked first
- **Source** — where is the traffic coming from? (IP range, subnet, or `Any`)
- **Destination port** — which port is being knocked on?
- **Action** — Allow or Deny

### What Does NAT Gateway Do?

VM2 and VM3 have no public IP addresses. That makes them unreachable from the internet (good for security) — but it also means they can't reach the internet either. This is a problem when you need to install packages:

```bash
# This would fail on VM2 without NAT Gateway:
sudo apt install nodejs   # needs to download from the internet
```

A **NAT Gateway** gives private VMs outbound-only internet access. Traffic goes: `VM2 → NAT Gateway → internet`. The internet sees the NAT Gateway's IP, not VM2's private IP. No inbound connection can be initiated from outside — only outbound.

---

## 2. Azure Infrastructure Setup

### What We Built

| Resource | Name | Details |
|---|---|---|
| Resource Group | `fullstack` | East US — container for everything |
| Virtual Network | `fullstack_vnet` | Address space: `10.0.0.0/16` |
| Subnet 1 | `frontendsubnet` | `10.0.0.0/24` — VM1 lives here |
| Subnet 2 | `backendsubnet` | `10.0.1.0/24` — VM2 lives here |
| Subnet 3 | `databasesubnet` | `10.0.2.0/24` — VM3 lives here |
| NSG 1 | `nsg-frontend` | Attached to frontendsubnet |
| NSG 2 | `nsg-backend` | Attached to backendsubnet |
| NSG 3 | `nsg-database` | Attached to databasesubnet |
| NAT Gateway | `nat-ekam` | Attached to all 3 subnets |
| VM1 | `vm-frontend` | Public IP: `172.190.113.184` |
| VM2 | `vm-backend` | Private IP: `10.0.1.4` |
| VM3 | `vm-database` | Private IP: `10.0.2.4` |

### Prerequisites

- An Azure account
- SSH key pair on your local machine

Generate an SSH key if you don't have one:
```bash
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
# Press Enter for all prompts to use defaults
```

### Step 1 — Create a Resource Group

In the Azure Portal:
1. Search **"Resource Groups"** → **"+ Create"**
2. Name: `fullstack`, Region: `East US`
3. Click **"Review + Create"** → **"Create"**

A Resource Group is just a folder. When you're done with the project, delete the resource group and everything inside disappears — useful for cleanup.

### Step 2 — Create the Virtual Network and 3 Subnets

1. Search **"Virtual Networks"** → **"+ Create"**
2. Resource Group: `fullstack`, Name: `fullstack_vnet`, Region: `East US`
3. Address space: `10.0.0.0/16`
4. Add three subnets:

| Name | Address Range |
|---|---|
| `frontendsubnet` | `10.0.0.0/24` |
| `backendsubnet` | `10.0.1.0/24` |
| `databasesubnet` | `10.0.2.0/24` |

**What `/24` means:** 256 addresses per subnet. Azure reserves 5, leaving 251 usable IPs per subnet.

### Step 3 — Create 3 NSGs with Rules

#### NSG 1 — `nsg-frontend` (public facing)

Inbound rules:

| Priority | Name | Port | Protocol | Source | Action |
|---|---|---|---|---|---|
| 100 | `ssh` | 22 | TCP | Any | Allow |
| 110 | `allowhttp` | 80 | TCP | Any | Allow |

#### NSG 2 — `nsg-backend` (private — backend only)

Inbound rules:

| Priority | Name | Port | Protocol | Source | Action |
|---|---|---|---|---|---|
| 100 | `allow-frontend-ssh` | 22 | TCP | `10.0.0.0/24` | Allow |
| 110 | `allow-backend-from-frontend` | 3001 | TCP | `10.0.0.0/24` | Allow |

> **Why `10.0.0.0/24` as source?** That's the `frontendsubnet` range. Only VM1 living in that subnet can reach port 3001. Nobody from the internet can hit your backend directly.

#### NSG 3 — `nsg-database` (most private — database only)

Inbound rules:

| Priority | Name | Port | Protocol | Source | Action |
|---|---|---|---|---|---|
| 100 | `allow-ssh-backend` | 22 | TCP | `10.0.1.0/24` | Allow |
| 110 | `allow-db-from-backend` | 5432 | TCP | `10.0.1.0/24` | Allow |

> **Why `10.0.1.0/24` as source?** That's the `backendsubnet` range. Only VM2 can reach PostgreSQL. VM1 cannot. The internet cannot.

### Step 4 — Attach NSGs to Subnets

1. Go to `fullstack_vnet` → **Subnets**
2. Click each subnet and assign its NSG:
   - `frontendsubnet` → `nsg-frontend`
   - `backendsubnet` → `nsg-backend`
   - `databasesubnet` → `nsg-database`

### Step 5 — Create 3 Virtual Machines

All three VMs: Ubuntu 24.04 LTS, same SSH key (`vm-frontend_key.pem`), NIC NSG set to `None` (subnet NSG covers it).

#### VM1 — Frontend (public IP)
- Name: `vm-frontend`
- Subnet: `frontendsubnet`
- Public IP: enabled (auto-created)

#### VM2 — Backend (no public IP)
- Name: `backend-vm`
- Subnet: `backendsubnet`
- Public IP: **None**

#### VM3 — Database (no public IP)
- Name: `database-vm`
- Subnet: `databasesubnet`
- Public IP: **None**

> **Important:** Download the SSH key (`vm-frontend_key.pem`) when prompted during VM1 creation. Use the same key for all three VMs by selecting "existing key" for VM2 and VM3.

### Step 6 — Create NAT Gateway

1. Search **"NAT Gateways"** → **"+ Create"**
2. Name: `nat-ekam`, Resource Group: `fullstack`, Region: `East US`
3. Create a new public IP called `nat-ip`
4. Attach to all three subnets: `frontendsubnet`, `backendsubnet`, `databasesubnet`

All three VMs can now reach the internet outbound for package installs.

---

## 3. Database Deployment on VM3

### SSH Jump Pattern

VM3 has no public IP. You reach it by jumping through VM1. This is called the **bastion pattern**.

**Step 1 — Load your SSH key into the agent (run once on your Mac):**
```bash
ssh-add ~/Downloads/vm-frontend_key.pem
```

**Step 2 — SSH into VM1 with agent forwarding:**
```bash
ssh -A -i ~/Downloads/vm-frontend_key.pem azureuser@172.190.113.184
```

**Step 3 — Jump from VM1 to VM3:**
```bash
ssh azureuser@10.0.2.4
```

> **Critical:** The `-A` flag forwards your SSH key from your Mac into VM1, so VM1 can use it to authenticate into VM3. Without `-A` you get "Permission denied" at the second hop. Always run `ssh-add` first on your Mac.

### Install PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

Verify the cluster is running:
```bash
pg_lsclusters
# Should show: 16  main  5432  online
```

### Create Database and User

```bash
sudo -i -u postgres
psql
```

Wait for `postgres=#` prompt, then run:

```sql
CREATE USER todouser WITH PASSWORD 'todopass123';
CREATE DATABASE tododb;
GRANT ALL PRIVILEGES ON DATABASE tododb TO todouser;
GRANT ALL ON SCHEMA public TO todouser;
ALTER DATABASE tododb OWNER TO todouser;
\q
```

Then:
```bash
exit
```

> **Why grant schema permissions?** On PostgreSQL 16, a new user doesn't automatically have rights to create tables in the `public` schema. Without `GRANT ALL ON SCHEMA public`, Prisma migrations will fail with "permission denied for schema public".

### Configure PostgreSQL for Remote Connections

By default PostgreSQL only listens on localhost. Two files need editing.

**File 1 — `postgresql.conf`:** Tell PostgreSQL to listen on all network interfaces.

```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
```

Find and change:
```
#listen_addresses = 'localhost'
```
To:
```
listen_addresses = '*'
```

> Remove the `#` — that's what uncomments the line. The `*` means listen on all interfaces, not just localhost.

**File 2 — `pg_hba.conf`:** Allow connections from backendsubnet.

```bash
sudo nano /etc/postgresql/16/main/pg_hba.conf
```

Add this line at the very bottom:
```
host    tododb          todouser        10.0.1.0/24             scram-sha-256
```

Restart PostgreSQL:
```bash
sudo pg_ctlcluster 16 main restart
pg_lsclusters
# Should show: online
```

Verify both changes saved:
```bash
sudo grep "listen_addresses" /etc/postgresql/16/main/postgresql.conf
sudo tail -5 /etc/postgresql/16/main/pg_hba.conf
```

> **Common mistakes:**
> - Typo in `pg_hba.conf` — e.g. `sscram-sha-256` instead of `scram-sha-256` — will crash PostgreSQL on restart. Check logs with `sudo journalctl -xeu postgresql@16-main.service`.
> - Forgetting to remove the `#` in `postgresql.conf` — PostgreSQL will still only listen on localhost.

---

## 4. Backend Deployment on VM2

### Upload Backend Code from Mac

Run this from your **Mac terminal** (not inside any VM):

```bash
rsync -av --exclude='node_modules' \
  -e "ssh -i ~/Downloads/vm-frontend_key.pem -J azureuser@172.190.113.184" \
  /path/to/your/backend/ \
  azureuser@10.0.1.4:/home/azureuser/backend
```

> **Why rsync instead of scp?** rsync lets us exclude `node_modules` — thousands of files that would take forever to upload. We install them fresh on the VM with `npm install`.

> **Why `-J` flag?** VM2 has no public IP. The `-J azureuser@172.190.113.184` tells rsync to tunnel through VM1 on its way to VM2.

### SSH Into VM2

From your Mac, jump through VM1:
```bash
ssh-add ~/Downloads/vm-frontend_key.pem
ssh -A -i ~/Downloads/vm-frontend_key.pem azureuser@172.190.113.184
# then from VM1:
ssh azureuser@10.0.1.4
```

### Install Node.js

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x.x
npm --version    # 10.x.x
```

### Configure the .env File

```bash
cd /home/azureuser/backend
nano .env
```

Set the content to:
```env
DATABASE_URL="postgresql://todouser:todopass123@10.0.2.4:5432/tododb?schema=public"
PORT=3001
```

> `10.0.2.4` is VM3's private IP. This is how Prisma finds PostgreSQL across the VNet.

### Install Dependencies and Run Migration

```bash
cd /home/azureuser/backend
rm -rf node_modules
npm install
npx prisma generate
npx prisma migrate deploy
```

**What `migrate deploy` does:** Reads your migration files and creates the `todos` table in PostgreSQL on VM3. This is the first time VM2 talks to VM3 — if it works, your networking is correct.

> **Use `migrate deploy` not `migrate dev`** — `deploy` runs silently on production servers. `dev` is for local development and prompts interactively.

### Start Backend with PM2

```bash
sudo npm install -g pm2
cd /home/azureuser/backend
pm2 start server.js --name todo-backend
pm2 startup
# Copy and run the command it prints, e.g.:
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u azureuser --hp /home/azureuser
pm2 save
```

Verify:
```bash
pm2 status
curl http://localhost:3001/todos
# Expected: []
```

---

## 5. Frontend Deployment on VM1

### Prepare the Code on Your Mac

Before building, update `frontend/src/api.js`:
```js
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
```

Create `frontend/.env.production`:
```
VITE_API_URL=http://172.190.113.184/api
```

> **Why `/api` in the URL?** The browser can't reach VM2 directly. Instead it calls VM1's public IP with `/api/` prefix. Nginx on VM1 intercepts it, strips `/api`, and forwards to VM2. The browser never knows VM2 exists.

> **`VITE_API_URL` is a build-time variable** — not a runtime one. When you run `npm run build`, Vite bakes the value directly into the JavaScript bundle. By the time users load the app, it's just a hardcoded URL.

### Build React

```bash
cd frontend
npm run build
```

This creates a `dist/` folder with three static files — `index.html`, a `.js` bundle, and a `.css` file. No Node.js needed to serve them. Nginx handles it.

### Upload the Build to VM1

```bash
rsync -av \
  -e "ssh -i ~/Downloads/vm-frontend_key.pem" \
  /path/to/your/frontend/dist/ \
  azureuser@172.190.113.184:/home/azureuser/frontend/dist
```

### Install Nginx on VM1

SSH into VM1:
```bash
ssh -i ~/Downloads/vm-frontend_key.pem azureuser@172.190.113.184
```

Install:
```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

Fix file permissions so Nginx can read your files:
```bash
chmod 755 /home/azureuser
chmod -R 755 /home/azureuser/frontend
```

---

## 6. Nginx Reverse Proxy Configuration

### Why Nginx?

Two jobs:

1. **Serve static files:** React's `dist/` folder. Nginx is extremely efficient at this.
2. **Reverse proxy:** The browser can't reach VM2 directly. Nginx intercepts `/api/*` requests from the browser and forwards them to VM2's private IP internally.

### The Config

```bash
sudo nano /etc/nginx/sites-available/todo-app
```

Paste this (VM2's private IP is `10.0.1.4`):

```nginx
server {
    listen 80;
    server_name _;

    root /home/azureuser/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://10.0.1.4:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }
}
```

Enable and reload:

```bash
sudo rm /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/todo-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### How a Request Flows

```
Browser
    │  POST http://172.190.113.184/api/todos
    ▼
Nginx on VM1 (port 80)
    │  Matches /api/
    │  Strips /api → forwards to http://10.0.1.4:3001/todos
    ▼
Node.js/Express on VM2 (port 3001)
    │  Hits POST /todos route
    │  Calls Prisma
    ▼
PostgreSQL on VM3 (port 5432)
    │  Inserts row, returns new todo
    ▼
Node.js → Nginx → Browser
    React updates the UI
```

---

## 7. End-to-End Testing

### Browser Test

Open `http://172.190.113.184` — you should see the Todo app.

- Add a todo → appears in list ✅
- Toggle checkbox → completed style changes ✅
- Delete → disappears ✅

### Curl Tests From VM1

```bash
# Test Nginx → VM2 proxy works
curl http://localhost/api/todos
# Expected: [] or JSON array

# Create a todo
curl -X POST http://localhost/api/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Test from curl"}'
# Expected: {"id":1,"title":"Test from curl","completed":false,...}
```

### Direct Backend Test From VM2

```bash
curl http://localhost:3001/todos
pm2 status
pm2 logs todo-backend --lines 20
```

### PostgreSQL Verification From VM3

```bash
psql -U todouser -d tododb
SELECT * FROM "Todo";
\q
```

### Security Check — VM3 Should NOT Be Reachable From VM1

```bash
# Run from VM1 — this should FAIL
curl http://10.0.2.4:5432
# Expected: connection refused or timeout — this is correct!
```

---

## Common Issues and Fixes

| Problem | Likely Cause | Fix |
|---|---|---|
| `Permission denied (publickey)` when jumping to VM2/VM3 | Forgot `ssh-add` or `-A` flag | Run `ssh-add ~/Downloads/vm-frontend_key.pem` then `ssh -A` |
| PostgreSQL won't start after editing config | Typo in `pg_hba.conf` | Check with `sudo journalctl -xeu postgresql@16-main.service` |
| `permission denied for schema public` on migration | Missing schema grants | Run `GRANT ALL ON SCHEMA public TO todouser` in psql on VM3 |
| `500 Internal Server Error` from Nginx | Nginx can't read dist files | Run `chmod 755 /home/azureuser && chmod -R 755 /home/azureuser/frontend` |
| API calls return `502 Bad Gateway` | Node.js not running on VM2 | Check `pm2 status` on VM2 |
| Todos don't save after adding | Wrong `DATABASE_URL` in `.env` | Verify VM3's private IP in `.env` on VM2 |
| React app loads but API calls fail | Wrong `VITE_API_URL` or Nginx misconfigured | Check browser Network tab for exact URL being called |

---

## Architecture Summary

```
                        Internet
                           │
                    ┌──────┴──────┐
                    │  Public IP  │
                    │  vm-frontend│ ← frontendsubnet: 10.0.0.0/24
                    │172.190.113.184   NSG: allows 80, 22 from internet
                    └──────┬──────┘
                           │ Private IP: 10.0.1.4
                    ┌──────┴──────┐
                    │  backend-vm │ ← backendsubnet: 10.0.1.0/24
                    │  PM2 :3001  │   NSG: allows 3001, 22 from frontendsubnet only
                    └──────┬──────┘
                           │ Private IP: 10.0.2.4
                    ┌──────┴──────┐
                    │ database-vm │ ← databasesubnet: 10.0.2.0/24
                    │  Port 5432  │   NSG: allows 5432, 22 from backendsubnet only
                    └─────────────┘

All 3 subnets → nat-ekam → Internet (outbound package installs only)
```

**Security model in one sentence:** The internet can only touch VM1. VM1 can only touch VM2. VM2 can only touch VM3. Each layer is isolated by NSG rules, and no private VM is directly reachable from outside.
