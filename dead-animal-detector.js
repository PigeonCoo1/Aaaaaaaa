/**
 * Explorer Map — sensitive-content check.
 *
 * Some iNaturalist observations are of dead animals (roadkill, window strikes,
 * bones). Before opening one, we look at the observer's own annotations and
 * notes, estimate how likely that is, and let the person decide.
 */

const DeadAnimalDetector = {
    // Phrases that strongly suggest a dead animal
    strong: [
        'dead', 'deceased', 'roadkill', 'road kill', 'road-kill', 'carcass', 'carcase', 'corpse',
        'found dead', 'hit by car', 'hit by a car', 'run over', 'killed', 'decomposing', 'decomposed',
        'rotting', 'window strike', 'window kill', 'cat kill', 'predated', 'skeleton', 'skull',
        'd.o.r.', 'mortality', 'necropsy', 'lifeless',
    ],
    // Phrases that suggest it
    moderate: [
        'remains', 'bones', 'squished', 'crushed', 'mangled', 'not moving', "wasn't moving",
        'no longer alive', 'found on road', 'side of the road', 'side of road', 'struck by', 'injured',
        'feathers only', 'fur only', 'shell only', 'dor',
    ],
    // Phrases that hint at it
    weak: ['specimen', 'museum', 'preserved', 'taxidermy', 'pinned', 'on the road', 'on pavement', 'washed up', 'washed ashore'],

    _has(text, phrase) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(text);
    },

    /** Returns { isDead, confidence (0-100), reasons[] }. */
    analyze(poi) {
        const none = { isDead: false, confidence: 0, reasons: [] };
        if (poi.sourceId !== 'inat' || !ANIMAL_CATEGORIES.has(poi.category)) return none;
        if (!Settings.get('contentWarnings')) return none;

        let score = 0;
        const reasons = [];

        if (poi.annotatedDead) { score += 90; reasons.push('The observer marked it as dead'); }
        if (poi.annotatedBone) { score += 45; reasons.push('Marked as bones / remains'); }

        const text = `${poi.description || ''} ${(poi.obsTags || []).join(' ')}`.toLowerCase();
        let kw = 0;
        for (const p of this.strong) if (this._has(text, p)) { kw += 35; reasons.push(`Notes mention “${p}”`); }
        for (const p of this.moderate) if (this._has(text, p)) { kw += 18; reasons.push(`Notes mention “${p}”`); }
        for (const p of this.weak) if (this._has(text, p)) { kw += 8; reasons.push(`Notes mention “${p}”`); }
        score += Math.min(kw, 80);

        for (const f of poi.ofvs || []) {
            const name = (f.name || '').toLowerCase(), value = String(f.value || '').toLowerCase();
            if (/alive|dead|condition|roadkill|mortality/.test(name) && /dead|deceased|roadkill|^yes$/.test(value) && !/alive/.test(value)) {
                score += 45;
                reasons.push(`Observation field “${f.name}” says “${f.value}”`);
            }
        }

        // An explicit "alive" annotation outweighs keyword guesses
        if (poi.annotatedAlive && !poi.annotatedDead) score = Math.min(score, 10);

        const confidence = Math.min(score, 97);
        return { isDead: confidence >= 18, confidence, reasons: [...new Set(reasons)] };
    },

    /** Show the warning. Resolves true (show it) or false (go back). */
    showWarning(poi, analysis) {
        return new Promise(resolve => {
            const overlay = document.getElementById('warning-overlay');
            const textEl = document.getElementById('warning-text');
            const fillEl = document.getElementById('confidence-fill');
            const confText = document.getElementById('confidence-text');
            const cancelBtn = document.getElementById('warning-cancel-btn');
            const proceedBtn = document.getElementById('warning-proceed-btn');

            const E = Util.esc;
            let html = `This observation of <strong>${E(poi.commonName || poi.title || 'an animal')}</strong> may show a dead animal.`;
            if (analysis.reasons.length) {
                html += `<ul>${analysis.reasons.slice(0, 4).map(r => `<li>${E(r)}</li>`).join('')}</ul>`;
            }
            textEl.innerHTML = html;

            const conf = analysis.confidence;
            fillEl.style.width = `${conf}%`;
            fillEl.dataset.level = conf > 60 ? 'high' : conf > 35 ? 'mid' : 'low';
            confText.textContent = `${conf}% likely`;

            overlay.classList.remove('hidden');
            cancelBtn.focus();

            const done = result => {
                overlay.classList.add('hidden');
                cancelBtn.removeEventListener('click', onCancel);
                proceedBtn.removeEventListener('click', onProceed);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };
            const onCancel = () => done(false);
            const onProceed = () => done(true);
            const onKey = e => { if (e.key === 'Escape') done(false); };
            cancelBtn.addEventListener('click', onCancel);
            proceedBtn.addEventListener('click', onProceed);
            document.addEventListener('keydown', onKey);
        });
    },
};
