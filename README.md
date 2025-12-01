# UniRide Backend API

University Carpooling Application for the American University of Bahrain (AUBH)

## Overview

UniRide is a carpooling platform designed exclusively for AUBH students. It connects drivers and riders for shared commutes, helping reduce costs, environmental impact, and parking congestion.

## Features

- **User Authentication**: Secure registration with AUBH email verification, JWT tokens, and optional 2FA
- **Ride Management**: Create, search, book, and manage rides
- **Real-time Updates**: Socket.IO for live notifications and messaging
- **Smart Routing**: OpenStreetMap (OSRM) integration for route calculation
- **Content Moderation**: AI-powered toxicity detection using Google Perspective API
- **Rating System**: Two-way reviews for drivers and riders

## Architecture

```
src/
├── app.js              # Application entry point
├── config/             # Configuration files
├── controllers/        # Request handlers (MVC: Controller)
├── middleware/         # Express middleware
├── models/             # Mongoose schemas (MVC: Model)
├── routes/             # API routes
├── services/           # Business logic services
├── utils/              # Utility functions
└── views/              # Email templates (MVC: View)
```

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT + bcrypt
- **Real-time**: Socket.IO
- **Maps**: OpenStreetMap (Nominatim) + OSRM
- **Email**: Nodemailer
- **Content Moderation**: Google Perspective API

## Prerequisites

- Node.js 18.x or higher
- MongoDB 6.x or higher
- npm or yarn

## Getting Started

### 1. Clone and Install

```bash
cd uniride-backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Required
MONGODB_URI=mongodb://localhost:27017/uniride
JWT_SECRET=your_super_secret_key_here

# Optional but recommended
PERSPECTIVE_API_KEY=your_google_perspective_api_key
EMAIL_HOST=smtp.gmail.com
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
```

### 3. Seed Database (Optional)

```bash
npm run seed
```

This creates test users and sample rides.

### 4. Start Server

```bash
# Development with auto-reload
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3000`

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/verify-email/:token` | Verify email |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| PATCH | `/api/v1/auth/reset-password/:token` | Reset password |
| GET | `/api/v1/auth/me` | Get current user |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/dashboard` | Get user dashboard |
| PATCH | `/api/v1/users/profile` | Update profile |
| POST | `/api/v1/users/become-driver` | Register as driver |
| PATCH | `/api/v1/users/car-details` | Update car details |
| GET | `/api/v1/users/:id` | Get user profile |

### Rides
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/rides` | List available rides |
| POST | `/api/v1/rides` | Create new ride |
| POST | `/api/v1/rides/search` | Advanced search |
| GET | `/api/v1/rides/my-rides` | Get driver's rides |
| GET | `/api/v1/rides/:id` | Get ride details |
| PATCH | `/api/v1/rides/:id` | Update ride |
| DELETE | `/api/v1/rides/:id` | Cancel ride |
| PATCH | `/api/v1/rides/:id/start` | Start ride |
| PATCH | `/api/v1/rides/:id/complete` | Complete ride |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/bookings` | Create booking |
| GET | `/api/v1/bookings` | Get my bookings |
| GET | `/api/v1/bookings/:id` | Get booking details |
| PATCH | `/api/v1/bookings/:id/cancel` | Cancel booking |
| GET | `/api/v1/bookings/ride/:rideId` | Get ride's bookings |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/messages` | Send message |
| GET | `/api/v1/messages/conversations` | List conversations |
| GET | `/api/v1/messages/conversations/:id` | Get conversation messages |
| GET | `/api/v1/messages/unread` | Get unread count |

### Reviews
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/reviews` | Create review |
| GET | `/api/v1/reviews/user/:userId` | Get user's reviews |
| GET | `/api/v1/reviews/me` | Get my reviews |

### Location (OSM)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/location/geocode` | Address to coordinates |
| POST | `/api/v1/location/reverse-geocode` | Coordinates to address |
| GET | `/api/v1/location/search` | Search places |
| POST | `/api/v1/location/route` | Calculate route |
| POST | `/api/v1/location/eta` | Get estimated arrival |

## Content Moderation

Messages are analyzed using Google's Perspective API:

| Toxicity Score | Action |
|----------------|--------|
| 0.5 - 0.7 | Warning + message removed |
| 0.7 - 0.85 | 1-hour messaging mute |
| 0.85+ | Account suspension |

## WebSocket Events

### Client → Server
- `join:ride` - Join ride room
- `join:conversation` - Join conversation
- `typing:start` / `typing:stop` - Typing indicators
- `location:update` - Driver location updates

### Server → Client
- `notification` - New notification
- `message:new` - New message
- `booking:new` - New booking
- `ride:updated` - Ride updates
- `ride:cancelled` - Ride cancelled

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## Test Accounts

After running `npm run seed`:

| Email | Password | Role |
|-------|----------|------|
| ahmed.khalifa@aubh.edu.bh | Password123! | Driver |
| fatima.hassan@aubh.edu.bh | Password123! | Driver |
| mohammed.yusuf@aubh.edu.bh | Password123! | Rider |
| sara.ahmed@aubh.edu.bh | Password123! | Rider |

## 🗺 OpenStreetMap Integration

This project uses free, open-source mapping services:

- **Nominatim**: Geocoding and place search
- **OSRM**: Route calculation and navigation

No API keys required! However, please respect the usage policies:
- Nominatim: Max 1 request/second
- OSRM: For demo purposes; consider self-hosting for production

Built with ❤️ for AUBH Students
