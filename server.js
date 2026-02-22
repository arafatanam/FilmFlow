// server.js - FilmFlow Complete Production Management System
// Optimized for Render + Supabase + Netlify

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { Resend } = require("resend");
const jsPDF = require("jspdf");
require("jspdf-autotable");
require("dotenv").config();
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================

// CORS configuration for Netlify
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow all Netlify apps and localhost
      if (
        !origin ||
        origin.includes("netlify.app") ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1")
      ) {
        return callback(null, true);
      }
      callback(null, process.env.FRONTEND_URL || true);
    },
    credentials: true,
  }),
);

app.use(express.json());

// ============================================
// DATABASE CONNECTION
// ============================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    require: true,
  },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 20,
});

// Test database connection
async function connectDatabase() {
  try {
    const client = await pool.connect();
    console.log("✅ Database connected successfully");

    const result = await client.query("SELECT NOW() as time");
    console.log(`✅ Database time: ${result.rows[0].time}`);

    client.release();
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    return false;
  }
}

connectDatabase();

// ============================================
// EMAIL SETUP (Resend)
// ============================================

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html, attachments = [] }) {
  try {
    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM || "FilmFlow <onboarding@resend.dev>",
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: html,
      attachments: attachments,
    });
    console.log("✅ Email sent to:", to);
    return data;
  } catch (error) {
    console.error("❌ Email error:", error);
    throw error;
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Generate unique project code
function generateProjectCode(name) {
  const prefix = name.substring(0, 3).toUpperCase();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${random}`;
}

// Generate invite link
function getInviteLink(projectCode) {
  return `${process.env.FRONTEND_URL || "https://filmflow.netlify.app"}/crew-signup.html?project=${projectCode}`;
}

// Check for conflicts when scheduling
async function checkConflicts(projectId, crewId, shootDate) {
  const query = `
        SELECT 
            -- Check if crew is already booked on another project
            EXISTS (
                SELECT 1 FROM schedule_assignments 
                WHERE crew_id = $2 
                AND shoot_date = $3 
                AND project_id != $1
            ) as double_booked,
            
            -- Check if crew marked themselves unavailable
            ($3 = ANY(SELECT personal_unavailable_dates FROM crew_profiles WHERE id = $2)) as personal_unavailable,
            
            -- Check for missing info
            EXISTS (
                SELECT 1 FROM crew_profiles 
                WHERE id = $2 AND (
                    emergency_name IS NULL OR 
                    emergency_phone IS NULL OR
                    dietary_restrictions IS NULL OR
                    array_length(dietary_restrictions, 1) = 0 OR
                    has_insurance = false
                )
            ) as missing_info
    `;

  const result = await pool.query(query, [projectId, crewId, shootDate]);
  return result.rows[0];
}

// Get weather forecast (mock for now - integrate with OpenWeatherMap)
async function getWeatherForecast(location, date) {
  // TODO: Integrate with OpenWeatherMap API
  return {
    temp: 72,
    condition: "Sunny",
    precipitation: 0,
    wind: 5,
  };
}

// Get sunrise/sunset times
async function getSunTimes(lat, lng, date) {
  // TODO: Integrate with Sunrise Sunset API
  return {
    sunrise: "06:30",
    sunset: "19:45",
    golden_hour: "18:45",
  };
}

// ============================================
// HEALTH ENDPOINTS
// ============================================

app.get("/", (req, res) => {
  res.json({
    message: "🎬 FilmFlow API is running",
    version: "3.0.0",
    endpoints: {
      admin: "/api/admin/*",
      crew: "/api/crew/*",
      projects: "/api/projects/*",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/api/health/db", async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW() as time");
    client.release();
    res.json({
      status: "connected",
      database: "✅ OK",
      time: result.rows[0].time,
    });
  } catch (error) {
    res.status(500).json({
      status: "disconnected",
      error: error.message,
    });
  }
});

// ============================================
// PROJECT ENDPOINTS (Admin)
// ============================================

// Create new project
app.post("/api/projects", async (req, res) => {
  try {
    const { name, start_date, end_date, location, latitude, longitude } =
      req.body;

    if (!name || !start_date || !end_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const code = generateProjectCode(name);

    const result = await pool.query(
      `INSERT INTO projects 
             (name, project_code, start_date, end_date, location, latitude, longitude, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') 
             RETURNING *`,
      [name, code, start_date, end_date, location, latitude, longitude],
    );

    const project = result.rows[0];
    const inviteLink = getInviteLink(project.project_code);

    res.status(201).json({
      project,
      inviteLink,
    });
  } catch (error) {
    console.error("Project creation error:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// Get all projects with completion stats
app.get("/api/projects", async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT p.*, 
                   pc.total_crew,
                   pc.completed_forms,
                   pc.pending_forms,
                   pc.missing_emergency,
                   pc.missing_dietary,
                   pc.missing_insurance
            FROM projects p
            LEFT JOIN project_completion pc ON p.id = pc.id
            ORDER BY p.created_at DESC
        `);

    res.json({ projects: result.rows });
  } catch (error) {
    console.error("Get projects error:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Get single project by code (for crew signup)
app.get("/api/projects/code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      `SELECT id, name, project_code, start_date, end_date, location, status 
             FROM projects WHERE project_code = $1`,
      [code],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Get all dates between start and end
    const project = result.rows[0];
    const dates = [];
    let currentDate = new Date(project.start_date);
    const endDate = new Date(project.end_date);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate).toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({
      project: {
        ...project,
        shoot_dates: dates,
      },
    });
  } catch (error) {
    console.error("Get project error:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Update project dates
app.put("/api/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date, location, name, status } = req.body;

    const result = await pool.query(
      `UPDATE projects 
             SET start_date = COALESCE($1, start_date),
                 end_date = COALESCE($2, end_date),
                 location = COALESCE($3, location),
                 name = COALESCE($4, name),
                 status = COALESCE($5, status),
                 updated_at = NOW()
             WHERE id = $6 
             RETURNING *`,
      [start_date, end_date, location, name, status, id],
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
// CREW PROFILE ENDPOINTS (Forever Storage)
// ============================================

// Check if crew exists by email
app.post("/api/crew/check", async (req, res) => {
  try {
    const { email } = req.body;

    const result = await pool.query(
      "SELECT id, full_name, phone, department FROM crew_profiles WHERE email = $1",
      [email],
    );

    if (result.rows.length > 0) {
      res.json({ exists: true, profile: result.rows[0] });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error("Check crew error:", error);
    res.status(500).json({ error: "Failed to check crew" });
  }
});

// Create or update crew profile
app.post("/api/crew/profile", async (req, res) => {
  try {
    const {
      full_name,
      phone,
      email,
      department,
      emergency_name,
      emergency_phone,
      dietary_restrictions,
      address,
      union_status,
      has_insurance,
      insurance_expiry,
      certifications,
    } = req.body;

    // Check if crew exists
    const existing = await pool.query(
      "SELECT id FROM crew_profiles WHERE email = $1",
      [email],
    );

    let crewId;

    if (existing.rows.length > 0) {
      // Update existing profile
      const result = await pool.query(
        `UPDATE crew_profiles 
                 SET full_name = $1, phone = $2, department = $3,
                     emergency_name = $4, emergency_phone = $5,
                     dietary_restrictions = $6, address = $7,
                     union_status = $8, has_insurance = $9,
                     insurance_expiry = $10, certifications = $11,
                     updated_at = NOW()
                 WHERE email = $12
                 RETURNING id`,
        [
          full_name,
          phone,
          department,
          emergency_name,
          emergency_phone,
          dietary_restrictions,
          address,
          union_status,
          has_insurance,
          insurance_expiry,
          certifications,
          email,
        ],
      );
      crewId = result.rows[0].id;
    } else {
      // Create new profile
      const result = await pool.query(
        `INSERT INTO crew_profiles 
                 (full_name, phone, email, department, emergency_name,
                  emergency_phone, dietary_restrictions, address,
                  union_status, has_insurance, insurance_expiry, certifications)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING id`,
        [
          full_name,
          phone,
          email,
          department,
          emergency_name,
          emergency_phone,
          dietary_restrictions,
          address,
          union_status,
          has_insurance,
          insurance_expiry,
          certifications,
        ],
      );
      crewId = result.rows[0].id;
    }

    res.json({
      success: true,
      crewId,
      message: existing.rows.length > 0 ? "Profile updated" : "Profile created",
    });
  } catch (error) {
    console.error("Crew profile error:", error);
    res.status(500).json({ error: "Failed to save crew profile" });
  }
});

// Get crew profile by ID
app.get("/api/crew/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM crew_profiles WHERE id = $1",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Crew not found" });
    }

    res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error("Get crew error:", error);
    res.status(500).json({ error: "Failed to fetch crew" });
  }
});

// Update crew availability (personal unavailable dates)
app.post("/api/crew/:id/availability", async (req, res) => {
  try {
    const { id } = req.params;
    const { unavailable_dates } = req.body;

    const result = await pool.query(
      "UPDATE crew_profiles SET personal_unavailable_dates = $1 WHERE id = $2 RETURNING id",
      [unavailable_dates, id],
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Update availability error:", error);
    res.status(500).json({ error: "Failed to update availability" });
  }
});

// ============================================
// PROJECT CREW SIGNUP (Links crew to project)
// ============================================

// Crew signs up for a project
app.post("/api/projects/:projectCode/crew/signup", async (req, res) => {
  try {
    const { projectCode } = req.params;
    const {
      crew_id, // If existing crew
      full_name,
      phone,
      email,
      department,
      emergency_name,
      emergency_phone,
      dietary_restrictions,
      address,
      union_status,
      has_insurance,
      insurance_expiry,
      certifications,
      available_dates, // Array of dates they can work
    } = req.body;

    // Get project
    const projectResult = await pool.query(
      "SELECT id, name FROM projects WHERE project_code = $1",
      [projectCode],
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = projectResult.rows[0].id;
    const projectName = projectResult.rows[0].name;

    let crewId = crew_id;

    // If no crew_id, create new profile
    if (!crewId) {
      const profileResult = await pool.query(
        `INSERT INTO crew_profiles 
                 (full_name, phone, email, department, emergency_name,
                  emergency_phone, dietary_restrictions, address,
                  union_status, has_insurance, insurance_expiry, certifications)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING id`,
        [
          full_name,
          phone,
          email,
          department,
          emergency_name,
          emergency_phone,
          dietary_restrictions,
          address,
          union_status,
          has_insurance,
          insurance_expiry,
          certifications,
        ],
      );
      crewId = profileResult.rows[0].id;
    }

    // Link crew to project
    const projectCrewResult = await pool.query(
      `INSERT INTO project_crew 
             (project_id, crew_id, project_department, form_completed)
             VALUES ($1, $2, $3, true)
             ON CONFLICT (project_id, crew_id) 
             DO UPDATE SET form_completed = true
             RETURNING id`,
      [projectId, crewId, department],
    );

    const projectCrewId = projectCrewResult.rows[0].id;

    // Add availability
    if (available_dates && available_dates.length > 0) {
      for (const date of available_dates) {
        await pool.query(
          `INSERT INTO crew_availability (project_crew_id, shoot_date, is_available)
                     VALUES ($1, $2, true)
                     ON CONFLICT (project_crew_id, shoot_date) DO NOTHING`,
          [projectCrewId, date],
        );
      }
    }

    // Send confirmation email
    try {
      await sendEmail({
        to: email,
        subject: `✅ You're on the crew for ${projectName}!`,
        html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px;">
                        <h1 style="color: #FF2D55;">🎬 Welcome to ${projectName}!</h1>
                        <p>Hi ${full_name},</p>
                        <p>You've successfully signed up for the production.</p>
                        <p><strong>What's next?</strong></p>
                        <ul>
                            <li>The production team will assign you to specific shoot days</li>
                            <li>You'll receive call sheets via email when ready</li>
                            <li>You can update your profile anytime using the same link</li>
                        </ul>
                        <p style="margin-top: 30px;">See you on set!<br>- FilmFlow Team</p>
                    </div>
                `,
      });
    } catch (emailError) {
      console.log("Confirmation email failed, but signup successful");
    }

    res.status(201).json({
      success: true,
      crewId,
      message: "Successfully signed up!",
    });
  } catch (error) {
    console.error("Crew signup error:", error);
    res.status(500).json({ error: "Failed to sign up" });
  }
});

// ============================================
// ADMIN DASHBOARD ENDPOINTS
// ============================================

// Get project completion stats
app.get("/api/admin/project/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM project_completion WHERE id = $1",
      [id],
    );

    res.json({ stats: result.rows[0] || {} });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Get all crew for a project with details
app.get("/api/admin/project/:id/crew", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
            SELECT 
                cp.*,
                pc.id as project_crew_id,
                pc.form_completed,
                pc.missing_emergency,
                pc.missing_dietary,
                pc.missing_insurance,
                pc.signup_date,
                array_agg(DISTINCT ca.shoot_date) FILTER (WHERE ca.is_available = true) as available_dates
            FROM project_crew pc
            JOIN crew_profiles cp ON pc.crew_id = cp.id
            LEFT JOIN crew_availability ca ON pc.id = ca.project_crew_id
            WHERE pc.project_id = $1
            GROUP BY cp.id, pc.id
            ORDER BY cp.department, cp.full_name
        `,
      [id],
    );

    // Group by department
    const byDepartment = {};
    result.rows.forEach((crew) => {
      const dept = crew.department || "Other";
      if (!byDepartment[dept]) {
        byDepartment[dept] = [];
      }
      byDepartment[dept].push(crew);
    });

    res.json({
      crew: result.rows,
      byDepartment,
      total: result.rows.length,
      completed: result.rows.filter((c) => c.form_completed).length,
      pending: result.rows.filter((c) => !c.form_completed).length,
    });
  } catch (error) {
    console.error("Get crew error:", error);
    res.status(500).json({ error: "Failed to fetch crew" });
  }
});

