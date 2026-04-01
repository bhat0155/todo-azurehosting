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

Right now, your entire app runs on one machine — your laptop. The React frontend, Express backend, and PostgreSQL database all live together. This works locally but is a bad idea for production because:

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
│  Public IP, subnet1         │    The only machine the internet can reach
└────────────┬────────────────┘
             │ private IP (10.0.2.x)
             ▼
┌─────────────────────────────┐
│  VM2 — Backend (Node/PM2)   │  ← Tier 2: Application Logic
│  No public IP, subnet2      │    Can talk to VM1 and VM3, not the internet
└────────────┬────────────────┘
             │ private IP (10.0.3.x)
             ▼
┌─────────────────────────────┐
│  VM3 — Database (PostgreSQL)│  ← Tier 3: Data
│  No public IP, subnet3      │    Can only be reached from VM2
└─────────────────────────────┘
```

### Why Private IPs Between Layers?

When traffic flows from VM1 → VM2 → VM3, it uses **private IP addresses** (e.g. `10.0.2.4`). These addresses only exist inside your Azure Virtual Network — they are invisible and unreachable from the public internet. This means:

- Someone on the internet can hit VM1 (your frontend).
- They **cannot** hit VM2 directly — there's no path from the internet to `10.0.2.4`.
- They **cannot** hit VM3 at all — even VM1 can't reach it.

This is defense-in-depth: even if an attacker gets into VM1, your database is still protected by a second layer.

### What Are NSGs?

**Network Security Groups (NSGs)** are Azure's firewall rules. You attach one to each subnet and define exactly what traffic is allowed in and out. Think of it as a bouncer at a door — every incoming packet gets checked against the rules list, and anything not explicitly allowed gets dropped.

Each rule has:
- **Priority** (100–4096) — lower number = checked first
- **Source** — where is the traffic coming from? (IP, subnet, or `Internet`)
- **Destination port** — which port is being knocked on?
- **Action** — Allow or Deny

### What Does NAT Gateway Do?

VM2 and VM3 have no public IP addresses. That makes them unreachable from the internet (good for security) — but it also means they can't reach the internet either. This is a problem when you need to install packages:

```bash
# This would fail on VM2 without NAT Gateway:
sudo apt install nodejs   # needs to download from the internet
```

A **NAT Gateway** gives private VMs outbound-only internet access. Traffic goes: `VM2 → NAT Gateway → internet`. The internet sees the NAT Gateway's IP, not VM2's private IP. Responses come back the same path. No inbound connection can be initiated from outside — only outbound.

---

## 2. Azure Infrastructure Setup

### Prerequisites

- An Azure account (free tier works for this)
- Azure CLI installed locally: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
- SSH key pair on your local machine

Generate an SSH key if you don't have one:
```bash
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
# Press Enter for all prompts to use defaults
# Your public key is at: ~/.ssh/id_rsa.pub
```

Log in to Azure:
```bash
az login
# A browser window will open — sign in with your Azure account
```

### Step 1 — Create a Resource Group

A **Resource Group** is a logical container for all your Azure resources. Think of it as a folder. When you're done with the project, deleting the resource group deletes everything inside it — useful for cleanup.

```bash
az group create \
  --name todo-rg \
  --location eastus
```

**What success looks like:**
```json
{
  "id": "/subscriptions/.../resourceGroups/todo-rg",
  "location": "eastus",
  "name": "todo-rg",
  "properties": {
    "provisioningState": "Succeeded"
  }
}
```

### Step 2 — Create the Virtual Network and 3 Subnets

A **Virtual Network (VNet)** is your private network inside Azure. Think of it as your office building. **Subnets** are floors in that building — each floor has its own set of apartments (IP addresses) and its own access rules.

```bash
# Create the VNet with address space 10.0.0.0/16
az network vnet create \
  --resource-group todo-rg \
  --name todo-vnet \
  --address-prefix 10.0.0.0/16
```

Now create the three subnets:

```bash
# Subnet 1: Frontend (VM1)
az network vnet subnet create \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet1 \
  --address-prefix 10.0.1.0/24

