const API = "";
const app = document.getElementById("app");

let state = {
    page: "browse",
    filters: { section: "components", brand: "", q: "", year_min: "", year_max: "", category: "", group: "" },
    currentPage: 1,
    perPage: 48,
    detailId: null,
    disraeli: { view: null }, // null | {type:'brand', id, name} | {type:'derailleur', id}
};

// --- Nav ---
document.querySelectorAll("nav a[data-page]").forEach(a => {
    a.addEventListener("click", e => {
        e.preventDefault();
        state.page = a.dataset.page;
        state.detailId = null;
        if (a.dataset.page === "disraeli") state.disraeli.view = null;
        updateNav();
        render();
    });
});

function updateNav() {
    document.querySelectorAll("nav a[data-page]").forEach(a => {
        a.classList.toggle("active", a.dataset.page === state.page);
    });
}

// --- Render router ---
function render() {
    if (state.detailId) return renderDetail(state.detailId);
    switch (state.page) {
        case "browse": return renderBrowse();
        case "stats": return renderStats();
        case "catalogs": return renderCatalogs();
        case "links": return renderLinks();
        case "disraeli": return renderDisraeli();
    }
}

// --- Browse ---
async function renderBrowse() {
    app.innerHTML = `<div class="filters" id="filters">Chargement...</div><div id="results"></div>`;

    const f = state.filters;
    const [sections, brands, groups, categories] = await Promise.all([
        fetch(`${API}/api/sections`).then(r => r.json()),
        fetch(`${API}/api/brands?section=${f.section}`).then(r => r.json()),
        fetch(`${API}/api/groups?section=${f.section}&brand=${f.brand}`).then(r => r.json()),
        fetch(`${API}/api/categories?section=${f.section}`).then(r => r.json()),
    ]);

    document.getElementById("filters").innerHTML = `
        <div class="filter-row">
            <select id="f-section">
                <option value="">Toutes sections</option>
                ${sections.map(s => `<option value="${s.section}" ${f.section === s.section ? "selected" : ""}>${s.section} (${s.count})</option>`).join("")}
            </select>
            <select id="f-brand">
                <option value="">Toutes marques</option>
                ${brands.slice(0, 150).map(b => `<option value="${b.brand}" ${f.brand === b.brand ? "selected" : ""}>${b.brand} (${b.count})</option>`).join("")}
            </select>
            <select id="f-group">
                <option value="">Tous groupes</option>
                ${groups.slice(0, 100).map(g => `<option value="${g.group_name}" ${f.group === g.group_name ? "selected" : ""}>${g.group_name} (${g.count})</option>`).join("")}
            </select>
            <select id="f-category">
                <option value="">Toutes categories</option>
                ${categories.slice(0, 80).map(c => `<option value="${c.category}" ${f.category === c.category ? "selected" : ""}>${c.category} (${c.count})</option>`).join("")}
            </select>
        </div>
        <div class="filter-row">
            <input type="search" id="f-search" placeholder="Recherche libre (ex: campagnolo record titanium)..." value="${f.q}">
            <input type="number" id="f-year-min" placeholder="Annee min" style="width:100px" value="${f.year_min}">
            <input type="number" id="f-year-max" placeholder="Annee max" style="width:100px" value="${f.year_max}">
            <button class="btn btn-sm" id="f-reset" style="background:var(--bg3)">Reset</button>
            <span class="count" id="f-count"></span>
        </div>
    `;

    // Events
    document.getElementById("f-section").onchange = e => { f.section = e.target.value; f.brand = ""; f.group = ""; f.category = ""; state.currentPage = 1; renderBrowse(); };
    document.getElementById("f-brand").onchange = e => { f.brand = e.target.value; f.group = ""; state.currentPage = 1; renderBrowse(); };
    document.getElementById("f-group").onchange = e => { f.group = e.target.value; state.currentPage = 1; loadItems(); };
    document.getElementById("f-category").onchange = e => { f.category = e.target.value; state.currentPage = 1; loadItems(); };
    document.getElementById("f-year-min").onchange = e => { f.year_min = e.target.value; state.currentPage = 1; loadItems(); };
    document.getElementById("f-year-max").onchange = e => { f.year_max = e.target.value; state.currentPage = 1; loadItems(); };
    document.getElementById("f-reset").onclick = () => {
        Object.assign(f, { section: "components", brand: "", q: "", year_min: "", year_max: "", category: "", group: "" });
        state.currentPage = 1;
        renderBrowse();
    };

    let searchTimeout;
    document.getElementById("f-search").oninput = e => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => { f.q = e.target.value; state.currentPage = 1; loadItems(); }, 300);
    };

    loadItems();
}

