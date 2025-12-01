/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, requireEmailVerification } = require('../middleware/auth');
const { userValidation, validateMongoId } = require('../middleware/validation');

// All routes require authentication
router.use(protect);

// Dashboard and profile
router.get('/dashboard', userController.getDashboard);
router.get('/ride-history', userController.getRideHistory);
router.patch('/profile', userValidation.updateProfile, userController.updateProfile);

// Driver registration
router.post('/become-driver', requireEmailVerification, userValidation.updateCarDetails, userController.becomeDriver);
router.patch('/car-details', userValidation.updateCarDetails, userController.updateCarDetails);

// Account management
router.delete('/account', userController.deactivateAccount);

// Get drivers (for admin/testing)
router.get('/drivers', userController.getDrivers);

// Get specific user profile (public for drivers)
router.get('/:id', validateMongoId('id'), userController.getUser);

module.exports = router;
