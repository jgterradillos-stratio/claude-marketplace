#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  process.stderr.write('Missing GMAIL_USER or GMAIL_APP_PASSWORD\n');
  process.exit(1);
}

const gmailUser = GMAIL_USER as string;
const gmailPass = GMAIL_APP_PASSWORD as string;

interface SearchCriteria {
  seen?: boolean;
  since?: Date;
  from?: string;
  to?: string;
  subject?: string;
  all?: boolean;
}

function createImapClient(): ImapFlow {
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass },
    logger: false
  });
}

function parseQuery(query: string): SearchCriteria {
  const criteria: SearchCriteria = {};

  if (query.includes('is:unread')) criteria.seen = false;
  if (query.includes('is:read')) criteria.seen = true;

  const newerMatch = query.match(/newer_than:(\d+)([dh])/);
  if (newerMatch) {
    const amount = parseInt(newerMatch[1]);
    const ms = newerMatch[2] === 'd'
      ? amount * 24 * 60 * 60 * 1000
      : amount * 60 * 60 * 1000;
    criteria.since = new Date(Date.now() - ms);
  }

  const fromMatch = query.match(/from:(\S+)/);
  if (fromMatch) criteria.from = fromMatch[1];

  const toMatch = query.match(/to:(\S+)/);
  if (toMatch && toMatch[1] !== 'me') criteria.to = toMatch[1];
  if (query.includes('to:me')) criteria.to = gmailUser;

  const subjectMatch = query.match(/subject:"([^"]+)"/);
  if (subjectMatch) criteria.subject = subjectMatch[1];

  return Object.keys(criteria).length > 0 ? criteria : { all: true };
}

const server = new Server(
  { name: 'gmail-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_email',
      description: 'Send an email via Gmail. If body contains HTML (starts with <!DOCTYPE or <html), it is sent as an HTML email automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          to:      { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body:    { type: 'string', description: 'Email body — plain text or full HTML document' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    {
      name: 'search_emails',
      description: 'Search emails in Gmail inbox. Supports: is:unread, is:read, newer_than:Nd, from:addr, to:me, subject:"text"',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g. "is:unread newer_than:1d")' },
          limit: { type: 'number', description: 'Max results (default 20)' }
        },
        required: ['query']
      }
    },
    {
      name: 'read_email',
      description: 'Read the full content of an email by its UID',
      inputSchema: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Email UID from search_emails results' }
        },
        required: ['uid']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'send_email') {
    const { to, subject, body } = args as { to: string; subject: string; body: string };
    const isHtml = body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().startsWith('<html');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });
    const info = await transporter.sendMail({
      from: `"Claude" <${gmailUser}>`,
      to,
      subject,
      ...(isHtml ? { html: body } : { text: body })
    });
    return {
      content: [{ type: 'text', text: `Email sent. Message ID: ${info.messageId}` }]
    };
  }

  if (name === 'search_emails') {
    const { query, limit = 20 } = args as { query: string; limit?: number };
    const client = createImapClient();
    const results: Array<{ uid: string; from: string; subject: string; date: string }> = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const criteria = parseQuery(query);
        for await (const msg of client.fetch(criteria, { envelope: true, uid: true, bodyStructure: true })) {
          const envelope = msg.envelope ?? {};
          results.push({
            uid:     String(msg.uid),
            from:    envelope.from?.[0]?.address ?? '',
            subject: envelope.subject ?? '(sin asunto)',
            date:    envelope.date?.toISOString() ?? ''
          });
          if (results.length >= limit) break;
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
    };
  }

  if (name === 'read_email') {
    const { uid } = args as { uid: string };
    const client = createImapClient();
    let result = '';
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (msg && msg.source) result = msg.source.toString();
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    return {
      content: [{ type: 'text', text: result.slice(0, 8000) }]
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
