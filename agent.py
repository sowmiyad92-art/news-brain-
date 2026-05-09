"""
News Brain Agent — auto-updates data.json with earnings dates
Sources:  1) Google News RSS (free, unlimited)
          2) Direct IR page scraping (requests)
Extractor: Groq llama3-70b (free, 14,400 req/day)

Run: python agent.py
GitHub Actions runs this daily and commits updated data.json automatically.
"""

import requests
import json
import os
import time
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from html.parser import HTMLParser

# ── Config ──────────────────────────────────────────────────────
GROQ_API_KEY  = os.environ.get('GROQ_API_KEY', '')
DATA_JSON     = 'data.json'
TODAY         = datetime.now().strftime('%Y-%m-%d')
CURRENT_YEAR  = datetime.now().year
CURRENT_Q     = f"Q{((datetime.now().month - 1) // 3) + 1} {CURRENT_YEAR}"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'en-US,en;q=0.9',
}

# ── Text extractor (strips HTML) ────────────────────────────────
class _TextPuller(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self._skip = [], False
    def handle_starttag(self, tag, _):
        if tag in ('script','style','nav','footer','head'): self._skip = True
    def handle_endtag(self, tag):
        if tag in ('script','style','nav','footer','head'): self._skip = False
    def handle_data(self, data):
        if not self._skip and data.strip(): self.parts.append(data.strip())

def strip_html(html):
    p = _TextPuller()
    try: p.feed(html)
    except: pass
    return ' '.join(p.parts)

# ── Source 1: Google News RSS ────────────────────────────────────
def search_google_news(company, extra=''):
    """Returns up to 5 article snippets as one string."""
    query = f'"{company}" earnings results {extra}'.strip()
    url   = (f'https://news.google.com/rss/search?q='
             f'{requests.utils.quote(query)}&hl=en-US&gl=US&ceid=US:en')
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        root = ET.fromstring(r.content)
        items = root.findall('.//item')[:5]
        snippets = []
        for it in items:
            title   = it.findtext('title','')
            pubdate = it.findtext('pubDate','')
            desc    = strip_html(it.findtext('description',''))[:300]
            snippets.append(f"TITLE: {title}\nDATE: {pubdate}\nSNIPPET: {desc}")
        return '\n\n'.join(snippets) if snippets else None
    except Exception as e:
        print(f"  [RSS] error for {company}: {e}")
        return None

# ── Source 2: Direct IR page scrape ─────────────────────────────
def scrape_ir_page(ir_url):
    if not ir_url or ir_url in ('#','','N/A'): return None
    try:
        r = requests.get(ir_url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            text = strip_html(r.text)
            # Keep first 3000 chars — earnings info is usually near top
            return text[:3000]
    except Exception as e:
        print(f"  [IR] scrape failed: {e}")
    return None

# ── Groq LLM extraction ──────────────────────────────────────────
def groq_extract(company, text):
    """Ask Groq to pull last+upcoming earnings dates from text."""
    if not GROQ_API_KEY:
        print("  [Groq] No API key — skipping LLM step")
        return None
    if not text:
        return None

    prompt = f"""Today is {TODAY}. Extract earnings/financial results dates for: {company}

From this content find:
1. lastAnnouncement — most recent date {company} RELEASED quarterly results (must be a past date)
2. upcomingDate — next date {company} WILL report (future date, confirmed or estimated)

Rules:
- Use YYYY-MM-DD format only
- If not found, use null
- Do NOT guess — only extract dates explicitly mentioned
- lastAnnouncement must be before {TODAY}
- upcomingDate must be after {TODAY}

Content:
{text[:2500]}

Reply ONLY with this JSON (no markdown, no explanation):
{{"lastAnnouncement": "YYYY-MM-DD or null", "upcomingDate": "YYYY-MM-DD or null", "confidence": "high/medium/low"}}"""

    try:
        r = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization': f'Bearer {GROQ_API_KEY}',
                     'Content-Type': 'application/json'},
            json={'model': 'llama3-70b-8192',
                  'messages': [{'role':'user','content': prompt}],
                  'max_tokens': 120,
                  'temperature': 0},
            timeout=20
        )
        raw = r.json()['choices'][0]['message']['content'].strip()
        raw = raw.replace('```json','').replace('```','').strip()
        result = json.loads(raw)

        # Validate dates
        def valid(d):
            if not d or d == 'null': return None
            try: datetime.strptime(d, '%Y-%m-%d'); return d
            except: return None

        result['lastAnnouncement'] = valid(result.get('lastAnnouncement'))
        result['upcomingDate']     = valid(result.get('upcomingDate'))

        # Sanity-check direction
        if result['lastAnnouncement'] and result['lastAnnouncement'] >= TODAY:
            result['lastAnnouncement'] = None  # reject future "last" dates
        if result['upcomingDate'] and result['upcomingDate'] <= TODAY:
            result['upcomingDate'] = None      # reject past "upcoming" dates

        return result
    except Exception as e:
        print(f"  [Groq] parse error: {e}")
        return None

