// ═══════════════════════════════════════════════════════════════
// quick-update-3col.js — 3-column independent date entry
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    window.quSave3Column = function() {
        const company     = document.getElementById('quCompany')?.value;
        const pastDate    = document.getElementById('quDatePast')?.value;
        const upcomingDate= document.getElementById('quDateUpcoming')?.value;
        const pattern     = document.getElementById('quPattern')?.value;
        const url         = document.getElementById('quUrl')?.value.trim() || null;

        if (!company) { alert('⚠️ Select a company first'); return; }
        if (!pastDate && !upcomingDate && !pattern) {
            alert('⚠️ Fill at least one field'); return;
        }

        let companiesData  = JSON.parse(localStorage.getItem('companiesData')  || '[]');
        let announcedDates = JSON.parse(localStorage.getItem('announcedDates') || '{}');
        let newsHistory    = JSON.parse(localStorage.getItem('newsHistory')    || '[]');

        const companyObj = companiesData.find(c => c.name === company);
        if (!companyObj) { alert('❌ Company not found'); return; }

        let updated = [];

        // 1. Last Announcement
        if (pastDate) {
            companyObj.lastAnnouncement = pastDate;
            if (announcedDates[company]) {
                delete announcedDates[company];
                console.log(`🧹 Cleared old upcoming date for ${company}`);
            }
            const nextDate = new Date(pastDate);
            nextDate.setDate(nextDate.getDate() + 90);
            companyObj.expectedNext = nextDate.toISOString().split('T')[0];
            if (url) companyObj.articleUrl = url;
            newsHistory.push({
                company, date: pastDate, url,
                source: 'quick-3col-past',
                timestamp: new Date().toISOString(),
                id: Date.now()
            });
            updated.push('Last Announcement');
        }

        // 2. Upcoming Confirmed
        if (upcomingDate) {
            announcedDates[company] = {
                date: upcomingDate, url,
                timestamp: new Date().toISOString()
            };
            newsHistory.push({
                company, date: upcomingDate, url,
                source: 'quick-3col-upcoming',
                timestamp: new Date().toISOString(),
                id: Date.now() + 1
            });
            updated.push('Upcoming Confirmed');
        }

        // 3. Pattern
        if (pattern) {
            companyObj.pattern = pattern;
            updated.push(`Pattern → ${pattern}`);
        }

        // Keep last 100 history
        if (newsHistory.length > 100) newsHistory = newsHistory.slice(-100);

        localStorage.setItem('companiesData',  JSON.stringify(companiesData));
        localStorage.setItem('announcedDates', JSON.stringify(announcedDates));
        localStorage.setItem('newsHistory',    JSON.stringify(newsHistory));

        console.log('✅ Saved:', company, updated);
        window.location.reload();
    };

   // Populate company dropdown on load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const sel = document.getElementById('quCompany');
        if (!sel) return;

        // Try localStorage first, fall back to window.DATA
        let companiesData = JSON.parse(localStorage.getItem('companiesData') || '[]');
        if (companiesData.length === 0 && window.DATA && window.DATA.companies) {
            companiesData = window.DATA.companies;
            // Cache into localStorage for next time
            localStorage.setItem('companiesData', JSON.stringify(companiesData));
            console.log('📦 Seeded companiesData from window.DATA');
        }
        if (companiesData.length === 0) {
            console.warn('⚠️ No companies in localStorage or window.DATA'); return;
        }
        sel.innerHTML = '<option value="">— Select company —</option>' +
            companiesData
                .slice().sort((a, b) => a.name.localeCompare(b.name))
                .map(c => `<option value="${c.name}">${c.name}</option>`)
                .join('');
        console.log('✅ Loaded', companiesData.length, 'companies into dropdown');
    }, 1000);
});
