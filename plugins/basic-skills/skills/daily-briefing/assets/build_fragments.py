#!/usr/bin/env python3
"""
Converts Jira and GitHub structured markdown into HTML fragments for the daily briefing email.

Usage:
  python3 build_fragments.py --jira <jira_file> --github <github_file>

Output (stdout):
  JIRA_FLOW_ROWS:
  <html rows>

  JIRA_PLT_ROWS:
  <html rows>

  GITHUB_SCOPES_HTML:
  <html blocks>
"""

import argparse
from html import escape

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

STATUS_COLORS = {
    'done':        ('background:#f0fff4', 'color:#276749'),
    'in progress': ('background:#ebf8ff', 'color:#2b6cb0'),
    'qa':          ('background:#faf5ff', 'color:#6b46c1'),
    'review':      ('background:#faf5ff', 'color:#6b46c1'),
    'to do':       ('background:#edf2f7', 'color:#4a5568'),
    'backlog':     ('background:#edf2f7', 'color:#4a5568'),
    'created':     ('background:#edf2f7', 'color:#4a5568'),
}

TD = 'style="padding:8px 10px;border-bottom:1px solid #e8ecf0;'


def format_date(raw):
    raw = raw.strip().lstrip('updated').strip()
    if len(raw) >= 10 and raw[4] == '-':
        try:
            _, m, d = raw[:10].split('-')
            return f'{int(d)} {MONTHS[int(m) - 1]}'
        except (ValueError, IndexError):
            pass
    return raw


def status_badge(status):
    bg, fg = STATUS_COLORS.get(status.lower(), ('background:#edf2f7', 'color:#4a5568'))
    return f'<span style="{bg};{fg};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">{escape(status)}</span>'


# ── Jira ──────────────────────────────────────────────────────────────────────

def jira_row(parts):
    # key | summary | type | status | assignee | date | [tag] | url
    if len(parts) < 7:
        return None
    key     = parts[0].strip()
    summary = parts[1].strip()
    itype   = parts[2].strip()
    status  = parts[3].strip()
    assignee = parts[4].strip()
    date    = parts[5].strip()
    url     = parts[7].strip() if len(parts) >= 8 else parts[6].strip()
    return (
        f'<tr style="background:#ffffff;">'
        f'<td {TD}white-space:nowrap;"><a href="{escape(url)}" style="color:#4f8ef7;text-decoration:none;font-weight:600;">{escape(key)}</a></td>'
        f'<td {TD}color:#2d3748;">{escape(summary)}</td>'
        f'<td {TD}color:#718096;white-space:nowrap;">{escape(itype)}</td>'
        f'<td {TD}white-space:nowrap;">{status_badge(status)}</td>'
        f'<td {TD}color:#4a5568;">{escape(assignee)}</td>'
        f'<td {TD}color:#718096;white-space:nowrap;">{escape(date)}</td>'
        f'</tr>'
    )


def parse_jira(text, project):
    rows = []
    in_section = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('## '):
            in_section = stripped[3:].strip().upper() == project.upper()
            continue
        if not in_section or not stripped.startswith('- '):
            continue
        parts = stripped[2:].split('|')
        try:
            row = jira_row(parts)
            if row:
                rows.append(row)
        except Exception:
            pass
    return ('\n'.join(rows) if rows else
            '<tr><td colspan="6" style="padding:12px 10px;color:#a0aec0;font-style:italic;">No hay actividad.</td></tr>')


# ── GitHub ────────────────────────────────────────────────────────────────────

EMPTY_4 = '<tr><td colspan="4" style="padding:12px 10px;color:#a0aec0;font-style:italic;">No hay actividad reciente.</td></tr>'


