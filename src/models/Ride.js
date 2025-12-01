/**
 * Ride Model
 * Represents a ride posting created by a driver
 * Includes route information, timing, and seat availability
 */

const mongoose = require('mongoose');

const coordinateSchema = new mongoose.Schema({
  lat: {
    type: Number,
    required: true,
    min: -90,
    max: 90
  },
  lng: {
    type: Number,
    required: true,
    min: -180,
    max: 180
  }
}, { _id: false });

const rideSchema = new mongoose.Schema({
  // Driver Information
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Driver is required']
  },

  // Route Information
  startLocation: {
    address: {
      type: String,
      required: [true, 'Start location address is required'],
      trim: true
    },
    coordinates: {
      type: coordinateSchema,
      required: [true, 'Start location coordinates are required']
    }
  },
  destination: {
    address: {
      type: String,
      required: [true, 'Destination address is required'],
      trim: true
    },
    coordinates: {
      type: coordinateSchema,
      required: [true, 'Destination coordinates are required']
    }
  },
  route: {
    // Polyline encoded route from OSRM
    polyline: String,
    // Array of coordinate waypoints
    waypoints: [coordinateSchema],
    // Route metadata
    distance: {
      type: Number, // in meters
      default: 0
    },
    duration: {
      type: Number, // in seconds
      default: 0
    }
  },

  // Timing
  departureTime: {
    type: Date,
    required: [true, 'Departure time is required'],
    validate: {
      validator: function(value) {
        return value > new Date();
      },
      message: 'Departure time must be in the future'
    }
  },
  estimatedArrivalTime: {
    type: Date
  },

  // Seat Management
  totalSeats: {
    type: Number,
    required: [true, 'Total seats are required'],
    min: [1, 'Must have at least 1 seat'],
    max: [7, 'Cannot exceed 7 seats']
  },
  availableSeats: {
    type: Number,
    required: true,
    min: [0, 'Available seats cannot be negative']
  },

  // Preferences
  genderPreference: {
    type: String,
    enum: ['any', 'male', 'female'],
    default: 'any'
  },

  // Pricing
  pricePerSeat: {
    type: Number,
    required: [true, 'Price per seat is required'],
    min: [0, 'Price cannot be negative']
  },
  currency: {
    type: String,
    default: 'BHD'
  },

  // Status
  status: {
    type: String,
    enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  cancellationReason: {
    type: String,
    trim: true
  },

  // Additional Notes
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters'],
    trim: true
  },

  // Recurring Ride (optional)
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringDays: {
    type: [String],
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  },

  // Statistics
  totalBookings: {
    type: Number,
    default: 0
  },
  completedBookings: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
rideSchema.index({ driver: 1 });
rideSchema.index({ status: 1 });
rideSchema.index({ departureTime: 1 });
rideSchema.index({ availableSeats: 1 });
rideSchema.index({ 'startLocation.coordinates': '2dsphere' });
rideSchema.index({ 'destination.coordinates': '2dsphere' });

// Virtual for bookings
rideSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'ride'
});

// Virtual to check if ride is full
rideSchema.virtual('isFull').get(function() {
  return this.availableSeats === 0;
});

// Virtual to check if ride is active
rideSchema.virtual('isActive').get(function() {
  return this.status === 'scheduled' && this.departureTime > new Date();
});

// Pre-save middleware
rideSchema.pre('save', function(next) {
  // Set available seats to total seats on creation
  if (this.isNew && this.availableSeats === undefined) {
    this.availableSeats = this.totalSeats;
  }
  next();
});

// Instance Methods

// Decrement available seats
rideSchema.methods.decrementSeats = async function(count = 1) {
  if (this.availableSeats < count) {
    throw new Error('Not enough available seats');
  }
  this.availableSeats -= count;
  this.totalBookings += 1;
  await this.save();
};

// Increment available seats (for cancellations)
rideSchema.methods.incrementSeats = async function(count = 1) {
  if (this.availableSeats + count > this.totalSeats) {
    throw new Error('Cannot exceed total seats');
  }
  this.availableSeats += count;
  await this.save();
};

// Cancel ride
rideSchema.methods.cancelRide = async function(reason) {
  this.status = 'cancelled';
  this.cancellationReason = reason;
  await this.save();
};

// Complete ride
rideSchema.methods.completeRide = async function() {
  this.status = 'completed';
  await this.save();
};

// Start ride
rideSchema.methods.startRide = async function() {
  this.status = 'in_progress';
  await this.save();
};

// Static Methods

// Find available rides
rideSchema.statics.findAvailableRides = function(filters = {}) {
  const query = {
    status: 'scheduled',
    availableSeats: { $gt: 0 },
    departureTime: { $gt: new Date() }
  };

  if (filters.genderPreference) {
    query.genderPreference = { $in: ['any', filters.genderPreference] };
  }

  if (filters.minSeats) {
    query.availableSeats = { $gte: filters.minSeats };
  }

  if (filters.maxPrice) {
    query.pricePerSeat = { $lte: filters.maxPrice };
  }

  if (filters.departureDate) {
    const startOfDay = new Date(filters.departureDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(filters.departureDate);
    endOfDay.setHours(23, 59, 59, 999);
    query.departureTime = { $gte: startOfDay, $lte: endOfDay };
  }

  return this.find(query)
    .populate('driver', 'name rating profilePicture carDetails')
    .sort({ departureTime: 1 });
};

// Find rides near a location
rideSchema.statics.findRidesNearLocation = function(coordinates, maxDistanceMeters = 5000) {
  return this.find({
    status: 'scheduled',
    availableSeats: { $gt: 0 },
    departureTime: { $gt: new Date() },
    'startLocation.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [coordinates.lng, coordinates.lat]
        },
        $maxDistance: maxDistanceMeters
      }
    }
  }).populate('driver', 'name rating profilePicture carDetails');
};

// Find driver's rides
rideSchema.statics.findByDriver = function(driverId, status = null) {
  const query = { driver: driverId };
  if (status) query.status = status;
  return this.find(query).sort({ departureTime: -1 });
};

const Ride = mongoose.model('Ride', rideSchema);

module.exports = Ride;
