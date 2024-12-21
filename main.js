// Initialize all page functionality
document.addEventListener('DOMContentLoaded', () => {
    // Initialize mobile menu
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('nav');

    if (menuToggle && nav) {
        menuToggle.addEventListener('click', () => {
            menuToggle.classList.toggle('active');
            nav.classList.toggle('menu-open');
            console.log('Menu toggle clicked'); // Debug log
        });

        // Close menu when clicking links
        const links = document.querySelectorAll('nav ul li a');
        links.forEach(link => {
            link.addEventListener('click', () => {
                menuToggle.classList.remove('active');
                nav.classList.remove('menu-open');
            });
        });
    }

    // Initialize market data if on homepage
    if (window.location.pathname === '/' || window.location.pathname.includes('index.html')) {
        initializeMarketData();
    }

    // Initialize chat functionality if on chat page
    if (window.location.pathname.includes('ai-chat.html')) {
        initializeChatFunctionality();
    }
});

// Market data functionality
const TOKEN_ADDRESS = '71Rp8PcVyz3xah5m69roFjYyFri5wq9aRjpibUptHaE';

function initializeMarketData() {
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
            if (element) {
                element.textContent = 'Error loading data';
            }
        });
    }

    // Fetch data immediately
    fetchMarketData();

    // Update every 30 seconds
    setInterval(fetchMarketData, 30000);
}

