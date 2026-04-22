// ═══════════════════════════════════════════════════════
// 📝 TEXT PARSER — Bulk announcement upload
// Handles multi-line text input with smart date extraction
// ═══════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    setupTextUpload();
});

function setupTextUpload() {
    const submitBtn = document.getElementById('submitTextBtn');
    const textArea = document.getElementById('announcementTextArea');
    
    if (!submitBtn || !textArea) return;
    
    // Submit button
    submitBtn.addEventListener('click', () => {
        processBulkText(textArea.value);
    });
    
    // Ctrl+Enter shortcut
    textArea.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            processBulkText(textArea.value);
        }
    });
}

function processBulkText(text) {
    if (!text || !text.trim()) {
        showNotification('⚠️ Please paste some text first', 'warning');
        return;
    }
    
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const results = { success: 0, failed: 0, errors: [] };
    
    for (const line of lines) {
        try {
            const parsed = parseAnnouncementLine(line);
            if (parsed.company && parsed.date) {
                updateCompanyNews(parsed.company, parsed.date, null);
                addNewsToHistory(parsed.company, parsed.date, null, 'bulk-text');
                results.success++;
            } else {
                results.failed++;
                results.errors.push(`❌ "${line}" - ${!parsed.company ? 'Company not found' : 'Date not found'}`);
            }
        } catch (error) {
            results.failed++;
            results.errors.push(`❌ "${line}" - ${error.message}`);
        }
    }
    
    // Show results
    if (results.success > 0) {
        renderTable(allData.companies);
        updateDashboard();
        showNotification(`✅ Updated ${results.success} companies!`, 'success');
    }
    
    if (results.failed > 0) {
        console.warn('❌ Failed to parse', results.failed, 'lines:');
        results.errors.forEach(err => console.warn(err));
        showNotification(`⚠️ ${results.success} succeeded, ${results.failed} failed (check console)`, 'warning');
    }
    
    // Clear textarea on full success
    if (results.failed === 0) {
        document.getElementById('announcementTextArea').value = '';
    }
}

// Parse a single announcement line
// Supports formats:
// - "Netflix April 15"
// - "Netflix Q1 2026"
// - "Netflix expects Q1 earnings April 15, 2026"
// - "Disney announced Q2 results May 8"
// - "Amazon First-Quarter-2026"
function parseAnnouncementLine(line) {
    const result = { company: null, date: null };
    
    // 1. Try to find company name
    const companies = allData.companies || [];
    const lineLower = line.toLowerCase();
    
    // Try exact name match first
    for (const company of companies) {
        const nameLower = company.name.toLowerCase();
        if (lineLower.includes(nameLower)) {
            result.company = company.name;
            break;
        }
    }
    
    // Try aliases if no match
    if (!result.company) {
        for (const [keyword, companyName] of Object.entries(COMPANY_ALIASES || {})) {
            if (lineLower.includes(keyword.toLowerCase())) {
                result.company = companyName;
                break;
            }
        }
    }
    
    // Try partial word match
    if (!result.company) {
        for (const company of companies) {
            const words = company.name.toLowerCase().split(/\s+/);
            const meaningful = words.filter(w => w.length > 3);
            if (meaningful.some(w => lineLower.includes(w))) {
                result.company = company.name;
                break;
            }
        }
    }
    
    if (!result.company) {
        return result; // Can't identify company
    }
    
    // 2. Try to extract date (quarter detection first, then regular dates)
    result.date = extractDateFromQuarter(line) || extractDateFromText(line);
    
    return result;
}

// Enhanced quarter detection with more formats
// Detects: Q1 2026, Q1-2026, First-Quarter-2026, first quarter 2026, etc.
function extractDateFromQuarter(text) {
    if (!text) return null;
    
    const quarters = [
        // Standard formats: Q1 2026, Q1-2026, Q1/2026
        { re: /\bq1[- /]?(20\d{2})\b/i, month: 4, day: 15 },
        { re: /\bq2[- /]?(20\d{2})\b/i, month: 7, day: 15 },
        { re: /\bq3[- /]?(20\d{2})\b/i, month: 10, day: 15 },
        { re: /\bq4[- /]?(20\d{2})\b/i, month: 1, day: 15 },
        
        // Year-first: 2026-Q1, 2026 Q1
        { re: /\b(20\d{2})[- ]?q1\b/i, month: 4, day: 15 },
        { re: /\b(20\d{2})[- ]?q2\b/i, month: 7, day: 15 },
        { re: /\b(20\d{2})[- ]?q3\b/i, month: 10, day: 15 },
        { re: /\b(20\d{2})[- ]?q4\b/i, month: 1, day: 15 },
        
        // Written formats: First-Quarter-2026, First Quarter 2026
        { re: /\bfirst[- ]quarter[- ]?(20\d{2})\b/i, month: 4, day: 15 },
        { re: /\bsecond[- ]quarter[- ]?(20\d{2})\b/i, month: 7, day: 15 },
        { re: /\bthird[- ]quarter[- ]?(20\d{2})\b/i, month: 10, day: 15 },
        { re: /\bfourth[- ]quarter[- ]?(20\d{2})\b/i, month: 1, day: 15 },
        
        // Reversed: 2026 First Quarter, 2026-First-Quarter
        { re: /\b(20\d{2})[- ]?first[- ]quarter\b/i, month: 4, day: 15 },
        { re: /\b(20\d{2})[- ]?second[- ]quarter\b/i, month: 7, day: 15 },
        { re: /\b(20\d{2})[- ]?third[- ]quarter\b/i, month: 10, day: 15 },
        { re: /\b(20\d{2})[- ]?fourth[- ]quarter\b/i, month: 1, day: 15 },
    ];
    
    for (const q of quarters) {
        const match = text.match(q.re);
        if (match) {
            let year = parseInt(match[1]);
            // Q4 wraps to next year's January
            if (q.month === 1 && !text.toLowerCase().includes('january')) {
                year += 1;
            }
            const dateStr = `${year}-${String(q.month).padStart(2, '0')}-${String(q.day).padStart(2, '0')}`;
            if (isValidDate(dateStr)) {
                return dateStr;
            }
        }
    }
    
    return null;
}