// Get pending crew (missing info)
app.get("/api/admin/project/:id/pending", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
            SELECT 
                cp.full_name,
                cp.email,
                cp.phone,
                cp.department,
                pc.missing_emergency,
                pc.missing_dietary,
                pc.missing_insurance
            FROM project_crew pc
            JOIN crew_profiles cp ON pc.crew_id = cp.id
            WHERE pc.project_id = $1 
            AND (pc.missing_emergency OR pc.missing_dietary OR pc.missing_insurance OR pc.form_completed = false)
            ORDER BY cp.department, cp.full_name
        `,
      [id],
    );

    res.json({ pending: result.rows });
  } catch (error) {
    console.error("Get pending error:", error);
    res.status(500).json({ error: "Failed to fetch pending" });
  }
});

// ============================================
// SCHEDULING ENDPOINTS (with conflict detection)
// ============================================

// Assign crew to date (with conflict check)
app.post("/api/schedule/assign", async (req, res) => {
  try {
    const {
      project_id,
      crew_id,
      shoot_date,
      call_time,
      department,
      override = false,
    } = req.body;

    // Check for conflicts
    const conflicts = await checkConflicts(project_id, crew_id, shoot_date);

    // If there are conflicts and not overriding, return warning
    if (
      (conflicts.double_booked ||
        conflicts.personal_unavailable ||
        conflicts.missing_info) &&
      !override
    ) {
      return res.status(409).json({
        warning: true,
        conflicts,
        message: "Conflict detected. Send override=true to force assign.",
      });
    }

    // Assign crew
    const result = await pool.query(
      `INSERT INTO schedule_assignments 
             (project_id, crew_id, shoot_date, call_time, department,
              conflict_warning, conflict_type, conflict_resolved)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (project_id, crew_id, shoot_date) 
             DO UPDATE SET 
                call_time = EXCLUDED.call_time,
                department = EXCLUDED.department,
                conflict_warning = EXCLUDED.conflict_warning,
                conflict_resolved = EXCLUDED.conflict_resolved
             RETURNING *`,
      [
        project_id,
        crew_id,
        shoot_date,
        call_time,
        department,
        conflicts.double_booked || conflicts.personal_unavailable,
        conflicts.double_booked
          ? "double_booked"
          : conflicts.personal_unavailable
            ? "unavailable"
            : null,
        override,
      ],
    );

    res.json({
      success: true,
      assignment: result.rows[0],
      warning:
        conflicts.double_booked || conflicts.personal_unavailable
          ? "Assigned with conflicts"
          : null,
    });
  } catch (error) {
    console.error("Schedule assignment error:", error);
    res.status(500).json({ error: "Failed to assign crew" });
  }
});

// Assign entire department to date
app.post("/api/schedule/assign-department", async (req, res) => {
  try {
    const { project_id, department, shoot_date, call_time } = req.body;

    // Get all crew from this department
    const crewResult = await pool.query(
      `SELECT pc.crew_id 
             FROM project_crew pc
             JOIN crew_profiles cp ON pc.crew_id = cp.id
             WHERE pc.project_id = $1 AND cp.department = $2`,
      [project_id, department],
    );

    const crewIds = crewResult.rows.map((r) => r.crew_id);

    if (crewIds.length === 0) {
      return res
        .status(404)
        .json({ error: "No crew found in this department" });
    }

    // Check conflicts for all
    const conflicts = [];
    const assignments = [];

    for (const crewId of crewIds) {
      const conflictCheck = await checkConflicts(
        project_id,
        crewId,
        shoot_date,
      );
      conflicts.push(conflictCheck);

      // Assign regardless, but mark conflicts
      const assignResult = await pool.query(
        `INSERT INTO schedule_assignments 
                 (project_id, crew_id, shoot_date, call_time, department, conflict_warning, conflict_type)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (project_id, crew_id, shoot_date) DO NOTHING
                 RETURNING *`,
        [
          project_id,
          crewId,
          shoot_date,
          call_time,
          department,
          conflictCheck.double_booked || conflictCheck.personal_unavailable,
          conflictCheck.double_booked
            ? "double_booked"
            : conflictCheck.personal_unavailable
              ? "unavailable"
              : null,
        ],
      );

      if (assignResult.rows.length > 0) {
        assignments.push(assignResult.rows[0]);
      }
    }

    const hasConflicts = conflicts.some(
      (c) => c.double_booked || c.personal_unavailable,
    );

    res.json({
      success: true,
      assigned: assignments.length,
      total: crewIds.length,
      hasConflicts,
      conflicts: conflicts.filter(
        (c) => c.double_booked || c.personal_unavailable,
      ).length,
    });
  } catch (error) {
    console.error("Assign department error:", error);
    res.status(500).json({ error: "Failed to assign department" });
  }
});

// Get schedule with conflict warnings
app.get("/api/schedule/project/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
            SELECT 
                sa.shoot_date,
                sa.call_time,
                sa.department,
                sa.conflict_warning,
                sa.conflict_type,
                sa.conflict_resolved,
                cp.id as crew_id,
                cp.full_name,
                cp.email,
                cp.phone,
                cp.dietary_restrictions,
                cp.emergency_name,
                cp.emergency_phone,
                cp.has_insurance,
                cp.insurance_expiry
            FROM schedule_assignments sa
            JOIN crew_profiles cp ON sa.crew_id = cp.id
            WHERE sa.project_id = $1
            ORDER BY sa.shoot_date, sa.department, cp.full_name
        `,
      [id],
    );

    // Group by date
    const byDate = {};
    result.rows.forEach((row) => {
      if (!byDate[row.shoot_date]) {
        byDate[row.shoot_date] = {
          date: row.shoot_date,
          crew: [],
          total: 0,
        };
      }
      byDate[row.shoot_date].crew.push({
        id: row.crew_id,
        name: row.full_name,
        department: row.department,
        call_time: row.call_time,
        conflict: row.conflict_warning
          ? {
              type: row.conflict_type,
              resolved: row.conflict_resolved,
            }
          : null,
      });
      byDate[row.shoot_date].total++;
    });

    res.json({ schedule: Object.values(byDate) });
  } catch (error) {
    console.error("Get schedule error:", error);
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

// Get conflict report for project
app.get("/api/schedule/project/:id/conflicts", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM conflict_report WHERE project_id = $1",
      [id],
    );

    const summary = {
      total_conflicts: result.rows.length,
      double_booked: result.rows.filter((r) => r.is_double_booked).length,
      unavailable: result.rows.filter((r) => r.is_personal_unavailable).length,
      missing_emergency: result.rows.filter((r) => r.missing_emergency).length,
      missing_dietary: result.rows.filter((r) => r.missing_dietary).length,
      insurance_issues: result.rows.filter((r) => r.insurance_issue).length,
    };

    res.json({
      conflicts: result.rows,
      summary,
    });
  } catch (error) {
    console.error("Conflict report error:", error);
    res.status(500).json({ error: "Failed to fetch conflicts" });
  }
});

