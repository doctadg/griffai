const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn } = require('child_process');
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

const activeConnections = new Set();
const activeProcesses = new Map();

function killProcess(ws) {
    const process = activeProcesses.get(ws);
    if (process) {
        try {
            process.kill('SIGTERM');
            console.log('Process killed successfully');
        } catch (error) {
            console.error('Error killing process:', error);
        }
        activeProcesses.delete(ws);
    }
}

wss.on('connection', (ws) => {
    ws.isGenerating = false;
    ws.workerId = crypto.randomBytes(4).toString('hex');
    let attempts = 0;
    let lastBroadcast = 0;
    const BROADCAST_INTERVAL = 1000;

    const cleanup = () => {
        if (ws.isGenerating) {
            killProcess(ws);
            ws.isGenerating = false;
            activeConnections.delete(ws);
        }
    };

    const startGeneration = (pattern) => {
        if (ws.isGenerating) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Generation already in progress'
            }));
            return;
        }

        attempts = 0;
        ws.isGenerating = true;

        console.log('Starting solana-keygen grind process for pattern:', pattern);

        // Start solana-keygen grind process
        const process = spawn('solana-keygen', ['grind', '--starts-with', pattern + ':1']);
        activeProcesses.set(ws, process);

        process.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('Process stdout:', output);

            if (output.includes('Found matching key')) {
                // Extract pubkey and private key from output
                const lines = output.split('\n');
                let pubkey = '';
                let privkey = '';

                for (const line of lines) {
                    if (line.includes('pubkey:')) {
                        pubkey = line.split('pubkey:')[1].trim();
                    } else if (line.includes('[')) {
                        // Private key is usually in array format
                        privkey = line.trim();
                    }
                }

                if (pubkey && privkey) {
                    ws.send(JSON.stringify({
                        type: 'found',
                        result: {
                            publicKey: pubkey,
                            secretKey: JSON.parse(privkey)
                        },
                        attempts: attempts
                    }));
                }

                cleanup();
            }
        });

        process.stderr.on('data', (data) => {
            const output = data.toString();
            console.log('Process stderr:', output);

            // Extract attempt count from stderr output
            const match = output.match(/Searched (\d+) keys/);
            if (match) {
                const currentAttempts = parseInt(match[1]);
                attempts = currentAttempts;

                const now = Date.now();
                if (now - lastBroadcast >= BROADCAST_INTERVAL && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'progress',
                        attempts: attempts
                    }));
                    lastBroadcast = now;
                }
            }
        });

        process.on('error', (error) => {
            console.error('Process error:', error);
            if (ws.isGenerating && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Failed to start key generation process: ' + error.message
                }));
                cleanup();
            }
        });

        process.on('exit', (code, signal) => {
            console.log('Process exited with code:', code, 'signal:', signal);
            
            // Only show error if it's an unexpected termination
            if (code !== 0 && ws.isGenerating && !process.killed && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Key generation process terminated unexpectedly (code: ${code}, signal: ${signal})`
                }));
                cleanup();
            }
        });

        // Send initial status
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'status',
                message: `Starting generation for pattern "${pattern}"`
            }));
        }
    };

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'start') {
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
                cleanup();
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'status',
                        message: 'Generation stopped'
                    }));
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid message format'
                }));
            }
        }
    });

    activeConnections.add(ws);

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
