/**
 * Explorer Map - Main application
 * Real-time location + real data from OSM, iNaturalist, Wikipedia
 * Features: rotation/tilt, dead animal warnings, AI chat
 */

// ==================== State ====================
let map;
let userMarker, userAccuracyCircle;
let markerCluster;
let allPOIs = [];
let activeFilters = new Set(Object.keys(CATEGORIES));
let isLoadingData = false;
let lastFetchBounds = null;

// Rotation/tilt state
let currentRotation = 0;
let currentTilt = 0;

window.userLat = undefined;
window.userLon = undefined;

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', init);

function init() {
    // Create map with multiple tile layers
    map = L.map('map', {
        zoomControl: false,
        attributionControl: true,
    }).setView([40, -100], 4);

    // Tile layers
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
    });

    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
    });

    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenTopoMap',
        maxZoom: 17,
    });

    // Default to streets
    streets.addTo(map);

    // Layer control
    L.control.layers({
        'Street Map': streets,
        'Satellite': satellite,
        'Topographic': topo,
    }, null, { position: 'topright' }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Marker cluster group
    markerCluster = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        disableClusteringAtZoom: 18,
    });
    map.addLayer(markerCluster);

    // Start geolocation
    startGeolocation();

    // Map events
    map.on('moveend', onMapMove);

    // UI events
    setupUI();
    setupRotationControls();
    setupTwoFingerRotation();
}

// ==================== Geolocation ====================
function startGeolocation() {
    if (!navigator.geolocation) {
        hideLoading('Geolocation not supported. Pan the map to explore.');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lon, accuracy } = pos.coords;
            window.userLat = lat;
            window.userLon = lon;

            map.setView([lat, lon], 15);
            updateUserMarker(lat, lon, accuracy);
            hideLoading();
            fetchDataForView();
        },
        (err) => {
            console.warn('Geolocation error:', err);
            hideLoading('Could not get location. Pan the map to explore!');
            fetchDataForView();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude: lat, longitude: lon, accuracy } = pos.coords;
            window.userLat = lat;
            window.userLon = lon;
            updateUserMarker(lat, lon, accuracy);
            updateCoordsDisplay(lat, lon);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 }
    );
}

function updateUserMarker(lat, lon, accuracy) {
    if (!userMarker) {
        const icon = L.divIcon({
            className: 'user-location-marker',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
        });
        userMarker = L.marker([lat, lon], { icon, zIndexOffset: 9999 })
            .bindPopup('📍 <strong>You are here</strong>')
            .addTo(map);

        userAccuracyCircle = L.circle([lat, lon], {
            radius: accuracy || 30,
            color: '#4285f4',
            fillColor: '#4285f4',
            fillOpacity: 0.1,
            weight: 1,
        }).addTo(map);
    } else {
        userMarker.setLatLng([lat, lon]);
        userAccuracyCircle.setLatLng([lat, lon]);
        if (accuracy) userAccuracyCircle.setRadius(accuracy);
    }
}

function updateCoordsDisplay(lat, lon) {
    document.getElementById('coords-display').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// ==================== Rotation & Tilt ====================
function setupRotationControls() {
    const rotSlider = document.getElementById('rotation-slider');
    const tiltSlider = document.getElementById('tilt-slider');
    const rotValue = document.getElementById('rotation-value');
    const tiltValue = document.getElementById('tilt-value');

    rotSlider.addEventListener('input', () => {
        currentRotation = parseInt(rotSlider.value);
        rotValue.textContent = `${currentRotation}°`;
        applyTransform();
    });

    tiltSlider.addEventListener('input', () => {
        currentTilt = parseInt(tiltSlider.value);
        tiltValue.textContent = `${currentTilt}°`;
        applyTransform();
    });

    document.getElementById('rotate-left-btn').addEventListener('click', () => {
        currentRotation = (currentRotation - 45 + 360) % 360;
        rotSlider.value = currentRotation;
        rotValue.textContent = `${currentRotation}°`;
        applyTransform();
    });

    document.getElementById('rotate-right-btn').addEventListener('click', () => {
        currentRotation = (currentRotation + 45) % 360;
        rotSlider.value = currentRotation;
        rotValue.textContent = `${currentRotation}°`;
        applyTransform();
    });

    document.getElementById('rotate-reset-btn').addEventListener('click', () => {
        currentRotation = 0;
        currentTilt = 0;
        rotSlider.value = 0;
        tiltSlider.value = 0;
        rotValue.textContent = '0°';
        tiltValue.textContent = '0°';
        applyTransform();
    });
}

function applyTransform() {
    const wrapper = document.getElementById('map-wrapper');
    wrapper.style.transform = `rotate(${currentRotation}deg) perspective(1200px) rotateX(${currentTilt}deg)`;
}

function setupTwoFingerRotation() {
    const wrapper = document.getElementById('map-wrapper');
    let initialAngle = null;
    let initialRotation = 0;

    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            const angle = getTouchAngle(e.touches[0], e.touches[1]);
            initialAngle = angle;
            initialRotation = currentRotation;
        }
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialAngle !== null) {
            const angle = getTouchAngle(e.touches[0], e.touches[1]);
            const delta = angle - initialAngle;
            currentRotation = (initialRotation + delta + 360) % 360;
            document.getElementById('rotation-slider').value = Math.round(currentRotation);
            document.getElementById('rotation-value').textContent = `${Math.round(currentRotation)}°`;
            applyTransform();
        }
    }, { passive: true });

    wrapper.addEventListener('touchend', () => {
        initialAngle = null;
    }, { passive: true });
}

