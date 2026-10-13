const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static HTML/JS/CSS files from current directory
app.use(express.static(__dirname));

// Database connection
const dbPath = path.resolve(__dirname, 'pulseflow.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database Connection Error 🛑', err.message);
  } else {
    console.log('Connected to SQLite database at: ' + dbPath + ' 🟢');
    initDatabaseTables();
  }
});

// Helper for promise-based db queries
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

function initDatabaseTables() {
  db.serialize(() => {
    // 1. Deals Table
    db.run(`CREATE TABLE IF NOT EXISTS deals (
      deal_id TEXT UNIQUE,
      client TEXT,
      deal_name TEXT,
      value TEXT,
      scope TEXT,
      committed_date TEXT,
      notes TEXT,
      account_owner TEXT,
      project_manager TEXT,
      priority TEXT,
      status TEXT
    )`);

    // 2. Projects Table
    db.run(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT UNIQUE,
      deal_id TEXT,
      client TEXT,
      project_name TEXT,
      assigned_to TEXT,
      progress INTEGER DEFAULT 25,
      payment_status TEXT DEFAULT 'PENDING',
      delivery_status TEXT DEFAULT 'IN_PROGRESS',
      qr_code_link TEXT,
      notes TEXT DEFAULT ''
    )`);

    // 3. Milestones Table
    db.run(`CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      title TEXT,
      amount TEXT,
      status TEXT DEFAULT 'PENDING'
    )`);

    // Safe Schema Migration for existing projects table
    db.all(`PRAGMA table_info(projects)`, [], (err, columns) => {
      if (err) {
        console.error('Could not check projects schema:', err.message);
        return;
      }
      const colNames = columns.map(c => c.name);
      
      if (!colNames.includes('delivery_status')) {
        db.run(`ALTER TABLE projects ADD COLUMN delivery_status TEXT DEFAULT 'IN_PROGRESS'`, (alterErr) => {
          if (!alterErr) console.log('Added missing column: projects.delivery_status 🟢');
        });
      }

      if (!colNames.includes('notes')) {
        db.run(`ALTER TABLE projects ADD COLUMN notes TEXT DEFAULT ''`, (alterErr) => {
          if (!alterErr) console.log('Added missing column: projects.notes 🟢');
        });
      }
    });

    // Safe Schema Migration for deals table (ensure priority and notes exist)
    db.all(`PRAGMA table_info(deals)`, [], (err, columns) => {
      if (err) return;
      const colNames = columns.map(c => c.name);
      if (!colNames.includes('notes')) {
        db.run(`ALTER TABLE deals ADD COLUMN notes TEXT DEFAULT ''`);
      }
      if (!colNames.includes('priority')) {
        db.run(`ALTER TABLE deals ADD COLUMN priority TEXT DEFAULT 'Medium'`);
      }
    });

    console.log('Database tables verified and ready. 🟢');
  });
}

// Default team data with skill profiles
const TEAM_MEMBERS = [
  { id: 1, name: 'Alex Morgan', role: 'Backend Developer', email: 'alex.morgan@pulseflow.ai', skills: 'node, express, sqlite, postgres, api, backend, database, security, rest, auth', availability: 'High', base_workload: 35 },
  { id: 2, name: 'Maya Lin', role: 'Full Stack Developer', email: 'maya.lin@pulseflow.ai', skills: 'react, node, javascript, fullstack, tailwind, payment, stripe, api, dashboard, web, mobile, e-commerce', availability: 'High', base_workload: 45 },
  { id: 3, name: 'Liam Chen', role: 'Frontend Engineer', email: 'liam.chen@pulseflow.ai', skills: 'react, javascript, tailwind, css, html, ui, ux, dashboard, charts, frontend, responsive, design', availability: 'Medium', base_workload: 50 },
  { id: 4, name: 'Priya Sharma', role: 'QA Engineer', email: 'priya.sharma@pulseflow.ai', skills: 'qa, testing, test, verification, cypress, jest, security, audit, payment integration, quality', availability: 'High', base_workload: 20 },
  { id: 5, name: 'Marcus Brody', role: 'DevOps Engineer', email: 'marcus.brody@pulseflow.ai', skills: 'docker, deployment, devops, cloud, ci/cd, linux, monitoring, kubernetes, nginx, infra', availability: 'High', base_workload: 30 }
];

// AI Skill Matcher function
function matchSkillAndDev(scope = '', dealName = '') {
  const text = `${scope} ${dealName}`.toLowerCase();
  
  if (text.includes('qa') || text.includes('test') || text.includes('security') || text.includes('audit')) {
    return 'Priya Sharma (QA Engineer)';
  }
  if (text.includes('devops') || text.includes('docker') || text.includes('cloud') || text.includes('ci/cd') || text.includes('deploy')) {
    return 'Marcus Brody (DevOps Engineer)';
  }
  if (text.includes('ui') || text.includes('frontend') || text.includes('react') || text.includes('design') || text.includes('css') || text.includes('responsive')) {
    return 'Liam Chen (Frontend Specialist)';
  }
  if (text.includes('backend') || text.includes('api') || text.includes('database') || text.includes('sql') || text.includes('node') || text.includes('server')) {
    return 'Alex Morgan (Backend Engineer)';
  }
  return 'Maya Lin (Full Stack Developer)';
}

// Root route - serve technova.html / dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'technova.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    database: 'connected',
    timestamp: new Date().toISOString()
  });
});

// ==================== DEALS ROUTES ====================

// 1. Get All Deals (using rowid as id to guarantee compatibility and prevent SQLITE_ERROR: no such column: id)
app.get('/api/deals', (req, res) => {
  db.all(`SELECT rowid as id, * FROM deals ORDER BY rowid DESC`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching deals:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// 2. Save New Deal
app.post('/api/deals', (req, res) => {
  const {
    deal_id,
    client,
    deal_name,
    value,
    scope,
    committed_date,
    notes,
    account_owner,
    project_manager,
    priority,
    status
  } = req.body;

  if (!client || !deal_name) {
    return res.status(400).json({ error: 'Client and Deal Name are required.' });
  }

  const generatedDealId = deal_id || `DEAL-${Math.floor(1000 + Math.random() * 9000)}`;
  const dealValue = value || '₹5,00,000';
  const dealDate = committed_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const dealPriority = priority || 'High';
  const dealStatus = (status || 'PROPOSAL').toUpperCase();

  const query = `INSERT INTO deals (deal_id, client, deal_name, value, scope, committed_date, notes, account_owner, project_manager, priority, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    generatedDealId,
    client.trim(),
    deal_name.trim(),
    dealValue,
    scope || '',
    dealDate,
    notes || '',
    account_owner || 'Sheetal',
    project_manager || 'Admin',
    dealPriority,
    dealStatus
  ];

  db.run(query, params, function (err) {
    if (err) {
      console.error('Error creating deal:', err.message);
      return res.status(400).json({ error: err.message });
    }
    res.status(201).json({
      message: 'Deal saved successfully!',
      id: this.lastID,
      deal: {
        id: this.lastID,
        deal_id: generatedDealId,
        client: client.trim(),
        deal_name: deal_name.trim(),
        value: dealValue,
        scope: scope || '',
        committed_date: dealDate,
        notes: notes || '',
        account_owner: account_owner || 'Sheetal',
        project_manager: project_manager || 'Admin',
        priority: dealPriority,
        status: dealStatus
      }
    });
  });
});

