/**
 * AI Chat - Ask questions about any POI.
 * Works automatically with NO API key needed!
 * Fetches real data from Wikipedia + iNaturalist to build smart answers.
 * Optionally can use Google Gemini for even deeper answers.
 */

const AIChat = {
    currentPOI: null,
    cachedWikiData: null,
    cachedTaxonData: null,
    messages: [],

    init(poi) {
        this.currentPOI = poi;
        this.cachedWikiData = null;
        this.cachedTaxonData = null;
        this.messages = [];

        const messagesEl = document.getElementById('ai-chat-messages');
        const inputEl = document.getElementById('ai-chat-input');
        const statusEl = document.getElementById('ai-chat-status');

        messagesEl.innerHTML = '';
        inputEl.value = '';
        statusEl.textContent = '';

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

        // Settings button - optional Gemini upgrade
        const settingsBtn = document.getElementById('ai-settings-btn');
        const newSettings = settingsBtn.cloneNode(true);
        settingsBtn.parentNode.replaceChild(newSettings, settingsBtn);
        newSettings.addEventListener('click', () => this.showAPIKeyModal());

        // Pre-fetch extra data in background
        this.prefetchData(poi);
    },

    async prefetchData(poi) {
        // Fetch Wikipedia article about this thing
        const searchName = poi.scientificName || poi.title;
        try {
            const params = new URLSearchParams({
                action: 'query', list: 'search', srsearch: searchName,
                srlimit: '1', format: 'json', origin: '*',
            });
            const resp = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
            const data = await resp.json();
            const pageId = data.query?.search?.[0]?.pageid;
            if (pageId) {
                const params2 = new URLSearchParams({
                    action: 'query', pageids: pageId,
                    prop: 'extracts|pageimages|categories',
                    exintro: '0', explaintext: '1', exsectionformat: 'plain',
                    piprop: 'thumbnail', pithumbsize: '300',
                    cllimit: '20', format: 'json', origin: '*',
                });
                const resp2 = await fetch(`https://en.wikipedia.org/w/api.php?${params2}`);
                const data2 = await resp2.json();
                this.cachedWikiData = Object.values(data2.query?.pages || {})[0] || null;
            }
        } catch (e) { /* silent */ }

        // Fetch iNaturalist taxon details if available
        if (poi.taxonId) {
            try {
                const resp = await fetch(`https://api.inaturalist.org/v1/taxa/${poi.taxonId}`);
                const data = await resp.json();
                this.cachedTaxonData = data.results?.[0] || null;
            } catch (e) { /* silent */ }
        }
    },

    renderSuggestions(poi) {
        const container = document.getElementById('ai-suggested-questions');
        const questions = [];
        const cat = CATEGORIES[poi.category] || {};

        questions.push(`What is ${poi.title}?`);

        if (poi.source === 'iNaturalist') {
            if (poi.scientificName) {
                questions.push(`Tell me everything about ${poi.scientificName}`);
            }
            if (cat.group === 'Plants') {
                questions.push(`Is ${poi.title} edible or poisonous?`);
                questions.push(`Is this plant likely still there?`);
                questions.push(`How do I identify ${poi.title}?`);
            } else if (cat.group === 'Animals') {
                questions.push(`What does ${poi.title} eat?`);
                questions.push(`Is ${poi.title} dangerous?`);
                questions.push(`Is it likely still in this area?`);
            }
        }

        if (cat.group === 'Geology') {
            questions.push(`How was this formed?`);
            questions.push(`What minerals might I find here?`);
        }

        if (cat.group === 'Built') {
            questions.push(`What's the history of this place?`);
        }

        container.innerHTML = questions.slice(0, 5).map(q =>
            `<button class="suggested-q" onclick="AIChat.askSuggested(this)">${q}</button>`
        ).join('');
    },

    askSuggested(btn) {
        const q = btn.textContent;
        document.getElementById('ai-chat-input').value = q;
        this.sendMessage();
    },

    async sendMessage() {
        const inputEl = document.getElementById('ai-chat-input');
        const question = inputEl.value.trim();
        if (!question) return;

        inputEl.value = '';
        const statusEl = document.getElementById('ai-chat-status');
        this.addMessage('user', question);

        // Try Gemini first if key exists, otherwise use built-in engine
        const apiKey = this.getAPIKey();
        statusEl.textContent = 'Researching...';

        try {
            let response;
            if (apiKey) {
                try {
                    response = await this.callGemini(apiKey, question);
                } catch (e) {
                    // Gemini failed, fall back to built-in
                    response = await this.buildAnswer(question);
                }
            } else {
                response = await this.buildAnswer(question);
            }
            this.addMessage('ai', response);
            statusEl.textContent = '';
        } catch (error) {
            this.addMessage('ai', 'Sorry, I had trouble finding that info. Try a different question!');
            statusEl.textContent = '';
        }
    },

    // ==================== Built-in Smart Answer Engine ====================

    async buildAnswer(question) {
        const poi = this.currentPOI;
        if (!poi) return "I don't have any data about this point yet.";

        const q = question.toLowerCase();
        const cat = CATEGORIES[poi.category] || {};
        const wiki = this.cachedWikiData;
        const taxon = this.cachedTaxonData;

        // Wait a moment for prefetch if still loading
        if (!wiki && !taxon) {
            await new Promise(r => setTimeout(r, 1500));
        }

        let answer = '';

        // ---- "What is" / "Tell me about" / general info ----
        if (q.includes('what is') || q.includes('tell me') || q.includes('about') || q.includes('everything')) {
            answer = this.buildOverviewAnswer(poi, cat, wiki, taxon);
        }
        // ---- Edible / poisonous ----
        else if (q.includes('edible') || q.includes('poisonous') || q.includes('eat') || q.includes('toxic') || q.includes('safe to eat')) {
            answer = this.buildEdibilityAnswer(poi, wiki, taxon);
        }
        // ---- Still there / alive ----
        else if (q.includes('still there') || q.includes('still alive') || q.includes('still in this area') || q.includes('likely still')) {
            answer = this.buildStillThereAnswer(poi, cat, taxon);
        }
        // ---- Dangerous ----
        else if (q.includes('dangerous') || q.includes('harm') || q.includes('bite') || q.includes('sting') || q.includes('venomous')) {
            answer = this.buildDangerAnswer(poi, wiki, taxon);
        }
        // ---- Identify / how to find ----
        else if (q.includes('identify') || q.includes('look like') || q.includes('recognize') || q.includes('how do i find')) {
            answer = this.buildIdentifyAnswer(poi, wiki, taxon);
        }
        // ---- Conservation / endangered ----
        else if (q.includes('conservation') || q.includes('endangered') || q.includes('threatened') || q.includes('protected')) {
            answer = this.buildConservationAnswer(poi, taxon);
        }
        // ---- History / built ----
        else if (q.includes('history') || q.includes('built') || q.includes('when was') || q.includes('who made')) {
            answer = this.buildHistoryAnswer(poi, wiki);
        }
        // ---- Geology / minerals / formed ----
        else if (q.includes('formed') || q.includes('mineral') || q.includes('fossil') || q.includes('old') || q.includes('geology')) {
            answer = this.buildGeologyAnswer(poi, wiki);
        }
        // ---- Season / when to see ----
        else if (q.includes('season') || q.includes('when') || q.includes('best time') || q.includes('month')) {
            answer = this.buildSeasonAnswer(poi, cat, taxon);
        }
        // ---- Habitat / where does it live ----
        else if (q.includes('habitat') || q.includes('where does') || q.includes('live') || q.includes('found')) {
            answer = this.buildHabitatAnswer(poi, wiki, taxon);
        }
        // ---- Medicinal ----
        else if (q.includes('medicin') || q.includes('heal') || q.includes('remedy') || q.includes('herbal')) {
            answer = this.buildMedicinalAnswer(poi, wiki);
        }
        // ---- Fallback: use Wikipedia + all data ----
        else {
            answer = this.buildGeneralAnswer(poi, cat, wiki, taxon, question);
        }

        return answer || "I couldn't find specific info about that. Try asking something else, like 'What is this?' or 'Is it dangerous?'";
    },

    buildOverviewAnswer(poi, cat, wiki, taxon) {
        let parts = [];

        // Name and classification
        parts.push(`**${poi.title}**`);
        if (poi.scientificName && poi.scientificName !== poi.title) {
            parts.push(`Scientific name: *${poi.scientificName}*`);
        }
        if (cat.label) parts.push(`Category: ${cat.label}`);

        // Wikipedia summary
        if (wiki?.extract) {
            const extract = wiki.extract.length > 1500 ? wiki.extract.substring(0, 1500) + '...' : wiki.extract;
            parts.push('');
            parts.push(extract);
        }

        // Taxon details from iNaturalist
        if (taxon) {
            parts.push('');
            if (taxon.wikipedia_summary && !wiki?.extract) {
                parts.push(taxon.wikipedia_summary);
            }
            if (taxon.observations_count) {
                parts.push(`**Observations worldwide:** ${taxon.observations_count.toLocaleString()} on iNaturalist`);
            }
            // Taxonomy
            if (taxon.ancestors?.length > 0) {
                parts.push('');
                parts.push('**Taxonomy:**');
                for (const a of taxon.ancestors.slice(-5)) {
                    if (a.preferred_common_name) {
                        parts.push(`- ${a.rank}: ${a.preferred_common_name} (*${a.name}*)`);
                    }
                }
            }
            if (taxon.threatened) parts.push('\n⚠️ This species is **threatened**.');
            if (taxon.introduced) parts.push('⚠️ This is an **introduced/non-native** species in some areas.');
        }

        // OSM details
        if (poi.tags && typeof poi.tags === 'object' && !Array.isArray(poi.tags)) {
            const interesting = ['species', 'genus', 'height', 'ele', 'surface', 'material', 'inscription', 'year', 'start_date', 'opening_hours', 'description'];
            const found = [];
            for (const key of interesting) {
                if (poi.tags[key]) found.push(`**${key}:** ${poi.tags[key]}`);
            }
            if (found.length > 0) {
                parts.push('');
                parts.push('**Details:**');
                parts.push(...found);
            }
        }

        // Observation details
        if (poi.observedOn) parts.push(`\n**Observed on:** ${poi.observedOn}`);
        if (poi.placeGuess) parts.push(`**Location:** ${poi.placeGuess}`);

        // Distance
        if (window.userLat !== undefined) {
            const dist = DetailView.haversine(window.userLat, window.userLon, poi.lat, poi.lon);
            parts.push(`**Distance from you:** ${dist < 1 ? (dist * 1000).toFixed(0) + ' meters' : dist.toFixed(2) + ' km'}`);
        }

        return parts.join('\n');
    },

    buildEdibilityAnswer(poi, wiki, taxon) {
        let parts = [`Looking at **${poi.title}**...`];
        let wikiText = (wiki?.extract || '').toLowerCase();
        let taxonSummary = (taxon?.wikipedia_summary || '').toLowerCase();
        let allText = wikiText + ' ' + taxonSummary;

        if (allText.includes('edible') || allText.includes('food') || allText.includes('eaten') || allText.includes('culinary') || allText.includes('cuisine')) {
            parts.push('');
            parts.push('**There are references to this being edible or used as food.** However:');
        } else if (allText.includes('toxic') || allText.includes('poison') || allText.includes('dangerous') || allText.includes('harmful')) {
            parts.push('');
            parts.push('⚠️ **This may be toxic or poisonous based on available information.**');
        } else {
            parts.push('');
            parts.push("I couldn't find specific edibility information from my sources.");
        }

        // Pull relevant sentences
        if (wiki?.extract) {
            const sentences = wiki.extract.split(/[.!?]+/);
            const relevant = sentences.filter(s => {
                const sl = s.toLowerCase();
                return sl.includes('edib') || sl.includes('toxic') || sl.includes('poison') || sl.includes('food') || sl.includes('eat') || sl.includes('cook') || sl.includes('medicin');
            }).slice(0, 4);
            if (relevant.length > 0) {
                parts.push('');
                parts.push('**From Wikipedia:**');
                for (const s of relevant) {
                    parts.push('> ' + s.trim() + '.');
                }
            }
        }

        parts.push('');
        parts.push('⚠️ **Important:** Never eat wild plants or fungi based on app identification alone. Always verify with a local expert before consuming anything found in the wild.');

        return parts.join('\n');
    },

    buildStillThereAnswer(poi, cat, taxon) {
        let parts = [];
        const now = new Date();
        const obsDate = poi.observedOn ? new Date(poi.observedOn) : null;
        const daysSince = obsDate ? Math.floor((now - obsDate) / (1000 * 60 * 60 * 24)) : null;

        parts.push(`**Analysis for ${poi.title}:**`);
        if (obsDate) {
            parts.push(`Observed: ${poi.observedOn} (${daysSince} days ago)`);
        }
        parts.push('');

        if (cat.group === 'Plants') {
            if (daysSince !== null && daysSince < 30) {
                parts.push('**Likely YES** - This was observed very recently (less than a month ago). Most plants stay in the same location for months or years.');
            } else if (daysSince !== null && daysSince < 365) {
                parts.push('**Probably YES** - Plants are rooted in place. Unless the area has been developed, mowed, or treated with herbicide, the plant is likely still there or will regrow in season.');
                const obsMonth = obsDate.getMonth();
                const nowMonth = now.getMonth();
                if (Math.abs(obsMonth - nowMonth) > 3 && Math.abs(obsMonth - nowMonth) < 9) {
                    parts.push('\n**Seasonal note:** The observation was in a different season, so the plant may look different or be dormant right now. Perennials will regrow; annuals may have died but left seeds.');
                }
            } else {
                parts.push('**Uncertain** - Over a year has passed. Perennial plants (trees, shrubs) are likely still there. Annual plants may have died, but the species likely reseeded in the area.');
            }
        } else if (cat.group === 'Animals') {
            parts.push('**Animals move!** Unlike plants, animals are mobile. However:');
            if (taxon) {
                if (taxon.wikipedia_summary?.toLowerCase().includes('migratory') || taxon.wikipedia_summary?.toLowerCase().includes('migrat')) {
                    parts.push('- This appears to be a **migratory species**, so it may only be in this area during certain seasons.');
                }
                if (taxon.wikipedia_summary?.toLowerCase().includes('territorial') || taxon.wikipedia_summary?.toLowerCase().includes('territory')) {
                    parts.push('- This species is **territorial**, meaning individuals tend to stay in the same area.');
                }
            }
            parts.push('- You may find the same *species* in this area even if not the exact same individual.');
            if (daysSince !== null && daysSince < 7) {
                parts.push('- Observed very recently, so good chance of seeing the same species nearby!');
            }
        } else {
            // Geology, buildings, etc.
            parts.push('**Very likely YES** - Geological features, buildings, and landmarks tend to remain in place for years or centuries.');
        }

        if (poi.placeGuess) {
            parts.push(`\n**Location to check:** ${poi.placeGuess}`);
        }
        parts.push(`**Coordinates:** ${poi.lat.toFixed(5)}, ${poi.lon.toFixed(5)}`);

        return parts.join('\n');
    },

    buildDangerAnswer(poi, wiki, taxon) {
        let parts = [`**Is ${poi.title} dangerous?**\n`];
        let allText = ((wiki?.extract || '') + ' ' + (taxon?.wikipedia_summary || '')).toLowerCase();

        const dangerTerms = ['venom', 'poison', 'toxic', 'dangerous', 'aggressive', 'bite', 'sting', 'harm', 'fatal', 'deadly', 'caution'];
        const safeTerms = ['harmless', 'not dangerous', 'non-venomous', 'docile', 'gentle', 'shy', 'timid'];

        let isDangerous = dangerTerms.some(t => allText.includes(t));
        let isSafe = safeTerms.some(t => allText.includes(t));

        if (isDangerous && !isSafe) {
            parts.push('⚠️ **Potentially dangerous.** Exercise caution around this species.');
        } else if (isSafe) {
            parts.push('**Generally considered harmless** based on available information.');
        } else {
            parts.push('No specific danger information found. As a general rule, observe wildlife from a safe distance.');
        }

        // Pull relevant sentences from Wikipedia
        if (wiki?.extract) {
            const sentences = wiki.extract.split(/[.!?]+/);
            const relevant = sentences.filter(s => {
                const sl = s.toLowerCase();
                return dangerTerms.some(t => sl.includes(t)) || safeTerms.some(t => sl.includes(t));
            }).slice(0, 4);
            if (relevant.length > 0) {
                parts.push('\n**From Wikipedia:**');
                for (const s of relevant) {
                    parts.push('> ' + s.trim() + '.');
                }
            }
        }

        parts.push('\n**General safety:** Always maintain a respectful distance from wildlife. Do not touch or handle unknown species.');

        return parts.join('\n');
    },

    buildIdentifyAnswer(poi, wiki, taxon) {
        let parts = [`**How to identify ${poi.title}:**\n`];

        if (taxon?.wikipedia_summary) {
            parts.push(taxon.wikipedia_summary);
        }

        // Look for description-related sentences in Wikipedia
        if (wiki?.extract) {
            const sentences = wiki.extract.split(/[.!?]+/);
            const relevant = sentences.filter(s => {
                const sl = s.toLowerCase();
                return sl.includes('distinguish') || sl.includes('recogni') || sl.includes('characterized') ||
                       sl.includes('feature') || sl.includes('color') || sl.includes('colour') || sl.includes('size') ||
                       sl.includes('length') || sl.includes('wing') || sl.includes('leaf') || sl.includes('flower') ||
                       sl.includes('petal') || sl.includes('markings') || sl.includes('pattern') || sl.includes('shape') ||
                       sl.includes('cm') || sl.includes('mm') || sl.includes('inch');
            }).slice(0, 6);
            if (relevant.length > 0) {
                parts.push('\n**Key identifying features (from Wikipedia):**');
                for (const s of relevant) {
                    parts.push('- ' + s.trim() + '.');
                }
            }
        }

        if (poi.scientificName) {
            parts.push(`\n**Scientific name to look up:** *${poi.scientificName}*`);
        }

        return parts.join('\n');
    },

    buildConservationAnswer(poi, taxon) {
        let parts = [`**Conservation status of ${poi.title}:**\n`];

        if (taxon?.conservation_statuses?.length > 0) {
            for (const cs of taxon.conservation_statuses) {
                let line = `- **${cs.authority || 'Unknown'}:** ${cs.status_name || cs.status}`;
                if (cs.iucn) line += ` (IUCN: ${cs.iucn})`;
                if (cs.place?.display_name) line += ` - ${cs.place.display_name}`;
                parts.push(line);
            }
        } else if (poi.conservationStatus) {
            parts.push(`Status: **${poi.conservationStatus.status_name || poi.conservationStatus.status}**`);
        } else {
            parts.push('No specific conservation status found in our data. This species may not be formally assessed, or it may be of "Least Concern".');
        }

        if (taxon?.threatened) {
            parts.push('\n⚠️ This species is considered **threatened**.');
        }
        if (taxon?.observations_count) {
            parts.push(`\n**iNaturalist observations worldwide:** ${taxon.observations_count.toLocaleString()}`);
        }

        return parts.join('\n');
    },

    buildHistoryAnswer(poi, wiki) {
        let parts = [`**About ${poi.title}:**\n`];

        if (wiki?.extract) {
            const extract = wiki.extract.length > 2000 ? wiki.extract.substring(0, 2000) + '...' : wiki.extract;
            parts.push(extract);
        }

        if (poi.tags) {
            const historyTags = ['start_date', 'year', 'architect', 'artist_name', 'inscription', 'historic', 'heritage', 'operator'];
            for (const tag of historyTags) {
                if (poi.tags[tag]) parts.push(`**${tag.replace(/_/g, ' ')}:** ${poi.tags[tag]}`);
            }
        }

        if (!wiki?.extract && !poi.tags?.start_date) {
            parts.push('Limited historical information available from our sources.');
        }

        return parts.join('\n');
    },

    buildGeologyAnswer(poi, wiki) {
        let parts = [`**About ${poi.title}:**\n`];

        if (wiki?.extract) {
            const extract = wiki.extract.length > 2000 ? wiki.extract.substring(0, 2000) + '...' : wiki.extract;
            parts.push(extract);
        }

        if (poi.tags?.geological) parts.push(`**Type:** ${poi.tags.geological}`);
        if (poi.tags?.ele) parts.push(`**Elevation:** ${poi.tags.ele} m`);

        if (!wiki?.extract) {
            parts.push('Limited geological info from our data. Try searching for the location name + "geology" online for detailed formation history.');
        }

        return parts.join('\n');
    },

    buildSeasonAnswer(poi, cat, taxon) {
        let parts = [`**Best time to see ${poi.title}:**\n`];

        if (taxon?.wikipedia_summary) {
            const summary = taxon.wikipedia_summary.toLowerCase();
            if (summary.includes('spring')) parts.push('Mentioned in context of **spring**.');
            if (summary.includes('summer')) parts.push('Mentioned in context of **summer**.');
            if (summary.includes('autumn') || summary.includes('fall')) parts.push('Mentioned in context of **autumn/fall**.');
            if (summary.includes('winter')) parts.push('Mentioned in context of **winter**.');
            if (summary.includes('migrat')) parts.push('This species **migrates**, so timing depends on your location.');
            if (summary.includes('bloom') || summary.includes('flower')) parts.push('Look for **blooming/flowering** periods.');
        }

        if (poi.observedOn) {
            const month = new Date(poi.observedOn).toLocaleString('en', { month: 'long' });
            parts.push(`\nThis specific observation was made in **${month}**, which suggests that's a good time to see it in this area.`);
        }

        if (cat.group === 'Plants') {
            parts.push('\n**General tip:** Many plants are most visible during their growing/flowering season (spring-summer in temperate regions). Check local wildflower guides for your area.');
        } else if (cat.group === 'Animals') {
            parts.push('\n**General tip:** Animals are often most active at dawn and dusk. Spring is good for birds (breeding season), summer for insects, autumn for migration.');
        }

        return parts.join('\n');
    },

    buildHabitatAnswer(poi, wiki, taxon) {
        let parts = [`**Habitat of ${poi.title}:**\n`];

        if (wiki?.extract) {
            const sentences = wiki.extract.split(/[.!?]+/);
            const relevant = sentences.filter(s => {
                const sl = s.toLowerCase();
                return sl.includes('habitat') || sl.includes('found in') || sl.includes('native to') ||
                       sl.includes('range') || sl.includes('lives in') || sl.includes('common in') ||
                       sl.includes('woodland') || sl.includes('forest') || sl.includes('grassland') ||
                       sl.includes('wetland') || sl.includes('urban') || sl.includes('distribution');
            }).slice(0, 5);
            if (relevant.length > 0) {
                for (const s of relevant) {
                    parts.push(s.trim() + '.');
                }
            }
        }

        if (taxon?.wikipedia_summary) {
            const sentences = taxon.wikipedia_summary.split(/[.!?]+/);
            const relevant = sentences.filter(s => s.toLowerCase().includes('found') || s.toLowerCase().includes('habitat') || s.toLowerCase().includes('range')).slice(0, 3);
            for (const s of relevant) {
                parts.push(s.trim() + '.');
            }
        }

        if (poi.placeGuess) {
            parts.push(`\n**This observation location:** ${poi.placeGuess}`);
        }

        if (parts.length <= 1) {
            parts.push('Specific habitat info not found. Try searching the scientific name online for detailed range maps.');
        }

        return parts.join('\n');
    },

    buildMedicinalAnswer(poi, wiki) {
        let parts = [`**Medicinal information for ${poi.title}:**\n`];

        if (wiki?.extract) {
            const sentences = wiki.extract.split(/[.!?]+/);
            const relevant = sentences.filter(s => {
                const sl = s.toLowerCase();
                return sl.includes('medicin') || sl.includes('herbal') || sl.includes('traditional') ||
                       sl.includes('remedy') || sl.includes('treat') || sl.includes('heal') ||
                       sl.includes('therapeutic') || sl.includes('pharmaceutical');
            }).slice(0, 5);
            if (relevant.length > 0) {
                for (const s of relevant) {
                    parts.push(s.trim() + '.');
                }
            }
        }

        if (parts.length <= 1) {
            parts.push('No specific medicinal uses found in our data.');
        }

        parts.push('\n⚠️ **Disclaimer:** This is informational only. Do not use wild plants medicinally without consulting a qualified professional.');

        return parts.join('\n');
    },

    buildGeneralAnswer(poi, cat, wiki, taxon, question) {
        // Try to find relevant sentences from Wikipedia based on question keywords
        let parts = [];
        const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);

        if (wiki?.extract) {
            const sentences = wiki.extract.split(/[.!?]+/);
            const scored = sentences.map(s => {
                const sl = s.toLowerCase();
                const score = keywords.reduce((acc, kw) => acc + (sl.includes(kw) ? 1 : 0), 0);
                return { s, score };
            }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);

            if (scored.length > 0) {
                parts.push(`**Here's what I found about ${poi.title}:**\n`);
                for (const { s } of scored) {
                    parts.push(s.trim() + '.');
                }
            }
        }

        if (parts.length === 0) {
            // Fall back to overview
            return this.buildOverviewAnswer(poi, cat, wiki, taxon);
        }

        return parts.join('\n');
    },

    // ==================== Gemini API (Optional upgrade) ====================

    async callGemini(apiKey, question) {
        const poi = this.currentPOI;
        const cat = CATEGORIES[poi.category] || {};
        let ctx = `You are a nature/geography expert. Answer about this POI:\nName: ${poi.title}\nCategory: ${cat.label}\n`;
        if (poi.scientificName) ctx += `Scientific: ${poi.scientificName}\n`;
        if (poi.observedOn) ctx += `Observed: ${poi.observedOn}\n`;
        if (poi.placeGuess) ctx += `Location: ${poi.placeGuess}\n`;
        if (poi.description) ctx += `Description: ${poi.description}\n`;
        ctx += `Current date: ${new Date().toISOString().split('T')[0]}\n`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${ctx}\nQuestion: ${question}` }] }],
                generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
            }),
        });
        if (!resp.ok) throw new Error('Gemini failed');
        const data = await resp.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    },

    // ==================== UI Helpers ====================

    addMessage(role, text) {
        const messagesEl = document.getElementById('ai-chat-messages');
        const div = document.createElement('div');
        div.className = `ai-msg ai-msg-${role}`;
        if (role === 'ai') {
            div.innerHTML = this.formatText(text);
        } else {
            div.textContent = text;
        }
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        this.messages.push({ role, text });
    },

    formatText(text) {
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>').replace(/$/, '</p>');
    },

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
            document.getElementById('ai-chat-status').textContent = input.value ? '✅ Gemini key saved!' : '';
            setTimeout(() => {
                const s = document.getElementById('ai-chat-status');
                if (s) s.textContent = '';
            }, 2000);
        };
        document.getElementById('api-key-cancel').onclick = () => modal.classList.add('hidden');
    },
};
