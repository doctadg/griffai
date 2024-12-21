const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Keypair } = require('@solana/web3.js');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname)));

// Store active generation tasks
const activeTasks = new Map();

// WebSocket connection handling
wss.on('connection', (ws) => {
    const taskId = crypto.randomUUID();
    let isGenerating = false;
    let attempts = 0;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'start') {
            if (isGenerating) return;
            
            isGenerating = true;
            attempts = 0;
            const pattern = data.pattern.toLowerCase();
            
            // Store task reference
            activeTasks.set(taskId, true);

            // Start generation in a separate thread
            const generateAddress = () => {
                if (!activeTasks.get(taskId)) {
                    isGenerating = false;
                    return;
                }

                attempts++;
                if (attempts % 100 === 0) {
                    ws.send(JSON.stringify({
                        type: 'progress',
                        attempts
                    }));
                }

                const keypair = Keypair.generate();
                const address = keypair.publicKey.toString();

                if (address.slice(0, pattern.length + 1).toLowerCase().includes(pattern)) {
                    ws.send(JSON.stringify({
                        type: 'found',
                        result: {
                            publicKey: address,
                            secretKey: Array.from(keypair.secretKey)
                        },
                        attempts
                    }));
                    activeTasks.delete(taskId);
                    isGenerating = false;
                } else {
                    // Continue generation in next tick to prevent blocking
                    setImmediate(generateAddress);
                }
            };

            generateAddress();
        }

        if (data.type === 'stop') {
            activeTasks.delete(taskId);
            isGenerating = false;
        }
    });

    ws.on('close', () => {
        activeTasks.delete(taskId);
        isGenerating = false;
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});