# Griff Vanity Wallet Generator

## Deployment Instructions

### Backend (AWS Lightsail)

1. SSH into your Lightsail instance:
```bash
ssh ubuntu@18.192.211.91
```

2. Clone the repository and navigate to the backend directory:
```bash
git clone <your-repo-url>
cd griffai/backend
```

3. Run the deployment script:
```bash
./deploy.sh
```

The script will:
- Install dependencies
- Create a systemd service
- Start the server on port 80
- Enable automatic startup on reboot

To check server status:
```bash
sudo systemctl status vanity-wallet
```

To view logs:
```bash
journalctl -u vanity-wallet -f
```

### Frontend (Vercel)

1. Push your code to GitHub

2. Import your repository in Vercel:
   - Go to https://vercel.com
   - Click "New Project"
   - Import your GitHub repository
   - Select the frontend directory as the root directory
   - Deploy

3. After deployment, the frontend will automatically connect to the backend at ws://18.192.211.91

## Development

To run locally:

1. Start the backend:
```bash
cd backend
npm install
npm start
```

2. Open the frontend HTML file in your browser:
```bash
cd frontend
open vanity-wallet.html
```

The frontend will automatically connect to the local backend when running on localhost.