-- FilmFlow V2 Database Schema
-- PostgreSQL 14+ with Project-Specific Crew

-- Drop existing tables
DROP TABLE IF EXISTS call_sheets CASCADE;
DROP TABLE IF EXISTS schedules CASCADE;
DROP TABLE IF EXISTS project_crew CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

-- Projects Table
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    project_code VARCHAR(50) UNIQUE NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    -- Project Status
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('planning', 'active', 'completed', 'cancelled')),
    
    -- Optional Details
    description TEXT,
    location VARCHAR(255),
    production_company VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on project_code for fast lookup
CREATE INDEX idx_projects_code ON projects(project_code);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_dates ON projects(start_date, end_date);

-- Project Crew Table (Crew members per project - same email can sign up for multiple projects)
CREATE TABLE project_crew (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    
    -- Basic Info
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    
    -- Emergency Contact
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(50),
    
    -- Dietary Restrictions (PostgreSQL array)
    dietary_restrictions TEXT[] DEFAULT '{}',
    
    -- Optional Info
    address TEXT,
    
    -- Insurance
    has_insurance BOOLEAN DEFAULT false,
    
    -- Metadata
    signup_date TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Allow same email to sign up for different projects
    UNIQUE(project_id, email)
);

-- Create indexes for faster queries
CREATE INDEX idx_project_crew_project ON project_crew(project_id);
CREATE INDEX idx_project_crew_email ON project_crew(email);
CREATE INDEX idx_project_crew_department ON project_crew(project_id, department);

-- Schedules Table (Crew assignments to specific dates)
CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    crew_id INTEGER REFERENCES project_crew(id) ON DELETE CASCADE NOT NULL,
    shoot_date DATE NOT NULL,
    
    -- Optional call time (can be set per person or use general)
    call_time TIME,
    
    -- Notes
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Prevent duplicate assignments
    UNIQUE(project_id, crew_id, shoot_date)
);

-- Create indexes for fast schedule lookups
CREATE INDEX idx_schedules_project_date ON schedules(project_id, shoot_date);
CREATE INDEX idx_schedules_crew ON schedules(crew_id);
CREATE INDEX idx_schedules_date ON schedules(shoot_date);

-- Call Sheets Table (Track sent call sheets)
CREATE TABLE call_sheets (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    shoot_date DATE NOT NULL,
    
    -- Call Sheet Details
    call_time TIME,
    location VARCHAR(255),
    scenes TEXT,
    
    -- File storage
    pdf_url TEXT, -- S3 URL or base64 if small
    
    -- Distribution tracking
    emailed_at TIMESTAMP,
    crew_count INTEGER, -- Number of crew it was sent to
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(project_id, shoot_date)
);

-- Create index for call sheet lookups
CREATE INDEX idx_callsheets_project ON call_sheets(project_id);
CREATE INDEX idx_callsheets_date ON call_sheets(shoot_date);

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at 
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_crew_updated_at 
BEFORE UPDATE ON project_crew
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Useful Views

-- Project summary view
CREATE VIEW project_summary AS
SELECT 
    p.id,
    p.name,
    p.project_code,
    p.start_date,
    p.end_date,
    p.status,
    COUNT(DISTINCT pc.id) as crew_count,
    COUNT(DISTINCT pc.department) as department_count,
    COUNT(DISTINCT s.shoot_date) as scheduled_days,
    COUNT(DISTINCT cs.id) as callsheets_sent
FROM projects p
LEFT JOIN project_crew pc ON p.id = pc.project_id
LEFT JOIN schedules s ON p.id = s.project_id
LEFT JOIN call_sheets cs ON p.id = cs.project_id
GROUP BY p.id;

-- Crew with missing info per project
CREATE VIEW crew_missing_info AS
SELECT 
    pc.project_id,
    p.name as project_name,
    pc.id as crew_id,
    pc.name as crew_name,
    pc.email,
    pc.department,
    CASE 
        WHEN pc.emergency_contact_name IS NULL OR pc.emergency_contact_phone IS NULL 
        THEN 'Missing Emergency Contact'
        ELSE NULL
    END as missing_emergency,
    CASE 
        WHEN array_length(pc.dietary_restrictions, 1) IS NULL 
        THEN 'Missing Dietary Info'
        ELSE NULL
    END as missing_dietary,
    CASE 
        WHEN pc.has_insurance = false 
        THEN 'No Insurance'
        ELSE NULL
    END as no_insurance
FROM project_crew pc
JOIN projects p ON pc.project_id = p.id
WHERE pc.emergency_contact_name IS NULL 
   OR pc.emergency_contact_phone IS NULL
   OR array_length(pc.dietary_restrictions, 1) IS NULL
   OR pc.has_insurance = false;

