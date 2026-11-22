/**
 * Explorer Map — main application.
 *
 * Ties together the map (map-view.js), the data sources (data-sources.js),
 * the detail panel (detail-view.js) and the AI chat (ai-chat.js).
 */

const $ = id => document.getElementById(id);

window.userLat = undefined;
window.userLon = undefined;

// ---------------------------------------------------------------------------
// Saved discoveries (kept in this browser)
// ---------------------------------------------------------------------------
const Favorites = {
    KEY: 'explorer_map_saved_v1',
    items: new Map(),

    load() {
        try {
            for (const p of JSON.parse(localStorage.getItem(this.KEY) || '[]')) {
                if (p && p.id && typeof p.lat === 'number') this.items.set(p.id, p);
            }
        } catch (e) { /* ignore */ }
    },
    save() {
        const plain = [...this.items.values()].map(p => JSON.parse(JSON.stringify(p, (k, v) => (k.startsWith('_') ? undefined : v))));
        try { localStorage.setItem(this.KEY, JSON.stringify(plain)); } catch (e) { /* storage full or blocked */ }
    },
    has(id) { return this.items.has(id); },
    toggle(poi) {
        if (this.items.has(poi.id)) this.items.delete(poi.id);
        else this.items.set(poi.id, poi);
        this.save();
        return this.items.has(poi.id);
    },
    list() { return [...this.items.values()]; },
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const App = {
    pois: new Map(),
    byQid: new Map(),
    byWiki: new Map(),
    active: new Set(),
    selected: null,
    sources: {},
    listMode: 'nearby',
    resultIds: [],
    resultTitle: 'Results',
    _renderQueued: false,
    _followedOnce: false,
    MAX_POIS: 7000,

    // ======================================================================
    // Start-up
    // ======================================================================
    init() {
        Settings.load();
        DataSources.loadSettings();
        Favorites.load();
        this.applyTheme();

        const saved = Settings.get('activeCategories');
        const keys = Array.isArray(saved) ? saved.filter(k => CATEGORIES[k]) : defaultActiveCategories();
        this.active = new Set(keys);

        for (const id of Object.keys(DataSources.SOURCES)) {
            this.sources[id] = { status: 'idle', covered: [], ctrl: null, pending: null, error: null, failAt: 0, lastCount: 0 };
        }

        if (typeof maplibregl === 'undefined') {
            $('poi-count').textContent = 'The map library could not load — check your connection and reload.';
            return;
        }

        this.startedWithLink = /^#\d/.test(location.hash);
        MapView.init('map', {
            basemap: Settings.get('basemap'),
            geology: Settings.get('geology'),
            geologyOpacity: Settings.get('geologyOpacity'),
            terrain: Settings.get('terrain'),
            touchRotate: Settings.get('touchRotate'),
            units: Settings.get('units'),
        }, {
            onReady: () => { this.renderMap(); this.refresh(); },
            onMoveEnd: () => this.onMoveEnd(),
            onSelect: (ids, lngLat) => this.onMapSelect(ids, lngLat),
            onBackgroundClick: () => this.onBackgroundClick(),
            onLongPress: (lat, lon) => this.scan(lat, lon),
            onRotate: (bearing, pitch) => this.syncViewSliders(bearing, pitch),
        });

        AIChat.setup();
        this.setupTopbar();
        this.setupSheets();
        this.setupLayersPanel();
        this.setupSettings();
        this.setupDetailActions();
        this.buildChips();
        this.updateStatus();
        this.startGeolocation();
        this.refreshModelListsQuietly();

        window.addEventListener('resize', Util.debounce(() => { MapView.resize(); this.updateInsets(); }, 150));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeTopmost(); });
        // Hide photos that fail to load instead of showing a broken image
        document.addEventListener('error', e => {
            if (e.target && e.target.tagName === 'IMG') (e.target.closest('a') || e.target).remove();
        }, true);

        if (!Settings.get('seenTips')) {
            setTimeout(() => Toast.show('Tip: press and hold anywhere on the map (or tap 🔬) to scan the rock and soil under that spot.', { duration: 9000 }), 3500);
            Settings.set('seenTips', true);
        }
    },

    applyTheme() {
        const pref = Settings.get('theme');
        const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    },

    // ======================================================================
    // Geolocation
    // ======================================================================
    startGeolocation() {
        if (!navigator.geolocation) {
            Toast.show('This browser cannot share your location — search for a place or pan the map.');
            return;
        }
        const onFix = pos => {
            const { latitude: lat, longitude: lon, accuracy } = pos.coords;
            const first = window.userLat === undefined;
            window.userLat = lat;
            window.userLon = lon;
            MapView.setUserLocation(lat, lon, accuracy);
            $('btn-locate').classList.add('has-fix');
            if (first && !this.startedWithLink && !this._followedOnce) {
                this._followedOnce = true;
                MapView.map.jumpTo({ center: [lon, lat], zoom: 14 });
            }
            if (first && !$('list-panel').classList.contains('hidden')) this.renderList();
        };
        const onError = err => {
            if (window.userLat !== undefined) return;
            const msg = err && err.code === 1
                ? 'Location is switched off for this site — search for a place or pan the map to explore.'
                : 'Could not get your location — search for a place or pan the map to explore.';
            if (!this._locationWarned) { this._locationWarned = true; Toast.show(msg, { duration: 6000 }); }
        };
        navigator.geolocation.getCurrentPosition(onFix, onError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
        this._watchId = navigator.geolocation.watchPosition(onFix, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    },

    goToMyLocation() {
        if (window.userLat !== undefined) {
            MapView.flyTo(window.userLat, window.userLon, Math.max(MapView.getZoom(), 15));
        } else {
            this._locationWarned = false;
            Toast.show('Finding your location…');
            this._followedOnce = false;
            this.startedWithLink = false;
            if (this._watchId !== undefined) navigator.geolocation.clearWatch(this._watchId);
            this.startGeolocation();
        }
    },

    // ======================================================================
    // Loading data for the current view
    // ======================================================================
    onMoveEnd() {
        clearTimeout(this._moveTimer);
        this._moveTimer = setTimeout(() => this.refresh(), 550);
        this.updateStatus();
        if (!$('list-panel').classList.contains('hidden') && this.listMode === 'nearby') {
            clearTimeout(this._listTimer);
            this._listTimer = setTimeout(() => this.renderList(), 300);
        }
    },

    wantAmenities() {
        for (const k of this.active) if (CATEGORIES[k].group === 'amenities') return true;
        return false;
    },

    refresh(force = false) {
        if (!MapView._ready) return;
        const zoom = MapView.getZoom();
        const view = MapView.getBounds();
        const amen = this.wantAmenities() && zoom >= 14;
        const contains = (outer, inner) => outer.north >= inner.north && outer.south <= inner.south &&
            outer.east >= inner.east && outer.west <= inner.west;
        const covers = (c, need, base, amenNeeded) => c.base >= base && (!amenNeeded || c.amen) && contains(c.b, need);

        for (const [id, def] of Object.entries(DataSources.SOURCES)) {
            const st = this.sources[id];
            const cancel = () => { if (st.ctrl) { st.ctrl.abort(); st.ctrl = null; st.pending = null; } };

            if (!DataSources.enabledSources[id]) { cancel(); st.status = 'off'; continue; }
            if (zoom < def.minZoom) { cancel(); st.status = 'zoom'; continue; }

            const need = DataSources.clampBounds(view, def.maxSpan);
            // OpenStreetMap asks for more detail as you zoom in, so coverage is per detail level
            const base = id === 'osm' ? (zoom >= 16 ? 4 : zoom >= 14 ? 3 : zoom >= 13 ? 2 : 1) : 0;
            const amenNeeded = id === 'osm' && amen;

            if (!force && st.covered.some(c => covers(c, need, base, amenNeeded))) {
                if (!st.ctrl) st.status = 'ok';
                continue;
            }
            if (!force && st.ctrl && st.pending && covers(st.pending, need, base, amenNeeded)) continue;   // already on its way
            if (!force && st.status === 'error' && Date.now() - st.failAt < 8000) continue;               // don't hammer a failing service

            cancel();
            const padLat = (view.north - view.south) * 0.3, padLon = (view.east - view.west) * 0.3;
            const q = DataSources.clampBounds({
                north: view.north + padLat, south: view.south - padLat,
                east: view.east + padLon, west: view.west - padLon,
            }, def.maxSpan);

            const ctrl = new AbortController();
            st.ctrl = ctrl;
            st.pending = { b: q, base, amen: amenNeeded };
            st.status = 'loading';

            DataSources.fetchSource(id, q, { zoom, signal: ctrl.signal, wantAmenities: amenNeeded })
                .then(list => {
                    if (st.ctrl !== ctrl) return;
                    st.ctrl = null;
                    st.covered.push(st.pending);
                    if (st.covered.length > 40) st.covered.shift();
                    st.pending = null;
                    st.status = 'ok';
                    st.error = null;
                    st.lastCount = list.length;
                    if (this.addPOIs(list)) this.scheduleRender();
                })
                .catch(err => {
                    if (ctrl.signal.aborted) return;
                    if (st.ctrl === ctrl) { st.ctrl = null; st.pending = null; }
                    st.status = 'error';
                    st.failAt = Date.now();
                    st.error = err && err.timeout ? 'took too long to answer'
                        : err && err.status === 429 ? 'is busy (rate limit)'
                        : err && err.status ? `returned an error (${err.status})`
                        : 'could not be reached';
                    console.warn(`${def.label}:`, err);
                })
                .finally(() => this.updateStatus());
        }
        this.updateStatus();
    },

    /** Add POIs, folding together the same place reported by different sources. Returns how many were new. */
    addPOIs(list) {
        let added = 0;
        for (const p of list) {
            if (!p || !isFinite(p.lat) || !isFinite(p.lon) || this.pois.has(p.id)) continue;
            const twin = (p.qid && this.byQid.get(p.qid)) || (p.wikiTitle && this.byWiki.get(p.wikiTitle.toLowerCase()));
            if (twin && twin.id !== p.id) { this.mergeInto(twin, p); continue; }
            this.pois.set(p.id, p);
            if (p.qid) this.byQid.set(p.qid, p);
            if (p.wikiTitle) this.byWiki.set(p.wikiTitle.toLowerCase(), p);
            added++;
        }
        if (this.pois.size > this.MAX_POIS) this.evict();
        return added;
    },

    mergeInto(keep, extra) {
        for (const k of ['qid', 'wikiTitle', 'wikiPageId', 'wikipediaUrl', 'description', 'mindatId', 'wdTypes', 'thumb']) {
            if (keep[k] === undefined && extra[k] !== undefined) keep[k] = extra[k];
        }
        if ((!keep.photos || !keep.photos.length) && extra.photos && extra.photos.length) keep.photos = extra.photos;
        if (!keep.tags && extra.tags) Object.assign(keep, { tags: extra.tags, osmId: extra.osmId, osmType: extra.osmType, isArea: extra.isArea });
        const vague = c => c === 'other_wiki' || c === 'other_misc';
        if (vague(keep.category) && !vague(extra.category)) { keep.category = extra.category; keep.subtitle = keep.subtitle || extra.subtitle; }
        if (keep.qid) this.byQid.set(keep.qid, keep);
        if (keep.wikiTitle) this.byWiki.set(keep.wikiTitle.toLowerCase(), keep);
    },

    /** Too much in memory: drop the discoveries farthest from where the map is looking. */
    evict() {
        const c = MapView.getCenter();
        const all = [...this.pois.values()];
        all.sort((a, b) => Util.haversine(c.lat, c.lon, a.lat, a.lon) - Util.haversine(c.lat, c.lon, b.lat, b.lon));
        for (const p of all.slice(Math.floor(this.MAX_POIS * 0.75))) {
            if (this.selected && this.selected.id === p.id) continue;
            this.pois.delete(p.id);
            if (p.qid && this.byQid.get(p.qid) === p) this.byQid.delete(p.qid);
            if (p.wikiTitle && this.byWiki.get(p.wikiTitle.toLowerCase()) === p) this.byWiki.delete(p.wikiTitle.toLowerCase());
        }
        // Coverage records no longer hold, so let areas reload when revisited
        for (const st of Object.values(this.sources)) st.covered = [];
    },

    visiblePOIs() {
        const out = [];
        for (const p of this.pois.values()) if (this.active.has(p.category)) out.push(p);
        return out;
    },

    scheduleRender() {
        if (this._renderQueued) return;
        this._renderQueued = true;
        requestAnimationFrame(() => { this._renderQueued = false; this.renderMap(); });
    },

    renderMap() {
        MapView.setData(this.visiblePOIs());
        this.updateStatus();
        this.updateChipCounts();
        if (!$('list-panel').classList.contains('hidden') && this.listMode === 'nearby') this.renderList();
        if (!$('filter-panel').classList.contains('hidden')) this.buildFilterPanel();
    },

    // ======================================================================
    // Status bar
    // ======================================================================
    updateStatus() {
        const states = Object.entries(this.sources);
        const loading = states.some(([, s]) => s.status === 'loading');
        $('progress').hidden = !loading;

        let label;
        if (!MapView._ready) label = 'Loading map…';
        else {
            const b = MapView.getBounds();
            let inView = 0;
            for (const p of this.pois.values()) {
                if (this.active.has(p.category) && p.lat <= b.north && p.lat >= b.south && p.lon <= b.east && p.lon >= b.west) inView++;
            }
            const zoom = MapView.getZoom();
            const minZoom = Math.min(...Object.entries(DataSources.SOURCES).filter(([id]) => DataSources.enabledSources[id]).map(([, d]) => d.minZoom), 99);
            if (zoom < minZoom && !inView) label = 'Zoom in to discover what is here';
            else if (!inView && loading) label = 'Finding discoveries…';
            else if (!inView && !this.active.size) label = 'Everything is hidden — check Filters';
            else label = `${inView.toLocaleString()} ${inView === 1 ? 'discovery' : 'discoveries'} in view`;
        }
        $('poi-count').textContent = label;

        $('btn-sources').innerHTML = states.filter(([id]) => DataSources.enabledSources[id]).map(([id, s]) => {
            const def = DataSources.SOURCES[id];
            const text = s.status === 'loading' ? 'loading…' : s.status === 'error' ? s.error : s.status === 'zoom' ? 'zoom in to load' : 'up to date';
            return `<i class="dot dot-${s.status}" title="${Util.esc(def.label)}: ${Util.esc(text)}"></i>`;
        }).join('');

        if (!$('filter-panel').classList.contains('hidden')) this.buildSourceList();
    },

    // ======================================================================
    // Selecting things
    // ======================================================================
    lookup(id) { return this.pois.get(id) || Favorites.items.get(id) || (this.selected && this.selected.id === id ? this.selected : null); },

    onMapSelect(ids, lngLat) {
        const pois = ids.map(id => this.lookup(id)).filter(Boolean);
        if (!pois.length) return;
        this.hidePopovers();
        if (pois.length === 1) { this.select(pois[0]); return; }
        this.showResults(pois.map(p => p.id), `${pois.length} things here`);
    },

    onBackgroundClick() {
        if (this.hidePopovers()) return;
        if (!$('detail-panel').classList.contains('hidden')) this.closeDetail();
    },

    async select(poi, { fromList = false, fly = true } = {}) {
        const analysis = DeadAnimalDetector.analyze(poi);
        if (analysis.isDead && !poi._warned) {
            const ok = await DeadAnimalDetector.showWarning(poi, analysis);
            if (!ok) return;
            poi._warned = true;
        }
        this.selected = poi;
        const content = $('detail-content');
        content.dataset.poi = poi.id;
        try {
            content.innerHTML = DetailView.render(poi);
        } catch (e) {
            console.error(e);
            content.innerHTML = `<header class="d-head"><div class="d-titles"><h2 id="detail-title">${Util.esc(poi.title)}</h2><p class="d-sub">Something went wrong showing the details.</p></div></header>`;
        }
        $('detail-back').classList.toggle('hidden', !fromList);
        $('detail-bar-title').textContent = getCategory(poi.category).label;
        this.openSheet('detail-panel');
        $('detail-scroll').scrollTop = 0;

        DetailView.hydrate(poi, content);
        AIChat.init(poi);
        MapView.setSelected(poi);
        if (fly) MapView.focus(poi.lat, poi.lon, 13);
        this.loadOutline(poi);
    },

    /** Draw the boundary of a park, quarry, lake … when one is opened. */
    async loadOutline(poi) {
        MapView.setOutline(null);
        if (!poi.isArea || !poi.osmId || !poi.osmType || poi.osmType === 'node') return;
        try {
            if (poi._outline === undefined) poi._outline = await DataSources.fetchOSMGeometry(poi.osmType, poi.osmId);
            if (this.selected === poi && poi._outline) MapView.setOutline(poi._outline);
        } catch (e) { /* outline is a nicety */ }
    },

    closeDetail() {
        AIChat.stop();
        this.selected = null;
        MapView.setSelected(null);
        $('detail-panel').classList.add('hidden');
        this.updateInsets();
    },

    setupDetailActions() {
        $('detail-content').addEventListener('click', async e => {
            const btn = e.target.closest('[data-action]');
            const poi = this.selected;
            if (!btn || !poi) return;
            switch (btn.dataset.action) {
                case 'save': {
                    const on = Favorites.toggle(poi);
                    btn.textContent = on ? '★ Saved' : '☆ Save';
                    btn.setAttribute('aria-pressed', String(on));
                    Toast.show(on ? 'Saved — find it under ☰ List → Saved.' : 'Removed from saved.');
                    break;
                }
                case 'share': this.share(poi); break;
                case 'scan': this.scan(poi.lat, poi.lon); break;
                case 'copy-coords':
                    this.copy(`${poi.lat.toFixed(6)}, ${poi.lon.toFixed(6)}`, 'Coordinates copied.');
                    break;
                default: break;
            }
        });
    },

    async share(poi) {
        const url = `${location.origin}${location.pathname}#16/${poi.lat.toFixed(5)}/${poi.lon.toFixed(5)}`;
        const text = `${poi.title} — ${getCategory(poi.category).label}`;
        if (navigator.share) {
            try { await navigator.share({ title: poi.title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
        }
        this.copy(`${text}\n${url}`, 'Link copied.');
    },

    async copy(text, message) {
        try {
            await navigator.clipboard.writeText(text);
            Toast.show(message);
        } catch (e) {
            Toast.show(text, { duration: 7000 });
        }
    },

    // ======================================================================
    // Ground scan
    // ======================================================================
    async scan(lat, lon) {
        this.hidePopovers();
        const toast = Toast.show('🔬 Scanning the ground here…', { duration: 15000 });
        try {
            const poi = await DataSources.scanPoint(lat, lon);
            if (toast) toast.remove();
            this.pois.set(poi.id, poi);
            if (!this.active.has('geo_bedrock')) { this.active.add('geo_bedrock'); this.saveFilters(); this.buildChips(); }
            this.renderMap();
            this.select(poi);
        } catch (e) {
            if (toast) toast.remove();
            console.warn('Scan failed:', e);
            Toast.show('The ground scan could not be completed — the geology service did not answer. Try again in a moment.', { type: 'error', duration: 6000 });
        }
    },

    // ======================================================================
    // Sheets (detail / list / filters)
    // ======================================================================
    SHEETS: ['detail-panel', 'list-panel', 'filter-panel'],

    isDesktop() { return window.matchMedia('(min-width: 860px)').matches; },

    openSheet(id) {
        for (const s of this.SHEETS) $(s).classList.toggle('hidden', s !== id);
        if (id !== 'detail-panel' && this.selected) { AIChat.stop(); }
        this.updateInsets();
    },

    closeSheets() {
        for (const s of this.SHEETS) $(s).classList.add('hidden');
        if (this.selected) { AIChat.stop(); this.selected = null; MapView.setSelected(null); }
        this.updateInsets();
    },

    updateInsets() {
        const open = this.SHEETS.map($).find(el => !el.classList.contains('hidden'));
        if (!open) MapView.panelInsets = { left: 0, bottom: 0 };
        else if (this.isDesktop()) MapView.panelInsets = { left: open.offsetWidth + 12, bottom: 0 };
        else MapView.panelInsets = { left: 0, bottom: Math.min(open.offsetHeight, window.innerHeight * 0.6) };
        document.body.classList.toggle('sheet-open', !!open);
    },

    setupSheets() {
        $('detail-close').addEventListener('click', () => this.closeDetail());
        $('detail-back').addEventListener('click', () => {
            AIChat.stop();
            this.selected = null;
            MapView.setSelected(null);
            this.openSheet('list-panel');
            this.renderList();
        });
        $('list-close').addEventListener('click', () => this.closeSheets());
        $('filter-close').addEventListener('click', () => this.closeSheets());

        $('btn-list').addEventListener('click', () => {
            if (!$('list-panel').classList.contains('hidden')) { this.closeSheets(); return; }
            this.listMode = 'nearby';
            this.openSheet('list-panel');
            this.renderList();
        });
        $('btn-sources').addEventListener('click', () => this.openFilters(true));

        $('list-tabs').addEventListener('click', e => {
            const tab = e.target.closest('[data-mode]');
            if (!tab) return;
            this.listMode = tab.dataset.mode;
            this.renderList();
        });
        $('list-filter').addEventListener('input', Util.debounce(() => this.renderList(), 150));
        $('list-body').addEventListener('click', e => {
            const row = e.target.closest('[data-id]');
            if (!row) return;
            const poi = this.lookup(row.dataset.id);
            if (poi) this.select(poi, { fromList: true });
        });

        // Filters
        $('select-all-btn').addEventListener('click', () => this.setFilters(Object.keys(CATEGORIES)));
        $('deselect-all-btn').addEventListener('click', () => this.setFilters([]));
        $('rocks-only-btn').addEventListener('click', () =>
            this.setFilters(Object.keys(CATEGORIES).filter(k => ['geology', 'landforms'].includes(CATEGORIES[k].group))));
        $('reload-btn').addEventListener('click', () => {
            for (const st of Object.values(this.sources)) { st.covered = []; st.failAt = 0; }
            this.refresh(true);
            Toast.show('Reloading this area…');
        });
        $('filter-list').addEventListener('change', e => {
            const cb = e.target;
            if (cb.dataset.cat) {
                if (cb.checked) this.active.add(cb.dataset.cat); else this.active.delete(cb.dataset.cat);
            } else if (cb.dataset.group) {
                for (const [k, c] of Object.entries(CATEGORIES)) {
                    if (c.group !== cb.dataset.group) continue;
                    if (cb.checked) this.active.add(k); else this.active.delete(k);
                }
            } else return;
            this.filtersChanged();
        });
        $('source-list').addEventListener('change', e => {
            const id = e.target.dataset.source;
            if (!id) return;
            DataSources.enabledSources[id] = e.target.checked;
            DataSources.saveSettings();
            if (!e.target.checked) this.removeSource(id);
            this.refresh();
            this.renderMap();
        });

        // Drag the handle to resize a sheet on phones
        for (const handle of document.querySelectorAll('[data-handle]')) this.makeDraggable(handle);
    },

    makeDraggable(handle) {
        const sheet = handle.parentElement;
        let startY = 0, startH = 0, dragging = false;
        handle.addEventListener('pointerdown', e => {
            if (this.isDesktop()) return;
            dragging = true;
            startY = e.clientY;
            startH = sheet.offsetHeight;
            sheet.classList.add('is-dragging');
            handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener('pointermove', e => {
            if (!dragging) return;
            const h = Math.max(70, Math.min(window.innerHeight * 0.93, startH + (startY - e.clientY)));
            sheet.style.height = `${h}px`;
        });
        const end = e => {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('is-dragging');
            const vh = window.innerHeight, h = sheet.offsetHeight;
            if (Math.abs(e.clientY - startY) < 6) {                    // a tap on the handle toggles tall / short
                sheet.style.height = `${h > vh * 0.7 ? vh * 0.45 : vh * 0.92}px`;
            } else if (h < vh * 0.18) {
                sheet.style.height = '';
                if (sheet.id === 'detail-panel') this.closeDetail(); else this.closeSheets();
                return;
            } else {
                const stops = [0.32, 0.58, 0.92].map(f => f * vh);
                const snap = stops.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a));
                sheet.style.height = `${snap}px`;
            }
            setTimeout(() => this.updateInsets(), 260);
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    },

    removeSource(id) {
        for (const [key, p] of this.pois) {
            if (p.sourceId !== id) continue;
            this.pois.delete(key);
            if (p.qid && this.byQid.get(p.qid) === p) this.byQid.delete(p.qid);
            if (p.wikiTitle && this.byWiki.get(p.wikiTitle.toLowerCase()) === p) this.byWiki.delete(p.wikiTitle.toLowerCase());
        }
        this.sources[id].covered = [];
    },

    // ======================================================================
    // List sheet
    // ======================================================================
    showResults(ids, title) {
        this.resultIds = ids;
        this.resultTitle = title;
        this.listMode = 'results';
        $('list-filter').value = '';
        this.openSheet('list-panel');
        this.renderList();
    },

    renderList() {
        const tabResults = $('list-tab-results');
        tabResults.classList.toggle('hidden', !this.resultIds.length);
        tabResults.textContent = this.resultTitle;
        for (const tab of $('list-tabs').querySelectorAll('.tab')) tab.classList.toggle('is-active', tab.dataset.mode === this.listMode);

        const origin = window.userLat !== undefined ? { lat: window.userLat, lon: window.userLon } : MapView.getCenter();
        const fromMe = window.userLat !== undefined;
        let items, empty;
        if (this.listMode === 'saved') {
            items = Favorites.list();
            empty = 'Nothing saved yet. Open a discovery and tap ☆ Save to keep it here.';
        } else if (this.listMode === 'results') {
            items = this.resultIds.map(id => this.lookup(id)).filter(Boolean);
            empty = 'Nothing to show.';
        } else {
            const b = MapView.getBounds();
            items = this.visiblePOIs().filter(p => p.lat <= b.north && p.lat >= b.south && p.lon <= b.east && p.lon >= b.west);
            empty = MapView.getZoom() < 9 ? 'Zoom in on the map to load discoveries.' : 'Nothing found in this part of the map yet. Try panning, zooming out a little, or switching on more filters.';
        }

        const q = $('list-filter').value.trim().toLowerCase();
        if (q) items = items.filter(p => this.matches(p, q));

        const withDist = items.map(p => ({ p, d: Util.haversine(origin.lat, origin.lon, p.lat, p.lon) }));
        // Named things first within the same distance band keeps the list readable
        withDist.sort((a, b) => a.d - b.d);
        const total = withDist.length;
        const shown = withDist.slice(0, 200);

        const body = $('list-body');
        if (!shown.length) { body.innerHTML = `<p class="empty">${Util.esc(q ? 'No matches in this list.' : empty)}</p>`; return; }
        body.innerHTML =
            `<p class="hint list-count">${total.toLocaleString()} ${total === 1 ? 'item' : 'items'}${total > shown.length ? ` — showing the nearest ${shown.length}` : ''}, sorted by distance from ${fromMe ? 'you' : 'the map centre'}</p>` +
            shown.map(({ p, d }) => this.listRow(p, d)).join('');
    },

    listRow(p, km) {
        const cat = getCategory(p.category);
        const E = Util.esc;
        return `<button type="button" class="row" data-id="${E(p.id)}">` +
            `<span class="row-icon" style="background:${cat.color}">${cat.icon}</span>` +
            `<span class="row-text"><b>${E(p.title)}</b><small>${E(p.subtitle || cat.label)}</small></span>` +
            `<span class="row-dist">${E(Util.distanceText(km))}</span></button>`;
    },

    matches(p, q) {
        if (p.title && p.title.toLowerCase().includes(q)) return true;
        if (p.subtitle && p.subtitle.toLowerCase().includes(q)) return true;
        if (p.scientificName && p.scientificName.toLowerCase().includes(q)) return true;
        const cat = getCategory(p.category);
        if (cat.label.toLowerCase().includes(q) || GROUPS[cat.group].label.toLowerCase().includes(q)) return true;
        if (p.commodities && p.commodities.some(c => c.toLowerCase().includes(q))) return true;
        if (p.taxa && p.taxa.some(t => t.name.toLowerCase().includes(q))) return true;
        return false;
    },

    // ======================================================================
    // Filters
    // ======================================================================
    saveFilters() { Settings.set('activeCategories', [...this.active]); },

    setFilters(keys) {
        this.active = new Set(keys);
        this.filtersChanged();
    },

    filtersChanged() {
        this.saveFilters();
        this.buildChips();
        this.renderMap();
        this.refresh();          // amenities are only downloaded once they are switched on
    },

    counts() {
        const counts = {};
        for (const p of this.pois.values()) counts[p.category] = (counts[p.category] || 0) + 1;
        return counts;
    },

    buildChips() {
        const groups = getCategoryGroups();
        let html = `<button type="button" class="chip-btn chip-filter" data-open-filters>⚙ Filters</button>`;
        for (const [g, def] of Object.entries(GROUPS)) {
            const cats = groups[g];
            const on = cats.filter(c => this.active.has(c.key)).length;
            const state = on === 0 ? 'off' : on === cats.length ? 'on' : 'some';
            html += `<button type="button" class="chip-btn" data-group="${g}" data-state="${state}" aria-pressed="${on > 0}" style="--c:${def.color}">` +
                `<span aria-hidden="true">${def.icon}</span> ${Util.esc(def.short)}<i class="chip-count" data-count="${g}"></i></button>`;
        }
        const host = $('chips');
        host.innerHTML = html;
        if (!host._wired) {
            host._wired = true;
            host.addEventListener('click', e => {
                if (e.target.closest('[data-open-filters]')) { this.openFilters(); return; }
                const chip = e.target.closest('[data-group]');
                if (!chip) return;
                const g = chip.dataset.group;
                const turnOn = chip.dataset.state === 'off';
                for (const [k, c] of Object.entries(CATEGORIES)) {
                    if (c.group !== g) continue;
                    if (turnOn) this.active.add(k); else this.active.delete(k);
                }
                this.filtersChanged();
                if (turnOn && g === 'amenities' && MapView.getZoom() < 14) Toast.show('Zoom in closer to see benches, restrooms and other amenities.');
            });
        }
        this.updateChipCounts();
    },

    updateChipCounts() {
        const counts = this.counts();
        const perGroup = {};
        for (const [k, n] of Object.entries(counts)) {
            const g = getCategory(k).group;
            perGroup[g] = (perGroup[g] || 0) + n;
        }
        for (const el of document.querySelectorAll('[data-count]')) {
            const n = perGroup[el.dataset.count] || 0;
            el.textContent = n ? (n > 999 ? '999+' : String(n)) : '';
        }
    },

    openFilters(scrollToSources = false) {
        this.buildFilterPanel();
        this.openSheet('filter-panel');
        if (scrollToSources) $('source-list').scrollIntoView({ block: 'center' });
    },

    buildFilterPanel() {
        const groups = getCategoryGroups();
        const counts = this.counts();
        const E = Util.esc;
        let html = '';
        for (const [g, def] of Object.entries(GROUPS)) {
            const cats = groups[g];
            const on = cats.filter(c => this.active.has(c.key)).length;
            const total = cats.reduce((n, c) => n + (counts[c.key] || 0), 0);
            html += `<details class="fgroup"${on > 0 && on < cats.length || g === 'geology' ? ' open' : ''}>` +
                `<summary><label class="fcheck" title="Show or hide all ${E(def.label)}"><input type="checkbox" data-group="${g}" ${on === cats.length ? 'checked' : ''} ${on > 0 && on < cats.length ? 'data-some' : ''}></label>` +
                `<span class="fgroup-name">${def.icon} ${E(def.label)}</span><span class="count">${total || ''}</span></summary>`;
            for (const c of cats) {
                html += `<label class="fitem"><input type="checkbox" data-cat="${c.key}" ${this.active.has(c.key) ? 'checked' : ''}>` +
                    `<span class="fdot" style="background:${c.color}">${c.icon}</span><span class="fname">${E(c.label)}</span>` +
                    `<span class="count">${counts[c.key] || ''}</span></label>`;
            }
            html += `</details>`;
        }
        // Keep whichever groups the person had open
        const openGroups = new Set([...document.querySelectorAll('#filter-list details[open] [data-group]')].map(i => i.dataset.group));
        const hadPanel = $('filter-list').children.length > 0;
        $('filter-list').innerHTML = html;
        for (const box of $('filter-list').querySelectorAll('[data-some]')) box.indeterminate = true;
        if (hadPanel) {
            for (const d of $('filter-list').querySelectorAll('details')) {
                d.open = openGroups.has(d.querySelector('[data-group]').dataset.group);
            }
        }
        this.buildSourceList();
    },

    buildSourceList() {
        const E = Util.esc;
        const zoom = MapView._ready ? MapView.getZoom() : 0;
        $('source-list').innerHTML = Object.entries(DataSources.SOURCES).map(([id, def]) => {
            const st = this.sources[id];
            const on = DataSources.enabledSources[id];
            let status = '';
            if (!on) status = 'switched off';
            else if (st.status === 'loading') status = 'loading…';
            else if (st.status === 'error') status = `⚠️ ${st.error} — will retry when you move the map`;
            else if (zoom < def.minZoom) status = 'zoom in a bit to load';
            else if (st.status === 'ok') status = `✓ ${st.lastCount} found in this area`;
            return `<label class="source"><input type="checkbox" class="switch" data-source="${id}" ${on ? 'checked' : ''}>` +
                `<span><b>${def.icon} ${E(def.label)}</b><small>${E(def.what)}</small>` +
                `<small class="source-status source-${st.status}">${E(status)}</small></span></label>`;
        }).join('');
    },

    // ======================================================================
    // Search
    // ======================================================================
    setupTopbar() {
        const input = $('search-input');
        const results = $('search-results');
        const run = Util.debounce(() => this.showSuggestions(input.value), 180);
        input.addEventListener('input', run);
        input.addEventListener('focus', () => { if (input.value.trim()) this.showSuggestions(input.value); });
        $('search-form').addEventListener('submit', e => { e.preventDefault(); this.submitSearch(input.value); });
        results.addEventListener('click', e => {
            const row = e.target.closest('[data-id], [data-place], [data-all], [data-places]');
            if (!row) return;
            if (row.dataset.id) {
                const poi = this.lookup(row.dataset.id);
                results.classList.add('hidden');
                if (poi) this.select(poi);
            } else if (row.dataset.place) {
                const p = JSON.parse(row.dataset.place);
                results.classList.add('hidden');
                input.blur();
                if (p.bbox) MapView.fitBounds(p.bbox[0], p.bbox[2], p.bbox[1], p.bbox[3]);
                else MapView.flyTo(p.lat, p.lon, 14);
            } else if (row.dataset.all !== undefined) {
                results.classList.add('hidden');
                this.showResults(this.localMatches(input.value.trim().toLowerCase(), 300).map(p => p.id), `“${input.value.trim()}”`);
            } else if (row.dataset.places !== undefined) {
                this.searchPlaces(input.value);
            }
        });
        document.addEventListener('pointerdown', e => {
            if (!e.target.closest('#topbar')) results.classList.add('hidden');
        });
        $('btn-settings').addEventListener('click', () => this.openSettings('ai'));
        $('btn-locate').addEventListener('click', () => this.goToMyLocation());
        $('btn-scan').addEventListener('click', () => {
            const c = MapView.getCenter();
            const cross = $('crosshair');
            cross.classList.remove('hidden');
            setTimeout(() => cross.classList.add('hidden'), 1600);
            this.scan(c.lat, c.lon);
        });
    },

    localMatches(q, limit) {
        if (!q) return [];
        const c = MapView.getCenter();
        const hits = [];
        for (const p of this.pois.values()) if (this.matches(p, q)) hits.push(p);
        const score = p => (p.title.toLowerCase().startsWith(q) ? 0 : p.title.toLowerCase().includes(q) ? 1 : 2);
        hits.sort((a, b) => score(a) - score(b) || Util.haversine(c.lat, c.lon, a.lat, a.lon) - Util.haversine(c.lat, c.lon, b.lat, b.lon));
        return hits.slice(0, limit);
    },

    showSuggestions(text) {
        const q = text.trim().toLowerCase();
        const box = $('search-results');
        if (!q) { box.classList.add('hidden'); return; }
        const E = Util.esc;
        const all = this.localMatches(q, 300);
        const origin = window.userLat !== undefined ? { lat: window.userLat, lon: window.userLon } : MapView.getCenter();
        let html = all.slice(0, 7).map(p => this.listRow(p, Util.haversine(origin.lat, origin.lon, p.lat, p.lon))).join('');
        if (all.length > 7) html += `<button type="button" class="row row-action" data-all>☰ Show all ${all.length} matches</button>`;
        html += `<button type="button" class="row row-action" data-places>🌍 Search places for “${E(text.trim())}”</button>`;
        box.innerHTML = html;
        box.classList.remove('hidden');
    },

    submitSearch(text) {
        const q = text.trim();
        if (!q) return;
        const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
        if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) {
            $('search-results').classList.add('hidden');
            MapView.flyTo(+m[1], +m[2], 14);
            return;
        }
        const local = this.localMatches(q.toLowerCase(), 300);
        if (local.length === 1) { $('search-results').classList.add('hidden'); this.select(local[0]); }
        else if (local.length > 1) { $('search-results').classList.add('hidden'); this.showResults(local.map(p => p.id), `“${q}”`); }
        else this.searchPlaces(q);
    },

    async searchPlaces(text) {
        const q = text.trim();
        const box = $('search-results');
        if (!q) return;
        box.innerHTML = `<p class="empty">Searching places…</p>`;
        box.classList.remove('hidden');
        try {
            const places = await DataSources.searchPlaces(q);
            if (!places.length) { box.innerHTML = `<p class="empty">No place called “${Util.esc(q)}” was found. Check the spelling, or try a nearby town.</p>`; return; }
            if (places.length === 1) {
                box.classList.add('hidden');
                const p = places[0];
                if (p.bbox) MapView.fitBounds(p.bbox[0], p.bbox[2], p.bbox[1], p.bbox[3]); else MapView.flyTo(p.lat, p.lon, 14);
                return;
            }
            box.innerHTML = places.map(p =>
                `<button type="button" class="row" data-place="${Util.esc(JSON.stringify(p))}"><span class="row-icon row-icon-plain">📍</span>` +
                `<span class="row-text"><b>${Util.esc(p.name.split(',')[0])}</b><small>${Util.esc(p.name.split(',').slice(1).join(',').trim())}</small></span></button>`).join('');
        } catch (e) {
            box.innerHTML = `<p class="empty">Place search is not answering right now. Try again in a moment.</p>`;
        }
    },

    // ======================================================================
    // Layers & view popover
    // ======================================================================
    setupLayersPanel() {
        const panel = $('layers-panel');
        $('btn-layers').addEventListener('click', e => {
            e.stopPropagation();
            panel.classList.toggle('hidden');
            $('btn-layers').classList.toggle('is-active', !panel.classList.contains('hidden'));
        });

        const list = $('basemap-list');
        const paint = () => {
            list.innerHTML = Object.entries(MapView.BASEMAPS).map(([id, b]) =>
                `<button type="button" class="tile${MapView.basemap === id ? ' is-active' : ''}" data-basemap="${id}" aria-pressed="${MapView.basemap === id}"><span>${b.icon}</span>${Util.esc(b.label)}</button>`).join('');
        };
        paint();
        list.addEventListener('click', e => {
            const btn = e.target.closest('[data-basemap]');
            if (!btn) return;
            MapView.setBasemap(btn.dataset.basemap);
            Settings.set('basemap', btn.dataset.basemap);
            paint();
        });

        const geo = $('toggle-geology'), opacity = $('geology-opacity'), opRow = $('geology-opacity-row');
        geo.checked = !!Settings.get('geology');
        opacity.value = Math.round((Settings.get('geologyOpacity') || 0.6) * 100);
        opRow.classList.toggle('hidden', !geo.checked);
        geo.addEventListener('change', () => {
            Settings.set('geology', geo.checked);
            opRow.classList.toggle('hidden', !geo.checked);
            MapView.setGeologyOverlay(geo.checked, opacity.value / 100);
            if (geo.checked) Toast.show('Colours show rock units. Press and hold a spot (or tap 🔬) to see what it is.', { duration: 6000 });
        });
        opacity.addEventListener('input', () => {
            Settings.set('geologyOpacity', opacity.value / 100);
            MapView.setGeologyOverlay(geo.checked, opacity.value / 100);
        });

        const terrain = $('toggle-terrain');
        terrain.checked = !!Settings.get('terrain');
        terrain.addEventListener('change', () => {
            Settings.set('terrain', terrain.checked);
            MapView.setTerrain(terrain.checked);
        });

        const touch = $('toggle-touch-rotate');
        touch.checked = !!Settings.get('touchRotate');
        touch.addEventListener('change', () => {
            Settings.set('touchRotate', touch.checked);
            MapView.setTouchRotate(touch.checked);
        });

        const rot = $('rotation-slider'), tilt = $('tilt-slider');
        rot.addEventListener('input', () => MapView.setBearing(+rot.value));
        tilt.addEventListener('input', () => MapView.setPitch(+tilt.value));
        $('rotate-left-btn').addEventListener('click', () => MapView.map.easeTo({ bearing: MapView.map.getBearing() - 45, duration: 300 }));
        $('rotate-right-btn').addEventListener('click', () => MapView.map.easeTo({ bearing: MapView.map.getBearing() + 45, duration: 300 }));
        $('rotate-reset-btn').addEventListener('click', () => MapView.resetView());
    },

    syncViewSliders(bearing, pitch) {
        const b = Math.round(((bearing + 540) % 360) - 180);
        $('rotation-slider').value = b;
        $('rotation-value').textContent = `${b}°`;
        $('tilt-slider').value = Math.round(pitch);
        $('tilt-value').textContent = `${Math.round(pitch)}°`;
    },

    /** Close any open popover. Returns true if something was closed. */
    hidePopovers() {
        let closed = false;
        for (const id of ['layers-panel', 'search-results']) {
            if (!$(id).classList.contains('hidden')) { $(id).classList.add('hidden'); closed = true; }
        }
        $('btn-layers').classList.remove('is-active');
        return closed;
    },

    closeTopmost() {
        if (!$('settings-modal').classList.contains('hidden')) { this.closeSettings(); return; }
        if (!$('warning-overlay').classList.contains('hidden')) return;      // handled by the warning itself
        if (this.hidePopovers()) return;
        if (!$('detail-panel').classList.contains('hidden')) { this.closeDetail(); return; }
        this.closeSheets();
    },

    // ======================================================================
    // Settings
    // ======================================================================
    setupSettings() {
        $('settings-close').addEventListener('click', () => this.closeSettings());
        $('settings-modal').addEventListener('pointerdown', e => { if (e.target === $('settings-modal')) this.closeSettings(); });
        $('settings-tabs').addEventListener('click', e => {
            const tab = e.target.closest('[data-tab]');
            if (tab) this.showSettingsTab(tab.dataset.tab);
        });

        const units = $('set-units'), theme = $('set-theme'), warn = $('set-warnings');
        units.value = Settings.get('units');
        theme.value = Settings.get('theme');
        warn.checked = !!Settings.get('contentWarnings');
        units.addEventListener('change', () => {
            Settings.set('units', units.value);
            MapView.setUnits(units.value);
            if (this.selected) this.select(this.selected, { fly: false });
            if (!$('list-panel').classList.contains('hidden')) this.renderList();
        });
        theme.addEventListener('change', () => { Settings.set('theme', theme.value); this.applyTheme(); });
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
        }
        warn.addEventListener('change', () => Settings.set('contentWarnings', warn.checked));
        $('clear-data-btn').addEventListener('click', () => {
            this.pois.clear(); this.byQid.clear(); this.byWiki.clear();
            for (const st of Object.values(this.sources)) st.covered = [];
            this.closeSheets();
            this.renderMap();
            this.refresh(true);
            this.closeSettings();
            Toast.show('Cleared. Reloading this area…');
        });

        // AI provider cards (event delegation; the cards are re-rendered on change)
        const host = $('ai-providers');
        host.addEventListener('change', e => this.onAISettingChange(e));
        host.addEventListener('click', e => this.onAISettingClick(e));
    },

    openSettings(tab = 'ai') {
        this.hidePopovers();
        this.renderAIProviders();
        this.showSettingsTab(tab);
        $('settings-modal').classList.remove('hidden');
    },

    closeSettings() {
        $('settings-modal').classList.add('hidden');
        AIChat.updateModelButton();
    },

    showSettingsTab(tab) {
        for (const t of $('settings-tabs').querySelectorAll('.tab')) t.classList.toggle('is-active', t.dataset.tab === tab);
        $('settings-ai').classList.toggle('hidden', tab !== 'ai');
        $('settings-app').classList.toggle('hidden', tab !== 'app');
    },

    renderAIProviders(messages = {}) {
        const E = Util.esc;
        const chosen = AIChat.config.provider;
        let html = '';
        for (const [pid, p] of Object.entries(AIChat.PROVIDERS)) {
            const key = AIChat.key(pid);
            const model = AIChat.model(pid);
            const list = AIChat.modelList(pid).slice();
            if (!list.some(m => m[0] === model)) list.unshift([model, model]);
            const live = AIChat.config.lists[pid];
            const defaultNote = `Default: ${AIChat.modelName(pid, p.defaultModel)}`;
            const info = messages[pid] || (live && live.models
                ? `${live.models.length} models available with your key. ${defaultNote}.`
                : key ? `Tap ↻ to load every model your key can use. ${defaultNote}.`
                : `Add a key to load every ${p.label} model. ${defaultNote}.`);
            html += `<div class="provider${chosen === pid ? ' is-selected' : ''}" data-pid="${pid}">` +
                `<label class="provider-head"><input type="radio" name="ai-provider" value="${pid}" ${chosen === pid ? 'checked' : ''}>` +
                `<span><b>${E(p.label)}</b> <small>by ${E(p.company)}</small></span>` +
                `<span class="provider-state">${key ? '✓ key saved' : 'no key yet'}</span></label>` +
                `<div class="provider-body">` +
                `<label class="field"><span>Model</span><span class="field-row">` +
                `<select data-role="model" aria-label="${E(p.label)} model">` +
                list.map(m => `<option value="${E(m[0])}" ${m[0] === model ? 'selected' : ''}>${E(m[1])}${m[1] !== m[0] ? ` — ${E(m[0])}` : ''}</option>`).join('') +
                `<option value="__custom">Other model ID…</option></select>` +
                `<button type="button" class="icon-btn" data-role="refresh" title="Reload the model list" aria-label="Reload the model list">↻</button></span></label>` +
                `<label class="field"><span>API key</span><span class="field-row">` +
                `<input type="password" data-role="key" value="${E(key)}" placeholder="${E(p.keyPlaceholder)}" autocomplete="off" autocapitalize="off" spellcheck="false">` +
                `<button type="button" class="icon-btn" data-role="reveal" title="Show or hide the key" aria-label="Show or hide the key">👁</button></span></label>` +
                `<p class="hint"><span data-role="msg">${E(info)}</span> <a href="${E(p.keyUrl)}" target="_blank" rel="noopener">Get a ${E(p.label)} key ↗</a></p>` +
                `</div></div>`;
        }
        html += `<div class="provider${chosen === 'builtin' ? ' is-selected' : ''}" data-pid="builtin">` +
            `<label class="provider-head"><input type="radio" name="ai-provider" value="builtin" ${chosen === 'builtin' ? 'checked' : ''}>` +
            `<span><b>Built-in guide</b> <small>no key needed</small></span><span class="provider-state">always available</span></label>` +
            `<div class="provider-body"><p class="hint">Answers from Wikipedia and the map data. Used automatically whenever no AI key is set.</p></div></div>`;
        $('ai-providers').innerHTML = html;
    },

    async loadModels(pid) {
        this.renderAIProviders({ [pid]: 'Loading models…' });
        try {
            const models = await AIChat.refreshModels(pid);
            // If the saved choice no longer exists for this key, fall back to the default pick
            if (AIChat.config.models[pid] && !models.some(m => m[0] === AIChat.config.models[pid])) {
                delete AIChat.config.models[pid];
                AIChat.saveConfig();
            }
            this.renderAIProviders({ [pid]: `✓ Key works — ${models.length} models loaded. Using ${AIChat.modelName(pid, AIChat.model(pid))}.` });
        } catch (e) {
            this.renderAIProviders({ [pid]: `⚠️ ${e.message}` });
        }
        AIChat.updateModelButton();
    },

    onAISettingChange(e) {
        const card = e.target.closest('[data-pid]');
        if (!card) return;
        const pid = card.dataset.pid;
        if (e.target.name === 'ai-provider') {
            AIChat.config.provider = pid;
            AIChat.saveConfig();
            this.renderAIProviders();
            const a = AIChat.active();
            if (pid !== 'builtin' && !AIChat.key(pid)) Toast.show(`Add your ${AIChat.PROVIDERS[pid].label} API key to start using it.`);
            else Toast.show(`Now answering with ${a.label}.`);
        } else if (e.target.dataset.role === 'key') {
            const value = e.target.value.trim();
            AIChat.config.keys[pid] = value;
            if (!value) delete AIChat.config.lists[pid];
            AIChat.saveConfig();
            if (value) this.loadModels(pid); else this.renderAIProviders();
        } else if (e.target.dataset.role === 'model') {
            let value = e.target.value;
            if (value === '__custom') {
                value = (window.prompt(`Type the exact ${AIChat.PROVIDERS[pid].label} model ID:`, AIChat.model(pid)) || '').trim();
                if (!value) { this.renderAIProviders(); return; }
            }
            AIChat.config.models[pid] = value;
            AIChat.saveConfig();
            this.renderAIProviders();
        }
        AIChat.updateModelButton();
    },

    onAISettingClick(e) {
        const card = e.target.closest('[data-pid]');
        const role = e.target.dataset.role;
        if (!card || !role) return;
        const pid = card.dataset.pid;
        if (role === 'refresh') {
            if (!AIChat.key(pid)) { Toast.show(`Add your ${AIChat.PROVIDERS[pid].label} API key first.`); return; }
            this.loadModels(pid);
        } else if (role === 'reveal') {
            const input = card.querySelector('[data-role="key"]');
            input.type = input.type === 'password' ? 'text' : 'password';
        }
    },

    /** Keep each provider's model list fresh in the background (once a day). */
    refreshModelListsQuietly() {
        for (const pid of Object.keys(AIChat.PROVIDERS)) {
            const live = AIChat.config.lists[pid];
            if (AIChat.key(pid) && (!live || Date.now() - live.at > 24 * 3600 * 1000)) {
                AIChat.refreshModels(pid).then(() => AIChat.updateModelButton()).catch(() => {});
            }
        }
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
