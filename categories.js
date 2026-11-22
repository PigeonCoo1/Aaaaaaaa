/**
 * Explorer Map — categories.
 *
 * Every category here has at least one real data source feeding it
 * (see data-sources.js). Categories are organised into groups, which are
 * what the quick-filter chips along the top of the map toggle.
 */

const GROUPS = {
    geology:    { label: 'Rocks & Minerals',  short: 'Rocks',     icon: '💎', color: '#7c3aed' },
    landforms:  { label: 'Landforms',         short: 'Landforms', icon: '⛰️', color: '#64748b' },
    areas:      { label: 'Parks & Areas',     short: 'Areas',     icon: '🏞️', color: '#15803d' },
    water:      { label: 'Water',             short: 'Water',     icon: '💧', color: '#0284c7' },
    plants:     { label: 'Plants & Fungi',    short: 'Plants',    icon: '🌿', color: '#65a30d' },
    animals:    { label: 'Animals',           short: 'Animals',   icon: '🦊', color: '#ea580c' },
    history:    { label: 'History & Culture', short: 'History',   icon: '🏛️', color: '#a16207' },
    recreation: { label: 'Recreation',        short: 'Outdoors',  icon: '🥾', color: '#db2777' },
    amenities:  { label: 'Amenities',         short: 'Amenities', icon: '🚻', color: '#475569' },
    other:      { label: 'Other',             short: 'Other',     icon: '📌', color: '#737373' },
};

