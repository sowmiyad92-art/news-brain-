"""
News Brain Agent v3
Sources (in order):
  1) Company IR RSS feeds (PR Newswire, GlobeNewswire, company-specific)
  2) Direct IR page scrape
  3) yfinance for US/major tickers
Extractor: Groq with auto-retry
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

# ── Config ───────────────────────────────────────────────────────
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
DATA_JSON    = 'data.json'
TODAY        = datetime.now().strftime('%Y-%m-%d')
CURRENT_YEAR = datetime.now().year
CURRENT_Q    = f"Q{((datetime.now().month-1)//3)+1} {CURRENT_YEAR}"
MAX_AGE_DAYS = 548  # reject dates older than 18 months

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'en-US,en;q=0.9',
}

BROKEN_HOSTS = [
    'ir.paramount.com','investors.amcnetworks.com','www.cmcsa.com',
    'investors.tegna.com','ir.netease.com','ir.lionsgate.com',
    'ir.wmg.com','ir.tkogrp.com','ir.sphereentertainmentco.com',
    'www.balajitelefilms.com',
]

# ── RSS feeds from your IR_DATA research ────────────────────────
# Priority order: company RSS → PR Newswire → GlobeNewswire
RSS_FEEDS = {
    'Netflix':   ['https://www.prnewswire.com/rss/news-releases-list.rss?company=netflix'],
    'Disney':    ['https://www.prnewswire.com/rss/news-releases-list.rss?company=the-walt-disney-company'],
    'Amazon':    ['https://www.prnewswire.com/rss/news-releases-list.rss?company=amazon-com-inc',
                  'https://www.businesswire.com/rss/home/?rss=G22&company=amazon'],
    'Paramount': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=paramount-global',
                  'https://www.globenewswire.com/RssFeed/company/paramount-global'],
    'Warner Bros Discovery': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=warner-bros-discovery'],
    'AMC Networks':  ['https://www.prnewswire.com/rss/news-releases-list.rss?company=amc-networks'],
    'Lionsgate':     ['https://www.prnewswire.com/rss/news-releases-list.rss?company=lionsgate'],
    'Comcast':       ['https://www.prnewswire.com/rss/news-releases-list.rss?company=comcast'],
    'Curiosity Stream': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=curiositystream'],
    'Fox Corporation': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=fox-corporation'],
    'Gray Television': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=gray-television'],
    'IMAX':          ['https://www.prnewswire.com/rss/news-releases-list.rss?company=imax'],
    'Kartoon Studios':['https://www.prnewswire.com/rss/news-releases-list.rss?company=kartoon-studios'],
    'Nexstar':       ['https://www.prnewswire.com/rss/news-releases-list.rss?company=nexstar-media-group'],
    'Roku':          ['https://www.prnewswire.com/rss/news-releases-list.rss?company=roku'],
    'TEGNA':         ['https://www.prnewswire.com/rss/news-releases-list.rss?company=tegna'],
    'Warner Music Group': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=warner-music-group'],
    'Fubo TV':       ['https://www.prnewswire.com/rss/news-releases-list.rss?company=fubotv'],
    'TKO Group':     ['https://www.prnewswire.com/rss/news-releases-list.rss?company=tko-group-holdings'],
    'Scripps':       ['https://www.prnewswire.com/rss/news-releases-list.rss?company=the-e-w-scripps-company'],
    'BCE':           ['https://www.bce.ca/news-and-media/newsroom/rss'],
    'Cineplex':      ['https://www.prnewswire.com/rss/news-releases-list.rss?company=cineplex'],
    'Quebecor':      ['https://www.prnewswire.com/rss/news-releases-list.rss?company=quebecor'],
    'Rogers':        ['https://investors.rogers.com/news-releases/rss/'],
    'WildBrain':     ['https://www.prnewswire.com/rss/news-releases-list.rss?company=wildbrain'],
    'Universal Music Group': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=universal-music-group',
                              'https://www.globenewswire.com/RssFeed/company/universal-music-group'],
    'Viaplay Group': ['https://www.viaplaygroup.com/rss'],
    'RTL Group':     ['https://www.prnewswire.com/rss/news-releases-list.rss?company=rtl-group'],
    'Banijay':       ['https://www.globenewswire.com/RssFeed/company/banijay-group'],
    'ITV':           ['https://www.prnewswire.com/rss/news-releases-list.rss?company=itv-plc'],
    'Groupe M6':     ['https://www.globenewswire.com/RssFeed/company/groupe-m6'],
    'MFE MediaForEurope': ['https://www.globenewswire.com/RssFeed/company/mfe-mediaforeurope'],
    'ProSiebenSat.1': ['https://www.globenewswire.com/RssFeed/company/prosiebensat1-media-se'],
    'TF1':           ['https://www.globenewswire.com/RssFeed/company/tf1'],
    'Vivendi':       ['https://www.vivendi.com/en/press/press-releases/feed/'],
    'Xilam':         ['https://www.globenewswire.com/RssFeed/company/xilam-animation'],
    'Vantiva':       ['https://www.globenewswire.com/RssFeed/company/vantiva'],
    'MultiChoice':   ['https://www.prnewswire.com/rss/news-releases-list.rss?company=multichoice-group'],
    'Grupo Clarin':  ['https://www.prnewswire.com/rss/news-releases-list.rss?company=grupo-clarin'],
    'Televisa':      ['https://www.prnewswire.com/rss/news-releases-list.rss?company=televisa'],
    'Sony':          ['https://www.sony.com/en/SonyInfo/IR/rss/rss.xml'],
    'Bilibili':      ['https://ir.bilibili.com/rss/news-releases.xml'],
    'Avex':          ['https://avex.com/jp/en/ir/news/rss.xml'],
    'Damai Holdings':['https://www.hkexnews.hk/listedco/listconews/SEHK/rss/rss1060.xml'],
    'Maoyan':        ['https://www.hkexnews.hk/listedco/listconews/SEHK/rss/rss1896.xml'],
    'Digital Domain':['https://www.hkexnews.hk/listedco/listconews/SEHK/rss/rss0547.xml'],
    'Grammy':        ['https://investor.gmmgrammy.com/en/newsroom/set-announcements'],
    'Seven West Media':['https://sevenwestmedia.com.au/investors/asx-announcements/'],
}

# ── US tickers for yfinance (reliable earningsTimestamp) ────────
YF_US = {
    'Netflix':'NFLX','Disney':'DIS','Amazon':'AMZN',
    'Comcast':'CMCSA','Fox Corporation':'FOXA','Gaia':'GAIA',
    'Gray Television':'GTN','IMAX':'IMAX','Kartoon Studios':'TOON',
    'Nexstar':'NXST','Roku':'ROKU','Sinclair':'SBGI',
    'Sphere Entertainment':'SPHR','TEGNA':'TGNA',
    'Telecom Argentina':'TEO','Televisa':'TV',
    'Warner Music Group':'WMG','Bilibili':'BILI','NetEase':'NTES',
    'Fubo TV':'FUBO','TKO Group':'TKO','Scripps':'SSP',
    'Curiosity Stream':'CURI','Lionsgate':'LION',
    'AMC Networks':'AMCX','Warner Bros Discovery':'WBD',
}

# ── HTML text extractor ──────────────────────────────────────────
class _P(HTMLParser):
    def __init__(self): super().__init__(); self.t=[]; self._s=False
    def handle_starttag(self,tag,_):
        if tag in ('script','style','nav','footer','head'): self._s=True
    def handle_endtag(self,tag):
        if tag in ('script','style','nav','footer','head'): self._s=False
    def handle_data(self,d):
        if not self._s and d.strip(): self.t.append(d.strip())

def strip_html(html):
    p=_P()
    try: p.feed(html)
    except: pass
    return ' '.join(p.t)

# ── Date validation ──────────────────────────────────────────────
def valid_past(s):
    if not s or s=='null': return None
    try:
        ds=str(s)[:10]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$',ds): return None
        dt=datetime.strptime(ds,'%Y-%m-%d')
        today=datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
        if dt>=today or (today-dt).days>MAX_AGE_DAYS: return None
        return ds
    except: return None

def valid_future(s):
    if not s or s=='null': return None
    try:
        ds=str(s)[:10]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$',ds): return None
        dt=datetime.strptime(ds,'%Y-%m-%d')
        today=datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
        if dt<=today or (dt-today).days>365: return None
        return ds
    except: return None

# ── Source 1: Company RSS feeds ──────────────────────────────────
def fetch_rss(name):
    feeds = RSS_FEEDS.get(name, [])
    for feed_url in feeds:
        try:
            r    = requests.get(feed_url, headers=HEADERS, timeout=12)
            if r.status_code != 200: continue
            root = ET.fromstring(r.content)
            bits = []
            for it in root.findall('.//item')[:6]:
                title   = it.findtext('title','')
                pubdate = it.findtext('pubDate','') or it.findtext('dc:date','')
                desc    = strip_html(it.findtext('description','') or
                                     it.findtext('summary',''))[:300]
                bits.append(f"TITLE: {title}\nDATE: {pubdate}\nSNIPPET: {desc}")
            if bits:
                print(f"  📰 [RSS] {name}: {len(bits)} items from {feed_url.split('/')[2]}")
                return '\n\n'.join(bits)
        except Exception as e:
            pass
    return None

# ── Source 2: IR page scrape ─────────────────────────────────────
def scrape_ir(url):
    if not url or url in ('#','','N/A'): return None
    if any(b in url for b in BROKEN_HOSTS): return None
    try:
        r = requests.get(url, headers=HEADERS, timeout=12, verify=False)
        if r.status_code==200: return strip_html(r.text)[:2000]
    except: pass
    return None

# ── Source 3: yfinance for US tickers ───────────────────────────
def yf_lookup(name):
    if not HAS_YF: return None
    sym = YF_US.get(name)
    if not sym: return None
    try:
        tk   = yf.Ticker(sym)
        info = tk.info or {}
        last, upcoming = None, None

        # earningsTimestamp = last reported earnings (Unix timestamp)
        et = info.get('earningsTimestamp') or info.get('earningsTimestampStart')
        if et:
            dt = datetime.fromtimestamp(et)
            last = valid_past(dt.strftime('%Y-%m-%d'))

        # earningsTimestampEnd / nextEarningsDate = upcoming
        ne = info.get('earningsTimestampEnd') or info.get('nextEarningsDate')
        if ne:
            if isinstance(ne, (int, float)):
                dt = datetime.fromtimestamp(ne)
                upcoming = valid_future(dt.strftime('%Y-%m-%d'))
            else:
                upcoming = valid_future(str(ne)[:10])

        if last or upcoming:
            print(f"  📈 [yfinance] {name} ({sym}): last={last} upcoming={upcoming}")
            return {'lastAnnouncement':last,'upcomingDate':upcoming,
                    'confidence':'high','source':'yfinance'}
    except Exception as e:
        pass
    return None

# ── Groq extraction with auto-retry ─────────────────────────────
def groq_extract(name, text, retries=2):
    if not GROQ_API_KEY or not text: return None
    prompt = (f"Today: {TODAY}. Find earnings/financial results dates for {name}.\n"
              f"lastAnnouncement = date they RELEASED results (past date, before {TODAY})\n"
              f"upcomingDate = date they WILL report next (future date, after {TODAY})\n"
              f"Only use dates explicitly mentioned. null if not found.\n"
              f"Content:\n{text[:1500]}\n\n"
              f'JSON only: {{"lastAnnouncement":"YYYY-MM-DD or null","upcomingDate":"YYYY-MM-DD or null","confidence":"high/medium/low"}}')

    for attempt in range(retries+1):
        try:
            r    = requests.post(
                'https://api.groq.com/openai/v1/chat/completions',
                headers={'Authorization':f'Bearer {GROQ_API_KEY}',
                         'Content-Type':'application/json'},
                json={'model':'llama-3.3-70b-versatile',
                      'messages':[{'role':'user','content':prompt}],
                      'max_tokens':100,'temperature':0},
                timeout=25)
            resp = r.json()
            if 'error' in resp:
                msg = resp['error'].get('message','')
                m   = re.search(r'try again in ([\d.]+)s', msg)
                if m and attempt < retries:
                    wait = float(m.group(1))+2
                    print(f"  [Groq] rate limit — waiting {wait:.0f}s...")
                    time.sleep(wait); continue
                print(f"  [Groq] {msg[:80]}")
                return None
            raw    = resp['choices'][0]['message']['content'].strip()
            raw    = raw.replace('```json','').replace('```','').strip()
            # Clean up truncated JSON
            if raw.count('{') > raw.count('}'):
                raw += '}'
            result = json.loads(raw)
            result['lastAnnouncement'] = valid_past(result.get('lastAnnouncement'))
            result['upcomingDate']     = valid_future(result.get('upcomingDate'))
            return result
        except json.JSONDecodeError as e:
            if attempt < retries:
                time.sleep(2); continue
            print(f"  [Groq] JSON error: {e}")
            return None
        except Exception as e:
            print(f"  [Groq] error: {e}")
            return None
    return None

# ── Per-company pipeline ─────────────────────────────────────────
def process_company(co):
    name   = co.get('name','')
    ir_url = co.get('irWebsite','')

    # 1) Company RSS feeds → Groq
    rss_text = fetch_rss(name)
    if rss_text:
        r = groq_extract(name, rss_text)
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            r['source'] = 'RSS Feed'; return r

    # 2) IR page scrape → Groq
    ir_text = scrape_ir(ir_url)
    if ir_text:
        r = groq_extract(name, ir_text)
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            r['source'] = 'IR Page'; return r

    # 3) yfinance (US tickers only — as backup)
    r = yf_lookup(name)
    if r and (r.get('lastAnnouncement') or r.get('upcomingDate')): return r

    return None

# ── Save results ─────────────────────────────────────────────────
def update_data_json(results):
    with open(DATA_JSON,'r',encoding='utf-8') as f: data=json.load(f)
    is_dict   = isinstance(data,dict)
    companies = data.get('companies',[]) if is_dict else data
    announced = (data.get('announcedDates') or {}) if is_dict else {}

    updated=0
    for co in companies:
        name=co.get('name',''); r=results.get(name)
        if not r: continue
        changed=False
       nl=r.get('lastAnnouncement')
        if nl and (not co.get('lastAnnouncement') or nl>co.get('lastAnnouncement','')):
            co['lastAnnouncement']=nl
            try:
                co['expectedNext']=(datetime.strptime(nl,'%Y-%m-%d')
                                    +timedelta(days=90)).strftime('%Y-%m-%d')
            except: pass
            changed=True
            # Clear announcedDate if it's now consumed by the updated lastAnnouncement
            if name in announced and announced[name]['date'] <= nl:
                print(f"  🗑️  {name}: clearing announcedDate {announced[name]['date']} — consumed by lastAnnouncement {nl}")
                del announced[name]

        nu=r.get('upcomingDate')
        if nu:
            last_ann = co.get('lastAnnouncement', '')
            if nu > last_ann:  # Only store if genuinely AFTER last known announcement
                announced[name]={'date':nu,'url':None,
                                 'timestamp':datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
                                 'source':r.get('source','agent')}
                changed=True
            else:
                print(f"  ⚠️  {name}: skipping upcomingDate {nu} — not after lastAnnouncement {last_ann}")
        nu=r.get('upcomingDate')
        if nu:
            announced[name]={'date':nu,'url':None,
                             'timestamp':datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
                             'source':r.get('source','agent')}
            changed=True
        if changed: updated+=1

    today=datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
    cleared=[n for n,e in list(announced.items())
             if datetime.strptime(e['date'],'%Y-%m-%d')<today-timedelta(days=1)]
    for n in cleared: del announced[n]
    if cleared: print(f"  🗑️  Cleared stale: {', '.join(cleared)}")

    if is_dict:
        data['companies']=companies; data['announcedDates']=announced
        data['lastAgentRun']=TODAY
    with open(DATA_JSON,'w',encoding='utf-8') as f:
        json.dump(data if is_dict else
                  {'companies':companies,'announcedDates':announced,'lastAgentRun':TODAY},
                  f,indent=2,ensure_ascii=False)
    print(f"\n  ✅ Updated:{updated} | No data:{len(results)-updated} | Cleared:{len(cleared)}")

# ── Main ─────────────────────────────────────────────────────────
def main():
    print(f"🚀 News Brain Agent v3 — {TODAY} ({CURRENT_Q})")
    if not os.path.exists(DATA_JSON): print("❌ data.json not found"); return

    with open(DATA_JSON,'r',encoding='utf-8') as f: data=json.load(f)
    companies=data.get('companies',data) if isinstance(data,dict) else data
    print(f"📋 {len(companies)} companies | RSS feeds:{len(RSS_FEEDS)} | yfinance:{'✅' if HAS_YF else '❌'}")

    results={}
    for i,co in enumerate(companies):
        name=co.get('name','')
        if not name: continue
        r=process_company(co)
        results[name]=r
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            print(f"  ✅ {name}: last={r.get('lastAnnouncement')} upcoming={r.get('upcomingDate')} [{r.get('source','')}]")
        else:
            print(f"  ❌ {name}: no dates found")

        if (i+1)%25==0:
            print(f"\n💾 Checkpoint {i+1}..."); update_data_json(results)
        time.sleep(2)

    print("\n💾 Final save..."); update_data_json(results)
    print("🎉 Agent v3 complete!")

if __name__=='__main__': main()
