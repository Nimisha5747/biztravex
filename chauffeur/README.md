# BizTravex Chauffeur Mobile App (Implementation Plan 2)

A mobile-first web application for chauffeur shift management, featuring:
- **MongoDB Credentials Authentication**: Chauffeur credentials (`name` & `number`) validated against MongoDB database `credentials`.
- **Account Registration**: "Create an Account" feature for first-time chauffeurs.
- **Punch In (Pre-Shift Checklist)**: Assigned shift bookings rendered as **Radio Buttons** (single booking selection), followed by pre-shift vehicle checklist.
- **Punch Out (Ride Completion Report)**: Pending ride completion bookings rendered as **Checkboxes**, with dynamic ride completion forms rendered for each checked booking ID.
- **Google Sheets API Integration**: Synchronizes pre-shift & ride reports to `Master sheet-${currentMonth}` and `Form Responses 1`.
- **Mobile-First UX**: Responsive mobile app layout optimized for mobile view dimensions.

---

## 🛠️ Step-by-Step Setup Guide

### 1. MongoDB Database Setup
1. Create a free database cluster on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (or run MongoDB locally).
2. Name your database: `credentials`.
3. Obtain your MongoDB Connection String:
   `mongodb+srv://<username>:<password>@cluster.mongodb.net/credentials?retryWrites=true&w=majority`

---

### 2. Google Sheets API Setup
1. Enable **Google Sheets API** in [Google Cloud Console](https://console.cloud.google.com/).
2. Create a **Service Account** (`biztravex-sa`), assign **Editor** role, and download the JSON key.
3. Open your Google Sheet containing `Master sheet-${currentMonth}` (e.g. `Master sheet-July`, `Master sheet-May`) and `Form Responses 1`.
4. Share the spreadsheet with the Service Account email address as **Editor**.

---

### 3. Local Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Populate `.env` with your connection keys:
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/credentials?retryWrites=true&w=majority
   SPREADSHEET_ID=your_google_spreadsheet_id_here
   GOOGLE_SERVICE_ACCOUNT_EMAIL=biztravex-sa@your-project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour...Key...\n-----END PRIVATE KEY-----\n"
   SESSION_SECRET=biztravex_super_secret_session_key
   PORT=3000
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start local development server:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in your browser.

---

## 🚀 Deploying to Vercel

1. Push code to your GitHub/GitLab repository.
2. Import project into [Vercel](https://vercel.com).
3. Set the Environment Variables (`MONGODB_URI`, `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SESSION_SECRET`).
4. Click **Deploy**.
