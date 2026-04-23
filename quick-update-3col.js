// ═══════════════════════════════════════════════════════════════
// quick-update-3col.js — 3-column independent date entry
// Each column updates independently, empty fields don't overwrite
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Override the original quSave with 3-column version
    window.quSave3Column = function() {
        const company = document.getElementById('quCompany')?.value;
        const pastDate = document.getElementById('quDatePast')?.value;
        const expectedDate = document.getElementById('quDateExpected')?.value;
        const upcomingDate = document.getElementById('quDateUpcoming')?.value;
        const url = document.getElementById('quUrl')?.value.trim() || null;

        if (!company) {
            if (typeof showNotification === 'function') 
                showNotification('⚠️ Select a company first', 'warning');
            return;
        }

        if (!pastDate && !expectedDate && !upcomingDate) {
            if (typeof showNotification === 'function')
                showNotification('⚠️ Fill at least one date field', 'warning');
            return;
        }

        const companyObj = (window.allData?.companies || []).find(c => c.name === company);
        if (!companyObj) return;

        let updated = [];

        // 1. Update Last Announcement (Past Results)
        if (pastDate) {
            companyObj.lastAnnouncement = pastDate;
            
            // Auto-calculate Expected Next = Last + 90 days
            const lastDate = new Date(pastDate);
            const nextDate = new Date(lastDate);
            nextDate.setDate(nextDate.getDate() + 90);
            companyObj.expectedNext = nextDate.toISOString().split('T')[0];
            
            if (url) companyObj.articleUrl = url;
            
            if (typeof addNewsToHistory === 'function') 
                addNewsToHistory(company, pastDate, url, 'quick-3col-past');
            
            updated.push('Last Announcement');
        }

        // 2. Update Expected Next (manual override)
        if (expectedDate) {
            companyObj.expectedNext = expectedDate;
            updated.push('Expected Next');
        }

        // 3. Update Upcoming Confirmed Date
        if (upcomingDate) {
            if (typeof saveAnnouncedDate === 'function') {
                saveAnnouncedDate(company, upcomingDate, url);
            }
            if (typeof addNewsToHistory === 'function') 
                addNewsToHistory(company, upcomingDate, url, 'quick-3col-upcoming');
            updated.push('Upcoming Confirmed');
        }

        // Save to localStorage
        const dataToSave = window.allData.companies.map(c => ({
            name: c.name,
            region: c.region,
            lastAnnouncement: c.lastAnnouncement,
            expectedNext: c.expectedNext,
            articleUrl: c.articleUrl || null,
            irWebsite: c.irWebsite || '#',
            bestSource: c.bestSource || '',
            sourceReliability: c.sourceReliability || 3,
        }));
        localStorage.setItem('companiesData', JSON.stringify(dataToSave));

        // Refresh UI
        if (typeof renderTable === 'function') renderTable(window.allData.companies);
        if (typeof updateDashboard === 'function') updateDashboard();

        // Clear inputs
        document.getElementById('quDatePast').value = '';
        document.getElementById('quDateExpected').value = '';
        document.getElementById('quDateUpcoming').value = '';
        document.getElementById('quUrl').value = '';

        if (typeof showNotification === 'function') {
            showNotification(`✅ Updated ${company}: ${updated.join(', ')}`, 'success');
        }
    };

    // Populate company dropdown on load
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            const sel = document.getElementById('quCompany');
            if (sel && window.allData?.companies) {
                sel.innerHTML = '<option value="">— Select company —</option>' +
                    window.allData.companies
                        .slice().sort((a, b) => a.name.localeCompare(b.name))
                        .map(c => `<option value="${c.name}">${c.name}</option>`)
                        .join('');
            }
        }, 500);
    });

})();
