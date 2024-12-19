const TOKEN_ADDRESS = '71Rp8PcVyz3xah5m69roFjYyFri5wq9aRjpibUptHaE';

async function fetchMarketData() {
    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN_ADDRESS}`);
        const data = await response.json();
        
        // Get the first pair since it's the main one
        const mainPair = data.pairs[0];
        
        if (mainPair) {
            // Update price
            const priceElement = document.getElementById('token-price');
            priceElement.textContent = `$${parseFloat(mainPair.priceUsd).toFixed(12)}`;
            
            // Update market cap
            const marketCapElement = document.getElementById('market-cap');
            const marketCap = parseFloat(mainPair.fdv);
            marketCapElement.textContent = `$${formatNumber(marketCap)}`;
            
            // Update 24h volume
            const volumeElement = document.getElementById('volume-24h');
            const volume = parseFloat(mainPair.volume.h24);
            volumeElement.textContent = `$${formatNumber(volume)}`;
        }
    } catch (error) {
        console.error('Error fetching market data:', error);
        updateErrorState();
    }
}

function formatNumber(num) {
    if (num >= 1000000000) {
        return (num / 1000000000).toFixed(2) + 'B';
    }
    if (num >= 1000000) {
        return (num / 1000000).toFixed(2) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

function updateErrorState() {
    const elements = ['token-price', 'market-cap', 'volume-24h'];
    elements.forEach(id => {
        const element = document.getElementById(id);
        element.textContent = 'Error loading data';
    });
}

// Fetch data immediately
fetchMarketData();

// Update every 30 seconds
setInterval(fetchMarketData, 30000);

// Chat and TTS functionality
const OPENROUTER_API_KEY = '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';
const ELEVENLABS_API_KEY = 'sk_ccc42e2272d0973465c00db6215ad8292a0924bc0347fd1d';
const VOICE_ID = 's4CKenUVwyiAV9mUQ1C5';

// Conversation history management
class ConversationManager {
    constructor() {
        this.history = [];
        this.maxHistoryLength = 10; // Limit conversation history to prevent token overflow
    }

    addUserMessage(message) {
        this.history.push({ role: 'user', content: message });
        this.trimHistory();
    }

    addAIMessage(message) {
        this.history.push({ role: 'assistant', content: message });
        this.trimHistory();
    }

    trimHistory() {
        // Keep only the last maxHistoryLength messages
        if (this.history.length > this.maxHistoryLength) {
            this.history = this.history.slice(-this.maxHistoryLength);
        }
    }

    getFullHistory() {
        return [
            {
                role: 'system',
                content: 'You are Peter GriffAIn from Family Guy. Respond in his characteristic style, using his mannerisms, catchphrases, and tendency to go off on tangents. Keep responses relatively short (2-3 sentences) and funny.'
            },
            ...this.history
        ];
    }

    clearHistory() {
        this.history = [];
    }
}

const conversationManager = new ConversationManager();

async function getPeterResponse(prompt) {
    // Add user's message to conversation history
    conversationManager.addUserMessage(prompt);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.href,
            'X-Title': 'Peter Griffain'
        },
        body: JSON.stringify({
            model: 'openai/gpt-4',
            messages: conversationManager.getFullHistory()
        })
    });

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;
    
    // Add AI's response to conversation history
    conversationManager.addAIMessage(aiResponse);

    return aiResponse;
}

async function convertToSpeech(text) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
        method: 'POST',
        headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: text,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
                stability: 1.0,
                similarity_boost: 1.0,
                style: 1.0
            }
        })
    });

    const audioBlob = await response.blob();
    return URL.createObjectURL(audioBlob);
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const promptInput = document.getElementById('user-prompt');
    const conversationHistory = document.getElementById('conversation-history');
    const responseText = document.getElementById('peter-response');
    const audioPlayer = document.getElementById('peter-voice');
    const loadingDiv = document.getElementById('loading');
    const submitButton = document.querySelector('.chat-btn');
    
    // Disable input and show loading
    promptInput.disabled = true;
    submitButton.disabled = true;
    loadingDiv.style.display = 'block';
    responseText.textContent = '';
    audioPlayer.style.display = 'none';
    
    try {
        // Add user message to conversation display
        const userMessageDiv = document.createElement('div');
        userMessageDiv.classList.add('user-message');
        userMessageDiv.textContent = `You: ${promptInput.value}`;
        conversationHistory.appendChild(userMessageDiv);
        conversationHistory.scrollTop = conversationHistory.scrollHeight;

        // Get Peter's response
        const response = await getPeterResponse(promptInput.value);
        responseText.textContent = response;
        
        // Add AI response to conversation display
        const aiMessageDiv = document.createElement('div');
        aiMessageDiv.classList.add('ai-message');
        aiMessageDiv.textContent = `Peter: ${response}`;
        conversationHistory.appendChild(aiMessageDiv);
        conversationHistory.scrollTop = conversationHistory.scrollHeight;
        
        // Convert to speech
        const audioUrl = await convertToSpeech(response);
        audioPlayer.src = audioUrl;
        audioPlayer.style.display = 'block';
        
        // Clear input
        promptInput.value = '';
    } catch (error) {
        console.error('Error:', error);
        responseText.textContent = 'Giggity... I mean, oops! Something went wrong. Try again!';
    } finally {
        // Re-enable input and hide loading
        promptInput.disabled = false;
        submitButton.disabled = false;
        loadingDiv.style.display = 'none';
    }
});

// Mobile menu toggle
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('nav');

menuToggle?.addEventListener('click', () => {
    menuToggle.classList.toggle('active');
    nav.classList.toggle('menu-open');
});

// Close menu when clicking a link
document.querySelectorAll('nav ul li a').forEach(link => {
    link.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        nav.classList.remove('menu-open');
    });
});

// Clear conversation button
document.getElementById('clear-conversation')?.addEventListener('click', () => {
    const conversationHistory = document.getElementById('conversation-history');
    conversationHistory.innerHTML = ''; // Clear conversation display
    conversationManager.clearHistory(); // Clear conversation history in memory
    document.getElementById('peter-response').textContent = '';
    document.getElementById('peter-voice').style.display = 'none';
});