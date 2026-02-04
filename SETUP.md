# FilmFlow V2 - Quick Setup Guide

## 🎬 What Changed in V2

This version implements **project-specific crew signups** with invite links. Here's how it works:

### Admin Workflow:

1. **Create Project** → Get unique invite link (e.g., `filmflow.com?project=SUM-A1B2`)
2. **Share Link** → Crew signs up through that link
3. **View Signups** → See all crew who signed up for that project
4. **Assign by Department** → Click "Assign Department" to add entire departments to shoot days
5. **Send Call Sheets** → Email call sheets to assigned crew

### Crew Workflow:

1. **Click Invite Link** → See project name and dates
2. **Fill Form** → Submit profile (links to that project)
3. **Get Confirmation** → See "Thank you" + assigned dates
4. **Receive Call Sheets** → Get emails when scheduled

### Key Features:

- ✅ Same email can sign up for multiple projects
- ✅ Crew profiles are project-specific (not global)
- ✅ "Assign Department" button adds all crew from that department
- ✅ Individual crew can still be removed after bulk assignment
- ✅ Admin can edit project dates (assignments stay intact)
- ✅ Call sheets only sent when admin clicks "Send"

---

## 🚀 Quick Start (5 Minutes)

### Option 1: Test Locally (No Backend)

1. **Download `index.html`**
2. **Open in browser** (works offline with mock data)
3. **Test the flows:**
   - Create a project in admin view
   - Copy the invite link from the project card
   - Paste in new browser tab (adds `?project=CODE` to URL)
   - Fill out crew signup form
   - Return to admin → view signups → schedule → send call sheets

### Option 2: Deploy with Backend

**Requirements:**

- Node.js 18+
- PostgreSQL 14+
- SendGrid account (for emails)

**Quick Deploy:**

```bash
# 1. Clone/Download files
# filmflow-v2.html, server-v2.js, schema-v2.sql, package.json, .env.example

# 2. Install dependencies
npm install

# 3. Set up database
createdb filmflow_v2
psql filmflow_v2 < schema-v2.sql

# 4. Configure environment
cp .env.example .env
# Edit .env with your credentials:
# - DATABASE_URL
# - SENDGRID_API_KEY
# - FRONTEND_URL (where HTML is hosted)

# 5. Start backend
npm start
# Server runs on http://localhost:3000

# 6. Serve frontend
# Option A: Static hosting (Netlify, Vercel, etc.)
# Option B: Local server
python3 -m http.server 3001
# or
npx http-server -p 3001

# 7. Update API URLs in filmflow-v2.html
# Find all: http://localhost:3000
# Replace with: https://your-backend-url.com
```

---

## 📋 How to Use

### Creating a Project

1. Go to **Projects** tab
2. Enter:
   - Project Name (e.g., "Summer Commercial 2024")
   - Start Date
   - End Date
3. Click **Create Project & Generate Link**
4. **Copy the invite link** from the project card
5. Share via WhatsApp, Slack, email, etc.

**Example Invite Link:**

```
https://filmflow.com/index.html?project=SUM-A1B2
```

### Editing Project Dates

1. Go to **Projects** tab
2. Find your project
3. Click **Edit Dates**
4. Choose new start/end dates
5. Click **Update Dates**

**Note:** Existing crew assignments stay on their dates (if those dates still exist within the new range)

### Viewing Crew Signups

1. Go to **Crew Signups** tab
2. Select project from dropdown (or click from dashboard)
3. See crew grouped by department
4. Check completion rates and warnings

### Scheduling by Department

1. Go to **Schedule** tab
2. Select your project
3. See calendar with all shoot dates
4. For each date, click **Assign Department**
5. Click on a department to add ALL crew from that department
6. To remove individual crew: Click the **×** button next to their name

**Example:**

- Click "Assign Department" for July 15
- Click "Camera" → Adds all 3 camera crew
- Click "Sound" → Adds all 2 sound crew
- Remove one person: Click × next to their name

### Sending Call Sheets

1. Go to **Call Sheets** tab
2. Select shoot date from dropdown
3. See list of assigned crew
4. Click **📧 Email Call Sheet to Crew**
5. All assigned crew receive professional PDF call sheets via email

**Call Sheet Includes:**

- Project name and date
- Call time and location
- Crew list by department
- Dietary requirements for catering
- Contact information

---

## 🗄️ Database Schema

The new schema is **project-centric**:

```
projects
├── id (primary key)
├── name
├── project_code (unique invite code)
├── start_date
└── end_date

project_crew (crew per project)
├── id (primary key)
├── project_id (foreign key)
├── name, phone, email
├── department
├── emergency_contact_name, emergency_contact_phone
├── dietary_restrictions (array)
└── UNIQUE(project_id, email) -- same email can join different projects

schedules (crew → date assignments)
├── project_id
├── crew_id
├── shoot_date
└── UNIQUE(project_id, crew_id, shoot_date)

call_sheets (tracking sent call sheets)
├── project_id
├── shoot_date
├── emailed_at
└── crew_count
```