// Remove from schedule
app.delete("/api/schedule/:projectId/:crewId/:date", async (req, res) => {
  try {
    const { projectId, crewId, date } = req.params;

    await pool.query(
      "DELETE FROM schedule_assignments WHERE project_id = $1 AND crew_id = $2 AND shoot_date = $3",
      [projectId, crewId, date],
    );

    res.json({ message: "Crew member removed from date" });
  } catch (error) {
    console.error("Remove crew error:", error);
    res.status(500).json({ error: "Failed to remove crew" });
  }
});

// ============================================
// CALL SHEET GENERATION
// ============================================

// Generate and send call sheet
app.post("/api/callsheet/generate", async (req, res) => {
  try {
    const { project_id, shoot_date, call_time, location, scenes, ad_notes } =
      req.body;

    if (!project_id || !shoot_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get project info
    const projectResult = await pool.query(
      "SELECT name, location, latitude, longitude FROM projects WHERE id = $1",
      [project_id],
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const project = projectResult.rows[0];

    // Get crew assigned to this date
    const crewResult = await pool.query(
      `
            SELECT 
                cp.full_name,
                cp.email,
                cp.phone,
                cp.department,
                cp.dietary_restrictions,
                cp.emergency_name,
                cp.emergency_phone,
                cp.has_insurance,
                cp.insurance_expiry,
                sa.call_time,
                sa.conflict_warning,
                sa.conflict_type
            FROM schedule_assignments sa
            JOIN crew_profiles cp ON sa.crew_id = cp.id
            WHERE sa.project_id = $1 AND sa.shoot_date = $2
            ORDER BY cp.department, cp.full_name
        `,
      [project_id, shoot_date],
    );

    const crew = crewResult.rows;

    if (crew.length === 0) {
      return res.status(400).json({ error: "No crew assigned to this date" });
    }

    // Get weather and sun times
    const weather = await getWeatherForecast(
      project.location || "Unknown",
      shoot_date,
    );
    const sunTimes = await getSunTimes(
      project.latitude || 0,
      project.longitude || 0,
      shoot_date,
    );

    // Generate AD flags (private)
    const adFlags = [];
    crew.forEach((member) => {
      if (!member.emergency_name) {
        adFlags.push(`⚠️ ${member.full_name}: No emergency contact on file`);
      }
      if (
        !member.dietary_restrictions ||
        member.dietary_restrictions.length === 0
      ) {
        adFlags.push(
          `⚠️ ${member.full_name}: No dietary info - notify catering`,
        );
      }
      if (
        !member.has_insurance ||
        (member.insurance_expiry &&
          new Date(member.insurance_expiry) < new Date(shoot_date))
      ) {
        adFlags.push(
          `⚠️ ${member.full_name}: Insurance issue - verify before shoot`,
        );
      }
      if (member.conflict_warning) {
        adFlags.push(
          `⚠️ ${member.full_name}: ${member.conflict_type.replace("_", " ")} - scheduled with warning`,
        );
      }
    });

    // Generate PDF
    const doc = new jsPDF();

    // Header
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 45, 85);
    doc.text(project.name, 105, 20, { align: "center" });

    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text("CALL SHEET", 105, 30, { align: "center" });

    // Date
    doc.setFontSize(12);
    const dateStr = new Date(shoot_date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    doc.text(dateStr, 105, 40, { align: "center" });

    // Weather info
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(
      `🌤️ ${weather.condition} ${weather.temp}°F | 🌅 Sunrise ${sunTimes.sunrise} | 🌇 Sunset ${sunTimes.sunset}`,
      105,
      48,
      { align: "center" },
    );

    let yPos = 60;

    // Schedule section
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("SCHEDULE", 20, yPos);
    yPos += 8;

    doc.autoTable({
      startY: yPos,
      head: [["Item", "Details"]],
      body: [
        ["General Crew Call", call_time || "06:00 AM"],
        ["Location", location || project.location || "TBD"],
        ["Scenes", scenes || "See attached schedule"],
      ],
      margin: { left: 20 },
      headStyles: { fillColor: [255, 45, 85] },
      styles: { fontSize: 10 },
    });

    yPos = doc.lastAutoTable.finalY + 15;

    // Crew list
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("CREW", 20, yPos);
    yPos += 8;

    const crewData = crew.map((c) => [
      c.full_name,
      c.department,
      c.phone,
      c.call_time || call_time || "06:00 AM",
      (c.dietary_restrictions || [])
        .map((d) => {
          const icons = {
            Vegetarian: "🥗",
            Vegan: "🌱",
            "Gluten-Free": "🌾",
            "Nut Allergy": "🥜",
            "Dairy-Free": "🥛",
            Halal: "☪️",
            Kosher: "✡️",
          };
          return icons[d] || "⚠️";
        })
        .join(" ") || "—",
    ]);

    doc.autoTable({
      startY: yPos,
      head: [["Name", "Dept", "Phone", "Call Time", "Dietary"]],
      body: crewData,
      margin: { left: 20 },
      headStyles: { fillColor: [255, 45, 85] },
      styles: { fontSize: 9 },
    });

    yPos = doc.lastAutoTable.finalY + 15;

    // Emergency contacts (for AD only - private)
    if (ad_notes || adFlags.length > 0) {
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 45, 85);
      doc.text("AD PRIVATE NOTES", 20, yPos);
      yPos += 8;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);

      if (ad_notes) {
        doc.text(ad_notes, 20, yPos);
        yPos += 6;
      }

      adFlags.forEach((flag) => {
        doc.text(flag, 20, yPos);
        yPos += 6;
      });
    }

    // Convert PDF to base64
    const pdfBase64 = doc.output("datauristring").split(",")[1];

    // Send emails to crew (without AD notes)
    const emailPromises = crew.map((member) =>
      sendEmail({
        to: member.email,
        subject: `📋 Call Sheet for ${dateStr}`,
        html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px;">
                        <h1 style="color: #FF2D55;">🎬 Your Call Sheet is Ready!</h1>
                        <p>Hi ${member.full_name},</p>
                        <p>Please find attached the call sheet for <strong>${dateStr}</strong>.</p>
                        
                        <div style="background: #f5f5f5; padding: 15px; margin: 20px 0;">
                            <p><strong>Call Time:</strong> ${member.call_time || call_time || "06:00 AM"}</p>
                            <p><strong>Location:</strong> ${location || project.location || "TBD"}</p>
                            <p><strong>Weather:</strong> ${weather.condition}, ${weather.temp}°F</p>
                        </div>
                        
                        <p style="color: #666; font-size: 12px;">
                            Questions? Contact your department head or production.
                        </p>
                    </div>
                `,
        attachments: [
          {
            filename: `callsheet-${shoot_date}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    );

    await Promise.all(emailPromises);

    // Save call sheet record
    await pool.query(
      `INSERT INTO call_sheets 
             (project_id, shoot_date, call_time, location, scenes, 
              weather_forecast, sunrise_time, sunset_time, 
              ad_private_notes, ad_flags, pdf_url, emailed_at, crew_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
             ON CONFLICT (project_id, shoot_date) DO UPDATE
             SET emailed_at = NOW(), crew_count = $12`,
      [
        project_id,
        shoot_date,
        call_time,
        location || project.location,
        scenes,
        weather,
        sunTimes.sunrise,
        sunTimes.sunset,
        ad_notes,
        JSON.stringify(adFlags),
        "pdf-generated",
        crew.length,
      ],
    );

    res.json({
      success: true,
      message: `Call sheet sent to ${crew.length} crew members`,
      crew_count: crew.length,
      ad_flags: adFlags,
    });
  } catch (error) {
    console.error("Call sheet generation error:", error);
    res.status(500).json({ error: "Failed to generate call sheet" });
  }
});

// Get call sheet history
app.get("/api/callsheet/project/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM call_sheets 
             WHERE project_id = $1 
             ORDER BY shoot_date DESC`,
      [id],
    );

    res.json({ callsheets: result.rows });
  } catch (error) {
    console.error("Get call sheets error:", error);
    res.status(500).json({ error: "Failed to fetch call sheets" });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(port, () => {
  console.log(`
╔════════════════════════════════════════════╗
║    🎬 FilmFlow API Server Running          ║
╠════════════════════════════════════════════╣
║    Port: ${port}                            ║
║    Environment: ${process.env.NODE_ENV || "production"}           ║
║    Database: ${process.env.DATABASE_URL ? "✅ Configured" : "❌ Not set"}   ║
║    Email: ${process.env.RESEND_API_KEY ? "✅ Resend ready" : "❌ Not set"}     ║
║    Frontend: ${process.env.FRONTEND_URL || "Not set"}  ║
╚════════════════════════════════════════════╝
    `);
});

module.exports = app;
