/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authValidation } = require('../middleware/validation');

// Public routes
router.post('/register', authValidation.register, authController.register);
router.post('/login', authValidation.login, authController.login);
router.post('/logout', authController.logout);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/forgot-password', authValidation.forgotPassword, authController.forgotPassword);
router.patch('/reset-password/:token', authValidation.resetPassword, authController.resetPassword);

// Protected routes
router.use(protect);

router.get('/me', authController.getMe);
router.post('/resend-verification', authController.resendVerificationEmail);
router.patch('/update-password', authController.updatePassword);

// Two-Factor Authentication
router.post('/2fa/setup', authController.setupTwoFactor);
router.post('/2fa/enable', authController.enableTwoFactor);
router.post('/2fa/disable', authController.disableTwoFactor);

module.exports = router;
