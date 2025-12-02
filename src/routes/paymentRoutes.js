/**
 * Payment Routes
 * All payment-related API endpoints
 */

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, requireEmailVerification, requireDriver } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate, validateMongoId } = require('../middleware/validation');

// All routes require authentication
router.use(protect);
router.use(requireEmailVerification);

// ============================================
// WALLET ROUTES
// ============================================

// Get wallet balance
router.get('/wallet', paymentController.getWalletBalance);

// Top up wallet
router.post('/wallet/top-up', [
  body('amount')
    .isFloat({ min: 0.1, max: 500 })
    .withMessage('Amount must be between 0.1 and 500 BHD'),
  body('paymentMethod.type')
    .optional()
    .isIn(['card', 'benefit_pay', 'bank_transfer'])
    .withMessage('Invalid payment method'),
  validate
], paymentController.topUpWallet);

// Withdraw from wallet
router.post('/wallet/withdraw', [
  body('amount')
    .isFloat({ min: 5 })
    .withMessage('Minimum withdrawal is 5 BHD'),
  body('withdrawalMethod.type')
    .optional()
    .isIn(['bank_transfer'])
    .withMessage('Invalid withdrawal method'),
  body('withdrawalMethod.iban')
    .optional()
    .matches(/^BH\d{2}[A-Z]{4}\d{14}$/)
    .withMessage('Invalid Bahrain IBAN format'),
  validate
], paymentController.withdrawFromWallet);

// ============================================
// COST PREVIEW ROUTES
// ============================================

// Preview booking cost
router.get('/rides/:rideId/preview',
  validateMongoId('rideId'),
  [
    query('seats')
      .optional()
      .isInt({ min: 1, max: 4 })
      .withMessage('Seats must be between 1 and 4'),
    validate
  ],
  paymentController.previewBookingCost
);

// Check payment eligibility
router.get('/rides/:rideId/eligibility',
  validateMongoId('rideId'),
  [
    query('seats')
      .optional()
      .isInt({ min: 1, max: 4 })
      .withMessage('Seats must be between 1 and 4'),
    validate
  ],
  paymentController.checkPaymentEligibility
);

// Get cost split for a ride
router.get('/rides/:rideId/cost-split',
  validateMongoId('rideId'),
  paymentController.getRideCostSplit
);

// Get ride payment status
router.get('/rides/:rideId/status',
  validateMongoId('rideId'),
  paymentController.getRidePaymentStatus
);

// ============================================
// BOOKING PAYMENT ROUTES
// ============================================

// Pay for a booking
router.post('/bookings/:bookingId/pay',
  validateMongoId('bookingId'),
  paymentController.payForBooking
);

// Request refund
router.post('/bookings/:bookingId/refund',
  validateMongoId('bookingId'),
  [
    body('reason')
      .optional()
      .isLength({ max: 300 })
      .withMessage('Reason cannot exceed 300 characters'),
    validate
  ],
  paymentController.requestRefund
);

// ============================================
// DRIVER PAYMENT ROUTES
// ============================================

// Collect payments for a ride (driver only)
router.post('/rides/:rideId/collect',
  validateMongoId('rideId'),
  requireDriver,
  paymentController.collectRidePayments
);

// Request payout (driver only)
router.post('/rides/:rideId/payout',
  validateMongoId('rideId'),
  requireDriver,
  paymentController.requestDriverPayout
);

// Get driver earnings summary
router.get('/earnings', [
  query('period')
    .optional()
    .isIn(['today', 'week', 'month', 'all'])
    .withMessage('Period must be today, week, month, or all'),
  validate
], paymentController.getDriverEarnings);

// ============================================
// TRANSACTION HISTORY ROUTES
// ============================================

// Get transaction history
router.get('/transactions', [
  query('type')
    .optional()
    .isIn(['top_up', 'withdrawal', 'ride_payment', 'ride_earning', 'refund', 'platform_fee', 'bonus', 'penalty'])
    .withMessage('Invalid transaction type'),
  query('status')
    .optional()
    .isIn(['pending', 'completed', 'failed', 'cancelled', 'refunded'])
    .withMessage('Invalid status'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be at least 1'),
  validate
], paymentController.getTransactionHistory);

// Get spending summary (passengers)
router.get('/spending', [
  query('period')
    .optional()
    .isIn(['today', 'week', 'month', 'all'])
    .withMessage('Period must be today, week, month, or all'),
  validate
], paymentController.getSpendingSummary);

module.exports = router;