async function loadItems() {
    const f = state.filters;
    const params = new URLSearchParams({
        page: state.currentPage,
        per_page: state.perPage,
        ...(f.section && { section: f.section }),
        ...(f.brand && { brand: f.brand }),
        ...(f.group && { group: f.group }),
        ...(f.category && { category: f.category }),
        ...(f.q && { q: f.q }),
        ...(f.year_min && { year_min: f.year_min }),
        ...(f.year_max && { year_max: f.year_max }),
    });

    const data = await fetch(`${API}/api/items?${params}`).then(r => r.json());
    const countEl = document.getElementById("f-count");
    if (countEl) countEl.textContent = `${data.total} items`;

    const results = document.getElementById("results");

    // Group items by group_name for display
    const grouped = {};
    for (const item of data.items) {
        const g = item.group_name || "Autre";
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push(item);
    }

    const showGroups = Object.keys(grouped).length > 1 && !f.group;

    let html = "";
    for (const [groupName, items] of Object.entries(grouped)) {
        if (showGroups) {
            html += `<div class="group-header">${esc(groupName)}</div>`;
        }
        html += `<div class="grid">`;
        html += items.map(item => `
            <div class="card" data-id="${item.id}">
                ${item.image_url
                    ? `<img src="${item.image_url}" alt="${esc(item.name)}" loading="lazy" onerror="this.style.display='none'">`
                    : `<div style="aspect-ratio:1;background:var(--bg3);display:flex;align-items:center;justify-content:center;color:var(--text2);font-size:12px">No image</div>`
                }
                <div class="info">
                    <div class="name" title="${esc(item.name)}">${esc(item.name)}</div>
                    <div class="brand">${esc(item.brand || "")}</div>
                    ${item.years_raw ? `<div class="year">${esc(item.years_raw)}</div>` : ""}
                </div>
            </div>
        `).join("");
        html += `</div>`;
    }

    // Pagination
    if (data.pages > 1) {
        html += `<div class="pagination" id="pagination">`;
        html += `<button ${data.page <= 1 ? "disabled" : ""} data-p="${data.page - 1}">&laquo;</button>`;
        const start = Math.max(1, data.page - 3);
        const end = Math.min(data.pages, data.page + 3);
        if (start > 1) html += `<button data-p="1">1</button><button disabled>...</button>`;
        for (let i = start; i <= end; i++) {
            html += `<button data-p="${i}" class="${i === data.page ? "active" : ""}">${i}</button>`;
        }
        if (end < data.pages) html += `<button disabled>...</button><button data-p="${data.pages}">${data.pages}</button>`;
        html += `<button ${data.page >= data.pages ? "disabled" : ""} data-p="${data.page + 1}">&raquo;</button>`;
        html += `</div>`;
    }

    results.innerHTML = html;

    results.querySelectorAll(".card").forEach(card => {
        card.onclick = () => { state.detailId = card.dataset.id; render(); };
    });
    results.querySelectorAll(".pagination button[data-p]").forEach(b => {
        b.onclick = () => { state.currentPage = parseInt(b.dataset.p); loadItems(); window.scrollTo(0, 0); };
    });
}

