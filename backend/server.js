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
    perMessageDeflate: false, // Disable compression for better stability
    maxPayload: 1024 * 16 // 16KB max message size
});

// Create worker pool at startup - use half of available cores for better stability
const NUM_WORKERS = Math.max(1, Math.floor(os.cpus().length / 2));
const workerPool = [];

// Shared progress tracking
const progressTracker = {
    batchResults: new Map(),
    lastBroadcast: 0,
    BROADCAST_INTERVAL: 1000 // Reduced update frequency for better performance
};

// Track active connections
const activeConnections = new Set();

// Worker script as a separate string for better readability
const workerScript = `
const { parentPort } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

let currentPattern = null;
let patternLength = 0;
const BATCH_SIZE = 100000; // Increased batch size for better performance

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

// Ultra-optimized base58 check using direct byte comparison for common cases
function checkPrefix(pubkey) {
    // For 1-2 character patterns, use direct byte comparison
    if (patternLength <= 2) {
        const byte1 = pubkey[0];
        if (byte1 > 127) return false; // Quick reject for high bytes
        
        // Most common case: 1 character
        if (patternLength === 1) {
            const char = ALPHABET[byte1 % 58];
            return char.charCodeAt(0) === PATTERN_CHARS[0];
        }
        
        // 2 characters
        const byte2 = pubkey[1];
        const combined = byte1 * 256 + byte2;
        const char1 = ALPHABET[Math.floor(combined / 58) % 58];
        const char2 = ALPHABET[combined % 58];
        return char1.charCodeAt(0) === PATTERN_CHARS[0] &&
               char2.charCodeAt(0) === PATTERN_CHARS[1];
    }
    
    // For longer patterns, use optimized integer math
    const value = view.getUint32(0, true);
    let result = '';
    let quotient = value;
    
    // Unrolled division for first few characters (most common)
    for (let i = 0; i < patternLength; i++) {
        result = ALPHABET[quotient % 58] + result;
        quotient = Math.floor(quotient / 58);
        if (quotient === 0) break;
    }
    
    // Pad with leading '1's if needed
    while (result.length < patternLength) {
        result = '1' + result;
    }
    
    // Compare only the required prefix
    for (let i = 0; i < patternLength; i++) {
        if (result.charCodeAt(i) !== PATTERN_CHARS[i]) {
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
            // Process larger batches for better performance
            const MINI_BATCH = 10000;
            const endBatch = Math.min(i + MINI_BATCH, BATCH_SIZE);
            
            // Pre-allocate keypair for reuse
            const keypair = Keypair.fromSeed(seedBuffer);
            
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
            
            // Only report progress at end of batch
            if (i === endBatch) {
                parentPort.postMessage({ type: 'batch', count: i });
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

    // Initialize worker message handlers
    const workerMessageHandlers = new Map();

    // Set up worker message handlers with improved error handling
    workerPool.forEach(({ worker }) => {
        const messageHandler = (message) => {
            // Check if connection is still valid
            if (!activeConnections.has(ws) || !ws.isGenerating) return;

            try {
                if (message.type === 'batch') {
                    const currentAttempts = progressTracker.batchResults.get(ws.workerId) || 0;
                    progressTracker.batchResults.set(
                        ws.workerId,
                        currentAttempts + message.count
                    );
                    
                    // Only broadcast if connection is still active
                    if (ws.readyState === WebSocket.OPEN) {
                        broadcastProgress();
                    }
                    
                    if (ws.isGenerating && ws.readyState === WebSocket.OPEN) {
                        // Continue generation immediately if still active
                        if (ws.isGenerating && ws.readyState === WebSocket.OPEN) {
                            worker.postMessage({ type: 'generate' });
                        }
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
                    
                    // Cleanup
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

    // Store handlers for cleanup
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

    // Track new connection and set up cleanup
    activeConnections.add(ws);

    // Cleanup function for connection
    const cleanup = () => {
        ws.isGenerating = false;
        progressTracker.batchResults.delete(ws.workerId);
        activeConnections.delete(ws);
        
        // Remove stored handlers
        if (ws.workerHandlers) {
            ws.workerHandlers.forEach((handler, worker) => {
                worker.removeListener('message', handler);
            });
            ws.workerHandlers.clear();
        }

        // Cancel any pending worker operations
        workerPool.forEach(({ worker }) => {
            if (worker.workerId === ws.workerId) {
                worker.postMessage({ type: 'stop' });
            }
        });
    };

    // Handle connection close
    ws.on('close', cleanup);

    // Handle connection errors with cleanup
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        cleanup();
        
        // Attempt to send error message if possible
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send('{"type":"error","message":"Connection error occurred"}');
            } catch (e) {
                console.error('Failed to send error message:', e);
            }
        }
    });

    // Tag message handlers with their owner
    workerPool.forEach(({ worker }) => {
        const messageHandler = (message) => {
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
        };
        messageHandler.owner = ws;
        worker.on('message', messageHandler);
    });

    // Send initial status
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