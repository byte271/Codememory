import express, { Request, Response, NextFunction } from 'express';
import { BehaviorTimelineAggregator } from '../engines/timeline/aggregator.js';
import { DatabaseManager } from '../store/database.js';
import { getDashboardPort } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Codememory Web Dashboard — Behavioral Time Machine UI (v0.3.0).
 *
 * Serves a web dashboard that visualizes the "life trajectory" of your
 * codebase. Go beyond Git's line-level history to see *behavioral*
 * evolution: error rate trends, fix effectiveness, and the full
 * timeline of AI-generated code.
 *
 * The dashboard is embedded directly in the MCP server — no separate
 * process, no build step, no external dependencies beyond Express.
 *
 * Configuration:
 *   CODEMEMORY_DASHBOARD_PORT — port to listen on (default 4210).
 *   CODEMEMORY_DASHBOARD_ENABLED — set to "true" or "1" to enable (default: off for security).
 *
 * Follows Rule 02: Local only. The dashboard binds to 127.0.0.1.
 */
export class DashboardServer {
  private app: express.Application;
  private port: number;
  private manager: DatabaseManager;
  private timeline: BehaviorTimelineAggregator;
  private server: ReturnType<express.Application['listen']> | null = null;

  /**
   * @param manager DatabaseManager for timeline data.
   * @param port    TCP port to listen on.
   */
  constructor(manager: DatabaseManager, port?: number) {
    this.manager = manager;
    this.timeline = new BehaviorTimelineAggregator(manager);
    this.port = port ?? getDashboardPort();
    this.app = express();

    this.setupRoutes();
  }