---

## 🔗 API Endpoints (Backend)

### Projects

- `POST /api/projects` - Create new project
- `GET /api/projects` - Get all projects
- `GET /api/projects/code/:code` - Get project by code (public)
- `PUT /api/projects/:id/dates` - Update project dates

### Crew Signups

- `POST /api/projects/:projectCode/crew` - Crew signup (public)
- `GET /api/projects/:id/crew` - Get project crew
- `GET /api/projects/:id/crew/by-department` - Get crew grouped by dept

### Scheduling

- `POST /api/projects/:id/schedule/assign-department` - Assign department to date
- `GET /api/projects/:id/schedule` - Get project schedule
- `DELETE /api/projects/:projectId/schedule/:crewId/:date` - Remove crew from date

### Call Sheets

- `POST /api/projects/:id/callsheet/send` - Generate & email call sheet
- `GET /api/projects/:id/callsheets` - Get call sheet history

---

## 🎨 Customization

### Change Departments

Edit the `DEPARTMENTS` array in `filmflow-v2.html`:

```javascript
const DEPARTMENTS = [
  "Camera",
  "Sound",
  "Grip",
  "Electric",
  "Art Department",
  "Wardrobe",
  "Hair & Makeup",
  "Your Custom Department", // Add here
];
```

### Change Dietary Options

Edit the `DIETARY_OPTIONS` array:

```javascript
const DIETARY_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten-Free",
  "Your Custom Option", // Add here
];
```

### Customize Call Sheet Template

In `server-v2.js`, find the `POST /api/projects/:id/callsheet/send` endpoint and modify the PDF generation code:

```javascript
// Add custom sections
doc.text("SAFETY REMINDERS", 20, yPos);
// ... your content
```

---

## 🐛 Troubleshooting

### "Project not found" when clicking invite link

**Problem:** URL doesn't have `?project=CODE` parameter

**Solution:**

- Make sure link format is: `https://your-site.com?project=ABC-1234`
- Check project code is correct (shown in Projects tab)

### Call sheet emails not sending

**Problem:** SendGrid not configured

**Solution:**

1. Sign up at sendgrid.com
2. Get API key
3. Add to `.env`: `SENDGRID_API_KEY=SG.xxxxx`
4. Verify sender email in SendGrid dashboard

### "Assign Department" shows no departments

**Problem:** No crew has signed up yet

**Solution:**

- Share invite link and wait for signups
- Or test by manually filling the signup form

### Dates don't appear after editing

**Problem:** Browser cached old project data

**Solution:**

- Refresh the page (Ctrl+Shift+R / Cmd+Shift+R)
- Or clear browser cache

---

## 📊 Best Practices

### For ADs:

1. **Create project early** - Get invite link ready before pre-production
2. **Share link widely** - WhatsApp groups, email blasts, Slack channels
3. **Monitor signup dashboard** - Check completion rates daily
4. **Schedule by department** - Faster than individual assignments
5. **Send call sheets 24hrs ahead** - Give crew time to prepare

### For Production Coordinators:

1. **Track missing info** - Follow up with crew who haven't provided emergency contacts
2. **Group departments** - Schedule all art dept together, all camera together, etc.
3. **Export for insurance** - Pull crew lists with insurance status
4. **Archive projects** - Keep old projects for future reference

### For Crew:

1. **Save the invite link** - You might need it later
2. **Fill everything out** - Complete profiles = no last-minute phone calls
3. **Update dietary info** - Helps catering plan properly
4. **Check email regularly** - Call sheets sent via email

---

## 🚢 Deployment Checklist

Before going live:

- [ ] Database created and migrated
- [ ] Environment variables configured
- [ ] SendGrid account verified
- [ ] Frontend deployed to static hosting
- [ ] Backend deployed (Heroku/Railway/AWS)
- [ ] API endpoints updated in frontend
- [ ] Test project created
- [ ] Test signup completed
- [ ] Test schedule created
- [ ] Test call sheet sent
- [ ] HTTPS enabled (for production)
- [ ] Backup system configured

---

## 🎯 Success Metrics

After deploying, track:

1. **Signup completion rate** - Target: 95%+ within 48 hours
2. **Time to schedule** - Should drop from 8 hours → 15 minutes
3. **Missing info rate** - Track % of crew without emergency contacts
4. **Call sheet delivery** - Monitor email open rates
5. **AD satisfaction** - Survey ADs on time saved

---

## 💬 Support

Need help?

- Check the main README.md for detailed docs
- Review DEPLOYMENT.md for hosting options
- Test locally first before deploying
- Keep sample data for testing

---

**Ready to revolutionize your call sheet workflow! 🎬**
