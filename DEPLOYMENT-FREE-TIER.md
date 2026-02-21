# 🚀 FilmFlow Complete Deployment Guide
## Free Tier: Netlify + Supabase + Render + Resend

**Total Cost:** $0/month
**Setup Time:** 30-45 minutes
**Technical Level:** Beginner-friendly with command line basics

---

## 📋 What You'll Need

- [ ] GitHub account (free)
- [ ] Netlify account (free)
- [ ] Supabase account (free)
- [ ] Render account (free)
- [ ] Resend account (free)
- [ ] Your email address for verification

---

## 🗂️ Part 1: Project Setup (5 minutes)

### Step 1: Create GitHub Repository

**Option A: Using GitHub Website (No Code)**

1. Go to https://github.com
2. Click **"+"** → **"New repository"**
3. Name: `filmflow-callsheet`
4. Description: `Automated call sheet system for film productions`
5. Select **"Public"**
6. ✅ Check **"Add a README file"**
7. Click **"Create repository"**

**Option B: Using Command Line**

```bash
# Create project folder
mkdir filmflow-callsheet
cd filmflow-callsheet

# Initialize git
git init

# Create README
echo "# FilmFlow - Automated Call Sheet System" > README.md

# Create repository on GitHub (install GitHub CLI first: https://cli.github.com/)
gh repo create filmflow-callsheet --public --source=. --remote=origin --push
```

---

## 🗄️ Part 2: Database Setup - Supabase (10 minutes)

### Step 1: Create Supabase Account

1. Go to https://supabase.com
2. Click **"Start your project"**
3. Sign up with GitHub (easiest) or email
4. Verify your email

### Step 2: Create New Project

1. Click **"New Project"**
2. **Organization:** Create new or use existing
3. **Project Name:** `filmflow-production`
4. **Database Password:** Generate strong password (SAVE THIS!)
5. **Region:** Choose closest to your users (e.g., US East, EU West)
6. Click **"Create new project"**
7. Wait 2-3 minutes for provisioning ⏳

### Step 3: Set Up Database Schema

1. In Supabase dashboard, click **"SQL Editor"** (left sidebar)
2. Click **"New query"**
3. Copy the entire contents of `schema-v2.sql` (I'll provide this)
4. Paste into the SQL editor
5. Click **"Run"** (or press Ctrl+Enter)
6. You should see: ✅ "Success. No rows returned"

### Step 4: Get Database Connection String

1. Click **"Settings"** (⚙️ icon in sidebar)
2. Click **"Database"**
3. Scroll to **"Connection string"**
4. Select **"URI"** tab
5. Copy the connection string (looks like):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.abc123xyz.supabase.co:5432/postgres
   ```
6. **IMPORTANT:** Replace `[YOUR-PASSWORD]` with the password you created
7. Save this - you'll need it later!

### Step 5: Enable Row Level Security (Optional but Recommended)

Since we have no auth, we'll disable RLS for now:

1. Go to **SQL Editor**
2. Run this query:
   ```sql
   -- Disable RLS for all tables (since we have no auth)
   ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
   ALTER TABLE project_crew DISABLE ROW LEVEL SECURITY;
   ALTER TABLE schedules DISABLE ROW LEVEL SECURITY;
   ALTER TABLE call_sheets DISABLE ROW LEVEL SECURITY;
   ```

**✅ Supabase Setup Complete!**

---

## 📧 Part 3: Email Setup - Resend (5 minutes)

### Step 1: Create Resend Account

1. Go to https://resend.com
2. Click **"Start Building"** or **"Sign Up"**
3. Sign up with email
4. Verify your email

### Step 2: Get API Key

1. In Resend dashboard, click **"API Keys"** (left sidebar)
2. Click **"Create API Key"**
3. **Name:** `FilmFlow Production`
4. **Permission:** Full Access
5. Click **"Add"**
6. **COPY THE API KEY** (shown once - starts with `re_...`)
7. Save it securely - you won't see it again!

### Step 3: Verify Sender Email

**Option A: Use Resend's Test Domain (Quick)**
- You can send from `onboarding@resend.dev`
- Limited to 100 emails/day
- Good for testing

**Option B: Add Your Own Domain (Recommended)**

1. Click **"Domains"** in sidebar
2. Click **"Add Domain"**
3. Enter your domain (e.g., `filmflow.com`)
4. Follow DNS setup instructions
5. Wait for verification (can take up to 48 hours)

**For now, use Option A to get started quickly!**

**✅ Resend Setup Complete!**

---

## 🖥️ Part 4: Backend Setup - Render (10 minutes)

### Step 1: Prepare Backend Code

1. Download all files I provided
2. Create this folder structure:
   ```
   filmflow-callsheet/
   ├── backend/
   │   ├── server.js          (rename server-v2.js to server.js)
   │   ├── package.json
   │   └── .env.example
   └── frontend/
       └── index.html         (rename filmflow-v2.html to index.html)
   ```

3. Create `backend/package.json`:
   ```json
   {
     "name": "filmflow-backend",
     "version": "1.0.0",
     "description": "FilmFlow backend API",
     "main": "server.js",
     "scripts": {
       "start": "node server.js"
     },
     "engines": {
       "node": "18.x"
     },
     "dependencies": {
       "express": "^4.18.2",
       "pg": "^8.11.3",
       "cors": "^2.8.5",
       "dotenv": "^16.3.1",
       "resend": "^3.0.0",
       "jspdf": "^2.5.1",
       "jspdf-autotable": "^3.8.0"
     }
   }
   ```

### Step 2: Update Server Code for Resend

Open `backend/server.js` and replace the email transport setup:

**Find this:**
```javascript
const transporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
        user: process.env.SENDGRID_USER,
        pass: process.env.SENDGRID_API_KEY
    }
});
```

**Replace with:**
```javascript
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper function to send emails
async function sendEmail({ to, subject, html, attachments = [] }) {
    try {
        const emailData = {
            from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html
        };

        if (attachments.length > 0) {
            emailData.attachments = attachments;
        }

        const data = await resend.emails.send(emailData);
        return data;
    } catch (error) {
        console.error('Email error:', error);
        throw error;
    }
}
```

**Then replace all `transporter.sendMail` calls with `sendEmail`:**

Find:
```javascript
await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: '...',
    html: '...'
});
```

Replace with:
```javascript
await sendEmail({
    to: email,
    subject: '...',
    html: '...'
});
```

### Step 3: Push to GitHub

```bash
# Add all files
git add .

