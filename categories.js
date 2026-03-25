/**
 * All POI categories with icons, colors, and metadata.
 * Each category maps to real data sources.
 */
const CATEGORIES = {
    // ===== PLANTS =====
    plant_tree: { icon: '🌳', label: 'Trees', color: '#2e7d32', group: 'Plants' },
    plant_flower: { icon: '🌸', label: 'Wildflowers', color: '#e91e63', group: 'Plants' },
    plant_shrub: { icon: '🌿', label: 'Shrubs & Bushes', color: '#43a047', group: 'Plants' },
    plant_grass: { icon: '🌾', label: 'Grasses & Sedges', color: '#8bc34a', group: 'Plants' },
    plant_fern: { icon: '🌱', label: 'Ferns & Mosses', color: '#1b5e20', group: 'Plants' },
    plant_vine: { icon: '🍃', label: 'Vines & Climbers', color: '#66bb6a', group: 'Plants' },
    plant_mushroom: { icon: '🍄', label: 'Fungi & Mushrooms', color: '#795548', group: 'Plants' },
    plant_cactus: { icon: '🌵', label: 'Cacti & Succulents', color: '#558b2f', group: 'Plants' },
    plant_aquatic: { icon: '🪷', label: 'Aquatic Plants', color: '#00897b', group: 'Plants' },
    plant_invasive: { icon: '⚠️', label: 'Invasive Plants', color: '#ff5722', group: 'Plants' },

    // ===== ANIMALS & INSECTS =====
    animal_bird: { icon: '🐦', label: 'Birds', color: '#1565c0', group: 'Animals' },
    animal_mammal: { icon: '🦊', label: 'Mammals', color: '#bf360c', group: 'Animals' },
    animal_reptile: { icon: '🦎', label: 'Reptiles', color: '#827717', group: 'Animals' },
    animal_amphibian: { icon: '🐸', label: 'Amphibians', color: '#00695c', group: 'Animals' },
    animal_fish: { icon: '🐟', label: 'Fish', color: '#0277bd', group: 'Animals' },
    animal_insect: { icon: '🦋', label: 'Butterflies & Moths', color: '#7b1fa2', group: 'Animals' },
    animal_beetle: { icon: '🪲', label: 'Beetles & Bugs', color: '#4e342e', group: 'Animals' },
    animal_spider: { icon: '🕷️', label: 'Spiders & Arachnids', color: '#37474f', group: 'Animals' },
    animal_bee: { icon: '🐝', label: 'Bees & Wasps', color: '#f9a825', group: 'Animals' },
    animal_ant: { icon: '🐜', label: 'Ants', color: '#5d4037', group: 'Animals' },
    animal_snail: { icon: '🐌', label: 'Snails & Slugs', color: '#6d4c41', group: 'Animals' },
    animal_worm: { icon: '🪱', label: 'Worms', color: '#8d6e63', group: 'Animals' },
    animal_marine: { icon: '🦀', label: 'Marine Life', color: '#d84315', group: 'Animals' },

    // ===== GEOLOGY =====
    geo_rock: { icon: '🪨', label: 'Rock Formations', color: '#546e7a', group: 'Geology' },
    geo_mineral: { icon: '💎', label: 'Minerals & Crystals', color: '#6a1b9a', group: 'Geology' },
    geo_fossil: { icon: '🦴', label: 'Fossils', color: '#4e342e', group: 'Geology' },
    geo_geode: { icon: '🔮', label: 'Geodes', color: '#9c27b0', group: 'Geology' },
    geo_cave: { icon: '🕳️', label: 'Caves & Caverns', color: '#263238', group: 'Geology' },
    geo_cliff: { icon: '🏔️', label: 'Cliffs & Outcrops', color: '#455a64', group: 'Geology' },
    geo_volcano: { icon: '🌋', label: 'Volcanic Features', color: '#b71c1c', group: 'Geology' },
    geo_soil: { icon: '🟤', label: 'Soil Types', color: '#6d4c41', group: 'Geology' },

    // ===== WATER =====
    water_river: { icon: '🏞️', label: 'Rivers & Streams', color: '#0288d1', group: 'Water' },
    water_lake: { icon: '💧', label: 'Lakes & Ponds', color: '#0277bd', group: 'Water' },
    water_spring: { icon: '⛲', label: 'Springs', color: '#00bcd4', group: 'Water' },
    water_waterfall: { icon: '🌊', label: 'Waterfalls', color: '#01579b', group: 'Water' },
    water_wetland: { icon: '🐊', label: 'Wetlands & Marshes', color: '#00695c', group: 'Water' },

    // ===== BUILT ENVIRONMENT =====
    building_historic: { icon: '🏛️', label: 'Historic Buildings', color: '#5d4037', group: 'Built' },
    building_monument: { icon: '🗿', label: 'Monuments & Statues', color: '#616161', group: 'Built' },
    building_bridge: { icon: '🌉', label: 'Bridges', color: '#78909c', group: 'Built' },
    building_ruin: { icon: '🏚️', label: 'Ruins', color: '#795548', group: 'Built' },
    building_church: { icon: '⛪', label: 'Churches & Temples', color: '#4527a0', group: 'Built' },
    building_tower: { icon: '🗼', label: 'Towers & Landmarks', color: '#e65100', group: 'Built' },

    // ===== RECREATION =====
    rec_trail: { icon: '🥾', label: 'Trails & Paths', color: '#33691e', group: 'Recreation' },
    rec_park: { icon: '🌲', label: 'Parks & Gardens', color: '#388e3c', group: 'Recreation' },
    rec_campsite: { icon: '⛺', label: 'Campsites', color: '#e65100', group: 'Recreation' },
    rec_viewpoint: { icon: '👁️', label: 'Viewpoints', color: '#1a237e', group: 'Recreation' },
    rec_picnic: { icon: '🧺', label: 'Picnic Areas', color: '#f57c00', group: 'Recreation' },
    rec_playground: { icon: '🎠', label: 'Playgrounds', color: '#ff8f00', group: 'Recreation' },
    rec_beach: { icon: '🏖️', label: 'Beaches', color: '#ffb300', group: 'Recreation' },

    // ===== FOOD & FORAGING =====
    food_berry: { icon: '🫐', label: 'Wild Berries', color: '#4a148c', group: 'Foraging' },
    food_herb: { icon: '🌿', label: 'Wild Herbs', color: '#2e7d32', group: 'Foraging' },
    food_nut: { icon: '🌰', label: 'Nuts & Seeds', color: '#5d4037', group: 'Foraging' },
    food_fruit: { icon: '🍎', label: 'Fruit Trees', color: '#c62828', group: 'Foraging' },

    // ===== INFRASTRUCTURE =====
    infra_bench: { icon: '🪑', label: 'Benches', color: '#6d4c41', group: 'Infrastructure' },
    infra_fountain: { icon: '🚰', label: 'Drinking Water', color: '#0097a7', group: 'Infrastructure' },
    infra_toilet: { icon: '🚻', label: 'Restrooms', color: '#455a64', group: 'Infrastructure' },
    infra_parking: { icon: '🅿️', label: 'Parking', color: '#1565c0', group: 'Infrastructure' },
    infra_info: { icon: 'ℹ️', label: 'Info Boards', color: '#0277bd', group: 'Infrastructure' },
    infra_bin: { icon: '🗑️', label: 'Waste Bins', color: '#37474f', group: 'Infrastructure' },

    // ===== HAZARDS & SAFETY =====
    hazard_cliff: { icon: '⚠️', label: 'Cliff Edge', color: '#d32f2f', group: 'Safety' },
    hazard_flood: { icon: '🌊', label: 'Flood Zone', color: '#1565c0', group: 'Safety' },
    hazard_wildlife: { icon: '🐻', label: 'Wildlife Warning', color: '#e65100', group: 'Safety' },

    // ===== OTHER =====
    other_art: { icon: '🎨', label: 'Public Art', color: '#ad1457', group: 'Other' },
    other_archaeology: { icon: '⚱️', label: 'Archaeological Sites', color: '#6d4c41', group: 'Other' },
    other_astronomy: { icon: '🔭', label: 'Stargazing Spots', color: '#1a237e', group: 'Other' },
    other_photo: { icon: '📸', label: 'Photo Spots', color: '#e91e63', group: 'Other' },
    other_geocache: { icon: '📦', label: 'Geocaches', color: '#00796b', group: 'Other' },
    other_misc: { icon: '📌', label: 'Miscellaneous', color: '#757575', group: 'Other' },
};

// Group categories for filter panel
function getCategoryGroups() {
    const groups = {};
    for (const [key, cat] of Object.entries(CATEGORIES)) {
        if (!groups[cat.group]) groups[cat.group] = [];
        groups[cat.group].push({ key, ...cat });
    }
    return groups;
}
