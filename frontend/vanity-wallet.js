import { wsUrl } from './config.js';

// DOM Elements
let ws = null;
let isConnected = false;

const generateBtn = document.getElementById('generate');
const stopBtn = document.getElementById('stop');
const patternInput = document.getElementById('pattern');
const attemptsEl = document.getElementById('attempts');
const speedEl = document.getElementById('speed');
const estimateEl = document.getElementById('estimate');
const progressEl = document.getElementById('progress');
const resultEl = document.getElementById('result');
const publicKeyEl = document.getElementById('public-key');
const downloadBtn = document.getElementById('download-key');
const statusMessageEl = document.getElementById('status-message');

let currentKeypair = null;
let startTime = null;
let lastUpdateTime = null;
let lastAttempts = 0;
let updateTimeout = null;
let lastSpeedUpdate = 0;
let movingAverageSpeed = 0;
const SPEED_UPDATE_INTERVAL = 1000; // Match backend update interval
const ALPHA = 0.2; // Reduced alpha for smoother speed display updates

// Connect to WebSocket server
function connectWebSocket() {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        isConnected = true;
        generateBtn.disabled = false;
        showStatus('Connected to server');
    };
    
    ws.onclose = () => {
        isConnected = false;
        generateBtn.disabled = true;
        stopBtn.disabled = true;
        showStatus('Connection lost. Please refresh the page.', 'error');
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = () => {
        showStatus('Connection error', 'error');
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'progress') {
                // Only update speed display periodically
                const now = Date.now();
                if (now - lastSpeedUpdate >= SPEED_UPDATE_INTERVAL) {
                    updateStats(data.attempts);
                    lastSpeedUpdate = now;
                }
                // Update attempts counter with pre-formatted number
                attemptsEl.textContent = `Attempts: ${data.attempts.toLocaleString()}`;
            } else if (data.type === 'found') {
                currentKeypair = data.result;
                displayResult(data.result, data.attempts);
                stopGeneration();
                showStatus('Successfully generated matching address!', 'success');
            } else if (data.type === 'error') {
                showStatus(data.message, 'error');
                stopGeneration();
            } else if (data.type === 'status') {
                showStatus(data.message, 'info');
            }
        } catch (error) {
            showStatus('Error processing server response', 'error');
            stopGeneration();
        }
    };
}

// Initialize WebSocket connection
connectWebSocket();

// Event Listeners
generateBtn.addEventListener('click', startGeneration);
stopBtn.addEventListener('click', stopGeneration);
downloadBtn.addEventListener('click', downloadPrivateKey);
patternInput.addEventListener('input', validatePattern);

function validatePattern() {
    const pattern = patternInput.value.trim();
    generateBtn.disabled = pattern.length === 0 || pattern.length > 6;
}

function showStatus(message, type = 'info') {
    statusMessageEl.style.display = 'block';
    
    switch (type) {
        case 'error':
            statusMessageEl.style.background = 'rgba(220,53,69,0.2)';
            statusMessageEl.style.border = '1px solid rgba(220,53,69,0.5)';
            statusMessageEl.style.color = '#ff4444';
            break;
        case 'success':
            statusMessageEl.style.background = 'rgba(40,167,69,0.2)';
            statusMessageEl.style.border = '1px solid rgba(40,167,69,0.5)';
            statusMessageEl.style.color = '#00C851';
            break;
        default:
            statusMessageEl.style.background = 'rgba(255,255,255,0.07)';
            statusMessageEl.style.border = '1px solid rgba(255,255,255,0.1)';
            statusMessageEl.style.color = 'inherit';
    }
    
    statusMessageEl.querySelector('p').textContent = message;
}

