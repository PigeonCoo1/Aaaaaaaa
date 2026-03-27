/**
 * AI Chat - Ask questions about any POI.
 * Uses Google Gemini API (free tier, works from browser).
 * Falls back to "Copy to clipboard" if no API key set.
 */

const AIChat = {
    currentPOI: null,
    messages: [],

    /**
     * Initialize chat for a POI
     */
    init(poi) {
        this.currentPOI = poi;
        this.messages = [];

        const messagesEl = document.getElementById('ai-chat-messages');
        const inputEl = document.getElementById('ai-chat-input');
        const statusEl = document.getElementById('ai-chat-status');

        messagesEl.innerHTML = '';
        inputEl.value = '';
        statusEl.textContent = '';

        // Generate suggested questions
        this.renderSuggestions(poi);

        // Wire up send button & enter key
        const sendBtn = document.getElementById('ai-chat-send');
        const newSend = sendBtn.cloneNode(true);
        sendBtn.parentNode.replaceChild(newSend, sendBtn);
        newSend.addEventListener('click', () => this.sendMessage());

        const newInput = inputEl.cloneNode(true);
        inputEl.parentNode.replaceChild(newInput, inputEl);
        newInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Settings button
        const settingsBtn = document.getElementById('ai-settings-btn');
        const newSettings = settingsBtn.cloneNode(true);
        settingsBtn.parentNode.replaceChild(newSettings, settingsBtn);
        newSettings.addEventListener('click', () => this.showAPIKeyModal());

        // Check if API key exists
        if (!this.getAPIKey()) {
            statusEl.innerHTML = 'Set up a free API key to ask AI questions <button onclick="AIChat.showAPIKeyModal()" style="background:#1976d2;color:#fff;border:none;padding:4px 12px;border-radius:12px;cursor:pointer;font-size:12px">Set Up</button>';
        }
    },

    /**
     * Generate context-aware suggested questions
     */
    renderSuggestions(poi) {
        const container = document.getElementById('ai-suggested-questions');
        const questions = [];
        const cat = CATEGORIES[poi.category] || {};

        // Universal questions
        questions.push(`What is ${poi.title}?`);

        // Nature-specific
        if (poi.source === 'iNaturalist') {
            if (poi.scientificName) {
                questions.push(`Tell me everything about ${poi.scientificName}`);
            }
            if (cat.group === 'Plants') {
                questions.push(`Is ${poi.title} edible or poisonous?`);
                questions.push(`Based on when this was observed (${poi.observedOn || 'unknown date'}), is this plant likely still there and alive?`);
                questions.push(`What are the medicinal uses of ${poi.title}?`);
                questions.push(`How do I identify ${poi.title} in the wild?`);
            } else if (cat.group === 'Animals') {
                questions.push(`What does ${poi.title} eat and where does it live?`);
                questions.push(`Is ${poi.title} dangerous to humans?`);
                questions.push(`Based on observation date ${poi.observedOn || 'unknown'} and this being a ${poi.title}, is it likely still in this area?`);
                questions.push(`What's the conservation status of ${poi.title}?`);
            }
            questions.push(`What season is best to see ${poi.title}?`);
        }

        // Geology
        if (cat.group === 'Geology') {
            questions.push(`How was this geological feature formed?`);
            questions.push(`What minerals or fossils might I find here?`);
            questions.push(`How old is this rock formation?`);
        }

        // Built environment
        if (cat.group === 'Built') {
            questions.push(`What's the history of this place?`);
            questions.push(`When was this built and by whom?`);
        }

        // "Is it still there" question for everything
        if (poi.observedOn) {
            questions.push(`This was observed on ${poi.observedOn}. Based on what you know about ${poi.title}, is it likely still there?`);
        }

        // Render
        container.innerHTML = questions.slice(0, 5).map(q =>
            `<button class="suggested-q" onclick="AIChat.askSuggested(this)">${q}</button>`
        ).join('');
    },

    askSuggested(btn) {
        const q = btn.textContent;
        document.getElementById('ai-chat-input').value = q;
        this.sendMessage();
    },

    /**
     * Send a message to the AI
     */
    async sendMessage() {
        const inputEl = document.getElementById('ai-chat-input');
        const question = inputEl.value.trim();
        if (!question) return;

        inputEl.value = '';
        const messagesEl = document.getElementById('ai-chat-messages');
        const statusEl = document.getElementById('ai-chat-status');

        // Show user message
        this.addMessage('user', question);

        // Check for API key
        const apiKey = this.getAPIKey();
        if (!apiKey) {
            this.addMessage('ai', '🔑 You need to set up a free API key first to ask AI questions. Click the ⚙️ button above to add your free Google Gemini key.');
            // Also offer copy-to-clipboard
            const context = this.buildContext();
            const fullPrompt = `${context}\n\nUser question: ${question}`;
            this.addCopyButton(fullPrompt);
            return;
        }

        // Show loading
        statusEl.textContent = 'AI is thinking...';

        try {
            const context = this.buildContext();
            const response = await this.callGemini(apiKey, context, question);
            this.addMessage('ai', response);
            statusEl.textContent = '';
        } catch (error) {
            console.error('AI error:', error);
            if (error.message.includes('API key')) {
                this.addMessage('ai', '❌ Invalid API key. Please check your key in settings (⚙️).');
            } else {
                this.addMessage('ai', `❌ Error: ${error.message}. Try again or copy the question to use in another AI.`);
                const context = this.buildContext();
                this.addCopyButton(`${context}\n\nQuestion: ${question}`);
            }
            statusEl.textContent = '';
        }
    },

    /**
     * Build rich context string from POI data
     */
    buildContext() {
        const poi = this.currentPOI;
        if (!poi) return '';

        const cat = CATEGORIES[poi.category] || {};
        let ctx = `You are a knowledgeable nature and geography expert assistant embedded in an interactive map app. The user clicked on a point of interest and wants to know more about it. Be detailed, accurate, and helpful. Give thorough answers.\n\n`;
        ctx += `=== POINT OF INTEREST ===\n`;
        ctx += `Name: ${poi.title}\n`;
        ctx += `Category: ${cat.label || poi.category}\n`;
        ctx += `Group: ${cat.group || 'Unknown'}\n`;
        ctx += `Location: ${poi.lat}, ${poi.lon}\n`;
        ctx += `Data Source: ${poi.source}\n`;

        if (poi.scientificName) ctx += `Scientific Name: ${poi.scientificName}\n`;
        if (poi.commonName) ctx += `Common Name: ${poi.commonName}\n`;
        if (poi.taxonRank) ctx += `Taxon Rank: ${poi.taxonRank}\n`;
        if (poi.iconicTaxon) ctx += `Kingdom/Group: ${poi.iconicTaxon}\n`;
        if (poi.observedOn) ctx += `Observation Date: ${poi.observedOn}\n`;
        if (poi.placeGuess) ctx += `Location Description: ${poi.placeGuess}\n`;
        if (poi.description) ctx += `Observer's Description: ${poi.description}\n`;
        if (poi.qualityGrade) ctx += `Quality Grade: ${poi.qualityGrade}\n`;
        if (poi.numIdentifications) ctx += `Number of IDs: ${poi.numIdentifications}\n`;
        if (poi.observerLogin) ctx += `Observer: ${poi.observerLogin}\n`;

        if (poi.conservationStatus) {
            ctx += `Conservation Status: ${poi.conservationStatus.status_name || poi.conservationStatus.status}\n`;
        }

        // OSM tags
        if (poi.tags && typeof poi.tags === 'object' && !Array.isArray(poi.tags)) {
            ctx += `\nOpenStreetMap Tags:\n`;
            for (const [k, v] of Object.entries(poi.tags)) {
                ctx += `  ${k}: ${v}\n`;
            }
        }

        // Current date context for "is it still there" questions
        ctx += `\nCurrent Date: ${new Date().toISOString().split('T')[0]}\n`;

        if (window.userLat !== undefined) {
            ctx += `User's Current Location: ${window.userLat.toFixed(5)}, ${window.userLon.toFixed(5)}\n`;
            const dist = DetailView.haversine(window.userLat, window.userLon, poi.lat, poi.lon);
            ctx += `Distance from User: ${dist < 1 ? (dist * 1000).toFixed(0) + ' meters' : dist.toFixed(2) + ' km'}\n`;
        }

        return ctx;
    },

    /**
     * Call Google Gemini API
     */
    async callGemini(apiKey, context, question) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const body = {
            contents: [{
                parts: [{
                    text: `${context}\n\n=== USER QUESTION ===\n${question}\n\n=== INSTRUCTIONS ===\nAnswer the user's question thoroughly based on the context above and your knowledge. If they ask whether something is still there/alive, reason carefully about the species, observation date, season, location, and typical lifespan/growth patterns. Be specific and helpful. Use plain language.`
                }]
            }],
            generationConfig: {
                maxOutputTokens: 2048,
                temperature: 0.7,
            },
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (resp.status === 400 || resp.status === 403) {
                throw new Error('API key invalid or expired');
            }
            throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No response from AI');
        return text;
    },

    /**
     * Add a message to the chat display
     */
    addMessage(role, text) {
        const messagesEl = document.getElementById('ai-chat-messages');
        const div = document.createElement('div');
        div.className = `ai-msg ai-msg-${role}`;

        if (role === 'ai') {
            // Simple markdown-like rendering
            div.innerHTML = this.formatAIText(text);
        } else {
            div.textContent = text;
        }

        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        this.messages.push({ role, text });
    },

    /**
     * Add a "Copy to clipboard" button for using in external AI
     */
    addCopyButton(prompt) {
        const messagesEl = document.getElementById('ai-chat-messages');
        const btn = document.createElement('button');
        btn.className = 'ai-copy-btn';
        btn.textContent = '📋 Copy question + context to paste into ChatGPT/Claude';
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(prompt).then(() => {
                btn.textContent = '✅ Copied! Paste into any AI chat';
                setTimeout(() => btn.textContent = '📋 Copy question + context to paste into ChatGPT/Claude', 3000);
            });
        });
        messagesEl.appendChild(btn);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    },

    /**
     * Basic text formatting for AI responses
     */
    formatAIText(text) {
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>').replace(/$/, '</p>');
    },

    // API Key management
    getAPIKey() {
        return localStorage.getItem('explorer_map_gemini_key') || '';
    },

    saveAPIKey(key) {
        localStorage.setItem('explorer_map_gemini_key', key.trim());
    },

    showAPIKeyModal() {
        const modal = document.getElementById('api-key-modal');
        const input = document.getElementById('api-key-input');
        input.value = this.getAPIKey();
        modal.classList.remove('hidden');

        document.getElementById('api-key-save').onclick = () => {
            this.saveAPIKey(input.value);
            modal.classList.add('hidden');
            document.getElementById('ai-chat-status').textContent = input.value ? '✅ API key saved!' : '';
            setTimeout(() => {
                const s = document.getElementById('ai-chat-status');
                if (s) s.textContent = '';
            }, 2000);
        };
        document.getElementById('api-key-cancel').onclick = () => {
            modal.classList.add('hidden');
        };
    },
};
