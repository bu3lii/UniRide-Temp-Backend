/**
 * Application Configuration
 * Centralizes all environment variables and configuration settings
 */

module.exports = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  apiVersion: process.env.API_VERSION || 'v1',

  // Database
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/uniride',
  mongodbUriTest: process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/uniride_test',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'default_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtCookieExpiresIn: parseInt(process.env.JWT_COOKIE_EXPIRES_IN, 10) || 7,

  // Email
  email: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'UniRide <noreply@uniride.com>'
  },

  // University
  universityEmailDomain: process.env.UNIVERSITY_EMAIL_DOMAIN || 'aubh.edu.bh',

  // Content Moderation (Google Perspective API)
  perspectiveApiKey: process.env.PERSPECTIVE_API_KEY,

  // Two-Factor Authentication
  twoFaAppName: process.env.TWO_FA_APP_NAME || 'UniRide',

  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,

  // OpenStreetMap / OSRM
  osrmServerUrl: process.env.OSRM_SERVER_URL || 'https://router.project-osrm.org',
  nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',

  // Frontend URL
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Socket.IO
  socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:5173',

  // Moderation Thresholds (Perspective API scores 0-1)
  moderation: {
    moderateToxicityThreshold: 0.5,  // Warning + message removal
    highToxicityThreshold: 0.7,       // 1-hour mute
    severeToxicityThreshold: 0.85,    // Account suspension
    muteDurationMs: 60 * 60 * 1000    // 1 hour in milliseconds
  },

  // Bahrain Geographic Bounds (for AUBH area validation)
  geoBounds: {
    minLat: 25.5,
    maxLat: 26.5,
    minLng: 50.3,
    maxLng: 50.8
  }
};