function getTouchAngle(t1, t2) {
    return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
}

// ==================== Data Fetching ====================
async function fetchDataForView() {
    if (isLoadingData) return;

    const zoom = map.getZoom();
    if (zoom < 10) return;

    const b = map.getBounds();
    const bounds = {
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
    };

    if (lastFetchBounds && boundsOverlap(lastFetchBounds, bounds) > 0.7) return;

    isLoadingData = true;
    lastFetchBounds = bounds;

    try {
        const center = { lat: (bounds.north + bounds.south) / 2, lon: (bounds.east + bounds.west) / 2 };
        const newPOIs = await DataSources.fetchAll(bounds, center);

        const existingIds = new Set(allPOIs.map(p => p.id));
        let added = 0;
        for (const poi of newPOIs) {
            if (!existingIds.has(poi.id)) {
                allPOIs.push(poi);
                existingIds.add(poi.id);
                added++;
            }
        }

        if (added > 0) renderMarkers();
        updateStats();
    } catch (e) {
        console.error('Fetch error:', e);
    }

    isLoadingData = false;
}

function boundsOverlap(a, b) {
    const overlapN = Math.min(a.north, b.north);
    const overlapS = Math.max(a.south, b.south);
    const overlapE = Math.min(a.east, b.east);
    const overlapW = Math.max(a.west, b.west);

    if (overlapN <= overlapS || overlapE <= overlapW) return 0;

    const overlapArea = (overlapN - overlapS) * (overlapE - overlapW);
    const bArea = (b.north - b.south) * (b.east - b.west);
    return overlapArea / bArea;
}

// ==================== Rendering ====================
function renderMarkers() {
    markerCluster.clearLayers();

    const markers = [];
    for (const poi of allPOIs) {
        if (!activeFilters.has(poi.category)) continue;

        const cat = CATEGORIES[poi.category] || CATEGORIES.other_misc;
        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background:${cat.color};width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);font-size:14px">${cat.icon}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
        });

        const marker = L.marker([poi.lat, poi.lon], { icon });
        marker.on('click', () => showDetail(poi));
        markers.push(marker);
    }

    markerCluster.addLayers(markers);
}

async function showDetail(poi) {
    // Dead animal check BEFORE showing details
    const analysis = DeadAnimalDetector.analyze(poi);
    if (analysis.isDead) {
        const proceed = await DeadAnimalDetector.showWarning(poi, analysis);
        if (!proceed) return; // User chose to go back
    }

    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('detail-content');

    content.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
    panel.classList.remove('hidden');

    try {
        content.innerHTML = await DetailView.render(poi);
    } catch (e) {
        content.innerHTML = `<h2>${poi.title}</h2><p>Error loading details.</p>`;
        console.error(e);
    }

    // Initialize AI Chat for this POI
    AIChat.init(poi);

    // Fly to POI
    map.flyTo([poi.lat, poi.lon], Math.max(map.getZoom(), 16), { duration: 0.5 });
}

// ==================== UI Setup ====================
function setupUI() {
    // Close detail panel
    document.getElementById('detail-close').addEventListener('click', () => {
        document.getElementById('detail-panel').classList.add('hidden');
    });

    // Filter toggle
    document.getElementById('filter-toggle').addEventListener('click', () => {
        document.getElementById('filter-panel').classList.toggle('hidden');
        buildFilterPanel();
    });

    // Legend toggle
    document.getElementById('legend-toggle').addEventListener('click', () => {
        const panel = document.getElementById('legend-panel');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) buildLegend();
    });

    // Locate button
    document.getElementById('locate-btn').addEventListener('click', () => {
        if (window.userLat !== undefined) {
            map.flyTo([window.userLat, window.userLon], 16, { duration: 0.8 });
        }
    });

    // Search
    document.getElementById('search-btn').addEventListener('click', doSearch);
    document.getElementById('search-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearch();
    });

    // Select/deselect all
    document.getElementById('select-all-btn')?.addEventListener('click', () => {
        activeFilters = new Set(Object.keys(CATEGORIES));
        buildFilterPanel();
        renderMarkers();
        updateStats();
    });
    document.getElementById('deselect-all-btn')?.addEventListener('click', () => {
        activeFilters.clear();
        buildFilterPanel();
        renderMarkers();
        updateStats();
    });

    // Reload
    document.getElementById('reload-btn')?.addEventListener('click', () => {
        lastFetchBounds = null;
        fetchDataForView();
    });

    // Close detail on map click
    map.on('click', () => {
        document.getElementById('detail-panel').classList.add('hidden');
    });
}

