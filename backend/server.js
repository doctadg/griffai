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

// Create worker pool at startup
const NUM_WORKERS = os.cpus().length;
const workerPool = [];

// Worker script as a separate string for better readability
const workerScript = `
const { parentPort } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const crypto = require('crypto');

let currentPattern = null;
let patternLength = 0;
const BATCH_SIZE = 25000; // Increased batch size for better throughput

// Pre-compute base58 alphabet for faster comparison
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map(Array.from(BASE58_ALPHABET).map((char, index) => [char, index]));

// Pre-allocate buffers for reuse
const seedBuffer = new Uint8Array(32);
const pubkeyBuffer = new Uint8Array(32);
const base58Chars = new Uint8Array(44); // Max length of base58 encoded public key

// Fast base58 prefix check without full encoding
function checkBase58Prefix(publicKeyBytes, pattern, length) {
    let carry = 0;
    let charIndex = 0;
    
    // Process first few bytes to get the pattern length worth of base58 chars
    for (let i = 0; i < Math.min(length + 1, publicKeyBytes.length); i++) {
        carry = carry * 256 + publicKeyBytes[i];
        while (carry >= 58) {
            const digit = carry % 58;
            if (charIndex < length && BASE58_ALPHABET[digit] !== pattern[charIndex]) {
                return false;
            }
            charIndex++;
            carry = Math.floor(carry / 58);
        }
    }
    
    if (carry > 0) {
        if (charIndex < length && BASE58_ALPHABET[carry] !== pattern[charIndex]) {
            return false;
        }
    }
    
    return true;
}

// Generate random keypair using pre-allocated buffers
function generateKeypairFast() {
    crypto.randomFillSync(seedBuffer);
    const keypair = Keypair.fromSeed(seedBuffer);
    pubkeyBuffer.set(keypair.publicKey.toBytes());
    return {
        publicKey: pubkeyBuffer,
        secretKey: keypair.secretKey
    };
}

parentPort.on('message', ({ type, pattern }) => {
    if (type === 'setPattern') {
        currentPattern = pattern.toLowerCase();
        patternLength = pattern.length;
    }
    else if (type === 'generate') {
        for (let i = 0; i < BATCH_SIZE; i++) {
            const keypair = generateKeypairFast();
            
            if (checkBase58Prefix(keypair.publicKey, currentPattern, patternLength)) {
                // Only encode to base58 when we find a match
                const address = bs58.encode(keypair.publicKey);
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
        
        // Use a pre-stringified message for progress updates
        parentPort.postMessage({ type: 'batch', count: BATCH_SIZE });
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

// Pre-stringify common messages
const PROGRESS_MESSAGE_PREFIX = '{"type":"progress","attempts":';
const PROGRESS_MESSAGE_SUFFIX = '}';

// WebSocket connection handling
wss.on('connection', (ws) => {
    let isGenerating = false;
    let totalAttempts = 0;
    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 1000; // 1 second interval

    const sendProgress = () => {
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
            // Avoid JSON.stringify overhead by concatenating strings
            ws.send(PROGRESS_MESSAGE_PREFIX + totalAttempts + PROGRESS_MESSAGE_SUFFIX);
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