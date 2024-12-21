#!/bin/bash

# Install dependencies
npm install

# Create systemd service file
sudo tee /etc/systemd/system/vanity-wallet.service << EOF
[Unit]
Description=Vanity Wallet Generator Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/griffai/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and restart service
sudo systemctl daemon-reload
sudo systemctl enable vanity-wallet
sudo systemctl restart vanity-wallet

echo "Deployment complete! Service status:"
sudo systemctl status vanity-wallet