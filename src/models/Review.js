/**
 * Review Model
 * Handles ratings and reviews between riders and drivers
 */

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // References
  ride: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    required: [true, 'Ride reference is required']
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: [true, 'Booking reference is required']
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Reviewer is required']
  },
  reviewee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Reviewee is required']
  },

  // Review Type
  reviewType: {
    type: String,
    enum: ['rider_to_driver', 'driver_to_rider'],
    required: true
  },

  // Rating
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },

  // Comment
  comment: {
    type: String,
    maxlength: [500, 'Comment cannot exceed 500 characters'],
    trim: true
  },

  // Categories (optional detailed ratings)
  categoryRatings: {
    punctuality: {
      type: Number,
      min: 1,
      max: 5
    },
    cleanliness: {
      type: Number,
      min: 1,
      max: 5
    },
    communication: {
      type: Number,
      min: 1,
      max: 5
    },
    safety: {
      type: Number,
      min: 1,
      max: 5
    }
  },

  // Visibility
  isVisible: {
    type: Boolean,
    default: true
  },

  // Moderation
  isModerated: {
    type: Boolean,
    default: false
  },
  moderatedAt: {
    type: Date
  },
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  moderationReason: {
    type: String
  },

  // Response from reviewee
  response: {
    text: {
      type: String,
      maxlength: [300, 'Response cannot exceed 300 characters']
    },
    respondedAt: {
      type: Date
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index to ensure one review per booking per direction
reviewSchema.index({ booking: 1, reviewer: 1 }, { unique: true });
reviewSchema.index({ reviewee: 1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ createdAt: -1 });

// Post-save middleware to update user rating
reviewSchema.post('save', async function() {
  const User = mongoose.model('User');
  const user = await User.findById(this.reviewee);
  
  if (user) {
    // Calculate new average rating
    const Review = mongoose.model('Review');
    const stats = await Review.aggregate([
      { $match: { reviewee: this.reviewee, isVisible: true } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          count: { $sum: 1 }
        }
      }
    ]);

    if (stats.length > 0) {
      user.rating.average = Math.round(stats[0].avgRating * 10) / 10;
      user.rating.count = stats[0].count;
      await user.save();
    }
  }
});

// Instance Methods

// Add response to review
reviewSchema.methods.addResponse = async function(responseText) {
  this.response = {
    text: responseText,
    respondedAt: new Date()
  };
  await this.save();
};

// Hide review (moderation)
reviewSchema.methods.hide = async function(moderatorId, reason) {
  this.isVisible = false;
  this.isModerated = true;
  this.moderatedAt = new Date();
  this.moderatedBy = moderatorId;
  this.moderationReason = reason;
  await this.save();
};

// Static Methods

// Get reviews for a user
reviewSchema.statics.findByUser = function(userId, asReviewee = true) {
  const query = asReviewee ? { reviewee: userId } : { reviewer: userId };
  query.isVisible = true;
  
  return this.find(query)
    .populate('reviewer', 'name profilePicture')
    .populate('ride', 'startLocation destination departureTime')
    .sort({ createdAt: -1 });
};

// Get review statistics for a user
reviewSchema.statics.getUserStats = async function(userId) {
  const stats = await this.aggregate([
    { $match: { reviewee: new mongoose.Types.ObjectId(userId), isVisible: true } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        fiveStars: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
        fourStars: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
        threeStars: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
        twoStars: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
        oneStar: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } }
      }
    }
  ]);

  if (stats.length === 0) {
    return {
      avgRating: 0,
      totalReviews: 0,
      distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    };
  }

  return {
    avgRating: Math.round(stats[0].avgRating * 10) / 10,
    totalReviews: stats[0].totalReviews,
    distribution: {
      5: stats[0].fiveStars,
      4: stats[0].fourStars,
      3: stats[0].threeStars,
      2: stats[0].twoStars,
      1: stats[0].oneStar
    }
  };
};

// Check if review exists for a booking
reviewSchema.statics.hasReviewed = async function(bookingId, reviewerId) {
  const review = await this.findOne({ booking: bookingId, reviewer: reviewerId });
  return !!review;
};

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
