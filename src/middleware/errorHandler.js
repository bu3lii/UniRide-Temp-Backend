/**
 * Global Error Handler Middleware
 * Handles all errors in a consistent format
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Handle specific error types
 */
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return { statusCode: 400, message };
};

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const message = `Duplicate field value: ${field}. Please use another value.`;
  return { statusCode: 400, message };
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Validation error: ${errors.join('. ')}`;
  return { statusCode: 400, message };
};

const handleJWTError = () => ({
  statusCode: 401,
  message: 'Invalid token. Please log in again.'
});

const handleJWTExpiredError = () => ({
  statusCode: 401,
  message: 'Your token has expired. Please log in again.'
});

/**
 * Send error response for development
 */
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    stack: err.stack
  });
};

/**
 * Send error response for production
 */
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message
    });
  } else {
    // Programming or other unknown error: don't leak details
    logger.error('ERROR 💥:', err);
    
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again later.'
    });
  }
};

/**
 * Main error handler
 */
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log error
  if (err.statusCode >= 500) {
    logger.error(`${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
    logger.error(err.stack);
  } else {
    logger.warn(`${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method}`);
  }

  if (config.nodeEnv === 'development') {
    sendErrorDev(err, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    // Handle specific MongoDB/Mongoose errors
    if (err.name === 'CastError') {
      const { statusCode, message } = handleCastErrorDB(err);
      error.statusCode = statusCode;
      error.message = message;
      error.isOperational = true;
    }

    if (err.code === 11000) {
      const { statusCode, message } = handleDuplicateFieldsDB(err);
      error.statusCode = statusCode;
      error.message = message;
      error.isOperational = true;
    }

    if (err.name === 'ValidationError') {
      const { statusCode, message } = handleValidationErrorDB(err);
      error.statusCode = statusCode;
      error.message = message;
      error.isOperational = true;
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
      const { statusCode, message } = handleJWTError();
      error.statusCode = statusCode;
      error.message = message;
      error.isOperational = true;
    }

    if (err.name === 'TokenExpiredError') {
      const { statusCode, message } = handleJWTExpiredError();
      error.statusCode = statusCode;
      error.message = message;
      error.isOperational = true;
    }

    sendErrorProd(error, res);
  }
};

module.exports = errorHandler;