  /**
   * Sets up API routes and static file serving for the dashboard.
   */
  private setupRoutes(): void {
    // ── CORS header for local development ──────────────────────────────
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // ── API: Timeline data ────────────────────────────────────────────
    this.app.get('/api/timeline', (req: Request, res: Response) => {
      try {
        const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
        const until = req.query.until ? parseInt(req.query.until as string, 10) : undefined;
        const filePath = req.query.file_path as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

        const data = this.timeline.buildTimeline(since, until, filePath, limit);
        res.json(data);
      } catch (error) {
        logger.error('Dashboard: timeline API error', error);
        res.status(500).json({ error: 'Failed to build timeline' });
      }
    });

    // ── API: Stats summary ────────────────────────────────────────────
    this.app.get('/api/stats', (_req: Request, res: Response) => {
      try {
        const data = this.timeline.buildTimeline(undefined, undefined, undefined, 0);
        res.json(data.stats);
      } catch (error) {
        logger.error('Dashboard: stats API error', error);
        res.status(500).json({ error: 'Failed to compute stats' });
      }
    });

    // ── API: Projects list ────────────────────────────────────────────
    this.app.get('/api/projects', (_req: Request, res: Response) => {
      try {
        const projects = this.manager.prepare(
          'SELECT * FROM projects ORDER BY created_at DESC'
        ).all();
        res.json(projects);
      } catch (error) {
        logger.error('Dashboard: projects API error', error);
        res.status(500).json({ error: 'Failed to list projects' });
      }
    });

    // ── API: Auto-heal tasks ──────────────────────────────────────────
    this.app.get('/api/autoheal', (_req: Request, res: Response) => {
      try {
        const tasks = this.manager.prepare(
          'SELECT * FROM auto_heal_tasks ORDER BY created_at DESC LIMIT 50'
        ).all();
        res.json(tasks);
      } catch (error) {
        logger.error('Dashboard: autoheal API error', error);
        res.status(500).json({ error: 'Failed to list auto-heal tasks' });
      }
    });

    // ── API: Guard rules ──────────────────────────────────────────────
    this.app.get('/api/guard-rules', (_req: Request, res: Response) => {
      try {
        const rules = this.manager.prepare(
          'SELECT * FROM guard_rules ORDER BY hit_count DESC LIMIT 50'
        ).all();
        res.json(rules);
      } catch (error) {
        logger.error('Dashboard: guard rules API error', error);
        res.status(500).json({ error: 'Failed to list guard rules' });
      }
    });

    // ── API: Relay status (v0.3.5) ────────────────────────────────────
    this.app.get('/api/relay-status', (_req: Request, res: Response) => {
      try {
        const peers = this.manager.prepare(
          'SELECT * FROM peer_nodes ORDER BY last_seen_at DESC'
        ).all();
        const briefs = this.manager.prepare(
          'SELECT COUNT(*) as count FROM shared_briefs'
        ).get() as { count: number };
        const received = this.manager.prepare(
          "SELECT COUNT(*) as count FROM shared_briefs WHERE peer_id != 'self'"
        ).get() as { count: number };
        res.json({
          peers,
          peers_online: (peers as Array<{ is_online: number }>).filter(p => p.is_online === 1).length,
          peers_total: (peers as unknown[]).length,
          briefs_shared: briefs.count - received.count,
          briefs_received: received.count,
        });
      } catch (error) {
        logger.error('Dashboard: relay status API error', error);
        res.status(500).json({ error: 'Failed to get relay status' });
      }
    });

    // ── API: Team briefs (v0.3.5) ────────────────────────────────────
    this.app.get('/api/team-briefs', (_req: Request, res: Response) => {
      try {
        const briefs = this.manager.prepare(
          'SELECT * FROM shared_briefs ORDER BY shared_at DESC LIMIT 50'
        ).all();
        res.json(briefs);
      } catch (error) {
        logger.error('Dashboard: team briefs API error', error);
        res.status(500).json({ error: 'Failed to list team briefs' });
      }
    });

    // ── API: Contribution heatmap (v0.3.5) ──────────────────────────
    this.app.get('/api/contribution-heatmap', (_req: Request, res: Response) => {
      try {
        const modules = this.manager.prepare(`
          SELECT sb.error_type AS module,
                 COUNT(*) AS shared_count,
                 COUNT(DISTINCT sb.peer_id) AS contributor_count
          FROM shared_briefs sb
          GROUP BY sb.error_type
          ORDER BY shared_count DESC
          LIMIT 20
        `).all();
        res.json(modules);
      } catch (error) {
        logger.error('Dashboard: contribution heatmap API error', error);
        res.status(500).json({ error: 'Failed to compute contribution heatmap' });
      }
    });

    // ── Static dashboard HTML ─────────────────────────────────────────
    this.app.get('/', (_req: Request, res: Response) => {
      res.type('html').send(this.getDashboardHtml());
    });

    // ── Health check ──────────────────────────────────────────────────
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        version: '0.3.5',
        uptime: process.uptime(),
      });
    });
  }

  /**
   * Starts the dashboard HTTP server.
   */
  public start(): void {
    if (this.server) return;
    this.server = this.app.listen(this.port, '127.0.0.1', () => {
      logger.info(`Codememory dashboard running at http://127.0.0.1:${this.port}`);
    });
  }

  /**
   * Stops the dashboard server gracefully.
   */
  public async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => {
        logger.info('Codememory dashboard stopped');
        resolve();
      });
    });
  }

  /**
   * Returns the inline dashboard HTML — a single-file, zero-dependency UI.
   *
   * Uses vanilla HTML/CSS/JS with a modern dark theme and SVG-based
   * timeline visualization. No build step, no npm packages, no CDN.
   */
  private getDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Codememory — Behavioral Time Machine</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --text-secondary: #8b949e;
    --accent: #58a6ff;
    --success: #3fb950;
    --danger: #f85149;
    --warning: #d2991d;
    --radius: 6px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
  }
  header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 16px 24px; display: flex; align-items: center; gap: 16px;
  }
  header h1 { font-size: 20px; font-weight: 600; }
  header .version {
    font-size: 12px; color: var(--text-secondary);
    background: var(--border); padding: 2px 8px; border-radius: var(--radius);
  }
  main { padding: 24px; max-width: 1400px; margin: 0 auto; }
  .stats-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px; margin-bottom: 24px;
  }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 16px;
  }
  .stat-card .label { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .stat-card .sub { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
  .trend-chart {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 24px; margin-bottom: 24px;
  }
  .trend-chart h2 { font-size: 16px; margin-bottom: 16px; }
  .chart-container {
    position: relative; height: 200px; width: 100%;
  }
  .chart-container svg { width: 100%; height: 100%; }
  .timeline {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 24px;
  }
  .timeline h2 { font-size: 16px; margin-bottom: 16px; }
  .timeline-event {
    display: flex; gap: 12px; padding: 12px 0;
    border-bottom: 1px solid var(--border); align-items: flex-start;
  }
  .timeline-event:last-child { border-bottom: none; }
  .event-icon {
    width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; flex-shrink: 0; margin-top: 2px;
  }
  .event-icon.intent { background: #1f4287; color: var(--accent); }
  .event-icon.runtime { background: #1a3d2f; color: var(--success); }
  .event-icon.failure { background: #3d1a1a; color: var(--danger); }
  .event-icon.resolution { background: #3d2f1a; color: var(--warning); }
  .event-icon.autoheal { background: #2f1a3d; color: #bc8cff; }
  .event-content { flex: 1; }
  .event-summary { font-size: 14px; }
  .event-time { font-size: 12px; color: var(--text-secondary); }
  .event-detail { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
  .empty-state {
    text-align: center; padding: 48px; color: var(--text-secondary);
  }
  .empty-state svg { width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5; }
  .tabs {
    display: flex; gap: 4px; margin-bottom: 16px;
    background: var(--border); border-radius: var(--radius); padding: 2px;
  }
  .tab {
    padding: 8px 16px; border-radius: 4px; cursor: pointer;
    font-size: 13px; color: var(--text-secondary); border: none; background: none;
  }
  .tab.active { background: var(--surface); color: var(--text); }
</style>
</head>
<body>
<header>
  <h1>🧠 Codememory</h1>
  <span class="version">v0.3.5</span>
  <span style="flex:1"></span>
  <span id="connection-status" style="font-size:12px;color:var(--success)">● Connected</span>
</header>

<main>
  <div class="stats-grid" id="stats-grid">
    <div class="stat-card">
      <div class="label">Total Intents</div>
      <div class="value" id="stat-intents">—</div>
      <div class="sub">AI code generations</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Failures</div>
      <div class="value" id="stat-failures" style="color:var(--danger)">—</div>
      <div class="sub">Runtime errors captured</div>
    </div>
    <div class="stat-card">
      <div class="label">Fix Rate</div>
      <div class="value" id="stat-fixrate" style="color:var(--success)">—</div>
      <div class="sub">Resolved / Total failures</div>
    </div>
    <div class="stat-card">
      <div class="label">Error Rate</div>
      <div class="value" id="stat-errorrate" style="color:var(--warning)">—</div>
      <div class="sub">Failures / Intents</div>
    </div>
    <div class="stat-card">
      <div class="label">Auto-Heals</div>
      <div class="value" id="stat-autoheals" style="color:var(--accent)">—</div>
      <div class="sub">Self-repairs triggered</div>
    </div>
    <div class="stat-card" id="stat-relay-card" style="display:none">
      <div class="label">LAN Peers</div>
      <div class="value" id="stat-peers" style="color:var(--warning)">—</div>
      <div class="sub">Connected team brains</div>
    </div>
    <div class="stat-card" id="stat-shared-card" style="display:none">
      <div class="label">Shared Briefs</div>
      <div class="value" id="stat-shared" style="color:var(--accent)">—</div>
      <div class="sub">Team fixes received</div>
    </div>
  </div>

  <div class="trend-chart">
    <h2>📈 Error & Fix Trends</h2>
    <div class="chart-container" id="trend-chart">
      <div class="empty-state"><p>Loading trend data...</p></div>
    </div>
  </div>

  <!-- v0.3.5 Hive Mind Section -->
  <div id="hive-section" style="display:none">
    <div class="trend-chart">
      <h2>🧠 Hive Mind — Team Neural Link</h2>
      <div class="tabs">
        <button class="tab active" data-teamtab="peers">Peers</button>
        <button class="tab" data-teamtab="briefs">Shared Briefs</button>
        <button class="tab" data-teamtab="heatmap">🔥 Contribution Heatmap</button>
      </div>
      <div id="hive-content" style="margin-top:16px">
        <div class="empty-state"><p>Loading team data...</p></div>
      </div>
    </div>
  </div>

  <div class="timeline">
    <h2>⏱️ Behavioral Timeline</h2>
    <div class="tabs">
      <button class="tab active" data-filter="all">All</button>
      <button class="tab" data-filter="intent_created">Intents</button>
      <button class="tab" data-filter="failure_logged">Failures</button>
      <button class="tab" data-filter="resolution_logged">Fixes</button>
      <button class="tab" data-filter="auto_heal_triggered">Auto-Heals</button>
    </div>
    <div id="timeline-events">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm-.5-13v5.2l4.4 2.6.8-1.3-3.7-2.2V7h-1.5z"/></svg>
        <p>Loading timeline...</p>
      </div>
    </div>
  </div>
</main>

<script>
const ICONS = {
  intent_created: '📝',
  runtime_recorded: '⚡',
  failure_logged: '❌',
  resolution_logged: '✅',
  auto_heal_triggered: '🤖',
  guard_warning: '⚠️'
};

async function fetchApi(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    document.getElementById('connection-status').textContent = '● Disconnected';
    document.getElementById('connection-status').style.color = 'var(--danger)';
    return null;
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

function renderTrendChart(trends) {
  const container = document.getElementById('trend-chart');
  if (!trends || trends.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No trend data yet. Start capturing intents!</p></div>';
    return;
  }

  const w = container.clientWidth;
  const h = 200;
  const pad = { top: 10, right: 20, bottom: 30, left: 20 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  const maxVal = Math.max(
    ...trends.map(t => Math.max(t.errors, t.fixes)),
    1
  );

  const xScale = (i) => pad.left + (i / Math.max(trends.length - 1, 1)) * pw;
  const yScale = (v) => pad.top + ph - (v / maxVal) * ph;

  let pointsErrors = trends.map((t, i) => xScale(i) + ',' + yScale(t.errors)).join(' ');
  let pointsFixes = trends.map((t, i) => xScale(i) + ',' + yScale(t.fixes)).join(' ');

  container.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '">' +
    '<polyline points="' + pointsErrors + '" fill="none" stroke="#f85149" stroke-width="2"/>' +
    '<polyline points="' + pointsFixes + '" fill="none" stroke="#3fb950" stroke-width="2"/>' +
    trends.map((t, i) => '<text x="' + xScale(i) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="10" fill="#8b949e">' + t.label.slice(5) + '</text>').join('') +
    '<text x="' + (w - 5) + '" y="12" text-anchor="end" font-size="11" fill="#f85149">Errors</text>' +
    '<text x="' + (w - 5) + '" y="24" text-anchor="end" font-size="11" fill="#3fb950">Fixes</text>' +
    '</svg>';
}

function renderTimeline(events, filter) {
  const container = document.getElementById('timeline-events');
  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No events match this filter.</p></div>';
    return;
  }

  container.innerHTML = filtered.map(e => {
    const detailStr = Object.entries(e.detail || {})
      .filter(([k]) => !['memory_id','snapshot_id','intent_id','failure_id','resolution_id','task_id'].includes(k))
      .map(([k,v]) => k + ': ' + JSON.stringify(v))
      .join(' | ');
    return '<div class="timeline-event">' +
      '<div class="event-icon ' + e.type.split('_')[0] + '">' + (ICONS[e.type] || '●') + '</div>' +
      '<div class="event-content">' +
        '<div class="event-summary">' + e.summary + '</div>' +
        '<div class="event-time">' + formatTime(e.timestamp) + (e.file_path ? ' — ' + e.file_path : '') + '</div>' +
        (detailStr ? '<div class="event-detail">' + detailStr + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function renderHivePeers(peers) {
  const container = document.getElementById('hive-content');
  if (!peers || peers.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No peers discovered yet. Run <code>codememory relay start</code> on team machines.</p></div>';
    return;
  }
  container.innerHTML = peers.map(p => {
    const status = p.is_online ? '<span style="color:var(--success)">● Online</span>' : '<span style="color:var(--text-secondary)">○ Offline</span>';
    const ago = p.last_seen_at ? Math.round((Date.now() - p.last_seen_at) / 1000) + 's ago' : 'unknown';
    return '<div class="timeline-event">' +
      '<div class="event-icon runtime">🧠</div>' +
      '<div class="event-content">' +
        '<div class="event-summary">' + p.hostname + ' — ' + (p.project_name || 'unknown project') + '</div>' +
        '<div class="event-time">' + p.address + ':' + p.port + ' — ' + ago + ' — ' + status + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderHiveBriefs(briefs) {
  const container = document.getElementById('hive-content');
  if (!briefs || briefs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No shared briefs yet. When team members fix bugs, fixes will appear here.</p></div>';
    return;
  }
  container.innerHTML = briefs.map(b => {
    const isSelf = b.peer_id === 'self';
    const label = isSelf ? '📤 Shared by you' : '📥 From team';
    const time = b.shared_at ? formatTime(b.shared_at) : 'unknown';
    return '<div class="timeline-event">' +
      '<div class="event-icon ' + (isSelf ? 'autoheal' : 'resolution') + '">' + (isSelf ? '📤' : '📥') + '</div>' +
      '<div class="event-content">' +
        '<div class="event-summary">' + label + ': ' + b.error_type + '</div>' +
        '<div class="event-time">' + time + (b.project_name ? ' — ' + b.project_name : '') + '</div>' +
        '<div class="event-detail">' + (b.error_pattern || '').slice(0, 120) + '</div>' +
        '<div class="event-detail" style="color:var(--success);margin-top:4px">💡 ' + (b.suggestion || '').slice(0, 120) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderHiveHeatmap(modules) {
  const container = document.getElementById('hive-content');
  if (!modules || modules.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No contribution data yet. Start sharing briefs to build the heatmap!</p></div>';
    return;
  }
  const maxCount = Math.max(...modules.map(m => m.shared_count), 1);
  container.innerHTML = modules.map(m => {
    const pct = Math.round((m.shared_count / maxCount) * 100);
    const intensity = Math.round(20 + (pct * 0.6));
    return '<div class="timeline-event" style="align-items:center">' +
      '<div class="event-icon runtime" style="background:hsl(' + (120 - pct) + ',60%,' + intensity + '%);color:var(--text)">🔥</div>' +
      '<div class="event-content">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div class="event-summary">' + m.module + '</div>' +
          '<span style="font-size:14px;font-weight:600;color:var(--accent)">' + m.shared_count + ' briefs</span>' +
        '</div>' +
        '<div class="event-time">' + m.contributor_count + ' contributor(s)</div>' +
        '<div style="background:var(--border);height:4px;border-radius:2px;margin-top:8px;overflow:hidden">' +
          '<div style="background:var(--success);height:4px;width:' + pct + '%"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function loadHive() {
  const relayData = await fetchApi('/api/relay-status');
  if (!relayData) return;

  if (relayData.peers_total > 0) {
    document.getElementById('stat-relay-card').style.display = '';
    document.getElementById('stat-peers').textContent = relayData.peers_online + ' / ' + relayData.peers_total;
    document.getElementById('stat-shared-card').style.display = '';
    document.getElementById('stat-shared').textContent = relayData.briefs_received;
    document.getElementById('hive-section').style.display = '';

    // Default: show peers
    renderHivePeers(relayData.peers);

    // Team tab switching
    let currentTab = 'peers';
    document.querySelectorAll('[data-teamtab]').forEach(tab => {
      tab.addEventListener('click', async () => {
        document.querySelectorAll('[data-teamtab]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.teamtab;
        if (currentTab === 'peers') {
          // Re-fetch to get fresh peer data
          const freshData = await fetchApi('/api/relay-status');
          if (freshData) renderHivePeers(freshData.peers);
        }
        if (currentTab === 'briefs') {
          const briefs = await fetchApi('/api/team-briefs');
          if (briefs) renderHiveBriefs(briefs);
        }
        if (currentTab === 'heatmap') {
          const heatmap = await fetchApi('/api/contribution-heatmap');
          if (heatmap) renderHiveHeatmap(heatmap);
        }
      });
    });
  }
}

async function loadDashboard() {
  const [timelineData] = [await fetchApi('/api/timeline')];
  if (!timelineData) return;

  document.getElementById('stat-intents').textContent = timelineData.stats.totalIntents;
  document.getElementById('stat-failures').textContent = timelineData.stats.totalFailures;
  document.getElementById('stat-fixrate').textContent = timelineData.stats.fixRate + '%';
  document.getElementById('stat-errorrate').textContent = timelineData.stats.errorRate + '%';
  document.getElementById('stat-autoheals').textContent = timelineData.stats.totalAutoHeals;

  renderTrendChart(timelineData.stats.recentTrends);
  renderTimeline(timelineData.events, 'all');

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderTimeline(timelineData.events, tab.dataset.filter);
    });
  });

  // Load hive data
  loadHive();
}

loadDashboard();
// Refresh every 30 seconds
setInterval(loadDashboard, 30000);
</script>
</body>
</html>`;
  }
}
