const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Keypair } = require('@solana/web3.js');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');

const app = express();

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

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

// Store active generation tasks
const activeTasks = new Map();

// Create a worker pool
const NUM_WORKERS = Math.max(1, os.cpus().length - 1); // Leave one core free for the main thread
const workerPool = [];

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    let isGenerating = false;
    let totalAttempts = 0;
    let lastProgressUpdate = 0;
    let activeWorkers = [];

    // Increase progress update interval to reduce overhead
    const PROGRESS_UPDATE_INTERVAL = 250; // 250ms instead of 100ms

    const sendProgress = () => {
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
            ws.send(JSON.stringify({
                type: 'progress',
                attempts: totalAttempts
            }));
            lastProgressUpdate = now;
        }
    };

    // Function to create a new worker
    const createWorker = (pattern) => {
        const worker = new Worker(`
            const { parentPort } = require('worker_threads');
            const { Keypair } = require('@solana/web3.js');

            // Pre-compile pattern to regex for faster matching
            const patternRegex = new RegExp('^' + '${pattern}', 'i');
            
            // Larger batch size for better performance
            const BATCH_SIZE = 1000;

            parentPort.on('message', ({ type }) => {
                if (type === 'generate') {
                    try {
                        for (let i = 0; i < BATCH_SIZE; i++) {
                            const keypair = Keypair.generate();
                            const address = keypair.publicKey.toString();
                            
                            // Use regex test for faster matching
                            if (patternRegex.test(address)) {
                                parentPort.postMessage({
                                    type: 'found',
                                    result: {
                                        publicKey: address,
                                        secretKey: Array.from(keypair.secretKey)
                                    }
                                });
                                return;
                            }
                        }
                        // Report batch completion
                        parentPort.postMessage({ type: 'batch', count: BATCH_SIZE });
                    } catch (error) {
                        parentPort.postMessage({ type: 'error', error: error.message });
                    }
                }
            });
        `, { eval: true });

        worker.on('message', (message) => {
            if (!isGenerating) return;

            if (message.type === 'batch') {
                totalAttempts += message.count;
                sendProgress();
                if (isGenerating) {
                    worker.postMessage({ type: 'generate' });
                }
            } else if (message.type === 'found') {
                isGenerating = false;
                ws.send(JSON.stringify({
                    type: 'found',
                    result: message.result,
                    attempts: totalAttempts
                }));
                stopWorkers();
            } else if (message.type === 'error') {
                console.error('Worker error:', message.error);
            }
        });

        worker.on('error', (error) => {
            console.error('Worker error:', error);
        });

        return worker;
    };

    const stopWorkers = () => {
        activeWorkers.forEach(worker => worker.terminate());
        activeWorkers = [];
    };

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'start') {
                if (isGenerating) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Generation already in progress'
                    }));
                    return;
                }
                
                if (!data.pattern || typeof data.pattern !== 'string' || data.pattern.length > 6) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid pattern. Must be 1-6 characters.'
                    }));
                    return;
                }

                isGenerating = true;
                totalAttempts = 0;
                lastProgressUpdate = 0;
                const pattern = data.pattern.toLowerCase();

                // Start multiple workers
                for (let i = 0; i < NUM_WORKERS; i++) {
                    const worker = createWorker(pattern);
                    activeWorkers.push(worker);
                    worker.postMessage({ type: 'generate' });
                }
            }

            if (data.type === 'stop') {
                isGenerating = false;
                stopWorkers();
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
        stopWorkers();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        isGenerating = false;
        stopWorkers();
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
const PORT = process.env.PORT || 80;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} (0.0.0.0)`);
});