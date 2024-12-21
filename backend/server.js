 const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Keypair } = require('@solana/web3.js');
const path = require('path');

const app = express();

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

const server = http.createServer(app);
const wss = new WebSocket.Server({
    noServer: true,
    perMessageDeflate: false,
    clientTracking: true,
    backlog: 100
});

// Handle upgrade event manually
server.on('upgrade', (request, socket, head) => {
    console.log('Received upgrade request');
    
    // Add CORS headers to upgrade response
    const responseHeaders = [
        'HTTP/1.1 101 Web Socket Protocol Handshake',
        'Upgrade: WebSocket',
        'Connection: Upgrade',
        'Access-Control-Allow-Origin: *'
    ];
    
    wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('WebSocket connection established');
        wss.emit('connection', ws, request);
    });
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Store active generation tasks
const activeTasks = new Map();

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    let isGenerating = false;
    let attempts = 0;
    let lastProgressUpdate = 0;

    // Send progress updates every 100ms at most
    const PROGRESS_UPDATE_INTERVAL = 100;

    const sendProgress = () => {
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
            const progressMessage = {
                type: 'progress',
                attempts
            };
            console.log('Sending progress update:', progressMessage);
            ws.send(JSON.stringify(progressMessage));
            lastProgressUpdate = now;
        }
    };

    ws.on('message', (message) => {
        console.log('Received message:', message.toString());
        try {
            const data = JSON.parse(message);
            console.log('Parsed message data:', data);

            if (data.type === 'start') {
                console.log('Start generation request received');
                if (isGenerating) {
                    console.log('Error: Generation already in progress');
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Generation already in progress'
                    }));
                    return;
                }
                
                if (!data.pattern || typeof data.pattern !== 'string' || data.pattern.length > 6) {
                    console.log('Error: Invalid pattern:', data.pattern);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid pattern. Must be 1-6 characters.'
                    }));
                    return;
                }

                console.log('Starting generation with pattern:', data.pattern);
                isGenerating = true;
                attempts = 0;
                lastProgressUpdate = 0;
                const pattern = data.pattern.toLowerCase();
                
                // Start generation in a separate thread
                const generateAddress = () => {
                    try {
                        if (!isGenerating) {
                            console.log('Generation stopped');
                            return;
                        }

                        // Process addresses in small batches to prevent blocking
                        const BATCH_SIZE = 100;
                        console.log(`Processing batch of ${BATCH_SIZE} addresses`);
                        
                        for (let i = 0; i < BATCH_SIZE; i++) {
                            attempts++;
                            
                            const keypair = Keypair.generate();
                            const address = keypair.publicKey.toString();

                            if (address.toLowerCase().startsWith(pattern)) {
                                console.log('Found matching address:', address);
                                const result = {
                                    type: 'found',
                                    result: {
                                        publicKey: address,
                                        secretKey: Array.from(keypair.secretKey)
                                    },
                                    attempts
                                };
                                ws.send(JSON.stringify(result));
                                console.log('Sent result to client');
                                isGenerating = false;
                                return;
                            }
                        }

                        // Send progress update
                        sendProgress();

                        // Continue generation in next tick
                        if (isGenerating) {
                            setImmediate(() => {
                                try {
                                    generateAddress();
                                } catch (error) {
                                    console.error('Error in generateAddress setImmediate:', error);
                                    ws.send(JSON.stringify({
                                        type: 'error',
                                        message: 'Internal generation error'
                                    }));
                                    isGenerating = false;
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error in generateAddress:', error);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Internal generation error'
                        }));
                        isGenerating = false;
                    }
                };

                console.log('Starting address generation loop');
                generateAddress();
            }

            if (data.type === 'stop') {
                isGenerating = false;
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Internal server error'
            }));
        }
    });

    ws.on('close', () => {
        isGenerating = false;
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        isGenerating = false;
    });

    // Send initial connection success message
    ws.send(JSON.stringify({
        type: 'status',
        message: 'Connected to server'
    }));
});

// Error handling for the server
server.on('error', (error) => {
    console.error('Server error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} (0.0.0.0)`);
});