// 3. Update Deal (by deal_id or rowid)
app.put('/api/deals/:id', (req, res) => {
  const identifier = req.params.id;
  const { client, deal_name, value, scope, committed_date, notes, account_owner, project_manager, priority, status } = req.body;

  const isNumeric = /^\d+$/.test(identifier);
  const whereClause = isNumeric ? 'rowid = ?' : 'deal_id = ?';

  const updates = [];
  const params = [];

  if (client !== undefined) { updates.push('client = ?'); params.push(client); }
  if (deal_name !== undefined) { updates.push('deal_name = ?'); params.push(deal_name); }
  if (value !== undefined) { updates.push('value = ?'); params.push(value); }
  if (scope !== undefined) { updates.push('scope = ?'); params.push(scope); }
  if (committed_date !== undefined) { updates.push('committed_date = ?'); params.push(committed_date); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (account_owner !== undefined) { updates.push('account_owner = ?'); params.push(account_owner); }
  if (project_manager !== undefined) { updates.push('project_manager = ?'); params.push(project_manager); }
  if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status.toUpperCase()); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields provided to update.' });
  }

  params.push(identifier);
  const sql = `UPDATE deals SET ${updates.join(', ')} WHERE ${whereClause}`;

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Deal not found.' });
    res.json({ message: 'Deal updated successfully!', changes: this.changes });
  });
});

