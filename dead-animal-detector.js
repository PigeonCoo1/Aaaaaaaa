/**
 * Dead Animal Detection System
 * Analyzes iNaturalist observations for signs the animal may be dead.
 * Shows a warning with confidence percentage before displaying the detail.
 */

const DeadAnimalDetector = {
    // Keywords that strongly suggest death
    strongKeywords: [
        'dead', 'deceased', 'roadkill', 'road kill', 'carcass', 'remains',
        'mortality', 'dor ', 'dor,', 'found dead', 'hit by car', 'run over',
        'killed', 'corpse', 'skeleton', 'bones', 'skull', 'decomposing',
        'decomposed', 'rotting', 'decayed', 'lifeless', 'passed away',
        'window strike', 'window kill', 'cat kill', 'predated',
    ],

    // Keywords that moderately suggest death
    moderateKeywords: [
        'dried', 'shell only', 'shed skin', 'molt', 'feathers only',
        'fur only', 'flat', 'squished', 'crushed', 'mangled', 'stiff',
        'not moving', 'wasn\'t moving', 'no longer alive', 'found on road',
        'found on highway', 'side of road', 'roadside', 'struck',
        'injury', 'injured', 'wound', 'autopsy', 'necropsy',
    ],

    // Keywords that weakly suggest it (might be dead)
    weakKeywords: [
        'old specimen', 'specimen', 'collected', 'museum', 'preserved',
        'taxidermy', 'mounted', 'pinned', 'dried specimen', 'on road',
        'in road', 'on pavement', 'lying on', 'lying in',
    ],

    // Animal categories that this applies to
    animalCategories: new Set([
        'animal_bird', 'animal_mammal', 'animal_reptile', 'animal_amphibian',
        'animal_fish', 'animal_insect', 'animal_beetle', 'animal_spider',
        'animal_bee', 'animal_ant', 'animal_snail', 'animal_worm',
        'animal_marine',
    ]),

    /**
     * Check if a POI might contain a dead animal.
     * Returns { isDead: boolean, confidence: number (0-100), reasons: string[] }
     */
    analyze(poi) {
        // Only check animal observations from iNaturalist
        if (poi.source !== 'iNaturalist' || !this.animalCategories.has(poi.category)) {
            return { isDead: false, confidence: 0, reasons: [] };
        }

        let score = 0;
        const reasons = [];

        // Check description
        const description = (poi.description || '').toLowerCase();
        const title = (poi.title || '').toLowerCase();
        const placeGuess = (poi.placeGuess || '').toLowerCase();
        const allText = `${description} ${title} ${placeGuess}`;

        // Strong keywords (+30 each, cap at 70 from keywords alone)
        let keywordScore = 0;
        for (const kw of this.strongKeywords) {
            if (allText.includes(kw)) {
                keywordScore += 30;
                reasons.push(`Description/title contains "${kw}"`);
            }
        }

        // Moderate keywords (+15 each)
        for (const kw of this.moderateKeywords) {
            if (allText.includes(kw)) {
                keywordScore += 15;
                reasons.push(`Text mentions "${kw}"`);
            }
        }

        // Weak keywords (+8 each)
        for (const kw of this.weakKeywords) {
            if (allText.includes(kw)) {
                keywordScore += 8;
                reasons.push(`Text mentions "${kw}"`);
            }
        }

        score += Math.min(keywordScore, 85);

        // Check iNaturalist tags if available
        if (poi.tags && Array.isArray(poi.tags)) {
            for (const tag of poi.tags) {
                const tagText = (typeof tag === 'string' ? tag : tag.name || '').toLowerCase();
                if (this.strongKeywords.some(kw => tagText.includes(kw))) {
                    score += 25;
                    reasons.push(`Tagged as "${tagText}"`);
                }
            }
        }

        // Check if observation fields mention alive/dead
        if (poi.ofvs && Array.isArray(poi.ofvs)) {
            for (const ofv of poi.ofvs) {
                const name = (ofv.name || '').toLowerCase();
                const value = (ofv.value || '').toLowerCase();
                if (name.includes('alive') || name.includes('dead') || name.includes('condition')) {
                    if (value.includes('dead') || value === 'no' || value.includes('deceased')) {
                        score += 40;
                        reasons.push(`Observation field "${ofv.name}" = "${ofv.value}"`);
                    }
                }
            }
        }

        // Road-related location hints for animals (slight boost)
        if (placeGuess.match(/road|highway|hwy|route|motorway|interstate/)) {
            score += 5;
            reasons.push('Found near a road');
        }

        // Cap at 95% - never 100% certain from text analysis alone
        const confidence = Math.min(score, 95);

        return {
            isDead: confidence >= 15,
            confidence,
            reasons: [...new Set(reasons)], // deduplicate
        };
    },

    /**
     * Show the warning overlay. Returns a Promise that resolves to true (proceed) or false (cancel).
     */
    showWarning(poi, analysis) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('dead-warning-overlay');
            const textEl = document.getElementById('dead-warning-text');
            const fillEl = document.getElementById('confidence-fill');
            const confText = document.getElementById('confidence-text');

            // Build warning message
            const animalName = poi.commonName || poi.title || 'this animal';
            let message = `This observation of <strong>${animalName}</strong> may show a dead or deceased animal.`;

            if (analysis.reasons.length > 0) {
                message += `<br><br><strong>Why we think so:</strong><ul>`;
                for (const r of analysis.reasons.slice(0, 4)) {
                    message += `<li>${r}</li>`;
                }
                message += '</ul>';
            }

            textEl.innerHTML = message;

            // Confidence bar
            const conf = analysis.confidence;
            fillEl.style.width = `${conf}%`;
            fillEl.style.background = conf > 60 ? '#d32f2f' : conf > 35 ? '#ff9800' : '#ffc107';
            confText.textContent = `${conf}% confidence it may be dead`;

            overlay.classList.remove('hidden');

            // Button handlers
            const cancelBtn = document.getElementById('warning-cancel-btn');
            const proceedBtn = document.getElementById('warning-proceed-btn');

            function cleanup() {
                overlay.classList.add('hidden');
                cancelBtn.removeEventListener('click', onCancel);
                proceedBtn.removeEventListener('click', onProceed);
            }

            function onCancel() { cleanup(); resolve(false); }
            function onProceed() { cleanup(); resolve(true); }

            cancelBtn.addEventListener('click', onCancel);
            proceedBtn.addEventListener('click', onProceed);
        });
    },
};
