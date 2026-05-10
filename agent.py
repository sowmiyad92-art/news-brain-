"""
News Brain Agent v2 — auto-updates data.json with earnings dates
Sources:  1) yfinance (direct ticker lookup — best for listed companies)
          2) Google News RSS (free, unlimited fallback)
          3) IR page scrape (last resort)
Extractor: Groq llama-3.3-70b-versatile with auto-retry on rate limit
"""

import requests, json, os, time, re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from html.parser import HTMLParser
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

try:
    import yfinance as yf
    HAS_YF = True
except ImportError:
    HAS_YF = False
    print("⚠️  yfinance not installed — run: pip install yfinance")

# ── Config ───────────────────────────────────────────────────────
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
DATA_JSON    = 'data.json'
TODAY        = datetime.now().strftime('%Y-%m-%d')
CURRENT_YEAR = datetime.now().year
CURRENT_Q    = f"Q{((datetime.now().month - 1) // 3) + 1} {CURRENT_YEAR}"
MAX_AGE_DAYS = 548  # reject lastAnnouncement older than 18 months

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'en-US,en;q=0.9',
}

BROKEN_HOSTS = [
    'ir.paramount.com', 'investors.amcnetworks.com', 'www.cmcsa.com',
    'investors.tegna.com', 'ir.netease.com', 'ir.lionsgate.com',
    'ir.wmg.com', 'ir.tkogrp.com', 'ir.sphereentertainmentco.com',
    'www.balajitelefilms.com',
]

# ── Complete ticker map ──────────────────────────────────────────
TICKERS = {
    'Netflix':'NFLX','Disney':'DIS','Viaplay Group':'VPLAY-B.ST',
    'RTL Group':'RRTL.F','Amazon':'AMZN','Paramount':'PARA',
    'Warner Bros Discovery':'WBD','AMC Networks':'AMCX','Lionsgate':'LION',
    'BCE':'BCE.TO','Cineplex':'CGX.TO','Sony':'SONY','Comcast':'CMCSA',
    'Curiosity Stream':'CURI','Fox Corporation':'FOXA','Gaia':'GAIA',
    'Universal Music Group':'UMG.AS','TV Asahi':'9409.T','Canal+':'CAN.L',
    'Banijay':'BNJ.AS','MBC Group':'4072.SR','Gray Television':'GTN',
    'Grupo Clarin':'GCLA.BA','IMAX':'IMAX','Kartoon Studios':'TOON',
    'Megacable':'MEGACPO.MX','Nexstar':'NXST','Quebecor':'QBR-B.TO',
    'Rogers':'RCI-B.TO','Roku':'ROKU','Sinclair':'SBGI',
    'Sphere Entertainment':'SPHR','TEGNA':'TGNA','Telecom Argentina':'TEO',
    'Televisa':'TV','Warner Music Group':'WMG','WildBrain':'WILD.TO',
    'Damai Holdings':'1060.HK','Avex':'7860.T','Bilibili':'BILI',
    'CJ ENM':'035760.KQ','DK Karaoke':'7458.T','Dentsu':'4324.T',
    'Digital Domain':'0547.HK','Fuji Media':'4676.T','Grammy':'GRAMMY.BK',
    'Maoyan':'1896.HK','NetEase':'NTES','NTV':'9404.T',
    'Saregama':'SAREGAMA.BO','Seven West Media':'SWM.AX',
    'SM Entertainment':'041510.KQ','Studio Dragon':'253450.KQ',
    'Toei Animation':'4816.T','Toho':'9602.T','ITV':'ITV.L',
    'Groupe M6':'MMT.PA','MFE MediaForEurope':'MFEB.MI','MultiChoice':'MCG.JO',
    'PRISA':'PRS.MC','ProSiebenSat.1':'PSM.DE','Vantiva':'VANTI.PA',
    'TF1':'TFI.PA','Vivendi':'VIV.PA','Xilam':'XIL.PA',
    'Fubo TV':'FUBO','TKO Group':'TKO','Scripps':'SSP',
    'Amagi':'AMAGI.NS','Balaji Telefilms':'BALAJITELE.NS',
    'Baweja Studios':'BAWEJA-SM.NS','Digikore':'DIGIKORE-SM.NS',
    'NW18':'NETWORK18.NS','Zee Entertainment':'ZEEL.NS',
    'Tips Industries':'TIPSINDLTD.NS','Emtek':'MNCN.JK',
    'Mahaka':'ABBA.JK','MD Entertainment':'FILM.JK',
    'Eros Media':'EMWP.F',
}

# ── Date validation ──────────────────────────────────────────────
def fmt_date(d):
    try: return d.strftime('%Y-%m-%d')
    except: return str(d)[:10]

def valid_past(s):
    if not s or s == 'null': return None
    try:
        ds = str(s)[:10]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', ds): return None
        dt = datetime.strptime(ds, '%Y-%m-%d')
        today = datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
        if dt >= today: return None          # must be past
        if (today - dt).days > MAX_AGE_DAYS: return None  # too old
        return ds
    except: return None