// --- Detail ---
async function renderDetail(id) {
    app.innerHTML = "Chargement...";
    const item = await fetch(`${API}/api/items/${id}`).then(r => r.json());

    const images = item.images || [];
    const mainImg = images.length > 0 ? (images[0].local_url || images[0].url) : null;

    app.innerHTML = `
        <a class="back-btn" id="back-btn">&larr; Retour</a>
        <div class="detail">
            <div class="gallery">
                ${mainImg ? `<img class="main-img" id="main-img" src="${mainImg}" alt="${esc(item.name)}">` : `<div style="aspect-ratio:1;background:var(--bg2);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--text2)">Pas d'image</div>`}
                ${images.length > 1 ? `
                <div class="thumbs">
                    ${images.map((img, i) => `<img src="${img.local_url || img.url}" data-full="${img.local_url || img.url}" class="${i === 0 ? "active" : ""}" alt="thumb">`).join("")}
                </div>` : ""}
            </div>
            <div class="meta">
                <h1>${esc(item.name)}</h1>
                <div class="brand-link">${esc(item.brand || "")} ${item.group_name ? "- " + esc(item.group_name) : ""}</div>
                <table class="specs-table">
                    <tr><td>Section</td><td>${esc(item.section)}</td></tr>
                    ${item.model ? `<tr><td>Model</td><td>${esc(item.model)}</td></tr>` : ""}
                    ${item.years_raw ? `<tr><td>Years</td><td>${esc(item.years_raw)}</td></tr>` : ""}
                    ${item.category ? `<tr><td>Category</td><td>${esc(item.category)}</td></tr>` : ""}
                    ${item.country ? `<tr><td>Country</td><td>${esc(item.country)}</td></tr>` : ""}
                    ${item.weight ? `<tr><td>Weight</td><td>${esc(item.weight)}</td></tr>` : ""}
                    ${Object.entries(item.specs || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
                </table>
                ${item.detail_url ? `<p style="margin-top:16px"><a href="${item.detail_url}" target="_blank" style="color:var(--accent)">Voir la source &rarr;</a></p>` : ""}
            </div>
        </div>
    `;

    document.getElementById("back-btn").onclick = () => { state.detailId = null; render(); };

    // Thumb click → swap main image
    document.querySelectorAll(".thumbs img").forEach(thumb => {
        thumb.onclick = () => {
            document.getElementById("main-img").src = thumb.dataset.full;
            document.querySelectorAll(".thumbs img").forEach(t => t.classList.remove("active"));
            thumb.classList.add("active");
        };
    });
}

// --- Stats ---
async function renderStats() {
    app.innerHTML = "Chargement...";
    const stats = await fetch(`${API}/api/stats`).then(r => r.json());

    const maxBrand = Math.max(...stats.top_brands.map(b => b.count));

    app.innerHTML = `
        <h2 style="margin-bottom:16px">Dashboard</h2>
        <div class="stats-grid">
            <div class="stat-card"><h3>Items</h3><div class="big-number">${stats.total_items.toLocaleString()}</div></div>
            <div class="stat-card"><h3>Images</h3><div class="big-number">${stats.total_images.toLocaleString()}</div><div style="color:var(--text2);font-size:13px">${stats.total_downloaded.toLocaleString()} downloaded</div></div>
            <div class="stat-card"><h3>Catalogs</h3><div class="big-number">${stats.total_catalogs}</div></div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <h3>Par section</h3>
                <div class="bar-chart">
                    ${stats.sections.map(s => {
                        const pct = (s.count / stats.total_items * 100).toFixed(0);
                        return `<div class="bar-row"><span class="label">${s.section}</span><div class="bar" style="width:${pct}%"></div><span class="val">${s.count}</span></div>`;
                    }).join("")}
                </div>
            </div>
            <div class="stat-card">
                <h3>Top 15 marques</h3>
                <div class="bar-chart">
                    ${stats.top_brands.slice(0, 15).map(b => {
                        const pct = (b.count / maxBrand * 100).toFixed(0);
                        return `<div class="bar-row"><span class="label">${b.brand}</span><div class="bar" style="width:${pct}%"></div><span class="val">${b.count}</span></div>`;
                    }).join("")}
                </div>
            </div>
        </div>

        <div class="stat-card" style="margin-top:16px">
            <h3>Distribution par annee</h3>
            <div style="display:flex;align-items:flex-end;gap:1px;height:120px;overflow-x:auto;padding-top:8px" id="year-chart"></div>
        </div>
    `;

    // Year chart
    const yearChart = document.getElementById("year-chart");
    if (stats.years.length > 0) {
        const maxY = Math.max(...stats.years.map(y => y.count));
        yearChart.innerHTML = stats.years.map(y => {
            const h = Math.max(2, (y.count / maxY * 100));
            return `<div title="${y.year}: ${y.count}" style="flex:1;min-width:3px;max-width:12px;height:${h}%;background:var(--accent2);border-radius:2px 2px 0 0"></div>`;
        }).join("");
    }
}

// --- Catalogs ---
async function renderCatalogs() {
    app.innerHTML = `
        <h2 style="margin-bottom:16px">Catalogs</h2>
        <div class="filters">
            <input type="search" id="cat-search" placeholder="Rechercher...">
        </div>
        <div class="catalog-list" id="cat-list">Chargement...</div>
    `;

    let catalogs = await fetch(`${API}/api/catalogs`).then(r => r.json());
    renderCatalogList(catalogs);

    let searchTimeout;
    document.getElementById("cat-search").oninput = e => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            catalogs = await fetch(`${API}/api/catalogs?q=${encodeURIComponent(e.target.value)}`).then(r => r.json());
            renderCatalogList(catalogs);
        }, 300);
    };
}

function renderCatalogList(catalogs) {
    document.getElementById("cat-list").innerHTML = catalogs.length === 0
        ? `<p style="color:var(--text2)">Aucun catalog</p>`
        : catalogs.map(c => `
            <div class="catalog-item">
                <div class="cat-info">
                    <div class="cat-title">${esc(c.title)}</div>
                    <div class="cat-brand">${esc(c.brand)}</div>
                </div>
                <div class="cat-meta">
                    ${c.file_size || ""}
                    ${c.download_url ? `<br><a href="${c.download_url}" target="_blank" style="color:var(--accent);font-size:12px">Download</a>` : ""}
                </div>
            </div>
        `).join("");
}

// --- Links ---
async function renderLinks() {
    app.innerHTML = `
        <h2 style="margin-bottom:16px">Liens sauvegardés</h2>
        <div class="links-form" id="link-form">
            <input name="url" placeholder="URL" required>
            <input name="title" placeholder="Titre (optionnel)">
            <input name="notes" placeholder="Notes (optionnel)">
            <button class="btn" id="add-link-btn">Ajouter</button>
        </div>
        <div class="links-list" id="links-list">Chargement...</div>
    `;

    loadLinks();

    document.getElementById("add-link-btn").onclick = async () => {
        const form = document.getElementById("link-form");
        const url = form.querySelector('[name="url"]').value.trim();
        if (!url) return;
        await fetch(`${API}/api/links`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url,
                title: form.querySelector('[name="title"]').value.trim(),
                notes: form.querySelector('[name="notes"]').value.trim(),
            }),
        });
        form.querySelector('[name="url"]').value = "";
        form.querySelector('[name="title"]').value = "";
        form.querySelector('[name="notes"]').value = "";
        loadLinks();
    };
}

async function loadLinks() {
    const links = await fetch(`${API}/api/links`).then(r => r.json());
    const list = document.getElementById("links-list");
    list.innerHTML = links.length === 0
        ? `<p style="color:var(--text2)">Aucun lien sauvegardé</p>`
        : links.map(l => `
            <div class="link-item">
                <div class="link-info">
                    <a href="${esc(l.url)}" target="_blank">${esc(l.title || l.url)}</a>
                    ${l.notes ? `<div class="link-notes">${esc(l.notes)}</div>` : ""}
                    <div class="link-date">${l.created_at || ""}</div>
                </div>
                <button class="btn btn-danger btn-sm" onclick="deleteLink(${l.id})">Suppr</button>
            </div>
        `).join("");
}

window.deleteLink = async function(id) {
    await fetch(`${API}/api/links/${id}`, { method: "DELETE" });
    loadLinks();
};

// --- Disraeli Gears ---
function renderDisraeli() {
    const v = state.disraeli.view;
    if (!v) return renderDisraeliBrands();
    if (v.type === "brand") return renderDisraeliDerailleurs(v.id, v.name);
    if (v.type === "derailleur") return renderDisraeliDetail(v.id);
}

async function renderDisraeliBrands() {
    app.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
            <h2 style="margin:0">Disraeli Gears</h2>
        </div>
        <div class="filters" style="margin-bottom:16px">
            <input type="search" id="dg-search" placeholder="Filtrer les marques...">
        </div>
        <div id="dg-brands">Chargement...</div>
    `;

    const [brands, stats] = await Promise.all([
        fetch(`${API}/api/disraeli/brands`).then(r => r.json()),
        fetch(`${API}/api/disraeli/stats`).then(r => r.json()),
    ]);

    // Stats bar
    const statsHtml = `
        <div class="stats-grid" style="margin-bottom:20px">
            <div class="stat-card"><h3>Dérailleurs</h3><div class="big-number">${stats.total_derailleurs}</div></div>
            <div class="stat-card"><h3>Marques</h3><div class="big-number">${stats.total_brands}</div></div>
            <div class="stat-card"><h3>Images</h3><div class="big-number">${stats.total_images.toLocaleString()}</div></div>
            <div class="stat-card"><h3>Documents</h3><div class="big-number">${stats.total_documents.toLocaleString()}</div></div>
        </div>
    `;
    document.getElementById("dg-brands").innerHTML = statsHtml + renderBrandGrid(brands);

    let searchTimeout;
    document.getElementById("dg-search").oninput = e => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const q = e.target.value.toLowerCase();
            const filtered = brands.filter(b => b.name.toLowerCase().includes(q));
            document.getElementById("dg-brands").innerHTML = statsHtml + renderBrandGrid(filtered);
            attachBrandClicks();
        }, 200);
    };

    attachBrandClicks();
}