# Subnet 2: Backend (VM2)
az network vnet subnet create \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet2 \
  --address-prefix 10.0.2.0/24

# Subnet 3: Database (VM3)
az network vnet subnet create \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet3 \
  --address-prefix 10.0.3.0/24
```

**What `10.0.1.0/24` means:** The `/24` means the first 24 bits of the address are the "network" part. That leaves 8 bits for hosts — giving you 256 addresses (10.0.1.0 through 10.0.1.255). Azure reserves 5 of these, leaving 251 usable IPs.

### Step 3 — Create 3 NSGs with Rules

#### NSG for subnet1 (Frontend — public facing)

```bash
az network nsg create \
  --resource-group todo-rg \
  --name nsg-subnet1
```

Allow SSH (for you to manage the VM) and HTTP/HTTPS (for visitors):

```bash
# Allow SSH from anywhere (you'll tighten this to your IP in production)
az network nsg rule create \
  --resource-group todo-rg \
  --nsg-name nsg-subnet1 \
  --name AllowSSH \
  --priority 100 \
  --protocol Tcp \
  --destination-port-range 22 \
  --access Allow \
  --direction Inbound

# Allow HTTP traffic from the internet
az network nsg rule create \
  --resource-group todo-rg \
  --nsg-name nsg-subnet1 \
  --name AllowHTTP \
  --priority 110 \
  --protocol Tcp \
  --destination-port-range 80 \
  --access Allow \
  --direction Inbound

# Allow HTTPS traffic from the internet
az network nsg rule create \
  --resource-group todo-rg \
  --nsg-name nsg-subnet1 \
  --name AllowHTTPS \
  --priority 120 \
  --protocol Tcp \
  --destination-port-range 443 \
  --access Allow \
  --direction Inbound
```

#### NSG for subnet2 (Backend — private)

```bash
az network nsg create \
  --resource-group todo-rg \
  --name nsg-subnet2
```

```bash
# Allow SSH only from subnet1 (frontend VM can SSH into backend for management)
az network nsg rule create \
  --resource-group todo-rg \
  --nsg-name nsg-subnet2 \
  --name AllowSSHFromSubnet1 \
  --priority 100 \
  --protocol Tcp \
  --source-address-prefix 10.0.1.0/24 \
  --destination-port-range 22 \
  --access Allow \
  --direction Inbound

# Allow Node.js backend port (3001) only from subnet1
az network nsg rule create \
  --resource-group todo-rg \
  --nsg-name nsg-subnet2 \
  --name AllowBackendFromSubnet1 \
  --priority 110 \
  --protocol Tcp \
  --source-address-prefix 10.0.1.0/24 \
  --destination-port-range 3001 \
  --access Allow \
  --direction Inbound
```

> **Common beginner mistake:** Don't open port 3001 to `*` (any source). That would expose your backend directly to the internet. Only subnet1 should be able to reach it.

#### NSG for subnet3 (Database — most private)

```bash
az network nsg create \
  --resource-group todo-rg \
  --name nsg-subnet3
```

```bash
# Allow SSH only from subnet2 (backend VM manages the database)
az network nsg rule create \
  --resource-group todo-rg \
  --nsg-name nsg-subnet3 \
  --name AllowSSHFromSubnet2 \
  --priority 100 \
  --protocol Tcp \
  --source-address-prefix 10.0.2.0/24 \
  --destination-port-range 22 \
  --access Allow \
  --direction Inbound

# Allow PostgreSQL (5432) only from subnet2
az network nsg rule create \
  --resource-group todo-rg \
  --nsg-name nsg-subnet3 \
  --name AllowPostgresFromSubnet2 \
  --priority 110 \
  --protocol Tcp \
  --source-address-prefix 10.0.2.0/24 \
  --destination-port-range 5432 \
  --access Allow \
  --direction Inbound
```

### Step 4 — Attach NSGs to Subnets

```bash
az network vnet subnet update \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet1 \
  --network-security-group nsg-subnet1

az network vnet subnet update \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet2 \
  --network-security-group nsg-subnet2

