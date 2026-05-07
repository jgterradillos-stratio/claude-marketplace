---
name: daily-briefing
description: Generate and send a daily email briefing with new Jira tasks (FLOW & PLT) and GitHub activity (commits + open PRs).
---

Generate and send the daily briefing by following these steps:

**Step 1 — Read repo config**

Read `assets/github-repositories.json` from the Base directory shown above.

**Step 2 — Collect data (run both agents in parallel)**

Launch both agents simultaneously using the Agent tool:

**Agent A** — subagent_type `"basic-skills:jira-briefing"`:
```
Projects: FLOW, PLT
Days: 2
```

**Agent B** — subagent_type `"basic-skills:github-briefing"`:
```
Days: 2

Repository config:
<paste the full github-repositories.json content here>
```

**Step 3 — Build HTML fragments via script**

Write the agent outputs to temp files and run the build script:

1. Write the full jira-briefing output to `/tmp/briefing_jira.txt`
2. Write the full github-briefing output to `/tmp/briefing_github.txt`
3. Run via Bash:
   ```bash
   python3 <BASE_DIR>/assets/build_fragments.py --jira /tmp/briefing_jira.txt --github /tmp/briefing_github.txt
   ```
   Replace `<BASE_DIR>` with the Base directory shown at the top of this skill.

4. Parse the script output to extract the three fragments:
   - `JIRA_FLOW_ROWS:` — everything after this marker until the next blank line + marker
   - `JIRA_PLT_ROWS:` — same
   - `GITHUB_SCOPES_HTML:` — everything after this marker to end of output

**Step 4 — Assemble and send the email**

Replace `__DATE__`, `__JIRA_FLOW_ROWS__`, `__JIRA_PLT_ROWS__`, `__GITHUB_SCOPES_HTML__` in the template below with today's date and the three fragments, then call `mcp__plugin_gmail-api-mcp_gmail-api-mcp__send_email`:
- **to:** jgterradillos@stratio.com
- **subject:** `Daily Briefing — <today's date, e.g. Wednesday, 07 May 2026>`
- **body:** the assembled HTML

### Email template

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><title>Daily Briefing</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#1a1a2e;padding:28px 32px;">
  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Daily Briefing</h1>
  <p style="margin:6px 0 0;color:#a0aec0;font-size:14px;">__DATE__</p>
</td></tr>
<tr><td style="padding:28px 32px 0;background:#fafbfc;">
  <table width="100%"><tr><td style="border-left:4px solid #f6ad55;padding-left:12px;">
    <h2 style="margin:0;font-size:16px;font-weight:700;color:#1a1a2e;">🎯 Actividad Jira (últimas 48h)</h2>
  </td></tr></table>
</td></tr>
<tr><td style="padding:16px 32px 0;background:#fafbfc;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.8px;">FLOW</p>
</td></tr>
<tr><td style="padding:8px 32px 0;background:#fafbfc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:#fff7ed;">
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Key</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;">Resumen</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Tipo</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Estado</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;">Asignado a</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Creada</th>
    </tr></thead>
    <tbody>__JIRA_FLOW_ROWS__</tbody>
  </table>
</td></tr>
<tr><td style="padding:20px 32px 0;background:#fafbfc;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.8px;">PLT</p>
</td></tr>
<tr><td style="padding:8px 32px 28px;background:#fafbfc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:#fff7ed;">
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Key</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;">Resumen</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Tipo</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Estado</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;">Asignado a</th>
      <th style="text-align:left;padding:8px 10px;color:#4a5568;font-weight:600;border-bottom:2px solid #f6d5a5;white-space:nowrap;">Creada</th>
    </tr></thead>
    <tbody>__JIRA_PLT_ROWS__</tbody>
  </table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <table width="100%"><tr><td style="border-left:4px solid #68d391;padding-left:12px;">
    <h2 style="margin:0;font-size:16px;font-weight:700;color:#1a1a2e;">🔀 Actividad GitHub</h2>
  </td></tr></table>
</td></tr>
<tr><td style="padding:12px 32px 28px;">__GITHUB_SCOPES_HTML__</td></tr>
<tr><td style="background:#f4f6f8;padding:16px 32px;border-top:1px solid #e8ecf0;">
  <p style="margin:0;font-size:11px;color:#a0aec0;text-align:center;">Generated by Claude Code · Daily Briefing Agent</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
```

**Step 5 — Report back**

Inform the user that the briefing has been sent (or report any error).