function renderBrandGrid(brands) {
    if (!brands.length) return `<p style="color:var(--text2)">Aucune marque</p>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:10px">` +
        brands.map(b => `
            <div class="dg-brand-chip" data-id="${b.id}" data-name="${esc(b.name)}"
                 style="cursor:pointer;padding:8px 14px;background:var(--bg2);border-radius:20px;border:1px solid var(--bg3);
                        transition:border-color .15s;white-space:nowrap"
                 onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--bg3)'">
                <span style="font-weight:600">${esc(b.name)}</span>
                <span style="color:var(--text2);margin-left:6px;font-size:12px">${b.count}</span>
            </div>
        `).join("") +
        `</div>`;
}

function attachBrandClicks() {
    document.querySelectorAll(".dg-brand-chip").forEach(el => {
        el.onclick = () => {
            state.disraeli.view = { type: "brand", id: el.dataset.id, name: el.dataset.name };
            render();
        };
    });
}

async function renderDisraeliDerailleurs(brandId, brandName) {
    app.innerHTML = `
        <a class="back-btn" id="dg-back">&larr; Toutes les marques</a>
        <h2 style="margin:12px 0 16px">${esc(brandName)}</h2>
        <div id="dg-list">Chargement...</div>
    `;
    document.getElementById("dg-back").onclick = () => { state.disraeli.view = null; render(); };

    const derailleurs = await fetch(`${API}/api/disraeli/derailleurs?brand_id=${brandId}`).then(r => r.json());

    if (!derailleurs.length) {
        document.getElementById("dg-list").innerHTML = `<p style="color:var(--text2)">Aucun dérailleur</p>`;
        return;
    }

    document.getElementById("dg-list").innerHTML = `
        <div class="grid">
            ${derailleurs.map(d => `
                <div class="card dg-card" data-id="${d.id}">
                    ${d.primary_image
                        ? `<img src="${d.primary_image}" alt="${esc(d.title)}" loading="lazy" onerror="this.style.display='none'">`
                        : `<div style="aspect-ratio:1;background:var(--bg3);display:flex;align-items:center;justify-content:center;color:var(--text2);font-size:12px">No image</div>`
                    }
                    <div class="info">
                        <div class="name" title="${esc(d.title)}">${esc(d.title)}</div>
                        ${d.year_text ? `<div class="year">${esc(d.year_text)}</div>` : ""}
                    </div>
                </div>
            `).join("")}
        </div>
    `;

    document.querySelectorAll(".dg-card").forEach(card => {
        card.onclick = () => {
            state.disraeli.view = { type: "derailleur", id: card.dataset.id };
            render();
        };
    });
}