const CATEGORIES = {
    // ===== ROCKS & MINERALS =====
    geo_mineral:  { icon: '💎', label: 'Minerals & Crystals',        color: '#7c3aed', group: 'geology' },
    geo_gem:      { icon: '🔮', label: 'Gemstones, Geodes & Agates', color: '#c026d3', group: 'geology' },
    geo_fossil:   { icon: '🦴', label: 'Fossil Sites',               color: '#92400e', group: 'geology' },
    geo_mine:     { icon: '⛏️', label: 'Mines & Prospects',          color: '#b45309', group: 'geology' },
    geo_quarry:   { icon: '🧱', label: 'Quarries & Pits',            color: '#78716c', group: 'geology' },
    geo_rock:     { icon: '🪨', label: 'Rock Formations & Outcrops', color: '#57534e', group: 'geology' },
    geo_bedrock:  { icon: '🔬', label: 'Ground Scans',               color: '#4f46e5', group: 'geology' },
    geo_thermal:  { icon: '♨️', label: 'Hot Springs & Geysers',      color: '#dc2626', group: 'geology' },
    geo_volcano:  { icon: '🌋', label: 'Volcanic Features',          color: '#b91c1c', group: 'geology' },
    geo_crater:   { icon: '☄️', label: 'Impact Craters',             color: '#6d28d9', group: 'geology' },
    geo_shop:     { icon: '🛍️', label: 'Rock & Gem Shops',           color: '#9333ea', group: 'geology' },

    // ===== LANDFORMS =====
    geo_peak:     { icon: '⛰️', label: 'Peaks & Summits',            color: '#64748b', group: 'landforms' },
    geo_cliff:    { icon: '🏔️', label: 'Cliffs, Ridges & Passes',    color: '#475569', group: 'landforms' },
    geo_cave:     { icon: '🕳️', label: 'Caves & Sinkholes',          color: '#334155', group: 'landforms' },
    geo_arch:     { icon: '⛩️', label: 'Arches & Natural Bridges',   color: '#c2410c', group: 'landforms' },
    geo_valley:   { icon: '🏜️', label: 'Canyons, Valleys & Basins',  color: '#a16207', group: 'landforms' },
    geo_glacier:  { icon: '🧊', label: 'Glaciers',                   color: '#0891b2', group: 'landforms' },
    geo_island:   { icon: '🏝️', label: 'Islands',                    color: '#0d9488', group: 'landforms' },

    // ===== PARKS & AREAS =====
    rec_park:        { icon: '🌳', label: 'Parks & Gardens',            color: '#16a34a', group: 'areas' },
    area_protected:  { icon: '🛡️', label: 'Reserves & Protected Areas', color: '#15803d', group: 'areas' },
    area_forest:     { icon: '🌲', label: 'Forests & Woods',            color: '#166534', group: 'areas' },
    rec_beach:       { icon: '🏖️', label: 'Beaches',                    color: '#d97706', group: 'areas' },

    // ===== WATER =====
    water_lake:      { icon: '💧', label: 'Lakes & Ponds',      color: '#0284c7', group: 'water' },
    water_river:     { icon: '🏞️', label: 'Rivers & Streams',   color: '#0369a1', group: 'water' },
    water_spring:    { icon: '⛲', label: 'Springs',            color: '#06b6d4', group: 'water' },
    water_waterfall: { icon: '🌊', label: 'Waterfalls',         color: '#1d4ed8', group: 'water' },
    water_wetland:   { icon: '🪷', label: 'Wetlands & Marshes', color: '#0f766e', group: 'water' },

    // ===== PLANTS & FUNGI =====
    plant_flower:   { icon: '🌸', label: 'Flowering Plants',   color: '#db2777', group: 'plants' },
    plant_tree:     { icon: '🌳', label: 'Trees & Conifers',   color: '#15803d', group: 'plants' },
    plant_grass:    { icon: '🌾', label: 'Grasses & Sedges',   color: '#84cc16', group: 'plants' },
    plant_fern:     { icon: '🌱', label: 'Ferns & Mosses',     color: '#166534', group: 'plants' },
    plant_cactus:   { icon: '🌵', label: 'Cacti',              color: '#4d7c0f', group: 'plants' },
    plant_mushroom: { icon: '🍄', label: 'Fungi & Lichens',    color: '#9a3412', group: 'plants' },
    plant_other:    { icon: '🍃', label: 'Other Plants & Algae', color: '#65a30d', group: 'plants' },

    // ===== ANIMALS =====
    animal_bird:      { icon: '🐦', label: 'Birds',                  color: '#2563eb', group: 'animals' },
    animal_mammal:    { icon: '🦊', label: 'Mammals',                color: '#c2410c', group: 'animals' },
    animal_reptile:   { icon: '🦎', label: 'Reptiles',               color: '#4d7c0f', group: 'animals' },
    animal_amphibian: { icon: '🐸', label: 'Amphibians',             color: '#0f766e', group: 'animals' },
    animal_fish:      { icon: '🐟', label: 'Fish',                   color: '#0369a1', group: 'animals' },
    animal_insect:    { icon: '🦋', label: 'Butterflies & Moths',    color: '#9333ea', group: 'animals' },
    animal_beetle:    { icon: '🪲', label: 'Beetles',                color: '#713f12', group: 'animals' },
    animal_bee:       { icon: '🐝', label: 'Bees, Wasps & Ants',     color: '#ca8a04', group: 'animals' },
    animal_bug:       { icon: '🐞', label: 'Other Insects',          color: '#e11d48', group: 'animals' },
    animal_spider:    { icon: '🕷️', label: 'Spiders & Arachnids',    color: '#374151', group: 'animals' },
    animal_snail:     { icon: '🐌', label: 'Snails & Molluscs',      color: '#92400e', group: 'animals' },
    animal_worm:      { icon: '🪱', label: 'Worms',                  color: '#be123c', group: 'animals' },
    animal_marine:    { icon: '🦀', label: 'Crabs & Marine Life',    color: '#ea580c', group: 'animals' },
    animal_other:     { icon: '🐾', label: 'Other Animals',          color: '#78716c', group: 'animals' },

    // ===== HISTORY & CULTURE =====
    building_historic: { icon: '🏛️', label: 'Historic Places',       color: '#a16207', group: 'history' },
    building_monument: { icon: '🗿', label: 'Monuments & Memorials', color: '#57534e', group: 'history' },
    building_ruin:     { icon: '🏚️', label: 'Ruins & Ghost Towns',   color: '#854d0e', group: 'history' },
    other_archaeology: { icon: '⚱️', label: 'Archaeology & Rock Art', color: '#9a3412', group: 'history' },
    other_museum:      { icon: '🖼️', label: 'Museums',               color: '#7e22ce', group: 'history' },
    building_church:   { icon: '⛪', label: 'Places of Worship',     color: '#4338ca', group: 'history' },
    building_tower:    { icon: '🗼', label: 'Towers & Lighthouses',  color: '#ea580c', group: 'history' },
    building_bridge:   { icon: '🌉', label: 'Bridges',               color: '#64748b', group: 'history' },
    other_art:         { icon: '🎨', label: 'Public Art',            color: '#be185d', group: 'history' },

    // ===== RECREATION =====
    rec_viewpoint:  { icon: '🔭', label: 'Viewpoints',          color: '#1e40af', group: 'recreation' },
    rec_trail:      { icon: '🥾', label: 'Trails & Trailheads', color: '#3f6212', group: 'recreation' },
    rec_climbing:   { icon: '🧗', label: 'Climbing',            color: '#b45309', group: 'recreation' },
    rec_campsite:   { icon: '⛺', label: 'Campsites',           color: '#ea580c', group: 'recreation' },
    rec_picnic:     { icon: '🧺', label: 'Picnic Areas',        color: '#d97706', group: 'recreation' },
    rec_playground: { icon: '🎠', label: 'Playgrounds',         color: '#e11d48', group: 'recreation' },

    // ===== AMENITIES (off by default — they are everywhere) =====
    infra_fountain: { icon: '🚰', label: 'Drinking Water', color: '#0891b2', group: 'amenities' },
    infra_toilet:   { icon: '🚻', label: 'Restrooms',      color: '#475569', group: 'amenities' },
    infra_parking:  { icon: '🅿️', label: 'Parking',        color: '#1d4ed8', group: 'amenities' },
    infra_info:     { icon: 'ℹ️', label: 'Info Boards',    color: '#0369a1', group: 'amenities' },
    infra_bench:    { icon: '🪑', label: 'Benches',        color: '#78716c', group: 'amenities' },
    infra_bin:      { icon: '🗑️', label: 'Waste Bins',     color: '#52525b', group: 'amenities' },

    // ===== OTHER =====
    other_wiki: { icon: '📖', label: 'Wikipedia Articles', color: '#525252', group: 'other' },
    other_misc: { icon: '📌', label: 'Miscellaneous',      color: '#737373', group: 'other' },
};

/** Categories that are switched off the first time the app is opened. */
const DEFAULT_OFF_GROUPS = new Set(['amenities']);

/** Animal categories — used by the sensitive-content check. */
const ANIMAL_CATEGORIES = new Set(
    Object.keys(CATEGORIES).filter(k => CATEGORIES[k].group === 'animals')
);

function getCategory(key) {
    return CATEGORIES[key] || CATEGORIES.other_misc;
}

/** { groupKey: [{ key, icon, label, color, group }, ...] } in display order. */
function getCategoryGroups() {
    const groups = {};
    for (const g of Object.keys(GROUPS)) groups[g] = [];
    for (const [key, cat] of Object.entries(CATEGORIES)) {
        groups[cat.group].push({ key, ...cat });
    }
    return groups;
}

function defaultActiveCategories() {
    return Object.keys(CATEGORIES).filter(k => !DEFAULT_OFF_GROUPS.has(CATEGORIES[k].group));
}
