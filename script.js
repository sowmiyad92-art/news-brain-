let allData = {};
let currentFilter = 'all';
let newsHistory = [];

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    setupEventListeners();
    setupQuickUpdate();
    setupDragDrop();
    setupDataExport();
    loadNewsHistory();
    updateDashboard();
    // checkTomorrowAlerts() REMOVED — banner lives in Analytics tab only
    setupNewsHistoryPanel();
    document.getElementById('lastUpdated').textContent = new Date().toLocaleString();
});

async function loadData() {
    try {
        const response = await fetch('./data.json');
        if (!response.ok) throw new Error('Failed to load data.json');
        const baseData = await response.json();

        loadAnnouncedDates();

        // Merge agent announcedDates from data.json into localStorage
        if (baseData.announcedDates && typeof baseData.announcedDates === 'object') {
            let stored = {};
            try { stored = JSON.parse(localStorage.getItem('announcedDates') || '{}'); } catch(_) {}

            // Build lastAnnouncement map from base data + localStorage overrides
            const lastAnnMap = {};
            for (const co of (baseData.companies || [])) {
                lastAnnMap[co.name] = co.lastAnnouncement || '';
            }
            try {
                const savedCompanies = JSON.parse(localStorage.getItem('companiesData') || '[]');
                for (const co of savedCompanies) {
                    if (co.lastAnnouncement && co.lastAnnouncement > (lastAnnMap[co.name] || '')) {
                        lastAnnMap[co.name] = co.lastAnnouncement;
                    }
                }
            } catch(_) {}

            const today = new Date(); today.setHours(0, 0, 0, 0);
            let merged = 0, skipped = 0;

            for (const [company, entry] of Object.entries(baseData.announcedDates)) {
                const existing  = stored[company]?.date;
                const lastAnn   = lastAnnMap[company] || '';
                const entryDate = new Date(entry.date); entryDate.setHours(0, 0, 0, 0);

                // ── TODAY: auto-promote announced date → lastAnnouncement ──
                // If the confirmed earnings date is TODAY and agent hasn't already updated it,
                // move it into lastAnnouncement + recalculate expectedNext, then clear upcoming pin.
                if (entryDate.getTime() === today.getTime()) {
                    const coEntry = (baseData.companies || []).find(c => c.name === company);
                    if (coEntry && (!coEntry.lastAnnouncement || coEntry.lastAnnouncement < entry.date)) {
                        coEntry.lastAnnouncement = entry.date;
                        try {
                            const next = new Date(entry.date);
                            next.setDate(next.getDate() + 90);
                            coEntry.expectedNext = next.getFullYear() + '-' +
                                String(next.getMonth() + 1).padStart(2, '0') + '-' +
                                String(next.getDate()).padStart(2, '0');
                        } catch(_) {}
                        console.log(`📅 [auto-promote] ${company}: announcedDate ${entry.date} → lastAnnouncement`);
                    }
                    if (stored[company]) delete stored[company];
                    skipped++;
                    continue;
                }

                // SKIP if: date is already past, OR lastAnnouncement has caught up to/passed it
                if (entryDate < today || (lastAnn && lastAnn >= entry.date)) {
                    skipped++;
                    if (stored[company]) delete stored[company];
                    continue;
                }

                if (!existing || entry.date > existing) {
                    stored[company] = entry;
                    merged++;
                }
            }

            localStorage.setItem('announcedDates', JSON.stringify(stored));
            console.log(`🤖 [agent] Merged ${merged} upcoming dates, skipped ${skipped} consumed/past dates`);
        }

        const savedData = localStorage.getItem('companiesData');

        if (savedData) {
            const saved = JSON.parse(savedData);
            const savedMap = {};
            for (const c of saved) savedMap[c.name] = c;

            allData = baseData;
            window.allData = allData;

            for (const company of allData.companies) {
                const s = savedMap[company.name];
                if (s) {
                    if (s.lastAnnouncement && (!company.lastAnnouncement || s.lastAnnouncement > company.lastAnnouncement)) {
                        company.lastAnnouncement = s.lastAnnouncement;
                    }
                    if (s.expectedNext && (!company.expectedNext || s.expectedNext > company.expectedNext)) {
                        company.expectedNext = s.expectedNext;
                    }
                    company.articleUrl = s.articleUrl || null;
                }
            }

            const baseNames = new Set(allData.companies.map(c => c.name));
            for (const s of saved) {
                if (!baseNames.has(s.name)) {
                    allData.companies.push({
                        name: s.name,
                        region: s.region || 'North America',
                        lastAnnouncement: s.lastAnnouncement || '',
                        expectedNext: s.expectedNext || '',
                        irWebsite: s.irWebsite || '#',
                        bestSource: s.bestSource || 'IR Website',
                        sourceReliability: s.sourceReliability || 3,
                        articleUrl: s.articleUrl || null,
                    });
                    console.log('✅ Restored user-added company:', s.name);
                }
            }
            console.log('✅ Loaded data.json + localStorage —', allData.companies.length, 'total companies');
        } else {
            allData = baseData;
            window.allData = allData;
            console.log('✅ Loaded fresh data from data.json');
        }

        renderTable(allData.companies);
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('tableBody').innerHTML =
            '<tr><td colspan="9" style="text-align:center;color:red;padding:30px;">❌ Error loading data.json</td></tr>';
    }
}

