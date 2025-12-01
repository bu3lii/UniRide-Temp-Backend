/**
 * Booking Routes
 */

const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { protect, requireEmailVerification } = require('../middleware/auth');
const { bookingValidation, validateMongoId } = require('../middleware/validation');

// All routes require authentication
router.use(protect);
router.use(requireEmailVerification);

// Booking CRUD
router.post('/', bookingValidation.create, bookingController.createBooking);
router.get('/', bookingController.getMyBookings);
router.get('/stats', bookingController.getBookingStats);
router.get('/ride/:rideId', validateMongoId('rideId'), bookingController.getRideBookings);
router.get('/:id', validateMongoId('id'), bookingController.getBooking);

// Booking actions
router.patch('/:id/cancel', validateMongoId('id'), bookingValidation.cancel, bookingController.cancelBooking);
router.patch('/:id/pickup', validateMongoId('id'), bookingController.markPickedUp);
router.patch('/:id/no-show', validateMongoId('id'), bookingController.markNoShow);

module.exports = router;
