// server.js - FilmFlow Production Backend
// Optimized for Render + Supabase + Netlify

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { Resend } = require('resend');
const jsPDF = require('jspdf');
require('jspdf-autotable');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================

// CORS configuration - critical for Netlify
app.use(cors({
    origin: function(origin, callback) {
        // Allow all Netlify apps, localhost, and your frontend
        const allowedOrigins = [
            'https://filmfloww.netlify.app',
            'http://localhost:3000',
            'http://localhost:5000',
            'http://127.0.0.1:3000'
        ];
        
        // Allow requests with no origin (like mobile apps, curl)
        if (!origin) return callback(null, true);
        
        // Allow any netlify.app subdomain
        if (origin.includes('netlify.app')) {
            return callback(null, true);
        }
        
        // Check exact matches
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        
        callback(null, process.env.FRONTEND_URL || true);
    },
    credentials: true
}));

app.use(express.json());

// ============================================
// DATABASE CONNECTION
// ============================================

// Database connection with proper SSL handling for Supabase
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // Accept self-signed certs from Supabase
        require: true
    },
    // Add timeout to prevent hanging
    connectionTimeoutMillis: 10000,
});

// Test database connection on startup
async function connectDatabase() {
    try {
        const client = await pool.connect();
        console.log('✅ Database connected successfully');
        
        // Test query
        const result = await client.query('SELECT NOW() as time');
        console.log(`✅ Database time: ${result.rows[0].time}`);
        
        client.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('🔧 Check your DATABASE_URL environment variable');
        return false;
    }
}

// Call it
connectDatabase();

