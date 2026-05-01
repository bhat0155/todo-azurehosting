# Terraform Integration Roadmap

This guide walks you through converting your manually-deployed Azure three-tier todo app into a fully automated infrastructure using Terraform. No prior Terraform knowledge required.

---

## Table of Contents

1. [What is Terraform and Why Use It](#1-what-is-terraform-and-why-use-it)
2. [How Terraform Works](#2-how-terraform-works)
3. [Prerequisites](#3-prerequisites)
4. [Project Structure](#4-project-structure)
5. [Phase 1 — Installation and Authentication](#phase-1--installation-and-authentication)
6. [Phase 2 — Core Networking (VNet, Subnets, NSGs)](#phase-2--core-networking-vnet-subnets-nsgs)
7. [Phase 3 — NAT Gateway](#phase-3--nat-gateway)
8. [Phase 4 — Virtual Machines](#phase-4--virtual-machines)
9. [Phase 5 — Variables and Outputs](#phase-5--variables-and-outputs)
10. [Phase 6 — Remote State (Keeping State Safe)](#phase-6--remote-state-keeping-state-safe)
11. [Phase 7 — Running Terraform](#phase-7--running-terraform)
12. [Phase 8 — Destroy and Rebuild](#phase-8--destroy-and-rebuild)
13. [Phase 9 — CI/CD Automation (GitHub Actions)](#phase-9--cicd-automation-github-actions)
14. [Common Mistakes to Avoid](#common-mistakes-to-avoid)
15. [Terraform Command Cheat Sheet](#terraform-command-cheat-sheet)

---

## 1. What is Terraform and Why Use It

### The Problem With Your Current Setup

Right now, your Azure infrastructure (3 VMs, VNet, subnets, NSGs, NAT Gateway) was created manually through the Azure Portal. This means:

- **Fragile** — If you accidentally delete a resource or need to rebuild it, you have to remember every click and setting.
- **Not reproducible** — You can't spin up an identical environment for testing or staging.
- **No history** — There's no record of what changed or why.
- **Time-consuming** — Recreating the full three-tier setup takes hours of manual work.

### What Terraform Solves

Terraform lets you describe your entire Azure infrastructure in code files (`.tf` files). Once written:

```
terraform apply
```

…and all three VMs, the virtual network, subnets, NSGs, and NAT Gateway are created automatically in minutes. Run it again and nothing changes (Terraform only modifies what's different). Delete everything with:

```
terraform destroy
```

### Key Benefits for This Project

| Before Terraform | After Terraform |
|-----------------|-----------------|
| Hours of clicking in Azure Portal | `terraform apply` in ~5 minutes |
| "I think I set that NSG rule correctly" | NSG rules are in code, reviewable, version-controlled |
| One environment (prod only) | Spin up dev/staging/prod with different variable values |
| Rebuild from scratch if something breaks | Rebuild identically from code |
| Onboarding a teammate = sending a 600-line markdown doc | Clone repo + `terraform apply` |

---

## 2. How Terraform Works

Terraform follows a simple three-step mental model:

```
Write (.tf files)  →  Plan (preview changes)  →  Apply (create real infrastructure)
```

### The State File

Terraform keeps a file called `terraform.tfstate` that tracks what it has already created. When you run `terraform apply`, it compares:

- **What you wrote** in your `.tf` files (desired state)
- **What exists** in the state file (known state)
- **What actually exists** in Azure (real state)

It then calculates only the changes needed. This is called a **diff** or **plan**.

> **Important:** The state file is sensitive — it contains resource IDs, IP addresses, and sometimes passwords. Never commit it to git. We address this in Phase 6.

### Providers

Terraform uses plugins called "providers" to talk to cloud APIs. For Azure you use the `azurerm` provider (Azure Resource Manager). You declare it once and Terraform handles all API calls.

---

## 3. Prerequisites

Before writing any Terraform code, you need these tools installed on your local machine.

### Required Tools

| Tool | Purpose | Check if installed |
|------|---------|-------------------|
| Terraform CLI | Runs your `.tf` files | `terraform --version` |
| Azure CLI (`az`) | Authenticates Terraform to Azure | `az --version` |
| Git | Version control for your `.tf` files | `git --version` |

### Install Terraform (macOS)

```bash
# Using Homebrew (recommended)
brew tap hashicorp/tap
brew install hashicorp/tap/terraform

# Verify installation
terraform --version
# Expected output: Terraform v1.x.x
```

### Install Azure CLI (macOS)

```bash
brew install azure-cli

# Verify
az --version
```

### Login to Azure

```bash
az login
# A browser window will open — sign in with your Azure account
# After login, your terminal will show your subscription info

# Confirm you're in the right subscription
az account show
# Look for "name" and "id" fields
```

---

## 4. Project Structure

Create a new directory inside your project for all Terraform files.

```
todo-azure/
├── frontend/
├── backend/
├── AZURE_DEPLOYMENT.md
├── terraform.md          ← this file
└── infra/                ← NEW: all Terraform code lives here
    ├── main.tf           ← provider config, resource group
    ├── networking.tf     ← VNet, subnets, NSGs
    ├── nat_gateway.tf    ← NAT Gateway
    ├── vms.tf            ← all three VMs
    ├── variables.tf      ← input variables (customizable values)
    ├── outputs.tf        ← useful values printed after apply
    └── terraform.tfvars  ← your actual variable values (gitignored)
```

### Why Split Into Multiple Files?

Terraform automatically reads all `.tf` files in a directory. Splitting by concern (networking, VMs, outputs) makes the code easier to navigate. There's no technical requirement — you could put everything in `main.tf` — but one massive file becomes hard to read quickly.

### Create the Directory

```bash
mkdir infra
cd infra
```

---

## Phase 1 — Installation and Authentication

### Step 1.1 — Create `main.tf`

This file tells Terraform which provider to use (Azure) and which version, and creates the resource group that will contain everything.

```hcl
# infra/main.tf

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location

  tags = {
    project     = "todo-azure"
    environment = var.environment
    managed_by  = "terraform"
  }
}
```

**What each block means:**

- `terraform {}` — Terraform itself configuration. We specify the minimum Terraform version and which providers we need.
- `required_providers` — Tells Terraform to download the Azure plugin from HashiCorp's registry.
- `provider "azurerm"` — Configures the Azure provider. `features {}` is required by the provider (even if empty).
- `resource "azurerm_resource_group" "main"` — Creates an Azure Resource Group. The two strings are the resource type and a local name you choose (used to reference this resource elsewhere in your code).

### Step 1.2 — Initialize Terraform

Run this once when you first set up the project or add a new provider. It downloads the provider plugin.

```bash
cd infra
terraform init
```

Expected output:
```
Initializing provider plugins...
- Finding hashicorp/azurerm versions matching "~> 3.100"...
- Installing hashicorp/azurerm v3.x.x...

Terraform has been successfully initialized!
```

This creates a `.terraform/` directory (contains downloaded providers — add to `.gitignore`) and a `.terraform.lock.hcl` file (records exact provider versions — **commit this to git**).

---

## Phase 2 — Core Networking (VNet, Subnets, NSGs)

This recreates your existing network topology in code. Your current setup has:
- 1 Virtual Network: `fullstack_vnet` (10.0.0.0/16)
- 3 Subnets: frontendsubnet, backendsubnet, databasesubnet
- 3 NSGs with tiered access rules

### Step 2.1 — Create `networking.tf`

```hcl
# infra/networking.tf

# ─── Virtual Network ───────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "main" {
  name                = "fullstack_vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  tags = {
    project = "todo-azure"
  }
}

# ─── Subnets ───────────────────────────────────────────────────────────────────

resource "azurerm_subnet" "frontend" {
  name                 = "frontendsubnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.0.0/24"]
}

resource "azurerm_subnet" "backend" {
  name                 = "backendsubnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "database" {
  name                 = "databasesubnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.2.0/24"]
}

# ─── Network Security Groups ───────────────────────────────────────────────────

# Frontend NSG — allows HTTP (80) and SSH (22) from internet
resource "azurerm_network_security_group" "frontend" {
  name                = "nsg-frontend"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "AllowHTTP"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowSSH"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

# Backend NSG — allows port 3001 and SSH only from frontend subnet
resource "azurerm_network_security_group" "backend" {
  name                = "nsg-backend"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "AllowBackendAPIFromFrontend"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3001"
    source_address_prefix      = "10.0.0.0/24"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowSSHFromFrontend"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "10.0.0.0/24"
    destination_address_prefix = "*"
  }
}

# Database NSG — allows PostgreSQL (5432) and SSH only from backend subnet
resource "azurerm_network_security_group" "database" {
  name                = "nsg-database"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "AllowPostgresFromBackend"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5432"
    source_address_prefix      = "10.0.1.0/24"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowSSHFromBackend"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "10.0.1.0/24"
    destination_address_prefix = "*"
  }
}

# ─── NSG Associations (attach NSG to each subnet) ──────────────────────────────

resource "azurerm_subnet_network_security_group_association" "frontend" {
  subnet_id                 = azurerm_subnet.frontend.id
  network_security_group_id = azurerm_network_security_group.frontend.id
}

resource "azurerm_subnet_network_security_group_association" "backend" {
  subnet_id                 = azurerm_subnet.backend.id
  network_security_group_id = azurerm_network_security_group.backend.id
}

resource "azurerm_subnet_network_security_group_association" "database" {
  subnet_id                 = azurerm_subnet.database.id
  network_security_group_id = azurerm_network_security_group.database.id
}
```

**Key concept — resource references:**

Notice `azurerm_resource_group.main.name` — this is how you reference another resource. The pattern is `resource_type.local_name.attribute`. Terraform automatically understands the dependency: it will create the resource group before the VNet, and the VNet before the subnets. You don't need to think about ordering.

---

## Phase 3 — NAT Gateway

Your private VMs (backend and database) need outbound internet access to install packages (Node.js, PostgreSQL, etc.) but shouldn't be reachable from the internet. The NAT Gateway enables this.

### Step 3.1 — Create `nat_gateway.tf`

```hcl
# infra/nat_gateway.tf

# A public IP address for the NAT Gateway to use for outbound traffic
resource "azurerm_public_ip" "nat" {
  name                = "nat-gateway-pip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_nat_gateway" "main" {
  name                    = "nat-ekam"
  location                = azurerm_resource_group.main.location
  resource_group_name     = azurerm_resource_group.main.name
  sku_name                = "Standard"
  idle_timeout_in_minutes = 10
}

# Associate the public IP with the NAT Gateway
resource "azurerm_nat_gateway_public_ip_association" "main" {
  nat_gateway_id       = azurerm_nat_gateway.main.id
  public_ip_address_id = azurerm_public_ip.nat.id
}

# Attach NAT Gateway to backend subnet (VM2 needs outbound access)
resource "azurerm_subnet_nat_gateway_association" "backend" {
  subnet_id      = azurerm_subnet.backend.id
  nat_gateway_id = azurerm_nat_gateway.main.id
}

# Attach NAT Gateway to database subnet (VM3 needs outbound access)
resource "azurerm_subnet_nat_gateway_association" "database" {
  subnet_id      = azurerm_subnet.database.id
  nat_gateway_id = azurerm_nat_gateway.main.id
}
```

---

## Phase 4 — Virtual Machines

This is the most complex part. We create three VMs matching your current setup.

### Step 4.1 — Create `vms.tf`

```hcl
# infra/vms.tf

# ─── Public IP for Frontend VM (VM1 is internet-facing) ────────────────────────

resource "azurerm_public_ip" "frontend" {
  name                = "frontend-pip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

# ─── Network Interfaces ────────────────────────────────────────────────────────

resource "azurerm_network_interface" "frontend" {
  name                = "nic-frontend"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.frontend.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.0.0.4"
    public_ip_address_id          = azurerm_public_ip.frontend.id
  }
}

resource "azurerm_network_interface" "backend" {
  name                = "nic-backend"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.backend.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.0.1.4"
  }
}

resource "azurerm_network_interface" "database" {
  name                = "nic-database"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.database.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.0.2.4"
  }
}

# ─── VM1 — Frontend (Nginx + React static files) ───────────────────────────────

resource "azurerm_linux_virtual_machine" "frontend" {
  name                = "vm-frontend"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [azurerm_network_interface.frontend.id]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(var.ssh_public_key_path)
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  # Cloud-init script — runs once on first boot
  # Installs Nginx and sets up a placeholder config
  custom_data = base64encode(<<-EOF
    #!/bin/bash
    apt-get update -y
    apt-get install -y nginx
    systemctl enable nginx
    systemctl start nginx

    # Placeholder Nginx config — you will replace this with your actual config
    cat > /etc/nginx/sites-available/default <<'NGINX'
    server {
        listen 80;
        server_name _;

        root /var/www/html;
        index index.html;

        location /api/ {
            rewrite ^/api/(.*) /$1 break;
            proxy_pass http://10.0.1.4:3001;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location / {
            try_files $uri /index.html;
        }
    }
    NGINX

    nginx -t && systemctl reload nginx
  EOF
  )

  tags = {
    role = "frontend"
  }
}

# ─── VM2 — Backend (Node.js + Express + Prisma) ────────────────────────────────

resource "azurerm_linux_virtual_machine" "backend" {
  name                = "vm-backend"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [azurerm_network_interface.backend.id]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(var.ssh_public_key_path)
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  custom_data = base64encode(<<-EOF
    #!/bin/bash
    apt-get update -y

    # Install Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs

    # Install PM2 globally
    npm install -g pm2

    # Create app directory
    mkdir -p /home/${var.admin_username}/app
    chown ${var.admin_username}:${var.admin_username} /home/${var.admin_username}/app
  EOF
  )

  tags = {
    role = "backend"
  }
}

# ─── VM3 — Database (PostgreSQL 16) ────────────────────────────────────────────

resource "azurerm_linux_virtual_machine" "database" {
  name                = "vm-database"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [azurerm_network_interface.database.id]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(var.ssh_public_key_path)
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  custom_data = base64encode(<<-EOF
    #!/bin/bash
    apt-get update -y

    # Install PostgreSQL 16
    apt-get install -y postgresql-common
    /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
    apt-get install -y postgresql-16

    systemctl enable postgresql
    systemctl start postgresql

    # Create database and user
    sudo -u postgres psql -c "CREATE USER ${var.db_user} WITH PASSWORD '${var.db_password}';"
    sudo -u postgres psql -c "CREATE DATABASE tododb OWNER ${var.db_user};"
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE tododb TO ${var.db_user};"

    # Allow connections from backend subnet
    echo "host    tododb    ${var.db_user}    10.0.1.0/24    md5" >> /etc/postgresql/16/main/pg_hba.conf

    # Listen on all interfaces (within the private network)
    sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/16/main/postgresql.conf

    systemctl restart postgresql
  EOF
  )

  tags = {
    role = "database"
  }
}
```

**What is `custom_data`?**

This is a cloud-init script — a bash script that runs automatically the first time the VM boots. Terraform creates the VM and Azure runs this script inside it. This replaces the manual SSH-and-configure steps from your AZURE_DEPLOYMENT.md.

---

## Phase 5 — Variables and Outputs

Variables make your Terraform code reusable and keep secrets out of your code.

### Step 5.1 — Create `variables.tf`

This file declares what variables exist and their types. Think of it as a typed function signature.

```hcl
# infra/variables.tf

variable "resource_group_name" {
  description = "Name of the Azure resource group"
  type        = string
  default     = "todo-azure-rg"
}

variable "location" {
  description = "Azure region to deploy resources"
  type        = string
  default     = "East US"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "vm_size" {
  description = "Azure VM size for all three VMs"
  type        = string
  default     = "Standard_B1ms"
}

variable "admin_username" {
  description = "SSH username for all VMs"
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key_path" {
  description = "Path to your SSH public key file on your local machine"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "db_user" {
  description = "PostgreSQL username"
  type        = string
  default     = "todouser"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}
```

### Step 5.2 — Create `terraform.tfvars`

This file provides the actual values. **This file should be gitignored** (it may contain secrets).

```hcl
# infra/terraform.tfvars
# DO NOT COMMIT THIS FILE — add it to .gitignore

resource_group_name = "todo-azure-rg"
location            = "East US"
environment         = "prod"
vm_size             = "Standard_B1ms"
admin_username      = "azureuser"
ssh_public_key_path = "~/.ssh/id_rsa.pub"
db_user             = "todouser"
db_password         = "YourStrongPasswordHere123!"
```

### Step 5.3 — Create `outputs.tf`

Outputs are values Terraform prints after a successful `apply`. They help you know what was created.

```hcl
# infra/outputs.tf

output "frontend_public_ip" {
  description = "Public IP of the frontend VM — open this in your browser"
  value       = azurerm_public_ip.frontend.ip_address
}

output "frontend_ssh_command" {
  description = "SSH command to connect to the frontend VM"
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.frontend.ip_address}"
}

output "backend_private_ip" {
  description = "Private IP of the backend VM"
  value       = azurerm_network_interface.backend.private_ip_address
}

output "database_private_ip" {
  description = "Private IP of the database VM"
  value       = azurerm_network_interface.database.private_ip_address
}

output "database_url" {
  description = "DATABASE_URL for the backend .env file"
  value       = "postgresql://${var.db_user}:${var.db_password}@${azurerm_network_interface.database.private_ip_address}:5432/tododb?schema=public"
  sensitive   = true
}

output "nat_gateway_ip" {
  description = "Public IP used by private VMs for outbound traffic"
  value       = azurerm_public_ip.nat.ip_address
}
```

### Step 5.4 — Update `.gitignore`

Add these lines to your root `.gitignore`:

```
# Terraform
infra/.terraform/
infra/terraform.tfstate
infra/terraform.tfstate.backup
infra/*.tfvars
infra/.terraform.lock.hcl
```

Note: Commit `.terraform.lock.hcl` — it pins provider versions and prevents version drift across machines. Only ignore it if your team explicitly decides to allow provider updates freely.

---

## Phase 6 — Remote State (Keeping State Safe)

By default Terraform saves state locally (`terraform.tfstate`). This is dangerous because:
- If you lose the file, Terraform loses track of what it created
- If two people run `terraform apply` at the same time, the state file gets corrupted

The solution is **remote state** stored in Azure Blob Storage.

### Step 6.1 — Create the Storage Account (one time, manually)

This is the one thing you create manually — the bucket that holds your state file. You can't use Terraform to create this because the state storage must exist before Terraform can run.

```bash
# Run these Azure CLI commands once

# Create a resource group for Terraform state (separate from your app)
az group create \
  --name terraform-state-rg \
  --location "East US"

# Create a storage account (name must be globally unique — change "ekamtfstate" to something unique)
az storage account create \
  --name ekamtfstate \
  --resource-group terraform-state-rg \
  --location "East US" \
  --sku Standard_LRS \
  --kind StorageV2

# Create a container inside the storage account
az storage container create \
  --name tfstate \
  --account-name ekamtfstate
```

### Step 6.2 — Add Backend Config to `main.tf`

Update the `terraform {}` block in `main.tf` to add the backend:

```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }

  # Remote state stored in Azure Blob Storage
  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "ekamtfstate"       # change this to your unique name
    container_name       = "tfstate"
    key                  = "todo-azure.tfstate"
  }
}
```

After adding this, run `terraform init` again — it will migrate your local state to Azure.

---

## Phase 7 — Running Terraform

With all files in place, here is the exact workflow.

### First Time Setup

```bash
cd infra

# Step 1: Initialize (download providers, set up backend)
terraform init

# Step 2: Preview what Terraform will create — READ THIS CAREFULLY
terraform plan

# Step 3: Create all resources (will ask for confirmation)
terraform apply
```

When you run `terraform plan`, you'll see output like:

```
Plan: 18 to add, 0 to change, 0 to destroy.

  + azurerm_resource_group.main
  + azurerm_virtual_network.main
  + azurerm_subnet.frontend
  + azurerm_subnet.backend
  + azurerm_subnet.database
  + azurerm_network_security_group.frontend
  ... (and so on)
```

`+` means create, `~` means modify, `-` means destroy. Review this carefully before typing `yes`.

### After Apply — Get Your Outputs

```bash
terraform output
# Shows all outputs including the frontend public IP

terraform output frontend_public_ip
# Shows just that one value

terraform output -raw database_url
# Shows sensitive values (the -raw flag removes formatting)
```

### Making Changes

After the initial deploy, if you change a `.tf` file:

```bash
terraform plan   # see what will change
terraform apply  # apply the changes
```

Terraform will only modify what changed. For example, adding a new NSG rule will only update that security group — it won't recreate the VMs.

---

## Phase 8 — Destroy and Rebuild

One of Terraform's most powerful features: tear down everything cleanly.

```bash
# Preview what will be deleted
terraform plan -destroy

# Delete all managed resources
terraform destroy
```

This is useful when you want to:
- Stop paying for Azure resources between development sessions
- Start fresh after a misconfiguration
- Test that your infrastructure-as-code actually works from scratch

To rebuild everything:
```bash
terraform apply
```

All three VMs, networking, and configuration come back identically in ~5 minutes.

---

## Phase 9 — CI/CD Automation (GitHub Actions)

Once your Terraform code is working locally, you can automate it through GitHub Actions so that infrastructure changes are reviewed and applied automatically when you push to `main`.

### Step 9.1 — Create the Workflow File

Create `.github/workflows/terraform.yml` in your repository root:

```yaml
# .github/workflows/terraform.yml

name: Terraform

on:
  push:
    branches: [main]
    paths: [infra/**]      # only run when infra files change
  pull_request:
    branches: [main]
    paths: [infra/**]

permissions:
  id-token: write          # needed for OIDC authentication to Azure
  contents: read
  pull-requests: write

jobs:
  terraform:
    name: Terraform Plan & Apply
    runs-on: ubuntu-latest
    environment: production

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.8.x"

      - name: Azure Login
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Terraform Init
        working-directory: infra
        run: terraform init

      - name: Terraform Format Check
        working-directory: infra
        run: terraform fmt -check

      - name: Terraform Validate
        working-directory: infra
        run: terraform validate

      - name: Terraform Plan
        working-directory: infra
        run: terraform plan -out=tfplan -var="db_password=${{ secrets.DB_PASSWORD }}"
        env:
          TF_VAR_db_user: ${{ secrets.DB_USER }}

      # Only apply on push to main (not on pull requests)
      - name: Terraform Apply
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        working-directory: infra
        run: terraform apply -auto-approve tfplan
```

### Step 9.2 — Set Up GitHub Secrets

In your GitHub repository: **Settings → Secrets and variables → Actions**, add:

| Secret Name | Value |
|------------|-------|
| `AZURE_CLIENT_ID` | From Azure service principal |
| `AZURE_TENANT_ID` | From Azure service principal |
| `AZURE_SUBSCRIPTION_ID` | Your Azure subscription ID |
| `DB_USER` | todouser |
| `DB_PASSWORD` | Your database password |

### Step 9.3 — Create an Azure Service Principal

```bash
# Get your subscription ID
az account show --query id -o tsv

# Create a service principal with Contributor role
az ad sp create-for-rbac \
  --name "terraform-github-sp" \
  --role Contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID \
  --sdk-auth
```

Copy the output JSON values into the GitHub secrets above.

**How it works after setup:**
- You open a pull request changing a `.tf` file → GitHub Actions runs `terraform plan` and posts the plan output as a PR comment
- You merge to `main` → GitHub Actions runs `terraform apply` automatically

---

## Common Mistakes to Avoid

### 1. Committing `terraform.tfstate`

The state file contains sensitive data (private IPs, resource IDs, sometimes passwords). Always use remote state (Phase 6) and gitignore local state files.

### 2. Committing `terraform.tfvars`

This file contains your passwords and secrets. It's in the `.gitignore` section for a reason. Instead, pass sensitive values through environment variables or a secrets manager.

### 3. Running `terraform destroy` on production

`terraform destroy` deletes everything. Make sure you know which workspace/environment you're in before running it. Consider adding a `lifecycle { prevent_destroy = true }` block on critical resources:

```hcl
resource "azurerm_linux_virtual_machine" "database" {
  # ...
  lifecycle {
    prevent_destroy = true   # terraform destroy will error before deleting this
  }
}
```

### 4. Hardcoding the VM public IP in your frontend build

Your frontend currently has `VITE_API_URL=http://172.190.113.184/api` hardcoded. When Terraform creates a new frontend VM it will get a different IP. Fix this by using Terraform outputs to dynamically generate the `.env.production` file, or switch to a DNS name.

### 5. Forgetting `terraform init` after adding providers

Any time you add a new provider or change the backend configuration, run `terraform init` again.

### 6. Skipping `terraform plan`

Always run `terraform plan` before `terraform apply`. The plan output tells you exactly what will be created, changed, or deleted. Never run `terraform apply` blind.

---

## Terraform Command Cheat Sheet

| Command | What it does |
|---------|-------------|
| `terraform init` | Initialize directory, download providers |
| `terraform plan` | Preview changes without making them |
| `terraform apply` | Apply changes (prompts for confirmation) |
| `terraform apply -auto-approve` | Apply without confirmation prompt (use in CI only) |
| `terraform destroy` | Delete all managed resources |
| `terraform output` | Show all output values |
| `terraform output <name>` | Show a specific output |
| `terraform output -raw <name>` | Show output without formatting (good for scripts) |
| `terraform fmt` | Auto-format all `.tf` files |
| `terraform validate` | Check for syntax errors |
| `terraform show` | Show current state in readable form |
| `terraform state list` | List all resources Terraform is tracking |
| `terraform state show <resource>` | Show details of a specific resource |
| `terraform import <resource> <azure_id>` | Import an existing Azure resource into state |

---

## Final File Tree

After completing all phases, your `infra/` directory will look like:

```
infra/
├── main.tf              ← provider, backend, resource group
├── networking.tf        ← VNet, subnets, NSGs, associations
├── nat_gateway.tf       ← NAT Gateway + public IP
├── vms.tf               ← 3 VMs + NICs + frontend public IP
├── variables.tf         ← variable declarations
├── outputs.tf           ← useful values printed after apply
├── terraform.tfvars     ← your actual values (GITIGNORED)
└── .terraform.lock.hcl  ← provider version lock (COMMIT THIS)
```

---

## Recommended Learning Order

If this is your first time with Terraform, work through the phases in order and stop to verify each one works before moving on:

1. **Phase 1** — Get `terraform init` working with Azure authentication
2. **Phase 2** — Run `terraform plan` and verify the networking resources appear in the plan
3. **Phase 3** — Add NAT Gateway, run `terraform plan` again and check the diff
4. **Phase 5** — Set up variables before Phase 4 (VMs reference variables)
5. **Phase 4** — Add VMs, run `terraform apply`, SSH into VM1 to verify it's running
6. **Phase 6** — Migrate to remote state before sharing the repo with anyone
7. **Phase 9** — Add CI/CD only after local apply is fully working
