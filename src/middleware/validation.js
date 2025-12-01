/**
 * Request Validation Middleware
 * Uses express-validator for input validation
 */

const { validationResult, body, param, query } = require('express-validator');
const config = require('../config');
const AppError = require('../utils/AppError');

/**
 * Handle validation errors
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map(err => err.msg);
    return next(new AppError(messages.join('. '), 400));
  }
  next();
};

/**
 * Auth validation rules
 */
const authValidation = {
  register: [
    body('name')
      .trim()
      .notEmpty().withMessage('Name is required')
      .isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Invalid email format')
      .custom((value) => {
        const domain = value.split('@')[1];
        if (domain !== config.universityEmailDomain) {
          throw new Error(`Only ${config.universityEmailDomain} emails are allowed`);
        }
        return true;
      }),
    body('universityId')
      .trim()
      .notEmpty().withMessage('University ID is required'),
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
    body('phoneNumber')
      .trim()
      .notEmpty().withMessage('Phone number is required')
      .matches(/^\+973\d{8}$/).withMessage('Invalid Bahrain phone number (+973XXXXXXXX)'),
    body('gender')
      .notEmpty().withMessage('Gender is required')
      .isIn(['male', 'female']).withMessage('Gender must be male or female'),
    validate
  ],

  login: [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Invalid email format'),
    body('password')
      .notEmpty().withMessage('Password is required'),
    validate
  ],

  forgotPassword: [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Invalid email format'),
    validate
  ],

  resetPassword: [
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('passwordConfirm')
      .notEmpty().withMessage('Please confirm your password')
      .custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Passwords do not match');
        }
        return true;
      }),
    validate
  ]
};

/**
 * Ride validation rules
 */
const rideValidation = {
  create: [
    body('startLocation.address')
      .trim()
      .notEmpty().withMessage('Start location address is required'),
    body('startLocation.coordinates.lat')
      .isFloat({ min: -90, max: 90 }).withMessage('Invalid start latitude'),
    body('startLocation.coordinates.lng')
      .isFloat({ min: -180, max: 180 }).withMessage('Invalid start longitude'),
    body('destination.address')
      .trim()
      .notEmpty().withMessage('Destination address is required'),
    body('destination.coordinates.lat')
      .isFloat({ min: -90, max: 90 }).withMessage('Invalid destination latitude'),
    body('destination.coordinates.lng')
      .isFloat({ min: -180, max: 180 }).withMessage('Invalid destination longitude'),
    body('departureTime')
      .notEmpty().withMessage('Departure time is required')
      .isISO8601().withMessage('Invalid date format')
      .custom((value) => {
        if (new Date(value) <= new Date()) {
          throw new Error('Departure time must be in the future');
        }
        return true;
      }),
    body('totalSeats')
      .isInt({ min: 1, max: 7 }).withMessage('Total seats must be between 1 and 7'),
    body('pricePerSeat')
      .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('genderPreference')
      .optional()
      .isIn(['any', 'male', 'female']).withMessage('Invalid gender preference'),
    validate
  ],

  update: [
    body('departureTime')
      .optional()
      .isISO8601().withMessage('Invalid date format')
      .custom((value) => {
        if (new Date(value) <= new Date()) {
          throw new Error('Departure time must be in the future');
        }
        return true;
      }),
    body('totalSeats')
      .optional()
      .isInt({ min: 1, max: 7 }).withMessage('Total seats must be between 1 and 7'),
    body('pricePerSeat')
      .optional()
      .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    validate
  ],

  search: [
    query('startLat')
      .optional()
      .isFloat({ min: -90, max: 90 }).withMessage('Invalid start latitude'),
    query('startLng')
      .optional()
      .isFloat({ min: -180, max: 180 }).withMessage('Invalid start longitude'),
    query('destLat')
      .optional()
      .isFloat({ min: -90, max: 90 }).withMessage('Invalid destination latitude'),
    query('destLng')
      .optional()
      .isFloat({ min: -180, max: 180 }).withMessage('Invalid destination longitude'),
    query('date')
      .optional()
      .isISO8601().withMessage('Invalid date format'),
    query('minSeats')
      .optional()
      .isInt({ min: 1 }).withMessage('Minimum seats must be at least 1'),
    query('maxPrice')
      .optional()
      .isFloat({ min: 0 }).withMessage('Max price must be positive'),
    validate
  ]
};

/**
 * Booking validation rules
 */
const bookingValidation = {
  create: [
    body('rideId')
      .notEmpty().withMessage('Ride ID is required')
      .isMongoId().withMessage('Invalid ride ID'),
    body('seatsBooked')
      .optional()
      .isInt({ min: 1, max: 4 }).withMessage('Seats booked must be between 1 and 4'),
    body('pickupLocation.address')
      .optional()
      .trim(),
    body('pickupLocation.coordinates.lat')
      .optional()
      .isFloat({ min: -90, max: 90 }).withMessage('Invalid pickup latitude'),
    body('pickupLocation.coordinates.lng')
      .optional()
      .isFloat({ min: -180, max: 180 }).withMessage('Invalid pickup longitude'),
    validate
  ],

  cancel: [
    body('reason')
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters'),
    validate
  ]
};

/**
 * Review validation rules
 */
const reviewValidation = {
  create: [
    body('bookingId')
      .notEmpty().withMessage('Booking ID is required')
      .isMongoId().withMessage('Invalid booking ID'),
    body('rating')
      .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment')
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
    validate
  ]
};

/**
 * Message validation rules
 */
const messageValidation = {
  send: [
    body('recipientId')
      .notEmpty().withMessage('Recipient ID is required')
      .isMongoId().withMessage('Invalid recipient ID'),
    body('content')
      .trim()
      .notEmpty().withMessage('Message content is required')
      .isLength({ max: 1000 }).withMessage('Message cannot exceed 1000 characters'),
    body('rideId')
      .optional()
      .isMongoId().withMessage('Invalid ride ID'),
    validate
  ]
};

/**
 * User profile validation rules
 */
const userValidation = {
  updateProfile: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
    body('phoneNumber')
      .optional()
      .matches(/^\+973\d{8}$/).withMessage('Invalid Bahrain phone number'),
    validate
  ],

  updateCarDetails: [
    body('model')
      .trim()
      .notEmpty().withMessage('Car model is required'),
    body('color')
      .trim()
      .notEmpty().withMessage('Car color is required'),
    body('licensePlate')
      .trim()
      .notEmpty().withMessage('License plate is required')
      .isLength({ min: 3, max: 10 }).withMessage('Invalid license plate'),
    body('totalSeats')
      .isInt({ min: 1, max: 7 }).withMessage('Seats must be between 1 and 7'),
    validate
  ]
};

/**
 * MongoDB ID validation
 */
const validateMongoId = (paramName) => [
  param(paramName)
    .isMongoId().withMessage(`Invalid ${paramName}`),
  validate
];

module.exports = {
  validate,
  authValidation,
  rideValidation,
  bookingValidation,
  reviewValidation,
  messageValidation,
  userValidation,
  validateMongoId
};
