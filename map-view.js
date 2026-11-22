/**
 * Explorer Map — the map itself (MapLibre GL JS).
 *
 * Real rotation and tilt (the map engine does it, so dragging and tapping stay
 * accurate at any angle), optional 3D terrain, four basemaps, a geologic-map
 * overlay, GPU-drawn pins that stay fast with thousands of discoveries, and
 * donut clusters that show the mix of what is inside them.
 */

const MapView = {
    map: null,
    handlers: {},          // onSelect(ids[], lngLat), onBackgroundClick(), onLongPress(lat, lon), onMoveEnd(), onRotate(bearing, pitch)
    _clusterMarkers: new Map(),
    _clusterOnScreen: new Map(),
    _dataVersion: 0,
    _userMarker: null,
    _ready: false,
    _pendingData: null,
    basemap: 'streets',

    BASEMAPS: {
        streets:   { label: 'Streets',   icon: '🗺️' },
        satellite: { label: 'Satellite', icon: '🛰️' },
        topo:      { label: 'Terrain',   icon: '⛰️' },
        contours:  { label: 'Contours',  icon: '🥾' },
    },

    buildStyle() {
        const esri = 'Tiles &copy; Esri';
        return {
            version: 8,
            sources: {
                streets: {
                    type: 'raster', tileSize: 256, maxzoom: 19,
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
                },
                satellite: {
                    type: 'raster', tileSize: 256, maxzoom: 19,
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    attribution: esri + ', Maxar, Earthstar Geographics',
                },
                topo: {
                    type: 'raster', tileSize: 256, maxzoom: 19,
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
                    attribution: esri + ', USGS, NOAA',
                },
                contours: {
                    type: 'raster', tileSize: 256, maxzoom: 17,
                    tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
                    attribution: '&copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)',
                },
                geology: {
                    type: 'raster', tileSize: 256, maxzoom: 14,
                    tiles: ['https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png'],
                    attribution: 'Geology &copy; <a href="https://macrostrat.org" target="_blank" rel="noopener">Macrostrat</a>',
                },
                'dem-terrain': {
                    type: 'raster-dem', tileSize: 256, maxzoom: 14, encoding: 'terrarium',
                    tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
                    attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
                },
                'dem-shade': {
                    type: 'raster-dem', tileSize: 256, maxzoom: 14, encoding: 'terrarium',
                    tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
                },
                pois: {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                    cluster: true, clusterRadius: 46, clusterMaxZoom: 16,
                    clusterProperties: Object.fromEntries(Object.keys(GROUPS).map(g =>
                        [g, ['+', ['case', ['==', ['get', 'group'], g], 1, 0]]])),
                },
                selected: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
                outline: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
                accuracy: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
            },
            layers: [
                { id: 'bg', type: 'background', paint: { 'background-color': '#dfe6e9' } },
                { id: 'base-streets', type: 'raster', source: 'streets' },
                { id: 'base-satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
                { id: 'base-topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
                { id: 'base-contours', type: 'raster', source: 'contours', layout: { visibility: 'none' } },
                { id: 'hillshade', type: 'hillshade', source: 'dem-shade', layout: { visibility: 'none' },
                  paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3b3a4a' } },
                { id: 'overlay-geology', type: 'raster', source: 'geology', layout: { visibility: 'none' },
                  paint: { 'raster-opacity': 0.6 } },
                { id: 'accuracy-fill', type: 'fill', source: 'accuracy',
                  paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.12 } },
                { id: 'accuracy-line', type: 'line', source: 'accuracy',
                  paint: { 'line-color': '#2563eb', 'line-opacity': 0.45, 'line-width': 1 } },
                { id: 'outline-casing', type: 'line', source: 'outline',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 } },
                { id: 'outline-line', type: 'line', source: 'outline',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#e11d48', 'line-width': 3 } },
                { id: 'selected-halo', type: 'circle', source: 'selected',
                  paint: {
                      'circle-radius': 25, 'circle-color': '#e11d48', 'circle-opacity': 0.18,
                      'circle-stroke-color': '#e11d48', 'circle-stroke-width': 3,
                  } },
                { id: 'poi-points', type: 'symbol', source: 'pois', filter: ['!', ['has', 'point_count']],
                  layout: {
                      'icon-image': ['get', 'category'],
                      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 13, 0.85, 17, 1.05],
                      'icon-allow-overlap': true,
                      'icon-ignore-placement': true,
                      'symbol-sort-key': ['get', 'rank'],
                  } },
            ],
        };
    },

    init(containerId, options, handlers) {
        this.handlers = handlers || {};
        this.basemap = options.basemap || 'streets';

        this.map = new maplibregl.Map({
            container: containerId,
            style: this.buildStyle(),
            center: options.center || [-98.5, 39.5],
            zoom: options.zoom ?? 3.6,
            maxPitch: 75,
            hash: true,                 // keeps #zoom/lat/lon in the address bar → shareable links
            attributionControl: false,
            dragRotate: true,
            pitchWithRotate: true,
        });
        const map = this.map;

        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
        this._scale = new maplibregl.ScaleControl({ maxWidth: 110, unit: options.units === 'imperial' ? 'imperial' : 'metric' });
        map.addControl(this._scale, 'bottom-left');

        this.setTouchRotate(!!options.touchRotate);

        map.on('styleimagemissing', e => this._addCategoryIcon(e.id));

        map.on('load', () => {
            for (const key of Object.keys(CATEGORIES)) this._addCategoryIcon(key);
            this._ready = true;
            this.setBasemap(this.basemap);
            if (options.geology) this.setGeologyOverlay(true, options.geologyOpacity);
            if (options.terrain) this.setTerrain(true);
            if (this._pendingData) { this.setData(this._pendingData); this._pendingData = null; }
            if (this.handlers.onReady) this.handlers.onReady();
        });

        // Clusters are HTML donuts; keep them in sync with what the map is showing.
        let queued = false;
        map.on('render', () => {
            if (queued || !this._ready) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; this._syncClusters(); });
        });

        map.on('click', e => this._onClick(e));
        map.on('contextmenu', e => {            // right-click on desktop
            if (this.handlers.onLongPress) this.handlers.onLongPress(e.lngLat.lat, e.lngLat.lng);
        });
        this._setupLongPress();

        map.on('mouseenter', 'poi-points', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'poi-points', () => { map.getCanvas().style.cursor = ''; this._hideTip(); });
        map.on('mousemove', 'poi-points', e => {
            const f = e.features && e.features[0];
            if (f) this._showTip(e.point, f.properties.title);
        });

        map.on('moveend', () => { if (this.handlers.onMoveEnd) this.handlers.onMoveEnd(); });
        map.on('rotate', () => this._emitView());
        map.on('pitch', () => this._emitView());

        return map;
    },

    _emitView() {
        if (this.handlers.onRotate) this.handlers.onRotate(this.map.getBearing(), this.map.getPitch());
    },

    // ------------------------------------------------------------------
    // Icons — one small canvas drawing per category, uploaded to the GPU
    // ------------------------------------------------------------------
    _addCategoryIcon(key) {
        const map = this.map;
        if (map.hasImage(key)) return;
        const cat = getCategory(key);
        const px = 2, size = 36 * px;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const r = size / 2;
        ctx.beginPath();
        ctx.arc(r, r, r - 5 * px, 0, Math.PI * 2);
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 3 * px;
        ctx.shadowOffsetY = 1 * px;
        ctx.fillStyle = cat.color;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.font = `${15 * px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(cat.icon, r, r + 1 * px);
        map.addImage(key, ctx.getImageData(0, 0, size, size), { pixelRatio: px });
    },

    // ------------------------------------------------------------------
    // Data
    // ------------------------------------------------------------------
    /** pois: array of POI objects already filtered to what should be visible. */
    setData(pois) {
        if (!this._ready) { this._pendingData = pois; return; }
        const features = pois.map(p => {
            const cat = getCategory(p.category);
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                properties: {
                    id: p.id, category: CATEGORIES[p.category] ? p.category : 'other_misc',
                    group: cat.group, title: p.title,
                    // higher rank is drawn on top: rocks & minerals and named things win overlaps
                    rank: (cat.group === 'geology' ? 5 : cat.group === 'landforms' ? 4 : 3) - (p.named === false ? 3 : 0),
                },
            };
        });
        this._dataVersion++;
        for (const m of this._clusterMarkers.values()) m.remove();
        this._clusterMarkers.clear();
        this._clusterOnScreen.clear();
        this.map.getSource('pois').setData({ type: 'FeatureCollection', features });
    },

    _syncClusters() {
        const map = this.map;
        if (!map.getSource('pois') || !map.isSourceLoaded('pois')) return;
        const next = new Map();
        for (const f of map.querySourceFeatures('pois')) {
            const p = f.properties;
            if (!p.cluster) continue;
            const id = p.cluster_id;
            if (next.has(id)) continue;
            let marker = this._clusterMarkers.get(id);
            if (!marker) {
                const el = this._clusterElement(p);
                const coords = f.geometry.coordinates;
                el.addEventListener('click', ev => {
                    ev.stopPropagation();
                    this._expandCluster(id, coords, p.point_count);
                });
                marker = new maplibregl.Marker({ element: el }).setLngLat(coords);
                this._clusterMarkers.set(id, marker);
            }
            next.set(id, marker);
            if (!this._clusterOnScreen.has(id)) marker.addTo(map);
        }
        for (const [id, marker] of this._clusterOnScreen) if (!next.has(id)) marker.remove();
        this._clusterOnScreen = next;
    },

    _clusterElement(props) {
        const total = props.point_count;
        const size = total >= 500 ? 58 : total >= 100 ? 52 : total >= 25 ? 46 : total >= 8 ? 40 : 34;
        const r = size / 2, r0 = Math.round(r * 0.62);
        let offset = 0, segs = '';
        for (const [g, def] of Object.entries(GROUPS)) {
            const n = props[g] || 0;
            if (!n) continue;
            segs += this._donutSegment(offset / total, (offset + n) / total, r, r0, def.color);
            offset += n;
        }
        const el = document.createElement('button');
        el.className = 'cluster-marker';
        el.type = 'button';
        el.setAttribute('aria-label', `${total} discoveries — tap to zoom in`);
        const label = props.point_count_abbreviated ?? total;
        el.innerHTML =
            `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
            segs +
            `<circle cx="${r}" cy="${r}" r="${r0}" class="cluster-hole"/>` +
            `<text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" class="cluster-count" ` +
            `font-size="${size > 46 ? 14 : 12}">${label}</text></svg>`;
        return el;
    },

    _donutSegment(start, end, r, r0, color) {
        if (end - start >= 0.9999) {
            return `<circle cx="${r}" cy="${r}" r="${(r + r0) / 2}" fill="none" stroke="${color}" stroke-width="${r - r0}"/>`;
        }
        const a0 = 2 * Math.PI * (start - 0.25), a1 = 2 * Math.PI * (end - 0.25);
        const x0 = Math.cos(a0), y0 = Math.sin(a0), x1 = Math.cos(a1), y1 = Math.sin(a1);
        const large = end - start > 0.5 ? 1 : 0;
        return `<path d="M ${r + r0 * x0} ${r + r0 * y0} L ${r + r * x0} ${r + r * y0} ` +
            `A ${r} ${r} 0 ${large} 1 ${r + r * x1} ${r + r * y1} L ${r + r0 * x1} ${r + r0 * y1} ` +
            `A ${r0} ${r0} 0 ${large} 0 ${r + r0 * x0} ${r + r0 * y0}" fill="${color}"/>`;
    },

    async _expandCluster(clusterId, coords, count) {
        const src = this.map.getSource('pois');
        try {
            const zoom = await src.getClusterExpansionZoom(clusterId);
            if (zoom > this.map.getMaxZoom() - 0.5 || this.map.getZoom() >= 17.5) {
                // Things stacked on the same spot: list them instead of zooming forever.
                const leaves = await src.getClusterLeaves(clusterId, Math.min(count, 100), 0);
                const ids = leaves.map(l => l.properties.id);
                if (this.handlers.onSelect) this.handlers.onSelect(ids, { lng: coords[0], lat: coords[1] });
                return;
            }
            this.map.easeTo({ center: coords, zoom: Math.min(zoom + 0.3, 19), duration: 500 });
        } catch (e) { /* data changed underneath us — the next render fixes it */ }
    },

    // ------------------------------------------------------------------
    // Interaction
    // ------------------------------------------------------------------
    _onClick(e) {
        if (this._suppressClick) { this._suppressClick = false; return; }
        const pad = 14;
        const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
        const feats = this.map.queryRenderedFeatures(box, { layers: ['poi-points'] });
        const ids = [...new Set(feats.map(f => f.properties.id))];
        if (ids.length) {
            if (this.handlers.onSelect) this.handlers.onSelect(ids, e.lngLat);
        } else if (this.handlers.onBackgroundClick) {
            this.handlers.onBackgroundClick(e.lngLat);
        }
    },

    /** Touch-and-hold on empty map = "scan this spot". */
    _setupLongPress() {
        const map = this.map;
        let timer = null, start = null;
        const cancel = () => { clearTimeout(timer); timer = null; };
        map.on('touchstart', e => {
            cancel();
            if (e.originalEvent.touches.length !== 1) return;
            start = e.point;
            const lngLat = e.lngLat;
            timer = setTimeout(() => {
                timer = null;
                this._suppressClick = true;
                setTimeout(() => { this._suppressClick = false; }, 600);
                if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* ignore */ } }
                if (this.handlers.onLongPress) this.handlers.onLongPress(lngLat.lat, lngLat.lng);
            }, 650);
        });
        map.on('touchmove', e => {
            if (timer && start && (Math.abs(e.point.x - start.x) > 8 || Math.abs(e.point.y - start.y) > 8)) cancel();
        });
        map.on('touchend', cancel);
        map.on('touchcancel', cancel);
        map.on('movestart', cancel);
    },

    _showTip(point, text) {
        if (!this._tip) {
            this._tip = document.createElement('div');
            this._tip.className = 'map-tip';
            this.map.getContainer().appendChild(this._tip);
        }
        this._tip.textContent = text;
        this._tip.style.transform = `translate(${point.x + 14}px, ${point.y - 30}px)`;
        this._tip.hidden = false;
    },
    _hideTip() { if (this._tip) this._tip.hidden = true; },

    // ------------------------------------------------------------------
    // View controls
    // ------------------------------------------------------------------
    setBasemap(id) {
        if (!this.BASEMAPS[id]) id = 'streets';
        this.basemap = id;
        if (!this._ready) return;
        for (const key of Object.keys(this.BASEMAPS)) {
            this.map.setLayoutProperty(`base-${key}`, 'visibility', key === id ? 'visible' : 'none');
        }
    },

    setGeologyOverlay(on, opacity) {
        if (!this._ready) return;
        this.map.setLayoutProperty('overlay-geology', 'visibility', on ? 'visible' : 'none');
        if (typeof opacity === 'number') this.map.setPaintProperty('overlay-geology', 'raster-opacity', opacity);
    },

    setTerrain(on) {
        if (!this._ready) return;
        try {
            this.map.setTerrain(on ? { source: 'dem-terrain', exaggeration: 1.4 } : null);
            this.map.setLayoutProperty('hillshade', 'visibility', on ? 'visible' : 'none');
            if (on && this.map.getPitch() < 30) this.map.easeTo({ pitch: 60, duration: 800 });
        } catch (e) { console.warn('Terrain unavailable:', e); }
    },

    setTouchRotate(on) {
        if (on) this.map.touchZoomRotate.enableRotation();
        else this.map.touchZoomRotate.disableRotation();
    },

    setUnits(units) {
        if (this._scale && this._scale.setUnit) this._scale.setUnit(units === 'imperial' ? 'imperial' : 'metric');
    },

    setBearing(deg) { this.map.setBearing(deg); },
    setPitch(deg) { this.map.setPitch(deg); },
    resetView() { this.map.easeTo({ bearing: 0, pitch: 0, duration: 500 }); },

    flyTo(lat, lon, zoom, opts = {}) {
        this.map.flyTo({
            center: [lon, lat],
            zoom: zoom ?? this.map.getZoom(),
            duration: 900, essential: true,
            padding: this._padding(),
            ...opts,
        });
    },

    /** Keep the focused point clear of whichever panel is covering part of the map. */
    panelInsets: { left: 0, bottom: 0 },
    _padding() {
        return { top: 90, right: 20, left: 20 + this.panelInsets.left, bottom: 40 + this.panelInsets.bottom };
    },

    focus(lat, lon, minZoom = 14) {
        const z = Math.max(this.map.getZoom(), minZoom);
        this.map.easeTo({ center: [lon, lat], zoom: z, duration: 600, padding: this._padding() });
    },

    fitBounds(south, west, north, east) {
        this.map.fitBounds([[west, south], [east, north]], { padding: this._padding(), maxZoom: 16, duration: 900 });
    },

    getBounds() {
        const b = this.map.getBounds();
        return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    },
    getZoom() { return this.map.getZoom(); },
    getCenter() { const c = this.map.getCenter(); return { lat: c.lat, lon: c.lng }; },

    // ------------------------------------------------------------------
    // Selection highlight, outlines, user position
    // ------------------------------------------------------------------
    setSelected(poi) {
        if (!this._ready) return;
        this.map.getSource('selected').setData({
            type: 'FeatureCollection',
            features: poi ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [poi.lon, poi.lat] } }] : [],
        });
        if (!poi) this.setOutline(null);
    },

    setOutline(feature) {
        if (!this._ready) return;
        this.map.getSource('outline').setData({ type: 'FeatureCollection', features: feature ? [feature] : [] });
    },

    setUserLocation(lat, lon, accuracy) {
        if (!this._userMarker) {
            const el = document.createElement('div');
            el.className = 'user-dot';
            el.title = 'You are here';
            this._userMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map);
        } else {
            this._userMarker.setLngLat([lon, lat]);
        }
        if (this._ready) {
            const ring = accuracy && accuracy > 8 ? [this._circle(lat, lon, Math.min(accuracy, 5000))] : [];
            this.map.getSource('accuracy').setData({ type: 'FeatureCollection', features: ring });
        }
    },

    _circle(lat, lon, meters) {
        const pts = [], n = 48;
        const dLat = meters / 111320, dLon = meters / (111320 * Math.cos(lat * Math.PI / 180));
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * 2 * Math.PI;
            pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
        }
        return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
    },

    resize() { if (this.map) this.map.resize(); },
};
