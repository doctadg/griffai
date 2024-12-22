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
const crypto = require('crypto');

let currentPattern = null;
let patternLength = 0;
const BATCH_SIZE = 5000; // Smaller batch size for more frequent updates

// Base58 alphabet for direct conversion
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = {};
for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET[i]] = i;
}

// Pre-allocate buffers
const seedBuffer = Buffer.alloc(32);
const pubkeyBuffer = Buffer.alloc(32);

// Fast base58 check using native Buffer
function checkPrefix(pubkey, pattern) {
    let carry = 0n;
    let digits = 0;
    
    for (let i = 0; i < Math.min(3, pubkey.length); i++) {
        carry = (carry * 256n) + BigInt(pubkey[i]);
    }
    
    let result = '';
    while (carry > 0n && digits < patternLength) {
        const remainder = Number(carry % 58n);
        result = ALPHABET[remainder] + result;
        carry = carry / 58n;
        digits++;
    }
    
    return result.toLowerCase().startsWith(pattern);
}

parentPort.on('message', ({ type, pattern }) => {
    if (type === 'setPattern') {
        currentPattern = pattern.toLowerCase();
        patternLength = pattern.length;
    }
    else if (type === 'generate') {
        for (let i = 0; i < BATCH_SIZE; i++) {
            crypto.randomFillSync(seedBuffer);
            const keypair = Keypair.fromSeed(seedBuffer);
            pubkeyBuffer.set(keypair.publicKey.toBytes());
            
            if (checkPrefix(pubkeyBuffer, currentPattern)) {
                parentPort.postMessage({
                    type: 'found',
                    result: {
                        publicKey: keypair.publicKey.toBase58(),
                        secretKey: Array.from(keypair.secretKey)
                    }
                });
                return;
            }
        }
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

// WebSocket connection handling
wss.on('connection', (ws) => {
    let isGenerating = false;
    let totalAttempts = 0;
    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 100; // More frequent updates

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