/**
 * Review Routes
 */

const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { protect, restrictTo } = require('../middleware/auth');
const { reviewValidation, validateMongoId } = require('../middleware/validation');

// All routes require authentication
router.use(protect);

// Review CRUD
router.post('/', reviewValidation.create, reviewController.createReview);
router.get('/me', reviewController.getMyReviews);
router.get('/stats', reviewController.getReviewStats);
router.get('/user/:userId', validateMongoId('userId'), reviewController.getUserReviews);
router.get('/:id', validateMongoId('id'), reviewController.getReview);

// Review actions
router.post('/:id/respond', validateMongoId('id'), reviewController.respondToReview);
router.post('/:id/report', validateMongoId('id'), reviewController.reportReview);

// Admin routes
router.patch('/:id/hide', validateMongoId('id'), restrictTo('admin'), reviewController.hideReview);

module.exports = router;