# Commit
git commit -m "Initial FilmFlow setup"

# Push to GitHub
git push origin main
```

### Step 4: Create Render Account

1. Go to https://render.com
2. Click **"Get Started"**
3. Sign up with GitHub (easiest - auto-connects repos)
4. Authorize Render to access your GitHub

### Step 5: Deploy Backend on Render

1. Click **"New +"** → **"Web Service"**
2. Connect to `filmflow-callsheet` repository
3. **Name:** `filmflow-backend`
4. **Region:** Same as Supabase (e.g., Oregon for US West)
5. **Branch:** `main`
6. **Root Directory:** `backend`
7. **Runtime:** Node
8. **Build Command:** `npm install`
9. **Start Command:** `npm start`
10. **Instance Type:** **Free** ⚠️ (will sleep after 15 min inactivity)

### Step 6: Add Environment Variables

Still on Render setup page, scroll to **"Environment Variables"**:

Click **"Add Environment Variable"** for each:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | (Your Supabase connection string) |
| `RESEND_API_KEY` | (Your Resend API key starting with `re_`) |
| `EMAIL_FROM` | `onboarding@resend.dev` (or your verified domain) |
| `FRONTEND_URL` | (We'll add this after deploying frontend) |

11. Click **"Create Web Service"**
12. Wait for deployment (3-5 minutes) ⏳
13. Once deployed, copy your backend URL:
    ```
    https://filmflow-backend.onrender.com
    ```

**✅ Backend Deployed on Render!**

---

## 🌐 Part 5: Frontend Setup - Netlify (10 minutes)

### Step 1: Update Frontend API URLs

1. Open `frontend/index.html`
2. **Search for:** `http://localhost:3000`
3. **Replace ALL instances with:** `https://filmflow-backend.onrender.com`
   (your Render backend URL)

**Quick Find & Replace:**
- VSCode: `Ctrl+H` (Windows) / `Cmd+H` (Mac)
- Find: `http://localhost:3000`
- Replace: `https://filmflow-backend.onrender.com`
- Click "Replace All"

### Step 2: Create Netlify Account

1. Go to https://netlify.com
2. Click **"Sign up"**
3. Choose **"Sign up with GitHub"** (easiest)
4. Authorize Netlify

### Step 3: Deploy Frontend

**Method 1: GitHub Auto-Deploy (Recommended)**

1. In Netlify dashboard, click **"Add new site"** → **"Import an existing project"**
2. Choose **"Deploy with GitHub"**
3. Authorize Netlify (if not already)
4. Select **"filmflow-callsheet"** repository
5. **Branch to deploy:** `main`
6. **Base directory:** `frontend`
7. **Build command:** (leave empty)
8. **Publish directory:** `.` (just a dot)
9. Click **"Deploy site"**

Wait 1-2 minutes for deployment ⏳

**Method 2: Drag & Drop (No Code)**

1. Click **"Add new site"** → **"Deploy manually"**
2. Drag the `frontend` folder onto the upload area
3. Wait for deployment

### Step 4: Get Your Frontend URL

1. Once deployed, Netlify assigns a URL like:
   ```
   https://random-name-123456.netlify.app
   ```
2. **Copy this URL**

### Step 5: Update Backend CORS

Go back to **Render dashboard**:

1. Open your `filmflow-backend` service
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Add:
   - **Key:** `FRONTEND_URL`
   - **Value:** `https://your-netlify-url.netlify.app`
5. Click **"Save Changes"**
6. Render will auto-redeploy (2-3 minutes)

**✅ Frontend Deployed on Netlify!**

---

## ✅ Part 6: Final Testing (5 minutes)

### Test Checklist:

1. **Open your Netlify URL** in browser
   ```
   https://your-app.netlify.app
   ```

