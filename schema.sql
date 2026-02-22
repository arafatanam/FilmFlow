-- FilmFlow Complete Database Schema
-- PostgreSQL 14+

-- Drop existing tables (if any)
DROP TABLE IF EXISTS call_sheets CASCADE;
DROP TABLE IF EXISTS schedule_assignments CASCADE;
DROP TABLE IF EXISTS crew_availability CASCADE;
DROP TABLE IF EXISTS project_crew CASCADE;
DROP TABLE IF EXISTS crew_profiles CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

-- ============================================
-- CORE TABLES
-- ============================================

-- Crew Profiles (Forever storage)
CREATE TABLE crew_profiles (
    id SERIAL PRIMARY KEY,
    
    -- Basic Info
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    department VARCHAR(100) NOT NULL,
    
    -- Emergency Contact
    emergency_name VARCHAR(255),
    emergency_phone VARCHAR(50),
    
    -- Dietary Restrictions (Array)
    dietary_restrictions TEXT[] DEFAULT '{}',
    
    -- Optional Info
    address TEXT,
    union_status VARCHAR(100),
    has_insurance BOOLEAN DEFAULT false,
    insurance_expiry DATE,
    
    -- Certifications (URL to stored file)
    certifications TEXT[] DEFAULT '{}',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Crew can set personal unavailable dates (will be used for conflict detection)
    personal_unavailable_dates DATE[] DEFAULT '{}'
);

-- Create indexes for fast lookup
CREATE INDEX idx_crew_email ON crew_profiles(email);
CREATE INDEX idx_crew_department ON crew_profiles(department);

-- Projects Table
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    project_code VARCHAR(50) UNIQUE NOT NULL,
    
    -- Project Dates
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    -- Location Info (for weather)
    location VARCHAR(255),
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    
    -- Status
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('planning', 'active', 'completed', 'cancelled')),
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_projects_code ON projects(project_code);
CREATE INDEX idx_projects_dates ON projects(start_date, end_date);

-- Project-Specific Crew (Links crew profiles to projects)
CREATE TABLE project_crew (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    crew_id INTEGER REFERENCES crew_profiles(id) ON DELETE CASCADE,
    
    -- Project-specific info (can override general profile)
    project_role VARCHAR(100),
    project_department VARCHAR(100), -- Can be different from main dept
    
    -- Signup status
    form_completed BOOLEAN DEFAULT false,
    signup_date TIMESTAMP DEFAULT NOW(),
    
    -- Track missing info for this project
    missing_emergency BOOLEAN DEFAULT false,
    missing_dietary BOOLEAN DEFAULT false,
    missing_insurance BOOLEAN DEFAULT false,
    
    UNIQUE(project_id, crew_id)
);

-- Crew Availability for Project (which days they can work)
CREATE TABLE crew_availability (
    id SERIAL PRIMARY KEY,
    project_crew_id INTEGER REFERENCES project_crew(id) ON DELETE CASCADE,
    shoot_date DATE NOT NULL,
    is_available BOOLEAN DEFAULT true,
    notes TEXT,
    
    UNIQUE(project_crew_id, shoot_date)
);

-- Schedule Assignments (Final crew assignments)
CREATE TABLE schedule_assignments (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    crew_id INTEGER REFERENCES crew_profiles(id) ON DELETE CASCADE,
    shoot_date DATE NOT NULL,
    
    -- Assignment details
    call_time TIME,
    department VARCHAR(100),
    notes TEXT,
    
    -- Conflict tracking
    conflict_warning BOOLEAN DEFAULT false,
    conflict_type VARCHAR(50), -- 'double_booked', 'unavailable', 'missing_info'
    conflict_resolved BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(project_id, crew_id, shoot_date)
);

-- Call Sheets History
CREATE TABLE call_sheets (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    shoot_date DATE NOT NULL,
    
    -- Call Sheet Details
    call_time TIME,
    location VARCHAR(255),
    scenes TEXT,
    
    -- Weather Data (cached)
    weather_forecast JSONB,
    sunrise_time TIME,
    sunset_time TIME,
    
    -- AD Private Notes (not shown to crew)
    ad_private_notes TEXT,
    
    -- Flags for AD
    ad_flags JSONB DEFAULT '[]',
    
    -- File storage
    pdf_url TEXT,
    
    -- Distribution
    emailed_at TIMESTAMP,
    crew_count INTEGER,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(project_id, shoot_date)
);

-- ============================================
-- VIEWS FOR EASY QUERYING
-- ============================================

-- Project completion status
CREATE VIEW project_completion AS
SELECT 
    p.id,
    p.name,
    p.project_code,
    COUNT(DISTINCT pc.id) as total_crew,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.form_completed = true) as completed_forms,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.form_completed = false) as pending_forms,
    
    -- Count missing info
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.missing_emergency = true) as missing_emergency,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.missing_dietary = true) as missing_dietary,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.missing_insurance = true) as missing_insurance,
    
    -- Schedule stats
    COUNT(DISTINCT sa.shoot_date) as scheduled_days,
    COUNT(DISTINCT sa.id) as total_assignments
FROM projects p
LEFT JOIN project_crew pc ON p.id = pc.project_id
LEFT JOIN schedule_assignments sa ON p.id = sa.project_id
GROUP BY p.id;

-- Conflict detection view
CREATE VIEW conflict_report AS
SELECT 
    sa.id as assignment_id,
    p.id as project_id,
    p.name as project_name,
    sa.shoot_date,
    cp.full_name as crew_name,
    cp.email,
    cp.phone,
    sa.department,
    
    -- Check for double booking
    EXISTS (
        SELECT 1 FROM schedule_assignments sa2
        WHERE sa2.crew_id = sa.crew_id
        AND sa2.shoot_date = sa.shoot_date
        AND sa2.project_id != sa.project_id
    ) as is_double_booked,
    
    -- Check personal unavailability
    (sa.shoot_date = ANY(cp.personal_unavailable_dates)) as is_personal_unavailable,
    
    -- Check missing info
    (cp.emergency_name IS NULL OR cp.emergency_phone IS NULL) as missing_emergency,
    (cp.dietary_restrictions IS NULL OR array_length(cp.dietary_restrictions, 1) = 0) as missing_dietary,
    (cp.has_insurance = false OR cp.insurance_expiry < CURRENT_DATE) as insurance_issue
    
FROM schedule_assignments sa
JOIN crew_profiles cp ON sa.crew_id = cp.id
JOIN projects p ON sa.project_id = p.id;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_crew_profiles_updated_at 
BEFORE UPDATE ON crew_profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at 
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update project_crew missing info flags
CREATE OR REPLACE FUNCTION update_project_crew_missing_flags()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE project_crew
    SET 
        missing_emergency = (NEW.emergency_name IS NULL OR NEW.emergency_phone IS NULL),
        missing_dietary = (NEW.dietary_restrictions IS NULL OR array_length(NEW.dietary_restrictions, 1) = 0),
        missing_insurance = (NEW.has_insurance = false OR NEW.insurance_expiry < CURRENT_DATE)
    WHERE crew_id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_crew_missing_info
AFTER INSERT OR UPDATE ON crew_profiles
FOR EACH ROW
EXECUTE FUNCTION update_project_crew_missing_flags();