def valid_future(s):
    if not s or s == 'null': return None
    try:
        ds = str(s)[:10]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', ds): return None
        dt = datetime.strptime(ds, '%Y-%m-%d')
        today = datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
        if dt <= today: return None           # must be future
        if (dt - today).days > 365: return None  # too far ahead
        return ds
    except: return None

# ── Source 1: yfinance ───────────────────────────────────────────
def yf_lookup(name):
    if not HAS_YF: return None
    sym = TICKERS.get(name)
    if not sym: return None
    try:
        tk  = yf.Ticker(sym)
        last, upcoming = None, None

        # Upcoming date from calendar
        try:
            cal = tk.calendar
            if cal is not None and not (hasattr(cal,'empty') and cal.empty):
                if isinstance(cal, dict):
                    for key in ['Earnings Date','Earnings High','Earnings Low']:
                        if key in cal:
                            d = valid_future(fmt_date(cal[key]))
                            if d: upcoming = d; break
                else:
                    for col in ['Earnings Date','Earnings High','Earnings Low']:
                        if col in cal.columns:
                            for val in cal[col]:
                                d = valid_future(fmt_date(val))
                                if d: upcoming = d; break
                            if upcoming: break
        except: pass

        # Last date from earnings_dates history
        try:
            ed = tk.earnings_dates
            if ed is not None and not ed.empty:
                today = datetime.now()
                past  = ed[ed.index.tz_localize(None) < today] if ed.index.tz else ed[ed.index < today]
                if not past.empty:
                    d = valid_past(fmt_date(past.index[0]))
                    if d: last = d
        except: pass

        if last or upcoming:
            print(f"  📈 [yfinance] {name} ({sym}): last={last} | upcoming={upcoming}")
            return {'lastAnnouncement':last,'upcomingDate':upcoming,
                    'confidence':'high','source':'yfinance'}
    except Exception as e:
        print(f"  [yfinance] {name} ({sym}): {str(e)[:60]}")
    return None

# ── Source 2: Google News RSS ────────────────────────────────────
class _Puller(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]; self._skip=False
    def handle_starttag(self,t,_):
        if t in ('script','style','nav','footer','head'): self._skip=True
    def handle_endtag(self,t):
        if t in ('script','style','nav','footer','head'): self._skip=False
    def handle_data(self,d):
        if not self._skip and d.strip(): self.parts.append(d.strip())

def strip_html(html):
    p=_Puller(); 
    try: p.feed(html)
    except: pass
    return ' '.join(p.parts)

def google_news(name, extra=''):
    q   = f'"{name}" earnings results {extra}'.strip()
    url = f'https://news.google.com/rss/search?q={requests.utils.quote(q)}&hl=en-US&gl=US&ceid=US:en'
    try:
        r    = requests.get(url, headers=HEADERS, timeout=12)
        root = ET.fromstring(r.content)
        bits = []
        for it in root.findall('.//item')[:5]:
            bits.append(f"TITLE: {it.findtext('title','')}\n"
                        f"DATE: {it.findtext('pubDate','')}\n"
                        f"SNIPPET: {strip_html(it.findtext('description',''))[:250]}")
        return '\n\n'.join(bits) or None
    except: return None

# ── Source 3: IR page ────────────────────────────────────────────
def scrape_ir(url):
    if not url or url in ('#','','N/A'): return None
    if any(b in url for b in BROKEN_HOSTS): return None
    try:
        r = requests.get(url, headers=HEADERS, timeout=12, verify=False)
        if r.status_code == 200: return strip_html(r.text)[:2000]
    except: pass
    return None

# ── Groq with auto-retry ─────────────────────────────────────────
def groq_extract(name, text, retries=2):
    if not GROQ_API_KEY or not text: return None
    prompt = (f"Today: {TODAY}. Find earnings dates for {name}.\n"
              f"- lastAnnouncement: date they RELEASED results (past, before {TODAY})\n"
              f"- upcomingDate: date they WILL report next (future, after {TODAY})\n"
              f"Only use explicitly mentioned dates. YYYY-MM-DD or null.\n"
              f"Content: {text[:1400]}\n"
              f'Reply ONLY with JSON: {{"lastAnnouncement":"...","upcomingDate":"...","confidence":"high/medium/low"}}')

    for attempt in range(retries + 1):
        try:
            r    = requests.post('https://api.groq.com/openai/v1/chat/completions',
                                 headers={'Authorization':f'Bearer {GROQ_API_KEY}',
                                          'Content-Type':'application/json'},
                                 json={'model':'llama-3.3-70b-versatile',
                                       'messages':[{'role':'user','content':prompt}],
                                       'max_tokens':100,'temperature':0},
                                 timeout=20)
            resp = r.json()
            if 'error' in resp:
                msg = resp['error'].get('message','')
                m   = re.search(r'try again in ([\d.]+)s', msg)
                if m and attempt < retries:
                    wait = float(m.group(1)) + 1.5
                    print(f"  [Groq] Rate limit — waiting {wait:.0f}s...")
                    time.sleep(wait); continue
                print(f"  [Groq] {msg[:80]}")
                return None
            raw    = resp['choices'][0]['message']['content'].strip()
            raw    = raw.replace('```json','').replace('```','').strip()
            result = json.loads(raw)
            result['lastAnnouncement'] = valid_past(result.get('lastAnnouncement'))
            result['upcomingDate']     = valid_future(result.get('upcomingDate'))
            return result
        except Exception as e:
            print(f"  [Groq] parse error: {e}")
            return None
    return None

