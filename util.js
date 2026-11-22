/**
 * Explorer Map — shared helpers and saved settings.
 */

const Settings = {
    KEY: 'explorer_map_settings_v2',
    data: {
        units: (typeof navigator !== 'undefined' && /^en-US/i.test(navigator.language || '')) ? 'imperial' : 'metric',
        theme: 'auto',              // auto | light | dark
        touchRotate: false,         // two-finger rotate on touch screens
        contentWarnings: true,      // warn before showing possibly-dead animals
        basemap: 'streets',
        geology: false,
        geologyOpacity: 0.6,
        terrain: false,
        activeCategories: null,     // null = defaults
        seenTips: false,
    },

    load() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.KEY) || '{}');
            Object.assign(this.data, saved);
        } catch (e) { /* first run or storage blocked */ }
        return this.data;
    },

    save() {
        try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    },

    set(key, value) {
        this.data[key] = value;
        this.save();
    },

    get(key) { return this.data[key]; },
};

const Util = {
    /** Escape text for safe insertion into HTML. */
    esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /** Only allow real web links in href/src attributes. */
    safeUrl(url) {
        if (!url) return '';
        const u = String(url).trim();
        return /^https?:\/\//i.test(u) ? u : '';
    },

    /** Strip any HTML tags (some APIs return formatted summaries). */
    plain(html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
        return (div.textContent || '').trim();
    },

    /** Great-circle distance in kilometres. */
    haversine(lat1, lon1, lat2, lon2) {
        const R = 6371, rad = Math.PI / 180;
        const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    /** Compass direction from point 1 to point 2, e.g. "NW". */
    compass(lat1, lon1, lat2, lon2) {
        const rad = Math.PI / 180;
        const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
        const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
            Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
        const deg = (Math.atan2(y, x) / rad + 360) % 360;
        return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
    },

    distanceText(km) {
        if (Settings.get('units') === 'imperial') {
            const mi = km * 0.621371;
            if (mi < 0.19) return `${Math.round(mi * 5280 / 10) * 10} ft`;
            return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
        }
        if (km < 1) return `${Math.max(1, Math.round(km * 1000 / 5) * 5)} m`;
        return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
    },

    elevationText(meters) {
        if (meters === null || meters === undefined || isNaN(meters)) return '';
        return Settings.get('units') === 'imperial'
            ? `${Math.round(meters * 3.28084).toLocaleString()} ft`
            : `${Math.round(meters).toLocaleString()} m`;
    },

    /** Distance from the user (if known) to a POI, as text like "1.2 km NW". */
    fromUser(poi) {
        if (window.userLat === undefined) return '';
        const km = this.haversine(window.userLat, window.userLon, poi.lat, poi.lon);
        return `${this.distanceText(km)} ${this.compass(window.userLat, window.userLon, poi.lat, poi.lon)}`;
    },

    kmFromUser(poi) {
        if (window.userLat === undefined) return null;
        return this.haversine(window.userLat, window.userLon, poi.lat, poi.lon);
    },

    ageText(ma) {
        const n = parseFloat(ma);
        if (!isFinite(n)) return '';
        if (n >= 1000) return `${(n / 1000).toFixed(2)} billion years`;
        if (n >= 1) return `${n >= 10 ? Math.round(n) : n.toFixed(1)} million years`;
        return `${Math.round(n * 1000).toLocaleString()} thousand years`;
    },

    daysAgoText(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d)) return '';
        const days = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 60) return `${days} days ago`;
        if (days < 730) return `${Math.round(days / 30)} months ago`;
        return `${Math.round(days / 365)} years ago`;
    },

    debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    },

    /** Treat a value that may be a single object or an array as an array. */
    arr(v) {
        if (v === null || v === undefined) return [];
        return Array.isArray(v) ? v : [v];
    },

    titleCase(s) {
        return String(s || '').toLowerCase().replace(/(^|[\s\-/(])\w/g, c => c.toUpperCase());
    },
};

/** Small non-blocking messages at the bottom of the screen (replaces alert()). */
const Toast = {
    show(message, { type = 'info', duration = 3600, action } = {}) {
        const host = document.getElementById('toast-host');
        if (!host) return;
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.setAttribute('role', 'status');
        const span = document.createElement('span');
        span.textContent = message;
        el.appendChild(span);
        if (action) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = action.label;
            btn.addEventListener('click', () => { action.run(); el.remove(); });
            el.appendChild(btn);
        }
        host.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            setTimeout(() => el.remove(), 300);
        }, duration);
        return el;
    },
};
