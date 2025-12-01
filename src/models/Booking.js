/**
 * Booking Model
 * Represents a passenger's booking for a ride
 * Manages the relationship between riders and rides
 */

const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  // References
  ride: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    required: [true, 'Ride reference is required']
  },
  passenger: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Passenger reference is required']
  },

  // Booking Details
  seatsBooked: {
    type: Number,
    required: [true, 'Number of seats is required'],
    min: [1, 'Must book at least 1 seat'],
    max: [4, 'Cannot book more than 4 seats at once']
  },

  // Pickup Location (can be different from ride start)
  pickupLocation: {
    address: {
      type: String,
      trim: true
    },
    coordinates: {
      lat: Number,
      lng: Number
    }
  },

  // Payment
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'in_app'],
    default: 'cash'
  },

  // Booking Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'],
    default: 'pending'
  },
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledBy: {
    type: String,
    enum: ['passenger', 'driver', 'system'],
    default: null
  },
  cancelledAt: {
    type: Date
  },

  // Confirmation
  confirmedAt: {
    type: Date
  },
  confirmedBy: {
    type: String,
    enum: ['auto', 'driver'],
    default: 'auto'
  },

  // Trip Progress
  pickedUpAt: {
    type: Date
  },
  droppedOffAt: {
    type: Date
  },

  // Review tracking
  hasReviewed: {
    type: Boolean,
    default: false
  },
  reviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review'
  },

  // Notes
  specialRequests: {
    type: String,
    maxlength: [300, 'Special requests cannot exceed 300 characters'],
    trim: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index to prevent duplicate bookings
bookingSchema.index({ ride: 1, passenger: 1 }, { unique: true });
bookingSchema.index({ passenger: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ createdAt: -1 });

// Virtual for driver (through ride)
bookingSchema.virtual('driver', {
  ref: 'Ride',
  localField: 'ride',
  foreignField: '_id',
  justOne: true
});

// Pre-save middleware
bookingSchema.pre('save', function(next) {
  // Set confirmation timestamp
  if (this.isModified('status') && this.status === 'confirmed' && !this.confirmedAt) {
    this.confirmedAt = new Date();
  }
  next();
});

// Instance Methods

// Confirm booking
bookingSchema.methods.confirm = async function(confirmedBy = 'auto') {
  this.status = 'confirmed';
  this.confirmedAt = new Date();
  this.confirmedBy = confirmedBy;
  await this.save();
};

// Cancel booking
bookingSchema.methods.cancel = async function(reason, cancelledBy) {
  this.status = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledBy = cancelledBy;
  this.cancelledAt = new Date();
  await this.save();
};

// Mark as picked up
bookingSchema.methods.markPickedUp = async function() {
  this.pickedUpAt = new Date();
  await this.save();
};

// Mark as completed
bookingSchema.methods.complete = async function() {
  this.status = 'completed';
  this.droppedOffAt = new Date();
  await this.save();
};

// Mark as no show
bookingSchema.methods.markNoShow = async function() {
  this.status = 'no_show';
  await this.save();
};

// Mark as reviewed
bookingSchema.methods.markReviewed = async function(reviewId) {
  this.hasReviewed = true;
  this.reviewId = reviewId;
  await this.save();
};

// Static Methods

// Find passenger's bookings
bookingSchema.statics.findByPassenger = function(passengerId, status = null) {
  const query = { passenger: passengerId };
  if (status) query.status = status;
  return this.find(query)
    .populate({
      path: 'ride',
      populate: {
        path: 'driver',
        select: 'name rating profilePicture phoneNumber carDetails'
      }
    })
    .sort({ createdAt: -1 });
};

// Find bookings for a ride
bookingSchema.statics.findByRide = function(rideId, status = null) {
  const query = { ride: rideId };
  if (status) query.status = status;
  return this.find(query)
    .populate('passenger', 'name rating profilePicture phoneNumber gender')
    .sort({ createdAt: 1 });
};

// Check if user has existing booking for ride
bookingSchema.statics.hasExistingBooking = async function(rideId, passengerId) {
  const booking = await this.findOne({
    ride: rideId,
    passenger: passengerId,
    status: { $in: ['pending', 'confirmed'] }
  });
  return !!booking;
};

// Get active bookings count for passenger
bookingSchema.statics.getActiveBookingsCount = async function(passengerId) {
  return this.countDocuments({
    passenger: passengerId,
    status: { $in: ['pending', 'confirmed'] }
  });
};

// Calculate total spent by passenger
bookingSchema.statics.getTotalSpent = async function(passengerId) {
  const result = await this.aggregate([
    {
      $match: {
        passenger: new mongoose.Types.ObjectId(passengerId),
        status: 'completed',
        paymentStatus: 'paid'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$totalAmount' }
      }
    }
  ]);
  return result.length > 0 ? result[0].total : 0;
};

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
