#!/bin/bash

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

# Reload systemd and restart service
sudo systemctl daemon-reload
sudo systemctl enable vanity-wallet
sudo systemctl restart vanity-wallet

echo "Deployment complete! Service status:"
sudo systemctl status vanity-wallet