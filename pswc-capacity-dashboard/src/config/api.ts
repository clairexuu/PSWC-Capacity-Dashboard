// API Configuration
// Update this URL after deploying to Cloud Run

export const API_CONFIG = {
  // Cloud Run service URL - deployed and ready to use
  WRMD_SCRAPER_URL: process.env.NEXT_PUBLIC_WRMD_SCRAPER_URL || 
                     'https://wrmd-scraper-zmlftg2uka-uc.a.run.app',
  
  // For local development, use:
  // WRMD_SCRAPER_URL: 'http://localhost:8080',
};