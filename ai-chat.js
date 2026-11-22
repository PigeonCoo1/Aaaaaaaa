/**
 * Explorer Map — "Ask about this" AI chat.
 *
 * Three AI providers, each with every model your key can use (the model lists
 * are loaded live from the provider, so new models appear automatically):
 *
 *   Claude  (Anthropic)  — default: Claude Sonnet 5.5
 *   ChatGPT (OpenAI)
 *   Gemini  (Google)     — default: Gemini 4 Hydrogen
 *
 * Keys are stored only in this browser and sent only to the provider you pick.
 * With no key at all, a built-in engine still answers from Wikipedia and the
 * map data, so the chat always works.
 */

const AIChat = {
    // ------------------------------------------------------------------
    // Providers
    // ------------------------------------------------------------------
    PROVIDERS: {
        claude: {
            label: 'Claude', company: 'Anthropic',
            keyUrl: 'https://platform.claude.com/settings/keys',
            keyPlaceholder: 'sk-ant-…',
            defaultModel: 'claude-sonnet-5-5',
            prefer: [/^claude-sonnet-5-5/, /^claude-sonnet-5/, /^claude-sonnet/, /^claude-opus/, /^claude-/],
            seed: [
                ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
                ['claude-opus-5-5', 'Claude Opus 5.5'],
                ['claude-haiku-5-5', 'Claude Haiku 5.5'],
                ['claude-fable-5-2', 'Claude Fable 5.2'],
                ['claude-fable-5-1', 'Claude Fable 5.1'],
                ['claude-fable-5', 'Claude Fable 5'],
                ['claude-opus-5', 'Claude Opus 5'],
                ['claude-opus-4-8', 'Claude Opus 4.8'],
                ['claude-opus-4-7', 'Claude Opus 4.7'],
                ['claude-opus-4-6', 'Claude Opus 4.6'],
                ['claude-sonnet-5', 'Claude Sonnet 5'],
                ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
                ['claude-haiku-4-5', 'Claude Haiku 4.5'],
            ],
        },
        openai: {
            label: 'ChatGPT', company: 'OpenAI',
            keyUrl: 'https://platform.openai.com/api-keys',
            keyPlaceholder: 'sk-…',
            defaultModel: 'gpt-6.2-sol',
            prefer: [/^gpt-6\.2-sol$/, /^gpt-6[\d.]*-sol$/, /^gpt-6/, /^gpt-5[\d.]*-sol$/, /^gpt-5/, /^gpt-/],
            seed: [
                ['gpt-6.2-sol', 'GPT-6.2 Sol'],
                ['gpt-6.2-astra', 'GPT-6.2 Astra'],
                ['gpt-5.6-sol', 'GPT-5.6 Sol'],
                ['gpt-5.6-terra', 'GPT-5.6 Terra'],
                ['gpt-5.6-luna', 'GPT-5.6 Luna'],
            ],
        },
        gemini: {
            label: 'Gemini', company: 'Google',
            keyUrl: 'https://aistudio.google.com/app/apikey',
            keyPlaceholder: 'AIza…',
            defaultModel: 'gemini-4-hydrogen',
            prefer: [/^gemini-4-hydrogen$/, /^gemini-4-hydrogen/, /hydrogen/, /^gemini-4/, /^gemini-.*flash/, /^gemini-/],
            seed: [
                ['gemini-4-hydrogen', 'Gemini 4 Hydrogen'],
                ['gemini-4-carbon', 'Gemini 4 Carbon'],
                ['gemini-4-argon', 'Gemini 4 Argon'],
            ],
        },
    },

    STORE_KEY: 'explorer_map_ai_v2',
    config: {
        provider: 'claude',
        models: {},          // providerId -> chosen model id
        keys: {},            // providerId -> API key
        lists: {},           // providerId -> { at, models: [[id, name], …] } (live list cache)
    },

    currentPOI: null,
    messages: [],            // [{ role: 'user' | 'assistant', content }]
    _abort: null,
    _busy: false,

    // ------------------------------------------------------------------
    // Config
    // ------------------------------------------------------------------
    loadConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.STORE_KEY) || 'null');
            if (saved) Object.assign(this.config, saved);
        } catch (e) { /* ignore */ }
        this.config.models = this.config.models || {};
        this.config.keys = this.config.keys || {};
        this.config.lists = this.config.lists || {};
        // Carry over a Gemini key saved by the previous version of the app
        try {
            const old = localStorage.getItem('explorer_map_gemini_key');
            if (old && !this.config.keys.gemini) { this.config.keys.gemini = old; this.saveConfig(); }
        } catch (e) { /* ignore */ }
        if (!this.PROVIDERS[this.config.provider] && this.config.provider !== 'builtin') this.config.provider = 'claude';
    },

    saveConfig() {
        try { localStorage.setItem(this.STORE_KEY, JSON.stringify(this.config)); } catch (e) { /* ignore */ }
    },

    key(pid) { return (this.config.keys[pid] || '').trim(); },

    /** Models to offer for a provider: the live list if we have one, else the built-in starter list. */
    modelList(pid) {
        const live = this.config.lists[pid];
        return live && live.models && live.models.length ? live.models : this.PROVIDERS[pid].seed;
    },

    /** The model that will actually be used for a provider. */
    model(pid) {
        const p = this.PROVIDERS[pid];
        const chosen = this.config.models[pid];
        if (chosen) return chosen;
        const live = this.config.lists[pid];
        if (live && live.models && live.models.length) {
            const ids = live.models.map(m => m[0]);
            if (ids.includes(p.defaultModel)) return p.defaultModel;
            for (const re of p.prefer) { const hit = ids.find(id => re.test(id)); if (hit) return hit; }
            return ids[0];
        }
        return p.defaultModel;
    },

    modelName(pid, id) {
        const hit = this.modelList(pid).find(m => m[0] === id) || this.PROVIDERS[pid].seed.find(m => m[0] === id);
        return hit ? hit[1] : id;
    },

    /**
     * Which engine answers right now.
     * The chosen provider if it has a key; otherwise any provider that does;
     * otherwise the built-in (no key) engine.
     */
    active() {
        const chosen = this.config.provider;
        if (chosen === 'builtin') return { pid: 'builtin', label: 'Built-in guide', chosen };
        if (this.key(chosen)) return this._desc(chosen, chosen);
        const other = Object.keys(this.PROVIDERS).find(pid => this.key(pid));
        if (other) return this._desc(other, chosen);
        return { pid: 'builtin', label: 'Built-in guide', chosen, needsKey: true };
    },

    _desc(pid, chosen) {
        const model = this.model(pid);
        return { pid, model, label: this.modelName(pid, model), chosen, substituted: pid !== chosen };
    },

    // ------------------------------------------------------------------
    // Model lists (live, per key)
    // ------------------------------------------------------------------
    async refreshModels(pid) {
        const key = this.key(pid);
        if (!key) throw new Error('Add an API key first.');
        let models = [];
        if (pid === 'claude') {
            const d = await this._getJSON('https://api.anthropic.com/v1/models?limit=1000', this._claudeHeaders(key), pid);
            models = (d.data || []).map(m => [m.id, m.display_name || m.id]);
        } else if (pid === 'openai') {
            const d = await this._getJSON('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }, pid);
            const skip = /(embedding|tts|whisper|audio|realtime|image|transcribe|moderation|dall-e|sora|instruct|computer-use|babbage|davinci|guard)/i;
            models = (d.data || [])
                .filter(m => /^(gpt-|o\d|chatgpt-)/i.test(m.id) && !skip.test(m.id))
                .sort((a, b) => (b.created || 0) - (a.created || 0))
                .map(m => [m.id, m.id]);
        } else if (pid === 'gemini') {
            const d = await this._getJSON('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': key }, pid);
            const skip = /(embedding|imagen|veo|tts|aqa|image-generation|native-audio|live|robotics)/i;
            models = (d.models || [])
                .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && !skip.test(m.name))
                .map(m => [m.name.replace(/^models\//, ''), m.displayName || m.name.replace(/^models\//, '')]);
            // Newest generations first, default model on top
            models.sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }));
        }
        if (!models.length) throw new Error('No chat models were returned for this key.');
        const def = this.PROVIDERS[pid].defaultModel;
        models.sort((a, b) => (b[0] === def) - (a[0] === def));
        this.config.lists[pid] = { at: Date.now(), models };
        this.saveConfig();
        return models;
    },

    async _getJSON(url, headers, pid) {
        let resp;
        try { resp = await fetch(url, { headers }); }
        catch (e) { throw new Error(`Couldn't reach ${this.PROVIDERS[pid].label}. Check your connection.`); }
        if (!resp.ok) throw await this._httpError(resp, pid);
        return resp.json();
    },

    async _httpError(resp, pid) {
        let detail = '';
        try {
            const body = await resp.json();
            detail = body?.error?.message || body?.message || '';
        } catch (e) { /* not JSON */ }
        const name = this.PROVIDERS[pid].label;
        let msg;
        switch (resp.status) {
            case 401: case 403: msg = `${name} rejected the API key. Check it in AI settings.`; break;
            case 404: msg = `That model isn't available for this ${name} key. Pick another model in AI settings.`; break;
            case 429: msg = `${name} says you've hit a rate limit or run out of credit. Try again shortly.`; break;
            case 500: case 502: case 503: case 529: msg = `${name} is having trouble right now. Try again in a moment.`; break;
            default: msg = `${name} returned an error (${resp.status}).`;
        }
        const err = new Error(detail && resp.status !== 401 ? `${msg} — ${detail.slice(0, 240)}` : msg);
        err.status = resp.status;
        err.detail = detail;
        return err;
    },

    // ------------------------------------------------------------------
    // Chat lifecycle
    // ------------------------------------------------------------------
    /** Wire up the chat UI once. */
    setup() {
        this.loadConfig();
        const form = document.getElementById('ai-form');
        const input = document.getElementById('ai-input');
        form.addEventListener('submit', e => {
            e.preventDefault();
            if (this._busy) { this.stop(); return; }
            this.send(input.value);
        });
        document.getElementById('ai-suggestions').addEventListener('click', e => {
            const btn = e.target.closest('button[data-q]');
            if (btn && !this._busy) this.send(btn.dataset.q);
        });
        document.getElementById('ai-model-btn').addEventListener('click', () => {
            if (typeof App !== 'undefined') App.openSettings('ai');
        });
        this.updateModelButton();
    },

    /** Start a fresh conversation about a POI. */
    init(poi) {
        this.stop();
        this.currentPOI = poi;
        this.messages = [];
        document.getElementById('ai-messages').innerHTML = '';
        document.getElementById('ai-input').value = '';
        this.setStatus('');
        this.renderSuggestions(poi);
        this.updateModelButton();
        DetailView.extras(poi);          // warm the lookups the answers will use
    },

    updateModelButton() {
        const btn = document.getElementById('ai-model-btn');
        if (!btn) return;
        const a = this.active();
        btn.textContent = `${a.pid === 'builtin' ? '📚' : '✨'} ${a.label} ▾`;
        btn.title = 'Choose the AI model';
        const note = document.getElementById('ai-note');
        if (note) {
            if (a.needsKey) {
                const want = this.PROVIDERS[a.chosen];
                note.innerHTML = `Answering from Wikipedia and map data. Add a ${Util.esc(want.label)} key in <button type="button" class="linklike" data-open-ai>AI settings</button> for full ${Util.esc(this.modelName(a.chosen, this.model(a.chosen)))} answers.`;
            } else if (a.substituted) {
                note.innerHTML = `No ${Util.esc(this.PROVIDERS[a.chosen].label)} key yet — using ${Util.esc(a.label)}. <button type="button" class="linklike" data-open-ai>Change</button>`;
            } else {
                note.textContent = '';
            }
            const link = note.querySelector('[data-open-ai]');
            if (link) link.addEventListener('click', () => App.openSettings('ai'));
        }
    },

    renderSuggestions(poi) {
        const cat = getCategory(poi.category);
        const name = poi.title;
        let qs;
        if (poi.isScan) {
            qs = ['What rocks and minerals could I find around here?', 'How did this rock form?', 'What was this place like when it formed?', 'What is this soil good for?'];
        } else if (poi.category === 'geo_fossil') {
            qs = ['What lived here, and when?', 'What did this place look like back then?', 'Can I collect fossils here?', 'How do I spot fossils in this rock?'];
        } else if (['geo_mineral', 'geo_gem', 'geo_mine', 'geo_quarry'].includes(poi.category)) {
            qs = ['What minerals or crystals could I find here?', 'How did this deposit form?', 'Is it safe and legal to collect here?', 'What is the history of this site?'];
        } else if (cat.group === 'geology' || cat.group === 'landforms') {
            qs = [`How did ${name} form?`, 'What kind of rock is this?', 'What minerals might be nearby?', 'What should I look for when I visit?'];
        } else if (cat.group === 'plants') {
            qs = [`What is ${name}?`, 'Is it edible or poisonous?', 'How do I identify it?', 'Is it likely still there?'];
        } else if (cat.group === 'animals') {
            qs = [`Tell me about ${name}`, 'Is it dangerous?', 'What does it eat?', 'When am I most likely to see one?'];
        } else if (cat.group === 'history') {
            qs = [`What is the story of ${name}?`, 'When was it built, and by whom?', 'What should I look for when I visit?'];
        } else if (cat.group === 'water' || cat.group === 'areas') {
            qs = [`What is special about ${name}?`, 'What wildlife might I see here?', 'What is the geology here?', 'Best time to visit?'];
        } else {
            qs = [`What is ${name}?`, 'What is interesting about this spot?', 'What else is worth seeing nearby?'];
        }
        document.getElementById('ai-suggestions').innerHTML = qs
            .map(q => `<button type="button" class="suggest" data-q="${Util.esc(q)}">${Util.esc(q)}</button>`).join('');
    },

    setStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text || '';
    },

    setBusy(busy) {
        this._busy = busy;
        const btn = document.getElementById('ai-send');
        btn.textContent = busy ? 'Stop' : 'Ask';
        btn.classList.toggle('is-stop', busy);
    },

    stop() {
        if (this._abort) { this._abort.abort(); this._abort = null; }
    },

    async send(text) {
        const question = (text || '').trim();
        const poi = this.currentPOI;
        if (!question || !poi || this._busy) return;
        document.getElementById('ai-input').value = '';

        this.addBubble('user', question);
        this.messages.push({ role: 'user', content: question });
        const bubble = this.addBubble('assistant', '');
        bubble.classList.add('is-thinking');

        const a = this.active();
        this._abort = new AbortController();
        const signal = this._abort.signal;
        this.setBusy(true);
        this.setStatus(a.pid === 'builtin' ? 'Looking it up…' : `Asking ${a.label}…`);

        let answer = '';
        const paint = this._painter(bubble, () => answer);
        try {
            // Give the background lookups a moment so the model gets the full picture
            await this._settleExtras(poi, 3500);
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            if (a.pid === 'builtin') {
                answer = this.buildAnswer(question, poi);
            } else {
                const system = this.systemPrompt(poi);
                const history = this.messages.slice(-12);
                const onText = chunk => { answer += chunk; bubble.classList.remove('is-thinking'); paint(); };
                if (a.pid === 'claude') await this.callClaude(a.model, system, history, onText, signal);
                else if (a.pid === 'openai') await this.callOpenAI(a.model, system, history, onText, signal);
                else await this.callGemini(a.model, system, history, onText, signal);
                if (!answer.trim()) answer = '_The model returned an empty answer. Try rephrasing, or pick another model in AI settings._';
            }
            this.setStatus(a.pid === 'builtin' ? '' : `Answered by ${a.label}`);
        } catch (err) {
            if (err.name === 'AbortError' || signal.aborted) {
                answer = (answer ? answer + '\n\n' : '') + '_Stopped._';
                this.setStatus('');
            } else {
                console.warn('AI error:', err);
                // Never leave the person empty-handed: fall back to the built-in guide.
                const fallback = this.buildAnswer(question, poi);
                answer = `> ⚠️ ${err.message || 'The AI request failed.'}\n\nHere is what I can tell from the map data instead:\n\n${fallback}`;
                this.setStatus('');
            }
        } finally {
            bubble.classList.remove('is-thinking');
            bubble.innerHTML = this.markdown(answer);
            this.messages.push({ role: 'assistant', content: answer });
            this._abort = null;
            this.setBusy(false);
            this._scrollToEnd();
        }
    },

    async _settleExtras(poi, ms) {
        const x = DetailView.extras(poi);
        const all = Promise.allSettled(Object.values(x));
        await Promise.race([all, new Promise(r => setTimeout(r, ms))]);
    },

    _painter(bubble, getText) {
        let queued = false;
        return () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                bubble.innerHTML = this.markdown(getText());
                this._scrollToEnd();
            });
        };
    },

    _scrollToEnd() {
        const box = document.getElementById('ai-messages');
        if (box) box.scrollTop = box.scrollHeight;
    },

    addBubble(role, text) {
        const box = document.getElementById('ai-messages');
        const div = document.createElement('div');
        div.className = `msg msg-${role}`;
        if (role === 'user') div.textContent = text;
        else div.innerHTML = this.markdown(text);
        box.appendChild(div);
        this._scrollToEnd();
        return div;
    },

    // ------------------------------------------------------------------
    // What the model is told
    // ------------------------------------------------------------------
    systemPrompt(poi) {
        const units = Settings.get('units') === 'imperial' ? 'imperial (miles, feet)' : 'metric (km, m)';
        return [
            'You are the field guide built into Explorer Map, an app people use outdoors to explore the nature, rocks, minerals, fossils, landforms and places around them. The person has tapped one discovery on the map and is asking you about it.',
            '',
            'The block below holds everything the app knows about that discovery, gathered from open data (OpenStreetMap, iNaturalist, USGS, the Paleobiology Database, Macrostrat, Wikidata, Wikipedia). Treat it as the facts about this specific spot. For everything beyond it, use your own knowledge — and make it clear when you are giving general background rather than something recorded for this exact location, or when you are not sure.',
            '',
            `People read your answers on a phone, often outside, so keep them short and easy to scan: lead with the direct answer, then a few short paragraphs or bullet points. Use ${units} units. Plain Markdown only (bold, bullets, short headings).`,
            '',
            'A few things matter for safety. Wild plants and fungi have dangerous look-alikes, so never present one as safe to eat on the strength of a map pin or photo; explain what would need to be confirmed and by whom. Old mines and quarries are hazardous and often on private land, and parks and reserves usually forbid collecting, so mention access and collecting rules when someone asks about visiting or collecting. Encourage watching wildlife from a distance.',
            '',
            `Today is ${new Date().toISOString().slice(0, 10)}.`,
            '',
            '<selected_discovery>',
            JSON.stringify(this.contextFor(poi), null, 1),
            '</selected_discovery>',
        ].join('\n');
    },

    /** Compact, model-readable summary of everything known about a POI. */
    contextFor(poi) {
        const cat = getCategory(poi.category);
        const xv = poi._xv || {};
        const A = Util.arr;
        const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s);
        const c = {
            name: poi.title,
            kind: cat.label,
            group: GROUPS[cat.group].label,
            data_source: poi.source,
            latitude: +poi.lat.toFixed(5),
            longitude: +poi.lon.toFixed(5),
        };
        if (poi.subtitle) c.summary = poi.subtitle;
        const d = Util.fromUser(poi);
        if (d) c.distance_from_user = d;
        if (poi.placeGuess) c.place = poi.placeGuess;
        if (poi.description) c.description = clip(Util.plain(poi.description), 800);

        // Living things
        if (poi.scientificName) c.scientific_name = poi.scientificName;
        if (poi.taxonRank) c.taxon_rank = poi.taxonRank;
        if (poi.observedOn) c.observed_on = poi.observedOn;
        if (poi.qualityGrade) c.identification_quality = poi.qualityGrade;
        if (poi.threatened) c.threatened = true;
        if (poi.introduced) c.introduced_in_this_area = true;
        if (poi.obscured) c.location_is_approximate = true;
        if (xv.taxon) {
            const t = xv.taxon;
            c.species_summary = clip(Util.plain(t.wikipedia_summary), 1200);
            if (t.observations_count) c.inaturalist_observations_worldwide = t.observations_count;
            c.lineage = (t.ancestors || []).filter(a => ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'].includes(a.rank))
                .map(a => `${a.rank}: ${a.name}${a.preferred_common_name ? ` (${a.preferred_common_name})` : ''}`);
            const cs = (t.conservation_statuses || []).slice(0, 5).map(s => `${s.status_name || s.status}${s.authority ? ` — ${s.authority}` : ''}`);
            if (cs.length) c.conservation = cs;
        }

        // OpenStreetMap tags worth knowing
        if (poi.tags) {
            const keep = {};
            for (const [k, v] of Object.entries(poi.tags)) {
                if (/^(source|created_by|note|fixme|gnis:|tiger:|ref:|addr:|wikidata$|wikipedia$|image$|website$|name$|check_date)/i.test(k)) continue;
                keep[k] = clip(String(v), 200);
                if (Object.keys(keep).length >= 25) break;
            }
            if (Object.keys(keep).length) c.openstreetmap_tags = keep;
        }
        if (poi.wdTypes) c.types = poi.wdTypes.slice(0, 6);

        // Mineral sites
        if (poi.commodities) c.commodities = poi.commodities;
        if (poi.devStat) c.development_status = poi.devStat;
        if (xv.mrds) {
            const p = xv.mrds, dep = p.deposits || {};
            const mats = A(p.material);
            const m = {
                deposit_type: dep.dep_tp || (A(p.model_type)[0] || {}).model_name,
                operation_type: dep.oper_tp,
                discovery_year: dep.disc_yr,
                ore_minerals: [...new Set(mats.filter(x => /ore/i.test(x.ore_gangue || '')).map(x => x.material))],
                gangue_minerals: [...new Set(mats.filter(x => /gangue/i.test(x.ore_gangue || '')).map(x => x.material))],
                host_rocks: [...new Set(A(p.rock).map(r => r.rocku || r.rock_desc || r.low_name).filter(Boolean))],
                mining_district: A(p.districts).map(x => x.district).filter(Boolean),
                land_status: (A(p.land_status)[0] || {}).land_st,
                place: [(A(p.location)[0] || {}).county, (A(p.location)[0] || {}).state_prov, (A(p.location)[0] || {}).country].filter(Boolean).join(', '),
                alteration: clip((A(p.alteration)[0] || {}).alterat_text, 400),
                notes: A(p.comment).slice(0, 4).map(x => clip(`${x.ctg || 'note'}: ${x.cmt_txt}`, 500)),
            };
            for (const k of Object.keys(m)) if (m[k] === undefined || m[k] === '' || (Array.isArray(m[k]) && !m[k].length)) delete m[k];
            c.usgs_site_record = m;
        }

        // Fossil sites
        if (poi.taxa) {
            c.fossil_taxa = poi.taxa.slice(0, 50).map(t => [t.name, t.cls || t.phylum].filter(Boolean).join(' — '));
            c.geologic_age = poi.ageLabel;
            if (poi.ageMaxMa) c.age_million_years = [poi.ageMaxMa, poi.ageMinMa];
            if (poi.formation) c.formation = poi.formation;
            if (poi.member) c.member = poi.member;
            if (poi.siteNotes) c.site_notes = clip(poi.siteNotes, 500);
            c.region = [poi.county, poi.state, poi.country].filter(Boolean).join(', ');
        }

        // Ground scans
        if (poi.units) {
            c.geologic_map_units_most_detailed_first = poi.units.slice(0, 4).map(u => ({
                name: u.name, rock_types: u.rocks, age: u.age,
                age_million_years: [u.bottomAge, u.topAge],
                description: clip(u.description, 600) || undefined,
                map_scale: u.scale,
            }));
            if (xv.soil) c.soil_type_wrb = xv.soil.name;
            if (typeof xv.elevation === 'number') c.elevation_m = Math.round(xv.elevation);
        }

        if (xv.wiki && xv.wiki.extract) {
            c.wikipedia_article = { title: xv.wiki.title, text: clip(xv.wiki.extract, 4500) };
        }
        return c;
    },

    // ------------------------------------------------------------------
    // Claude (Anthropic Messages API, called straight from the browser)
    // ------------------------------------------------------------------
    _claudeHeaders(key, beta) {
        const h = {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2026-10-21',
            // Required for a key to be used from a web page (bring-your-own-key apps)
            'anthropic-dangerous-direct-browser-access': 'true',
        };
        if (beta) h['anthropic-beta'] = beta;
        return h;
    },

    async callClaude(model, system, history, onText, signal) {
        const key = this.key('claude');
        const base = {
            model,
            max_tokens: 16000,
            stream: true,
            system,
            messages: history.map(m => ({ role: m.role, content: m.content })),
        };
        // Current models: answer chat questions at low effort (fast, inexpensive), and let the
        // API retry on another Claude model if a safety classifier declines the first one.
        const extras = {};
        let beta = null;
        if (/^claude-(fable|mythos)-|^claude-opus-(5|4-[5-8])|^claude-sonnet-(5|4-6)|^claude-haiku-5/.test(model)) {
            extras.output_config = { effort: 'low' };
        }
        if (/^claude-(fable-5-[12]|opus-5-5|opus-5|sonnet-5-5)$/.test(model)) {
            extras.fallbacks = 'default';
            beta = 'server-side-fallback-2026-07-01';
        }

        let resp = await this._post('https://api.anthropic.com/v1/messages', this._claudeHeaders(key, beta), { ...base, ...extras }, signal, 'claude');
        if (resp.status === 400 && Object.keys(extras).length) {
            // An optional setting this model or account doesn't accept — retry with the plain request.
            resp = await this._post('https://api.anthropic.com/v1/messages', this._claudeHeaders(key), base, signal, 'claude');
        }
        if (!resp.ok) throw await this._httpError(resp, 'claude');

        let stopReason = null, gotText = false;
        for await (const data of this._sse(resp)) {
            let ev;
            try { ev = JSON.parse(data); } catch (e) { continue; }
            if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
                gotText = true;
                onText(ev.delta.text);
            } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
                stopReason = ev.delta.stop_reason;
            } else if (ev.type === 'error') {
                throw new Error(`Claude: ${ev.error?.message || 'stream error'}`);
            }
        }
        if (stopReason === 'refusal') {
            onText(gotText ? '\n\n_Claude stopped here and declined to continue this answer._'
                : '_Claude declined to answer this one. Try asking it a different way._');
        } else if (stopReason === 'max_tokens') {
            onText('\n\n_(The answer was cut off for length — ask me to continue.)_');
        }
    },

    // ------------------------------------------------------------------
    // ChatGPT (OpenAI)
    // ------------------------------------------------------------------
    async callOpenAI(model, system, history, onText, signal) {
        const key = this.key('openai');
        const headers = { 'content-type': 'application/json', Authorization: `Bearer ${key}` };
        const resp = await this._post('https://api.openai.com/v1/chat/completions', headers, {
            model, stream: true,
            messages: [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))],
        }, signal, 'openai');

        if (!resp.ok) {
            const err = await this._httpError(resp, 'openai');
            // Some models are only served by the newer Responses API.
            if ((resp.status === 400 || resp.status === 404) && /responses|not a chat model|chat\/completions/i.test(err.detail || '')) {
                return this._callOpenAIResponses(model, system, history, onText, signal, headers);
            }
            throw err;
        }
        for await (const data of this._sse(resp)) {
            if (data === '[DONE]') break;
            let ev;
            try { ev = JSON.parse(data); } catch (e) { continue; }
            if (ev.error) throw new Error(`ChatGPT: ${ev.error.message || 'stream error'}`);
            const delta = ev.choices && ev.choices[0] && ev.choices[0].delta;
            if (delta && typeof delta.content === 'string' && delta.content) onText(delta.content);
        }
    },

    async _callOpenAIResponses(model, system, history, onText, signal, headers) {
        const resp = await this._post('https://api.openai.com/v1/responses', headers, {
            model, stream: true,
            instructions: system,
            input: history.map(m => ({ role: m.role, content: m.content })),
        }, signal, 'openai');
        if (!resp.ok) throw await this._httpError(resp, 'openai');
        for await (const data of this._sse(resp)) {
            if (data === '[DONE]') break;
            let ev;
            try { ev = JSON.parse(data); } catch (e) { continue; }
            if (ev.type === 'response.output_text.delta' && ev.delta) onText(ev.delta);
            else if (ev.type === 'error' || ev.type === 'response.failed') {
                throw new Error(`ChatGPT: ${ev.message || ev.response?.error?.message || 'stream error'}`);
            }
        }
    },

    // ------------------------------------------------------------------
    // Gemini (Google)
    // ------------------------------------------------------------------
    async callGemini(model, system, history, onText, signal) {
        const key = this.key('gemini');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
        const resp = await this._post(url, { 'content-type': 'application/json', 'x-goog-api-key': key }, {
            systemInstruction: { parts: [{ text: system }] },
            contents: history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        }, signal, 'gemini');
        if (!resp.ok) throw await this._httpError(resp, 'gemini');

        let finish = null, gotText = false;
        for await (const data of this._sse(resp)) {
            let ev;
            try { ev = JSON.parse(data); } catch (e) { continue; }
            if (ev.error) throw new Error(`Gemini: ${ev.error.message || 'stream error'}`);
            if (ev.promptFeedback && ev.promptFeedback.blockReason) finish = ev.promptFeedback.blockReason;
            const cand = ev.candidates && ev.candidates[0];
            if (!cand) continue;
            for (const part of (cand.content && cand.content.parts) || []) {
                if (part.thought || typeof part.text !== 'string') continue;
                gotText = true;
                onText(part.text);
            }
            if (cand.finishReason) finish = cand.finishReason;
        }
        if (!gotText && finish && finish !== 'STOP') {
            onText(`_Gemini did not answer (${String(finish).toLowerCase().replace(/_/g, ' ')}). Try asking it a different way._`);
        } else if (finish === 'MAX_TOKENS') {
            onText('\n\n_(The answer was cut off for length — ask me to continue.)_');
        }
    },

    // ------------------------------------------------------------------
    // HTTP + server-sent-event plumbing
    // ------------------------------------------------------------------
    async _post(url, headers, body, signal, pid) {
        try {
            return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            throw new Error(`Couldn't reach ${this.PROVIDERS[pid].label}. Check your connection (ad blockers can also block AI requests).`);
        }
    },

    /** Yields the data payload of each server-sent event in a streaming response. */
    async *_sse(resp) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const drain = function* (final) {
            for (;;) {
                const m = /\r?\n\r?\n/.exec(buf);
                if (!m) break;
                const raw = buf.slice(0, m.index);
                buf = buf.slice(m.index + m[0].length);
                const data = raw.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
                if (data) yield data;
            }
            if (final && buf.trim()) {
                const data = buf.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
                buf = '';
                if (data) yield data;
            }
        };
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            yield* drain(false);
        }
        buf += decoder.decode();
        yield* drain(true);
    },

    // ------------------------------------------------------------------
    // Markdown → safe HTML (escape first, then a small set of formats)
    // ------------------------------------------------------------------
    markdown(text) {
        if (!text) return '';
        const inline = s => Util.esc(s)
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_]+)__/g, '<strong>$1</strong>')
            .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
            .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        const out = [];
        let list = null, para = [], quote = [], code = null;
        const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
        const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null; } };
        const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.join('<br>')}</blockquote>`); quote = []; } };
        const flushAll = () => { flushPara(); flushList(); flushQuote(); };

        for (const rawLine of String(text).split('\n')) {
            const line = rawLine.replace(/\s+$/, '');
            if (code !== null) {
                if (/^```/.test(line)) { out.push(`<pre><code>${Util.esc(code.join('\n'))}</code></pre>`); code = null; }
                else code.push(rawLine);
                continue;
            }
            if (/^```/.test(line)) { flushAll(); code = []; continue; }
            if (!line.trim()) { flushAll(); continue; }
            let m;
            if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushAll(); out.push(`<h4>${inline(m[2])}</h4>`); continue; }
            if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
                flushPara(); flushQuote();
                if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
                list.items.push(inline(m[1])); continue;
            }
            if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
                flushPara(); flushQuote();
                if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
                list.items.push(inline(m[1])); continue;
            }
            if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(inline(m[1])); continue; }
            if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushAll(); out.push('<hr>'); continue; }
            flushList(); flushQuote();
            para.push(inline(line));
        }
        if (code !== null) out.push(`<pre><code>${Util.esc(code.join('\n'))}</code></pre>`);
        flushAll();
        return out.join('');
    },

    // ==================================================================
    // Built-in guide (no key needed) — answers from Wikipedia + map data
    // ==================================================================
    buildAnswer(question, poi) {
        const q = question.toLowerCase();
        const cat = getCategory(poi.category);
        const xv = poi._xv || {};
        const wikiText = (xv.wiki && xv.wiki.extract) || '';
        const taxonText = xv.taxon ? Util.plain(xv.taxon.wikipedia_summary) : '';
        const allText = `${wikiText}\n${taxonText}\n${poi.description || ''}`;
        const has = (...words) => words.some(w => q.includes(w));
        const sentences = (text, words, max = 4) => text.split(/(?<=[.!?])\s+/)
            .filter(s => s.length > 30 && s.length < 400 && words.some(w => s.toLowerCase().includes(w))).slice(0, max);
        const quoteLines = list => list.map(s => `> ${s.trim()}`).join('\n');
        const isGeo = cat.group === 'geology' || cat.group === 'landforms';
        const parts = [];

        if (has('mineral', 'crystal', 'gem', 'rock', 'find', 'collect', 'ore') && (isGeo || poi.units || poi.commodities)) {
            parts.push(this._geoFinds(poi, xv));
            if (has('collect', 'legal', 'safe', 'allowed')) {
                parts.push('**Collecting:** check land ownership first. Old mines are dangerous (unstable ground, bad air, open shafts) and often private; parks, monuments and reserves usually prohibit taking anything. Public land rules vary — ask the local land office.');
            }
        } else if (has('fossil', 'lived', 'look like back', 'back then') && poi.taxa) {
            parts.push(this._fossilSummary(poi));
        } else if (has('form', 'how old', 'age', 'geolog', 'made of') && (isGeo || poi.units)) {
            parts.push(this._geoFormation(poi, xv, wikiText, sentences));
        } else if (has('edible', 'poison', 'toxic', 'safe to eat', 'eat it')) {
            const hits = sentences(allText, ['edib', 'toxic', 'poison', 'food', 'eaten', 'cook', 'culinary']);
            parts.push(hits.length ? `Here is what my sources say about **${poi.title}**:\n\n${quoteLines(hits)}` : `I couldn't find edibility information for **${poi.title}** in my sources.`);
            parts.push('⚠️ **Never eat a wild plant or mushroom based on an app.** Many have toxic look-alikes — confirm with a local expert first.');
        } else if (has('dangerous', 'venom', 'bite', 'sting', 'harm', 'aggressive')) {
            const hits = sentences(allText, ['venom', 'poison', 'toxic', 'dangerous', 'aggressive', 'bite', 'sting', 'harmless', 'docile', 'shy']);
            parts.push(hits.length ? `About **${poi.title}**:\n\n${quoteLines(hits)}` : `I found nothing specific about danger from **${poi.title}**.`);
            parts.push('As a rule: watch wildlife from a distance and never handle an animal you cannot identify.');
        } else if (has('still there', 'still alive', 'still in', 'likely to see', 'when am i', 'best time', 'season', 'when')) {
            parts.push(this._whenAnswer(poi, cat, allText));
        } else if (has('identify', 'look like', 'recogni', 'tell apart')) {
            const hits = sentences(allText, ['distinguish', 'recogni', 'characteri', 'colou?r', 'leaf', 'leaves', 'flower', 'petal', 'wing', 'marking', 'pattern', ' cm', ' mm', 'length', 'tall'], 6);
            parts.push(hits.length ? `**Identifying ${poi.title}:**\n\n${hits.map(s => `- ${s.trim()}`).join('\n')}` : `I don't have identification notes for **${poi.title}**.`);
            if (poi.scientificName) parts.push(`Scientific name to look up: *${poi.scientificName}*`);
        } else if (has('eat', 'diet', 'feed', 'food')) {
            const hits = sentences(allText, ['eat', 'diet', 'feed', 'prey', 'forag', 'insect', 'seed', 'nectar']);
            parts.push(hits.length ? `**What ${poi.title} eats:**\n\n${quoteLines(hits)}` : `I don't have diet details for **${poi.title}**.`);
        } else if (has('habitat', 'where does', 'live', 'range', 'native')) {
            const hits = sentences(allText, ['habitat', 'found in', 'native', 'range', 'lives', 'common in', 'forest', 'grassland', 'wetland', 'distribut']);
            parts.push(hits.length ? `**Where ${poi.title} lives:**\n\n${quoteLines(hits)}` : `I don't have habitat details for **${poi.title}**.`);
        } else if (has('history', 'story', 'built', 'who made', 'when was')) {
            parts.push(wikiText ? `**${poi.title}:**\n\n${wikiText.slice(0, 1400)}${wikiText.length > 1400 ? '…' : ''}` : this._overview(poi, cat, xv));
        } else if (has('conservation', 'endangered', 'threatened', 'protected', 'rare')) {
            const cs = xv.taxon && xv.taxon.conservation_statuses;
            if (cs && cs.length) parts.push(`**Conservation status of ${poi.title}:**\n\n${cs.slice(0, 8).map(s => `- ${s.status_name || s.status}${s.authority ? ` — ${s.authority}` : ''}`).join('\n')}`);
            else parts.push(`No formal conservation status is recorded for **${poi.title}** in my sources.`);
        } else {
            // Anything else: the sentences that best match the question, else an overview
            const words = q.split(/[^a-z]+/).filter(w => w.length > 3 && !['what', 'this', 'that', 'about', 'tell', 'does', 'with', 'here', 'there', 'have'].includes(w));
            const hits = words.length ? sentences(allText, words, 5) : [];
            parts.push(hits.length && !has('what is', 'tell me', 'about', 'special', 'interesting')
                ? `**${poi.title}:**\n\n${quoteLines(hits)}` : this._overview(poi, cat, xv));
        }

        const a = this.active();
        if (a.needsKey) parts.push(`_Tip: add an AI key in AI settings for much fuller answers from ${this.modelName(a.chosen, this.model(a.chosen))}._`);
        return parts.filter(Boolean).join('\n\n');
    },

    _overview(poi, cat, xv) {
        const lines = [`**${poi.title}** — ${cat.label}`];
        if (poi.scientificName && poi.scientificName !== poi.title) lines.push(`*${poi.scientificName}*`);
        const body = (xv.wiki && xv.wiki.extract) || (xv.taxon && Util.plain(xv.taxon.wikipedia_summary)) || poi.description || '';
        if (body) lines.push('', body.length > 1300 ? body.slice(0, 1300) + '…' : body);
        if (poi.commodities && poi.commodities.length) lines.push('', `**Recorded here:** ${poi.commodities.join(', ')}${poi.devStat ? ` (${poi.devStat.toLowerCase()})` : ''}`);
        if (poi.taxa) lines.push('', this._fossilSummary(poi));
        if (poi.units && poi.units.length) lines.push('', this._geoFinds(poi, xv));
        if (poi.observedOn) lines.push('', `**Observed:** ${poi.observedOn} (${Util.daysAgoText(poi.observedOn)})`);
        const d = Util.fromUser(poi);
        if (d) lines.push(`**From you:** ${d}`);
        if (lines.length <= 2 && !body) lines.push('', 'The map data only has the location for this one.');
        return lines.join('\n');
    },

    _geoFinds(poi, xv) {
        const A = Util.arr;
        const out = [];
        if (poi.commodities && poi.commodities.length) out.push(`**Recorded at this site:** ${poi.commodities.join(', ')}${poi.devStat ? ` — ${poi.devStat.toLowerCase()}` : ''}.`);
        if (xv.mrds) {
            const mats = A(xv.mrds.material);
            const ore = [...new Set(mats.filter(m => /ore/i.test(m.ore_gangue || '')).map(m => m.material))];
            const gangue = [...new Set(mats.filter(m => /gangue/i.test(m.ore_gangue || '')).map(m => m.material))];
            if (ore.length) out.push(`**Ore minerals:** ${ore.join(', ')}`);
            if (gangue.length) out.push(`**Other minerals:** ${gangue.join(', ')}`);
            const rocks = [...new Set(A(xv.mrds.rock).map(r => r.rocku || r.rock_desc || r.low_name).filter(Boolean))];
            if (rocks.length) out.push(`**Host rock:** ${rocks.slice(0, 4).join(', ')}`);
        }
        if (poi.units && poi.units.length) {
            const u = poi.units[0];
            out.push(`**Bedrock here:** ${u.name}${u.rocks.length ? ` — ${u.rocks.join(', ')}` : ''} (${u.age}).`);
            if (u.description) out.push(u.description.slice(0, 500));
            const hint = this._rockHint(u.rocks.join(' ') + ' ' + u.lithText + ' ' + u.description);
            if (hint) out.push(`**Worth looking for:** ${hint}`);
        }
        if (poi.tags && poi.tags.resource) out.push(`**Resource:** ${DataSources.humanize(poi.tags.resource)}`);
        if (!out.length) out.push(`I don't have mineral records for **${poi.title}**. Tap **Scan ground** above to see what rock it sits on — that tells you what is worth looking for.`);
        return out.join('\n\n');
    },

    /** General-knowledge pointers by rock type (used only by the no-key guide). */
    _rockHint(text) {
        const t = (text || '').toLowerCase();
        const hints = [];
        if (/granit|pegmatit/.test(t)) hints.push('quartz and feldspar crystals, mica, and in pegmatites tourmaline, beryl or garnet');
        if (/basalt|andesit|rhyolit|volcan|tuff/.test(t)) hints.push('gas-bubble fillings such as agate, chalcedony, zeolites and geodes; obsidian in rhyolitic areas');
        if (/limestone|dolomit|carbonate|marl/.test(t)) hints.push('calcite crystals, chert or flint nodules, and marine fossils');
        if (/sandstone|siltstone|shale|mudstone|conglomerate/.test(t)) hints.push('fossils and petrified wood, concretions, and jasper or agate pebbles');
        if (/schist|gneiss|metamorph|marble|slate/.test(t)) hints.push('garnet, staurolite, kyanite and mica in schists; calcite and tremolite in marble');
        if (/alluvi|gravel|sand\b|terrace|glacial|till/.test(t)) hints.push('river-tumbled pebbles carried in from upstream — agate, jasper, quartz, and gold in the right districts');
        return hints.join('; ');
    },

    _geoFormation(poi, xv, wikiText, sentences) {
        const out = [];
        if (poi.units && poi.units.length) {
            for (const u of poi.units.slice(0, 2)) {
                out.push(`**${u.name}** — ${u.rocks.join(', ') || 'rock type not recorded'}; ${u.age}${u.bottomAge ? `, about ${Util.ageText(u.bottomAge)} old` : ''}.${u.description ? ' ' + u.description.slice(0, 400) : ''}`);
            }
        }
        if (poi.ageLabel) out.push(`**Age:** ${poi.ageLabel}${poi.ageMaxMa ? ` (about ${Util.ageText(poi.ageMaxMa)} ago)` : ''}${poi.formation ? `, ${poi.formation} Formation` : ''}.`);
        const hits = sentences(wikiText, ['form', 'eros', 'deposit', 'million', 'volcan', 'glaci', 'sediment', 'uplift', 'fault'], 5);
        if (hits.length) out.push(hits.map(s => `> ${s.trim()}`).join('\n'));
        if (!out.length) out.push(`I don't have formation details for **${poi.title}**. Tap **Scan ground** above for the rock unit and its age.`);
        return out.join('\n\n');
    },

    _fossilSummary(poi) {
        const groups = new Map();
        for (const t of poi.taxa) {
            const key = t.cls || t.phylum || 'Other';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(t.name);
        }
        const lines = [...groups].slice(0, 8).map(([k, names]) => `- **${k}:** ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`);
        return `**Fossils recorded here** (${poi.ageLabel || 'age unknown'}${poi.ageMaxMa ? `, about ${Util.ageText(poi.ageMaxMa)} ago` : ''}${poi.formation ? `, ${poi.formation} Formation` : ''}):\n\n${lines.join('\n')}`;
    },

    _whenAnswer(poi, cat, allText) {
        const out = [];
        const days = poi.observedOn ? Math.floor((Date.now() - new Date(poi.observedOn)) / 86400000) : null;
        if (poi.observedOn) out.push(`This one was recorded on **${poi.observedOn}** (${Util.daysAgoText(poi.observedOn)}).`);
        if (cat.group === 'plants') {
            out.push(days !== null && days < 400
                ? 'Plants stay put: unless the spot has been mown, built on or cleared, it is very likely still there — though it may be dormant or look different out of season.'
                : 'Trees, shrubs and other perennials are probably still there. Annuals will have died back, but usually reseed nearby.');
        } else if (cat.group === 'animals') {
            out.push('Animals move, so you are looking for the *species* in this area rather than this individual. Dawn and dusk are usually the most active times.');
            if (/migrat/i.test(allText)) out.push('This species is **migratory**, so it may only be here for part of the year.');
            if (poi.observedOn) out.push(`It was seen here in **${new Date(poi.observedOn).toLocaleString('en', { month: 'long' })}**, a good clue for when to look.`);
        } else {
            out.push('Rocks, landforms and landmarks do not go anywhere — it will be there.');
        }
        return out.join('\n\n');
    },
};
