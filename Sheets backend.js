// ═══════════════════════════════════════════════════════════════
// sheets-backend.js — Replace localStorage with Google Sheets
// Use this INSTEAD of localStorage for persistent data
// ═══════════════════════════════════════════════════════════════

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzHdtfDINQ_HiZgSMqJVwxEZt5laMw5cWVmCw4OwwqreX6tr7EqHy1pWvmXS_YsUMNL/exec'; // Get from Deploy > Web app

// ═══════════════════════════════════════════════════════════════
// LOAD DATA FROM SHEETS (replaces localStorage load)
// ═══════════════════════════════════════════════════════════════

async function loadDataFromSheets() {
    try {
        showNotification('Loading from Google Sheets...', 'info');

        // Load companies
        const companiesRes = await fetch(`${SCRIPT_URL}?action=getAll`);
        const companiesData = await companiesRes.json();
        
        // Load upcoming dates
        const upcomingRes = await fetch(`${SCRIPT_URL}?action=getUpcoming`);
        const upcomingData = await upcomingRes.json();
        
        // Load news history
        const historyRes = await fetch(`${SCRIPT_URL}?action=getHistory`);
        const historyData = await historyRes.json();

        // Set global variables
        window.allData = { companies: companiesData.companies || [] };
        window.announcedDates = upcomingData || {};
        window.newsHistory = historyData || [];

        console.log('✅ Loaded from Sheets:', 
            window.allData.companies.length, 'companies',
            Object.keys(window.announcedDates).length, 'upcoming dates',
            window.newsHistory.length, 'history entries');

        renderTable(window.allData.companies);
        updateDashboard();
        
        showNotification('✅ Data loaded from Sheets!', 'success');
    } catch (error) {
        console.error('Error loading from Sheets:', error);
        showNotification('❌ Failed to load from Sheets', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// SAVE DATA TO SHEETS (replaces localStorage save)
// ═══════════════════════════════════════════════════════════════

async function updateCompanyInSheets(company, lastAnnouncement, expectedNext, articleUrl) {
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'updateCompany',
                company: company,
                lastAnnouncement: lastAnnouncement,
                expectedNext: expectedNext,
                articleUrl: articleUrl
            })
        });
        
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        
        console.log('✅ Updated company in Sheets:', company);
        return true;
    } catch (error) {
        console.error('Error updating company in Sheets:', error);
        showNotification('❌ Failed to save to Sheets', 'error');
        return false;
    }
}

async function saveUpcomingToSheets(company, date, url) {
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'saveUpcoming',
                company: company,
                date: date,
                url: url
            })
        });
        
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        
        console.log('✅ Saved upcoming date to Sheets:', company, date);
        return true;
    } catch (error) {
        console.error('Error saving upcoming to Sheets:', error);
        return false;
    }
}

async function addHistoryToSheets(company, date, url, source) {
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'addHistory',
                company: company,
                date: date,
                url: url,
                source: source
            })
        });
        
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        
        console.log('✅ Added history to Sheets:', company, date);
        return true;
    } catch (error) {
        console.error('Error adding history to Sheets:', error);
        return false;
    }
}

async function addCompanyToSheets(name, region, lastAnnouncement, expectedNext, irWebsite, bestSource, articleUrl) {
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'addCompany',
                name: name,
                region: region,
                lastAnnouncement: lastAnnouncement,
                expectedNext: expectedNext,
                irWebsite: irWebsite,
                bestSource: bestSource,
                articleUrl: articleUrl
            })
        });
        
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        
        console.log('✅ Added company to Sheets:', name);
        return true;
    } catch (error) {
        console.error('Error adding company to Sheets:', error);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// OVERRIDE QUICK UPDATE TO USE SHEETS
// ═══════════════════════════════════════════════════════════════

async function quSave3ColumnSheets() {
    const company = document.getElementById('quCompany')?.value;
    const pastDate = document.getElementById('quDatePast')?.value;
    const expectedDate = document.getElementById('quDateExpected')?.value;
    const upcomingDate = document.getElementById('quDateUpcoming')?.value;
    const url = document.getElementById('quUrl')?.value.trim() || null;

    if (!company) {
        showNotification('⚠️ Select a company first', 'warning');
        return;
    }

    if (!pastDate && !expectedDate && !upcomingDate) {
        showNotification('⚠️ Fill at least one date field', 'warning');
        return;
    }

    const companyObj = (window.allData?.companies || []).find(c => c.name === company);
    if (!companyObj) return;

    let updated = [];

    // 1. Update Last Announcement
    if (pastDate) {
        const lastDate = new Date(pastDate);
        const nextDate = new Date(lastDate);
        nextDate.setDate(nextDate.getDate() + 90);
        const calculatedNext = nextDate.toISOString().split('T')[0];

        await updateCompanyInSheets(company, pastDate, calculatedNext, url);
        companyObj.lastAnnouncement = pastDate;
        companyObj.expectedNext = calculatedNext;
        if (url) companyObj.articleUrl = url;

        await addHistoryToSheets(company, pastDate, url, 'quick-3col-past');
        updated.push('Last Announcement');
    }

    // 2. Update Expected Next (manual override)
    if (expectedDate) {
        await updateCompanyInSheets(company, companyObj.lastAnnouncement, expectedDate, companyObj.articleUrl);
        companyObj.expectedNext = expectedDate;
        updated.push('Expected Next');
    }

    // 3. Update Upcoming Confirmed Date
    if (upcomingDate) {
        await saveUpcomingToSheets(company, upcomingDate, url);
        if (!window.announcedDates) window.announcedDates = {};
        window.announcedDates[company] = { date: upcomingDate, url: url };
        
        await addHistoryToSheets(company, upcomingDate, url, 'quick-3col-upcoming');
        updated.push('Upcoming Confirmed');
    }

    // Refresh UI
    renderTable(window.allData.companies);
    updateDashboard();

    // Clear inputs
    document.getElementById('quDatePast').value = '';
    document.getElementById('quDateExpected').value = '';
    document.getElementById('quDateUpcoming').value = '';
    document.getElementById('quUrl').value = '';

    showNotification(`✅ Updated ${company}: ${updated.join(', ')}`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// INIT — Replace loadData() with Sheets version
// ═══════════════════════════════════════════════════════════════

// On page load, use Sheets instead of localStorage
document.addEventListener('DOMContentLoaded', () => {
    // Comment out or remove the original loadData() call in script.js
    // and use this instead:
    loadDataFromSheets();
});