// ============================================
// EMAIL SETUP
// ============================================

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper function to send emails
async function sendEmail({ to, subject, html, attachments = [] }) {
    try {
        const data = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html,
            attachments: attachments
        });
        console.log('✅ Email sent to:', to);
        return data;
    } catch (error) {
        console.error('❌ Email error:', error);
        throw error;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Generate unique project code
function generateProjectCode(name) {
    const prefix = name.substring(0, 3).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${random}`;
}

// ============================================
// HEALTH ENDPOINTS
// ============================================

app.get('/', (req, res) => {
    res.json({ 
        message: '🎬 FilmFlow API is running',
        version: '2.0.0',
        status: 'online',
        endpoints: {
            health: '/health',
            dbStatus: '/api/health/db',
            projects: '/api/projects',
            projectByCode: '/api/projects/code/:code',
            crewSignup: '/api/projects/:projectCode/crew'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/api/health/db', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as time');
        client.release();
        res.json({ 
            status: 'connected',
            database: '✅ OK',
            time: result.rows[0].time
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'disconnected',
            error: error.message 
        });
    }
});

// ============================================
// PROJECT ENDPOINTS
// ============================================

// Create new project
app.post('/api/projects', async (req, res) => {
    try {
        const { name, start_date, end_date } = req.body;
        
        if (!name || !start_date || !end_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const code = generateProjectCode(name);
        
        const result = await pool.query(
            `INSERT INTO projects (name, project_code, start_date, end_date, status) 
             VALUES ($1, $2, $3, $4, 'active') 
             RETURNING *`,
            [name, code, start_date, end_date]
        );
        
        const inviteLink = `${process.env.FRONTEND_URL || 'https://filmfloww.netlify.app'}?project=${code}`;
        
        res.status(201).json({ 
            project: result.rows[0],
            inviteLink: inviteLink
        });
    } catch (error) {
        console.error('Project creation error:', error);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// Get all projects
app.get('/api/projects', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, 
             COUNT(DISTINCT pc.id) as crew_count
             FROM projects p
             LEFT JOIN project_crew pc ON p.id = pc.project_id
             GROUP BY p.id
             ORDER BY p.created_at DESC`
        );
        res.json({ projects: result.rows });
    } catch (error) {
        console.error('Get projects error:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// Get project by code
app.get('/api/projects/code/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const result = await pool.query(
            'SELECT id, name, project_code, start_date, end_date, status FROM projects WHERE project_code = $1',
            [code]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json({ project: result.rows[0] });
    } catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// Update project dates
app.put('/api/projects/:id/dates', async (req, res) => {
    try {
        const { id } = req.params;
        const { start_date, end_date } = req.body;
        
        const result = await pool.query(
            `UPDATE projects 
             SET start_date = $1, end_date = $2, updated_at = NOW() 
             WHERE id = $3 
             RETURNING *`,
            [start_date, end_date, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json({ project: result.rows[0] });
    } catch (error) {
        console.error('Update project error:', error);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// ============================================
// CREW ENDPOINTS
// ============================================

// Crew signup
app.post('/api/projects/:projectCode/crew', async (req, res) => {
    try {
        const { projectCode } = req.params;
        
        // Get project
        const projectResult = await pool.query(
            'SELECT id, name FROM projects WHERE project_code = $1',
            [projectCode]
        );
        
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const projectId = projectResult.rows[0].id;
        const projectName = projectResult.rows[0].name;
        
        const {
            name,
            phone,
            email,
            department,
            emergency_contact_name,
            emergency_contact_phone,
            dietary_restrictions,
            address,
            has_insurance
        } = req.body;
        
        // Validate required fields
        if (!name || !phone || !email || !department) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Check if already signed up
        const existingResult = await pool.query(
            'SELECT id FROM project_crew WHERE project_id = $1 AND email = $2',
            [projectId, email]
        );
        
        if (existingResult.rows.length > 0) {
            return res.status(409).json({ error: 'You have already signed up for this project' });
        }
        
        // Insert crew member
        const result = await pool.query(
            `INSERT INTO project_crew 
            (project_id, name, phone, email, department, emergency_contact_name, 
             emergency_contact_phone, dietary_restrictions, address, has_insurance) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING *`,
            [projectId, name, phone, email, department, emergency_contact_name, 
             emergency_contact_phone, dietary_restrictions || [], address, has_insurance || false]
        );
        
        // Send confirmation email (don't fail if email fails)
        try {
            await sendEmail({
                to: email,
                subject: `Welcome to ${projectName}!`,
                html: `
                    <div style="font-family: Arial, sans-serif;">
                        <h1 style="color: #FF2D55;">🎬 You're on the crew!</h1>
                        <p>Hi ${name},</p>
                        <p>You've successfully signed up for <strong>${projectName}</strong>.</p>
                        <p>You'll receive call sheets via email when dates are scheduled.</p>
                    </div>
                `
            });
        } catch (emailError) {
            console.log('Confirmation email failed, but signup successful');
        }
        
        res.status(201).json({ 
            crew: result.rows[0],
            message: 'Successfully signed up!'
        });
    } catch (error) {
        console.error('Crew signup error:', error);
        res.status(500).json({ error: 'Failed to sign up' });
    }
});

// Get all crew for a project
app.get('/api/projects/:id/crew', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            `SELECT * FROM project_crew 
             WHERE project_id = $1 
             ORDER BY department, name`,
            [id]
        );
        
        res.json({ crew: result.rows });
    } catch (error) {
        console.error('Get crew error:', error);
        res.status(500).json({ error: 'Failed to fetch crew' });
    }
});

// Get crew by department
app.get('/api/projects/:id/crew/by-department', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            `SELECT department, json_agg(
                json_build_object(
                    'id', id,
                    'name', name,
                    'phone', phone,
                    'email', email,
                    'dietary_restrictions', dietary_restrictions,
                    'has_insurance', has_insurance
                ) ORDER BY name
            ) as members
             FROM project_crew 
             WHERE project_id = $1 
             GROUP BY department
             ORDER BY department`,
            [id]
        );
        
        res.json({ departments: result.rows });
    } catch (error) {
        console.error('Get crew by department error:', error);
        res.status(500).json({ error: 'Failed to fetch crew' });
    }
});

// ============================================
// SCHEDULE ENDPOINTS
// ============================================

// Assign department to date
app.post('/api/projects/:id/schedule/assign-department', async (req, res) => {
    try {
        const { id } = req.params;
        const { department, shoot_date } = req.body;
        
        if (!department || !shoot_date) {
            return res.status(400).json({ error: 'Missing department or shoot_date' });
        }
        
        // Get all crew from this department
        const crewResult = await pool.query(
            'SELECT id FROM project_crew WHERE project_id = $1 AND department = $2',
            [id, department]
        );
        
        const crewIds = crewResult.rows.map(r => r.id);
        
        if (crewIds.length === 0) {
            return res.status(404).json({ error: 'No crew found in this department' });
        }
        
        // Insert schedules
        for (const crewId of crewIds) {
            await pool.query(
                `INSERT INTO schedules (project_id, crew_id, shoot_date) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (project_id, crew_id, shoot_date) DO NOTHING`,
                [id, crewId, shoot_date]
            );
        }
        
        res.json({ 
            message: `Assigned ${crewIds.length} crew members to ${shoot_date}`,
            count: crewIds.length
        });
    } catch (error) {
        console.error('Assign department error:', error);
        res.status(500).json({ error: 'Failed to assign department' });
    }
});

// Get schedule
app.get('/api/projects/:id/schedule', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            `SELECT s.shoot_date, 
                    json_agg(
                        json_build_object(
                            'id', pc.id,
                            'name', pc.name,
                            'department', pc.department,
                            'email', pc.email
                        ) ORDER BY pc.department, pc.name
                    ) as crew
             FROM schedules s
             JOIN project_crew pc ON s.crew_id = pc.id
             WHERE s.project_id = $1
             GROUP BY s.shoot_date
             ORDER BY s.shoot_date`,
            [id]
        );
        
        // Transform to object format for frontend
        const scheduleObj = {};
        result.rows.forEach(row => {
            scheduleObj[row.shoot_date] = row.crew.map(c => c.id);
        });
        
        res.json({ schedule: scheduleObj });
    } catch (error) {
        console.error('Get schedule error:', error);
        res.status(500).json({ error: 'Failed to fetch schedule' });
    }
});

