/**
 * Ride Routes
 */

const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { protect, requireEmailVerification, requireDriver, optionalAuth } = require('../middleware/auth');
const { rideValidation, validateMongoId } = require('../middleware/validation');

// Public routes (with optional auth for personalization)
router.get('/', optionalAuth, rideController.getRides);
router.post('/search', optionalAuth, rideController.searchRides);
router.post('/route', rideController.getRoute);

// Protected routes
router.use(protect);
router.use(requireEmailVerification);

// Get driver's own rides
router.get('/my-rides', requireDriver, rideController.getMyRides);

// Create ride (driver only)
router.post('/', requireDriver, rideValidation.create, rideController.createRide);

// Single ride operations
router.get('/:id', validateMongoId('id'), rideController.getRide);
router.patch('/:id', validateMongoId('id'), requireDriver, rideValidation.update, rideController.updateRide);
router.delete('/:id', validateMongoId('id'), requireDriver, rideController.cancelRide);

// Ride status updates (driver only)
router.patch('/:id/start', validateMongoId('id'), requireDriver, rideController.startRide);
router.patch('/:id/complete', validateMongoId('id'), requireDriver, rideController.completeRide);

module.exports = router;
