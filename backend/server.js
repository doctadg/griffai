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
const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

// Create worker pool at startup - use all cores
const NUM_WORKERS = os.cpus().length;
const workerPool = [];

// Worker script as a separate string for better readability
const workerScript = `
const { parentPort } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');

let currentPattern = null;
let patternLength = 0;
const BATCH_SIZE = 25000; // Increased batch size for better performance

// Base58 alphabet for direct conversion
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Uint8Array(128);
for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET.charCodeAt(i)] = i;
}

// Pre-allocate buffers
const seedBuffer = Buffer.alloc(32);
const pubkeyBuffer = Buffer.alloc(32);
let base58Cache = Buffer.alloc(45); // Max base58 length for 32 bytes

// Optimized base58 check using lookup table and native Buffer
function checkPrefix(pubkey) {
    let carry = 0n;
    for (let i = 0; i < Math.min(3, pubkey.length); i++) {
        carry = (carry * 256n) + BigInt(pubkey[i]);
    }
    
    let j = 0;
    while (carry > 0n && j < patternLength) {
        const remainder = Number(carry % 58n);
        base58Cache[j] = ALPHABET.charCodeAt(remainder);
        carry = carry / 58n;
        j++;
    }
    
    // Direct byte comparison
    for (let i = 0; i < patternLength; i++) {
        if (base58Cache[patternLength - 1 - i] !== currentPattern.charCodeAt(i)) {
            return false;
        }
    }
    return true;
}

parentPort.on('message', ({ type, pattern }) => {
    if (type === 'setPattern') {
        currentPattern = pattern.toLowerCase();
        patternLength = pattern.length;
    }
    else if (type === 'generate') {
        let found = false;
        for (let i = 0; i < BATCH_SIZE; i++) {
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

// WebSocket connection handling
wss.on('connection', (ws) => {
    let isGenerating = false;
    let totalAttempts = 0;
    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 250; // Reduced update frequency for smoother UI

    const sendProgress = () => {
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
            ws.send(`{"type":"progress","attempts":${totalAttempts}}`);
            lastProgressUpdate = now;
        }
    };

    const startGeneration = (pattern) => {
        isGenerating = true;
        totalAttempts = 0;

        // Set pattern for all workers
        workerPool.forEach(({ worker }) => {
            worker.postMessage({ type: 'setPattern', pattern });
        });

        // Start generation on all workers
        workerPool.forEach(({ worker }) => {
            worker.postMessage({ type: 'generate' });
        });
    };

    // Set up worker message handlers
    workerPool.forEach(({ worker }) => {
        worker.on('message', (message) => {
            if (!isGenerating) return;

            if (message.type === 'batch') {
                totalAttempts += message.count;
                sendProgress();
                if (isGenerating) {
                    // Immediately start next batch
                    worker.postMessage({ type: 'generate' });
                }
            } else if (message.type === 'found') {
                isGenerating = false;
                ws.send(JSON.stringify({
                    type: 'found',
                    result: message.result,
                    attempts: totalAttempts
                }));
            }
        });
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'start') {
                if (isGenerating) {
                    ws.send('{"type":"error","message":"Generation already in progress"}');
                    return;
                }

                if (!data.pattern || typeof data.pattern !== 'string' || data.pattern.length > 6) {
                    ws.send('{"type":"error","message":"Invalid pattern. Must be 1-6 characters."}');
                    return;
                }

                startGeneration(data.pattern);
            }

            if (data.type === 'stop') {
                isGenerating = false;
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send('{"type":"error","message":"Internal server error"}');
        }
    });

    ws.on('close', () => {
        isGenerating = false;
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