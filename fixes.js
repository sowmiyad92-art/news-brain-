// ═══════════════════════════════════════════════════════════════
// fixes.js  v4  —  News Brain
// Changes from v3:
//  ✅ FIX: Upcoming dates now persist correctly across refreshes
//  ✅ FIX: Quick Update "Upcoming" tab always saves + re-renders
//  ✅ FIX: Company saves persist all fields (region, irWebsite etc.)
//  ✅ NEW: Upcoming-today banner highlights companies reporting TODAY
//  ✅ NEW: Upcoming-tomorrow banner (was there, now more reliable)
//  ✅ NEW: "Add Company" button is more prominent + in toolbar
//  ✅ NEW: Export/Import includes announcedDates for full backup
//  ✅ KEEP: Search, date filter, URL dialog, date extraction, headers
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    //  STORAGE KEY — single source of truth for upcoming dates
    //  (matches what script.js uses: 'announcedDates')
    // ─────────────────────────────────────────────────────────────
    const UPCOMING_KEY   = 'announcedDates';
    const COMPANIES_KEY  = 'companiesData';

    // ─────────────────────────────────────────────────────────────
    //  PATCH saveAnnouncedDate / clearAnnouncedDate immediately
    //  so they always flush to localStorage reliably
    // ─────────────────────────────────────────────────────────────
    function patchAnnouncedDateStorage() {
        // Override the versions in script.js with guaranteed-save versions
        window.saveAnnouncedDate = function(companyName, date, url) {
            if (!companyName || !date) return;
            let store = {};
            try { store = JSON.parse(localStorage.getItem(UPCOMING_KEY) || '{}'); } catch(_) {}
            store[companyName] = {
                date,
                url: url || null,
                timestamp: new Date().toLocaleString()
            };
            localStorage.setItem(UPCOMING_KEY, JSON.stringify(store));

            // Keep in-memory copy in sync
            if (window.announcedDates) {
                window.announcedDates[companyName] = store[companyName];
            }
            console.log('📅 [fixes] Saved upcoming:', companyName, '→', date);

            // Re-render table so badge appears immediately
            if (typeof renderTable === 'function' && window.allData?.companies) {
                renderTable(window.allData.companies);
            }
            // Re-fire upcoming alerts
            injectUpcomingAlerts();
        };

        window.clearAnnouncedDate = function(companyName) {
            let store = {};
            try { store = JSON.parse(localStorage.getItem(UPCOMING_KEY) || '{}'); } catch(_) {}
            delete store[companyName];
            localStorage.setItem(UPCOMING_KEY, JSON.stringify(store));
            if (window.announcedDates) delete window.announcedDates[companyName];
            if (typeof renderTable === 'function' && window.allData?.companies) {
                renderTable(window.allData.companies);
            }
            injectUpcomingAlerts();
        };

        window.getAnnouncedDate = function(companyName) {
            // Read live from localStorage so it's always fresh
            try {
                const store = JSON.parse(localStorage.getItem(UPCOMING_KEY) || '{}');
                return store[companyName] || null;
            } catch(_) { return null; }
        };

        // Patch loadAnnouncedDates so the count is correct on load
        window.loadAnnouncedDates = function() {
            try {
                const saved = localStorage.getItem(UPCOMING_KEY);
                window.announcedDates = saved ? JSON.parse(saved) : {};
                console.log('📅 [fixes] Loaded upcoming earnings for',
                    Object.keys(window.announcedDates).length, 'companies');
            } catch(e) { window.announcedDates = {}; }
        };
        // Re-run immediately so the in-memory copy is correct
        window.loadAnnouncedDates();
    }

    // ─────────────────────────────────────────────────────────────
    //  PATCH updateCompanyNews so it always saves to localStorage
    // ─────────────────────────────────────────────────────────────
    function patchUpdateCompanyNews() {
        const _orig = window.updateCompanyNews;
        window.updateCompanyNews = function(companyName, date, url) {
            // Call original
            if (typeof _orig === 'function') _orig(companyName, date, url);

            // Always flush to localStorage after, even if original forgets
            if (!window.allData?.companies) return;
            const dataToSave = window.allData.companies.map(c => ({
                name:             c.name,
                region:           c.region,
                lastAnnouncement: c.lastAnnouncement,
                expectedNext:     c.expectedNext,
                articleUrl:       c.articleUrl || null,
                irWebsite:        c.irWebsite || '#',
                bestSource:       c.bestSource || '',
                sourceReliability: c.sourceReliability || 3,
            }));
            localStorage.setItem(COMPANIES_KEY, JSON.stringify(dataToSave));

            // Refresh table
            if (typeof renderTable === 'function') renderTable(window.allData.companies);
            if (typeof updateDashboard === 'function') updateDashboard();
        };
    }

    // ─────────────────────────────────────────────────────────────
    //  PATCH quSave (Quick Update) so Upcoming tab reliably saves
    // ─────────────────────────────────────────────────────────────
    function patchQuickUpdate() {
        window.quSave = function() {
            const company = document.getElementById('quCompany')?.value;
            const date    = document.getElementById('quDate')?.value;
            const url     = document.getElementById('quUrl')?.value.trim() || null;

            if (!company) { if (typeof showNotification==='function') showNotification('⚠️ Select a company', 'warning'); return; }
            if (!date)    { if (typeof showNotification==='function') showNotification('⚠️ Pick a date', 'warning'); return; }

            const tab = window.quTab || 'past';

            if (tab === 'past') {
                // Past results → updates Last Announcement
                if (typeof updateCompanyNews === 'function') updateCompanyNews(company, date, url);
                if (typeof addNewsToHistory  === 'function') addNewsToHistory(company, date, url, 'quick-update');
                if (typeof showNotification  === 'function') showNotification(`✅ Last Announcement updated: ${company} → ${date}`, 'success');
            } else {
                // Upcoming → saves confirmed future date
                window.saveAnnouncedDate(company, date, url);  // uses our patched version
                if (typeof addNewsToHistory === 'function') addNewsToHistory(company, date, url, 'upcoming-date');
                if (typeof showNotification === 'function') showNotification(`📅 Upcoming Earnings saved: ${company} → ${date}`, 'success');
            }

            // Clear URL field
            const urlEl = document.getElementById('quUrl');
            if (urlEl) urlEl.value = '';
        };
    }

    // ─────────────────────────────────────────────────────────────
    //  PATCH handleClearAnnounced / handleAddAnnounced (script.js)
    // ─────────────────────────────────────────────────────────────
    function patchClearAdd() {
        window.handleClearAnnounced = function(companyName) {
            window.clearAnnouncedDate(companyName);
            if (typeof showNotification === 'function')
                showNotification(`🗑️ Upcoming date removed for ${companyName}`, 'warning');
        };

        window.handleAddAnnounced = function(companyName) {
            // Pre-fill Quick Update panel with this company and switch to Upcoming tab
            const sel = document.getElementById('quCompany');
            if (sel) sel.value = companyName;
            if (typeof window.quSetTab === 'function') window.quSetTab('upcoming');
            const dateEl = document.getElementById('quDate');
            if (dateEl) dateEl.focus();
            if (typeof showNotification === 'function')
                showNotification(`📅 Enter upcoming date for ${companyName} above ↑`, 'info');
        };
    }

    // ─────────────────────────────────────────────────────────────
    //  UPCOMING ALERTS — today + tomorrow banners
    // ─────────────────────────────────────────────────────────────
    function injectUpcomingAlerts() {
        // Remove old banners
        document.getElementById('nbUpcomingTodayBanner')?.remove();
        document.getElementById('nbUpcomingTomorrowBanner')?.remove();
        document.getElementById('tomorrowAlertBanner')?.remove();  // remove script.js's banner too

        const today = new Date(); today.setHours(0,0,0,0);
        const todayStr    = fmtDate(today);
        const tomorrowDt  = new Date(today); tomorrowDt.setDate(tomorrowDt.getDate() + 1);
        const tomorrowStr = fmtDate(tomorrowDt);

        const companies = window.allData?.companies || [];
        const store     = getUpcomingStore();

        // Companies reporting TODAY (confirmed)
        const todayList = companies.filter(c => {
            const ann = store[c.name]?.date;
            return ann === todayStr;
        });

        // Companies reporting TOMORROW (confirmed OR estimated)
        const tomorrowList = companies.filter(c => {
            const ann = store[c.name]?.date;
            return ann === tomorrowStr || (!ann && c.expectedNext === tomorrowStr);
        });

        const anchor = document.querySelector('#dragDropZone') ||
                       document.querySelector('#quickUpdatePanel') ||
                       document.querySelector('.controls');

        if (todayList.length > 0) {
            const banner = makeBanner(
                'nbUpcomingTodayBanner',
                `🔔 Earnings / Results TODAY!`,
                todayList,
                today,
                store,
                todayStr,
                { bg: 'linear-gradient(135deg,#fed7d7,#fc8181)', border: '#e53e3e', shadow: 'rgba(229,62,62,0.25)' }
            );
            if (anchor) anchor.parentNode.insertBefore(banner, anchor);
            else document.querySelector('.container')?.appendChild(banner);
        }

        if (tomorrowList.length > 0) {
            const tomorrowFormatted = tomorrowDt.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
            const banner = makeBanner(
                'nbUpcomingTomorrowBanner',
                `📅 Earnings tomorrow (${tomorrowFormatted})`,
                tomorrowList,
                tomorrowDt,
                store,
                tomorrowStr,
                { bg: 'linear-gradient(135deg,#fefcbf,#f6e05e)', border: '#d69e2e', shadow: 'rgba(214,158,46,0.2)' }
            );
            // Insert AFTER today banner if it exists
            const todayBanner = document.getElementById('nbUpcomingTodayBanner');
            const ref = todayBanner ? todayBanner.nextSibling : anchor;
            if (ref) ref.parentNode.insertBefore(banner, ref);
            else document.querySelector('.container')?.appendChild(banner);
        }
    }

    function makeBanner(id, title, list, dateDt, store, dateStr, colors) {
        const subject = encodeURIComponent(`${title}: ${list.map(c=>c.name).join(', ')}`);
        const body = encodeURIComponent(
            `${title}\n\n` +
            list.map(c => {
                const entry = store[c.name];
                const isConfirmed = entry?.date === dateStr;
                return `• ${c.name} — ${isConfirmed ? dateStr+' ✅ Confirmed' : (c.expectedNext||'')+' ~Est.'}` +
                    (entry?.url ? `\n  Source: ${entry.url}` : '') +
                    `\n  IR: ${c.irWebsite || ''}`;
            }).join('\n') +
            '\n\nSent from News Brain tracker.'
        );

        const div = document.createElement('div');
        div.id = id;
        div.style.cssText = 'margin:12px 0;';
        div.innerHTML = `
            <div style="
                background:${colors.bg};border:2px solid ${colors.border};
                border-radius:10px;padding:14px 20px;
                display:flex;align-items:center;justify-content:space-between;
                flex-wrap:wrap;gap:10px;font-size:14px;
                box-shadow:0 2px 8px ${colors.shadow};
            ">
                <div>
                    <strong>${title}</strong>
                    <div style="margin-top:6px;">
                    ${list.map(c => {
                        const isConfirmed = store[c.name]?.date === dateStr;
                        return `<span style="background:#fff;padding:2px 8px;border-radius:12px;margin:2px;display:inline-block;">
                            ${c.name}${isConfirmed ? ' ✅' : ' ~'}
                        </span>`;
                    }).join('')}
                    </div>
                    <div style="font-size:11px;color:#555;margin-top:4px;">✅ = confirmed date &nbsp; ~ = estimated</div>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0;">
                    <a href="mailto:?subject=${subject}&body=${body}" style="
                        background:${colors.border};color:#fff;text-decoration:none;
                        padding:7px 14px;border-radius:6px;font-weight:bold;white-space:nowrap;font-size:13px;">
                        ✉️ Email Alert
                    </a>
                    <button onclick="this.closest('[id]').remove()" style="
                        background:none;border:1px solid ${colors.border};color:#555;
                        padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px;">
                        ✕
                    </button>
                </div>
            </div>
        `;
        return div;
    }

    function getUpcomingStore() {
        try { return JSON.parse(localStorage.getItem(UPCOMING_KEY) || '{}'); } catch(_) { return {}; }
    }

    function fmtDate(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth()+1).padStart(2,'0') + '-' +
            String(d.getDate()).padStart(2,'0');
    }

    // ─────────────────────────────────────────────────────────────
    //  SEARCH — replace keyup listener
    // ─────────────────────────────────────────────────────────────
    function patchSearch() {
        const inp = document.getElementById('searchInput');
        if (!inp) return;
        const fresh = inp.cloneNode(true);
        inp.parentNode.replaceChild(fresh, inp);
        fresh.placeholder = '🔍 Search company, region, source, date…';
        fresh.addEventListener('input', doSearch);
        fresh.addEventListener('keyup', doSearch);
    }

    function doSearch(e) {
        const query = (e.target.value || '').trim().toLowerCase();
        if (!query) {
            const all  = window.allData?.companies || [];
            const cf   = window.currentFilter || 'all';
            const shown = cf === 'all' ? all : all.filter(c => c.region === cf);
            if (typeof renderTable === 'function') renderTable(shown);
            setHint(''); return;
        }
        const all      = window.allData?.companies || [];
        const store    = getUpcomingStore();
        const filtered = all.filter(c => {
            const ann = store[c.name]?.date || '';
            return [c.name, c.region, c.bestSource, ann, c.lastAnnouncement, c.expectedNext]
                .some(v => (v || '').toLowerCase().includes(query));
        });
        if (typeof renderTable === 'function') renderTable(filtered);
        setHint(`${filtered.length} result${filtered.length !== 1 ? 's' : ''}`);
    }

    function setHint(text) {
        let h = document.getElementById('nbSearchHint');
        if (!h) {
            h = document.createElement('span');
            h.id = 'nbSearchHint';
            h.style.cssText = 'font-size:12px;color:#718096;margin-left:8px;vertical-align:middle;pointer-events:none;';
            const inp = document.getElementById('searchInput');
            if (inp) inp.insertAdjacentElement('afterend', h);
        }
        h.textContent = text;
    }

    // ─────────────────────────────────────────────────────────────
    //  DATE FILTER
    // ─────────────────────────────────────────────────────────────
    function patchDateFilter() {
        if (document.getElementById('nbDateFilter')) return;
        const filterDiv = document.querySelector('.filter-buttons');
        if (!filterDiv) return;

        const wrap = document.createElement('div');
        wrap.id = 'nbDateFilterWrap';
        wrap.style.cssText = 'display:inline-flex;align-items:center;gap:5px;margin-left:8px;vertical-align:middle;';
        wrap.innerHTML = `
            <label for="nbDateFilter" style="font-size:12px;color:#718096;white-space:nowrap;">📆</label>
            <select id="nbDateFilter" style="padding:6px 10px;font-size:13px;border:1px solid #e2e8f0;
                border-radius:8px;cursor:pointer;background:#fff;color:#2d3748;outline:none;">
                <option value="all">All dates</option>
                <option value="today">Reporting today</option>
                <option value="tomorrow">Due tomorrow</option>
                <option value="7">Due in 7 days</option>
                <option value="14">Due in 14 days</option>
                <option value="30">Due in 30 days</option>
                <option value="overdue">Overdue 180d+</option>
            </select>
            <button type="button" id="nbDateFilterClear" style="padding:5px 9px;font-size:12px;
                border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;background:#fff;
                color:#718096;display:none;">✕</button>
        `;
        filterDiv.insertAdjacentElement('afterend', wrap);

        document.getElementById('nbDateFilter').addEventListener('change', applyDateFilter);
        document.getElementById('nbDateFilterClear').addEventListener('click', () => {
            document.getElementById('nbDateFilter').value = 'all';
            document.getElementById('nbDateFilterClear').style.display = 'none';
            setHint('');
            const all = window.allData?.companies || [];
            const cf  = window.currentFilter || 'all';
            const shown = cf === 'all' ? all : all.filter(c => c.region === cf);
            if (typeof renderTable === 'function') renderTable(shown);
        });
    }

    function applyDateFilter() {
        const val  = document.getElementById('nbDateFilter')?.value;
        const clrB = document.getElementById('nbDateFilterClear');
        if (clrB) clrB.style.display = val === 'all' ? 'none' : 'inline-block';

        if (val === 'all') {
            const all = window.allData?.companies || [];
            const cf  = window.currentFilter || 'all';
            const shown = cf === 'all' ? all : all.filter(c => c.region === cf);
            if (typeof renderTable === 'function') renderTable(shown);
            setHint(''); return;
        }

        const all   = window.allData?.companies || [];
        const store = getUpcomingStore();
        const today = new Date(); today.setHours(0,0,0,0);
        const todayStr = fmtDate(today);

        const filtered = all.filter(c => {
            const ann    = store[c.name]?.date;
            const watch  = new Date(ann || c.expectedNext || ''); watch.setHours(0,0,0,0);
            const last   = new Date(c.lastAnnouncement || '');    last.setHours(0,0,0,0);
            const dAhead = Math.round((watch - today) / 86400000);
            const dBehind= Math.round((today - last)  / 86400000);

            if (val === 'today')    return ann === todayStr;
            if (val === 'tomorrow') return dAhead === 1;
            if (val === '7')        return dAhead >= 0 && dAhead <= 7;
            if (val === '14')       return dAhead >= 0 && dAhead <= 14;
            if (val === '30')       return dAhead >= 0 && dAhead <= 30;
            if (val === 'overdue')  return dBehind > 180;
            return false;
        });

        if (typeof renderTable === 'function') renderTable(filtered);
        setHint(`${filtered.length} result${filtered.length !== 1 ? 's' : ''}`);
    }

    // ─────────────────────────────────────────────────────────────
    //  URL DIALOG — patched processNewsUrl
    // ─────────────────────────────────────────────────────────────
    function patchProcessNewsUrl() {
        window.processNewsUrl = function (url) {
            if (!url || !url.startsWith('http')) return;
            console.log('📰 Processing URL:', url);

            const result = (typeof extractNewsInfo === 'function')
                ? extractNewsInfo(url) : { company: null, date: null };

            if (!result?.company) {
                if (typeof showNotification === 'function')
                    showNotification('❌ Could not identify company from this URL', 'error');
                return;
            }

            let announcedDate = smartExtractFutureDate(url);
            if (!announcedDate) announcedDate = smartExtractFromQuarter(url);
            let anyDate = result.date
                || (typeof extractDateFromText === 'function' ? extractDateFromText(url) : null)
                || (typeof extractDateFromQuarter === 'function' ? extractDateFromQuarter(url) : null);

            const companyLine = `Company:  ${result.company}`;
            const dateLine    = announcedDate
                ? `Detected date:  ${announcedDate}`
                : (anyDate ? `Detected date:  ${anyDate}  (article publish date)` : 'No date auto-detected');

            const choice = confirm(
                `${companyLine}\n${dateLine}\n\n` +
                `─────────────────────────────────────────\n\n` +
                `  ✅  OK  →  Save to  📌 ANNOUNCED DATE\n` +
                `            (upcoming earnings date)\n\n` +
                `  ❌  Cancel  →  Save to  📊 LAST ANNOUNCEMENT\n` +
                `               (results already released)`
            );

            if (choice) {
                let dateToSave = announcedDate;
                if (!dateToSave) {
                    const manual = prompt(`📅 Enter the UPCOMING earnings date for ${result.company}:\nFormat: YYYY-MM-DD`, '');
                    if (!manual) { if (typeof showNotification==='function') showNotification('⏸️ Cancelled', 'warning'); return; }
                    dateToSave = (typeof extractDateFromText==='function' ? extractDateFromText(manual) : null) || manual;
                }
                window.saveAnnouncedDate(result.company, dateToSave, url);
                if (typeof addNewsToHistory === 'function') addNewsToHistory(result.company, dateToSave, url, 'announced-date');
                if (typeof showNotification === 'function') showNotification(`📌 Upcoming date saved for ${result.company}: ${dateToSave}`, 'success');
            } else {
                let dateToSave = anyDate;
                if (!dateToSave) {
                    const manual = prompt(`📅 Enter the date results were released for ${result.company}:\nFormat: YYYY-MM-DD`, '');
                    if (!manual) { if (typeof showNotification==='function') showNotification('⏸️ Cancelled', 'warning'); return; }
                    dateToSave = manual;
                }
                if (typeof updateCompanyNews === 'function') updateCompanyNews(result.company, dateToSave, url);
                if (typeof addNewsToHistory  === 'function') addNewsToHistory(result.company, dateToSave, url, 'url-paste');
                if (typeof showNotification  === 'function') showNotification(`✅ Last Announcement updated for ${result.company}: ${dateToSave}`, 'success');
            }
        };
    }

    // ─────────────────────────────────────────────────────────────
    //  DATE EXTRACTION
    // ─────────────────────────────────────────────────────────────
    function patchDateExtraction() {
        window.extractAnnouncedDateFromUrl = smartExtractFutureDate;
        const _origQ = window.extractDateFromQuarter;
        window.extractDateFromQuarter = t => smartExtractFromQuarter(t) || (_origQ?.(t) ?? null);
    }

    const MMAP = {
        january:'01',february:'02',march:'03',april:'04',
        may:'05',june:'06',july:'07',august:'08',
        september:'09',october:'10',november:'11',december:'12',
        jan:'01',feb:'02',mar:'03',apr:'04',
        jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'
    };

    function smartExtractFutureDate(url) {
        let text = url;
        try { text = decodeURIComponent(url); } catch(_) {}
        let clean = text
            .replace(/\/\d{4}\/\d{2}\/\d{2}\//g, ' ')
            .replace(/\/news[-_]release\/\d{4}\/\d{2}\/\d{2}\//ig, ' ')
            .replace(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(\d{4,})\b/g, ' ')
            .replace(/_\d{14,}/g, ' ');
        return extractDateFromCleanText(clean) || inferMonthDay(clean)
            || extractDateFromCleanText(url)   || inferMonthDay(url);
    }

    function extractDateFromCleanText(text) {
        if (!text) return null;
        const patterns = [
            { re: /\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/, y:1, m:2, d:3 },
            { re: /\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b(?!\d)/, y:1, m:2, d:3 },
            { re: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[,.\s\-_]+(\d{1,2})[,.\s\-_]+(\d{4})\b/i, y:3, m:'name', d:2 },
            { re: /\b(\d{1,2})[,.\s\-_]+(january|february|march|april|may|june|july|august|september|october|november|december)[,.\s\-_]+(\d{4})\b/i, y:3, m:'name2', d:1 },
        ];
        for (const p of patterns) {
            const match = text.match(p.re);
            if (!match) continue;
            try {
                const year = match[p.y];
                let month, day;
                if      (p.m === 'name')  { month = MMAP[match[1].toLowerCase()]; day = match[p.d]; }
                else if (p.m === 'name2') { month = MMAP[match[2].toLowerCase()]; day = match[p.d]; }
                else                      { month = match[p.m]; day = match[p.d]; }
                const ds = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                if (isValidDateStr(ds)) return ds;
            } catch(_) { continue; }
        }
        return null;
    }

    function inferMonthDay(text) {
        const re = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[,.\s\-_]+(\d{1,2})\b(?!\s*,?\s*\d{4})/i;
        const m  = text.match(re);
        if (!m) return null;
        const month = MMAP[m[1].toLowerCase()];
        const day   = parseInt(m[2]);
        if (!month || day < 1 || day > 31) return null;
        const today = new Date(); today.setHours(0,0,0,0);
        let year = today.getFullYear();
        const cand = new Date(year, parseInt(month)-1, day); cand.setHours(0,0,0,0);
        if (cand < today) year++;
        const ds = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        return isValidDateStr(ds) ? ds : null;
    }

    function smartExtractFromQuarter(text) {
        const qMap = [
            { re: /\b(?:first[-\s]quarter|q1)\b/i,  month: 4 },
            { re: /\b(?:second[-\s]quarter|q2)\b/i, month: 7 },
            { re: /\b(?:third[-\s]quarter|q3)\b/i,  month: 10 },
            { re: /\b(?:fourth[-\s]quarter|q4)\b/i, month: 1 },
        ];
        const fyM = text.match(/\b(q[1-4])[-\s]?fy(\d{2,4})\b/i);
        if (fyM) {
            const qn = parseInt(fyM[1][1]);
            let yr = parseInt(fyM[2]); if (yr < 100) yr += 2000;
            const mo = [4,7,10,1][qn-1];
            if (mo === 1) yr++;
            const ds = `${yr}-${String(mo).padStart(2,'0')}-15`;
            return isValidDateStr(ds) ? ds : null;
        }
        for (const q of qMap) {
            const r1 = new RegExp(q.re.source + '[\\s\\S]{0,40}?\\b(20\\d{2})\\b', 'i');
            const m1 = text.match(r1);
            if (m1) {
                let yr = parseInt(m1[m1.length-1]);
                if (q.month === 1) yr++;
                const ds = `${yr}-${String(q.month).padStart(2,'0')}-15`;
                return isValidDateStr(ds) ? ds : null;
            }
        }
        return null;
    }

    function isValidDateStr(s) {
        if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
        return !isNaN(new Date(s).getTime());
    }

    // ─────────────────────────────────────────────────────────────
    //  COLUMN HEADERS
    // ─────────────────────────────────────────────────────────────
    function patchColumnHeaders() {
        const ths = document.querySelectorAll('.companies-table thead th');
        const tips = {
            2: ['Last Announcement', 'Date earnings results were RELEASED (past).'],
            3: ['Days Since',        'Days elapsed since last quarterly results.'],
            4: ['Expected Next (~Est.)', 'Auto-calculated: Last Announcement + 90 days.'],
            5: ['Upcoming Earnings 📌', 'CONFIRMED future date the company will report.\nSet via Quick Update → Upcoming Date tab or "+ Add" button.\nSaved permanently — survives page refresh.'],
        };
        ths.forEach((th, i) => {
            if (!tips[i]) return;
            th.innerHTML = `${tips[i][0]} <span class="nb-col-help" title="${tips[i][1]}">?</span>`;
        });
    }

    // ─────────────────────────────────────────────────────────────
    //  ADD COMPANY — prominent button with full-persistence save
    // ─────────────────────────────────────────────────────────────
    function injectAddCompanyButton() {
        if (document.getElementById('nbAddCompanyBtn')) return;
        const tableSection = document.querySelector('.table-section');
        if (!tableSection) return;

        const btn = document.createElement('button');
        btn.id = 'nbAddCompanyBtn';
        btn.type = 'button';
        btn.innerHTML = '＋ Add Company';
        btn.style.cssText = `
            margin-bottom:10px;padding:9px 22px;
            background:linear-gradient(135deg,#3182ce,#2b6cb0);
            color:#fff;border:none;border-radius:8px;cursor:pointer;
            font-size:14px;font-weight:700;display:block;
            box-shadow:0 2px 6px rgba(49,130,206,0.35);
            transition:transform .1s,box-shadow .1s;
        `;
        btn.onmouseenter = () => { btn.style.transform='translateY(-1px)'; btn.style.boxShadow='0 4px 10px rgba(49,130,206,0.4)'; };
        btn.onmouseleave = () => { btn.style.transform=''; btn.style.boxShadow='0 2px 6px rgba(49,130,206,0.35)'; };
        btn.onclick = openAddCompanyModal;
        tableSection.insertAdjacentElement('beforebegin', btn);
    }

    window.openAddCompanyModal = function() {
        if (document.getElementById('nbAddCompanyOverlay')) return;
        const regions = ['North America', 'Europe', 'Asia', 'Africa', 'Latin America', 'Middle East'];
        const sources = ['IR Website', 'GNews', 'Yahoo Finance', 'PR Newswire', 'Business Wire'];

        const overlay = document.createElement('div');
        overlay.id = 'nbAddCompanyOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:3000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:14px;padding:28px 32px;width:440px;
                max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.2);font-family:inherit;max-height:90vh;overflow-y:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                    <h3 style="margin:0;font-size:17px;">➕ Add New Company</h3>
                    <button onclick="document.getElementById('nbAddCompanyOverlay').remove()"
                        style="border:none;background:none;font-size:22px;cursor:pointer;color:#999;">&times;</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <div>
                        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Company Name *</label>
                        <input id="nbAddName" type="text" placeholder="e.g. Apple" style="
                            width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #ddd;
                            border-radius:8px;font-size:14px;outline:none;">
                    </div>
                    <div>
                        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Region *</label>
                        <select id="nbAddRegion" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;background:#fff;">
                            ${regions.map(r => `<option>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Last Announcement Date *</label>
                        <input id="nbAddDate" type="date" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
                    </div>
                    <div>
                        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">
                            Upcoming Earnings Date <span style="color:#3182ce;font-weight:600;">(optional — saves confirmed date)</span>
                        </label>
                        <input id="nbAddUpcoming" type="date" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
                    </div>
                    <div>
                        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">IR Website URL (optional)</label>
                        <input id="nbAddIR" type="text" placeholder="https://ir.example.com" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
                    </div>
                    <div>
                        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Best Source</label>
                        <select id="nbAddSource" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;background:#fff;">
                            ${sources.map(s => `<option>${s}</option>`).join('')}
                        </select>
                    </div>
                    <div id="nbAddError" style="color:#e53e3e;font-size:13px;display:none;"></div>
                    <button onclick="window.submitAddCompany()" style="
                        background:linear-gradient(135deg,#38a169,#276749);color:#fff;border:none;
                        padding:11px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;margin-top:4px;">
                        ➕ Add Company
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.getElementById('nbAddName').focus();
    };

    window.submitAddCompany = function() {
        const name     = document.getElementById('nbAddName')?.value.trim();
        const region   = document.getElementById('nbAddRegion')?.value;
        const dateVal  = document.getElementById('nbAddDate')?.value;
        const upcoming = document.getElementById('nbAddUpcoming')?.value;
        const irUrl    = document.getElementById('nbAddIR')?.value.trim();
        const source   = document.getElementById('nbAddSource')?.value;
        const errEl    = document.getElementById('nbAddError');

        if (!name)    { errEl.textContent='⚠️ Company name is required';         errEl.style.display='block'; return; }
        if (!dateVal) { errEl.textContent='⚠️ Last announcement date is required'; errEl.style.display='block'; return; }

        const exists = (window.allData?.companies || []).find(c => c.name.toLowerCase() === name.toLowerCase());
        if (exists) { errEl.textContent=`⚠️ "${name}" already exists`; errEl.style.display='block'; return; }

        const lastDate = new Date(dateVal);
        const nextDate = new Date(lastDate); nextDate.setDate(nextDate.getDate() + 90);
        const expectedNext = fmtDate(nextDate);

        const newCompany = {
            name, region,
            lastAnnouncement: dateVal,
            expectedNext,
            irWebsite: irUrl || '#',
            bestSource: source,
            sourceReliability: 3,
            articleUrl: null,
            isNewlyUpdated: true
        };

        if (!window.allData) window.allData = { companies: [] };
        window.allData.companies.push(newCompany);

        // Full-field save so company survives refresh
        const dataToSave = window.allData.companies.map(c => ({
            name:             c.name,
            region:           c.region,
            lastAnnouncement: c.lastAnnouncement,
            expectedNext:     c.expectedNext,
            articleUrl:       c.articleUrl || null,
            irWebsite:        c.irWebsite || '#',
            bestSource:       c.bestSource || '',
            sourceReliability: c.sourceReliability || 3,
        }));
        localStorage.setItem(COMPANIES_KEY, JSON.stringify(dataToSave));

        // Save upcoming confirmed date if provided
        if (upcoming) {
            window.saveAnnouncedDate(name, upcoming, null);
        }

        // Rebuild the Quick Update company dropdown
        const sel = document.getElementById('quCompany');
        if (sel) {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            // insert alphabetically
            let inserted = false;
            for (const o of sel.options) {
                if (o.value && o.value.localeCompare(name) > 0) {
                    sel.insertBefore(opt, o); inserted = true; break;
                }
            }
            if (!inserted) sel.appendChild(opt);
        }

        if (typeof renderTable   === 'function') renderTable(window.allData.companies);
        if (typeof updateDashboard=== 'function') updateDashboard();
        if (typeof showNotification==='function') showNotification(`✅ Added ${name} to tracker!`, 'success');

        injectUpcomingAlerts();
        document.getElementById('nbAddCompanyOverlay').remove();
    };

    // ─────────────────────────────────────────────────────────────
    //  STYLES
    // ─────────────────────────────────────────────────────────────
    function injectStyles() {
        const s = document.createElement('style');
        s.textContent = `
            .nb-col-help{display:inline-flex;align-items:center;justify-content:center;
              width:15px;height:15px;background:#a0aec0;color:#fff;border-radius:50%;
              font-size:10px;cursor:help;margin-left:4px;font-weight:700;vertical-align:middle}
            .nb-col-help:hover{background:#3182ce}
            .announced-date-confirmed{display:inline-flex;align-items:center;flex-wrap:wrap;gap:3px;
              background:#ebf8ff;border:1px solid #90cdf4;border-radius:8px;
              padding:3px 8px;font-size:12px;font-weight:600;color:#2c5282}
            .nb-ann-badge{font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:4px;white-space:nowrap}
            .nb-ann-today   {background:#fed7d7;color:#c53030}
            .nb-ann-tomorrow{background:#fefcbf;color:#744210}
            .nb-ann-soon    {background:#fef3c7;color:#92400e}
            .nb-ann-future  {background:#e6fffa;color:#234e52}
            .nb-ann-past    {background:#f0fff4;color:#276749}
            .announced-date-empty{color:#a0aec0;font-size:12px;cursor:pointer;
              padding:2px 6px;border-radius:4px;border:1px dashed #cbd5e0;transition:all .15s}
            .announced-date-empty:hover{color:#3182ce;border-color:#3182ce;background:#ebf8ff}
            .nb-ann-today-row{background:linear-gradient(90deg,#fff5f5,#fff)!important;
              border-left:4px solid #fc8181!important;}
            #nbDateFilter:focus{border-color:#3182ce;box-shadow:0 0 0 2px rgba(49,130,206,.15)}
            #nbSearchHint{pointer-events:none}
            .announced-clear{cursor:pointer;color:#fc8181;font-weight:bold;margin-left:4px;font-size:14px;}
            .announced-link{margin-left:3px;text-decoration:none;font-size:12px;}
        `;
        document.head.appendChild(s);
    }

    // ─────────────────────────────────────────────────────────────
    //  EXPORT/IMPORT — extended to include announcedDates
    // ─────────────────────────────────────────────────────────────
    function patchExportImport() {
        // Override exportDataToJSON to include upcoming dates
        window.exportDataToJSON = function() {
            const dataToExport = {
                exportDate: new Date().toLocaleString(),
                version: 4,
                companies: (window.allData?.companies || []).map(c => ({
                    name:             c.name,
                    region:           c.region,
                    lastAnnouncement: c.lastAnnouncement,
                    expectedNext:     c.expectedNext,
                    articleUrl:       c.articleUrl || null,
                    irWebsite:        c.irWebsite || '#',
                    bestSource:       c.bestSource || '',
                    sourceReliability: c.sourceReliability || 3,
                })),
                upcomingDates: getUpcomingStore(),
                newsHistory:   JSON.parse(localStorage.getItem('newsHistory') || '[]'),
            };
            const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `news-brain-backup-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            if (typeof showNotification === 'function') showNotification('✅ Full backup exported (includes upcoming dates)!', 'success');
        };
    }

    // ─────────────────────────────────────────────────────────────
    //  BOOT SEQUENCE
    // ─────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // These can run immediately (no data dependency)
        patchDateExtraction();
        patchAnnouncedDateStorage();   // ← patch storage FIRST, before script.js uses it
        injectStyles();

        // Wait for allData to be populated (script.js loads it async)
        let attempts = 0;
        const waitForData = setInterval(() => {
            attempts++;
            if (window.allData && window.allData.companies && window.allData.companies.length > 0) {
                clearInterval(waitForData);

                patchSearch();
                patchDateFilter();
                patchProcessNewsUrl();
                patchColumnHeaders();
                patchUpdateCompanyNews();
                patchQuickUpdate();
                patchClearAdd();
                patchExportImport();
                injectAddCompanyButton();

                // Show today/tomorrow banners
                injectUpcomingAlerts();

                // Re-render table so announcedDates badges use patched getAnnouncedDate
                if (typeof renderTable === 'function') {
                    renderTable(window.allData.companies);
                }

                console.log('[fixes v4] All patches applied ✅');
            } else if (attempts > 60) {
                clearInterval(waitForData);
                console.warn('[fixes v4] allData never loaded — skipping patches');
            }
        }, 100);
    });

    // Test helper (type testUrls() in console to verify date extraction)
    window.testUrls = function () {
        const cases = [
            ['https://ir.fubo.tv/news/news-details/2026/Fubo-to-Announce-Q2-FY26-Financial-Results-on-May-6-2026/default.aspx','2026-05-06'],
            ['https://finance.yahoo.com/markets/stocks/articles/imax-corporation-announce-first-quarter-200500982.html','2026-04-15'],
            ['https://www.bce.ca/news-and-media/newsroom?article=bce-q1-2026-results-to-be-announced-may-7','2026-05-07'],
        ];
        cases.forEach(([url, expected], i) => {
            const got = smartExtractFutureDate(url) || smartExtractFromQuarter(url);
            console.log(`${got===expected?'✅':'❌'} [${i+1}] expected ${expected}, got ${got}`);
        });
    };

})();