/**
 * Explorer Map — data sources.
 *
 * Everything on the map comes from free, open, key-less public services:
 *
 *   osm        OpenStreetMap (Overpass)   landforms, rocks, caves, quarries, parks, water, history
 *   inat       iNaturalist                plants, animals and fungi people have observed
 *   mrds       USGS Mineral Resources     mines, prospects and mineral / crystal / gem occurrences
 *   pbdb       Paleobiology Database      fossil localities
 *   wikidata   Wikidata                   named natural features, mines, formations, landmarks
 *   wikipedia  Wikipedia                  nearby articles
 *
 * Plus on-demand "ground scans" of any spot (bedrock from Macrostrat, soil from
 * ISRIC SoilGrids, elevation from Open-Meteo).
 *
 * Every source returns the same POI shape:
 *   { id, lat, lon, category, title, subtitle?, source, sourceId, sourceIcon, ...extras }
 */

// ---------------------------------------------------------------------------
// Small network helper: fetch with a timeout that also honours an abort signal
// ---------------------------------------------------------------------------
const Net = {
    async request(url, { signal, timeout = 25000, ...init } = {}) {
        const ctrl = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
        const onAbort = () => ctrl.abort();
        if (signal) {
            if (signal.aborted) ctrl.abort();
            else signal.addEventListener('abort', onAbort, { once: true });
        }
        try {
            const resp = await fetch(url, { ...init, signal: ctrl.signal });
            if (!resp.ok) {
                const err = new Error(`HTTP ${resp.status}`);
                err.status = resp.status;
                throw err;
            }
            return resp;
        } catch (e) {
            if (timedOut) {
                const err = new Error('Timed out');
                err.timeout = true;
                throw err;
            }
            throw e;
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        }
    },
    async json(url, opts) { return (await this.request(url, opts)).json(); },
    async text(url, opts) { return (await this.request(url, opts)).text(); },
};