// Remove from schedule
app.delete('/api/projects/:projectId/schedule/:crewId/:date', async (req, res) => {
    try {
        const { projectId, crewId, date } = req.params;
        
        await pool.query(
            'DELETE FROM schedules WHERE project_id = $1 AND crew_id = $2 AND shoot_date = $3',
            [projectId, crewId, date]
        );
        
        res.json({ message: 'Crew member removed from date' });
    } catch (error) {
        console.error('Remove crew error:', error);
        res.status(500).json({ error: 'Failed to remove crew' });
    }
});

// ============================================
// STATS ENDPOINT
// ============================================

app.get('/api/projects/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT 
                COUNT(DISTINCT pc.id) as total_crew,
                COUNT(DISTINCT pc.id) FILTER (
                    WHERE pc.emergency_contact_name IS NOT NULL 
                    AND pc.emergency_contact_phone IS NOT NULL
                ) as complete_emergency,
                COUNT(DISTINCT pc.id) FILTER (
                    WHERE array_length(pc.dietary_restrictions, 1) > 0
                ) as has_dietary,
                COUNT(DISTINCT pc.department) as department_count,
                COUNT(DISTINCT s.shoot_date) as scheduled_days
            FROM project_crew pc
            LEFT JOIN schedules s ON pc.id = s.crew_id AND pc.project_id = s.project_id
            WHERE pc.project_id = $1
        `, [id]);
        
        res.json({ stats: result.rows[0] });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// ============================================
// CALL SHEET ENDPOINT
// ============================================

app.post('/api/projects/:id/callsheet/send', async (req, res) => {
    try {
        const { id } = req.params;
        const { shoot_date, call_time, location, scenes } = req.body;
        
        if (!shoot_date) {
            return res.status(400).json({ error: 'shoot_date is required' });
        }
        
        // Get project info
        const projectResult = await pool.query(
            'SELECT name FROM projects WHERE id = $1',
            [id]
        );
        
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const projectName = projectResult.rows[0].name;
        
        // Get crew assigned to this date
        const crewResult = await pool.query(
            `SELECT pc.name, pc.email, pc.department
             FROM schedules s
             JOIN project_crew pc ON s.crew_id = pc.id
             WHERE s.project_id = $1 AND s.shoot_date = $2`,
            [id, shoot_date]
        );
        
        const crew = crewResult.rows;
        
        if (crew.length === 0) {
            return res.status(400).json({ error: 'No crew assigned to this date' });
        }
        
        // Generate simple PDF (simplified for now)
        const doc = new jsPDF();
        doc.setFontSize(20);
        doc.text(projectName, 105, 20, { align: 'center' });
        doc.setFontSize(16);
        doc.text('CALL SHEET', 105, 30, { align: 'center' });
        doc.setFontSize(12);
        doc.text(`Date: ${new Date(shoot_date).toLocaleDateString()}`, 20, 50);
        doc.text(`Call Time: ${call_time || '06:00 AM'}`, 20, 60);
        doc.text(`Location: ${location || 'TBD'}`, 20, 70);
        
        // Convert to base64
        const pdfBase64 = doc.output('datauristring').split(',')[1];
        
        // Send emails
        const emailPromises = crew.map(member => 
            sendEmail({
                to: member.email,
                subject: `Call Sheet - ${shoot_date}`,
                html: `
                    <div style="font-family: Arial, sans-serif;">
                        <h1 style="color: #FF2D55;">🎬 Your Call Sheet</h1>
                        <p>Hi ${member.name},</p>
                        <p>Please see the attached call sheet for ${shoot_date}.</p>
                    </div>
                `,
                attachments: [{
                    filename: `callsheet-${shoot_date}.pdf`,
                    content: pdfBase64
                }]
            })
        );
        
        await Promise.all(emailPromises);
        
        res.json({ 
            message: `Call sheet sent to ${crew.length} crew members`,
            crew_count: crew.length
        });
    } catch (error) {
        console.error('Send call sheet error:', error);
        res.status(500).json({ error: 'Failed to send call sheet' });
    }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(port, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🎬 FilmFlow API Server Running      ║
╠═══════════════════════════════════════╣
║   Port: ${port}                       ║
║   Environment: ${process.env.NODE_ENV || 'production'}      ║
║   Frontend: ${process.env.FRONTEND_URL || 'https://filmfloww.netlify.app'}   ║
╚═══════════════════════════════════════╝
    `);
});

module.exports = app;
