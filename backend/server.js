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
    BROADCAST_INTERVAL: 2000,
    totalAttempts: 0
};

const activeConnections = new Set();

const workerScript = `
const { parentPort } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

let currentPattern = null;
let patternLength = 0;
const BATCH_SIZE = 500000;

// Base58 alphabet and lookup table
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map(ALPHABET.split('').map((char, index) => [char, index]));

// Pre-allocate buffers
const seedBuffer = Buffer.alloc(32);
const pubkeyBuffer = Buffer.alloc(32);

// Efficient base58 encoding for prefix check
function base58Encode(buffer) {
    const digits = [0];
    for (let i = 0; i < buffer.length; i++) {
        let carry = buffer[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }

    // Leading zero bytes
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
        digits.push(0);
    }

    // Convert to base58 string
    let result = '';
    for (let i = digits.length - 1; i >= 0; i--) {
        result += ALPHABET[digits[i]];
    }
    
    return result;
}

function checkPrefix(pubkey) {
    const base58 = base58Encode(pubkey);
    return base58.toLowerCase().startsWith(currentPattern);
}

function setPattern(pattern) {
    currentPattern = pattern.toLowerCase();
    patternLength = pattern.length;
}

parentPort.on('message', ({ type, pattern }) => {
    if (type === 'setPattern') {
        setPattern(pattern);
    }
    else if (type === 'generate') {
        let found = false;
        let i = 0;
        
        const MINI_BATCH = 50000;
        const keypair = Keypair.fromSeed(seedBuffer);
        
        while (i < BATCH_SIZE) {
            const endBatch = Math.min(i + MINI_BATCH, BATCH_SIZE);
            
            for (; i < endBatch; i++) {
                crypto.randomFillSync(seedBuffer);
                keypair.secretKey.set(seedBuffer);
                pubkeyBuffer.set(keypair._keypair.publicKey);
                
                if (checkPrefix(pubkeyBuffer)) {
                    parentPort.postMessage({
                        type: 'found',
                        result: {
                            publicKey: keypair.publicKey.toBase58(),
                            secretKey: Array.from(keypair.secretKey)
                        }
                    });
                    found = true;
                    break;
                }
            }
            
            if (found) break;
            
            if (i % MINI_BATCH === 0) {
                parentPort.postMessage({ type: 'batch', count: i });
            }
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
        const message = `{"type":"progress","attempts":${progressTracker.totalAttempts}}`;
        
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

    const startGeneration = (pattern) => {
        ws.isGenerating = true;
        progressTracker.batchResults.set(ws.workerId, 0);

        workerPool.forEach(({ worker }) => {
            worker.postMessage({ type: 'setPattern', pattern });
        });

        workerPool.forEach(({ worker }, index) => {
            setTimeout(() => {
                if (ws.isGenerating) {
                    worker.postMessage({ type: 'generate' });
                }
            }, index * 50);
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
                    ws.isGenerating = false;
                    const totalAttempts = progressTracker.batchResults.get(ws.workerId) || 0;
                    
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'found',
                            result: message.result,
                            attempts: totalAttempts
                        }));
                    }
                    
                    progressTracker.batchResults.set(ws.workerId, 0);
                }
            } catch (error) {
                console.error('Worker message handler error:', error);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send('{"type":"error","message":"Internal processing error"}');
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
                    ws.send('{"type":"error","message":"Generation already in progress"}');
                    return;
                }

                if (!data.pattern || typeof data.pattern !== 'string' || data.pattern.length > 6) {
                    ws.send('{"type":"error","message":"Invalid pattern. Must be 1-6 characters."}');
                    return;
                }

                const validChars = /^[1-9A-HJ-NP-Za-km-z]+$/;
                if (!validChars.test(data.pattern)) {
                    ws.send('{"type":"error","message":"Pattern contains invalid characters"}');
                    return;
                }

                startGeneration(data.pattern);
            }

            if (data.type === 'stop') {
                ws.isGenerating = false;
                progressTracker.batchResults.set(ws.workerId, 0);
                broadcastProgress();
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send('{"type":"error","message":"Invalid message format"}');
        }
    });

    activeConnections.add(ws);

    const cleanup = () => {
        ws.isGenerating = false;
        progressTracker.batchResults.delete(ws.workerId);
        activeConnections.delete(ws);
        
        if (ws.workerHandlers) {
            ws.workerHandlers.forEach((handler, worker) => {
                worker.removeListener('message', handler);
            });
            ws.workerHandlers.clear();
        }

        workerPool.forEach(({ worker }) => {
            if (worker.workerId === ws.workerId) {
                worker.postMessage({ type: 'stop' });
            }
        });
    };

    ws.on('close', cleanup);

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        cleanup();
        
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send('{"type":"error","message":"Connection error occurred"}');
            } catch (e) {
                console.error('Failed to send error message:', e);
            }
        }
    });

    if (ws.readyState === WebSocket.OPEN) {
        ws.send('{"type":"status","message":"Connected to server"}');
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