# ── Per-company pipeline ─────────────────────────────────────────
def process_company(company):
    name   = company.get('name','')
    ir_url = company.get('irWebsite','')

    # 1) Google News — current quarter + previous quarter
    prev_q = f"Q{((datetime.now().month - 1) // 3)} {CURRENT_YEAR}" \
             if datetime.now().month > 3 else f"Q4 {CURRENT_YEAR - 1}"

    news = (search_google_news(name, CURRENT_Q) or
            search_google_news(name, prev_q)     or
            search_google_news(name, str(CURRENT_YEAR)))

    result = groq_extract(name, news) if news else None

    # 2) IR page scrape if news missed anything
    if not result or (not result.get('lastAnnouncement') and not result.get('upcomingDate')):
        ir_text = scrape_ir_page(ir_url)
        if ir_text:
            result2 = groq_extract(name, ir_text)
            if result2 and (result2.get('lastAnnouncement') or result2.get('upcomingDate')):
                result = result2
                if result: result['source'] = 'IR Page'
    else:
        if result: result['source'] = 'Google News RSS'

    # 3) Merge best of both if partial
    if result and news and not result.get('upcomingDate'):
        ir_text = scrape_ir_page(ir_url)
        if ir_text:
            r2 = groq_extract(name, ir_text)
            if r2 and r2.get('upcomingDate'):
                result['upcomingDate'] = r2['upcomingDate']

    return result

# ── Update data.json ─────────────────────────────────────────────
def update_data_json(results):
    with open(DATA_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Handle both {companies:[...]} and plain array formats
    is_dict = isinstance(data, dict)
    companies = data.get('companies', []) if is_dict else data

    # Load or init announcedDates section
    announced = data.get('announcedDates', {}) if is_dict else {}

    updated, skipped = 0, 0
    for co in companies:
        name = co.get('name','')
        r    = results.get(name)
        if not r:
            skipped += 1
            continue

        changed = False

        # Update lastAnnouncement only if newer than what's stored
        new_last = r.get('lastAnnouncement')
        old_last = co.get('lastAnnouncement','')
        if new_last and (not old_last or new_last > old_last):
            co['lastAnnouncement'] = new_last
            # Recalculate expectedNext
            try:
                nxt = datetime.strptime(new_last,'%Y-%m-%d') + timedelta(days=90)
                co['expectedNext'] = nxt.strftime('%Y-%m-%d')
            except: pass
            changed = True

        # Update upcoming confirmed date
        new_up = r.get('upcomingDate')
        if new_up:
            announced[name] = {
                'date':      new_up,
                'url':       None,
                'timestamp': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
                'source':    r.get('source','agent')
            }
            changed = True

        if changed: updated += 1

    # Auto-clear announced dates that have already passed
    today_dt = datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
    cleared = []
    for name, entry in list(announced.items()):
        try:
            d = datetime.strptime(entry['date'],'%Y-%m-%d')
            if d < today_dt - timedelta(days=1):  # 1 day grace
                cleared.append(name)
                del announced[name]
        except: pass
    if cleared:
        print(f"  🗑️  Auto-cleared stale upcoming dates: {', '.join(cleared)}")

    # Write back
    if is_dict:
        data['companies']     = companies
        data['announcedDates'] = announced
        data['lastAgentRun']  = TODAY
    else:
        data = {'companies': companies, 'announcedDates': announced, 'lastAgentRun': TODAY}

    with open(DATA_JSON, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Updated: {updated} | No data: {skipped} | Cleared stale: {len(cleared)}")
    return updated

# ── Main ─────────────────────────────────────────────────────────
def main():
    print(f"🚀 News Brain Agent — {TODAY}  (quarter: {CURRENT_Q})")

    if not os.path.exists(DATA_JSON):
        print(f"❌ {DATA_JSON} not found — run from repo root"); return

    with open(DATA_JSON,'r',encoding='utf-8') as f:
        data = json.load(f)

    companies = data.get('companies', data) if isinstance(data, dict) else data
    print(f"📋 Companies to process: {len(companies)}")

    if not GROQ_API_KEY:
        print("⚠️  GROQ_API_KEY not set — LLM extraction disabled, running RSS only")

    results = {}
    for i, co in enumerate(companies):
        name = co.get('name','')
        if not name: continue

        r = process_company(co)
        results[name] = r

        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            print(f"  ✅ {name}: last={r.get('lastAnnouncement')} | upcoming={r.get('upcomingDate')} [{r.get('confidence','')}]")
        else:
            print(f"  ❌ {name}: no dates found")

        # Save progress every 25 companies so partial runs aren't lost
        if (i + 1) % 25 == 0:
            print(f"\n💾 Checkpoint save at company {i+1}...")
            update_data_json(results)

        time.sleep(1.2)  # polite delay — avoids rate limits

    # Final save
    print("\n💾 Final save...")
    update_data_json(results)
    print("🎉 Agent run complete!")

if __name__ == '__main__':
    main()
