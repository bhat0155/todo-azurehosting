output "frontend_public_ip" {
  description = "Public IP address of the frontend VM"
  value       = azurerm_public_ip.frontend.ip_address
}

output "frontend_ssh_command" {
  description = "SSH command to connect to the frontend VM"
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.frontend.ip_address}"
}

output "backend_private_ip" {
  description = "Private IP address of the backend VM"
  value       = azurerm_network_interface.backend.private_ip_address
}

output "database_private_ip" {
  description = "Private IP address of the database VM"
  value       = azurerm_network_interface.database.private_ip_address
}

output "nat_gateway_ip" {
  description = "Public IP address of the NAT Gateway"
  value       = azurerm_public_ip.nat.ip_address
}
