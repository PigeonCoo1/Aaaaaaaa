/**
 * Explorer Map — the detail panel for one discovery.
 *
 * render(poi) returns the HTML for everything that is known immediately;
 * hydrate(poi, root) then fills in the parts that need another lookup
 * (species info, Wikipedia summary, full mineral record, soil, elevation …).
 * The same lookups feed the AI chat via extras(poi), so nothing is fetched twice.
 */

const DetailView = {
    // ------------------------------------------------------------------
    // Extra lookups (cached on the POI)
    // ------------------------------------------------------------------
    extras(poi) {
        if (poi._x) return poi._x;
        const x = poi._x = {};
        poi._xv = {};
        const keep = (name, promise) => {
            x[name] = promise.then(v => { poi._xv[name] = v; return v; }).catch(() => null);
        };

        if (poi.taxonId) keep('taxon', DataSources.fetchTaxonDetails(poi.taxonId));
        if (poi.depId) keep('mrds', DataSources.fetchMRDSDetail(poi.depId));
        if (poi.isScan) {
            keep('soil', DataSources.fetchSoil(poi.lat, poi.lon));
            keep('elevation', DataSources.fetchElevation(poi.lat, poi.lon));
        }

        const wikiQuery = this.wikiQueryFor(poi);
        if (wikiQuery) keep('wiki', DataSources.fetchWikiArticle(wikiQuery).then(a => this.checkWikiMatch(a, wikiQuery)));
        return x;
    },

    /** Which Wikipedia article (if any) describes this POI. */
    wikiQueryFor(poi) {
        if (poi.wikiPageId) return { pageId: poi.wikiPageId };
        if (poi.wikiTitle) return { title: poi.wikiTitle };
        const tag = poi.tags && poi.tags.wikipedia;
        if (tag) {
            const m = /^([a-z-]+):(.+)$/.exec(tag);
            if (m && m[1] === 'en') return { title: m[2] };
            if (!m) return { title: tag };
            return null;                         // an article in another language: just link to it
        }
        if (poi.sourceId === 'inat') {
            const m = /\/wiki\/(.+)$/.exec(poi.wikipediaUrl || '');
            if (m) return { title: decodeURIComponent(m[1]).replace(/_/g, ' ') };
            if (poi.scientificName) return { search: poi.scientificName, mustMention: poi.scientificName.split(' ')[0] };
        }
        if (poi.sourceId === 'pbdb' && poi.formation) {
            return { search: `${poi.formation} Formation`, mustMention: poi.formation.split(' ')[0] };
        }
        if (poi.isScan && poi.units && poi.units[0] && poi.units[0].stratName) {
            const s = poi.units[0].stratName;
            return { search: `${s} geology`, mustMention: s.split(' ')[0] };
        }
        return null;
    },

    /** A search hit only counts if it is clearly about the same thing. */
    checkWikiMatch(article, query) {
        if (!article) return null;
        if (query.mustMention && !article.title.toLowerCase().includes(query.mustMention.toLowerCase())) return null;
        return article;
    },

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    render(poi) {
        const E = Util.esc;
        const cat = getCategory(poi.category);
        const group = GROUPS[cat.group];
        let h = '';

        // ----- Header -----
        h += `<header class="d-head">`;
        h += `<div class="d-icon" style="background:${cat.color}">${cat.icon}</div>`;
        h += `<div class="d-titles"><h2 id="detail-title">${E(poi.title)}</h2>`;
        const sub = [poi.subtitle, cat.label].filter(Boolean);
        h += `<p class="d-sub">${E([...new Set(sub)].join(' · '))}</p></div></header>`;

        // ----- Badges -----
        const badges = [];
        const dist = Util.fromUser(poi);
        if (dist) badges.push(`<span class="badge badge-strong">📍 ${E(dist)} from you</span>`);
        badges.push(`<span class="badge" style="--b:${group.color}">${group.icon} ${E(group.label)}</span>`);
        badges.push(`<span class="badge">${poi.sourceIcon || ''} ${E(poi.source)}</span>`);
        if (poi.qualityGrade) {
            badges.push(`<span class="badge ${poi.qualityGrade === 'research' ? 'badge-good' : 'badge-warn'}">${poi.qualityGrade === 'research' ? '✓ Research grade' : 'Needs ID'}</span>`);
        }
        if (poi.threatened) badges.push(`<span class="badge badge-warn">⚠️ Threatened species</span>`);
        if (poi.introduced) badges.push(`<span class="badge badge-warn">Introduced here</span>`);
        if (poi.devStat) badges.push(`<span class="badge">${E(poi.devStat)}</span>`);
        if (poi.ageLabel) badges.push(`<span class="badge">🕰️ ${E(poi.ageLabel)}</span>`);
        h += `<div class="d-badges">${badges.join('')}</div>`;

        // ----- Actions -----
        const saved = typeof Favorites !== 'undefined' && Favorites.has(poi.id);
        h += `<div class="d-actions">`;
        h += `<a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lon}" target="_blank" rel="noopener">🧭 Directions</a>`;
        h += `<button class="btn" type="button" data-action="save" aria-pressed="${saved}">${saved ? '★ Saved' : '☆ Save'}</button>`;
        h += `<button class="btn" type="button" data-action="share">↗ Share</button>`;
        if (!poi.isScan) h += `<button class="btn" type="button" data-action="scan" title="What rock and soil is under this spot?">🔬 Scan ground</button>`;
        h += `</div>`;

        // ----- Photos -----
        const photos = (poi.photos || []).map(Util.safeUrl).filter(Boolean).slice(0, 8);
        const tagImage = poi.tags && Util.safeUrl(poi.tags.image);
        if (tagImage && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(tagImage)) photos.push(tagImage);
        h += `<div data-slot="gallery">${this.gallery(photos, poi.title)}</div>`;

        if (poi.obscured) {
            h += `<p class="note">The exact spot is hidden to protect this species — the pin is only approximate.</p>`;
        }

        // ----- Source-specific body -----
        switch (poi.sourceId) {
            case 'inat': h += this.renderINaturalist(poi); break;
            case 'osm': h += this.renderOSM(poi); break;
            case 'mrds': h += this.renderMRDS(poi); break;
            case 'pbdb': h += this.renderPBDB(poi); break;
            case 'scan': h += this.renderScan(poi); break;
            default: h += this.renderGeneric(poi);
        }

        if (cat.group === 'geology' && !['geo_shop', 'geo_bedrock'].includes(poi.category)) {
            h += `<p class="note">🪨 <strong>Before you collect:</strong> check who owns the land and what the rules are — many mines are private or unsafe, and parks, monuments and reserves usually forbid taking rocks, minerals or fossils.</p>`;
        }

        // ----- Location -----
        h += `<section class="d-section"><h3>Location</h3>`;
        h += `<button class="coords" type="button" data-action="copy-coords" title="Copy coordinates">${poi.lat.toFixed(5)}, ${poi.lon.toFixed(5)} <span aria-hidden="true">⧉</span></button>`;
        if (poi.placeGuess) h += `<p>${E(poi.placeGuess)}</p>`;
        h += `</section>`;

        // ----- Links -----
        h += `<section class="d-section"><h3>More information</h3><div class="d-links" data-slot="links">${this.links(poi)}</div></section>`;
        return h;
    },

    gallery(urls, alt) {
        if (!urls.length) return '';
        const E = Util.esc;
        return `<div class="gallery${urls.length === 1 ? ' gallery-single' : ''}">` +
            urls.map(u => `<a href="${E(u)}" target="_blank" rel="noopener"><img src="${E(u)}" alt="${E(alt || 'Photo')}" loading="lazy" referrerpolicy="no-referrer"></a>`).join('') +
            `</div>`;
    },

    grid(items) {
        const rows = items.filter(i => i && i[1] !== undefined && i[1] !== null && i[1] !== '');
        if (!rows.length) return '';
        return `<dl class="d-grid">` + rows.map(([label, value]) =>
            `<div><dt>${Util.esc(label)}</dt><dd>${Util.esc(value)}</dd></div>`).join('') + `</dl>`;
    },

    chips(list, hrefFn) {
        const E = Util.esc;
        return `<div class="chips">` + list.map(item => {
            const href = hrefFn ? hrefFn(item) : '';
            return href
                ? `<a class="chip" href="${E(href)}" target="_blank" rel="noopener">${E(item)}</a>`
                : `<span class="chip">${E(item)}</span>`;
        }).join('') + `</div>`;
    },

    mindatSearch(term) {
        return `https://www.mindat.org/search.php?search=${encodeURIComponent(term)}`;
    },

    links(poi) {
        const E = Util.esc;
        const out = [];
        const add = (href, label) => { const u = Util.safeUrl(href); if (u) out.push(`<a href="${E(u)}" target="_blank" rel="noopener">${label}</a>`); };
        const grp = getCategory(poi.category).group;

        add(poi.inatUrl, '🔬 iNaturalist observation');
        add(poi.usgsUrl, '⛏️ USGS mineral record');
        if (poi.collectionNo) add(`https://paleobiodb.org/classic/basicCollectionSearch?collection_no=${poi.collectionNo}`, '🦴 Paleobiology Database');
        if (poi.mindatId) add(`https://www.mindat.org/loc-${encodeURIComponent(poi.mindatId)}.html`, '💎 Mindat locality');
        add(poi.wikipediaUrl, '📖 Wikipedia');
        if (poi.tags && poi.tags.wikipedia && !poi.wikipediaUrl) {
            const m = /^([a-z-]+):(.+)$/.exec(poi.tags.wikipedia);
            add(`https://${m ? m[1] : 'en'}.wikipedia.org/wiki/${encodeURIComponent((m ? m[2] : poi.tags.wikipedia).replace(/ /g, '_'))}`, '📖 Wikipedia');
        }
        if (poi.tags && poi.tags.website) add(poi.tags.website, '🌐 Website');
        if (poi.qid) add(`https://www.wikidata.org/wiki/${poi.qid}`, '🧭 Wikidata');
        if (poi.osmId) add(`https://www.openstreetmap.org/${poi.osmType || 'node'}/${poi.osmId}`, '🗺️ OpenStreetMap');
        if (poi.isScan) add(`https://macrostrat.org/map/loc/${poi.lon.toFixed(4)}/${poi.lat.toFixed(4)}#x=${poi.lon.toFixed(4)}&y=${poi.lat.toFixed(4)}&z=11`, '🧱 Macrostrat geologic map');
        if (grp === 'geology' && poi.named !== false && !poi.isScan && !poi.mindatId) {
            add(this.mindatSearch(poi.title), '💎 Search Mindat');
        }
        add(`https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lon}`, '🌍 Google Maps');
        const q = [poi.title, poi.scientificName && poi.scientificName !== poi.title ? poi.scientificName : '', poi.placeGuess || poi.state || ''].filter(Boolean).join(' ');
        add(`https://www.google.com/search?q=${encodeURIComponent(q)}`, '🔎 Web search');
        return out.join('');
    },

    // ------------------------------------------------------------------
    // iNaturalist
    // ------------------------------------------------------------------
    renderINaturalist(poi) {
        const E = Util.esc;
        let h = `<section class="d-section"><h3>Observation</h3>`;
        const when = poi.observedOn ? `${poi.observedOn} (${Util.daysAgoText(poi.observedOn)})` : '';
        h += this.grid([
            ['Scientific name', poi.scientificName],
            ['Common name', poi.commonName],
            ['Rank', poi.taxonRank],
            ['Observed', when],
            ['Observer', poi.observerLogin],
            ['Identifications', poi.numIdentifications],
        ]);
        if (poi.description) h += `<p class="quote">${E(Util.plain(poi.description))}</p>`;
        if (poi.conservationStatus) {
            const cs = poi.conservationStatus;
            h += `<p class="note note-warn"><strong>Conservation status:</strong> ${E(cs.status_name || cs.status || 'listed')}${cs.authority ? ` (${E(cs.authority)})` : ''}</p>`;
        }
        h += `</section>`;
        h += `<div data-slot="taxon"><section class="d-section"><h3>About this species</h3>${this.skeleton()}</section></div>`;
        return h;
    },

    renderTaxon(taxon) {
        if (!taxon) return '';
        const E = Util.esc;
        let h = `<section class="d-section"><h3>About this ${E(taxon.rank || 'species')}</h3>`;
        const summary = Util.plain(taxon.wikipedia_summary);
        if (summary) h += `<p>${E(summary)}</p>`;
        h += this.grid([
            ['Observations worldwide', taxon.observations_count ? taxon.observations_count.toLocaleString() : ''],
            ['Extinct', taxon.extinct ? 'Yes' : ''],
        ]);
        const lineage = (taxon.ancestors || []).filter(a => a.rank && a.name && !/^(sub|super|infra|epi|zoo)/.test(a.rank) && a.rank !== 'stateofmatter');
        if (lineage.length) {
            h += `<details class="d-more"><summary>Classification</summary><ol class="lineage">`;
            for (const a of lineage) {
                h += `<li><span>${E(a.rank)}</span> ${E(a.preferred_common_name || a.name)}${a.preferred_common_name ? ` <em>${E(a.name)}</em>` : ''}</li>`;
            }
            h += `</ol></details>`;
        }
        const statuses = (taxon.conservation_statuses || []).slice(0, 8);
        if (statuses.length) {
            h += `<details class="d-more"><summary>Conservation statuses (${statuses.length})</summary><ul>`;
            for (const cs of statuses) {
                h += `<li>${E(cs.status_name || cs.status)}${cs.authority ? ` — ${E(cs.authority)}` : ''}${cs.place ? `, ${E(cs.place.display_name)}` : ''}</li>`;
            }
            h += `</ul></details>`;
        }
        const refPhotos = (taxon.taxon_photos || []).map(tp => Util.safeUrl(tp.photo && (tp.photo.medium_url || tp.photo.url))).filter(Boolean).slice(0, 6);
        if (refPhotos.length) h += `<h4>Reference photos</h4>${this.gallery(refPhotos, taxon.name)}`;
        h += `</section>`;
        return h;
    },

    // ------------------------------------------------------------------
    // OpenStreetMap
    // ------------------------------------------------------------------
    OSM_LABELS: {
        ele: 'Elevation', description: 'Description', species: 'Species', 'species:en': 'Species', genus: 'Genus',
        leaf_type: 'Leaf type', leaf_cycle: 'Leaf cycle', height: 'Height', circumference: 'Trunk circumference',
        resource: 'Resource', rock: 'Rock type', geological: 'Geological feature', surface: 'Surface',
        material: 'Material', start_date: 'Date', year: 'Year', architect: 'Architect', artist_name: 'Artist',
        inscription: 'Inscription', heritage: 'Heritage level', protection_title: 'Protection', protect_class: 'Protection class',
        operator: 'Managed by', access: 'Access', fee: 'Fee', opening_hours: 'Opening hours', wheelchair: 'Wheelchair access',
        dog: 'Dogs', phone: 'Phone', 'contact:phone': 'Phone', climbing: 'Climbing', 'climbing:rock': 'Rock type',
        'climbing:grade:yds_class': 'Climbing grade', sport: 'Sport', site_type: 'Site type', historic: 'Historic type',
        'historic:civilization': 'Civilization', ruins: 'Ruins of', memorial: 'Memorial type', denomination: 'Denomination',
        religion: 'Religion', water: 'Water type', intermittent: 'Seasonal', salt: 'Salt water', drinking_water: 'Drinkable',
        'cave:length': 'Cave length', depth: 'Depth', length: 'Length', width: 'Width', disused: 'Disused', abandoned: 'Abandoned',
        capacity: 'Capacity', tents: 'Tents', caravans: 'Caravans', toilets: 'Toilets', shelter: 'Shelter', backrest: 'Backrest',
        direction: 'Faces', alt_name: 'Also known as', old_name: 'Formerly', loc_name: 'Local name', 'name:en': 'English name',
        'addr:city': 'Town', 'addr:street': 'Street',
    },

    renderOSM(poi) {
        const tags = poi.tags || {};
        const rows = [];
        for (const [key, label] of Object.entries(this.OSM_LABELS)) {
            if (!tags[key]) continue;
            if (key === 'name:en' && tags[key] === poi.title) continue;
            let val = tags[key];
            if (key === 'ele') val = Util.elevationText(parseFloat(val)) || val;
            else if (val === 'yes') val = 'Yes'; else if (val === 'no') val = 'No';
            else if (!/[A-Z]/.test(val) && key !== 'opening_hours' && key !== 'phone') val = DataSources.humanize(val);
            rows.push([label, val]);
        }
        let h = '';
        h += `<div data-slot="wiki"></div>`;
        if (rows.length) h += `<section class="d-section"><h3>Details</h3>${this.grid(rows)}</section>`;
        else if (!tags.wikipedia) {
            h += `<section class="d-section"><p class="muted">OpenStreetMap only has the location for this one — ask the AI below, or scan the ground to see what rock it sits on.</p></section>`;
        }
        return h;
    },

    // ------------------------------------------------------------------
    // USGS mineral sites
    // ------------------------------------------------------------------
    renderMRDS(poi) {
        let h = `<section class="d-section"><h3>What's here</h3>`;
        if (poi.commodities.length) h += this.chips(poi.commodities, c => this.mindatSearch(c.split(/[,(-]/)[0].trim()));
        else h += `<p class="muted">No commodity recorded.</p>`;
        h += `</section>`;
        h += `<div data-slot="mrds"><section class="d-section"><h3>Site record</h3>${this.skeleton()}</section></div>`;
        return h;
    },

    renderMRDSDetail(p, poi) {
        if (!p) return `<section class="d-section"><p class="muted">The full USGS record could not be loaded — use the USGS link below.</p></section>`;
        const E = Util.esc, A = Util.arr;
        const dep = p.deposits || {};
        const loc = A(p.location)[0] || {};
        let h = '';

        const materials = A(p.material);
        const ore = [...new Set(materials.filter(m => /ore/i.test(m.ore_gangue || '')).map(m => m.material).filter(Boolean))];
        const gangue = [...new Set(materials.filter(m => /gangue/i.test(m.ore_gangue || '')).map(m => m.material).filter(Boolean))];
        if (ore.length || gangue.length) {
            h += `<section class="d-section"><h3>Minerals reported</h3>`;
            if (ore.length) h += `<h4>Ore minerals</h4>${this.chips(ore, m => this.mindatSearch(m))}`;
            if (gangue.length) h += `<h4>Other minerals</h4>${this.chips(gangue, m => this.mindatSearch(m))}`;
            h += `<p class="hint">Tap a mineral to look it up on Mindat.</p></section>`;
        }

        const commodities = A(p.commodity).map(c => `${c.commod}${c.import ? ` (${String(c.import).toLowerCase()})` : ''}`);
        const rocks = A(p.rock).map(r => {
            const name = r.rocku || r.rock_desc || r.low_name || r.third_ord_nm || r.second_ord_nm || r.first_ord_nm;
            const age = A(r.ages)[0];
            return name ? `${name}${r.rock_cls ? ` — ${String(r.rock_cls).toLowerCase()}` : ''}${age && age.age_young ? `, ${age.age_young}` : ''}` : '';
        }).filter(Boolean);
        const workings = A(p.workings).map(w => w.wrk_tp).filter(Boolean);
        const names = A(p.name).filter(n => n.status !== 'Current').map(n => n.name);

        h += `<section class="d-section"><h3>Site record</h3>`;
        h += this.grid([
            ['Status', dep.dev_st],
            ['Deposit type', dep.dep_tp || (A(p.model_type)[0] || {}).model_name],
            ['Operation', dep.oper_tp && dep.oper_tp !== 'Unknown' ? dep.oper_tp : ''],
            ['Discovered', dep.disc_yr],
            ['Commodities', commodities.join(', ')],
            ['Ore body shape', A(p.orebody).map(o => Util.titleCase(o.form)).filter(Boolean).join(', ')],
            ['Workings', workings.join(', ')],
            ['Mining district', A(p.districts).map(d => d.district).filter(Boolean).join(', ')],
            ['Place', [loc.county, loc.state_prov, loc.country].filter(Boolean).join(', ')],
            ['Land status', (A(p.land_status)[0] || {}).land_st],
            ['Also known as', [...new Set(names)].slice(0, 4).join('; ')],
        ]);
        if (rocks.length) h += `<h4>Host rock</h4><ul>${[...new Set(rocks)].slice(0, 6).map(r => `<li>${E(r)}</li>`).join('')}</ul>`;
        const alteration = A(p.alteration).map(a => a.alterat_text).filter(Boolean)[0];
        if (alteration) h += `<h4>Alteration</h4><p>${E(alteration)}</p>`;
        const comments = A(p.comment).filter(c => c.cmt_txt && !/^location$/i.test(c.ctg || '')).slice(0, 4);
        if (comments.length) {
            h += `<details class="d-more"><summary>Geologist's notes</summary>`;
            for (const c of comments) h += `<p><strong>${E(c.ctg || 'Note')}:</strong> ${E(c.cmt_txt.slice(0, 900))}${c.cmt_txt.length > 900 ? '…' : ''}</p>`;
            h += `</details>`;
        }
        h += `<p class="hint">Data quality grade ${E(p.grade || '?')} (A = best). MRDS records are historical and no longer updated.</p>`;
        h += `</section>`;
        return h;
    },

    // ------------------------------------------------------------------
    // Fossil sites
    // ------------------------------------------------------------------
    renderPBDB(poi) {
        const E = Util.esc;
        let h = `<section class="d-section"><h3>Fossils found here (${poi.taxa.length})</h3>`;
        const groups = new Map();
        for (const t of poi.taxa) {
            const key = [t.phylum, t.cls].filter(Boolean).join(' › ') || 'Unclassified';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(t.name);
        }
        for (const [key, names] of groups) {
            h += `<h4>${E(key)}</h4>${this.chips(names.slice(0, 40), n => `https://paleobiodb.org/classic/basicTaxonInfo?taxon_name=${encodeURIComponent(n)}`)}`;
        }
        h += `</section><section class="d-section"><h3>The rock</h3>`;
        const ageRange = poi.ageMaxMa ? `${Util.ageText(poi.ageMaxMa)} old${poi.ageMinMa && poi.ageMinMa !== poi.ageMaxMa ? ` (to ${Util.ageText(poi.ageMinMa)})` : ''}` : '';
        h += this.grid([
            ['Age', poi.ageLabel],
            ['About', ageRange],
            ['Formation', poi.formation],
            ['Member', poi.member],
            ['Group', poi.group],
            ['Place', [poi.county, poi.state, poi.country].filter(Boolean).join(', ')],
        ]);
        if (poi.siteNotes) h += `<p class="quote">${E(poi.siteNotes)}</p>`;
        h += `</section><div data-slot="wiki"></div>`;
        return h;
    },

    // ------------------------------------------------------------------
    // Ground scan
    // ------------------------------------------------------------------
    renderScan(poi) {
        const E = Util.esc;
        let h = `<section class="d-section"><h3>Under this spot</h3>`;
        h += `<div class="scan-facts"><div data-slot="elevation" class="scan-fact"><span>Elevation</span><b>…</b></div>`;
        h += `<div data-slot="soil" class="scan-fact"><span>Soil type</span><b>…</b></div></div>`;
        if (!poi.units.length) {
            h += `<p class="muted">No geologic map covers this exact spot (open water, or unmapped). Try a spot on land nearby.</p>`;
        } else {
            h += `<p class="hint">Geologic maps at different scales, most detailed first.</p>`;
            poi.units.forEach((u, i) => {
                h += `<article class="unit${i === 0 ? ' unit-top' : ''}"><span class="unit-swatch" style="background:${E(u.color)}"></span><div>`;
                h += `<h4>${E(u.name)}</h4>`;
                h += `<p class="unit-meta">${E([u.age, u.topAge !== undefined && u.bottomAge ? `${Util.ageText(u.bottomAge)} old` : ''].filter(Boolean).join(' · '))}</p>`;
                if (u.rocks.length) h += this.chips(u.rocks.slice(0, 8), r => this.mindatSearch(r));
                if (u.description) h += `<p>${E(u.description)}</p>`;
                h += `<p class="hint">${E(Util.titleCase(u.scale))}-scale map</p></div></article>`;
            });
        }
        h += `</section><div data-slot="wiki"></div>`;
        return h;
    },

    // ------------------------------------------------------------------
    // Wikipedia / Wikidata / anything else
    // ------------------------------------------------------------------
    renderGeneric(poi) {
        const E = Util.esc;
        let h = '';
        if (poi.wdTypes && poi.wdTypes.length) {
            h += `<section class="d-section">${this.chips(poi.wdTypes.slice(0, 6).map(t => DataSources.humanize(t)))}</section>`;
        }
        h += `<div data-slot="wiki">${poi.description ? `<section class="d-section"><p>${E(DataSources.humanize(poi.description))}</p></section>` : ''}</div>`;
        return h;
    },

    renderWiki(article) {
        if (!article || !article.extract) return '';
        const E = Util.esc;
        const paras = article.extract.split(/\n+/).map(s => s.trim()).filter(s => s.length > 40);
        const first = paras.slice(0, 2), rest = paras.slice(2, 7);
        let h = `<section class="d-section"><h3>About</h3>`;
        h += first.map(p => `<p>${E(p)}</p>`).join('');
        if (rest.length) h += `<details class="d-more"><summary>Read more</summary>${rest.map(p => `<p>${E(p)}</p>`).join('')}</details>`;
        h += `<p class="hint">From Wikipedia: <a href="${E(Util.safeUrl(article.url))}" target="_blank" rel="noopener">${E(article.title)}</a></p></section>`;
        return h;
    },

    skeleton() {
        return `<div class="skeleton"><i></i><i></i><i></i></div>`;
    },

    // ------------------------------------------------------------------
    // Hydration — fill the slots once the extra lookups come back
    // ------------------------------------------------------------------
    hydrate(poi, root) {
        const x = this.extras(poi);
        const stillShown = () => root.dataset.poi === poi.id;
        const fill = (slot, html) => {
            if (!stillShown()) return;
            const el = root.querySelector(`[data-slot="${slot}"]`);
            if (el) el.innerHTML = html;
        };

        if (x.taxon) x.taxon.then(t => fill('taxon', this.renderTaxon(t)));
        else fill('taxon', '');

        if (x.mrds) x.mrds.then(p => fill('mrds', this.renderMRDSDetail(p, poi)));

        if (x.wiki) {
            x.wiki.then(a => {
                if (!a || !stillShown()) return;
                // iNaturalist already shows a species summary; don't repeat it.
                if (poi.sourceId !== 'inat') fill('wiki', this.renderWiki(a));
                const gal = root.querySelector('[data-slot="gallery"]');
                if (gal && !gal.innerHTML.trim() && a.thumbnail) gal.innerHTML = this.gallery([a.thumbnail], a.title);
                if (!poi.wikipediaUrl && a.url) {
                    poi.wikipediaUrl = a.url;
                    fill('links', this.links(poi));
                }
            });
        }

        if (x.elevation) {
            x.elevation.then(e => {
                fill('elevation', `<span>Elevation</span><b>${e === null ? 'unknown' : Util.esc(Util.elevationText(e))}</b>`);
            });
        }
        if (x.soil) {
            x.soil.then(s => {
                if (!s) { fill('soil', `<span>Soil type</span><b>unknown</b>`); return; }
                const others = s.probabilities.slice(1, 3).map(p => `${p[0]} ${p[1]}%`).join(', ');
                fill('soil', `<span>Soil type</span><b>${Util.esc(s.name)}</b>${others ? `<small>also possible: ${Util.esc(others)}</small>` : ''}`);
            });
        }
    },
};
