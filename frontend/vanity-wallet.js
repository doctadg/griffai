import { wsUrl } from './config.js';

// DOM Elements
let ws = null;
let isConnected = false;

// Connect to WebSocket server
function connectWebSocket() {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        isConnected = true;
        generateBtn.disabled = false;
        showStatus('Connected to server');
    };
    
    ws.onclose = function() {
        console.log('WebSocket disconnected');
        isConnected = false;
        generateBtn.disabled = true;
        stopBtn.disabled = true;
        showStatus('Connection to server lost. Please refresh the page.', 'error');
        // Try to reconnect
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
        showStatus('Connection error. Please check console for details.', 'error');
    };
    
    // WebSocket message handling
    ws.onmessage = function(event) {
        try {
            console.log('Raw message received:', event.data);
            const data = JSON.parse(event.data);
            console.log('Parsed message:', data);
            
            if (data.type === 'progress') {
                console.log('Progress update:', data.attempts, 'attempts');
                updateStats(data.attempts);
                progressEl.style.width = `${(data.attempts % 1000) / 10}%`;
                // Don't show status message for every progress update to avoid flickering
                if (data.attempts === 1 || data.attempts % 1000 === 0) {
                    showStatus(`Generating... ${data.attempts.toLocaleString()} attempts so far`, 'info');
                }
            } else if (data.type === 'found') {
                console.log('Found matching address:', data.result.publicKey);
                currentKeypair = data.result;
                displayResult(data.result, data.attempts);
                stopGeneration();
                showStatus('Successfully generated matching address!', 'success');
            } else if (data.type === 'error') {
                console.log('Error from server:', data.message);
                showStatus(data.message, 'error');
                stopGeneration();
            } else if (data.type === 'status') {
                console.log('Status message:', data.message);
                showStatus(data.message, 'info');
            } else {
                console.log('Unknown message type:', data.type);
                showStatus('Received unknown message type from server', 'error');
            }
        } catch (error) {
            console.error('Error processing message:', error);
            console.error('Error details:', error.message);
            showStatus('Error processing server response: ' + error.message, 'error');
            stopGeneration();
        }
    };
}

// Initialize WebSocket connection
connectWebSocket();

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

// Request notification permission
if ('Notification' in window) {
    Notification.requestPermission();
}

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
    
    // Set colors based on message type
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
    
    // Scroll the message into view
    statusMessageEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideStatus() {
    statusMessageEl.style.display = 'none';
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
    }
}

function updateStats(attempts) {
    console.log('Updating stats with attempts:', attempts);
    const now = Date.now();
    
    try {
        // Update attempts
        console.log('Updating attempts display');
        attemptsEl.textContent = `Attempts: ${attempts.toLocaleString()}`;
        
        // Calculate speed
        if (lastUpdateTime) {
            const timeDiff = (now - lastUpdateTime) / 1000; // seconds
            const attemptsDiff = attempts - lastAttempts;
            const speed = Math.round(attemptsDiff / timeDiff);
            console.log('Calculated speed:', speed, 'addresses/sec');
            speedEl.textContent = `Speed: ${speed.toLocaleString()} addresses/sec`;
            
            // Calculate estimate for pattern
            const pattern = patternInput.value.trim();
            const possibleChars = 36; // a-z0-9
            const expectedAttempts = Math.pow(possibleChars, pattern.length);
            const remainingAttempts = expectedAttempts - attempts;
            const estimatedSeconds = remainingAttempts / speed;
            console.log('Estimated seconds remaining:', estimatedSeconds);
            
            let timeEstimate;
            if (estimatedSeconds < 60) {
                timeEstimate = `${Math.round(estimatedSeconds)} seconds`;
            } else if (estimatedSeconds < 3600) {
                timeEstimate = `${Math.round(estimatedSeconds / 60)} minutes`;
            } else {
                timeEstimate = `${Math.round(estimatedSeconds / 3600)} hours`;
            }
            console.log('Time estimate:', timeEstimate);
            estimateEl.textContent = `Estimated time: ${timeEstimate}`;
        } else {
            console.log('First update - no speed calculation yet');
        }
        
        lastUpdateTime = now;
        lastAttempts = attempts;
    } catch (error) {
        console.error('Error updating stats:', error);
        console.error('Error details:', error.message);
        showStatus('Error updating statistics: ' + error.message, 'error');
    }
}

