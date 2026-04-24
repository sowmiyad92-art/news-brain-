// ═══════════════════════════════════════════════════════════════
// quick-update-3col.js — 3-column independent date entry (FIXED)
// Reads/writes localStorage directly, doesn't depend on window.allData
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    window.quSave3Column = function() {
        const company = document.getElementById('quCompany')?.value;
        const pastDate = document.getElementById('quDatePast')?.value;
        const expectedDate = document.getElementById('quDateExpected')?.value;
        const upcomingDate = document.getElementById('quDateUpcoming')?.value;
        const url = document.getElementById('quUrl')?.value.trim() || null;

        if (!company) {
            alert('⚠️ Select a company first');
            return;
        }

        if (!pastDate && !expectedDate && !upcomingDate) {
            alert('⚠️ Fill at least one date field');
            return;
        }

        // Read from localStorage directly
        let companiesData = JSON.parse(localStorage.getItem('companiesData') || '[]');
        let announcedDates = JSON.parse(localStorage.getItem('announcedDates') || '{}');
        let newsHistory = JSON.parse(localStorage.getItem('newsHistory') || '[]');

        const companyObj = companiesData.find(c => c.name === company);
        if (!companyObj) {
            alert('❌ Company not found');
            return;
        }

        let updated = [];

        // 1. Update Last Announcement
        if (pastDate) {
            companyObj.lastAnnouncement = pastDate;
            
            // Auto-calculate Expected Next = Last + 90 days
            const lastDate = new Date(pastDate);
            const nextDate = new Date(lastDate);
            nextDate.setDate(nextDate.getDate() + 90);
            companyObj.expectedNext = nextDate.toISOString().split('T')[0];
            
            if (url) companyObj.articleUrl = url;
            
            // Add to history
            newsHistory.push({
                company: company,
                date: pastDate,
                url: url,
                source: 'quick-3col-past',
                timestamp: new Date().toISOString(),
                id: Date.now()
            });
            
            updated.push('Last Announcement');
        }

        // 2. Update Expected Next (manual override)
        if (expectedDate) {
            companyObj.expectedNext = expectedDate;
            updated.push('Expected Next');
        }

        // 3. Update Upcoming Confirmed Date
        if (upcomingDate) {
            announcedDates[company] = {
                date: upcomingDate,
                url: url,
                timestamp: new Date().toISOString()
            };
            
            // Add to history
            newsHistory.push({
                company: company,
                date: upcomingDate,
                url: url,
                source: 'quick-3col-upcoming',
                timestamp: new Date().toISOString(),
                id: Date.now()
            });
            
            updated.push('Upcoming Confirmed');
        }

        // Keep only last 100 history entries
        if (newsHistory.length > 100) {
            newsHistory = newsHistory.slice(-100);
        }

        // Save to localStorage
        localStorage.setItem('companiesData', JSON.stringify(companiesData));
        localStorage.setItem('announcedDates', JSON.stringify(announcedDates));
        localStorage.setItem('newsHistory', JSON.stringify(newsHistory));

        console.log('✅ Saved to localStorage:', company, updated);

        // Reload page to refresh display
        window.location.reload();
    };

    // Populate company dropdown on load
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            const sel = document.getElementById('quCompany');
            if (!sel) return;

            const companiesData = JSON.parse(localStorage.getItem('companiesData') || '[]');
            
            if (companiesData.length === 0) {
                console.warn('⚠️ No companies in localStorage');
                return;
            }

            sel.innerHTML = '<option value="">— Select company —</option>' +
                companiesData
                    .slice().sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => `<option value="${c.name}">${c.name}</option>`)
                    .join('');
            
            console.log('✅ Loaded', companiesData.length, 'companies into dropdown');
        }, 1000); // Wait 1 sec for data to load
    });

})();