function updateStats(attempts) {
    const now = Date.now();
    
    // Calculate speed using exponential moving average
    if (lastUpdateTime) {
        const timeDiff = (now - lastUpdateTime) / 1000;
        const attemptsDiff = attempts - lastAttempts;
        const currentSpeed = Math.round(attemptsDiff / timeDiff);
        
        // Update moving average
        if (movingAverageSpeed === 0) {
            movingAverageSpeed = currentSpeed;
        } else {
            movingAverageSpeed = Math.round(ALPHA * currentSpeed + (1 - ALPHA) * movingAverageSpeed);
        }
        
        speedEl.textContent = `Speed: ${movingAverageSpeed.toLocaleString()} addresses/sec`;
        
        // Calculate estimate
        const pattern = patternInput.value.trim();
        const possibleChars = 36;
        const expectedAttempts = Math.pow(possibleChars, pattern.length);
        const remainingAttempts = expectedAttempts - attempts;
        const estimatedSeconds = remainingAttempts / movingAverageSpeed;
        
        let timeEstimate;
        if (estimatedSeconds < 60) {
            timeEstimate = `${Math.round(estimatedSeconds)} seconds`;
        } else if (estimatedSeconds < 3600) {
            timeEstimate = `${Math.round(estimatedSeconds / 60)} minutes`;
        } else {
            timeEstimate = `${Math.round(estimatedSeconds / 3600)} hours`;
        }
        estimateEl.textContent = `Estimated time: ${timeEstimate}`;
    }
    
    lastUpdateTime = now;
    lastAttempts = attempts;
    
    // Update progress bar more frequently for smoother visual feedback
    if (attempts % 10000 === 0) {
        progressEl.style.width = `${(attempts % 1000000) / 10000}%`;
    }
}

function startGeneration() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !isConnected) {
        showStatus('Not connected to server', 'error');
        return;
    }

    const pattern = patternInput.value.trim();
    if (!pattern || pattern.length > 6) {
        showStatus('Invalid pattern. Must be 1-6 characters.', 'error');
        return;
    }

    resultEl.style.display = 'none';
    generateBtn.disabled = true;
    stopBtn.disabled = false;
    attemptsEl.textContent = 'Attempts: 0';
    speedEl.textContent = 'Speed: Initializing...';
    estimateEl.textContent = 'Estimated time: Calculating...';
    progressEl.style.width = '0%';
    startTime = Date.now();
    lastUpdateTime = startTime;
    lastAttempts = 0;
    lastSpeedUpdate = 0;
    movingAverageSpeed = 0;
    
    showStatus(`Starting generation for pattern "${pattern}"...`, 'success');
    ws.send(JSON.stringify({ type: 'start', pattern }));
}

function stopGeneration() {
    if (isConnected && ws) {
        ws.send(JSON.stringify({ type: 'stop' }));
    }
    // Reset all UI elements
    generateBtn.disabled = false;
    stopBtn.disabled = true;
    attemptsEl.textContent = 'Attempts: 0';
    speedEl.textContent = 'Speed: 0 addresses/sec';
    estimateEl.textContent = 'Estimated time: calculating...';
    progressEl.style.width = '0%';
    movingAverageSpeed = 0;
    lastAttempts = 0;
    lastUpdateTime = null;
    showStatus('Generation stopped', 'info');
}

function displayResult(result, attempts) {
    publicKeyEl.textContent = result.publicKey;
    attemptsEl.textContent = `Found after ${attempts.toLocaleString()} attempts`;
    resultEl.style.display = 'block';
    progressEl.style.width = '100%';
    
    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    showStatus(`Success! Found matching address in ${timeTaken} seconds`, 'success');
    
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Vanity Address Found! 🎉', {
            body: `Found matching address after ${attempts.toLocaleString()} attempts.\nAddress: ${result.publicKey.slice(0, 12)}...`
        });
    }
}

function downloadPrivateKey() {
    if (!currentKeypair) return;
    
    // Convert the secret key to base58 format for Phantom
    const bs58PrivateKey = solanaWeb3.bs58.encode(new Uint8Array(currentKeypair.secretKey));

    const instructions = `
=== SOLANA VANITY WALLET INSTRUCTIONS ===

Your Vanity Wallet Address (Public Key):
${currentKeypair.publicKey}

Your Private Key (Base58 Format):
${bs58PrivateKey}

=== HOW TO IMPORT INTO PHANTOM WALLET ===

1. Open your Phantom wallet
2. Click the hamburger menu (three lines) in the top left
3. Click "Add/Connect Wallet"
4. Select "Import Private Key"
5. Paste your private key (the long string above in Base58 format)
6. Click "Import"

IMPORTANT SECURITY NOTES:
- Store this file securely and never share your private key
- Delete this file after importing to Phantom
- Verify the public key matches after import
- Make sure you have a backup of your wallet

Generated by $GRIFF Vanity Wallet Generator
`;

    const blob = new Blob([instructions], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solana-vanity-wallet-${currentKeypair.publicKey.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    currentKeypair = null;
    resultEl.style.display = 'none';
    showStatus('Private key downloaded and cleared from memory. Follow the instructions in the file to import into Phantom.');
}

// Initialize
validatePattern();