// ═══════════════════════════════════════════════════════
// NEWS HISTORY TRACKING
// ═══════════════════════════════════════════════════════

function loadNewsHistory() {
    const saved = localStorage.getItem('newsHistory');
    newsHistory = saved ? JSON.parse(saved) : [];
    console.log('📰 Loaded', newsHistory.length, 'news articles in history');
}

function saveNewsHistory() {
    localStorage.setItem('newsHistory', JSON.stringify(newsHistory));
}

function addNewsToHistory(company, date, url, source = 'manual') {
    const entry = {
        company,
        date,
        url,
        source,
        timestamp: new Date().toLocaleString(),
        id: Date.now()
    };
    newsHistory.unshift(entry);
    if (newsHistory.length > 100) newsHistory = newsHistory.slice(0, 100);
    saveNewsHistory();
    console.log('📰 Added to history:', company, date);
}

function getNewsHistory(company = null) {
    if (company) return newsHistory.filter(n => n.company === company);
    return newsHistory;
}

function exportNewsHistory() {
    const dataStr = JSON.stringify(newsHistory, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `news-history-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showNotification('✅ News history exported!', 'success');
}

// ═══════════════════════════════════════════════════════
// UPCOMING EARNINGS DATE
// ═══════════════════════════════════════════════════════

let announcedDates = {};

function loadAnnouncedDates() {
    try {
        const saved = localStorage.getItem('announcedDates');
        announcedDates = saved ? JSON.parse(saved) : {};
        console.log('📅 Loaded upcoming earnings dates for', Object.keys(announcedDates).length, 'companies');
    } catch(e) { announcedDates = {}; }
}

function saveAnnouncedDate(companyName, date, url) {
    announcedDates[companyName] = {
        date,
        url: url || null,
        timestamp: new Date().toLocaleString()
    };
    localStorage.setItem('announcedDates', JSON.stringify(announcedDates));
    console.log('📅 Saved upcoming earnings date for', companyName, '→', date);
}

function clearAnnouncedDate(companyName) {
    delete announcedDates[companyName];
    localStorage.setItem('announcedDates', JSON.stringify(announcedDates));
}

function getAnnouncedDate(companyName) {
    return announcedDates[companyName] || null;
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('keyup', handleSearch);
}

// ═══════════════════════════════════════════════════════
// QUICK UPDATE PANEL
// ═══════════════════════════════════════════════════════

let quTab = 'past';

function setupQuickUpdate() {
    const sel = document.getElementById('quCompany');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select company —</option>' +
        (allData.companies || [])
            .slice().sort((a, b) => a.name.localeCompare(b.name))
            .map(c => `<option value="${c.name}">${c.name}</option>`)
            .join('');

    const dateInput = document.getElementById('quDate');
    if (dateInput) dateInput.valueAsDate = new Date();
}

window.quSetTab = function(tab) {
    quTab = tab;
    const pastBtn     = document.getElementById('quTabPast');
    const upcomingBtn = document.getElementById('quTabUpcoming');
    if (tab === 'past') {
        pastBtn.style.background = '#3182ce'; pastBtn.style.color = '#fff';
        upcomingBtn.style.background = '#fff'; upcomingBtn.style.color = '#666';
    } else {
        upcomingBtn.style.background = '#3182ce'; upcomingBtn.style.color = '#fff';
        pastBtn.style.background = '#fff'; pastBtn.style.color = '#666';
    }
};

window.quSave = function() {
    const company = document.getElementById('quCompany')?.value;
    const date    = document.getElementById('quDate')?.value;
    const url     = document.getElementById('quUrl')?.value.trim() || null;

    if (!company) { showNotification('⚠️ Please select a company', 'warning'); return; }
    if (!date)    { showNotification('⚠️ Please pick a date', 'warning'); return; }

    if (quTab === 'past') {
        updateCompanyNews(company, date, url);
        addNewsToHistory(company, date, url, 'quick-update');
        showNotification(`✅ Last Announcement updated: ${company} → ${date}`, 'success');
    } else {
        saveAnnouncedDate(company, date, url);
        addNewsToHistory(company, date, url, 'upcoming-date');
        renderTable(allData.companies);
        showNotification(`📅 Upcoming Earnings saved: ${company} → ${date}`, 'success');
    }

    document.getElementById('quUrl').value = '';
};

function handleSearch(e) {
    const query = e.target.value.toLowerCase();
    if (!allData || !allData.companies) return;
    if (query === '') {
        filterByRegion(currentFilter);
    } else {
        const filtered = allData.companies.filter(c =>
            c.name.toLowerCase().includes(query)
        );
        renderTable(filtered);
    }
}

function filterByRegion(region) {
    currentFilter = region;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');
    if (!allData || !allData.companies) return;
    const filtered = region === 'all'
        ? allData.companies
        : allData.companies.filter(c => c.region === region);
    renderTable(filtered);
}

function calculateDaysInfo(dateString) {
    const date  = new Date(dateString);
    const today = new Date();
    date.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const timeDiff = today - date;
    const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    return {
        days: Math.abs(days),
        isPast: days >= 0,
        isFuture: days < 0,
        isOverdue: days > 180,
        isToday: days === 0
    };
}

function renderTable(companies) {
    const tbody = document.getElementById('tableBody');

    if (companies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#666;">No companies found</td></tr>';
        return;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.getFullYear() + '-' +
        String(tomorrow.getMonth()+1).padStart(2,'0') + '-' +
        String(tomorrow.getDate()).padStart(2,'0');

    tbody.innerHTML = companies.map(company => {
        const dateInfo = calculateDaysInfo(company.lastAnnouncement);

        let daysDisplay = '';
        let daysClass   = '';
        if (dateInfo.isFuture) {
            daysDisplay = `In ${dateInfo.days} days`;
            daysClass   = 'days-future';
        } else if (dateInfo.isOverdue) {
            daysDisplay = `${dateInfo.days} days ago`;
            daysClass   = 'days-overdue';
        } else {
            daysDisplay = `${dateInfo.days} days ago`;
            daysClass   = 'days-ok';
        }

        const hasNews    = company.articleUrl && company.articleUrl.length > 0;
        const safeName   = company.name.replace(/'/g, "\\'");
        const newsIndicator = hasNews
            ? `<span class="news-badge clickable" onclick="openNewsHistory('${safeName}')" title="View news history">✅</span>`
            : `<span class="news-badge-empty clickable" onclick="openNewsHistory('${safeName}')" title="No news yet">＋</span>`;

        const isTomorrow = company.expectedNext === tomorrowStr;

        // ── Upcoming Earnings Date column ──
        const announced = getAnnouncedDate(company.name);
        const today = new Date(); today.setHours(0,0,0,0);

        let announcedCell = '';
        if (announced) {
            const annDate   = new Date(announced.date); annDate.setHours(0,0,0,0);
            const daysUntil = Math.round((annDate - today) / 86400000);
            let badge = '';
            if (daysUntil === 0)                   badge = '<span class="nb-ann-badge nb-ann-today">📅 TODAY</span>';
            else if (daysUntil === 1)               badge = '<span class="nb-ann-badge nb-ann-tomorrow">⏰ Tomorrow</span>';
            else if (daysUntil > 1 && daysUntil <= 7) badge = `<span class="nb-ann-badge nb-ann-soon">⏳ ${daysUntil}d</span>`;
            else if (daysUntil > 7)                badge = `<span class="nb-ann-badge nb-ann-future">📆 ${daysUntil}d</span>`;
            else                                   badge = `<span class="nb-ann-badge nb-ann-past">✅ ${Math.abs(daysUntil)}d ago</span>`;

            announcedCell = `
                <span class="announced-date-confirmed" title="Confirmed upcoming earnings date. Source saved: ${announced.timestamp || ''}">
                    ${announced.date}
                    ${badge}
                    ${announced.url
                        ? `<a href="${announced.url}" target="_blank" class="announced-link" title="Open source article">📎</a>`
                        : ''}
                    <span class="announced-clear" onclick="handleClearAnnounced('${safeName}')" title="Remove confirmed date">×</span>
                </span>
            `;
        } else {
            announcedCell = `<span class="announced-date-empty" onclick="handleAddAnnounced('${safeName}')" title="Add confirmed upcoming earnings date">＋ Add</span>`;
        }

        const rowClass = [
            dateInfo.isOverdue    ? 'overdue'        : '',
            dateInfo.isFuture     ? 'future-event'   : '',
            company.isNewlyUpdated ? 'newly-updated'  : '',
            isTomorrow            ? 'due-tomorrow'   : ''
        ].filter(Boolean).join(' ');

       // Pattern badge
        const pat = company.pattern || 'Q';
        const patLabel = { Q:'Q', H:'H', A:'A' }[pat] || 'Q';
        const patClass = { Q:'pattern-q', H:'pattern-h', A:'pattern-a' }[pat] || 'pattern-q';
        const patBadge = `<span class="pattern-badge ${patClass}" title="${{Q:'Quarterly',H:'Half-Yearly',A:'Annual'}[pat]}">${patLabel}</span>`;

        // Manual check flag — show if no data from agent AND no upcoming date
        const overdueThreshold = { Q: 120, H: 240, A: 400 }[pat] || 120;
        const needsManualCheck = !announced && dateInfo.days > overdueThreshold;
        const manualFlag = needsManualCheck
            ? `<span class="manual-check-flag" title="No data from agent — check manually">⚑ Check</span>`
            : '';

        return `
            <tr class="${rowClass}">
                <td><span class="company-name">${company.name}</span>${patBadge}${manualFlag}${isTomorrow ? ' <span class="tomorrow-badge">📅 Tomorrow!</span>' : ''}</td>
                <td>${company.region}</td>
                <td>${company.lastAnnouncement}</td>
                <td><span class="${daysClass}">${daysDisplay}</span></td>
                <td>${announcedCell}</td>
                <td><span class="source-badge">${company.bestSource}</span></td>
                <td style="text-align:center;">${newsIndicator}</td>
                <td>
                    <a href="${company.irWebsite}" target="_blank" class="ir-link">Check IR →</a>
                </td>
            </tr>
        `;
    }).join('');
}

function updateDashboard() {
    const today = new Date();
    const thirtyDaysLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    document.getElementById('totalCompanies').textContent = allData.companies.length;
    document.getElementById('footerCount').textContent    = allData.companies.length;

    const expectedThisMonth = allData.companies.filter(c => {
        const expectedDate = new Date(c.expectedNext);
        return expectedDate >= today && expectedDate <= thirtyDaysLater;
    });
    document.getElementById('expectedThisMonth').textContent = expectedThisMonth.length;

    const overdue = allData.companies.filter(c => {
        const dateInfo = calculateDaysInfo(c.lastAnnouncement);
        return dateInfo.isOverdue;
    });
    document.getElementById('overdueCount').textContent = overdue.length;

    if (overdue.length > 0) {
        const alertsHtml = overdue.map(c => {
            const dateInfo = calculateDaysInfo(c.lastAnnouncement);
            return `
                <div class="alert">
                    ⚠️ <strong>${c.name}</strong> is ${dateInfo.days} days overdue
                    (last: ${c.lastAnnouncement})
                </div>
            `;
        }).join('');
        const alertsSection = document.getElementById('alertsSection');
        alertsSection.innerHTML = alertsHtml;
        alertsSection.style.display = 'block';
    }
}

// =====================================================
// DATA EXPORT/IMPORT
// =====================================================

function setupDataExport() {
    const exportBtn      = document.getElementById('exportDataBtn');
    const importBtn      = document.getElementById('importDataBtn');
    const importFile     = document.getElementById('importFile');
    const exportHistoryBtn = document.getElementById('exportHistoryBtn');

    if (exportBtn)        exportBtn.addEventListener('click', exportDataToJSON);
    if (importBtn)        importBtn.addEventListener('click', () => importFile.click());
    if (importFile)       importFile.addEventListener('change', importDataFromJSON);
    if (exportHistoryBtn) exportHistoryBtn.addEventListener('click', exportNewsHistory);
}

function exportDataToJSON() {
    const dataToExport = {
        exportDate: new Date().toLocaleString(),
        companies: allData.companies.map(c => ({
            name: c.name,
            lastAnnouncement: c.lastAnnouncement,
            expectedNext: c.expectedNext,
            articleUrl: c.articleUrl || null
        }))
    };
    const dataStr  = JSON.stringify(dataToExport, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url  = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `news-brain-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showNotification('✅ Data exported! File downloaded', 'success');
}

function importDataFromJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported  = JSON.parse(e.target.result);
            const companies = imported.companies;
            let updated = 0;
            for (const company of companies) {
                const existing = allData.companies.find(c => c.name === company.name);
                if (existing) {
                    existing.lastAnnouncement = company.lastAnnouncement;
                    existing.expectedNext     = company.expectedNext;
                    existing.articleUrl       = company.articleUrl || null;
                    existing.isNewlyUpdated   = true;
                    updated++;
                }
            }
            localStorage.setItem('companiesData', JSON.stringify(allData.companies));
            renderTable(allData.companies);
            updateDashboard();
            showNotification(`✅ Imported ${updated} companies!`, 'success');
        } catch (error) {
            console.error('Import error:', error);
            showNotification('❌ Error importing file', 'error');
        }
    };
    reader.readAsText(file);
}