az network vnet subnet update \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet3 \
  --network-security-group nsg-subnet3
```

### Step 5 — Create 3 Virtual Machines

> **Note on VM size:** `Standard_B1s` is the cheapest general-purpose size (~$8/month). It has 1 vCPU and 1 GB RAM — fine for this learning project.

#### VM1 — Frontend (gets a public IP)

```bash
az vm create \
  --resource-group todo-rg \
  --name vm1-frontend \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --vnet-name todo-vnet \
  --subnet subnet1 \
  --admin-username azureuser \
  --ssh-key-values ~/.ssh/id_rsa.pub \
  --public-ip-address vm1-public-ip \
  --nsg ""
```

> `--nsg ""` prevents Azure from auto-creating a redundant NSG — the subnet NSG is enough.

#### VM2 — Backend (no public IP)

```bash
az vm create \
  --resource-group todo-rg \
  --name vm2-backend \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --vnet-name todo-vnet \
  --subnet subnet2 \
  --admin-username azureuser \
  --ssh-key-values ~/.ssh/id_rsa.pub \
  --public-ip-address "" \
  --nsg ""
```

#### VM3 — Database (no public IP)

```bash
az vm create \
  --resource-group todo-rg \
  --name vm3-database \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --vnet-name todo-vnet \
  --subnet subnet3 \
  --admin-username azureuser \
  --ssh-key-values ~/.ssh/id_rsa.pub \
  --public-ip-address "" \
  --nsg ""
```

#### Get the private IPs of all VMs

You'll need these throughout the rest of the guide:

```bash
az vm list-ip-addresses \
  --resource-group todo-rg \
  --output table
```

Note down:
- `VM1_PUBLIC_IP` — the public IP of vm1-frontend (e.g. `20.x.x.x`)
- `VM2_PRIVATE_IP` — the private IP of vm2-backend (e.g. `10.0.2.4`)
- `VM3_PRIVATE_IP` — the private IP of vm3-database (e.g. `10.0.3.4`)

### Step 6 — Create and Attach NAT Gateway

```bash
# Create a public IP for the NAT Gateway
az network public-ip create \
  --resource-group todo-rg \
  --name nat-gateway-ip \
  --sku Standard \
  --allocation-method Static

# Create the NAT Gateway
az network nat gateway create \
  --resource-group todo-rg \
  --name todo-nat-gateway \
  --public-ip-addresses nat-gateway-ip \
  --idle-timeout 10

# Attach NAT Gateway to all three subnets
az network vnet subnet update \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet1 \
  --nat-gateway todo-nat-gateway

az network vnet subnet update \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet2 \
  --nat-gateway todo-nat-gateway

az network vnet subnet update \
  --resource-group todo-rg \
  --vnet-name todo-vnet \
  --name subnet3 \
  --nat-gateway todo-nat-gateway
```

**What success looks like:** You can SSH into VM1 and `curl google.com` returns HTML. VM2 and VM3 can also reach the internet for package installs.

---

## 3. Database Deployment on VM3

### Getting There — SSH Jump Through VM1

VM3 has no public IP. To SSH into it, you first SSH into VM1 (which has a public IP), then SSH from VM1 to VM3. This is called an **SSH jump host** (or bastion pattern).

From your laptop:
```bash
# SSH into VM1 first
ssh -A azureuser@VM1_PUBLIC_IP
# The -A flag forwards your SSH key to VM1 so you can SSH onward from there
```

From inside VM1:
```bash
# Now SSH into VM3 from VM1
ssh azureuser@VM3_PRIVATE_IP
# e.g.: ssh azureuser@10.0.3.4
```

> **Common beginner mistake:** Forgetting `-A` when SSHing into VM1. Without it, VM1 won't have your key and you'll get "Permission denied" when trying to reach VM3. The `-A` flag "forwards" your agent — it lets VM1 use your laptop's key without copying it there.

### Install PostgreSQL on VM3

```bash
# Update the package list first — always do this on a fresh VM
sudo apt update

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL and enable it to start on boot
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**What success looks like:**
```bash
sudo systemctl status postgresql
# Should show: Active: active (running)
```