# ── Per-company pipeline ─────────────────────────────────────────
def process_company(co):
    name   = co.get('name','')
    ir_url = co.get('irWebsite','')

    # 1) yfinance — direct ticker lookup
    r = yf_lookup(name)
    if r and (r.get('lastAnnouncement') or r.get('upcomingDate')): return r

    # 2) Google News RSS → Groq
    prev_q = f"Q{max(1,((datetime.now().month-1)//3))} {CURRENT_YEAR}"
    news = (google_news(name, CURRENT_Q) or
            google_news(name, prev_q)     or
            google_news(name, str(CURRENT_YEAR)))
    if news:
        r = groq_extract(name, news)
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            r['source'] = 'Google News'; return r

    # 3) IR page → Groq
    ir_text = scrape_ir(ir_url)
    if ir_text:
        r = groq_extract(name, ir_text)
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            r['source'] = 'IR Page'; return r

    return None

# ── Save results ─────────────────────────────────────────────────
def update_data_json(results):
    with open(DATA_JSON,'r',encoding='utf-8') as f: data = json.load(f)
    is_dict   = isinstance(data, dict)
    companies = data.get('companies',[]) if is_dict else data
    announced = (data.get('announcedDates') or {}) if is_dict else {}

    updated = 0
    for co in companies:
        name = co.get('name','')
        r    = results.get(name)
        if not r: continue
        changed = False

        new_last = r.get('lastAnnouncement')
        if new_last and (not co.get('lastAnnouncement') or new_last > co.get('lastAnnouncement','')):
            co['lastAnnouncement'] = new_last
            try:
                co['expectedNext'] = (datetime.strptime(new_last,'%Y-%m-%d')
                                      + timedelta(days=90)).strftime('%Y-%m-%d')
            except: pass
            changed = True

        new_up = r.get('upcomingDate')
        if new_up:
            announced[name] = {'date':new_up,'url':None,
                               'timestamp':datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
                               'source':r.get('source','agent')}
            changed = True
        if changed: updated += 1

    # Clear past announced dates
    today = datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
    cleared = [n for n,e in list(announced.items())
               if datetime.strptime(e['date'],'%Y-%m-%d') < today - timedelta(days=1)]
    for n in cleared: del announced[n]
    if cleared: print(f"  🗑️  Cleared stale: {', '.join(cleared)}")

    out = {'companies':companies,'announcedDates':announced,'lastAgentRun':TODAY} if is_dict else \
          {'companies':companies,'announcedDates':announced,'lastAgentRun':TODAY}
    if is_dict:
        data['companies']      = companies
        data['announcedDates'] = announced
        data['lastAgentRun']   = TODAY
        out = data

    with open(DATA_JSON,'w',encoding='utf-8') as f: json.dump(out,f,indent=2,ensure_ascii=False)
    skipped = len(results) - updated
    print(f"\n  ✅ Updated:{updated} | No data:{skipped} | Cleared stale:{len(cleared)}")

# ── GitHub Actions workflow also needs yfinance installed ─────────
# Add to daily-agent.yml:  pip install requests yfinance

# ── Main ─────────────────────────────────────────────────────────
def main():
    print(f"🚀 News Brain Agent v2 — {TODAY}  ({CURRENT_Q})")
    if not os.path.exists(DATA_JSON): print(f"❌ {DATA_JSON} not found"); return

    with open(DATA_JSON,'r',encoding='utf-8') as f: data = json.load(f)
    companies = data.get('companies', data) if isinstance(data, dict) else data
    print(f"📋 {len(companies)} companies | yfinance:{'✅' if HAS_YF else '❌'} | Groq:{'✅' if GROQ_API_KEY else '❌'}")

    results = {}
    for i, co in enumerate(companies):
        name = co.get('name','')
        if not name: continue
        r = process_company(co)
        results[name] = r
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            print(f"  ✅ {name}: last={r.get('lastAnnouncement')} upcoming={r.get('upcomingDate')} [{r.get('source','')}]")
        else:
            print(f"  ❌ {name}: no dates found")

        if (i+1) % 25 == 0:
            print(f"\n💾 Checkpoint {i+1}..."); update_data_json(results)
        time.sleep(2)

    print("\n💾 Final save..."); update_data_json(results)
    print("🎉 Done!")

if __name__ == '__main__': main()