-- Schedule overview by date
CREATE VIEW schedule_by_date AS
SELECT 
    s.project_id,
    p.name as project_name,
    s.shoot_date,
    COUNT(DISTINCT s.crew_id) as crew_count,
    COUNT(DISTINCT pc.department) as department_count,
    json_agg(DISTINCT pc.department) as departments,
    array_agg(DISTINCT pc.dietary_restrictions) as all_dietary_restrictions
FROM schedules s
JOIN project_crew pc ON s.crew_id = pc.id
JOIN projects p ON s.project_id = p.id
GROUP BY s.project_id, p.name, s.shoot_date
ORDER BY s.shoot_date;

-- Sample Data (for testing)

-- Insert sample project
INSERT INTO projects (name, project_code, start_date, end_date, status) VALUES
('Summer Commercial 2024', 'SUM-A1B2', '2024-07-15', '2024-07-20', 'active');

-- Get the project ID
DO $$
DECLARE
    project_id_var INTEGER;
BEGIN
    SELECT id INTO project_id_var FROM projects WHERE project_code = 'SUM-A1B2';
    
    -- Insert sample crew
    INSERT INTO project_crew (project_id, name, phone, email, department, emergency_contact_name, emergency_contact_phone, dietary_restrictions, has_insurance) VALUES
    (project_id_var, 'Sarah Chen', '555-0101', 'sarah@filmcrew.com', 'Camera', 'John Chen', '555-0102', ARRAY['Vegetarian'], true),
    (project_id_var, 'Marcus Rodriguez', '555-0103', 'marcus@filmcrew.com', 'Sound', 'Maria Rodriguez', '555-0104', ARRAY['Gluten-Free'], true),
    (project_id_var, 'Emma Thompson', '555-0105', 'emma@filmcrew.com', 'Art Department', 'David Thompson', '555-0106', ARRAY['Vegan', 'Nut Allergy'], false),
    (project_id_var, 'Jake Williams', '555-0107', 'jake@filmcrew.com', 'Grip', 'Lisa Williams', '555-0108', ARRAY[]::text[], true),
    (project_id_var, 'Maya Patel', '555-0109', 'maya@filmcrew.com', 'Wardrobe', 'Raj Patel', '555-0110', ARRAY['Halal'], true);
    
    -- Schedule some crew
    INSERT INTO schedules (project_id, crew_id, shoot_date) 
    SELECT project_id_var, id, '2024-07-15' 
    FROM project_crew 
    WHERE project_id = project_id_var AND department IN ('Camera', 'Sound', 'Grip');
    
    INSERT INTO schedules (project_id, crew_id, shoot_date) 
    SELECT project_id_var, id, '2024-07-16' 
    FROM project_crew 
    WHERE project_id = project_id_var;
END $$;

-- Grant permissions (adjust for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO filmflow_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO filmflow_user;

-- Comments for documentation
COMMENT ON TABLE projects IS 'Film/video production projects with unique invite codes';
COMMENT ON TABLE project_crew IS 'Crew members per project - same person can join multiple projects';
COMMENT ON TABLE schedules IS 'Crew assignments to specific shoot dates';
COMMENT ON TABLE call_sheets IS 'Tracking of generated and sent call sheets';

COMMENT ON COLUMN projects.project_code IS 'Unique code for crew invite links (e.g., SUM-A1B2)';
COMMENT ON COLUMN project_crew.dietary_restrictions IS 'Array of dietary requirements';
COMMENT ON CONSTRAINT project_crew_project_id_email_key ON project_crew IS 'Same email can sign up for different projects';

-- Helpful queries

-- Get all crew for a project grouped by department
/*
SELECT department, 
       json_agg(json_build_object('name', name, 'phone', phone, 'email', email)) as members
FROM project_crew 
WHERE project_id = 1 
GROUP BY department;
*/

-- Get schedule for a specific date
/*
SELECT pc.name, pc.department, pc.phone, pc.dietary_restrictions
FROM schedules s
JOIN project_crew pc ON s.crew_id = pc.id
WHERE s.project_id = 1 AND s.shoot_date = '2024-07-15'
ORDER BY pc.department, pc.name;
*/

-- Get dates a specific crew member is assigned to
/*
SELECT s.shoot_date
FROM schedules s
JOIN project_crew pc ON s.crew_id = pc.id
WHERE pc.email = 'sarah@filmcrew.com' AND s.project_id = 1
ORDER BY s.shoot_date;
*/

-- Check for crew with missing information
/*
SELECT * FROM crew_missing_info WHERE project_id = 1;
*/
