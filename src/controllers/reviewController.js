/**
 * Review Controller
 * Handles ratings and reviews between riders and drivers
 */

const { Review, Booking, User, Notification } = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

/**
 * Create a review
 * POST /api/v1/reviews
 */
exports.createReview = asyncHandler(async (req, res, next) => {
  const { bookingId, rating, comment, categoryRatings } = req.body;
  const reviewer = req.user;

  // Get booking with ride info
  const booking = await Booking.findById(bookingId)
    .populate({
      path: 'ride',
      populate: { path: 'driver' }
    });

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Verify booking is completed
  if (booking.status !== 'completed') {
    return next(new AppError('You can only review completed rides', 400));
  }

  // Check if user is part of this booking
  const isPassenger = booking.passenger.toString() === reviewer._id.toString();
  const isDriver = booking.ride.driver._id.toString() === reviewer._id.toString();

  if (!isPassenger && !isDriver) {
    return next(new AppError('You are not authorized to review this booking', 403));
  }

  // Check if already reviewed
  const hasReviewed = await Review.hasReviewed(bookingId, reviewer._id);
  if (hasReviewed) {
    return next(new AppError('You have already reviewed this booking', 400));
  }

  // Determine review type and reviewee
  const reviewType = isPassenger ? 'rider_to_driver' : 'driver_to_rider';
  const revieweeId = isPassenger ? booking.ride.driver._id : booking.passenger;

  // Create review
  const review = await Review.create({
    ride: booking.ride._id,
    booking: bookingId,
    reviewer: reviewer._id,
    reviewee: revieweeId,
    reviewType,
    rating,
    comment,
    categoryRatings
  });

  // Mark booking as reviewed
  await booking.markReviewed(review._id);

  // Notify reviewee
  await Notification.createNotification('new_review', revieweeId, {
    reviewId: review._id,
    rating
  });

  // Populate review for response
  await review.populate([
    { path: 'reviewer', select: 'name profilePicture' },
    { path: 'reviewee', select: 'name profilePicture rating' }
  ]);

  res.status(201).json({
    success: true,
    data: {
      review
    }
  });
});

/**
 * Get reviews for a user
 * GET /api/v1/reviews/user/:userId
 */
exports.getUserReviews = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const reviews = await Review.findByUser(userId, true); // Reviews received

  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const paginatedReviews = reviews.slice(startIndex, startIndex + parseInt(limit));

  // Get stats
  const stats = await Review.getUserStats(userId);

  res.status(200).json({
    success: true,
    count: paginatedReviews.length,
    total: reviews.length,
    page: parseInt(page),
    pages: Math.ceil(reviews.length / parseInt(limit)),
    data: {
      reviews: paginatedReviews,
      stats
    }
  });
});

/**
 * Get my reviews (given and received)
 * GET /api/v1/reviews/me
 */
exports.getMyReviews = asyncHandler(async (req, res, next) => {
  const { type = 'received' } = req.query;

  const reviews = await Review.findByUser(req.user._id, type === 'received');
  const stats = await Review.getUserStats(req.user._id);

  res.status(200).json({
    success: true,
    count: reviews.length,
    data: {
      reviews,
      stats
    }
  });
});

/**
 * Get single review
 * GET /api/v1/reviews/:id
 */
exports.getReview = asyncHandler(async (req, res, next) => {
  const review = await Review.findById(req.params.id)
    .populate('reviewer', 'name profilePicture')
    .populate('reviewee', 'name profilePicture')
    .populate('ride', 'startLocation destination departureTime');

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      review
    }
  });
});

/**
 * Respond to a review
 * POST /api/v1/reviews/:id/respond
 */
exports.respondToReview = asyncHandler(async (req, res, next) => {
  const { response } = req.body;

  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // Only reviewee can respond
  if (review.reviewee.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the reviewee can respond to this review', 403));
  }

  // Check if already responded
  if (review.response?.text) {
    return next(new AppError('You have already responded to this review', 400));
  }

  await review.addResponse(response);

  res.status(200).json({
    success: true,
    data: {
      review
    }
  });
});

/**
 * Report a review (for moderation)
 * POST /api/v1/reviews/:id/report
 */
exports.reportReview = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;

  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // TODO: Create a report and notify admins
  // For now, just acknowledge the report

  res.status(200).json({
    success: true,
    message: 'Review reported. Our team will review it shortly.'
  });
});

/**
 * Get review statistics for current user
 * GET /api/v1/reviews/stats
 */
exports.getReviewStats = asyncHandler(async (req, res, next) => {
  const stats = await Review.getUserStats(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      stats
    }
  });
});

/**
 * Admin: Hide a review
 * PATCH /api/v1/reviews/:id/hide
 */
exports.hideReview = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;

  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  await review.hide(req.user._id, reason);

  res.status(200).json({
    success: true,
    message: 'Review hidden',
    data: {
      review
    }
  });
});