### Create the Database and User

PostgreSQL creates a Linux user called `postgres` during install. Switch to it:

```bash
sudo -i -u postgres
psql
```

You're now in the PostgreSQL interactive shell. Run these SQL commands:

```sql
-- Create a dedicated database user (don't use the postgres superuser in production)
CREATE USER todouser WITH PASSWORD 'choose_a_strong_password_here';

-- Create the database
CREATE DATABASE tododb;

-- Give todouser full control over tododb
GRANT ALL PRIVILEGES ON DATABASE tododb TO todouser;

-- Exit the psql shell
\q
```

Then exit the postgres Linux user:
```bash
exit
```

### Configure PostgreSQL for Remote Access

By default, PostgreSQL only accepts connections from `localhost`. You need to change two config files to allow VM2 (your backend) to connect.

**File 1: `postgresql.conf`** — tells Postgres which network interfaces to listen on.

```bash
sudo nano /etc/postgresql/14/main/postgresql.conf
```

Find the line:
```
#listen_addresses = 'localhost'
```

Change it to:
```
listen_addresses = '*'
```

> `'*'` means "listen on all interfaces." This doesn't mean anyone can connect — `pg_hba.conf` (below) controls who is actually allowed in.

**File 2: `pg_hba.conf`** — the Host-Based Authentication file. Controls which hosts can connect to which databases as which users.

```bash
sudo nano /etc/postgresql/14/main/pg_hba.conf
```

Add this line at the bottom of the file:

```
# Allow todouser to connect to tododb from subnet2 using password auth
host    tododb          todouser        10.0.2.0/24             scram-sha-256
```

This reads: "from any host in `10.0.2.0/24` (subnet2), allow user `todouser` to connect to database `tododb` using a password."

Restart PostgreSQL to apply the changes:

```bash
sudo systemctl restart postgresql
```

**Verify it's working from VM2 later** (once VM2 is set up):
```bash
# Run this from VM2:
psql -h VM3_PRIVATE_IP -U todouser -d tododb -c "SELECT 1;"
# Should print: 1
```

> **Common beginner mistake:** Editing `pg_hba.conf` but forgetting to restart PostgreSQL. Changes only take effect after a restart.

---

## 4. Backend Deployment on VM2

### SSH Into VM2

From your laptop, jump through VM1:
```bash
ssh -A azureuser@VM1_PUBLIC_IP
# then from VM1:
ssh azureuser@VM2_PRIVATE_IP
```

### Install Node.js on VM2

Your backend needs Node.js. We'll install the LTS version via NodeSource:

```bash
sudo apt update

# Download and run NodeSource setup script for Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs

# Verify
node --version   # should show v20.x.x
npm --version    # should show 10.x.x
```

### Install PM2 Globally

**PM2** is a process manager for Node.js. Without it, your backend runs only as long as your terminal session is open. PM2 keeps it running in the background, restarts it if it crashes, and starts it automatically after a VM reboot.

```bash
sudo npm install -g pm2
```

### Upload Your Backend Code

Do this from your **local machine** (not inside any VM). `scp` copies files over SSH.

Because VM2 has no public IP, you have to copy to VM1 first, then from VM1 to VM2:

```bash
# Step 1: From your laptop, copy backend to VM1
scp -r /Users/ekambhatia/Desktop/post-MADD/todo-azure/backend azureuser@VM1_PUBLIC_IP:/home/azureuser/backend

# Step 2: From VM1, forward it to VM2
# (first SSH into VM1, then run:)
scp -r /home/azureuser/backend azureuser@VM2_PRIVATE_IP:/home/azureuser/backend
```

Alternatively, use a **direct SSH jump** with scp:
```bash
# This copies directly from your laptop to VM2, routing through VM1:
scp -J azureuser@VM1_PUBLIC_IP -r \
  /Users/ekambhatia/Desktop/post-MADD/todo-azure/backend \
  azureuser@VM2_PRIVATE_IP:/home/azureuser/backend
```

### Configure the .env File on VM2

