const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Keypair } = require('@solana/web3.js');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');
const crypto = require('crypto');

const app = express();
app.use(express.static(path.join(__dirname, '../frontend')));
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
    maxPayload: 1024 * 16
});

const NUM_WORKERS = Math.max(1, Math.floor(os.cpus().length / 2));
const workerPool = [];

const progressTracker = {
    batchResults: new Map(),
    lastBroadcast: 0,
    BROADCAST_INTERVAL: 100, // Reduced from 2000ms to 100ms for more responsive UI
    totalAttempts: 0
};

const activeConnections = new Set();

const workerScript = `
const { parentPort } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

let currentPattern = null;
let patternLength = 0;
const BATCH_SIZE = 10000; // Reduced from 500000 to 10000 for more frequent updates
const MINI_BATCH = 1000;  // Reduced from 50000 to 1000 for more frequent progress reports

function checkPrefix(keypair) {
    const pubkeyString = keypair.publicKey.toBase58();
    return pubkeyString.startsWith(currentPattern);
}

function setPattern(pattern) {
    currentPattern = pattern;
    patternLength = pattern.length;
}

parentPort.on('message', ({ type, pattern }) => {
    if (type === 'setPattern') {
        setPattern(pattern);
    }
    else if (type === 'stop') {
        // Stop generation by resetting pattern
        currentPattern = null;
        patternLength = 0;
    }
    else if (type === 'generate') {
        let found = false;
        let i = 0;
        
        while (i < BATCH_SIZE) {
            const endBatch = Math.min(i + MINI_BATCH, BATCH_SIZE);
            
            for (; i < endBatch; i++) {
                const newKeypair = new Keypair();
                
                if (checkPrefix(newKeypair)) {
                    parentPort.postMessage({
                        type: 'found',
                        result: {
                            publicKey: newKeypair.publicKey.toBase58(),
                            secretKey: Array.from(newKeypair.secretKey)
                        }
                    });
                    found = true;
                    break;
                }
            }
            
            if (found) break;
            
            // Report progress more frequently
            parentPort.postMessage({ type: 'batch', count: MINI_BATCH });
        }
        
        if (!found) {
            parentPort.postMessage({ type: 'batch', count: BATCH_SIZE });
        }
    }
});
`;

for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(workerScript, { eval: true });
    workerPool.push({
        worker,
        busy: false
    });
}

function broadcastProgress() {
    const now = Date.now();
    if (now - progressTracker.lastBroadcast >= progressTracker.BROADCAST_INTERVAL) {
        const message = JSON.stringify({
            type: 'progress',
            attempts: progressTracker.totalAttempts
        });
        
        const clients = wss.clients;
        for (const client of clients) {
            if (client.readyState === WebSocket.OPEN && client.isGenerating) {
                try {
                    client.send(message);
                } catch (e) {
                    // Ignore send errors
                }
            }
        }
        progressTracker.lastBroadcast = now;
    }
}

wss.on('connection', (ws) => {
    ws.isGenerating = false;
    ws.workerId = crypto.randomBytes(4).toString('hex');
    progressTracker.batchResults.set(ws.workerId, 0);

    const resetWorkers = () => {
        ws.isGenerating = false;
        progressTracker.batchResults.set(ws.workerId, 0);
        progressTracker.totalAttempts = 0;
        progressTracker.lastBroadcast = 0;
        
        // Stop and reset all workers
        workerPool.forEach(({ worker }) => {
            worker.postMessage({ type: 'setPattern', pattern: '' }); // Reset pattern
            worker.postMessage({ type: 'stop' }); // Stop current generation
        });
        broadcastProgress();
    };

    const startGeneration = (pattern) => {
        // First reset everything
        resetWorkers();
        
        // Then start new generation
        ws.isGenerating = true;
        progressTracker.batchResults.set(ws.workerId, 0);
        progressTracker.totalAttempts = 0;
        progressTracker.lastBroadcast = 0;

        workerPool.forEach(({ worker }) => {
            worker.postMessage({ type: 'setPattern', pattern });
        });

        workerPool.forEach(({ worker }, index) => {
            setTimeout(() => {
                if (ws.isGenerating) {
                    worker.postMessage({ type: 'generate' });
                }
            }, index * 20);
        });
    };

    const workerMessageHandlers = new Map();

    workerPool.forEach(({ worker }) => {
        const messageHandler = (message) => {
            if (!activeConnections.has(ws) || !ws.isGenerating) return;

            try {
                if (message.type === 'batch') {
                    progressTracker.totalAttempts += message.count;
                    
                    if (ws.readyState === WebSocket.OPEN) {
                        broadcastProgress();
                    }
                    
                    if (ws.isGenerating && ws.readyState === WebSocket.OPEN) {
                        setImmediate(() => worker.postMessage({ type: 'generate' }));
                    }
                } else if (message.type === 'found') {
                    const totalAttempts = progressTracker.totalAttempts;
                    
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'found',
                            result: message.result,
                            attempts: totalAttempts
                        }));
                    }
                    
                    // Reset everything after finding a match
                    resetWorkers();
                }
            } catch (error) {
                console.error('Worker message handler error:', error);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Internal processing error'
                    }));
                }
                ws.isGenerating = false;
                progressTracker.batchResults.set(ws.workerId, 0);
            }
        };

        messageHandler.owner = ws;
        worker.on('message', messageHandler);
        workerMessageHandlers.set(worker, messageHandler);
    });

    ws.workerHandlers = workerMessageHandlers;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'start') {
                if (ws.isGenerating) {
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

                const validChars = /^[1-9A-HJ-NP-Za-km-z]+$/;
                if (!validChars.test(data.pattern)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Pattern contains invalid characters'
                    }));
                    return;
                }

                startGeneration(data.pattern);
            }

            if (data.type === 'stop') {
                resetWorkers();
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });

    activeConnections.add(ws);

    const cleanup = () => {
        resetWorkers();
        progressTracker.batchResults.delete(ws.workerId);
        activeConnections.delete(ws);
        
        if (ws.workerHandlers) {
            ws.workerHandlers.forEach((handler, worker) => {
                worker.removeListener('message', handler);
            });
            ws.workerHandlers.clear();
        }
    };

    ws.on('close', cleanup);

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        cleanup();
        
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Connection error occurred'
                }));
            } catch (e) {
                console.error('Failed to send error message:', e);
            }
        }
    });

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'status',
            message: 'Connected to server'
        }));
    }
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

const PORT = process.env.PORT || 80;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});