def commit_row(repo, parts):
    # message | author | date | url
    if len(parts) < 3:
        return None
    message = parts[0].strip()
    author  = parts[1].strip()
    date    = format_date(parts[2].strip())
    url     = parts[3].strip() if len(parts) >= 4 else '#'
    return (
        f'<tr style="background:#ffffff;">'
        f'<td {TD}color:#4a5568;white-space:nowrap;font-family:monospace;font-size:12px;">{escape(repo)}</td>'
        f'<td {TD}"><a href="{escape(url)}" style="color:#2d3748;text-decoration:none;">{escape(message)}</a></td>'
        f'<td {TD}color:#718096;white-space:nowrap;">{escape(author)}</td>'
        f'<td {TD}color:#718096;white-space:nowrap;">{date}</td>'
        f'</tr>'
    )


def pr_row(repo, parts):
    # title | author | updated | url
    if len(parts) < 3:
        return None
    title   = parts[0].strip()
    author  = parts[1].strip()
    date    = format_date(parts[2].strip())
    url     = parts[3].strip() if len(parts) >= 4 else '#'
    return (
        f'<tr style="background:#ffffff;">'
        f'<td {TD}color:#4a5568;white-space:nowrap;font-family:monospace;font-size:12px;">{escape(repo)}</td>'
        f'<td {TD}"><a href="{escape(url)}" style="color:#4f8ef7;text-decoration:none;">{escape(title)}</a></td>'
        f'<td {TD}color:#718096;white-space:nowrap;">{escape(author)}</td>'
        f'<td {TD}color:#718096;white-space:nowrap;">{date}</td>'
        f'</tr>'
    )


def scope_block(name, commits, prs):
    ch = '\n'.join(commits) if commits else EMPTY_4
    ph = '\n'.join(prs)     if prs     else EMPTY_4
    return (
        f'<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.8px;">{escape(name)}</p>\n'
        f'<p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#4a5568;">Commits (últimas 48h)</p>\n'
        f'<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-bottom:16px;">\n'
        f'  <thead><tr style="background:#f0fff4;">'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;white-space:nowrap;">Repositorio</th>'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;">Commit</th>'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;white-space:nowrap;">Autor</th>'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;white-space:nowrap;">Fecha</th>'
        f'</tr></thead>\n'
        f'  <tbody>{ch}</tbody>\n'
        f'</table>\n'
        f'<p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#4a5568;">Pull Requests Abiertos</p>\n'
        f'<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-bottom:24px;">\n'
        f'  <thead><tr style="background:#f0fff4;">'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;white-space:nowrap;">Repositorio</th>'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;">Pull Request</th>'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;white-space:nowrap;">Autor</th>'
        f'<th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #9ae6b4;white-space:nowrap;">Actualizado</th>'
        f'</tr></thead>\n'
        f'  <tbody>{ph}</tbody>\n'
        f'</table>'
    )


def parse_github(text):
    scopes = []
    name, mode, commits, prs = None, None, [], []

    def flush():
        if name:
            scopes.append(scope_block(name, commits[:], prs[:]))

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('## '):
            flush()
            name, mode = stripped[3:].strip(), None
            commits, prs = [], []
        elif stripped.startswith('### Commits'):
            mode = 'commits'
        elif stripped.lower().startswith('### open prs') or stripped.lower().startswith('### pull requests'):
            mode = 'prs'
        elif stripped.startswith('- ') and name and mode:
            parts = stripped[2:].split('|')
            if len(parts) < 2:
                continue
            repo, rest = parts[0].strip(), parts[1:]
            try:
                row = commit_row(repo, rest) if mode == 'commits' else pr_row(repo, rest)
                if row:
                    (commits if mode == 'commits' else prs).append(row)
            except Exception:
                pass
    flush()
    return '\n'.join(scopes)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jira',   required=True, help='Path to jira markdown file')
    ap.add_argument('--github', required=True, help='Path to github markdown file')
    args = ap.parse_args()

    with open(args.jira,   encoding='utf-8') as f:
        jira_text = f.read()
    with open(args.github, encoding='utf-8') as f:
        github_text = f.read()

    print('JIRA_FLOW_ROWS:')
    print(parse_jira(jira_text, 'FLOW'))
    print()
    print('JIRA_PLT_ROWS:')
    print(parse_jira(jira_text, 'PLT'))
    print()
    print('GITHUB_SCOPES_HTML:')
    print(parse_github(github_text))


if __name__ == '__main__':
    main()
