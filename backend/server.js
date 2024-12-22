const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Keypair } = require('@solana/web3.js');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');

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
    perMessageDeflate: {
        zlibDeflateOptions: {
            level: 1 // Fast compression
        }
    },
    maxPayload: 1024 * 16 // 16KB max message size
});

// Create worker pool at startup - use all cores minus one for the main thread
const NUM_WORKERS = Math.max(1, os.cpus().length - 1);
const workerPool = [];

// Shared progress tracking
const progressTracker = {
    batchResults: new Map(),
    lastBroadcast: 0,
    BROADCAST_INTERVAL: 100 // More frequent updates
};

// Worker script as a separate string for better readability
const workerScript = `
const { parentPort } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

let currentPattern = null;
let patternLength = 0;
const BATCH_SIZE = 50000; // Increased batch size for better throughput

// Base58 alphabet and lookup optimization
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Uint8Array(128);
const PATTERN_CHARS = new Uint8Array(6); // Pre-allocate pattern chars
for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET.charCodeAt(i)] = i;
}

// Pre-allocate buffers with direct Buffer views for better performance
const seedBuffer = Buffer.alloc(32);
const pubkeyBuffer = Buffer.alloc(32);
const base58Cache = Buffer.alloc(45); // Max base58 length for 32 bytes
const view = new DataView(pubkeyBuffer.buffer); // Direct view for faster reads

// Optimized base58 check using lookup table and DataView for faster reads
function checkPrefix(pubkey) {
    // Read first 4 bytes as a 32-bit integer for faster processing
    const firstWord = view.getUint32(0, true); // true for little-endian
    let carry = BigInt(firstWord);
    
    // Only process more bytes if needed based on pattern length
    if (patternLength > 4) {
        carry = (carry << 8n) + BigInt(pubkey[4]);
        if (patternLength > 5) {
            carry = (carry << 8n) + BigInt(pubkey[5]);
        }
    }
    
    // Unrolled base58 conversion for first few characters (most common case)
    let j = 0;
    const firstChar = Number(carry % 58n);
    base58Cache[j++] = ALPHABET.charCodeAt(firstChar);
    carry = carry / 58n;
    
    if (carry > 0n) {
        const secondChar = Number(carry % 58n);
        base58Cache[j++] = ALPHABET.charCodeAt(secondChar);
        carry = carry / 58n;
        
        while (carry > 0n && j < patternLength) {
            const nextChar = Number(carry % 58n);
            base58Cache[j++] = ALPHABET.charCodeAt(nextChar);
            carry = carry / 58n;
        }
    }
    
    // Direct byte comparison with early exit
    for (let i = 0; i < patternLength; i++) {
        if (base58Cache[patternLength - 1 - i] !== PATTERN_CHARS[i]) {
            return false;
        }
    }
    return true;
}

// Pre-compile pattern for faster matching
function setPattern(pattern) {
    currentPattern = pattern.toLowerCase();
    patternLength = pattern.length;
    // Pre-fill pattern chars for faster comparison
    for (let i = 0; i < patternLength; i++) {
        PATTERN_CHARS[i] = currentPattern.charCodeAt(i);
    }
}

parentPort.on('message', ({ type, pattern }) => {
    if (type === 'setPattern') {
        setPattern(pattern);
    }
    else if (type === 'generate') {
        let found = false;
        let i = 0;
        
        // Process in smaller chunks to avoid blocking the event loop
        while (i < BATCH_SIZE) {
            // Process mini-batch of addresses
            const MINI_BATCH = 1000;
            const endBatch = Math.min(i + MINI_BATCH, BATCH_SIZE);
            
            for (; i < endBatch; i++) {
                crypto.randomFillSync(seedBuffer);
                const keypair = Keypair.fromSeed(seedBuffer);
                pubkeyBuffer.set(keypair.publicKey.toBytes());
                
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
            
            // Allow event loop to process other messages
            if (i < BATCH_SIZE) {
                setImmediate(() => {
                    parentPort.postMessage({ type: 'batch', count: i });
                });
            }
        }
        
        if (!found) {
            parentPort.postMessage({ type: 'batch', count: BATCH_SIZE });
        }
    }
});
`;

// Initialize worker pool
for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(workerScript, { eval: true });
    workerPool.push({
        worker,
        busy: false
    });
}

// Broadcast progress to all connected clients
function broadcastProgress() {
    const now = Date.now();
    if (now - progressTracker.lastBroadcast >= progressTracker.BROADCAST_INTERVAL) {
        let totalAttempts = 0;
        for (const attempts of progressTracker.batchResults.values()) {
            totalAttempts += attempts;
        }

        const message = `{"type":"progress","attempts":${totalAttempts}}`;
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.isGenerating) {
                client.send(message);
            }
        });
        progressTracker.lastBroadcast = now;
    }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    ws.isGenerating = false;
    ws.workerId = crypto.randomBytes(4).toString('hex');
    progressTracker.batchResults.set(ws.workerId, 0);

    const startGeneration = (pattern) => {
        ws.isGenerating = true;
        progressTracker.batchResults.set(ws.workerId, 0);

        // Set pattern for all workers
        workerPool.forEach(({ worker }) => {
            worker.postMessage({ type: 'setPattern', pattern });
        });

        // Start generation on all workers with staggered delays
        workerPool.forEach(({ worker }, index) => {
            setTimeout(() => {
                if (ws.isGenerating) {
                    worker.postMessage({ type: 'generate' });
                }
            }, index * 50); // Stagger worker starts to prevent CPU spikes
        });
    };

    // Set up worker message handlers with improved batching
    workerPool.forEach(({ worker }) => {
        worker.on('message', (message) => {
            if (!ws.isGenerating) return;

            if (message.type === 'batch') {
                progressTracker.batchResults.set(
                    ws.workerId,
                    (progressTracker.batchResults.get(ws.workerId) || 0) + message.count
                );
                broadcastProgress();
                
                if (ws.isGenerating) {
                    // Use setImmediate for better event loop handling
                    setImmediate(() => {
                        worker.postMessage({ type: 'generate' });
                    });
                }
            } else if (message.type === 'found') {
                ws.isGenerating = false;
                const totalAttempts = progressTracker.batchResults.get(ws.workerId) || 0;
                
                ws.send(JSON.stringify({
                    type: 'found',
                    result: message.result,
                    attempts: totalAttempts
                }));
                
                // Cleanup
                progressTracker.batchResults.set(ws.workerId, 0);
            }
        });
    });

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

                // Validate pattern characters
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

    // Improved cleanup on connection close
    ws.on('close', () => {
        ws.isGenerating = false;
        progressTracker.batchResults.delete(ws.workerId);
        
        // Clean up worker listeners
        workerPool.forEach(({ worker }) => {
            worker.removeAllListeners('message');
        });
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        ws.isGenerating = false;
        progressTracker.batchResults.delete(ws.workerId);
    });

    ws.send('{"type":"status","message":"Connected to server"}');
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