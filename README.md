# PSWC Capacity Dashboard

A real-time capacity management system for Puget Sound WildCare (PSWC) that automatically tracks wildlife patient intake, capacity, and status by integrating with the Wildlife Rehabilitation MD (WRMD) system.

## Architecture

The system consists of two main components:

### 1. **Frontend Dashboard** (`pswc-capacity-dashboard/`)
- **Tech Stack**: Next.js, TypeScript, Firebase Client SDK
- **Deployment**: Vercel
- **Purpose**: Real-time dashboard for viewing capacity, patient status, and system messages

### 2. **Data Scraper** (`wrmd-scraper/`)
- **Tech Stack**: Python, Selenium WebDriver, Firebase Admin SDK
- **Deployment**: Google Cloud VM
- **Purpose**: Automated data collection from WRMD system and Firebase updates

## Features

- **Real-time Capacity Tracking**: Monitor current capacity vs. limits by species and age
- **Patient Management**: Track patients in care, discharged patients, and failed imports
- **Automated Data Sync**: Scheduled scraping from WRMD system
- **Message Board**: System logs and failed patient notifications
- **Authentication**: Secure login system with Firebase Auth


## Database Schema

### Firestore Collections:

- **`species`**: Species definitions with capacity limits
- **`patients_in_care`**: Current patients being treated
- **`other_patients`**: Patients not tracked in capacity
- **`failed_patients`**: Patients with import/processing issues
- **`message`**: System logs and notifications
- **`system`**: System metadata (last update timestamps)