async function renderDisraeliDetail(id) {
    app.innerHTML = `<a class="back-btn" id="dg-back-detail">&larr; Retour</a><div style="margin-top:12px">Chargement...</div>`;
    document.getElementById("dg-back-detail").onclick = () => {
        state.disraeli.view = state.disraeli.view._prev || null;
        render();
    };

    const d = await fetch(`${API}/api/disraeli/derailleurs/${id}`).then(r => r.json());

    const images = d.images || [];
    const mainImg = images[0] ? images[0].url : null;

    // Store prev view for back button
    const prevBrandId = d.brand_id;
    const prevBrandName = d.brand_name;

    app.innerHTML = `
        <a class="back-btn" id="dg-back-detail">&larr; ${esc(d.brand_name)}</a>
        <div class="detail">
            <div class="gallery">
                ${mainImg
                    ? `<img class="main-img" id="dg-main-img" src="${mainImg}" alt="${esc(d.title)}">`
                    : `<div style="aspect-ratio:1;background:var(--bg2);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--text2)">Pas d'image</div>`
                }
                ${images.length > 1 ? `
                <div class="thumbs">
                    ${images.map((img, i) => `
                        <img src="${img.url}" data-full="${img.url}" class="${i === 0 ? "active" : ""}" alt="thumb"
                             onerror="this.style.display='none'">
                    `).join("")}
                </div>` : ""}
            </div>
            <div class="meta">
                <h1>${esc(d.title)}</h1>
                <div class="brand-link">${esc(d.brand_name)}</div>
                <table class="specs-table">
                    ${d.year_text ? `<tr><td>Année</td><td>${esc(d.year_text)}</td></tr>` : ""}
                    ${d.model ? `<tr><td>Modèle</td><td>${esc(d.model)}</td></tr>` : ""}
                </table>
                ${d.description ? `<div style="margin-top:16px;line-height:1.7;color:var(--text1);font-size:14px">${d.description}</div>` : ""}
                ${d.url ? `<p style="margin-top:16px"><a href="https://www.disraeligears.co.uk/site/${d.url}" target="_blank" style="color:var(--accent)">Voir sur disraeligears.co.uk &rarr;</a></p>` : ""}
                ${d.documents && d.documents.length > 0 ? `
                <div style="margin-top:20px">
                    <h3 style="margin-bottom:10px;font-size:15px">Documents liés (${d.documents.length})</h3>
                    <div style="display:flex;flex-direction:column;gap:6px">
                        ${d.documents.map(doc => `
                            <div style="padding:8px 12px;background:var(--bg2);border-radius:6px;font-size:13px">
                                <span style="color:var(--text1)">${esc(doc.title)}</span>
                                ${doc.year_text ? `<span style="color:var(--text2);margin-left:8px">${esc(doc.year_text)}</span>` : ""}
                                ${doc.doc_type ? `<span style="color:var(--accent2);margin-left:8px;font-size:11px;text-transform:uppercase">${esc(doc.doc_type)}</span>` : ""}
                            </div>
                        `).join("")}
                    </div>
                </div>` : ""}
            </div>
        </div>
    `;

    document.getElementById("dg-back-detail").onclick = () => {
        state.disraeli.view = { type: "brand", id: prevBrandId, name: prevBrandName };
        render();
    };

    document.querySelectorAll(".thumbs img").forEach(thumb => {
        thumb.onclick = () => {
            const main = document.getElementById("dg-main-img");
            if (main) main.src = thumb.dataset.full;
            document.querySelectorAll(".thumbs img").forEach(t => t.classList.remove("active"));
            thumb.classList.add("active");
        };
    });
}

// --- Utils ---
function esc(s) {
    if (!s) return "";
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Init ---
render();