function startGeneration() {
    console.log('startGeneration called');
    try {
        // Check WebSocket state
        console.log('WebSocket state:', {
            readyState: ws?.readyState,
            isConnected,
            wsExists: !!ws
        });

        if (!ws) {
            showStatus('WebSocket not initialized. Please refresh the page.', 'error');
            return;
        }

        if (ws.readyState !== WebSocket.OPEN) {
            showStatus('WebSocket not open. Current state: ' + ws.readyState, 'error');
            return;
        }

        if (!isConnected) {
            showStatus('Not connected to server. Please wait for connection...', 'error');
            return;
        }

        const pattern = patternInput.value.trim();
        console.log('Pattern entered:', pattern);
        if (!pattern || pattern.length > 6) {
            showStatus('Invalid pattern. Must be 1-6 characters.', 'error');
            return;
        }

        // Reset UI and start counters immediately
        console.log('Resetting UI elements');
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
        
        // Show immediate success notification
        showStatus(`Starting generation for pattern "${pattern}"...`, 'success');
        
        // Start updating counters immediately
        updateStats(0);
        console.log('Starting generation with pattern:', pattern);

        // Start generation
        console.log('Preparing to send start message');
        const message = {
            type: 'start',
            pattern: pattern
        };
        console.log('Message to send:', message);
        
        ws.send(JSON.stringify(message));
        console.log('Start message sent successfully');
        
        // Verify UI state after sending
        console.log('Current UI state:', {
            generateBtnDisabled: generateBtn.disabled,
            stopBtnDisabled: stopBtn.disabled,
            attempts: attemptsEl.textContent,
            progress: progressEl.style.width,
            statusMessage: statusMessageEl.querySelector('p').textContent
        });
    } catch (error) {
        console.error('Error in startGeneration:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        showStatus('Error starting generation: ' + error.message, 'error');
        generateBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

function stopGeneration() {
    try {
        if (!isConnected || !ws) {
            showStatus('Not connected to server', 'error');
            return;
        }

        ws.send(JSON.stringify({ type: 'stop' }));
        generateBtn.disabled = false;
        stopBtn.disabled = true;
        showStatus('Generation stopped by user', 'info');
    } catch (error) {
        console.error('Error in stopGeneration:', error);
        showStatus('Error stopping generation: ' + error.message, 'error');
        generateBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

function displayResult(result, attempts) {
    publicKeyEl.textContent = result.publicKey;
    attemptsEl.textContent = `Found after ${attempts.toLocaleString()} attempts`;
    resultEl.style.display = 'block';
    
    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    const successMessage = `Success! Found matching address in ${timeTaken} seconds`;
    showStatus(successMessage, 'success');
    
    // Show desktop notification with emoji
    showNotification('Vanity Address Found! 🎉',
        `Found matching address after ${attempts.toLocaleString()} attempts.\nAddress: ${result.publicKey.slice(0, 12)}...`);
    
    // Update progress bar to 100%
    progressEl.style.width = '100%';
}

function downloadPrivateKey() {
    if (!currentKeypair) return;
    
    // Convert secret key to string for easy copying
    const secretKeyString = JSON.stringify(currentKeypair.secretKey);
    
    // Create the download content - just the private key
    const content = secretKeyString;

    // Create and trigger download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solana-private-key-${currentKeypair.publicKey.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Clear the keypair from memory
    currentKeypair = null;
    resultEl.style.display = 'none';
    showStatus('Private key downloaded and cleared from memory. You can now import this key into your wallet.');
}


// Menu toggle functionality
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('nav');

menuToggle?.addEventListener('click', () => {
    menuToggle.classList.toggle('active');
    nav.classList.toggle('menu-open');
});

// Initialize
validatePattern();