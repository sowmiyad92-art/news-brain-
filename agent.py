"""
News Brain Agent v3
Sources (in order):
  1) Company IR RSS feeds (PR Newswire, GlobeNewswire, company-specific)
  2) Direct IR page scrape
  3) yfinance for US/major tickers
  4) Google Alerts Sheet (CSV)
Extractor: Groq with auto-retry

Trust model:
  yfinance -> data.json directly (high confidence)
  IR Page / RSS / Alerts -> agent_suggestions.json (needs human review)
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

# -- Config --
GROQ_API_KEY     = os.environ.get('GROQ_API_KEY', '')
DATA_JSON        = 'data.json'
SUGGESTIONS_JSON = 'agent_suggestions.json'
TODAY            = datetime.now().strftime('%Y-%m-%d')
CURRENT_YEAR     = datetime.now().year
CURRENT_Q        = f"Q{((datetime.now().month-1)//3)+1} {CURRENT_YEAR}"
MAX_AGE_DAYS     = 548

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

# -- RSS feeds --
RSS_FEEDS = {
    'Netflix':   ['https://www.prnewswire.com/rss/news-releases-list.rss?company=netflix'],
    'Disney':    ['https://www.prnewswire.com/rss/news-releases-list.rss?company=the-walt-disney-company'],
    'Amazon':    ['https://www.prnewswire.com/rss/news-releases-list.rss?company=amazon-com-inc',
                  'https://www.businesswire.com/rss/home/?rss=G22&company=amazon'],
    'Paramount': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=paramount-skydance',
                  'https://www.prnewswire.com/rss/news-releases-list.rss?company=paramount-global'],
    'Warner Bros Discovery': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=warner-bros-discovery'],
    'AMC Networks':  ['https://www.prnewswire.com/rss/news-releases-list.rss?company=amc-networks'],
    'Lionsgate':     ['https://www.prnewswire.com/rss/news-releases-list.rss?company=lionsgate'],
    'Comcast':       ['https://www.prnewswire.com/rss/news-releases-list.rss?company=comcast'],
    'Curiosity Stream': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=curiositystream'],
    'Fox Corporation': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=fox-corporation'],
    'Gray Television': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=gray-television'],
    'IMAX':          ['https://www.prnewswire.com/rss/news-releases-list.rss?company=imax'],
    'Kartoon Studios': ['https://www.prnewswire.com/rss/news-releases-list.rss?company=kartoon-studios'],
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
    'Viaplay Group': ['https://www.viaplaygroup.com/en/newsroom/press-releases/rss'],
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
    'MultiChoice':   ['https://www.prnewswire.com/rss/news-releases-list.rss?company=multichoice-group',
                      'https://www.globenewswire.com/RssFeed/company/multichoice-group'],
    'Grupo Clarin':  ['https://www.prnewswire.com/rss/news-releases-list.rss?company=grupo-clarin'],
    'Televisa':      ['https://www.prnewswire.com/rss/news-releases-list.rss?company=televisa'],
    'Sony':          ['https://www.sony.com/en/SonyInfo/IR/rss/rss.xml'],
    'Bilibili':      ['https://ir.bilibili.com/rss/news-releases.xml'],
    'Avex':          ['https://avex.com/jp/en/ir/news/rss.xml'],
    'Damai Holdings': ['https://www.hkexnews.hk/listedco/listconews/SEHK/rss/rss1060.xml'],
    'Maoyan':        ['https://www.hkexnews.hk/listedco/listconews/SEHK/rss/rss1896.xml'],
    'Digital Domain': ['https://www.hkexnews.hk/listedco/listconews/SEHK/rss/rss0547.xml'],
    'Canal+':        ['https://www.investegate.co.uk/rss/announcements/CAN'],
    'Zee Entertainment': ['https://www.globenewswire.com/RssFeed/company/zee-entertainment-enterprises',
                          'https://www.prnewswire.com/rss/news-releases-list.rss?company=zee-entertainment'],
    'Saregama':      ['https://www.globenewswire.com/RssFeed/company/saregama-india'],
    'Grammy':        ['https://investor.gmmgrammy.com/en/newsroom/set-announcements'],
    'Seven West Media': ['https://sevenwestmedia.com.au/investors/asx-announcements/'],
}

# -- US tickers for yfinance --
YF_US = {
    'Netflix': 'NFLX', 'Disney': 'DIS', 'Amazon': 'AMZN',
    'Comcast': 'CMCSA', 'Fox Corporation': 'FOXA', 'Gaia': 'GAIA',
    'Gray Television': 'GTN', 'IMAX': 'IMAX', 'Kartoon Studios': 'TOON',
    'Nexstar': 'NXST', 'Roku': 'ROKU', 'Sinclair': 'SBGI',
    'Sphere Entertainment': 'SPHR', 'TEGNA': 'TGNA',
    'Telecom Argentina': 'TEO', 'Televisa': 'TV',
    'Warner Music Group': 'WMG', 'Bilibili': 'BILI', 'NetEase': 'NTES',
    'Fubo TV': 'FUBO', 'TKO Group': 'TKO', 'Scripps': 'SSP',
    'Curiosity Stream': 'CURI', 'Lionsgate': 'LION',
    'AMC Networks': 'AMCX', 'Warner Bros Discovery': 'WBD',
    'Paramount': 'PSKY',
}


# -- HTML text extractor --
class _P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.t = []
        self._s = False

    def handle_starttag(self, tag, _):
        if tag in ('script', 'style', 'nav', 'footer', 'head'):
            self._s = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'nav', 'footer', 'head'):
            self._s = False

    def handle_data(self, d):
        if not self._s and d.strip():
            self.t.append(d.strip())


def strip_html(html):
    p = _P()
    try:
        p.feed(html)
    except:
        pass
    return ' '.join(p.t)


# -- Date validation --
def valid_past(s):
    if not s or s == 'null':
        return None
    try:
        ds = str(s)[:10]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', ds):
            return None
        dt = datetime.strptime(ds, '%Y-%m-%d')
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        if dt >= today or (today - dt).days > MAX_AGE_DAYS:
            return None
        return ds
    except:
        return None


def valid_future(s):
    if not s or s == 'null':
        return None
    try:
        ds = str(s)[:10]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', ds):
            return None
        dt = datetime.strptime(ds, '%Y-%m-%d')
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        if dt <= today or (dt - today).days > 365:
            return None
        return ds
    except:
        return None


# -- Source 1: Company RSS feeds --
def fetch_rss(name):
    feeds = RSS_FEEDS.get(name, [])
    if not feeds:
        return None, None, None, None  # text, snippet, url, date
    for feed_url in feeds:
        try:
            r = requests.get(feed_url, headers=HEADERS, timeout=12)
            if r.status_code != 200:
                print(f"  [RSS] {name}: HTTP {r.status_code} from {feed_url.split('/')[2]}")
                continue
            root = ET.fromstring(r.content)
            bits = []
            first_url, first_date = None, None
            for it in root.findall('.//item')[:6]:
                title   = it.findtext('title', '')
                pubdate = it.findtext('pubDate', '') or it.findtext('dc:date', '')
                link    = it.findtext('link', '')
                desc    = strip_html(it.findtext('description', '') or
                                     it.findtext('summary', ''))[:300]
                bits.append(f"TITLE: {title}\nDATE: {pubdate}\nSNIPPET: {desc}")
                if not first_url:
                    first_url = link
                if not first_date:
                    first_date = pubdate
            if bits:
                print(f"  [RSS] {name}: {len(bits)} items from {feed_url.split('/')[2]}")
                text = '\n\n'.join(bits)
                snippet = bits[0][:200] if bits else ''
                return text, snippet, first_url, first_date
        except Exception as e:
            pass
    return None, None, None, None


# -- Source 4: Google Alerts Sheet (CSV) --
ALERTS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRm1ifG16mCqJu0u7DeMr4I_np7nPa8aU2BGgPFtyXG2JvaUfJfiBUaXgG2Ol_5kDDuF1L_ghMQmvVG/pub?gid=86938798&single=true&output=csv'

EARNINGS_KEYWORDS = [
    'q1', 'q2', 'q3', 'q4', 'quarterly', 'earnings', 'financial results',
    'revenue', 'net profit', 'operating profit', 'results', 'fiscal'
]


def fetch_alerts_sheet():
    try:
        r = requests.get(ALERTS_CSV_URL, timeout=15)
        if r.status_code != 200:
            print(f"  Alerts sheet fetch failed: {r.status_code}")
            return {}
        lines = r.text.strip().split('\n')
        alerts = {}
        for line in lines[1:]:
            try:
                parts = line.split(',')
                if len(parts) < 6:
                    continue
                company = parts[2].strip().strip('"')
                title   = parts[3].strip().strip('"')
                snippet = parts[5].strip().strip('"')
                combined = (title + ' ' + snippet).lower()
                if not any(kw in combined for kw in EARNINGS_KEYWORDS):
                    continue
                if company not in alerts:
                    alerts[company] = []
                alerts[company].append({'title': title, 'snippet': snippet})
            except:
                continue
        print(f"  Alerts sheet: {len(alerts)} companies with earnings news")
        return alerts
    except Exception as e:
        print(f"  Alerts sheet error: {e}")
        return {}


# -- Source 2: IR page scrape --
def scrape_ir(url):
    if not url or url in ('#', '', 'N/A'):
        return None
    if any(b in url for b in BROKEN_HOSTS):
        return None
    try:
        r = requests.get(url, headers=HEADERS, timeout=12, verify=False)
        if r.status_code == 200:
            return strip_html(r.text)[:2000]
    except:
        pass
    return None


# -- Source 3: yfinance for US tickers --
def yf_lookup(name):
    if not HAS_YF:
        return None
    sym = YF_US.get(name)
    if not sym:
        return None
    try:
        tk   = yf.Ticker(sym)
        info = tk.info or {}
        last, upcoming = None, None
        et = info.get('earningsTimestamp') or info.get('earningsTimestampStart')
        if et:
            dt   = datetime.fromtimestamp(et)
            last = valid_past(dt.strftime('%Y-%m-%d'))
        ne = info.get('earningsTimestampEnd') or info.get('nextEarningsDate')
        if ne:
            if isinstance(ne, (int, float)):
                dt       = datetime.fromtimestamp(ne)
                upcoming = valid_future(dt.strftime('%Y-%m-%d'))
            else:
                upcoming = valid_future(str(ne)[:10])
        if last or upcoming:
            print(f"  [yfinance] {name} ({sym}): last={last} upcoming={upcoming}")
            return {
                'lastAnnouncement': last,
                'upcomingDate':     upcoming,
                'confidence':       'high',
                'source':           'yfinance'
            }
    except Exception as e:
        pass
    return None


# -- Groq extraction with auto-retry --
def groq_extract(name, text, retries=2):
    if not GROQ_API_KEY or not text:
        return None
    prompt = (
        f"Today: {TODAY}. Find earnings/financial results dates for {name}.\n"
        f"lastAnnouncement = date they RELEASED results (past date, before {TODAY})\n"
        f"upcomingDate = date they WILL report next (future date, after {TODAY})\n"
        f"Only use dates explicitly mentioned. null if not found.\n"
        f"Content:\n{text[:1500]}\n\n"
        f'JSON only: {{"lastAnnouncement":"YYYY-MM-DD or null","upcomingDate":"YYYY-MM-DD or null","confidence":"high/medium/low"}}'
    )
    for attempt in range(retries + 1):
        try:
            r = requests.post(
                'https://api.groq.com/openai/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {GROQ_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'llama-3.3-70b-versatile',
                    'messages': [{'role': 'user', 'content': prompt}],
                    'max_tokens': 100,
                    'temperature': 0
                },
                timeout=25
            )
            resp = r.json()
            if 'error' in resp:
                msg = resp['error'].get('message', '')
                m   = re.search(r'try again in ([\d.]+)s', msg)
                if m and attempt < retries:
                    wait = float(m.group(1)) + 12
                    print(f"  [Groq] rate limit - waiting {wait:.0f}s...")
                    time.sleep(wait)
                    continue
                print(f"  [Groq] {msg[:80]}")
                return None
            raw = resp['choices'][0]['message']['content'].strip()
            raw = raw.replace('```json', '').replace('```', '').strip()
            if raw.count('{') > raw.count('}'):
                raw += '}'
            result = json.loads(raw)
            result['lastAnnouncement'] = valid_past(result.get('lastAnnouncement'))
            result['upcomingDate']     = valid_future(result.get('upcomingDate'))
            return result
        except json.JSONDecodeError as e:
            if attempt < retries:
                time.sleep(2)
                continue
            print(f"  [Groq] JSON error: {e}")
            return None
        except Exception as e:
            print(f"  [Groq] error: {e}")
            return None
    return None


# -- Write agent_suggestions.json --
def save_suggestion(suggestions_list, name, result, source, snippet, ir_url, article_url=None, article_date=None):
    if not result:
        return
    if not result.get('lastAnnouncement') and not result.get('upcomingDate'):
        return
    suggestions_list.append({
        'company':          name,
        'lastAnnouncement': result.get('lastAnnouncement'),
        'upcomingDate':     result.get('upcomingDate'),
        'confidence':       result.get('confidence', 'medium'),
        'source':           source,
        'snippet':          snippet[:300] if snippet else '',
        'articleUrl':       article_url or ir_url or '',
        'articleDate':      article_date or '',
        'irUrl':            ir_url or '',
        'runDate':          TODAY,
        'status':           'pending',
    })


def write_suggestions(suggestions_list):
    try:
        with open(SUGGESTIONS_JSON, 'r', encoding='utf-8') as f:
            existing = json.load(f)
    except:
        existing = {'runs': []}

    existing['runs'].append({
        'date':        TODAY,
        'time':        datetime.now().strftime('%H:%M:%S'),
        'suggestions': suggestions_list,
        'total':       len(suggestions_list),
    })
    existing['runs'] = existing['runs'][-30:]

    with open(SUGGESTIONS_JSON, 'w', encoding='utf-8') as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
    print(f"  agent_suggestions.json: {len(suggestions_list)} suggestions saved")


# -- Global alerts cache --
_alerts_cache = {}


def process_company(co, suggestions_list):
    name   = co.get('name', '')
    ir_url = co.get('irWebsite', '')
    trace  = []  # NEW: track every source attempt

    yf_result = yf_lookup(name)
    if yf_result:
        trace.append({'source': 'yfinance', 'found': True,
                       'date': yf_result.get('upcomingDate') or yf_result.get('lastAnnouncement')})
    else:
        trace.append({'source': 'yfinance', 'found': False, 'reason': 'no ticker or no data'})

    if yf_result and (yf_result.get('lastAnnouncement') or yf_result.get('upcomingDate')):
        yf_result['trace'] = trace
        return yf_result

    rss_text, rss_snippet, rss_url, rss_date = fetch_rss(name)
    if rss_text:
        r = groq_extract(name, rss_text)
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            r['source'] = 'RSS Feed'
            trace.append({'source': 'RSS', 'found': True, 'url': rss_url,
                           'date': r.get('upcomingDate') or r.get('lastAnnouncement')})
            save_suggestion(suggestions_list, name, r, 'RSS Feed', rss_snippet, ir_url, rss_url, rss_date)
        else:
            trace.append({'source': 'RSS', 'found': False, 'url': rss_url, 'reason': 'no date extracted'})
    else:
        trace.append({'source': 'RSS', 'found': False, 'reason': 'no feed configured or fetch failed'})

    ir_text = scrape_ir(ir_url)
    if ir_text:
        r = groq_extract(name, ir_text)
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            r['source'] = 'IR Page'
            trace.append({'source': 'IR', 'found': True, 'url': ir_url,
                           'date': r.get('upcomingDate') or r.get('lastAnnouncement')})
            save_suggestion(suggestions_list, name, r, 'IR Page', ir_text[:200], ir_url, ir_url, '')
        else:
            trace.append({'source': 'IR', 'found': False, 'url': ir_url, 'reason': 'no date extracted'})
    else:
        trace.append({'source': 'IR', 'found': False, 'url': ir_url, 'reason': 'no IR url or fetch failed/broken'})

    alert_items = _alerts_cache.get(name, [])
    if alert_items:
        alert_text = '\n\n'.join(f"TITLE: {a['title']}\nSNIPPET: {a['snippet']}" for a in alert_items[:3])
        snippet    = f"{alert_items[0]['title']} - {alert_items[0]['snippet']}"
        alert_url  = alert_items[0].get('url', '')
        alert_date = alert_items[0].get('date', '')
        r = groq_extract(name, alert_text)
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            r['source'] = 'Google Alerts'
            trace.append({'source': 'Alerts', 'found': True, 'url': alert_url,
                           'date': r.get('upcomingDate') or r.get('lastAnnouncement')})
            save_suggestion(suggestions_list, name, r, 'Google Alerts', snippet, ir_url, alert_url, alert_date)
        else:
            trace.append({'source': 'Alerts', 'found': False, 'reason': 'no date extracted'})
    else:
        trace.append({'source': 'Alerts', 'found': False, 'reason': 'no alerts for this company'})

    return {'trace': trace}  # CHANGED: always return trace even if no winner


# -- Write agent log --
def write_agent_log(updated, no_data_list, cleared, source_breakdown, results):
    LOG_FILE = 'agent_log.json'
    try:
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            log = json.load(f)
    except:
        log = {'runs': []}

    company_details = {}
    for name, r in results.items():
        if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
            company_details[name] = {
                'lastAnnouncement': r.get('lastAnnouncement'),
                'upcomingDate':     r.get('upcomingDate'),
                'source':           r.get('source', 'unknown'),
                'confidence':       r.get('confidence', 'unknown'),
            }

    log['runs'].append({
        'date':            TODAY,
        'time':            datetime.now().strftime('%H:%M:%S'),
        'updated':         updated,
        'noData':          no_data_list,
        'cleared':         cleared,
        'sourceBreakdown': source_breakdown,
        'companies':       company_details,
        'traces':          traces or {},  # NEW
    })
    log['runs'] = log['runs'][-60:]

    with open(LOG_FILE, 'w', encoding='utf-8') as f:
        json.dump(log, f, indent=2, ensure_ascii=False)
    print(f"  agent_log.json updated ({len(log['runs'])} runs stored)")


# -- Save yfinance results to data.json --
def update_data_json(results, write_log=False):
    with open(DATA_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)
    is_dict   = isinstance(data, dict)
    companies = data.get('companies', []) if is_dict else data
    announced = (data.get('announcedDates') or {}) if is_dict else {}

    updated = 0
    for co in companies:
        name = co.get('name', '')
        r    = results.get(name)
        if not r:
            continue
        changed = False

        nl = r.get('lastAnnouncement')
        if nl and (not co.get('lastAnnouncement') or nl > co.get('lastAnnouncement', '')):
            co['lastAnnouncement'] = nl
            try:
                co['expectedNext'] = (datetime.strptime(nl, '%Y-%m-%d') + timedelta(days=90)).strftime('%Y-%m-%d')
            except:
                pass
            changed = True
            if name in announced and announced[name]['date'] <= nl:
                print(f"  {name}: clearing announcedDate - consumed by lastAnnouncement {nl}")
                del announced[name]

        nu = r.get('upcomingDate')
        if nu:
            last_ann = co.get('lastAnnouncement', '')
            if nu > last_ann:
                announced[name] = {
                    'date':      nu,
                    'url':       None,
                    'timestamp': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
                    'source':    r.get('source', 'agent')
                }
                changed = True
            else:
                print(f"  {name}: skipping upcomingDate {nu} - not after lastAnnouncement {last_ann}")

        if changed:
            updated += 1

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    cleared = [n for n, e in list(announced.items())
               if datetime.strptime(e['date'], '%Y-%m-%d') < today - timedelta(days=1)]
    for n in cleared:
        del announced[n]
    if cleared:
        print(f"  Cleared stale: {', '.join(cleared)}")

    if is_dict:
        data['companies']     = companies
        data['announcedDates'] = announced
        data['lastAgentRun']  = TODAY
    with open(DATA_JSON, 'w', encoding='utf-8') as f:
        json.dump(
            data if is_dict else {'companies': companies, 'announcedDates': announced, 'lastAgentRun': TODAY},
            f, indent=2, ensure_ascii=False
        )

    no_data_list  = [n for n, r in results.items() if not r or
                     (not r.get('lastAnnouncement') and not r.get('upcomingDate'))]
    source_counts = {}
    for r in results.values():
        if r and r.get('source'):
            src = r['source'].lower().replace(' ', '_').replace('rss_feed', 'rss').replace('ir_page', 'ir')
            source_counts[src] = source_counts.get(src, 0) + 1

    print(f"\n  Updated:{updated} | No data:{len(no_data_list)} | Cleared:{len(cleared)}")
    if write_log:
        write_agent_log(updated, no_data_list, len(cleared), source_counts, results)


# -- Main --
def main():
    print(f"News Brain Agent v3 - {TODAY} ({CURRENT_Q})")
    print(f"GROQ_API_KEY: {'SET' if GROQ_API_KEY else 'MISSING'}")
    if not os.path.exists(DATA_JSON):
        print("data.json not found")
        return

    with open(DATA_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)
    companies = data.get('companies', data) if isinstance(data, dict) else data
    print(f"{len(companies)} companies | RSS feeds:{len(RSS_FEEDS)} | yfinance:{'yes' if HAS_YF else 'no'}")

    global _alerts_cache
    _alerts_cache = fetch_alerts_sheet()

    results     = {}
    traces      = {}  # NEW
    suggestions = []

    for i, co in enumerate(companies):
    name = co.get('name', '')
    if not name:
        continue
    r = process_company(co, suggestions)
    traces[name] = r.get('trace', []) if r else []
    if r and (r.get('lastAnnouncement') or r.get('upcomingDate')):
        results[name] = r
    else:
        results[name] = None
    ...

        if (i + 1) % 25 == 0:
            print(f"\nCheckpoint {i+1}...")
            update_data_json(results, write_log=False)

        time.sleep(2)

    print("\nFinal save...")

    suggestion_sources = {}
    for s in suggestions:
        src = s.get('source', '').lower().replace(' ', '_').replace('ir_page', 'ir').replace('rss_feed', 'rss')
        suggestion_sources[src] = suggestion_sources.get(src, 0) + 1

    update_data_json(results, write_log=False)  # saves data.json

    no_data_list = [n for n, r in results.items() if not r or
                    (not r.get('lastAnnouncement') and not r.get('upcomingDate'))]
    source_counts = {}
    for r in results.values():
        if r and r.get('source'):
            src = r['source'].lower().replace(' ', '_').replace('rss_feed', 'rss').replace('ir_page', 'ir')
            source_counts[src] = source_counts.get(src, 0) + 1
    source_counts.update(suggestion_sources)  # merges RSS/IR suggestion counts in

    write_agent_log(len([r for r in results.values() if r]), no_data_list, 0, source_counts, results)
    write_suggestions(suggestions)
    print(f"Agent v3 complete! {len(suggestions)} suggestions pending review.")


if __name__ == '__main__':
    main()
