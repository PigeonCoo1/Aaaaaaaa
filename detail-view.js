/**
 * Generates rich detail views for POIs with ALL available information.
 */

const DetailView = {
    async render(poi) {
        const cat = CATEGORIES[poi.category] || CATEGORIES.other_misc;
        let html = '';

        // Header
        html += `<h2>${cat.icon} ${this.esc(poi.title)}</h2>`;
        html += `<div class="detail-subtitle">${this.esc(cat.label)} &middot; ${poi.sourceIcon} ${this.esc(poi.source)}</div>`;

        // Badges
        html += '<div>';
        html += `<span class="detail-badge" style="background:${cat.color}22;color:${cat.color}">${cat.label}</span>`;
        html += `<span class="detail-badge" style="background:#e3f2fd;color:#1565c0">${poi.source}</span>`;
        if (poi.qualityGrade) {
            const qColor = poi.qualityGrade === 'research' ? '#4caf50' : '#ff9800';
            html += `<span class="detail-badge" style="background:${qColor}22;color:${qColor}">${poi.qualityGrade} grade</span>`;
        }
        html += '</div>';

        // Photos
        if (poi.photos && poi.photos.length > 0) {
            html += '<div class="detail-section">';
            for (const photo of poi.photos.slice(0, 4)) {
                html += `<img class="detail-image" src="${this.esc(photo)}" alt="Photo" loading="lazy" onerror="this.style.display='none'" />`;
            }
            html += '</div>';
        }

        // Source-specific detailed info
        if (poi.source === 'iNaturalist') {
            html += this.renderINaturalist(poi);
            // Fetch extra taxon details
            if (poi.taxonId) {
                try {
                    const taxon = await DataSources.fetchTaxonDetails(poi.taxonId);
                    if (taxon) html += this.renderTaxonDetails(taxon);
                } catch (e) { console.warn('Taxon fetch error:', e); }
            }
        } else if (poi.source === 'OpenStreetMap') {
            html += this.renderOSM(poi);
        } else if (poi.source === 'Wikipedia') {
            html += await this.renderWikipedia(poi);
        }

        // Coordinates & distance
        html += '<div class="detail-section">';
        html += '<h3>Location</h3>';
        html += `<div class="detail-coords">📍 ${poi.lat.toFixed(6)}, ${poi.lon.toFixed(6)}</div>`;
        if (window.userLat !== undefined) {
            const dist = this.haversine(window.userLat, window.userLon, poi.lat, poi.lon);
            html += `<p style="margin-top:4px">📏 ${dist < 1 ? (dist * 1000).toFixed(0) + ' m' : dist.toFixed(2) + ' km'} from you</p>`;
        }
        html += `<a class="detail-directions-btn" href="https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lon}" target="_blank" rel="noopener">🧭 Get Directions</a>`;
        html += '</div>';

        // External links
        html += '<div class="detail-section detail-links">';
        html += '<h3>More Information</h3>';
        if (poi.inatUrl) html += `<a href="${this.esc(poi.inatUrl)}" target="_blank">🔬 View on iNaturalist</a>`;
        if (poi.wikipediaUrl) html += `<a href="${this.esc(poi.wikipediaUrl)}" target="_blank">📖 Wikipedia</a>`;
        if (poi.wikiPageId) html += `<a href="https://en.wikipedia.org/?curid=${poi.wikiPageId}" target="_blank">📖 Read on Wikipedia</a>`;
        if (poi.osmId) html += `<a href="https://www.openstreetmap.org/${poi.osmType || 'node'}/${poi.osmId}" target="_blank">🗺️ View on OpenStreetMap</a>`;
        html += `<a href="https://www.google.com/maps/@${poi.lat},${poi.lon},18z" target="_blank">🌍 Google Maps</a>`;
        html += `<a href="https://www.google.com/search?q=${encodeURIComponent(poi.title + ' ' + (poi.scientificName || ''))}" target="_blank">🔎 Google Search</a>`;
        html += '</div>';

        return html;
    },

    renderINaturalist(poi) {
        let html = '<div class="detail-section">';
        html += '<h3>Observation Details</h3>';
        html += '<div class="detail-grid">';

        if (poi.scientificName) html += this.gridItem('Scientific Name', poi.scientificName);
        if (poi.commonName) html += this.gridItem('Common Name', poi.commonName);
        if (poi.taxonRank) html += this.gridItem('Taxon Rank', poi.taxonRank);
        if (poi.iconicTaxon) html += this.gridItem('Kingdom', poi.iconicTaxon);
        if (poi.observedOn) html += this.gridItem('Observed', poi.observedOn);
        if (poi.observerLogin) html += this.gridItem('Observer', poi.observerLogin);
        if (poi.qualityGrade) html += this.gridItem('Quality', poi.qualityGrade);
        if (poi.numIdentifications) html += this.gridItem('IDs', poi.numIdentifications);
        if (poi.numComments) html += this.gridItem('Comments', poi.numComments);
        if (poi.placeGuess) html += this.gridItem('Location', poi.placeGuess);

        html += '</div>';

        if (poi.description) {
            html += `<p style="margin-top:10px">${this.esc(poi.description)}</p>`;
        }

        if (poi.conservationStatus) {
            const cs = poi.conservationStatus;
            html += `<div style="margin-top:10px;padding:8px;background:#fff3e0;border-radius:8px">`;
            html += `<strong>Conservation Status:</strong> ${this.esc(cs.status_name || cs.status || 'Unknown')}`;
            if (cs.iucn) html += ` (IUCN: ${cs.iucn})`;
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    renderTaxonDetails(taxon) {
        let html = '<div class="detail-section">';
        html += '<h3>Species Information</h3>';

        if (taxon.wikipedia_summary) {
            html += `<p>${taxon.wikipedia_summary}</p>`;
        }

        html += '<div class="detail-grid">';
        if (taxon.observations_count) html += this.gridItem('Total Observations', taxon.observations_count.toLocaleString());
        if (taxon.rank) html += this.gridItem('Rank', taxon.rank);
        if (taxon.is_active !== undefined) html += this.gridItem('Active Taxon', taxon.is_active ? 'Yes' : 'No');
        if (taxon.extinct !== undefined && taxon.extinct) html += this.gridItem('Extinct', '⚠️ Yes');
        if (taxon.native) html += this.gridItem('Native', 'Yes');
        if (taxon.introduced) html += this.gridItem('Introduced', '⚠️ Yes');
        if (taxon.threatened) html += this.gridItem('Threatened', '⚠️ Yes');
        html += '</div>';

        // Taxonomy tree
        if (taxon.ancestors && taxon.ancestors.length > 0) {
            html += '<div style="margin-top:12px"><strong>Taxonomy:</strong></div>';
            html += '<ul>';
            for (const a of taxon.ancestors) {
                if (a.rank && a.name) {
                    html += `<li><em>${this.esc(a.rank)}</em>: ${this.esc(a.preferred_common_name || '')} (${this.esc(a.name)})</li>`;
                }
            }
            html += `<li><strong>${this.esc(taxon.rank || '')}: ${this.esc(taxon.preferred_common_name || '')} (${this.esc(taxon.name)})</strong></li>`;
            html += '</ul>';
        }

        // Conservation statuses
        if (taxon.conservation_statuses && taxon.conservation_statuses.length > 0) {
            html += '<div style="margin-top:12px"><strong>Conservation Statuses:</strong></div>';
            html += '<ul>';
            for (const cs of taxon.conservation_statuses) {
                html += `<li>${this.esc(cs.authority || '')}: ${this.esc(cs.status_name || cs.status)} ${cs.iucn ? `(IUCN ${cs.iucn})` : ''} ${cs.place ? `- ${this.esc(cs.place.display_name)}` : ''}</li>`;
            }
            html += '</ul>';
        }

        // Photos
        if (taxon.taxon_photos && taxon.taxon_photos.length > 0) {
            html += '<div style="margin-top:12px"><strong>Reference Photos:</strong></div>';
            for (const tp of taxon.taxon_photos.slice(0, 3)) {
                const url = tp.photo?.medium_url || tp.photo?.url || '';
                if (url) html += `<img class="detail-image" src="${this.esc(url.replace('square', 'medium'))}" alt="Reference" loading="lazy" onerror="this.style.display='none'" />`;
            }
        }

        html += '</div>';
        return html;
    },

    renderOSM(poi) {
        const tags = poi.tags || {};
        let html = '<div class="detail-section">';
        html += '<h3>Feature Details</h3>';
        html += '<div class="detail-grid">';

        // Show ALL OSM tags in a readable format
        const friendlyLabels = {
            name: 'Name', 'name:en': 'English Name', description: 'Description',
            species: 'Species', genus: 'Genus', leaf_type: 'Leaf Type',
            leaf_cycle: 'Leaf Cycle', height: 'Height', circumference: 'Circumference',
            ele: 'Elevation', natural: 'Type', historic: 'Historic Type',
            tourism: 'Tourism', leisure: 'Leisure', amenity: 'Amenity',
            surface: 'Surface', material: 'Material', colour: 'Color',
            opening_hours: 'Hours', phone: 'Phone', website: 'Website',
            wikipedia: 'Wikipedia', wikidata: 'Wikidata', image: 'Image',
            artist_name: 'Artist', architect: 'Architect', year: 'Year',
            start_date: 'Start Date', inscription: 'Inscription',
            access: 'Access', fee: 'Fee', wheelchair: 'Wheelchair',
            dog: 'Dogs', lit: 'Lit at night', shelter: 'Shelter',
            bench: 'Has Bench', backrest: 'Backrest', seats: 'Seats',
            direction: 'Direction', capacity: 'Capacity',
            operator: 'Operator', heritage: 'Heritage', protection_title: 'Protection',
        };

        for (const [key, val] of Object.entries(tags)) {
            if (key.startsWith('addr:') || key === 'source') continue;
            const label = friendlyLabels[key] || key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
            html += this.gridItem(label, val);
        }

        html += '</div>';

        // Show image if available
        if (tags.image) {
            html += `<img class="detail-image" src="${this.esc(tags.image)}" alt="Photo" loading="lazy" onerror="this.style.display='none'" />`;
        }

        // Wikipedia link from tag
        if (tags.wikipedia) {
            const [lang, article] = tags.wikipedia.split(':');
            html += `<div class="detail-links"><a href="https://${lang || 'en'}.wikipedia.org/wiki/${encodeURIComponent(article || tags.wikipedia)}" target="_blank">📖 Wikipedia Article</a></div>`;
        }

        html += '</div>';
        return html;
    },

    async renderWikipedia(poi) {
        let html = '';

        try {
            const article = await DataSources.fetchWikiArticle(poi.wikiPageId);
            if (article) {
                if (article.thumbnail) {
                    html += `<img class="detail-image" src="${this.esc(article.thumbnail.source)}" alt="${this.esc(poi.title)}" loading="lazy" />`;
                }
                html += '<div class="detail-section">';
                html += '<h3>About</h3>';
                if (article.extract) {
                    html += `<p>${this.esc(article.extract)}</p>`;
                }
                if (article.fullurl) {
                    html += `<div class="detail-links" style="margin-top:8px"><a href="${this.esc(article.fullurl)}" target="_blank">📖 Read full article on Wikipedia</a></div>`;
                }
                html += '</div>';
            }
        } catch (e) {
            console.warn('Wiki detail error:', e);
        }

        return html;
    },

    // Helpers
    gridItem(label, value) {
        return `<div class="detail-grid-item"><div class="label">${this.esc(String(label))}</div><div class="value">${this.esc(String(value))}</div></div>`;
    },

    esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    haversine(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
};