const DataSources = {
    // ---------------------------------------------------------------------
    // Source registry
    // ---------------------------------------------------------------------
    SOURCES: {
        osm: {
            label: 'OpenStreetMap', icon: '🗺️', minZoom: 10, maxSpan: 0.9,
            what: 'Rocks, caves, peaks, quarries, parks, water, history',
        },
        inat: {
            label: 'iNaturalist', icon: '🔬', minZoom: 9, maxSpan: 3,
            what: 'Plants, animals and fungi people have spotted',
        },
        mrds: {
            label: 'USGS Mineral Sites', icon: '⛏️', minZoom: 8, maxSpan: 2.5,
            what: 'Mines, prospects, mineral, crystal and gem occurrences',
        },
        pbdb: {
            label: 'Paleobiology Database', icon: '🦴', minZoom: 7, maxSpan: 5,
            what: 'Fossil sites and what was found there',
        },
        wikidata: {
            label: 'Wikidata', icon: '🧭', minZoom: 10, maxSpan: 1.0,
            what: 'Named natural features, mines and landmarks',
        },
        wikipedia: {
            label: 'Wikipedia', icon: '📖', minZoom: 10, maxSpan: 1,
            what: 'Articles about places nearby',
        },
    },

    enabledSources: { osm: true, inat: true, mrds: true, pbdb: true, wikidata: true, wikipedia: true },

    loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('explorer_map_sources') || '{}');
            for (const id of Object.keys(this.SOURCES)) {
                if (typeof saved[id] === 'boolean') this.enabledSources[id] = saved[id];
            }
        } catch (e) { /* ignore */ }
    },

    saveSettings() {
        try { localStorage.setItem('explorer_map_sources', JSON.stringify(this.enabledSources)); } catch (e) { /* ignore */ }
    },

    /**
     * Fetch one source for a bounding box.
     * ctx: { zoom, signal, wantAmenities }
     */
    fetchSource(id, bounds, ctx = {}) {
        const b = this.clampBounds(bounds, this.SOURCES[id].maxSpan);
        switch (id) {
            case 'osm': return this.fetchOverpass(b, ctx);
            case 'inat': return this.fetchINaturalist(b, ctx);
            case 'mrds': return this.fetchMRDS(b, ctx);
            case 'pbdb': return this.fetchPBDB(b, ctx);
            case 'wikidata': return this.fetchWikidata(b, ctx);
            case 'wikipedia': return this.fetchWikipedia(b, ctx);
            default: return Promise.resolve([]);
        }
    },

    /** Shrink a box around its centre so a source is never asked for a huge area. */
    clampBounds(b, maxSpan) {
        if (!maxSpan) return b;
        const cLat = (b.north + b.south) / 2;
        const cLon = (b.east + b.west) / 2;
        const hLat = Math.min((b.north - b.south) / 2, maxSpan / 2);
        const hLon = Math.min((b.east - b.west) / 2, maxSpan / 2);
        return {
            north: Math.min(cLat + hLat, 90), south: Math.max(cLat - hLat, -90),
            east: cLon + hLon, west: cLon - hLon,
        };
    },

    // =====================================================================
    // OpenStreetMap (Overpass API)
    // =====================================================================
    OVERPASS_ENDPOINTS: [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ],
    _overpassPreferred: 0,

    /**
     * The old app sent one query with a single 500-item cap, and listed every
     * "natural" object first — so trees and benches used up the whole allowance
     * and rocks, caves, quarries and parks were silently cut off. Here each
     * theme gets its own block with its own cap, geology first.
     */
    buildOverpassQuery(b, zoom, wantAmenities) {
        const bb = `(${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)})`;
        const blocks = [];

        // --- Rocks, minerals & landforms (always) ---
        blocks.push([`
  nwr["natural"~"^(rock|stone|cave_entrance|arch|sinkhole|geyser|hot_spring|fumarole|volcano|peak|crater)$"]${bb};
  nwr["natural"~"^(cliff|bare_rock|scree|shingle|ridge|arete|valley|gorge|canyon|glacier|saddle|cape|peninsula)$"]["name"]${bb};
  nwr["geological"]${bb};
  nwr["landuse"="quarry"]${bb};
  nwr["man_made"~"^(adit|mineshaft|mine)$"]${bb};
  nwr["historic"~"^(mine|mine_shaft|adit|quarry)$"]${bb};
  nwr["shop"~"^(mineral|minerals|rock|rocks|gemstone|gems|crystal|crystals|fossil|fossils|lapidary)$"]${bb};`, 450]);

        // --- Areas & water (named areas, so a forest is one pin, not hundreds) ---
        blocks.push([`
  nwr["leisure"~"^(park|nature_reserve|garden)$"]["name"]${bb};
  nwr["boundary"~"^(protected_area|national_park)$"]["name"]${bb};
  wr["landuse"="forest"]["name"]${bb};
  wr["natural"="wood"]["name"]${bb};
  nwr["natural"~"^(beach|wetland|water|bay)$"]["name"]${bb};
  nwr["place"~"^(island|islet)$"]["name"]${bb};
  nwr["natural"="spring"]${bb};
  nwr["waterway"="waterfall"]${bb};`, 350]);

        // --- History, culture & recreation ---
        let culture = `
  nwr["historic"]["historic"!~"^(mine|mine_shaft|adit|quarry)$"]${bb};
  nwr["tourism"~"^(viewpoint|camp_site|caravan_site|picnic_site|artwork|museum|attraction)$"]${bb};
  nwr["man_made"="lighthouse"]${bb};
  nwr["man_made"~"^(tower|obelisk|observatory)$"]["name"]${bb};
  nwr["sport"="climbing"]${bb};
  nwr["highway"="trailhead"]${bb};`;
        if (zoom >= 13) {
            culture += `
  nwr["amenity"="place_of_worship"]${bb};
  nwr["leisure"~"^(playground|bird_hide)$"]${bb};`;
        }
        blocks.push([culture, 350]);

        // --- Individual trees (close up only) ---
        if (zoom >= 14) {
            blocks.push([`
  node["natural"="tree"]["species"]${bb};
  node["natural"="tree"]["genus"]${bb};
  node["natural"="tree"]["name"]${bb};`, 200]);
        }
        if (zoom >= 16) blocks.push([`\n  node["natural"="tree"]${bb};`, 250]);

        // --- Amenities (only when the user has switched them on) ---
        if (wantAmenities && zoom >= 14) {
            blocks.push([`
  nwr["amenity"~"^(drinking_water|toilets|parking)$"]${bb};
  node["amenity"~"^(bench|waste_basket)$"]${bb};
  node["tourism"="information"]["information"~"^(board|map|office|visitor_centre)$"]${bb};
  node["leisure"="picnic_table"]${bb};`, 350]);
        }

        return '[out:json][timeout:25];\n' +
            blocks.map(([body, cap]) => `(${body}\n);\nout center tags ${cap};`).join('\n');
    },

    async overpassRequest(query, signal) {
        let lastErr = null;
        const n = this.OVERPASS_ENDPOINTS.length;
        for (let i = 0; i < n; i++) {
            const idx = (this._overpassPreferred + i) % n;
            try {
                const data = await Net.json(this.OVERPASS_ENDPOINTS[idx], {
                    method: 'POST',
                    body: 'data=' + encodeURIComponent(query),
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    signal, timeout: 30000,
                });
                this._overpassPreferred = idx;
                return data;
            } catch (e) {
                if (signal && signal.aborted) throw e;
                lastErr = e;
            }
        }
        throw lastErr || new Error('OpenStreetMap is unreachable');
    },

    async fetchOverpass(b, ctx) {
        const query = this.buildOverpassQuery(b, ctx.zoom || 14, !!ctx.wantAmenities);
        const data = await this.overpassRequest(query, ctx.signal);
        const seen = new Set();
        const out = [];
        for (const el of data.elements || []) {
            const key = `${el.type}/${el.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const poi = this.parseOverpassElement(el);
            if (poi) out.push(poi);
        }
        return out;
    },

    humanize(value) {
        return String(value || '').replace(/[_;]+/g, ' ').trim().replace(/^\w/, c => c.toUpperCase());
    },

    /** Words in a place name that mean "rockhounds care about this". */
    GEM_NAME_RE: /\b(geodes?|agates?|jasper|opals?|amethyst|garnets?|topaz|turquoise|obsidian|thundereggs?|petrified wood|rockhound\w*|gem ?mines?|crystal mines?|sapphires?|rub(y|ies)|emeralds?|tourmaline|sunstones?|moonstones?|fire ?opal)\b/i,

    classifyOSM(t) {
        const H = v => this.humanize(v);
        const n = t.natural, g = t.geological, h = t.historic, tour = t.tourism;
        const l = t.leisure, a = t.amenity, mm = t.man_made;
        const res = t.resource ? H(t.resource.split(';')[0]) + ' ' : '';

        if (t.shop && /^(mineral|minerals|rock|rocks|gemstone|gems|crystal|crystals|fossil|fossils|lapidary)$/.test(t.shop)) {
            return ['geo_shop', 'Rock & Gem Shop'];
        }
        if (mm === 'adit' || h === 'adit') return ['geo_mine', `${res}Mine Adit`];
        if (mm === 'mineshaft' || h === 'mine_shaft') return ['geo_mine', `${res}Mine Shaft`];
        if (mm === 'mine' || h === 'mine') return ['geo_mine', `${res}Mine`];
        if (t.landuse === 'quarry' || h === 'quarry') return ['geo_quarry', `${res}Quarry`];

        if (g) {
            if (g === 'palaeontological_site') return ['geo_fossil', 'Fossil Site'];
            if (/volcan|lava|caldera/.test(g)) return ['geo_volcano', H(g)];
            if (/meteor|impact/.test(g)) return ['geo_crater', H(g)];
            if (g === 'outcrop') return ['geo_rock', 'Rock Outcrop'];
            return ['geo_rock', H(g)];
        }

        switch (n) {
            case 'rock': case 'stone': return ['geo_rock', 'Boulder'];
            case 'bare_rock': return ['geo_rock', 'Bare Rock'];
            case 'scree': case 'shingle': return ['geo_rock', H(n)];
            case 'crater': return ['geo_rock', 'Crater'];
            case 'cave_entrance': return ['geo_cave', 'Cave Entrance'];
            case 'sinkhole': return ['geo_cave', 'Sinkhole'];
            case 'arch': return ['geo_arch', 'Natural Arch'];
            case 'peak': return ['geo_peak', 'Peak'];
            case 'volcano': return ['geo_volcano', 'Volcano'];
            case 'cliff': case 'ridge': case 'arete': case 'saddle': case 'cape': case 'peninsula':
                return ['geo_cliff', H(n)];
            case 'valley': case 'gorge': case 'canyon': return ['geo_valley', H(n)];
            case 'glacier': return ['geo_glacier', 'Glacier'];
            case 'geyser': return ['geo_thermal', 'Geyser'];
            case 'hot_spring': return ['geo_thermal', 'Hot Spring'];
            case 'fumarole': return ['geo_thermal', 'Fumarole'];
            case 'spring': return ['water_spring', 'Spring'];
            case 'water':
                if (t.water === 'river' || t.water === 'stream' || t.water === 'canal') return ['water_river', H(t.water)];
                return ['water_lake', t.water ? H(t.water) : 'Lake / Pond'];
            case 'bay': return ['water_lake', 'Bay'];
            case 'wetland': return ['water_wetland', t.wetland ? H(t.wetland) : 'Wetland'];
            case 'beach': return ['rec_beach', 'Beach'];
            case 'wood': return ['area_forest', 'Woodland'];
            case 'tree': return ['plant_tree', t.species || t['species:en'] || t.genus || 'Tree'];
            default: break;
        }

        if (t.waterway === 'waterfall') return ['water_waterfall', 'Waterfall'];
        if (t.place === 'island' || t.place === 'islet') return ['geo_island', 'Island'];
        if (t.boundary === 'national_park') return ['area_protected', 'National Park'];
        if (t.boundary === 'protected_area' || l === 'nature_reserve') {
            return ['area_protected', t.protection_title || 'Protected Area'];
        }
        if (t.landuse === 'forest') return ['area_forest', 'Forest'];
        if (l === 'park') return ['rec_park', 'Park'];
        if (l === 'garden') return ['rec_park', 'Garden'];

        if (tour === 'viewpoint') return ['rec_viewpoint', 'Viewpoint'];
        if (tour === 'camp_site' || tour === 'caravan_site') return ['rec_campsite', 'Campsite'];
        if (tour === 'picnic_site' || l === 'picnic_table') return ['rec_picnic', 'Picnic Area'];
        if (tour === 'museum') return ['other_museum', 'Museum'];
        if (tour === 'artwork') return ['other_art', t.artwork_type ? H(t.artwork_type) : 'Public Art'];
        if (t.sport === 'climbing') return ['rec_climbing', 'Climbing Spot'];
        if (t.highway === 'trailhead') return ['rec_trail', 'Trailhead'];

        if (h) {
            if (h === 'archaeological_site') return ['other_archaeology', t.site_type ? H(t.site_type) : 'Archaeological Site'];
            if (h === 'rock_art' || h === 'petroglyph') return ['other_archaeology', 'Rock Art'];
            if (h === 'ruins') return ['building_ruin', 'Ruins'];
            if (/^(monument|memorial|wayside_cross|wayside_shrine|boundary_stone|milestone|stone)$/.test(h)) {
                return ['building_monument', h === 'memorial' && t.memorial ? `Memorial (${H(t.memorial)})` : H(h)];
            }
            return ['building_historic', h === 'yes' ? 'Historic Site' : `Historic ${H(h)}`];
        }

        if (l === 'playground') return ['rec_playground', 'Playground'];
        if (l === 'bird_hide') return ['rec_viewpoint', 'Bird Hide'];
        if (a === 'place_of_worship') return ['building_church', t.religion ? `${H(t.religion)} Place of Worship` : 'Place of Worship'];
        if (mm === 'lighthouse') return ['building_tower', 'Lighthouse'];
        if (mm === 'tower' || mm === 'obelisk' || mm === 'observatory') return ['building_tower', H(mm)];
        if (a === 'drinking_water') return ['infra_fountain', 'Drinking Water'];
        if (a === 'toilets') return ['infra_toilet', 'Restrooms'];
        if (a === 'parking') return ['infra_parking', 'Parking'];
        if (a === 'bench') return ['infra_bench', 'Bench'];
        if (a === 'waste_basket') return ['infra_bin', 'Waste Bin'];
        if (tour === 'information') return ['infra_info', t.information ? `Info ${H(t.information)}` : 'Information'];
        if (tour === 'attraction') return ['other_misc', 'Attraction'];
        return null;
    },

    parseOverpassElement(el) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) return null;
        const tags = el.tags || {};
        const cls = this.classifyOSM(tags);
        if (!cls) return null;
        let [category, fallback] = cls;
        const name = tags['name:en'] || tags.name || '';

        const grp = getCategory(category).group;
        if (name && (grp === 'geology' || grp === 'landforms' || grp === 'other') && this.GEM_NAME_RE.test(name)
            && category !== 'geo_shop') {
            category = 'geo_gem';
        }

        let subtitle = name ? fallback : '';
        if (tags.ele && !isNaN(parseFloat(tags.ele))) {
            subtitle = (subtitle ? subtitle + ' · ' : '') + `${Math.round(parseFloat(tags.ele))} m`;
        }

        return {
            id: `osm_${el.type}_${el.id}`,
            lat, lon, category,
            title: name || fallback || 'Unnamed feature',
            subtitle,
            named: !!name,
            source: 'OpenStreetMap', sourceId: 'osm', sourceIcon: '🗺️',
            tags,
            osmId: el.id, osmType: el.type,
            isArea: el.type !== 'node',
            qid: /^Q\d+$/.test(tags.wikidata || '') ? tags.wikidata : undefined,
        };
    },

    /** Outline of a way / relation, fetched only when the user opens it. */
    async fetchOSMGeometry(type, id, signal) {
        const data = await this.overpassRequest(`[out:json][timeout:20];${type}(${id});out geom;`, signal);
        const el = (data.elements || [])[0];
        if (!el) return null;
        const lines = [];
        const push = geom => {
            if (Array.isArray(geom) && geom.length > 1) lines.push(geom.map(p => [p.lon, p.lat]));
        };
        if (el.type === 'way') push(el.geometry);
        if (el.type === 'relation') {
            for (const m of el.members || []) if (m.type === 'way') push(m.geometry);
        }
        if (!lines.length) return null;
        return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
    },

    // =====================================================================
    // iNaturalist
    // =====================================================================
    async fetchINaturalist(b, ctx) {
        const params = new URLSearchParams({
            nelat: b.north, nelng: b.east, swlat: b.south, swlng: b.west,
            quality_grade: 'research,needs_id',
            per_page: '200',
            order_by: 'observed_on',
            photos: 'true',
            geoprivacy: 'open',
        });
        const data = await Net.json(`https://api.inaturalist.org/v1/observations?${params}`, { signal: ctx.signal });
        return (data.results || [])
            .filter(obs => obs.geojson && Array.isArray(obs.geojson.coordinates))
            .map(obs => this.parseINaturalistObs(obs));
    },

    /** Map an iNaturalist taxon to a category using its ancestry (taxon IDs). */
    classifyTaxon(taxon) {
        const anc = new Set(taxon.ancestor_ids || []);
        const has = id => anc.has(id);
        switch (taxon.iconic_taxon_name) {
            case 'Plantae':
                if (has(47903)) return 'plant_cactus';
                if (has(47434) || has(47161) || has(52642)) return 'plant_grass';       // grasses, sedges, rushes
                if (has(121943) || has(311249) || has(64615) || has(56327)) return 'plant_fern'; // ferns, mosses, liverworts
                if (has(136329)) return 'plant_tree';                                    // conifers
                if (has(47124) || has(47163) || has(47125)) return 'plant_flower';       // flowering plants
                return 'plant_other';
            case 'Fungi': return 'plant_mushroom';
            case 'Chromista': case 'Protozoa': return 'plant_other';
            case 'Aves': return 'animal_bird';
            case 'Mammalia': return 'animal_mammal';
            case 'Reptilia': return 'animal_reptile';
            case 'Amphibia': return 'animal_amphibian';
            case 'Actinopterygii': return 'animal_fish';
            case 'Insecta':
                if (has(47157)) return 'animal_insect';
                if (has(47208)) return 'animal_beetle';
                if (has(47201)) return 'animal_bee';
                return 'animal_bug';
            case 'Arachnida': return 'animal_spider';
            case 'Mollusca': return 'animal_snail';
            case 'Animalia':
                if (has(47491)) return 'animal_worm';
                if (has(47273) || has(85497)) return 'animal_fish';
                if (has(47187) || has(47549) || has(47534) || has(48824)) return 'animal_marine'; // crustaceans, echinoderms, cnidarians, sponges
                return 'animal_other';
            default: return 'other_misc';
        }
    },

    parseINaturalistObs(obs) {
        const [lon, lat] = obs.geojson.coordinates;
        const taxon = obs.taxon || {};
        const name = taxon.preferred_common_name || taxon.name || obs.species_guess || 'Unknown organism';

        const photos = (obs.photos || [])
            .map(p => (p.url || '').replace('/square.', '/medium.'))
            .filter(Boolean);

        // "Alive or Dead" (attribute 17: 18 alive, 19 dead) and "Evidence of Presence" (22: 27 bone)
        let annotatedDead = false, annotatedBone = false, annotatedAlive = false;
        for (const an of obs.annotations || []) {
            if (an.controlled_attribute_id === 17 && an.controlled_value_id === 19) annotatedDead = true;
            if (an.controlled_attribute_id === 17 && an.controlled_value_id === 18) annotatedAlive = true;
            if (an.controlled_attribute_id === 22 && an.controlled_value_id === 27) annotatedBone = true;
        }

        return {
            id: `inat_${obs.id}`,
            lat, lon,
            category: this.classifyTaxon(taxon),
            title: name.replace(/^\w/, c => c.toUpperCase()),
            subtitle: taxon.name && taxon.name !== name ? taxon.name : '',
            source: 'iNaturalist', sourceId: 'inat', sourceIcon: '🔬',
            scientificName: taxon.name,
            commonName: taxon.preferred_common_name,
            taxonRank: taxon.rank,
            iconicTaxon: taxon.iconic_taxon_name || '',
            observedOn: obs.observed_on,
            qualityGrade: obs.quality_grade,
            photos,
            thumb: photos[0] ? photos[0].replace('/medium.', '/small.') : undefined,
            observerLogin: obs.user ? obs.user.login : null,
            inatUrl: obs.uri,
            description: obs.description,
            placeGuess: obs.place_guess,
            numIdentifications: obs.identifications_count,
            taxonId: taxon.id,
            wikipediaUrl: taxon.wikipedia_url,
            conservationStatus: taxon.conservation_status,
            threatened: !!taxon.threatened,
            introduced: !!taxon.introduced,
            obscured: !!obs.obscured,
            obsTags: obs.tags || [],
            ofvs: (obs.ofvs || []).map(o => ({ name: o.name, value: o.value })),
            annotatedDead, annotatedBone, annotatedAlive,
        };
    },

    _taxonCache: new Map(),
    async fetchTaxonDetails(taxonId) {
        if (!taxonId) return null;
        if (this._taxonCache.has(taxonId)) return this._taxonCache.get(taxonId);
        const p = Net.json(`https://api.inaturalist.org/v1/taxa/${taxonId}`)
            .then(d => d.results?.[0] || null)
            .catch(() => null);
        this._taxonCache.set(taxonId, p);
        return p;
    },

    // =====================================================================
    // USGS Mineral Resources Data System — mines, prospects, mineral occurrences
    // =====================================================================
    MRDS_NS: 'http://mapserver.gis.umn.edu/mapserver',
    GML_NS: 'http://www.opengis.net/gml',

    /** Commodities a collector would call a crystal / gem / specimen locality. */
    MRDS_GEM_RE: /^(GEM|GEM_.*|QTZ|ABR_G|ABR_C|STA|KYN|TRA|GYP_A)$/,
    MRDS_SPECIMEN_RE: /^(F|BA|PYR|MIC|FLD|BE|LI|ZEO|WOL|GRF|TLC|S|SUL|REE.*|TH|NB|TA|CS|RB|ASB|GYP|B|SR|VRM)$/,
    MRDS_AGGREGATE_RE: /^(SDG.*|SD|STN.*|CLY.*|CEM|LST.*|DOL|GRT|MBL|SLA|LWA|PUM|PER|VOL|DIT|SIL.*|ABR|ABR_E|MPG|ASH)$/,
    MRDS_FUEL_RE: /^(OIL.*|GAS|COA.*|PEA|CO2|HE|H2O|N|CL|BR|I)$/,

    classifyMRDS(codes, devStat, name) {
        if (codes.includes('GEO')) return 'geo_thermal';
        if (codes.some(c => this.MRDS_GEM_RE.test(c)) || this.GEM_NAME_RE.test(name || '')) return 'geo_gem';
        const worked = /producer|prospect|plant/i.test(devStat || '');
        if (codes.length && codes.every(c => this.MRDS_AGGREGATE_RE.test(c))) return 'geo_quarry';
        if (!worked) return 'geo_mineral';           // "Occurrence" / unknown: a mineral showing
        if (codes.length && codes.every(c => this.MRDS_SPECIMEN_RE.test(c))) return 'geo_mineral';
        return 'geo_mine';
    },

    async fetchMRDS(b, ctx) {
        const params = new URLSearchParams({
            service: 'WFS', version: '1.1.0', request: 'GetFeature',
            typeName: 'mrds-high',
            bbox: `${b.west},${b.south},${b.east},${b.north}`,
            maxFeatures: '500',
        });
        const xml = await Net.text(`https://mrdata.usgs.gov/services/mrds?${params}`, { signal: ctx.signal, timeout: 30000 });
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('Bad response from USGS');

        const out = [];
        const feats = doc.getElementsByTagNameNS(this.MRDS_NS, 'mrds-high');
        const field = (el, name) => {
            const f = el.getElementsByTagNameNS(this.MRDS_NS, name)[0];
            return f ? f.textContent.trim() : '';
        };
        for (const el of feats) {
            const pos = el.getElementsByTagNameNS(this.GML_NS, 'pos')[0];
            if (!pos) continue;
            const [lat, lon] = pos.textContent.trim().split(/\s+/).map(Number);
            if (!isFinite(lat) || !isFinite(lon)) continue;
            const depId = field(el, 'dep_id');
            if (!depId) continue;
            const codes = field(el, 'code_list').split(/\s+/).filter(Boolean);
            const commodities = [...new Set(codes.map(c => MRDS_COMMODITIES[c] || c))];
            const devStat = field(el, 'dev_stat');
            const name = field(el, 'site_name');
            const unnamed = !name || /^unnamed|^unknown/i.test(name);
            out.push({
                id: `mrds_${depId}`,
                lat, lon,
                category: this.classifyMRDS(codes, devStat, name),
                title: unnamed ? `${commodities[0] || 'Mineral'} ${devStat === 'Occurrence' ? 'occurrence' : 'site'}` : name,
                subtitle: [commodities.slice(0, 4).join(', '), devStat].filter(Boolean).join(' · '),
                named: !unnamed,
                source: 'USGS Mineral Resources', sourceId: 'mrds', sourceIcon: '⛏️',
                depId, commodities, commodityCodes: codes, devStat,
                usgsUrl: field(el, 'url') || `https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${depId}`,
            });
        }
        return out;
    },

    _mrdsCache: new Map(),
    /** Full record for one site: ore minerals, host rock, workings, comments … */
    async fetchMRDSDetail(depId) {
        if (this._mrdsCache.has(depId)) return this._mrdsCache.get(depId);
        const p = Net.json(`https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${encodeURIComponent(depId)}&f=json`)
            .then(d => d.properties || null)
            .catch(() => null);
        this._mrdsCache.set(depId, p);
        return p;
    },

    // =====================================================================
    // Paleobiology Database — fossil localities
    // =====================================================================
    async fetchPBDB(b, ctx) {
        const params = new URLSearchParams({
            lngmin: b.west, lngmax: b.east, latmin: b.south, latmax: b.north,
            show: 'coords,class,strat,loc',
            limit: '2000',
        });
        const data = await Net.json(`https://paleobiodb.org/data1.2/occs/list.json?${params}`, { signal: ctx.signal, timeout: 30000 });
        const sites = new Map();
        const clean = v => (v && !/^NO_|_SPECIFIED$/.test(v) ? v : '');
        for (const r of data.records || []) {
            const lat = parseFloat(r.lat), lon = parseFloat(r.lng);
            if (!isFinite(lat) || !isFinite(lon) || !r.cid) continue;
            let site = sites.get(r.cid);
            if (!site) {
                const colNo = String(r.cid).replace('col:', '');
                site = {
                    id: `pbdb_${colNo}`, lat, lon,
                    category: 'geo_fossil',
                    source: 'Paleobiology Database', sourceId: 'pbdb', sourceIcon: '🦴',
                    collectionNo: colNo,
                    taxa: [],
                    interval: r.oei || '',
                    intervalLate: r.oli || '',
                    ageMaxMa: r.eag, ageMinMa: r.lag,
                    formation: r.sfm || '', member: r.smb || '', group: r.sgr || '',
                    country: r.cc2 || '', state: r.stp || '', county: r.cny || '',
                    siteNotes: r.ggc || '',
                    named: true,
                };
                sites.set(r.cid, site);
            }
            const tname = r.tna || r.idn;
            if (tname && !site.taxa.some(t => t.name === tname)) {
                site.taxa.push({
                    name: tname,
                    identified: r.idn || tname,
                    phylum: clean(r.phl), cls: clean(r.cll), order: clean(r.odl), family: clean(r.fml),
                });
            }
        }
        const out = [];
        for (const site of sites.values()) {
            const first = site.taxa.slice(0, 2).map(t => t.name).join(', ');
            const more = site.taxa.length > 2 ? ` +${site.taxa.length - 2} more` : '';
            site.title = first ? `${first}${more}` : 'Fossil site';
            const age = site.intervalLate && site.intervalLate !== site.interval
                ? `${site.interval} – ${site.intervalLate}` : site.interval;
            site.subtitle = ['Fossils', age, site.formation ? `${site.formation} Fm.` : ''].filter(Boolean).join(' · ');
            site.ageLabel = age;
            out.push(site);
        }
        return out.slice(0, 600);
    },

    // =====================================================================
    // Wikidata — named natural features, mines, formations, landmarks
    // =====================================================================

    /**
     * Ordered [pattern, category] rules, matched against a Wikidata "instance of"
     * label or a Wikipedia short description. First match wins, so specific
     * phrases ("national park") come before general ones ("park").
     */
    TEXT_RULES: [
        [/\b(archaeological\w*|petroglyphs?|pictographs?|rock art|prehistoric|megalith|dolmen|hillfort|tumulus|cliff dwelling)\b/i, 'other_archaeology'],
        [/\b(impact (crater|structure)|meteor(ite)? crater)\b/i, 'geo_crater'],
        [/\b(fossil|paleontolog\w*|palaeontolog\w*|dinosaur\w*|lagerst[aä]tte|trackway)\b/i, 'geo_fossil'],
        [/\b(gem\w*|geode|agate|opal|crystal)\b/i, 'geo_gem'],
        [/\b(minerals?|ore deposit|pegmatite|meteorite|type locality)\b/i, 'geo_mineral'],
        [/\b(mine|mines|mining|colliery|goldfield|mineshaft|mining district)\b/i, 'geo_mine'],
        [/\b(quarry|quarries|gravel pit)\b/i, 'geo_quarry'],
        [/\b(hot springs?|geysers?|fumaroles?|thermal springs?|geothermal)\b/i, 'geo_thermal'],
        [/\b(volcan\w*|caldera|lava\w*|cinder cone|maar|stratovolcano|crater)\b/i, 'geo_volcano'],
        [/\b(caves?|caverns?|grotto|sinkhole|karst|lava tube|rock shelter)\b/i, 'geo_cave'],
        [/\b(natural arch|natural bridge|sea arch|rock arch)\b/i, 'geo_arch'],
        [/\b(glacier|ice ?field|ice cap)\b/i, 'geo_glacier'],
        [/\b(rock formation|geological formation|geologic formation|formation|outcrop|monolith|pillar|hoodoo|butte|mesa|boulder|balancing rock|inselberg|tor|sea stack|stack|fault|batholith|dike|dyke|escarpment|rock|geological feature|geologic feature|geosite|moraine|esker|drumlin|erratic)\b/i, 'geo_rock'],
        [/\b(national park|state park|protected area|nature reserve|wilderness( area)?|national monument|wildlife refuge|conservation area|national forest|site of special scientific interest|biosphere reserve|natural area|sanctuary|nature park|national natural landmark|state forest|regional park)\b/i, 'area_protected'],
        [/\b(waterfalls?|cascade)\b/i, 'water_waterfall'],
        [/\b(mountain range|mountain|summit|peak|hill|massif)\b/i, 'geo_peak'],
        [/\b(cliff|mountain ridge|ridge|mountain pass|bluff|headland|cape|promontory)\b/i, 'geo_cliff'],
        [/\b(slot canyon|canyon|valley|gorge|ravine|gulch|arroyo|basin|plain|flat|desert|dunes?|plateau|bench|river bend)\b/i, 'geo_valley'],
        [/\b(island|islet|archipelago)\b/i, 'geo_island'],
        [/\b(spring)\b/i, 'water_spring'],
        [/\b(lake|reservoir|pond|lagoon|tarn|bay|dam)\b/i, 'water_lake'],
        [/\b(river|stream|creek|brook|rapids|tributary|canal|watercourse)\b/i, 'water_river'],
        [/\b(wetland|marsh|swamp|bog|fen|mire)\b/i, 'water_wetland'],
        [/\b(forest|woodland|grove)\b/i, 'area_forest'],
        [/\b(beach)\b/i, 'rec_beach'],
        [/\b(park|garden|arboretum|botanical)\b/i, 'rec_park'],
        [/\b(museum|visitor cent(er|re))\b/i, 'other_museum'],
        [/\b(ruins?|ghost town|abandoned|former place|destroyed building)\b/i, 'building_ruin'],
        [/\b(church|chapel|cathedral|temple|mosque|synagogue|monastery|abbey|shrine)\b/i, 'building_church'],
        [/\b(monument|memorial|statue|sculpture|obelisk)\b/i, 'building_monument'],
        [/\b(lighthouse|tower|observatory)\b/i, 'building_tower'],
        [/\b(bridge|viaduct|aqueduct)\b/i, 'building_bridge'],
        [/\b(castle|fort|fortress|historic\w*|heritage|palace|manor|national register|listed building|landmark)\b/i, 'building_historic'],
        [/\b(scenic viewpoint|viewpoint|overlook|lookout)\b/i, 'rec_viewpoint'],
        [/\b(climbing (route|area|crag)|crag)\b/i, 'rec_climbing'],
        [/\b(hiking trail|trail|footpath|long-distance path)\b/i, 'rec_trail'],
        [/\b(camp(ground|site)|camping)\b/i, 'rec_campsite'],
    ],

    /** Descriptions of towns, companies etc. that merely mention a feature word ("mining town"). */
    NOT_A_FEATURE_RE: /\b(city|town|village|hamlet|community|census-designated|municipality|neighbou?rhood|suburb|county|township|school|university|college|company|corporation|station|airport|hospital|hotel|stadium|highway|road|street|(amusement|theme|business|industrial|trailer|water|skate|car) park)\b/i,

    classifyText(text) {
        if (!text) return null;
        for (const [re, cat] of this.TEXT_RULES) if (re.test(text)) return cat;
        return null;
    },

    async fetchWikidata(b, ctx) {
        const query = `
SELECT ?item (SAMPLE(?lbl) AS ?label) (SAMPLE(?desc) AS ?description) (SAMPLE(?coord) AS ?c)
       (GROUP_CONCAT(DISTINCT ?tl; separator="|") AS ?types)
       (SAMPLE(?image) AS ?img) (SAMPLE(?mindat) AS ?mindatId) (SAMPLE(?article) AS ?wp)
WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord.
    bd:serviceParam wikibase:cornerWest "Point(${b.west.toFixed(5)} ${b.south.toFixed(5)})"^^geo:wktLiteral.
    bd:serviceParam wikibase:cornerEast "Point(${b.east.toFixed(5)} ${b.north.toFixed(5)})"^^geo:wktLiteral.
  }
  ?item wdt:P31 ?type.
  ?type rdfs:label ?tl. FILTER(LANG(?tl) = "en")
  OPTIONAL { ?item rdfs:label ?lbl. FILTER(LANG(?lbl) = "en") }
  OPTIONAL { ?item schema:description ?desc. FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P6265 ?mindat }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }
}
GROUP BY ?item
LIMIT 800`;
        const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
        const data = await Net.json(url, { signal: ctx.signal, timeout: 30000, headers: { Accept: 'application/sparql-results+json' } });

        const out = [];
        for (const row of data.results?.bindings || []) {
            const label = row.label?.value;
            const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(row.c?.value || '');
            if (!label || !m) continue;
            const types = (row.types?.value || '').split('|').filter(Boolean);
            const mindatId = row.mindatId?.value;

            let category = null;
            for (const t of types) { category = this.classifyText(t); if (category) break; }
            if (!category && mindatId) category = 'geo_mineral';
            if (!category) continue;        // radio stations, schools, roads … not what this map is for
            if (this.GEM_NAME_RE.test(label) && ['geology', 'landforms'].includes(getCategory(category).group)) {
                category = 'geo_gem';
            }

            const qid = row.item.value.split('/').pop();
            const wp = row.wp?.value;
            const img = row.img?.value ? row.img.value.replace(/^http:/, 'https:') : undefined;
            out.push({
                id: `wd_${qid}`,
                lat: parseFloat(m[2]), lon: parseFloat(m[1]),
                category,
                title: label.replace(/^\w/, c => c.toUpperCase()),
                subtitle: this.humanize(types[0] || ''),
                named: true,
                source: 'Wikidata', sourceId: 'wikidata', sourceIcon: '🧭',
                qid, wdTypes: types,
                description: row.description?.value,
                photos: img ? [img + '?width=700'] : [],
                thumb: img ? img + '?width=160' : undefined,
                mindatId,
                wikiTitle: wp ? decodeURIComponent(wp.split('/wiki/')[1] || '').replace(/_/g, ' ') : undefined,
                wikipediaUrl: wp,
            });
        }
        return out;
    },

    // =====================================================================
    // Wikipedia
    // =====================================================================
    async fetchWikipedia(b, ctx) {
        const lat = (b.north + b.south) / 2, lon = (b.east + b.west) / 2;
        // Radius that covers the visible box, capped at the API maximum of 10 km
        const kmLat = (b.north - b.south) * 111 / 2;
        const kmLon = (b.east - b.west) * 111 * Math.cos(lat * Math.PI / 180) / 2;
        const radius = Math.max(500, Math.min(10000, Math.round(Math.hypot(kmLat, kmLon) * 1000)));
        const params = new URLSearchParams({
            action: 'query', generator: 'geosearch',
            ggscoord: `${lat}|${lon}`, ggsradius: String(radius), ggslimit: '50',
            prop: 'coordinates|pageimages|description',
            piprop: 'thumbnail', pithumbsize: '500', pilimit: '50', colimit: '50',
            format: 'json', origin: '*',
        });
        const data = await Net.json(`https://en.wikipedia.org/w/api.php?${params}`, { signal: ctx.signal });
        const out = [];
        for (const page of Object.values(data.query?.pages || {})) {
            const co = page.coordinates?.[0];
            if (!co) continue;
            const desc = page.description || '';
            let category;
            if (/\bghost town\b/i.test(desc)) category = 'building_ruin';
            else if (this.NOT_A_FEATURE_RE.test(desc)) category = 'other_wiki';
            else category = this.classifyText(desc) || 'other_wiki';
            if (category !== 'other_wiki' && this.GEM_NAME_RE.test(page.title)) category = 'geo_gem';
            out.push({
                id: `wiki_${page.pageid}`,
                lat: co.lat, lon: co.lon,
                category,
                title: page.title,
                subtitle: desc,
                named: true,
                source: 'Wikipedia', sourceId: 'wikipedia', sourceIcon: '📖',
                wikiPageId: page.pageid,
                wikiTitle: page.title,
                description: desc,
                photos: page.thumbnail ? [page.thumbnail.source] : [],
                thumb: page.thumbnail?.source,
                wikipediaUrl: `https://en.wikipedia.org/?curid=${page.pageid}`,
            });
        }
        return out;
    },

    _wikiCache: new Map(),
    /**
     * Plain-text Wikipedia article for a title, or for the best search hit.
     * Returns { title, extract, thumbnail, url } or null.
     */
    async fetchWikiArticle({ title, pageId, search, chars = 6000 } = {}) {
        const key = `${title || ''}|${pageId || ''}|${search || ''}|${chars}`;
        if (this._wikiCache.has(key)) return this._wikiCache.get(key);
        const run = async () => {
            if (!title && !pageId && search) {
                const sp = new URLSearchParams({ action: 'query', list: 'search', srsearch: search, srlimit: '1', format: 'json', origin: '*' });
                const sd = await Net.json(`https://en.wikipedia.org/w/api.php?${sp}`);
                pageId = sd.query?.search?.[0]?.pageid;
                if (!pageId) return null;
            }
            const params = new URLSearchParams({
                action: 'query', prop: 'extracts|pageimages|info',
                explaintext: '1', exchars: String(chars), exsectionformat: 'plain',
                piprop: 'thumbnail', pithumbsize: '600', inprop: 'url', redirects: '1',
                format: 'json', origin: '*',
            });
            if (pageId) params.set('pageids', pageId); else params.set('titles', title);
            const d = await Net.json(`https://en.wikipedia.org/w/api.php?${params}`);
            const page = Object.values(d.query?.pages || {})[0];
            if (!page || page.missing !== undefined || !page.extract) return null;
            return { title: page.title, extract: page.extract, thumbnail: page.thumbnail?.source, url: page.fullurl, pageId: page.pageid };
        };
        const p = run().catch(() => null);
        this._wikiCache.set(key, p);
        return p;
    },

    // =====================================================================
    // Ground scan — what is under any spot (works anywhere on Earth)
    // =====================================================================
    _lithDefs: null,
    async lithologyDefs() {
        if (!this._lithDefs) {
            this._lithDefs = Net.json('https://macrostrat.org/api/v2/defs/lithologies?all')
                .then(d => {
                    const map = new Map();
                    for (const l of d.success?.data || []) map.set(l.lith_id, l);
                    return map;
                })
                .catch(() => new Map());
        }
        return this._lithDefs;
    },

    /** Bedrock / surface geology at a point, most detailed map first. */
    async fetchBedrock(lat, lon, signal) {
        const [data, defs] = await Promise.all([
            Net.json(`https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lon}`, { signal }),
            this.lithologyDefs(),
        ]);
        const order = { large: 0, medium: 1, small: 2, tiny: 3 };
        const units = (data.success?.data || [])
            .slice()
            .sort((a, b) => (order[a.scale] ?? 9) - (order[b.scale] ?? 9))
            .map(u => {
                const liths = (u.liths || []).map(id => defs.get(id)).filter(Boolean);
                const lithText = (u.lith || '').replace(/[{}]/g, '').trim();
                return {
                    name: u.name || u.strat_name || 'Unnamed unit',
                    stratName: u.strat_name || '',
                    rocks: liths.length ? liths.map(l => l.name) : (lithText ? [lithText] : []),
                    rockClasses: [...new Set(liths.map(l => l.class).filter(Boolean))],
                    lithText,
                    description: u.descrip || '',
                    comments: u.comments || '',
                    age: u.t_int_name === u.b_int_name ? u.b_int_name : `${u.b_int_name} – ${u.t_int_name}`,
                    era: u.best_int_name || '',
                    topAge: u.t_age, bottomAge: u.b_age,
                    color: u.color || '#999',
                    scale: u.scale,
                };
            });
        return units;
    },

    async fetchSoil(lat, lon, signal) {
        const d = await Net.json(
            `https://rest.isric.org/soilgrids/v2.0/classification/query?lon=${lon}&lat=${lat}&number_classes=3`,
            { signal, timeout: 30000 });
        if (!d.wrb_class_name) return null;
        return { name: d.wrb_class_name, probabilities: d.wrb_class_probability || [] };
    },

    async fetchElevation(lat, lon, signal) {
        const d = await Net.json(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { signal, timeout: 12000 });
        const e = d.elevation?.[0];
        return typeof e === 'number' ? e : null;
    },

    /** Build a "ground scan" POI for any coordinate. Soil + elevation load lazily in the detail view. */
    async scanPoint(lat, lon, signal) {
        const units = await this.fetchBedrock(lat, lon, signal);
        const top = units[0];
        const rocks = top ? top.rocks.slice(0, 3).join(', ') : '';
        return {
            id: `scan_${lat.toFixed(4)}_${lon.toFixed(4)}`,
            lat, lon,
            category: 'geo_bedrock',
            title: top ? top.name : 'Ground scan',
            subtitle: top ? [rocks, top.age].filter(Boolean).join(' · ') : 'No geologic map data for this spot',
            named: true,
            source: 'Macrostrat', sourceId: 'scan', sourceIcon: '🔬',
            units,
            isScan: true,
        };
    },

    // =====================================================================
    // Place search (Nominatim)
    // =====================================================================
    async searchPlaces(query, signal) {
        const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', addressdetails: '0' });
        const data = await Net.json(`https://nominatim.openstreetmap.org/search?${params}`, { signal, timeout: 12000 });
        return (data || []).map(r => ({
            name: r.display_name,
            lat: parseFloat(r.lat), lon: parseFloat(r.lon),
            bbox: r.boundingbox ? r.boundingbox.map(Number) : null,   // [south, north, west, east]
            type: r.type,
        }));
    },
};
