// ═══════════════════════════════════════════════════════════════════
// features.js — EmailJS Alerts · Daily Reminder · Fuzzy+Date Search
// Drop this file next to script.js and add ONE line to index.html:
//   <script src="features.js"></script>  ← just before </body>
// ═══════════════════════════════════════════════════════════════════

// ─── EMAILJS CONFIG ─────────────────────────────────────────────────
// Fill these in after creating your free EmailJS account.
// Guide is printed in the console on first load.
const EMAILJS_CONFIG = {
    publicKey:   'S_GrGmCGDn4FuhGGa',   // EmailJS → Account → Public Key
    serviceId:   'service_by4sdid',   // EmailJS → Email Services → Service ID
    templateId:  'template_xxs32cq',  // EmailJS → Email Templates → Template ID
    toEmail:     'sowmiya.d@vitrina.ai' // Where alerts go
};

let EMAILJS_READY = false;

// ─── BOOT ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadEmailJS();
    scheduleDailyReminder(); // search/filter handled by fixes.js
});

// ═══════════════════════════════════════════════════════════════════
// ① EMAILJS — real automatic email from the browser
// ═══════════════════════════════════════════════════════════════════

function loadEmailJS() {
    const script = document.createElement('script');
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
    script.onload = () => {
        if (EMAILJS_CONFIG.publicKey === 'YOUR_PUBLIC_KEY') {
            console.warn(
                '%c📧 EmailJS not configured yet!\n' +
                'Steps:\n' +
                '1. Go to https://www.emailjs.com and create a FREE account\n' +
                '2. Add an Email Service (Gmail works great)\n' +
                '3. Create a Template — use variables: {{to_email}}, {{subject}}, {{message}}\n' +
                '4. Copy your Public Key, Service ID, Template ID\n' +
                '5. Paste them into EMAILJS_CONFIG at top of features.js',
                'color: orange; font-size: 13px;'
            );
            return;
        }
        try {
            if (typeof emailjs !== 'undefined') {
                emailjs.init(EMAILJS_CONFIG.publicKey);
                EMAILJS_READY = true;
                console.log('✅ EmailJS ready');
            } else {
                throw new Error('emailjs library not available');
            }
        } catch (error) {
            EMAILJS_READY = false;
            console.warn('EmailJS init failed:', error);
            showNBNotification('⚠️ EmailJS unavailable due to browser tracking protection', 'warning');
        }
    };
    script.onerror = () => {
        EMAILJS_READY = false;
        console.warn('EmailJS script load failed or was blocked by tracking prevention');
        showNBNotification('⚠️ EmailJS could not load. Email alerts are disabled.', 'warning');
    };
    document.head.appendChild(script);
}

async function sendEmailAlert(companies) {
    if (EMAILJS_CONFIG.publicKey === 'YOUR_PUBLIC_KEY') {
        alert('⚠️ EmailJS not set up yet.\nOpen browser console (F12) for setup instructions.');
        return;
    }
    if (!EMAILJS_READY || typeof emailjs === 'undefined') {
        showNBNotification('⚠️ EmailJS is unavailable. Please allow tracking or use a different browser.', 'warning');
        return;
    }

    const tomorrowStr = getTomorrowStr();
    const lines = companies.map(c => {
        const confirmed = window.announcedDates?.[c.name];
        const dateLabel = confirmed ? `${confirmed.date} ✅ Confirmed` : `${c.expectedNext} ~Est.`;
        return `• ${c.name} — ${dateLabel}${c.irWebsite ? '\n  IR: ' + c.irWebsite : ''}`;
    }).join('\n');

    const params = {
        to_email: EMAILJS_CONFIG.toEmail,
        subject:  `📅 Earnings Tomorrow (${tomorrowStr}): ${companies.map(c => c.name).join(', ')}`,
        message:
            `Earnings expected tomorrow — ${tomorrowStr}\n\n` +
            lines +
            `\n\nSent automatically by News Brain.`
    };

    try {
        showNBNotification('📧 Sending email...', 'info');
        await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, params);
        showNBNotification('✅ Email sent successfully!', 'success');
        // Mark as sent today so banner doesn't repeat
        localStorage.setItem('lastAlertSent', new Date().toDateString());
    } catch (err) {
        console.error('EmailJS error:', err);
        showNBNotification('❌ Email failed — check console for details', 'error');
    }
}

// Replaces the mailto button in the tomorrow banner with real EmailJS button
function upgradeTomorrowBanner(companies) {
    const banner = document.getElementById('tomorrowAlertBanner');
    if (!banner) return;

    const alreadySent = localStorage.getItem('lastAlertSent') === new Date().toDateString();
    const btn = banner.querySelector('a');
    if (!btn) return;

    const newBtn = document.createElement('button');
    newBtn.style.cssText = `
        background: ${alreadySent ? '#68d391' : '#f0ad00'};
        color: #000; border: none; padding: 7px 16px;
        border-radius: 6px; font-weight: bold;
        cursor: ${alreadySent ? 'default' : 'pointer'};
        white-space: nowrap; font-size: 14px;
    `;
    newBtn.textContent = alreadySent ? '✅ Alert Sent Today' : '✉️ Send Email Alert';
    if (!alreadySent) {
        newBtn.onclick = () => sendEmailAlert(companies);
    }
    btn.replaceWith(newBtn);
}

// ═══════════════════════════════════════════════════════════════════
// ② DAILY REMINDER MODAL — once per day, on app open
// ═══════════════════════════════════════════════════════════════════