2. **Create a Test Project:**
   - Click "Projects" tab
   - Fill in:
     - Name: "Test Production"
     - Start Date: Tomorrow
     - End Date: 7 days from now
   - Click "Create Project & Generate Link"
   - ✅ You should see project created with invite link

3. **Test Crew Signup:**
   - Copy the invite link
   - Open in new tab (or incognito)
   - Fill out the form with test data
   - Submit
   - ✅ You should see "Thank you" message

4. **Verify in Admin:**
   - Go back to admin tab
   - Click "Crew Signups"
   - Select your project
   - ✅ You should see the crew member you just added

5. **Test Scheduling:**
   - Go to "Schedule" tab
   - Click "Assign Department" on any date
   - Select the department your test crew belongs to
   - ✅ Crew should appear in that date

6. **Test Call Sheet (Email):**
   - Go to "Call Sheets" tab
   - Select the date you scheduled
   - Click "📧 Email Call Sheet to Crew"
   - ✅ Check the email inbox you used for test signup

---

## 🎨 Part 7: Customization (Optional)

### Change Site Name on Netlify

1. Go to Netlify dashboard
2. Click your site
3. Click **"Site settings"**
4. Under "Site details" → **"Change site name"**
5. Enter: `filmflow-yourname`
6. New URL: `https://filmflow-yourname.netlify.app`

### Add Custom Domain (Optional)

If you own a domain:

1. In Netlify → **"Domain settings"**
2. Click **"Add custom domain"**
3. Enter your domain (e.g., `filmflow.com`)
4. Follow DNS setup instructions
5. Netlify provides free SSL automatically!

---

## 🐛 Troubleshooting

### Issue: "Failed to fetch" or "Network Error"

**Cause:** Backend is sleeping (Render free tier)

**Solution:** 
- Wait 30 seconds for backend to wake up
- Refresh the page
- First request after sleep takes ~30 seconds

**Prevention:** 
- Use UptimeRobot (free) to ping backend every 5 minutes
- Setup: https://uptimerobot.com
  1. Add Monitor
  2. Type: HTTP(s)
  3. URL: `https://filmflow-backend.onrender.com/health`
  4. Interval: 5 minutes

### Issue: Emails not sending

**Possible causes:**

1. **Resend API key incorrect**
   - Check Render environment variables
   - Key should start with `re_`

2. **Email address not verified**
   - If using custom domain, check DNS records
   - Or use `onboarding@resend.dev` for testing

3. **Daily limit reached**
   - Resend free: 3,000/month, 100/day
   - Check Resend dashboard for usage

### Issue: Database connection failed

**Check:**

1. **Connection string correct?**
   - Should have your password, not `[YOUR-PASSWORD]`
   - Format: `postgresql://postgres:password@db.xxx.supabase.co:5432/postgres`

2. **Supabase project active?**
   - Free tier projects pause after 7 days of inactivity
   - Click "Resume" in Supabase dashboard

### Issue: CORS errors

**Solution:**

1. Make sure `FRONTEND_URL` in Render matches your Netlify URL exactly
2. Include `https://` in the URL
3. No trailing slash
4. Redeploy backend after changing

---

## 📊 Free Tier Limits Summary

| Service | Limit | Notes |
|---------|-------|-------|
| **Netlify** | 100GB bandwidth/month | More than enough for small productions |
| **Supabase** | 500MB database | ~50,000 crew signups |
| **Render** | 750 hours/month | Sleeps after 15min inactivity |
| **Resend** | 3,000 emails/month | 100/day limit |

**For 99% of small-medium productions, you'll never hit these limits!**

---

## 🔄 Updating Your App

When you make changes:

### Frontend Changes:
```bash
# Edit frontend/index.html
git add frontend/
git commit -m "Update frontend"
git push origin main

# Netlify auto-deploys in 1-2 minutes
```

### Backend Changes:
```bash
# Edit backend/server.js
git add backend/
git commit -m "Update backend"
git push origin main

# Render auto-deploys in 3-5 minutes
```

---

## 🎯 Next Steps

Now that you're deployed:

1. ✅ Share your Netlify URL with your team
2. ✅ Create your first real project
3. ✅ Test with actual crew members
4. ✅ Monitor Resend dashboard for email delivery
5. ✅ Check Supabase dashboard for database usage

---

## 💰 When to Upgrade

You might want to upgrade if:

- **Backend sleeping annoying?** → Railway $5/month (no sleeping)
- **Need more emails?** → Resend Pro $20/month (50,000 emails)
- **More database space?** → Supabase Pro $25/month (8GB + backups)
- **Custom domain?** → Already free on Netlify!

---

## 📞 Getting Help

- **Netlify Docs:** https://docs.netlify.com
- **Supabase Docs:** https://supabase.com/docs
- **Render Docs:** https://render.com/docs
- **Resend Docs:** https://resend.com/docs

---

**🎬 You're ready to revolutionize your call sheet workflow!**

Deployment complete! Your URL:
```
https://your-app-name.netlify.app
```

Share this with your crew and start saving 8+ hours per production! 🚀
