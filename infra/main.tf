terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }

  backend "azurerm" {
    resource_group_name  = "NetworkWatcherRG"
    storage_account_name = "ekamterra"
    container_name       = "demo"
    key                  = "todo-azure.tfstate"
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