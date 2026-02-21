const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'FilmFlow API is running' });
});

// Get project by code
app.get('/api/project/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      'SELECT * FROM projects WHERE project_code = $1',
      [code]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit crew signup
app.post('/api/crew/signup', async (req, res) => {
  try {
    const {
      project_code,
      name,
      phone,
      email,
      department,
      emergency_contact_name,
      emergency_contact_phone,
      dietary_restrictions,
      has_insurance,
      address
    } = req.body;

    // Get project ID
    const projectResult = await pool.query(
      'SELECT id FROM projects WHERE project_code = $1',
      [project_code]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project_id = projectResult.rows[0].id;

    // Insert crew member
    const result = await pool.query(
      `INSERT INTO project_crew 
       (project_id, name, phone, email, department, emergency_contact_name, 
        emergency_contact_phone, dietary_restrictions, has_insurance, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (project_id, email) 
       DO UPDATE SET 
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         department = EXCLUDED.department,
         emergency_contact_name = EXCLUDED.emergency_contact_name,
         emergency_contact_phone = EXCLUDED.emergency_contact_phone,
         dietary_restrictions = EXCLUDED.dietary_restrictions,
         has_insurance = EXCLUDED.has_insurance,
         address = EXCLUDED.address,
         updated_at = NOW()
       RETURNING *`,
      [project_id, name, phone, email, department, emergency_contact_name,
       emergency_contact_phone, dietary_restrictions, has_insurance, address]
    );

    res.json({ 
      success: true, 
      message: 'Signup successful',
      crew: result.rows[0]
    });
  } catch (error) {
    console.error('Error in signup:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all crew for a project
app.get('/api/project/:code/crew', async (req, res) => {
  try {
    const { code } = req.params;
    
    const result = await pool.query(
      `SELECT pc.* 
       FROM project_crew pc
       JOIN projects p ON pc.project_id = p.id
       WHERE p.project_code = $1
       ORDER BY pc.department, pc.name`,
      [code]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching crew:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
