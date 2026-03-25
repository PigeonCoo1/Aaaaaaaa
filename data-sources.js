/**
 * Data fetching from real APIs:
 * - OpenStreetMap Overpass API (real-world POIs)
 * - iNaturalist API (real nature observations)
 * - Wikipedia/Wikidata (nearby articles)
 */

const DataSources = {
    enabledSources: {
        overpass: true,
        inaturalist: true,
        wikipedia: true,
    },

    /**
     * Fetch all data sources for a bounding box
     */
    async fetchAll(bounds, center) {
        const results = [];
        const promises = [];

        if (this.enabledSources.overpass) {
            promises.push(
                this.fetchOverpass(bounds)
                    .then(r => results.push(...r))
                    .catch(e => console.warn('Overpass error:', e))
            );
        }
        if (this.enabledSources.inaturalist) {
            promises.push(
                this.fetchINaturalist(bounds)
                    .then(r => results.push(...r))
                    .catch(e => console.warn('iNaturalist error:', e))
            );
        }
        if (this.enabledSources.wikipedia) {
            promises.push(
                this.fetchWikipedia(center)
                    .then(r => results.push(...r))
                    .catch(e => console.warn('Wikipedia error:', e))
            );
        }

        await Promise.allSettled(promises);
        return results;
    },

    /**
     * OpenStreetMap Overpass API - fetches real POIs
     */
    async fetchOverpass(bounds) {
        const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

        // Query for many types of real-world features
        const query = `
[out:json][timeout:30];
(
  // Nature
  node["natural"](${bbox});
  way["natural"](${bbox});
  node["geological"](${bbox});
  way["geological"](${bbox});

  // Trees
  node["natural"="tree"](${bbox});

  // Water
  node["natural"="spring"](${bbox});
  node["natural"="hot_spring"](${bbox});
  node["amenity"="fountain"](${bbox});
  node["waterway"="waterfall"](${bbox});

  // Historic & archaeology
  node["historic"](${bbox});
  way["historic"](${bbox});
  node["archaeological_site"](${bbox});

  // Tourism & recreation
  node["tourism"](${bbox});
  way["tourism"](${bbox});
  node["leisure"="park"](${bbox});
  way["leisure"="park"](${bbox});
  node["leisure"="nature_reserve"](${bbox});
  way["leisure"="nature_reserve"](${bbox});
  node["leisure"="playground"](${bbox});
  node["leisure"="picnic_table"](${bbox});
  node["leisure"="bird_hide"](${bbox});

  // Amenities
  node["amenity"="bench"](${bbox});
  node["amenity"="drinking_water"](${bbox});
  node["amenity"="toilets"](${bbox});
  node["amenity"="waste_basket"](${bbox});
  node["amenity"="parking"](${bbox});
  node["amenity"="place_of_worship"](${bbox});

  // Info & art
  node["information"](${bbox});
  node["tourism"="artwork"](${bbox});
  node["tourism"="viewpoint"](${bbox});

  // Geology specific
  node["natural"="rock"](${bbox});
  node["natural"="stone"](${bbox});
  node["natural"="cave_entrance"](${bbox});
  node["natural"="cliff"](${bbox});
  node["natural"="peak"](${bbox});
  node["natural"="volcano"](${bbox});
  node["natural"="saddle"](${bbox});
  node["natural"="ridge"](${bbox});

  // Bridges, towers
  node["man_made"="tower"](${bbox});
  node["man_made"="lighthouse"](${bbox});
  node["bridge"](${bbox});
);
out center body 500;
`;

        const resp = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
        const data = await resp.json();

        return data.elements
            .filter(el => el.lat || (el.center && el.center.lat))
            .map(el => this.parseOverpassElement(el));
    },

    parseOverpassElement(el) {
        const lat = el.lat || el.center.lat;
        const lon = el.lon || el.center.lon;
        const tags = el.tags || {};
        const name = tags.name || tags['name:en'] || '';

        // Determine category
        let category = 'other_misc';
        let title = name;

        // Natural features
        if (tags.natural === 'tree') {
            category = 'plant_tree';
            title = name || tags['species'] || tags['genus'] || tags['leaf_type'] || 'Tree';
        } else if (tags.natural === 'wood' || tags.natural === 'tree_row') {
            category = 'plant_tree';
            title = name || 'Woodland';
        } else if (tags.natural === 'scrub' || tags.natural === 'heath') {
            category = 'plant_shrub';
            title = name || 'Scrubland';
        } else if (tags.natural === 'grassland') {
            category = 'plant_grass';
            title = name || 'Grassland';
        } else if (tags.natural === 'wetland') {
            category = 'water_wetland';
            title = name || 'Wetland';
        } else if (tags.natural === 'water' || tags.natural === 'lake') {
            category = 'water_lake';
            title = name || 'Lake/Pond';
        } else if (tags.natural === 'spring' || tags.natural === 'hot_spring') {
            category = 'water_spring';
            title = name || (tags.natural === 'hot_spring' ? 'Hot Spring' : 'Spring');
        } else if (tags.waterway === 'waterfall') {
            category = 'water_waterfall';
            title = name || 'Waterfall';
        } else if (tags.natural === 'rock' || tags.natural === 'stone' || tags.natural === 'bare_rock') {
            category = 'geo_rock';
            title = name || 'Rock Formation';
        } else if (tags.natural === 'cave_entrance') {
            category = 'geo_cave';
            title = name || 'Cave Entrance';
        } else if (tags.natural === 'cliff') {
            category = 'geo_cliff';
            title = name || 'Cliff';
        } else if (tags.natural === 'peak' || tags.natural === 'ridge' || tags.natural === 'saddle') {
            category = 'geo_cliff';
            title = name || tags.natural.charAt(0).toUpperCase() + tags.natural.slice(1);
        } else if (tags.natural === 'volcano') {
            category = 'geo_volcano';
            title = name || 'Volcano';
        } else if (tags.natural === 'beach') {
            category = 'rec_beach';
            title = name || 'Beach';
        } else if (tags.geological) {
            if (tags.geological === 'moraine' || tags.geological === 'outcrop') {
                category = 'geo_rock';
            } else if (tags.geological === 'palaeontological_site') {
                category = 'geo_fossil';
            } else {
                category = 'geo_mineral';
            }
            title = name || `Geological: ${tags.geological}`;
        }

        // Historic
        if (tags.historic) {
            if (tags.historic === 'archaeological_site') {
                category = 'other_archaeology';
            } else if (tags.historic === 'ruins') {
                category = 'building_ruin';
            } else if (tags.historic === 'monument' || tags.historic === 'memorial') {
                category = 'building_monument';
            } else if (tags.historic === 'castle') {
                category = 'building_historic';
            } else {
                category = 'building_historic';
            }
            title = name || `Historic: ${tags.historic}`;
        }

        // Tourism
        if (tags.tourism === 'viewpoint') {
            category = 'rec_viewpoint';
            title = name || 'Viewpoint';
        } else if (tags.tourism === 'camp_site') {
            category = 'rec_campsite';
            title = name || 'Campsite';
        } else if (tags.tourism === 'picnic_site' || tags.leisure === 'picnic_table') {
            category = 'rec_picnic';
            title = name || 'Picnic Area';
        } else if (tags.tourism === 'artwork') {
            category = 'other_art';
            title = name || 'Public Art';
        } else if (tags.tourism === 'information') {
            category = 'infra_info';
            title = name || 'Information';
        }

        // Leisure
        if (tags.leisure === 'park') {
            category = 'rec_park';
            title = name || 'Park';
        } else if (tags.leisure === 'nature_reserve') {
            category = 'rec_park';
            title = name || 'Nature Reserve';
        } else if (tags.leisure === 'playground') {
            category = 'rec_playground';
            title = name || 'Playground';
        } else if (tags.leisure === 'bird_hide') {
            category = 'animal_bird';
            title = name || 'Bird Hide';
        }

        // Amenities
        if (tags.amenity === 'bench') {
            category = 'infra_bench';
            title = 'Bench';
        } else if (tags.amenity === 'drinking_water') {
            category = 'infra_fountain';
            title = name || 'Drinking Water';
        } else if (tags.amenity === 'toilets') {
            category = 'infra_toilet';
            title = name || 'Restrooms';
        } else if (tags.amenity === 'waste_basket') {
            category = 'infra_bin';
            title = 'Waste Bin';
        } else if (tags.amenity === 'parking') {
            category = 'infra_parking';
            title = name || 'Parking';
        } else if (tags.amenity === 'place_of_worship') {
            category = 'building_church';
            title = name || 'Place of Worship';
        }

        // Man-made
        if (tags.man_made === 'tower' || tags.man_made === 'lighthouse') {
            category = 'building_tower';
            title = name || (tags.man_made === 'lighthouse' ? 'Lighthouse' : 'Tower');
        }

        return {
            id: `osm_${el.id}`,
            lat, lon,
            category,
            title: title || 'Unknown Feature',
            source: 'OpenStreetMap',
            sourceIcon: '🗺️',
            tags,
            osmId: el.id,
            osmType: el.type,
        };
    },

    /**
     * iNaturalist API - real nature observations
     */
    async fetchINaturalist(bounds) {
        const params = new URLSearchParams({
            nelat: bounds.north,
            nelng: bounds.east,
            swlat: bounds.south,
            swlng: bounds.west,
            quality_grade: 'research,needs_id',
            per_page: '200',
            order_by: 'observed_on',
            photos: 'true',
        });

        const resp = await fetch(`https://api.inaturalist.org/v1/observations?${params}`);
        if (!resp.ok) throw new Error(`iNaturalist HTTP ${resp.status}`);
        const data = await resp.json();

        return (data.results || [])
            .filter(obs => obs.geojson && obs.geojson.coordinates)
            .map(obs => this.parseINaturalistObs(obs));
    },

    parseINaturalistObs(obs) {
        const [lon, lat] = obs.geojson.coordinates;
        const taxon = obs.taxon || {};
        const name = taxon.preferred_common_name || taxon.name || 'Unknown Organism';
        const iconicTaxon = taxon.iconic_taxon_name || '';

        // Map iNaturalist iconic taxons to our categories
        let category = 'other_misc';
        switch (iconicTaxon) {
            case 'Plantae':
                if (taxon.name && /fern|pterid/i.test(taxon.name)) category = 'plant_fern';
                else if (taxon.name && /fungi|mushroom/i.test(taxon.name)) category = 'plant_mushroom';
                else if (taxon.rank === 'species' && taxon.ancestor_ids && taxon.ancestor_ids.length > 10) category = 'plant_flower';
                else category = 'plant_flower';
                break;
            case 'Fungi':
                category = 'plant_mushroom';
                break;
            case 'Aves':
                category = 'animal_bird';
                break;
            case 'Mammalia':
                category = 'animal_mammal';
                break;
            case 'Reptilia':
                category = 'animal_reptile';
                break;
            case 'Amphibia':
                category = 'animal_amphibian';
                break;
            case 'Actinopterygii':
            case 'Animalia':
                category = 'animal_fish';
                break;
            case 'Insecta':
                if (taxon.name && /lepidoptera|butterfly|moth/i.test(taxon.name)) category = 'animal_insect';
                else if (taxon.name && /coleoptera|beetle/i.test(taxon.name)) category = 'animal_beetle';
                else if (taxon.name && /hymenoptera|bee|wasp/i.test(taxon.name)) category = 'animal_bee';
                else if (taxon.name && /formicidae|ant/i.test(taxon.name)) category = 'animal_ant';
                else category = 'animal_beetle';
                break;
            case 'Arachnida':
                category = 'animal_spider';
                break;
            case 'Mollusca':
                category = 'animal_snail';
                break;
            default:
                if (iconicTaxon === 'Chromista' || iconicTaxon === 'Protozoa') category = 'other_misc';
                else category = 'other_misc';
        }

        const photos = (obs.photos || []).map(p => {
            const url = p.url || '';
            return url.replace('square', 'medium');
        });

        return {
            id: `inat_${obs.id}`,
            lat, lon,
            category,
            title: name,
            source: 'iNaturalist',
            sourceIcon: '🔬',
            scientificName: taxon.name,
            commonName: taxon.preferred_common_name,
            taxonRank: taxon.rank,
            iconicTaxon,
            observedOn: obs.observed_on,
            qualityGrade: obs.quality_grade,
            photos,
            observerLogin: obs.user ? obs.user.login : null,
            inatUrl: obs.uri,
            description: obs.description,
            placeGuess: obs.place_guess,
            numIdentifications: obs.identifications_count,
            numComments: obs.comments_count,
            taxonId: taxon.id,
            wikipediaUrl: taxon.wikipedia_url,
            conservationStatus: taxon.conservation_status,
            ancestorIds: taxon.ancestor_ids,
        };
    },

    /**
     * Wikipedia geosearch - nearby articles
     */
    async fetchWikipedia(center) {
        const params = new URLSearchParams({
            action: 'query',
            list: 'geosearch',
            gscoord: `${center.lat}|${center.lon}`,
            gsradius: '10000',
            gslimit: '50',
            format: 'json',
            origin: '*',
        });

        const resp = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
        if (!resp.ok) throw new Error(`Wikipedia HTTP ${resp.status}`);
        const data = await resp.json();

        return (data.query?.geosearch || []).map(article => ({
            id: `wiki_${article.pageid}`,
            lat: article.lat,
            lon: article.lon,
            category: 'infra_info',
            title: article.title,
            source: 'Wikipedia',
            sourceIcon: '📖',
            wikiPageId: article.pageid,
            distance: article.dist,
        }));
    },

    /**
     * Fetch extended Wikipedia article info
     */
    async fetchWikiArticle(pageId) {
        const params = new URLSearchParams({
            action: 'query',
            pageids: pageId,
            prop: 'extracts|pageimages|info|categories',
            exintro: '1',
            explaintext: '1',
            piprop: 'thumbnail',
            pithumbsize: '500',
            inprop: 'url',
            format: 'json',
            origin: '*',
        });

        const resp = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        const pages = data.query?.pages || {};
        return Object.values(pages)[0] || null;
    },

    /**
     * Fetch more iNaturalist taxon details
     */
    async fetchTaxonDetails(taxonId) {
        if (!taxonId) return null;
        const resp = await fetch(`https://api.inaturalist.org/v1/taxa/${taxonId}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.results?.[0] || null;
    },
};