// Initialize chat functionality
function initializeChatFunctionality() {
    const OPENROUTER_API_KEY = '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';
    const ELEVENLABS_API_KEY = 'sk_ccc42e2272d0973465c00db6215ad8292a0924bc0347fd1d';
    const VOICE_ID = 's4CKenUVwyiAV9mUQ1C5';

    class ConversationManager {
        constructor() {
            this.history = [];
            this.maxHistoryLength = 15; // Increased for better context retention
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
            if (this.history.length > this.maxHistoryLength) {
                this.history = this.history.slice(-this.maxHistoryLength);
            }
        }

        getFullHistory() {
            return [
                {
                    role: 'system',
                    content: 'You are Peter GriffAIn from Family Guy. You are both funny and surprisingly knowledgeable about crypto. Use these traits: 1) Use catchphrases like "hehehe" and "holy crap"; 2) Reference Family Guy episodes and characters; 3) Make pop culture references and comparisons; 4) Go off on random tangents; 5) Mention Pawtucket Patriot beer; 6) Keep responses concise (2-3 sentences) and humorous; 7) When you see a Solana address (base58 format), analyze it using DexScreener data that will be provided in the next message; 8) Compare crypto metrics to everyday things Peter would understand (e.g. "that market cap is bigger than my tab at The Drunken Clam!"); 9) Point out any concerning metrics but in Peter\'s style; 10) Occasionally mention your own $GRIFF token with enthusiasm.'
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
        conversationManager.addUserMessage(prompt);

        // Check if the message contains a Solana contract address
        const solanaAddressMatch = prompt.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
        
        let tokenData = null;
        if (solanaAddressMatch) {
            try {
                const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${solanaAddressMatch[0]}`);
                const data = await response.json();
                
                if (data.pairs && data.pairs.length > 0) {
                    const pair = data.pairs[0];
                    tokenData = {
                        name: pair.baseToken.name,
                        symbol: pair.baseToken.symbol,
                        price: pair.priceUsd,
                        liquidity: formatNumber(pair.liquidity.usd),
                        marketCap: formatNumber(pair.fdv),
                        volume24h: formatNumber(pair.volume?.h24 || 0),
                        createdAt: new Date(pair.pairCreatedAt * 1000).toLocaleDateString()
                    };
                }
            } catch (error) {
                console.error('DexScreener error:', error);
            }
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.href,
                'X-Title': 'Peter Griffain'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-thinking-exp:free',
                messages: [{
                    role: 'system',
                    content: tokenData ?
                        `You are Peter GriffAIn from Family Guy analyzing this token: Name: ${tokenData.name} (${tokenData.symbol}), Price: $${tokenData.price}, Market Cap: $${tokenData.marketCap}, Liquidity: $${tokenData.liquidity}, 24h Volume: $${tokenData.volume24h}, Created: ${tokenData.createdAt}. Use these traits: 1) Use catchphrases like "hehehe" and "holy crap"; 2) Reference Family Guy episodes; 3) Make pop culture comparisons; 4) Go off on tangents; 5) Compare metrics to everyday things you understand; 6) Point out any concerning metrics in your style; 7) Keep responses concise (2-3 sentences) and humorous; 8) Occasionally mention your own $GRIFF token.` :
                        'You are Peter GriffAIn from Family Guy. Use these traits: 1) Use catchphrases like "hehehe" and "holy crap"; 2) Reference Family Guy episodes; 3) Make pop culture comparisons; 4) Go off on tangents; 5) Mention Pawtucket Patriot beer; 6) Keep responses concise (2-3 sentences) and humorous; 7) Express confusion about complex topics; 8) Occasionally mention your own $GRIFF token with enthusiasm.'
                }, ...conversationManager.history],
                temperature: 0.9,
            })
        });

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
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

    // Set up chat form
    const chatForm = document.getElementById('chat-form');
    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const promptInput = document.getElementById('user-prompt');
            const conversationHistory = document.getElementById('conversation-history');
            const responseText = document.getElementById('peter-response');
            const audioPlayer = document.getElementById('peter-voice');
            const loadingDiv = document.getElementById('loading');
            const submitButton = document.querySelector('.chat-btn');
            
            promptInput.disabled = true;
            submitButton.disabled = true;
            loadingDiv.style.display = 'block';
            responseText.textContent = '';
            audioPlayer.style.display = '';
            
            try {
                const userMessageDiv = document.createElement('div');
                userMessageDiv.classList.add('user-message');
                userMessageDiv.textContent = `You: ${promptInput.value}`;
                conversationHistory.appendChild(userMessageDiv);
                conversationHistory.scrollTop = conversationHistory.scrollHeight;

                const response = await getPeterResponse(promptInput.value);
                
                const aiMessageDiv = document.createElement('div');
                aiMessageDiv.classList.add('ai-message');
                aiMessageDiv.textContent = `Peter: ${response}`;
                conversationHistory.appendChild(aiMessageDiv);
                conversationHistory.scrollTop = conversationHistory.scrollHeight;
                
                const audioUrl = await convertToSpeech(response);
                audioPlayer.src = audioUrl;
                audioPlayer.style.display = 'block';
                responseText.textContent = '';
                
                promptInput.value = '';
            } catch (error) {
                console.error('Error:', error);
                let errorMessage = 'Hehehe... something went wrong! ';
                
                if (error.message.includes('fetch')) {
                    errorMessage += 'Looks like my internet is worse than when Meg downloads her boy band videos. Try again!';
                } else if (error.message.includes('api')) {
                    errorMessage += 'Holy crap, the AI thingy is acting up like when Chris tries to do math. Give me a minute!';
                } else if (error.message.includes('timeout')) {
                    errorMessage += 'This is taking longer than the time I fought that giant chicken. Maybe try again?';
                } else {
                    errorMessage += 'Even I don\'t know what happened, and I once forgot how to sit down. Try again!';
                }
                
                responseText.textContent = errorMessage;
                // Retry logic for certain errors
                if (error.message.includes('timeout') || error.message.includes('api')) {
                    setTimeout(() => {
                        submitButton.disabled = false;
                        promptInput.disabled = false;
                    }, 5000); // Wait 5 seconds before allowing retry
                }
            } finally {
                promptInput.disabled = false;
                submitButton.disabled = false;
                loadingDiv.style.display = 'none';
            }
        });
    }

    // Set up clear conversation button
    const clearButton = document.getElementById('clear-conversation');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            const conversationHistory = document.getElementById('conversation-history');
            conversationHistory.innerHTML = '';
            conversationManager.clearHistory();
            document.getElementById('peter-response').textContent = '';
            document.getElementById('peter-voice').style.display = 'none';
        });
    }
}