Your backend connects to PostgreSQL using a `DATABASE_URL` environment variable. On your laptop this points to `localhost`. On VM2 it needs to point to VM3's private IP.

SSH into VM2 and create the `.env` file:

```bash
cd /home/azureuser/backend
nano .env
```

Add this content (replace `VM3_PRIVATE_IP` and `your_password` with your actual values):

```env
DATABASE_URL="postgresql://todouser:your_password@VM3_PRIVATE_IP:5432/tododb?schema=public"
```

Example:
```env
DATABASE_URL="postgresql://todouser:strongpass123@10.0.3.4:5432/tododb?schema=public"
```

### Install Dependencies and Run Prisma Migration

```bash
cd /home/azureuser/backend

# Install all Node.js packages (reads from package.json)
npm install

# Run the Prisma migration — this creates the "Todo" table in PostgreSQL
npx prisma migrate deploy

# Generate the Prisma client
npx prisma generate
```

**What `migrate deploy` does:** Prisma reads your `schema.prisma` file and applies any pending migrations to the database. This is what actually creates the `todos` table in PostgreSQL.

**What success looks like:**
```
Applying migration `20241201_init`
The following migration(s) have been applied:
migrations/
  └─ 20241201_init/
       └─ migration.sql
```

> **Common beginner mistake:** Running `prisma migrate dev` instead of `prisma migrate deploy`. The `dev` command is for local development and will prompt you. `deploy` is for production servers and runs without prompts.

### Start the Backend with PM2

```bash
cd /home/azureuser/backend
pm2 start server.js --name todo-backend

# Save PM2's process list so it survives reboots
pm2 save

# Configure PM2 to start on system boot
pm2 startup
# This prints a command like: sudo env PATH=... pm2 startup systemd -u azureuser
# Copy that command and run it
```

**Verify the backend is running:**
```bash
pm2 status
# Should show: todo-backend | online | ...

# Check the logs:
pm2 logs todo-backend

# Test the API locally on VM2:
curl http://localhost:3001/todos
# Should return: []  (empty array — no todos yet, but it's working)
```

---

## 5. Frontend Deployment on VM1

### SSH Into VM1

```bash
ssh azureuser@VM1_PUBLIC_IP
```

### Update the API URL in Your Code

Your frontend's `api.js` currently hardcodes `localhost:3001`:

```js
const BASE_URL = 'http://localhost:3001';
```