// 4. Delete Deal
app.delete('/api/deals/:id', (req, res) => {
  const identifier = req.params.id;
  const isNumeric = /^\d+$/.test(identifier);
  const sql = isNumeric ? `DELETE FROM deals WHERE rowid = ?` : `DELETE FROM deals WHERE deal_id = ?`;

  db.run(sql, [identifier], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Deal not found.' });
    res.json({ message: 'Deal deleted successfully!' });
  });
});

// ==================== CONVERT DEAL TO PROJECT ====================

// 5. Convert Deal to Project (AI Skill Assignment & Milestone Auto-Generation)
app.post('/api/convert-deal', async (req, res) => {
  try {
    const { deal_id, client, deal_name, scope, assigned_to } = req.body;

    if (!deal_id && !deal_name) {
      return res.status(400).json({ error: 'Deal ID or Deal Name is required.' });
    }

    // Determine assigned developer via AI skill matching if not provided
    const assignedDev = assigned_to || matchSkillAndDev(scope, deal_name);
    const projectId = `PRJ-${Math.floor(1000 + Math.random() * 9000)}`;

    // 1. Update Deal status to 'WON'
    if (deal_id) {
      await dbRun(`UPDATE deals SET status = 'WON' WHERE deal_id = ?`, [deal_id]);
    }

    // 2. Insert into projects table
    const projQuery = `INSERT INTO projects (project_id, deal_id, client, project_name, assigned_to, progress, payment_status, delivery_status, notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const projParams = [
      projectId,
      deal_id || 'DIRECT',
      client || 'Client',
      deal_name || 'New Project',
      assignedDev,
      25,
      'MILESTONE_1_PAID',
      'IN_PROGRESS',
      `Auto-converted from deal ${deal_id || ''}. Skill matched: ${assignedDev}`
    ];

    const projResult = await dbRun(projQuery, projParams);

    // 3. Auto-generate standard delivery milestones for the new project
    const defaultMilestones = [
      { title: 'Milestone 1: Architecture Blueprint & Technical Specs', amount: '25%', status: 'COMPLETED' },
      { title: 'Milestone 2: Core Feature Implementation & API Integrations', amount: '50%', status: 'PENDING' },
      { title: 'Milestone 3: QA Verification, Security Audit & Cloud Release', amount: '25%', status: 'PENDING' }
    ];

    for (const m of defaultMilestones) {
      await dbRun(
        `INSERT INTO milestones (project_id, title, amount, status) VALUES (?, ?, ?, ?)`,
        [projectId, m.title, m.amount, m.status]
      );
    }

    res.status(201).json({
      message: 'Deal converted to project successfully with AI Skill matching!',
      project_id: projectId,
      deal_id: deal_id,
      assigned_to: assignedDev,
      progress: 25,
      delivery_status: 'IN_PROGRESS',
      milestones_created: defaultMilestones.length
    });
  } catch (err) {
    console.error('Error in convert-deal:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROJECTS ROUTES ====================

// 6. Get All Projects (with nested milestones)
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await dbAll(`SELECT * FROM projects ORDER BY id DESC`);
    const allMilestones = await dbAll(`SELECT * FROM milestones`);

    // Attach milestones to corresponding project
    const projectsWithMilestones = projects.map(p => {
      const pMilestones = allMilestones.filter(m => m.project_id === p.project_id);
      return {
        ...p,
        delivery_status: p.delivery_status || 'IN_PROGRESS',
        payment_status: p.payment_status || 'PENDING',
        milestones: pMilestones
      };
    });

    res.json(projectsWithMilestones);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Update Project
app.put('/api/projects/:id', (req, res) => {
  const identifier = req.params.id;
  const { progress, delivery_status, payment_status, assigned_to, project_name, notes } = req.body;

  const isNumeric = /^\d+$/.test(identifier);
  const whereClause = isNumeric ? 'id = ?' : 'project_id = ?';

  const updates = [];
  const params = [];

  if (progress !== undefined) {
    const validProgress = Math.min(100, Math.max(0, parseInt(progress, 10) || 0));
    updates.push('progress = ?');
    params.push(validProgress);
  }
  if (delivery_status !== undefined) { updates.push('delivery_status = ?'); params.push(delivery_status); }
  if (payment_status !== undefined) { updates.push('payment_status = ?'); params.push(payment_status); }
  if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to); }
  if (project_name !== undefined) { updates.push('project_name = ?'); params.push(project_name); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields provided to update.' });
  }

  params.push(identifier);
  const sql = `UPDATE projects SET ${updates.join(', ')} WHERE ${whereClause}`;

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Project not found.' });
    res.json({ message: 'Project updated successfully!', changes: this.changes });
  });
});

// 8. Delete Project
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const identifier = req.params.id;
    const isNumeric = /^\d+$/.test(identifier);
    
    // Find project_id first if numeric
    let projId = identifier;
    if (isNumeric) {
      const proj = await dbGet(`SELECT project_id FROM projects WHERE id = ?`, [identifier]);
      if (proj) projId = proj.project_id;
    }

    const whereClause = isNumeric ? `id = ?` : `project_id = ?`;
    await dbRun(`DELETE FROM projects WHERE ${whereClause}`, [identifier]);
    if (projId) {
      await dbRun(`DELETE FROM milestones WHERE project_id = ?`, [projId]);
    }

    res.json({ message: 'Project and associated milestones deleted successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MILESTONES ROUTES ====================

// 9. Get Milestones for a Project
app.get('/api/projects/:projectId/milestones', (req, res) => {
  const { projectId } = req.params;
  db.all(`SELECT * FROM milestones WHERE project_id = ? ORDER BY id ASC`, [projectId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 10. Toggle / Update Milestone Status
app.patch('/api/milestones/:id', (req, res) => {
  const { id } = req.params;
  const { status, title, amount } = req.body;

  const updates = [];
  const params = [];
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (amount !== undefined) { updates.push('amount = ?'); params.push(amount); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  params.push(id);
  db.run(`UPDATE milestones SET ${updates.join(', ')} WHERE id = ?`, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Milestone updated successfully!', changes: this.changes });
  });
});

// ==================== TEAM & STATS ROUTES ====================

// 11. Get Team Members with dynamically calculated workloads
app.get('/api/team', async (req, res) => {
  try {
    const projects = await dbAll(`SELECT assigned_to, progress, delivery_status FROM projects`);

    const team = TEAM_MEMBERS.map(member => {
      // Find projects where assigned_to contains member's name
      const memberProjects = projects.filter(p =>
        p.assigned_to && p.assigned_to.toLowerCase().includes(member.name.toLowerCase())
      );
      const activeProjects = memberProjects.filter(p => p.delivery_status !== 'COMPLETED');
      
      // Dynamic workload calculation: base + (activeProjects * 20%) capped at 100%
      const calculatedWorkload = Math.min(100, member.base_workload + (activeProjects.length * 18));
      
      let availability = 'High';
      if (calculatedWorkload >= 80) availability = 'Low';
      else if (calculatedWorkload >= 55) availability = 'Medium';

      return {
        ...member,
        active_tasks_count: activeProjects.length,
        workload_pct: calculatedWorkload,
        availability,
        assigned_projects_count: memberProjects.length
      };
    });

    res.json(team);
  } catch (err) {
    res.json(TEAM_MEMBERS);
  }
});

// 12. Dashboard Summary Stats
app.get('/api/stats', async (req, res) => {
  try {
    const deals = await dbAll(`SELECT value, status FROM deals`);
    const projects = await dbAll(`SELECT progress, delivery_status FROM projects`);

    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => (d.status || '').toUpperCase() === 'WON').length;
    
    // Parse value strings like "₹5,00,000" or "500000"
    const parseVal = (str) => {
      if (!str) return 0;
      const num = String(str).replace(/[^0-9]/g, '');
      return parseInt(num, 10) || 0;
    };

    const totalPipelineValue = deals.reduce((acc, d) => acc + parseVal(d.value), 0);
    const wonPipelineValue = deals
      .filter(d => (d.status || '').toUpperCase() === 'WON')
      .reduce((acc, d) => acc + parseVal(d.value), 0);

    const activeProjects = projects.filter(p => p.delivery_status !== 'COMPLETED').length;
    const completedProjects = projects.filter(p => p.delivery_status === 'COMPLETED').length;

    res.json({
      total_deals: totalDeals,
      won_deals: wonDeals,
      win_rate: totalDeals > 0 ? Math.round((wonDeals / totalDeals) * 100) : 0,
      pipeline_value: totalPipelineValue,
      won_value: wonPipelineValue,
      active_projects: activeProjects,
      completed_projects: completedProjects,
      total_projects: projects.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`PulseFlow Server running at http://localhost:${PORT} 🚀`);
  console.log(`UI available at http://localhost:${PORT}/technova.html`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
  });
});