#!/bin/bash

# Install Solana CLI tools if not already installed
if ! command -v solana &> /dev/null; then
    echo "Installing Solana CLI tools..."
    sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
    export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
fi

# Install dependencies
npm install

# Copy .env file to the system directory
sudo cp ../.env /etc/vanity-wallet.env

# Create systemd service file
sudo tee /etc/systemd/system/vanity-wallet.service << EOF
[Unit]
Description=Vanity Wallet Generator Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/ubuntu/griffai/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/etc/vanity-wallet.env

[Install]
WantedBy=multi-user.target
EOF

# Set proper permissions for the environment file
sudo chmod 600 /etc/vanity-wallet.env

# Stop the service if it's already running
sudo systemctl stop vanity-wallet

# Check if port 80 is still in use
if lsof -i :80 >/dev/null 2>&1; then
    echo "Port 80 is still in use. Attempting to kill the process..."
    sudo lsof -ti :80 | xargs sudo kill -9
fi

# Reload systemd and restart service
sudo systemctl daemon-reload
sudo systemctl enable vanity-wallet
sudo systemctl restart vanity-wallet

echo "Deployment complete! Service status:"
sudo systemctl status vanity-wallet