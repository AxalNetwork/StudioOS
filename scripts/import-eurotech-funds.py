#!/usr/bin/env python3
"""Import the EuroTech VC fund spreadsheet into the public fund catalog model."""
import csv
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'attached_assets' / 'EuroTechVCFunds(from1_2016)-Sheet1.csv'
DIRECTORY = ROOT / 'frontend/src/data/fundDirectory.json'
MIGRATION = ROOT / 'cloudflare-worker/sql/migrations/365_research_eurotech_fund_directory.sql'
YEARS = list(range(2016, 2027))
SOURCE_URL = 'https://github.com/AxalNetwork/StudioOS/blob/main/attached_assets/EuroTechVCFunds(from1_2016)-Sheet1.csv'


def norm(value):
    value = unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', value)


def euro_cents(value):
    if not value:
        return None
    m = re.search(r'(\d+(?:[.,]\d+)?)', value.replace('.', '').replace(',', '.'))
    if not m:
        return None
    return round(float(m.group(1)) * 100_000_000)  # €Xm -> cents


def euro_millions(value):
    if not value:
        return None
    m = re.search(r'(\d+(?:[.,]\d+)?)', value.replace('.', '').replace(',', '.'))
    return float(m.group(1)) if m else None


def sql(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return '1' if value else '0'
    return "'" + str(value).replace("'", "''") + "'"


def parse_date(value):
    if not value:
        return None
    for fmt in ('%d %b %y', '%d %B %y'):
        try:
            return datetime.strptime(value.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    m = re.match(r'^(\d{1,2})-(\d{4})$', value.strip())
    return f'{m.group(2)}-{int(m.group(1)):02d}-01' if m else None


def period_for_year(year):
    return f'{year}-Q4'


def period_for_qtr(value, year):
    m = re.search(r'Q([1-4])', value or '')
    return f'{year}-Q{m.group(1)}' if m else None


def main():
    with SOURCE.open(newline='', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    directory = json.loads(DIRECTORY.read_text())
    by_name = {norm(item['name']): item for item in directory['items']}
    grouped = defaultdict(list)
    for row in rows:
        grouped[norm(row['Fund Name'])].append(row)

    histories = {}
    enriched = 0
    for key, events in grouped.items():
        item = by_name.get(key)
        if not item:
            continue
        item['source'] = 'euro_vc'
        item['source_label'] = 'EuroTech VC Funds (public spreadsheet)'
        item['linkedin'] = events[-1].get('LI') or item.get('linkedin')
        item['fund_number'] = events[-1].get('#') or item.get('fund_number')
        item['notable_lps'] = events[-1].get('Notable Known LPs') or item.get('notable_lps')
        item['eurotech_report_month'] = events[-1].get('Month') or None
        item['eurotech_report_count'] = len(events)
        item['quarter'] = events[-1].get('Qtr') or item.get('quarter')
        item['eurotech_eif_flag'] = any('EIF' in (e.get('Notable Known LPs') or '') for e in events)
        item['eurotech_eifo_flag'] = any('EIFO' in (e.get('Notable Known LPs') or '') for e in events)
        observations = {}
        for row in events:
            current_period = period_for_qtr(row.get('Qtr'), row.get('')) or period_for_qtr(row.get('Qtr'), row.get(''))
            if not current_period:
                year = row.get('')
                current_period = period_for_qtr(row.get('Qtr'), year)
            # DictReader keeps duplicate/blank headers under generated keys; use the original positions below instead.
            # The current event is anchored by the explicit Month column.
            report_date = parse_date(row.get('Month'))
            qtr = row.get('Qtr') or ''
            year_match = re.search(r'(20\d{2})', qtr) or re.search(r'(20\d{2})', row.get('Month') or '')
            if year_match:
                current_period = period_for_qtr(qtr, year_match.group(1)) or f"{year_match.group(1)}-Q4"
            if current_period and euro_cents(row.get('') or row.get('Fund Size')):
                observations[current_period] = {'period': current_period, 'report_date': report_date, 'fund_size_cents': euro_cents(row.get('') or row.get('Fund Size')), 'fund_size_eur_m': euro_millions(row.get('') or row.get('Fund Size')), 'source_url': SOURCE_URL}
        histories[item['id']] = sorted(observations.values(), key=lambda x: x['period'])
        enriched += 1

    # Re-read positionally because the CSV has intentionally blank spreadsheet headers.
    with SOURCE.open(newline='', encoding='utf-8-sig') as f:
        raw = list(csv.reader(f))
    header, raw_rows = raw[0], raw[1:]
    histories = defaultdict(dict)
    for row in raw_rows:
        key = norm(row[0])
        item = by_name.get(key)
        if not item:
            continue
        report_date = parse_date(row[68] if len(row) > 68 else '')
        qtr = row[7] if len(row) > 7 else ''
        year = row[8] if len(row) > 8 else ''
        period = period_for_qtr(qtr, year) or (f'{year}-Q4' if re.match(r'^20\d{2}$', year) else None)
        if period and euro_cents(row[5] if len(row) > 5 else ''):
            histories[item['id']][period] = {'period': period, 'report_date': report_date, 'fund_size_cents': euro_cents(row[5]), 'fund_size_eur_m': euro_millions(row[5]), 'source_url': SOURCE_URL}
        for idx, y in enumerate(YEARS, start=13):
            if idx < len(row) and row[idx].strip() and euro_cents(row[idx]):
                p = period_for_year(y)
                histories[item['id']][p] = {'period': p, 'report_date': f'{y}-12-31', 'fund_size_cents': euro_cents(row[idx]), 'fund_size_eur_m': euro_millions(row[idx]), 'source_url': SOURCE_URL}

    for item in directory['items']:
        if item['id'] in histories:
            item['quarterly_reports'] = sorted(histories[item['id']].values(), key=lambda x: x['period'])
    directory['generated_from'] = ['EuroTechVCFunds(from1_2016)-Sheet1.csv', 'Deep_Tech_Investors_Mapping_-_Public_version_-_Sheet1_1783956632757.csv']
    directory['generated_at'] = datetime.now().date().isoformat()
    directory['eurotech_import'] = {'source_name': 'EuroTech VC Funds (from 1/2016)', 'source_url': SOURCE_URL, 'rows': len(rows), 'unique_funds': len(grouped), 'funds_enriched': len(histories), 'currency': 'EUR', 'observations': sum(len(v) for v in histories.values())}
    DIRECTORY.write_text(json.dumps(directory, ensure_ascii=False, separators=(',', ':')))

    lines = [
        '-- 365 — public EuroTech VC fund directory and spreadsheet-shaped quarterly observations.',
        '-- Discovery metadata and reported fund-size observations only; no performance is inferred.',
        'CREATE TABLE IF NOT EXISTS research_fund_directory (uid TEXT PRIMARY KEY, name TEXT NOT NULL, website TEXT, linkedin TEXT, hq TEXT, fund_number TEXT, fund_size_cents INTEGER, fund_date TEXT, quarter TEXT, fund_year INTEGER, sector_focus TEXT, notable_lps TEXT, eif_flag INTEGER NOT NULL DEFAULT 0, eifo_flag INTEGER NOT NULL DEFAULT 0, source_name TEXT NOT NULL, source_url TEXT NOT NULL, as_of TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS idx_research_fund_directory_name ON research_fund_directory(name);',
        'CREATE INDEX IF NOT EXISTS idx_research_fund_directory_hq ON research_fund_directory(hq);',
        'CREATE TABLE IF NOT EXISTS research_fund_directory_reports (fund_uid TEXT NOT NULL REFERENCES research_fund_directory(uid) ON DELETE CASCADE, period TEXT NOT NULL, report_date TEXT, fund_size_cents INTEGER, source_url TEXT NOT NULL, PRIMARY KEY (fund_uid, period));',
        'CREATE INDEX IF NOT EXISTS idx_research_fund_directory_reports_period ON research_fund_directory_reports(fund_uid, period);',
    ]
    as_of = datetime.now().date().isoformat()
    for item in directory['items']:
        if item.get('source') != 'euro_vc':
            continue
        hq = item.get('hq')
        lines.append('INSERT OR REPLACE INTO research_fund_directory (uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of) VALUES (%s);' % ','.join(map(sql, [item['id'], item['name'], item.get('website'), item.get('linkedin'), hq, item.get('fund_number'), euro_cents(item.get('fund_size')), item.get('fund_date'), item.get('quarter'), item.get('fund_year'), ' · '.join(item.get('sectors') or []), item.get('notable_lps'), int(bool(item.get('eurotech_eif_flag'))), int(bool(item.get('eurotech_eifo_flag')),), 'EuroTech VC Funds (public spreadsheet)', SOURCE_URL, as_of])))
        for report in item.get('quarterly_reports', []):
            lines.append('INSERT OR REPLACE INTO research_fund_directory_reports (fund_uid,period,report_date,fund_size_cents,source_url) VALUES (%s);' % ','.join(map(sql, [item['id'], report['period'], report.get('report_date'), report.get('fund_size_cents'), report['source_url']])))
    MIGRATION.write_text('\n'.join(lines) + '\n')
    print(json.dumps(directory['eurotech_import'], indent=2))
    print('migration_bytes', MIGRATION.stat().st_size)

if __name__ == '__main__':
    main()