// =====================================================
// DRAG-DROP NEWS UPLOAD
// =====================================================

function setupDragDrop() {
    const dragZone = document.getElementById('dragDropZone');
    if (!dragZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dragZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dragZone.addEventListener(eventName, () => dragZone.classList.add('drag-over'));
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dragZone.addEventListener(eventName, () => dragZone.classList.remove('drag-over'));
    });
    dragZone.addEventListener('drop', handleDrop);

    const urlInput = document.getElementById('newsUrlInput');
    if (urlInput) {
        urlInput.addEventListener('paste', handleUrlPaste);
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { processNewsUrl(urlInput.value); urlInput.value = ''; }
        });
    }
}

function handleDrop(e) {
    const items = e.dataTransfer.items;
    if (items) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'string' && items[i].type === 'text/plain') {
                items[i].getAsString(processNewsUrl);
            }
        }
    }
}

function handleUrlPaste(e) {
    const url = e.clipboardData.getData('text');
    if (url.startsWith('http')) processNewsUrl(url);
}

function processNewsUrl(url) {
    console.log('📰 Processing URL:', url);
    showNotification('🔍 Analyzing article...', 'info');

    try {
        const result = extractNewsInfo(url);
        if (!result.company) { showNotification('❌ Could not identify company', 'error'); return; }

        const isPastResults = confirm(
            `🏢 Company: ${result.company}\n\n` +
            `Is this article about PAST earnings results?\n\n` +
            `✅ OK     → 📊 YES — past results (updates "Last Announcement")\n` +
            `❌ Cancel → 📅 NO  — future date announcement (saves to "Upcoming Earnings")`
        );

        if (isPastResults) {
            if (!result.date) result.date = extractDateFromQuarter(url);
            if (!result.date) {
                const manualDate = prompt(
                    `📅 Enter the earnings RESULTS date:\n\nCompany: ${result.company}\nExamples: 2026-04-07 | April 7 2026`, '');
                if (!manualDate) { showNotification('⏸️ Cancelled', 'warning'); return; }
                result.date = extractDateFromText(manualDate) || (isValidDate(manualDate) ? manualDate : null);
                if (!result.date) { showNotification('❌ Could not parse that date', 'error'); return; }
            }
            updateCompanyNews(result.company, result.date, url);
            addNewsToHistory(result.company, result.date, url, 'url-paste');
            showNotification(`✅ Last Announcement updated: ${result.company} → ${result.date}`, 'success');
        } else {
            let announcedDate = extractAnnouncedDateFromUrl(url) || extractDateFromQuarter(url);
            if (!announcedDate) {
                const manualDate = prompt(
                    `📅 Enter the UPCOMING earnings date:\n\nCompany: ${result.company}\nExamples: 2026-05-06 | May 6 2026`, '');
                if (!manualDate) { showNotification('⏸️ Cancelled', 'warning'); return; }
                announcedDate = extractDateFromText(manualDate) || (isValidDate(manualDate) ? manualDate : null);
                if (!announcedDate) { showNotification('❌ Could not parse that date', 'error'); return; }
            }
            saveAnnouncedDate(result.company, announcedDate, url);
            addNewsToHistory(result.company, announcedDate, url, 'announced-date');
            renderTable(allData.companies);
            showNotification(`📅 Upcoming Earnings saved: ${result.company} → ${announcedDate}`, 'success');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('❌ Error processing URL', 'error');
    }
}

function handleAddAnnounced(companyName) {
    const date = prompt(`📅 Enter confirmed earnings date for ${companyName}:\n\nFormat: YYYY-MM-DD\nExample: 2026-07-15`, '');
    if (!date || !isValidDate(date)) {
        if (date) showNotification('❌ Invalid date. Use YYYY-MM-DD', 'error');
        return;
    }
    const url = prompt(`🔗 Paste source article URL (optional — press OK to skip):`, '') || null;
    saveAnnouncedDate(companyName, date, url && url.startsWith('http') ? url : null);
    renderTable(allData.companies);
    showNotification(`📅 Confirmed date saved for ${companyName}`, 'success');
}

function handleClearAnnounced(companyName) {
    if (!confirm(`Remove announced date for ${companyName}?`)) return;
    clearAnnouncedDate(companyName);
    renderTable(allData.companies);
    showNotification(`🗑️ Cleared announced date for ${companyName}`, 'info');
}

// ═══════════════════════════════════════════════════════
// SMART EXTRACTION ENGINE
// ═══════════════════════════════════════════════════════

const COMPANY_ALIASES = {
    'gray':            'Gray Television',
    'graymedia':       'Gray Television',
    'gray-media':      'Gray Television',
    'gray-television': 'Gray Television',
    'netflix':         'Netflix',
    'disney':          'Disney',
    'amazon':          'Amazon',
    'bilibili':        'Bilibili',
    'nexstar':         'Nexstar',
    'roku':            'Roku',
    'paramount':       'Paramount',
    'comcast':         'Comcast',
    'warnerbrос':      'Warner Bros Discovery',
    'warnerbros':      'Warner Bros Discovery',
    'foxcorp':         'Fox Corporation',
    'fox-corp':        'Fox Corporation',
    'amcnetworks':     'AMC Networks',
    'lionsgate':       'Lionsgate',
    'univmusic':       'Universal Music Group',
    'universalmusic':  'Universal Music Group',
    'wmg':             'Warner Music Group',
    'imax':            'IMAX',
    'fubo':            'Fubo TV',
    'tko':             'TKO Group',
    'tegna':           'TEGNA',
    'scripps':         'Scripps',
    'multichoice':     'MultiChoice',
    'saregama':        'Saregama',
    'zee':             'Zee Entertainment',
    'sony':            'Sony',
    'cjenm':           'CJ ENM',
    'smtown':          'SM Entertainment',
    'toho':            'Toho',
    'fuji':            'Fuji Media',
    'ntv':             'NTV',
    'itv':             'ITV',
    'tf1':             'TF1',
    'vivendi':         'Vivendi',
    'canal':           'Canal+',
    'banijay':         'Banijay',
    'rtl':             'RTL Group',
    'prosiebensat':    'ProSiebenSat.1',
    'prosieben':       'ProSiebenSat.1',
    'viaplay':         'Viaplay Group',
    'quebecor':        'Quebecor',
    'rogers':          'Rogers',
    'bce':             'BCE',
    'cineplex':        'Cineplex',
    'televisa':        'Televisa',
    'megacable':       'Megacable',
    'grupoclarin':     'Grupo Clarin',
    'telecomargentina':'Telecom Argentina',
};

const MONTH_MAP = {
    'january':'01','february':'02','march':'03','april':'04',
    'may':'05','june':'06','july':'07','august':'08',
    'september':'09','october':'10','november':'11','december':'12',
    'jan':'01','feb':'02','mar':'03','apr':'04',
    'jun':'06','jul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12'
};

function extractNewsInfo(url) {
    const result   = { company: null, date: null };
    const urlLower = url.toLowerCase();
    const companies = allData.companies || [];

    for (const company of companies) {
        const key = company.name.toLowerCase().replace(/\s+/g, '');
        if (urlLower.includes(key)) { result.company = company.name; break; }
    }

    if (!result.company) {
        for (const [keyword, companyName] of Object.entries(COMPANY_ALIASES)) {
            if (urlLower.includes(keyword.toLowerCase())) { result.company = companyName; break; }
        }
    }

    if (!result.company) {
        for (const company of companies) {
            const words     = company.name.toLowerCase().split(/\s+/);
            const meaningful = words.filter(w => w.length > 3 &&
                !['media','group','studio','studios','entertainment','holdings',
                  'network','networks','corp','inc','ltd','the'].includes(w));
            if (meaningful.some(w => urlLower.includes(w))) { result.company = company.name; break; }
        }
    }

    result.date = extractDateFromText(url);
    return result;
}

function extractAnnouncedDateFromUrl(url) {
    const cleanUrl = url.replace(/\/news[-_]release\/\d{4}\/\d{2}\/\d{2}\/[^/]+\//i, ' ')
                        .replace(/\/\d{4}\/\d{2}\/\d{2}\//g, ' ');
    return extractDateFromText(cleanUrl) || extractDateFromText(url);
}

function extractDateFromText(text) {
    if (!text) return null;
    const patterns = [
        { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, y:1, m:2, d:3 },
        { re: /\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/, y:1, m:2, d:3 },
        { re: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[,.\s-]+(\d{1,2})[,.\s-]+(\d{4})\b/i, y:3, m:'name', d:2 },
        { re: /\b(\d{1,2})[,.\s-]+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[,.\s-]+(\d{4})\b/i, y:3, m:'name2', d:1 },
        { re: /\b(\d{2})[/-](\d{2})[/-](\d{4})\b/, y:3, m:2, d:1 },
        { re: /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/, y:3, m:1, d:2 },
    ];
    for (const p of patterns) {
        const match = text.match(p.re);
        if (!match) continue;
        try {
            let year = match[p.y], month, day;
            if (p.m === 'name')  { month = MONTH_MAP[match[1].toLowerCase()]; day = match[p.d]; }
            else if (p.m === 'name2') { month = MONTH_MAP[match[2].toLowerCase()]; day = match[p.d]; }
            else { month = match[p.m]; day = match[p.d]; }
            const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            if (isValidDate(dateStr)) return dateStr;
        } catch(e) { continue; }
    }
    return null;
}

function extractDateFromQuarter(text) {
    const quarters = [
        { re: /\b(?:first[- ]quarter|q1)\b.*?\b(20\d{2})\b/i,  month: 4  },
        { re: /\b(?:second[- ]quarter|q2)\b.*?\b(20\d{2})\b/i, month: 7  },
        { re: /\b(?:third[- ]quarter|q3)\b.*?\b(20\d{2})\b/i,  month: 10 },
        { re: /\b(?:fourth[- ]quarter|q4)\b.*?\b(20\d{2})\b/i, month: 1  },
        { re: /\bq1[- ](20\d{2})\b/i, month: 4  },
        { re: /\bq2[- ](20\d{2})\b/i, month: 7  },
        { re: /\bq3[- ](20\d{2})\b/i, month: 10 },
        { re: /\bq4[- ](20\d{2})\b/i, month: 1  },
    ];
    for (const q of quarters) {
        const m = text.match(q.re);
        if (m) {
            let year = parseInt(m[1]);
            if (q.month === 1) year += 1;
            const dateStr = `${year}-${String(q.month).padStart(2,'0')}-15`;
            if (isValidDate(dateStr)) return dateStr;
        }
    }
    return null;
}

function isValidDate(dateStr) {
    const date = new Date(dateStr);
    return !isNaN(date.getTime()) && dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
}

function updateCompanyNews(companyName, newsDate, articleUrl) {
    const company = allData.companies.find(c => c.name === companyName);
    if (!company) throw new Error(`${companyName} not found`);

    company.lastAnnouncement = newsDate;
    company.articleUrl       = (articleUrl && articleUrl.trim()) ? articleUrl : null;
    company.isNewlyUpdated   = true;

    const nextDate = new Date(newsDate);
    nextDate.setDate(nextDate.getDate() + 90);
    company.expectedNext = nextDate.getFullYear() + '-' +
        String(nextDate.getMonth()+1).padStart(2,'0') + '-' +
        String(nextDate.getDate()).padStart(2,'0');

    clearAnnouncedDate(companyName);

    const dataToSave = allData.companies.map(c => ({
        name: c.name,
        lastAnnouncement: c.lastAnnouncement,
        expectedNext: c.expectedNext,
        articleUrl: c.articleUrl || null,
        region: c.region,
        bestSource: c.bestSource,
        irWebsite: c.irWebsite,
        pattern: c.pattern || 'Q'
    }));
    localStorage.setItem('companiesData', JSON.stringify(dataToSave));
    renderTable(allData.companies);
    updateDashboard();
    setTimeout(() => highlightCompanyRow(companyName), 100);
}

function highlightCompanyRow(companyName) {
    const rows = document.getElementById('tableBody').querySelectorAll('tr');
    rows.forEach(row => {
        const nameCell = row.querySelector('.company-name');
        if (nameCell && nameCell.textContent === companyName) {
            row.classList.add('newly-updated');
            setTimeout(() => row.classList.remove('newly-updated'), 3000);
        }
    });
}

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = `notification notification-${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.classList.add('show'), 10);
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// ═══════════════════════════════════════════════════════
// NEWS HISTORY PANEL — slide-in drawer per company
// ═══════════════════════════════════════════════════════

function setupNewsHistoryPanel() {
    const drawer = document.createElement('div');
    drawer.id = 'newsHistoryDrawer';
    drawer.innerHTML = `
        <div id="newsHistoryBackdrop" onclick="closeNewsHistory()" style="
            display:none; position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:999;
        "></div>
        <div id="newsHistoryPanel" style="
            display:none; position:fixed; right:0; top:0; height:100vh; width:360px;
            background:#fff; box-shadow:-4px 0 20px rgba(0,0,0,0.15);
            z-index:1000; overflow-y:auto; padding:24px 20px; font-family: inherit;
        ">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 id="newsHistoryTitle" style="margin:0;font-size:16px;">📰 News History</h3>
                <button onclick="closeNewsHistory()" style="border:none;background:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>
            </div>
            <div id="newsHistoryContent"></div>
        </div>
    `;
    document.body.appendChild(drawer);
}

function openNewsHistory(companyName) {
    const panel   = document.getElementById('newsHistoryPanel');
    const backdrop = document.getElementById('newsHistoryBackdrop');
    const title   = document.getElementById('newsHistoryTitle');
    const content = document.getElementById('newsHistoryContent');

    title.textContent = `📰 ${companyName}`;
    const company = (allData.companies || []).find(c => c.name === companyName);
    const history = getNewsHistory(companyName);

    let html = '';
    if (company && company.articleUrl) {
        html += `
            <div style="background:#f0fff4;border:1px solid #38a169;border-radius:8px;padding:12px;margin-bottom:16px;">
                <div style="font-size:11px;color:#38a169;font-weight:bold;margin-bottom:4px;">LATEST ARTICLE</div>
                <a href="${company.articleUrl}" target="_blank" style="font-size:13px;color:#2b6cb0;word-break:break-all;">
                    🔗 ${company.articleUrl.length > 60 ? company.articleUrl.substring(0,60) + '…' : company.articleUrl}
                </a>
                <div style="font-size:11px;color:#666;margin-top:4px;">Date: ${company.lastAnnouncement}</div>
            </div>
        `;
    }
    html += `
        <div style="margin-bottom:16px;">
            <div style="font-size:12px;color:#666;margin-bottom:6px;">Add article URL for ${companyName}:</div>
            <input id="quickUrlInput" type="text" placeholder="https://..." style="
                width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;
                border-radius:6px;font-size:13px;margin-bottom:6px;">
            <button onclick="quickAddUrl('${companyName.replace(/'/g,"\\'")}', document.getElementById('quickUrlInput').value)" style="
                background:#3182ce;color:#fff;border:none;padding:7px 14px;
                border-radius:6px;cursor:pointer;font-size:13px;width:100%;">📎 Attach URL</button>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
    `;
    if (history.length === 0) {
        html += `<div style="color:#999;font-size:13px;text-align:center;padding:20px 0;">No history yet for this company.</div>`;
    } else {
        html += `<div style="font-size:12px;color:#666;margin-bottom:8px;">ALL SAVED ARTICLES (${history.length})</div>`;
        html += history.map(entry => `
            <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px;">
                <div style="color:#2d3748;font-weight:600;">${entry.date}</div>
                <a href="${entry.url}" target="_blank" style="color:#3182ce;word-break:break-all;font-size:12px;">
                    🔗 ${entry.url.length > 55 ? entry.url.substring(0,55) + '…' : entry.url}
                </a>
                <div style="color:#999;font-size:11px;margin-top:3px;">${entry.timestamp} · ${entry.source}</div>
            </div>
        `).join('');
    }

    content.innerHTML = html;
    panel.style.display   = 'block';
    backdrop.style.display = 'block';
}

function closeNewsHistory() {
    document.getElementById('newsHistoryPanel').style.display   = 'none';
    document.getElementById('newsHistoryBackdrop').style.display = 'none';
}

function quickAddUrl(companyName, url) {
    if (!url || !url.startsWith('http')) {
        showNotification('❌ Please enter a valid URL starting with http', 'error');
        return;
    }
    let date = extractDateFromQuarter(url) || extractNewsInfo(url).date;
    if (!date) date = new Date().toISOString().split('T')[0];
    updateCompanyNews(companyName, date, url);
    addNewsToHistory(companyName, date, url, 'panel-add');
    showNotification(`✅ URL attached to ${companyName}`, 'success');
    openNewsHistory(companyName);
}