function scheduleDailyReminder() {
    // Wait for allData to be populated (script.js loads it async)
    const wait = setInterval(() => {
        if (window.allData && window.allData.companies && window.allData.companies.length > 0) {
            clearInterval(wait);
            runDailyReminder();
            upgradeTomorrowBanner(getTomorrowCompanies());
        }
    }, 300);
}

function runDailyReminder() {
    const today = new Date().toDateString();
    const lastShown = localStorage.getItem('lastReminderDate');
    if (lastShown === today) return; // already shown today

    const upcoming = getUpcomingCompanies(7); // due in next 7 days
    if (upcoming.length === 0) return;

    localStorage.setItem('lastReminderDate', today);
    showReminderModal(upcoming);
}

function getTomorrowStr() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.getFullYear() + '-' +
        String(t.getMonth()+1).padStart(2,'0') + '-' +
        String(t.getDate()).padStart(2,'0');
}

function getTomorrowCompanies() {
    const t = getTomorrowStr();
    return (window.allData?.companies || []).filter(c => {
        const confirmed = window.announcedDates?.[c.name]?.date;
        return confirmed === t || c.expectedNext === t;
    });
}

function getUpcomingCompanies(days) {
    const today = new Date(); today.setHours(0,0,0,0);
    const limit = new Date(today); limit.setDate(limit.getDate() + days);
    return (window.allData?.companies || [])
        .filter(c => {
            // Use confirmed upcoming date if available, else estimated expectedNext
            const confirmed = window.announcedDates?.[c.name]?.date;
            const watchDate = new Date(confirmed || c.expectedNext);
            return watchDate >= today && watchDate <= limit;
        })
        .sort((a, b) => {
            const da = new Date(window.announcedDates?.[a.name]?.date || a.expectedNext);
            const db = new Date(window.announcedDates?.[b.name]?.date || b.expectedNext);
            return da - db;
        });
}

function showReminderModal(companies) {
    const tomorrow = getTomorrowStr();

    const overlay = document.createElement('div');
    overlay.id = 'reminderOverlay';
    overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.5);
        z-index:2000; display:flex; align-items:center; justify-content:center;
    `;

    const rows = companies.map(c => {
        const isT = c.expectedNext === tomorrow;
        const daysLeft = Math.round((new Date(c.expectedNext) - new Date()) / 86400000);
        return `
            <tr style="background:${isT ? '#fffbea' : '#fff'}">
                <td style="padding:8px 12px; font-weight:${isT ? 'bold' : 'normal'}">
                    ${isT ? '📅 ' : ''}${c.name}
                </td>
                <td style="padding:8px 12px; color:#666">${c.expectedNext}</td>
                <td style="padding:8px 12px;">
                    <span style="
                        background:${isT ? '#f59e0b' : daysLeft <= 3 ? '#fed7aa' : '#e2e8f0'};
                        padding:2px 8px; border-radius:10px; font-size:12px; font-weight:bold;
                    ">${isT ? 'Tomorrow' : `In ${daysLeft}d`}</span>
                </td>
            </tr>
        `;
    }).join('');

    const tomorrowOnes = companies.filter(c => c.expectedNext === tomorrow);

    overlay.innerHTML = `
        <div style="
            background:#fff; border-radius:14px; padding:28px 32px;
            max-width:480px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.3);
            font-family:inherit;
        ">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
                <h2 style="margin:0;font-size:18px;">📅 Upcoming Earnings</h2>
                <button onclick="document.getElementById('reminderOverlay').remove()" style="
                    border:none;background:none;font-size:24px;cursor:pointer;color:#999;
                ">&times;</button>
            </div>
            <p style="color:#666;font-size:13px;margin:0 0 16px;">
                ${companies.length} announcement${companies.length>1?'s':''} due in the next 7 days
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                    <tr style="border-bottom:2px solid #eee;">
                        <th style="text-align:left;padding:6px 12px;color:#999;font-size:12px;">COMPANY</th>
                        <th style="text-align:left;padding:6px 12px;color:#999;font-size:12px;">DATE</th>
                        <th style="text-align:left;padding:6px 12px;color:#999;font-size:12px;">STATUS</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;">
                ${tomorrowOnes.length > 0 ? `
                <button onclick="handleReminderEmail()" id="reminderEmailBtn" style="
                    flex:1; background:#3182ce; color:#fff; border:none;
                    padding:10px 16px; border-radius:8px; cursor:pointer;
                    font-size:14px; font-weight:bold;
                ">✉️ Send Email Alert</button>` : ''}
                <button onclick="document.getElementById('reminderOverlay').remove()" style="
                    flex:1; background:#edf2f7; color:#4a5568; border:none;
                    padding:10px 16px; border-radius:8px; cursor:pointer; font-size:14px;
                ">Dismiss</button>
            </div>
            <p style="font-size:11px;color:#ccc;margin:12px 0 0;text-align:center;">
                This reminder shows once per day
            </p>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.remove();
    });
}

function handleReminderEmail() {
    const btn = document.getElementById('reminderEmailBtn');
    if (btn) { btn.textContent = '⏳ Sending...'; btn.disabled = true; }
    sendEmailAlert(getTomorrowCompanies()).then(() => {
        document.getElementById('reminderOverlay')?.remove();
    });
}

// ─── small notification helper (mirrors script.js style) ────────────
function showNBNotification(message, type = 'info') {
    // reuse script.js function if available
    if (typeof showNotification === 'function') {
        showNotification(message, type);
        return;
    }
    const n = document.createElement('div');
    n.style.cssText = `
        position:fixed;bottom:20px;right:20px;z-index:9999;
        padding:12px 20px;border-radius:8px;font-size:14px;font-weight:bold;
        background:${type==='success'?'#38a169':type==='error'?'#e53e3e':'#3182ce'};
        color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.2);
    `;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3500);
}