In production, the browser (running on a visitor's computer) can't reach VM2 directly — VM2 is private. Instead, the browser will talk to Nginx on VM1, and Nginx will forward API requests to VM2.

The clean way to do this is with a **Vite environment variable**. Do this on your **local machine** before building:

Edit `frontend/src/api.js`:
```js
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
```

Create `frontend/.env.production`:
```
VITE_API_URL=
```

Leave `VITE_API_URL` empty — because requests to `/api/*` will be handled by Nginx and proxied to VM2. The browser will just call `/api/todos` (a relative URL), Nginx intercepts it, and forwards it to `http://VM2_PRIVATE_IP:3001`.

Actually, the simplest approach: point `VITE_API_URL` to your VM1's public IP's `/api` prefix, and configure Nginx to strip `/api` and proxy to VM2. Here's the exact setup:

In `frontend/.env.production`:
```
VITE_API_URL=http://VM1_PUBLIC_IP/api
```

In `frontend/src/api.js`:
```js
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
```

### Install Node.js on VM1 (For Building)

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Upload and Build the Frontend

From your **local machine**:

```bash
# Copy the frontend source to VM1
scp -r /Users/ekambhatia/Desktop/post-MADD/todo-azure/frontend azureuser@VM1_PUBLIC_IP:/home/azureuser/frontend
```

On VM1:

```bash
cd /home/azureuser/frontend

# Install dependencies
npm install

# Build for production (reads .env.production automatically)
npm run build
```

**What `npm run build` does:** Vite compiles your React code into plain HTML, CSS, and JavaScript files inside a `dist/` folder. These are static files — no Node.js required to serve them. Nginx can serve them directly.

**What success looks like:**
```
dist/index.html             1.23 kB
dist/assets/index-abc.css   8.45 kB
dist/assets/index-xyz.js   145.23 kB
✓ built in 2.34s
```

### Install and Configure Nginx

```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

**Verify Nginx is running:**
```bash
curl http://localhost
# Should return the default Nginx welcome page HTML
```

---

## 6. Nginx Reverse Proxy Configuration

### Why Do We Need Nginx?

Two reasons:

1. **Serve static files:** Your React `dist/` folder contains static files. Nginx is extremely efficient at serving static files — much better than Node.js.

2. **Reverse proxy for the API:** The browser can't reach VM2 directly. But Nginx (running on VM1) can. So when the browser sends a request to `http://VM1_PUBLIC_IP/api/todos`, Nginx receives it, strips the `/api` prefix, and forwards it to `http://VM2_PRIVATE_IP:3001/todos`. The response comes back the same way.

This pattern is called a **reverse proxy**: Nginx sits in front of VM2, acting on its behalf.

### The Exact Nginx Config

Create the config file:

```bash
sudo nano /etc/nginx/sites-available/todo-app
```

Paste this content (replace `VM2_PRIVATE_IP` with your actual value, e.g. `10.0.2.4`):

```nginx
server {
    listen 80;
    server_name _;   # _ matches any hostname/IP

    # Serve the React build output
    root /home/azureuser/frontend/dist;
    index index.html;

    # For any URL that isn't a real file, serve index.html
    # This is required for React Router to work — without it,
    # refreshing on /some-route would return 404
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse proxy: any request to /api/* gets forwarded to the backend
    location /api/ {
        # Strip the /api prefix before forwarding
        rewrite ^/api/(.*) /$1 break;

        # Forward to VM2's backend
        proxy_pass http://VM2_PRIVATE_IP:3001;

        # Pass the original headers so the backend knows the real client
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Increase timeout for slow backend responses
        proxy_read_timeout 30s;
    }
}
```

Enable this config (Nginx uses symlinks to activate configs):

```bash
# Remove the default site
sudo rm /etc/nginx/sites-enabled/default

# Enable your new config
sudo ln -s /etc/nginx/sites-available/todo-app /etc/nginx/sites-enabled/

# Test the config for syntax errors
sudo nginx -t
# Should print: configuration file /etc/nginx/nginx.conf test is successful

# Reload Nginx to apply changes
sudo systemctl reload nginx
```

**What success looks like:** Navigating to `http://VM1_PUBLIC_IP` in your browser loads the React app.

> **Common beginner mistake:** Editing the config but forgetting `sudo systemctl reload nginx`. Your changes don't apply until Nginx reloads. Note the difference: `reload` applies config changes without dropping connections. `restart` kills and restarts Nginx entirely.

### How the Request Flow Works

Here's the exact path of a request when a user adds a todo:

```
User's Browser
    │
    │  POST http://VM1_PUBLIC_IP/api/todos
    │  Body: { "title": "Buy milk" }
    ▼
Nginx on VM1 (port 80)
    │  Matches location /api/
    │  Rewrites to: POST http://10.0.2.4:3001/todos
    ▼
Node.js/Express on VM2 (port 3001)
    │  Receives POST /todos
    │  Calls Prisma to insert into DB
    ▼
PostgreSQL on VM3 (port 5432)
    │  Inserts row, returns new todo
    ▼
Node.js on VM2
    │  Returns: { id: 1, title: "Buy milk", completed: false, ... }
    ▼
Nginx on VM1
    │  Forwards response to browser
    ▼
User's Browser
    React updates the todo list
```

---

## 7. End-to-End Testing

### Browser Test

1. Open your browser and go to: `http://VM1_PUBLIC_IP`
2. You should see the Ekam's Todos interface.
3. Type a task and click "+ Add" — it should appear in the list.
4. Check the checkbox to mark it complete — the style should change.
5. Click delete — it should disappear.

If any of these steps fail, check the browser's developer console (F12 → Console tab) for error messages.

### Curl Tests From VM1

These test the internal routing:

```bash
# Test 1: Can VM1 reach the backend through Nginx proxy?
curl http://localhost/api/todos
# Expected: [] or a JSON array of todos

# Test 2: Create a todo
curl -X POST http://localhost/api/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Test from curl"}'
# Expected: {"id":1,"title":"Test from curl","completed":false,"createdAt":"..."}

# Test 3: Fetch all todos (should now have one)
curl http://localhost/api/todos
# Expected: [{"id":1,"title":"Test from curl",...}]
```

### Direct Backend Test From VM2

SSH into VM2 and test Node.js directly (bypassing Nginx):

```bash
# Test the backend directly
curl http://localhost:3001/todos
# Expected: same JSON array

# Check PM2 is running
pm2 status
# Expected: todo-backend | online

# Check the logs for errors
pm2 logs todo-backend --lines 20
```

### PostgreSQL Verification From VM3

SSH into VM3 and confirm the data is actually in the database:

```bash
# Connect to the database
psql -U todouser -d tododb

# List all todos
SELECT * FROM "Todo";
# Expected: rows showing your test todos

# Confirm table structure
\d "Todo"
# Expected: shows id, title, completed, createdAt columns

# Exit
\q
```

### Connectivity Test Between VMs

From VM2, verify you can reach VM3's PostgreSQL:
```bash
# Should show "1" if connection works
psql -h VM3_PRIVATE_IP -U todouser -d tododb -c "SELECT 1;"
```

From VM1, verify you can reach VM2's backend:
```bash
curl http://VM2_PRIVATE_IP:3001/todos
# Expected: JSON array
```

Verify VM3 is NOT reachable from VM1 (as expected by security design):
```bash
# From VM1 — this should FAIL (connection refused or timeout)
curl http://VM3_PRIVATE_IP:5432
# Expected: connection refused or timeout — this is correct behavior!
```

---

## Common Issues and Fixes

| Problem | Likely Cause | Fix |
|---|---|---|
| Browser gets `ERR_CONNECTION_REFUSED` | Nginx not running or NSG blocking port 80 | `sudo systemctl status nginx` on VM1; check NSG rules |
| API calls return 502 Bad Gateway | Nginx can't reach VM2 | Verify backend is running: `pm2 status` on VM2 |
| `pm2 start` works but todos don't save | Wrong DATABASE_URL in .env | Check `.env` on VM2 has correct VM3 private IP and password |
| Prisma migration fails | PostgreSQL not accepting connections from VM2 | Check `pg_hba.conf` on VM3 and restart postgres |
| Can't SSH into VM2 from VM1 | Didn't use `ssh -A` flag | Re-SSH into VM1 with `ssh -A azureuser@VM1_PUBLIC_IP` |
| React app loads but API calls fail | `VITE_API_URL` set wrong or Nginx proxy misconfigured | Check browser network tab for the exact URL being called |
| `npm run build` env var not applied | Wrong file name or missing VITE_ prefix | Must be `VITE_API_URL` (not `API_URL`) in `.env.production` |

---

## Architecture Summary

```
                        Internet
                           │
                    ┌──────┴──────┐
                    │  Public IP  │
                    │  VM1 (Nginx)│ ← subnet1: 10.0.1.0/24
                    │             │   NSG: allows 80, 443, 22 from internet
                    └──────┬──────┘
                           │ Private IP: 10.0.2.4
                    ┌──────┴──────┐
                    │  VM2 (Node) │ ← subnet2: 10.0.2.0/24
                    │  PM2 :3001  │   NSG: allows 3001, 22 from subnet1 only
                    └──────┬──────┘
                           │ Private IP: 10.0.3.4
                    ┌──────┴──────┐
                    │ VM3 (PgSQL) │ ← subnet3: 10.0.3.0/24
                    │  Port 5432  │   NSG: allows 5432, 22 from subnet2 only
                    └─────────────┘

All 3 subnets → NAT Gateway → Internet (for outbound package installs)
```

**Security model in one sentence:** The internet can only touch VM1. VM1 can only touch VM2. VM2 can only touch VM3. Each layer is isolated by NSG rules, and no private VM is directly reachable from outside.
