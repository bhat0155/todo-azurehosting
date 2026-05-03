variable "resource_group_name" {
  type        = string
  description = "Name of the resource group"
  default     = "todo-azure-rg"
}

variable "location" {
  type        = string
  description = "Location of the resource group"
  default     = "East US"
}

variable "environment" {
  type    = string
  default = "prod"
}


variable "vm_size" {
  type    = string
  default = "Standard_D2s_v3"
}

variable "admin_username" {
  type    = string
  default = "azureuser"
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_rsa.pub"
}

variable "db_user" {
  type      = string
  default   = "todouser"
  sensitive = true
}


variable "db_password" {
  type      = string
  sensitive = true
}