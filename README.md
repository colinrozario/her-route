# 🛡️ Her Route

## Overview

**Her Route** is a community-driven women's safety platform that empowers users to share location-based safety insights in real-time. The app helps women make informed decisions about their daily movements by providing crowd-sourced safety ratings and incident reports for public spaces.

**[🚀 Live App](https://her-route-590a0.web.app)** — Try it now!

---

## Problem Statement

Women often navigate public spaces with safety concerns. Traditional resources lack real-time, location-specific insights. Her Route bridges this gap by creating a community-driven safety network where experiences are shared instantly, helping women identify and avoid risky areas.

---

## How It Works

### 1. **Share Your Experience**
- Rate any public location (shops, malls, parks, streets, cafés) across 8 safety dimensions
- Report specific incidents with detailed context (time, who you were with, date)
- Add written reviews to help the community
- All data is stored securely and shared in real-time with other users

### 2. **Browse & Explore Safely**
- Interactive map shows locations color-coded by overall safety level (🟢 Green · 🟠 Amber · 🔴 Red)
- Explore list with powerful search and category filters
- Sort by safest locations first
- View detailed location profiles with all ratings, incidents, and community reviews

### 3. **Make Informed Decisions**
- See per-location safety scores across 8 dimensions: Lighting, Visibility, Crowd, Security Presence, Transport Access, Cleanliness, Daytime Comfort, and Nighttime Comfort
- Check recent incident alerts to stay aware
- Review confidence levels (Low/Medium/High) based on data volume
- Use "Find My Location" to get safety ratings for your current position

### 4. **Real-Time Collaboration**
- Updates sync instantly across all browser tabs
- See community contributions as they happen
- Confidence in data grows with more community input

---

## Key Features

✅ **Interactive Map** — Color-coded safety visualization with Leaflet + OpenStreetMap  
✅ **Smart Search & Filters** — Find locations by type, area, or search term  
✅ **8-Dimension Ratings** — Comprehensive 1-5 scale safety assessment  
✅ **Incident Reporting** — Log specific safety concerns with context  
✅ **Community Reviews** — Read and share detailed experiences  
✅ **Real-Time Updates** — See community contributions instantly  
✅ **Location Snapshots** — Detailed per-place safety intelligence  
✅ **Confidence Indicators** — Data quality based on report volume  
✅ **Mobile-First Design** — Fully responsive, works on all devices  
✅ **Zero Friction Setup** — No build step, no API keys, no billing  

---

## Technology Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Mapping:** Leaflet + OpenStreetMap
- **Storage:** Firebase (Firestore & Hosting)
- **Features:** Progressive Web App ready, real-time sync, local-first design
- **No External Dependencies:** All features work with minimal dependencies

---

## Getting Started

### Live Version
Visit **[https://her-route-590a0.web.app](https://her-route-590a0.web.app)** — fully functional, no installation required.

### Local Development

#### Option 1: Direct Browser
```bash
# Simply open in your browser
open index.html
```
*(Note: "Find My Location" only works on localhost or HTTPS)*

#### Option 2: Local Server
```bash
npx serve -l 5173
```

#### Try Real-Time Features
1. Open the app in two browser tabs
2. Submit a rating in one tab
3. Watch the other tab update instantly

---

## Project Structure

```
her-route/
├─ index.html           # Main app markup & UI screens
├─ css/
│  └─ styles.css        # Mobile-first responsive styling
├─ js/
│  ├─ app.js            # Core logic: auth, map, explore, ratings, alerts
│  ├─ data.js           # Seed data, dimensions, incident types
│  ├─ firebase-config.js # Firebase configuration
│  ├─ geo.js            # Geolocation & map utilities
│  ├─ onboarding.js     # User onboarding flow
│  └─ store.js          # Data persistence layer
├─ assets/             # Images & static resources
├─ firebase.json       # Firebase deployment config
└─ README.md          # This file
```

---

## Customization

### Change the Default City
Seed data is pre-configured for Bengaluru. To customize:

1. Edit `js/data.js`
2. Update `MAP_CENTER` and `MAP_ZOOM` for your location
3. Modify `SEED_DEFS` with your local places (name, type, latitude, longitude, area)
4. Use **You → Reset demo data** in the app to reload with new data

---

## Next Steps: Production Backend

Currently, data is stored in browser `localStorage`. To scale for real users across devices:

1. Swap storage functions in `js/app.js` (`loadPlaces` / `savePlaces`)
2. Integrate **Firebase Firestore** real-time listeners
3. The rest of the app already handles data changes reactively — it's a contained change

---

## Vision

Her Route aims to create a safer, more connected community by making safety data accessible and actionable. Every shared experience helps protect someone else's journey.

---

## Questions or Feedback?

Have ideas to improve Her Route? Found a bug? Reach out or contribute to make this safer for everyone.
