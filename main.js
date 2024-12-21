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
function initializeMarketData() {
    async function fetchMarketData() {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/71Rp8PcVyz3xah5m69roFjYyFri5wq9aRjpibUptHaE`);
            const data = await response.json();
            
            if (data.pairs && data.pairs.length > 0) {
                const mainPair = data.pairs[0];
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
                this.maxHistoryLength = 15;
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
            const basePrompt = {
                role: 'system',
                content: `You are Peter GriffAIn from Family Guy. You are both funny and surprisingly knowledgeable about crypto. Your responses must be:
                1) Always in character as Peter Griffin
                2) Use catchphrases like "hehehe" and "holy crap" naturally
                3) Reference Family Guy episodes and characters
                4) Make pop culture comparisons
                5) Go off on brief tangents that relate to the topic
                6) Mention Pawtucket Patriot beer occasionally
                7) Keep responses concise (2-3 sentences) and humorous
                8) Compare crypto metrics to everyday things Peter understands
                9) Point out concerning metrics in Peter's style
                10) Occasionally mention your own $GRIFF token with enthusiasm
                
                Most importantly: Stay consistently in character as Peter Griffin, don't break character or explain your role.`
            };
            return [basePrompt, ...this.history];
        }

        clearHistory() {
            this.history = [];
        }
    }

    const conversationManager = new ConversationManager();

    async function getPeterResponse(prompt) {
        conversationManager.addUserMessage(prompt);

        // Check if the message contains a Solana contract address (base58 format, case sensitive)
        const solanaAddressMatch = prompt.match(/[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{32,44}/);
        
        // Handle token detection separately from chat
        if (solanaAddressMatch) {
            fetchAndShowTokenInfo(solanaAddressMatch[0]);
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
                model: 'anthropic/claude-3-opus:free',
                messages: conversationManager.getFullHistory(),
                temperature: 0.7,
            })
        });

        const data = await response.json();
        
        // Check for valid response
        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            console.error('Invalid API response:', data);
            const errorResponse = "Hehehe, my brain froze like that time I tried to understand what Stewie was saying. Let me try again!";
            conversationManager.addAIMessage(errorResponse);
            return errorResponse;
        }

        const aiResponse = data.choices[0].message.content.trim();
        
        // Don't save empty responses to history
        if (aiResponse) {
            conversationManager.addAIMessage(aiResponse);
        } else {
            const fallbackResponse = "Holy crap, my mind went blank like that time I forgot Meg's birthday... which is every year! Let me try again!";
            conversationManager.addAIMessage(fallbackResponse);
            return fallbackResponse;
        }
        
        return aiResponse || fallbackResponse;
    }

    async function fetchAndShowTokenInfo(address) {
        try {
            const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
            if (!response.ok) {
                console.error('DexScreener API error:', response.status);
                return;
            }
            
            const data = await response.json();
            
            if (!data || !data.pairs || data.pairs.length === 0) {
                console.error('No token data found');
                return;
            }
            
            const pair = data.pairs[0];
            const tokenData = {
                name: pair.baseToken.name || 'Unknown Token',
                symbol: pair.baseToken.symbol || '???',
                price: parseFloat(pair.priceUsd || '0').toFixed(12),
                liquidity: formatNumber(pair.liquidity?.usd || 0),
                marketCap: formatNumber(pair.fdv || 0),
                volume24h: formatNumber(pair.volume?.h24 || 0),
                priceChange24h: (pair.priceChange?.h24 || 0).toFixed(2),
                createdAt: pair.pairCreatedAt ? new Date(parseInt(pair.pairCreatedAt)).toLocaleDateString() : 'Unknown'
            };

            showTokenInfoPopup(tokenData);
        } catch (error) {
            console.error('Error fetching token data:', error);
        }
    }

    function showTokenInfoPopup(tokenData) {
        // Create popup if it doesn't exist
        let popup = document.getElementById('token-info-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'token-info-popup';
            popup.innerHTML = `
                <div class="popup-content">
                    <span class="close-popup">&times;</span>
                    <h3>Token Information</h3>
                    <div class="token-info">
                        <p><strong>Name:</strong> <span id="token-name"></span></p>
                        <p><strong>Symbol:</strong> <span id="token-symbol"></span></p>
                        <p><strong>Price:</strong> <span id="token-price"></span></p>
                        <p><strong>Market Cap:</strong> <span id="token-mcap"></span></p>
                        <p><strong>Liquidity:</strong> <span id="token-liquidity"></span></p>
                        <p><strong>24h Volume:</strong> <span id="token-volume"></span></p>
                        <p><strong>24h Change:</strong> <span id="token-change"></span></p>
                        <p><strong>Launch Date:</strong> <span id="token-date"></span></p>
                    </div>
                </div>
            `;
            document.body.appendChild(popup);

            // Add styles
            const style = document.createElement('style');
            style.textContent = `
                #token-info-popup {
                    display: none;
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #fff;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 0 20px rgba(0,0,0,0.2);
                    z-index: 1000;
                    max-width: 400px;
                    width: 90%;
                }
                .popup-content {
                    position: relative;
                }
                .close-popup {
                    position: absolute;
                    top: -10px;
                    right: -10px;
                    cursor: pointer;
                    font-size: 24px;
                }
                .token-info p {
                    margin: 8px 0;
                    font-size: 14px;
                }
                .token-info strong {
                    display: inline-block;
                    width: 100px;
                }
            `;
            document.head.appendChild(style);

            // Add close functionality
            const closeBtn = popup.querySelector('.close-popup');
            closeBtn.onclick = () => {
                popup.style.display = 'none';
            };
        }

        // Update popup content
        popup.querySelector('#token-name').textContent = tokenData.name;
        popup.querySelector('#token-symbol').textContent = tokenData.symbol;
        popup.querySelector('#token-price').textContent = `$${tokenData.price}`;
        popup.querySelector('#token-mcap').textContent = `$${tokenData.marketCap}`;
        popup.querySelector('#token-liquidity').textContent = `$${tokenData.liquidity}`;
        popup.querySelector('#token-volume').textContent = `$${tokenData.volume24h}`;
        popup.querySelector('#token-change').textContent = `${tokenData.priceChange24h}%`;
        popup.querySelector('#token-date').textContent = tokenData.createdAt;

        // Show popup
        popup.style.display = 'block';
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
            if (!promptInput.value.trim()) return; // Don't process empty messages
            
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