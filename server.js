// server-v2.js - Updated Backend for Project-Specific FilmFlow
// Node.js/Express server with PostgreSQL database

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const jsPDF = require("jspdf");
require("jspdf-autotable");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// Email setup
const transporter = nodemailer.createTransport({
  service: "SendGrid",
  auth: {
    user: process.env.SENDGRID_USER,
    pass: process.env.SENDGRID_API_KEY,
  },
});

// Generate unique project code
function generateProjectCode(name) {
  const prefix = name.substring(0, 3).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${random}`;
}

// ============================================
// PROJECT ENDPOINTS
// ============================================

// Create new project
app.post("/api/projects", async (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;

    const code = generateProjectCode(name);

    const result = await pool.query(
      `INSERT INTO projects (name, project_code, start_date, end_date, status) 
             VALUES ($1, $2, $3, $4, 'active') 
             RETURNING *`,
      [name, code, start_date, end_date]
    );

    res.status(201).json({
      project: result.rows[0],
      inviteLink: `${process.env.FRONTEND_URL}?project=${code}`,
    });
  } catch (error) {
    console.error("Project creation error:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// Get all projects
app.get("/api/projects", async (req, res) => {
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
    console.error("Get projects error:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Get project by code (public endpoint for crew signup)
app.get("/api/projects/code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      "SELECT id, name, project_code, start_date, end_date, status FROM projects WHERE project_code = $1",
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ project: result.rows[0] });
  } catch (error) {
    console.error("Get project error:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Update project dates
app.put("/api/projects/:id/dates", async (req, res) => {
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
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ project: result.rows[0] });
  } catch (error) {
    console.error("Update project error:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// ============================================
// PROJECT CREW ENDPOINTS (Project-Specific)
// ============================================

// Crew signup for specific project (public endpoint)
app.post("/api/projects/:projectCode/crew", async (req, res) => {
  try {
    const { projectCode } = req.params;

    // Get project
    const projectResult = await pool.query(
      "SELECT id FROM projects WHERE project_code = $1",
      [projectCode]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = projectResult.rows[0].id;

    const {
      name,
      phone,
      email,
      department,
      emergency_contact_name,
      emergency_contact_phone,
      dietary_restrictions,
      address,
      has_insurance,
    } = req.body;

    // Check if this email already signed up for this project
    const existingResult = await pool.query(
      "SELECT id FROM project_crew WHERE project_id = $1 AND email = $2",
      [projectId, email]
    );

    if (existingResult.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "You have already signed up for this project" });
    }

    // Insert crew member for this project
    const result = await pool.query(
      `INSERT INTO project_crew 
            (project_id, name, phone, email, department, emergency_contact_name, 
             emergency_contact_phone, dietary_restrictions, address, has_insurance) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING *`,
      [
        projectId,
        name,
        phone,
        email,
        department,
        emergency_contact_name,
        emergency_contact_phone,
        dietary_restrictions,
        address,
        has_insurance,
      ]
    );

    // Send confirmation email
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `Confirmed: You're on the crew!`,
      html: `
                <h1>Welcome to the Team!</h1>
                <p>Hi ${name},</p>
                <p>You've successfully signed up for the production. The production team will assign you to shoot dates and send call sheets via email.</p>
                <p>Thank you for joining us!</p>
            `,
    });

    res.status(201).json({
      crew: result.rows[0],
      message:
        "Successfully signed up! You will receive call sheets via email when assigned to dates.",
    });
  } catch (error) {
    console.error("Crew signup error:", error);
    res.status(500).json({ error: "Failed to sign up" });
  }
});

// Get all crew for a project
app.get("/api/projects/:id/crew", async (req, res) => {
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
    console.error("Get crew error:", error);
    res.status(500).json({ error: "Failed to fetch crew" });
  }
});

