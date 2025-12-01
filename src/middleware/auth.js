/**
 * Authentication Middleware
 * Handles JWT verification and user authorization
 */

const jwt = require('jsonwebtoken');
const { User } = require('../models');
const config = require('../config');
const AppError = require('../utils/AppError');
const asyncHandler = require('./asyncHandler');

/**
 * Protect routes - require authentication
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // Check for token in cookies
  else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(new AppError('Please log in to access this resource', 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret);

    // Check if user still exists
    const user = await User.findById(decoded.id).select('+twoFactorSecret');
    if (!user) {
      return next(new AppError('The user belonging to this token no longer exists', 401));
    }

    // Check if user is active
    if (!user.isActive) {
      return next(new AppError('Your account has been deactivated', 401));
    }

    // Check account status
    if (user.accountStatus === 'suspended') {
      return next(new AppError('Your account has been suspended. Please contact support.', 403));
    }

    // Auto-unmute if mute has expired
    await user.checkMuteStatus();

    // Grant access
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token. Please log in again', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Your token has expired. Please log in again', 401));
    }
    return next(error);
  }
});

/**
 * Restrict to certain roles
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

/**
 * Require email verification
 */
const requireEmailVerification = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return next(new AppError('Please verify your email address to access this feature', 403));
  }
  next();
};

/**
 * Require driver status
 */
const requireDriver = (req, res, next) => {
  if (!req.user.isDriver) {
    return next(new AppError('You must be a registered driver to perform this action', 403));
  }
  if (!req.user.carDetails?.licensePlate) {
    return next(new AppError('Please complete your driver profile with car details', 403));
  }
  next();
};

/**
 * Check if user can send messages (not muted)
 */
const checkMessagingPermission = asyncHandler(async (req, res, next) => {
  // Refresh user status
  await req.user.checkMuteStatus();

  if (req.user.accountStatus === 'muted') {
    const remainingMinutes = Math.ceil((req.user.mutedUntil - new Date()) / 60000);
    return next(new AppError(
      `Your messaging privileges are temporarily suspended. Please try again in ${remainingMinutes} minutes.`,
      403
    ));
  }

  if (req.user.accountStatus === 'suspended') {
    return next(new AppError(
      'Your account is suspended. Please contact support.',
      403
    ));
  }

  next();
});

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      req.user = await User.findById(decoded.id);
    } catch (error) {
      // Token invalid, but that's okay for optional auth
      req.user = null;
    }
  }

  next();
});

/**
 * Rate limiting per user
 */
const userRateLimit = (maxRequests, windowMs) => {
  const requests = new Map();

  return (req, res, next) => {
    if (!req.user) return next();

    const userId = req.user._id.toString();
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or create user's request history
    if (!requests.has(userId)) {
      requests.set(userId, []);
    }

    // Filter out old requests
    const userRequests = requests.get(userId).filter(time => time > windowStart);
    
    if (userRequests.length >= maxRequests) {
      return next(new AppError('Too many requests. Please try again later.', 429));
    }

    userRequests.push(now);
    requests.set(userId, userRequests);

    next();
  };
};

module.exports = {
  protect,
  restrictTo,
  requireEmailVerification,
  requireDriver,
  checkMessagingPermission,
  optionalAuth,
  userRateLimit
};
