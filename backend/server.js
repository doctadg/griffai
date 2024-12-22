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

// Optimized progress tracking
const progressTracker = {
    batchResults: new Map(),
    lastBroadcast: 0,
    BROADCAST_INTERVAL: 2000, // Increased interval to reduce overhead
    totalAttempts: 0 // Cache total attempts
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
const BATCH_SIZE = 500000; // Further increased batch size for maximum throughput

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

// Pre-computed tables for base58 encoding
const LOOKUP_TABLE = new Uint16Array(256 * 256); // 64KB table for first two bytes
const FIRST_CHAR_TABLE = new Uint8Array(256); // First character lookup

// Initialize lookup tables
(() => {
    // First character lookup (most common case)
    for (let i = 0; i < 256; i++) {
        FIRST_CHAR_TABLE[i] = ALPHABET[i % 58].charCodeAt(0);
    }
    
    // Two character lookup
    for (let b1 = 0; b1 < 256; b1++) {
        for (let b2 = 0; b2 < 256; b2++) {
            const value = b1 * 256 + b2;
            const c1 = ALPHABET[Math.floor(value / 58) % 58];
            const c2 = ALPHABET[value % 58];
            LOOKUP_TABLE[b1 * 256 + b2] = (c1.charCodeAt(0) << 8) | c2.charCodeAt(0);
        }
    }
})();

// Optimized base58 check with lookup tables
function checkPrefix(pubkey) {
    // Optimize for single character (most common case)
    if (patternLength === 1) {
        return FIRST_CHAR_TABLE[pubkey[0]] === PATTERN_CHARS[0];
    }
    
    // Optimize for two characters
    if (patternLength === 2) {
        const chars = LOOKUP_TABLE[pubkey[0] * 256 + pubkey[1]];
        return (chars >> 8) === PATTERN_CHARS[0] &&
               (chars & 0xFF) === PATTERN_CHARS[1];
    }
    
    // For 3+ characters, use a more efficient base58 conversion
    // Pre-allocate buffer for better performance
    const digits = new Uint8Array(8); // Max needed for prefix check
    let length = 0;
    
    // Process first 4 bytes (enough for up to 6 base58 chars)
    let val = (pubkey[0] * 16777216) + // 256^3
              (pubkey[1] * 65536) +     // 256^2
              (pubkey[2] * 256) +       // 256^1
              pubkey[3];                // 256^0
              
    while (val > 0 && length < patternLength) {
        digits[length++] = val % 58;
        val = Math.floor(val / 58);
    }
    
    // Handle leading zeros
    while (length < patternLength) {
        digits[length++] = 0; // '1' in base58
    }
    
    // Compare pattern from right to left (natural order from division)
    for (let i = 0; i < patternLength; i++) {
        if (ALPHABET[digits[patternLength - 1 - i]].charCodeAt(0) !== PATTERN_CHARS[i]) {
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
        
        // Process in larger chunks for maximum performance
        const MINI_BATCH = 50000; // Increased mini-batch size
        const keypair = Keypair.fromSeed(seedBuffer); // Pre-allocate keypair
        
        while (i < BATCH_SIZE) {
            const endBatch = Math.min(i + MINI_BATCH, BATCH_SIZE);
            
            // Inner loop optimized for maximum throughput
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
            
            // Report progress less frequently
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

// Initialize worker pool
for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(workerScript, { eval: true });
    workerPool.push({
        worker,
        busy: false
    });
}

// Optimized broadcast with cached attempts
function broadcastProgress() {
    const now = Date.now();
    if (now - progressTracker.lastBroadcast >= progressTracker.BROADCAST_INTERVAL) {
        // Pre-construct message once
        const message = `{"type":"progress","attempts":${progressTracker.totalAttempts}}`;
        
        // Broadcast to all clients in one pass
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
                    // Update total attempts directly
                    progressTracker.totalAttempts += message.count;
                    
                    // Only broadcast occasionally to reduce overhead
                    if (ws.readyState === WebSocket.OPEN) {
                        broadcastProgress();
                    }
                    
                    // Continue generation immediately if active
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