// Get crew grouped by department
app.get("/api/projects/:id/crew/by-department", async (req, res) => {
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
                    'has_insurance', has_insurance,
                    'emergency_contact_name', emergency_contact_name,
                    'emergency_contact_phone', emergency_contact_phone
                )
            ) as members
             FROM project_crew 
             WHERE project_id = $1 
             GROUP BY department
             ORDER BY department`,
      [id]
    );

    res.json({ departments: result.rows });
  } catch (error) {
    console.error("Get crew by department error:", error);
    res.status(500).json({ error: "Failed to fetch crew" });
  }
});

// ============================================
// SCHEDULE ENDPOINTS
// ============================================

// Assign department to a date
app.post("/api/projects/:id/schedule/assign-department", async (req, res) => {
  try {
    const { id } = req.params;
    const { department, shoot_date } = req.body;

    // Get all crew from this department
    const crewResult = await pool.query(
      "SELECT id FROM project_crew WHERE project_id = $1 AND department = $2",
      [id, department]
    );

    const crewIds = crewResult.rows.map((r) => r.id);

    // Insert schedules (ignore if already exists)
    const insertPromises = crewIds.map((crewId) =>
      pool.query(
        `INSERT INTO schedules (project_id, crew_id, shoot_date) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (project_id, crew_id, shoot_date) DO NOTHING`,
        [id, crewId, shoot_date]
      )
    );

    await Promise.all(insertPromises);

    res.json({
      message: `Assigned ${crewIds.length} ${department} crew members to ${shoot_date}`,
    });
  } catch (error) {
    console.error("Assign department error:", error);
    res.status(500).json({ error: "Failed to assign department" });
  }
});

// Get schedule for a project
app.get("/api/projects/:id/schedule", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT s.shoot_date, 
                    json_agg(
                        json_build_object(
                            'id', pc.id,
                            'name', pc.name,
                            'phone', pc.phone,
                            'email', pc.email,
                            'department', pc.department,
                            'dietary_restrictions', pc.dietary_restrictions
                        )
                    ) as crew
             FROM schedules s
             JOIN project_crew pc ON s.crew_id = pc.id
             WHERE s.project_id = $1
             GROUP BY s.shoot_date
             ORDER BY s.shoot_date`,
      [id]
    );

    res.json({ schedule: result.rows });
  } catch (error) {
    console.error("Get schedule error:", error);
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

// Remove crew member from a date
app.delete(
  "/api/projects/:projectId/schedule/:crewId/:date",
  async (req, res) => {
    try {
      const { projectId, crewId, date } = req.params;

      await pool.query(
        "DELETE FROM schedules WHERE project_id = $1 AND crew_id = $2 AND shoot_date = $3",
        [projectId, crewId, date]
      );

      res.json({ message: "Crew member removed from date" });
    } catch (error) {
      console.error("Remove crew error:", error);
      res.status(500).json({ error: "Failed to remove crew" });
    }
  }
);

// Get crew member's assigned dates
app.get("/api/crew/:email/dates/:projectCode", async (req, res) => {
  try {
    const { email, projectCode } = req.params;

    const result = await pool.query(
      `SELECT DISTINCT s.shoot_date
             FROM schedules s
             JOIN project_crew pc ON s.crew_id = pc.id
             JOIN projects p ON s.project_id = p.id
             WHERE pc.email = $1 AND p.project_code = $2
             ORDER BY s.shoot_date`,
      [email, projectCode]
    );

    res.json({ dates: result.rows.map((r) => r.shoot_date) });
  } catch (error) {
    console.error("Get assigned dates error:", error);
    res.status(500).json({ error: "Failed to fetch assigned dates" });
  }
});

// ============================================
// CALL SHEET ENDPOINTS
// ============================================

// Generate and email call sheet
app.post("/api/projects/:id/callsheet/send", async (req, res) => {
  try {
    const { id } = req.params;
    const { shoot_date, call_time, location, scenes } = req.body;

    // Get project info
    const projectResult = await pool.query(
      "SELECT name FROM projects WHERE id = $1",
      [id]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectName = projectResult.rows[0].name;

    // Get crew assigned to this date
    const crewResult = await pool.query(
      `SELECT pc.name, pc.email, pc.phone, pc.department, pc.dietary_restrictions
             FROM schedules s
             JOIN project_crew pc ON s.crew_id = pc.id
             WHERE s.project_id = $1 AND s.shoot_date = $2
             ORDER BY pc.department, pc.name`,
      [id, shoot_date]
    );

    const crew = crewResult.rows;

    if (crew.length === 0) {
      return res.status(400).json({ error: "No crew assigned to this date" });
    }

    // Generate PDF call sheet
    const doc = new jsPDF();

    // Header
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text(projectName, 105, 20, { align: "center" });

    doc.setFontSize(18);
    doc.text("CALL SHEET", 105, 30, { align: "center" });

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    const dateStr = new Date(shoot_date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    doc.text(dateStr, 105, 38, { align: "center" });

    let yPos = 50;

    // Schedule
    doc.setFont("helvetica", "bold");
    doc.text("SCHEDULE", 20, yPos);
    yPos += 8;

    doc.autoTable({
      startY: yPos,
      head: [["Item", "Time"]],
      body: [
        ["General Crew Call", call_time || "06:00"],
        ["Location", location || "TBD"],
      ],
      margin: { left: 20 },
    });

    yPos = doc.lastAutoTable.finalY + 10;

    // Scenes
    if (scenes) {
      doc.setFont("helvetica", "bold");
      doc.text("SCENES", 20, yPos);
      yPos += 8;
      doc.setFont("helvetica", "normal");
      doc.text(scenes, 20, yPos);
      yPos += 15;
    }

    // Crew list
    doc.setFont("helvetica", "bold");
    doc.text("CREW", 20, yPos);
    yPos += 8;

    const crewData = crew.map((c) => [
      c.name,
      c.department,
      c.phone,
      call_time || "06:00",
    ]);

    doc.autoTable({
      startY: yPos,
      head: [["Name", "Department", "Phone", "Call Time"]],
      body: crewData,
      margin: { left: 20 },
    });

    yPos = doc.lastAutoTable.finalY + 10;

    // Dietary requirements
    const dietaryReqs = crew.reduce((acc, c) => {
      if (c.dietary_restrictions && c.dietary_restrictions.length > 0) {
        c.dietary_restrictions.forEach((diet) => {
          if (!acc[diet]) acc[diet] = [];
          acc[diet].push(c.name);
        });
      }
      return acc;
    }, {});

    if (Object.keys(dietaryReqs).length > 0) {
      doc.setFont("helvetica", "bold");
      doc.text("CATERING - DIETARY REQUIREMENTS", 20, yPos);
      yPos += 8;

      const dietaryData = Object.entries(dietaryReqs).map(([diet, names]) => [
        diet,
        names.join(", "),
      ]);

      doc.autoTable({
        startY: yPos,
        head: [["Restriction", "Crew Members"]],
        body: dietaryData,
        margin: { left: 20 },
      });
    }

    // Convert to buffer
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const pdfBase64 = pdfBuffer.toString("base64");

    // Send emails to all crew
    const emailPromises = crew.map((member) =>
      transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: member.email,
        subject: `Call Sheet - ${dateStr}`,
        html: `
                    <h1>Your Call Sheet is Ready!</h1>
                    <p>Hi ${member.name},</p>
                    <p>Please see the attached call sheet for <strong>${dateStr}</strong>.</p>
                    <p><strong>Call Time:</strong> ${call_time || "06:00"}</p>
                    <p><strong>Location:</strong> ${location || "TBD"}</p>
                    <p>If you have any questions, please contact the production team.</p>
                `,
        attachments: [
          {
            filename: `callsheet-${shoot_date}.pdf`,
            content: pdfBase64,
            encoding: "base64",
          },
        ],
      })
    );

    await Promise.all(emailPromises);

    // Save call sheet record
    await pool.query(
      `INSERT INTO call_sheets 
             (project_id, shoot_date, call_time, location, scenes, pdf_url, emailed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, shoot_date, call_time, location, scenes, "base64pdf"]
    );

    res.json({
      message: `Call sheet sent to ${crew.length} crew members`,
      crew_count: crew.length,
    });
  } catch (error) {
    console.error("Send call sheet error:", error);
    res.status(500).json({ error: "Failed to send call sheet" });
  }
});

// Get call sheet history
app.get("/api/projects/:id/callsheets", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT cs.*, 
                    COUNT(DISTINCT s.crew_id) as crew_count
             FROM call_sheets cs
             LEFT JOIN schedules s ON cs.project_id = s.project_id AND cs.shoot_date = s.shoot_date
             WHERE cs.project_id = $1
             GROUP BY cs.id
             ORDER BY cs.shoot_date DESC`,
      [id]
    );

    res.json({ callsheets: result.rows });
  } catch (error) {
    console.error("Get call sheets error:", error);
    res.status(500).json({ error: "Failed to fetch call sheets" });
  }
});

// ============================================
// STATISTICS
// ============================================

app.get("/api/projects/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;

    const stats = await pool.query(
      `
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
            LEFT JOIN schedules s ON pc.id = s.crew_id
            WHERE pc.project_id = $1
        `,
      [id]
    );

    res.json({ stats: stats.rows[0] });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