function buildFilterPanel() {
    const container = document.getElementById('filter-list');
    const groups = getCategoryGroups();
    const counts = getCategoryCounts();

    let html = '';
    for (const [group, cats] of Object.entries(groups)) {
        html += `<div style="margin-top:8px;font-weight:600;font-size:12px;color:#888;text-transform:uppercase">${group}</div>`;
        for (const cat of cats) {
            const checked = activeFilters.has(cat.key) ? 'checked' : '';
            const count = counts[cat.key] || 0;
            html += `
                <label class="filter-item">
                    <input type="checkbox" ${checked} data-cat="${cat.key}" />
                    <span class="filter-icon" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</span>
                    <span>${cat.label}</span>
                    <span class="filter-count">${count}</span>
                </label>`;
        }
    }
    container.innerHTML = html;

    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const cat = cb.dataset.cat;
            if (cb.checked) activeFilters.add(cat);
            else activeFilters.delete(cat);
            renderMarkers();
            updateStats();
        });
    });

    const sourceContainer = document.getElementById('source-list');
    sourceContainer.innerHTML = ['overpass', 'inaturalist', 'wikipedia'].map(s => {
        const checked = DataSources.enabledSources[s] ? 'checked' : '';
        const labels = { overpass: '🗺️ OpenStreetMap', inaturalist: '🔬 iNaturalist', wikipedia: '📖 Wikipedia' };
        return `<label class="source-item"><input type="checkbox" ${checked} data-source="${s}" /> ${labels[s]}</label>`;
    }).join('');

    sourceContainer.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', () => {
            DataSources.enabledSources[cb.dataset.source] = cb.checked;
        });
    });
}

function buildLegend() {
    const container = document.getElementById('legend-content');
    const groups = getCategoryGroups();
    let html = '';
    for (const [group, cats] of Object.entries(groups)) {
        html += `<div style="margin-top:8px;font-weight:600;font-size:11px;color:#888;text-transform:uppercase">${group}</div>`;
        for (const cat of cats) {
            html += `<div class="legend-item"><span class="legend-dot" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</span> ${cat.label}</div>`;
        }
    }
    container.innerHTML = html;
}

function getCategoryCounts() {
    const counts = {};
    for (const poi of allPOIs) {
        counts[poi.category] = (counts[poi.category] || 0) + 1;
    }
    return counts;
}

function updateStats() {
    const visible = allPOIs.filter(p => activeFilters.has(p.category)).length;
    document.getElementById('poi-count').textContent = `${visible.toLocaleString()} discoveries (${allPOIs.length} total)`;
}

function doSearch() {
    const query = document.getElementById('search-input').value.trim().toLowerCase();
    if (!query) return;

    const results = allPOIs.filter(p =>
        p.title.toLowerCase().includes(query) ||
        (p.scientificName && p.scientificName.toLowerCase().includes(query)) ||
        (p.category && CATEGORIES[p.category]?.label.toLowerCase().includes(query))
    );

    if (results.length > 0) {
        showDetail(results[0]);

        if (results.length > 1) {
            const group = L.featureGroup(results.map(r => L.marker([r.lat, r.lon])));
            map.fitBounds(group.getBounds().pad(0.1));
        }
    } else {
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`)
            .then(r => r.json())
            .then(data => {
                if (data.length > 0) {
                    map.flyTo([parseFloat(data[0].lat), parseFloat(data[0].lon)], 15);
                } else {
                    alert('No results found. Try panning the map to a new area and searching again.');
                }
            })
            .catch(() => {});
    }
}

// ==================== Map Events ====================
let moveTimeout;
function onMapMove() {
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(fetchDataForView, 800);
}

// ==================== Helpers ====================
function hideLoading(message) {
    const overlay = document.getElementById('loading-overlay');
    if (message) {
        overlay.querySelector('p').textContent = message;
        setTimeout(() => {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.style.display = 'none', 500);
        }, 2000);
    } else {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.style.display = 'none', 500);
    }
}
