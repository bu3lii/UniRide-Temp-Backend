/**
 * User Controller
 * Handles user profile management and driver registration
 */

const { User, Ride, Booking, Review } = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

/**
 * Get user profile
 * GET /api/v1/users/:id
 */
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).select('-password -twoFactorSecret');

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Get additional stats if viewing own profile or if user is a driver
  let stats = null;
  if (user.isDriver || req.params.id === req.user?._id?.toString()) {
    const reviewStats = await Review.getUserStats(user._id);
    stats = {
      ...user.stats,
      rating: user.rating,
      reviewStats
    };
  }

  res.status(200).json({
    success: true,
    data: {
      user,
      stats
    }
  });
});

/**
 * Update user profile
 * PATCH /api/v1/users/profile
 */
exports.updateProfile = asyncHandler(async (req, res, next) => {
  const allowedFields = ['name', 'phoneNumber', 'profilePicture'];
  const updates = {};

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updates,
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    data: {
      user
    }
  });
});

/**
 * Become a driver
 * POST /api/v1/users/become-driver
 */
exports.becomeDriver = asyncHandler(async (req, res, next) => {
  const { model, color, licensePlate, totalSeats } = req.body;

  if (req.user.isDriver) {
    return next(new AppError('You are already registered as a driver', 400));
  }

  // Check email verification
  if (!req.user.isEmailVerified) {
    return next(new AppError('Please verify your email before becoming a driver', 400));
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      isDriver: true,
      carDetails: {
        model,
        color,
        licensePlate: licensePlate.toUpperCase(),
        totalSeats
      }
    },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    message: 'You are now registered as a driver',
    data: {
      user
    }
  });
});

/**
 * Update car details
 * PATCH /api/v1/users/car-details
 */
exports.updateCarDetails = asyncHandler(async (req, res, next) => {
  if (!req.user.isDriver) {
    return next(new AppError('You must be a driver to update car details', 400));
  }

  const { model, color, licensePlate, totalSeats } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      carDetails: {
        model,
        color,
        licensePlate: licensePlate.toUpperCase(),
        totalSeats
      }
    },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    data: {
      user
    }
  });
});

/**
 * Get user dashboard stats
 * GET /api/v1/users/dashboard
 */
exports.getDashboard = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Parallel queries for efficiency
  const [
    upcomingRidesAsPassenger,
    upcomingRidesAsDriver,
    recentBookings,
    user
  ] = await Promise.all([
    // Upcoming rides as passenger
    Booking.find({
      passenger: userId,
      status: { $in: ['pending', 'confirmed'] }
    })
      .populate({
        path: 'ride',
        match: { departureTime: { $gt: new Date() } },
        populate: { path: 'driver', select: 'name profilePicture carDetails phoneNumber' }
      })
      .sort({ 'ride.departureTime': 1 })
      .limit(5),
    
    // Upcoming rides as driver
    req.user.isDriver
      ? Ride.find({
          driver: userId,
          status: 'scheduled',
          departureTime: { $gt: new Date() }
        })
          .sort({ departureTime: 1 })
          .limit(5)
      : [],
    
    // Recent completed bookings
    Booking.find({
      passenger: userId,
      status: 'completed'
    })
      .populate({
        path: 'ride',
        populate: { path: 'driver', select: 'name profilePicture' }
      })
      .sort({ updatedAt: -1 })
      .limit(5),
    
    // Get fresh user data with stats
    User.findById(userId)
  ]);

  // Filter out bookings where ride doesn't exist or is in the past
  const validUpcomingRides = upcomingRidesAsPassenger.filter(b => b.ride);

  res.status(200).json({
    success: true,
    data: {
      user: {
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        isDriver: user.isDriver,
        rating: user.rating,
        stats: user.stats
      },
      upcomingRidesAsPassenger: validUpcomingRides,
      upcomingRidesAsDriver,
      recentBookings,
      impact: {
        totalRides: user.stats.totalRidesAsRider + user.stats.totalRidesAsDriver,
        moneySaved: user.stats.moneySaved,
        co2Saved: (user.stats.totalRidesAsRider * 2.3).toFixed(1) // Estimate: 2.3kg CO2 per ride
      }
    }
  });
});

/**
 * Get user's ride history
 * GET /api/v1/users/ride-history
 */
exports.getRideHistory = asyncHandler(async (req, res, next) => {
  const { type = 'all', page = 1, limit = 20 } = req.query;
  const userId = req.user._id;

  let history = [];

  if (type === 'all' || type === 'passenger') {
    const bookings = await Booking.find({
      passenger: userId,
      status: 'completed'
    })
      .populate({
        path: 'ride',
        populate: { path: 'driver', select: 'name profilePicture rating carDetails' }
      })
      .sort({ updatedAt: -1 });

    history.push(...bookings.map(b => ({
      type: 'passenger',
      date: b.updatedAt,
      ride: b.ride,
      booking: {
        _id: b._id,
        seatsBooked: b.seatsBooked,
        totalAmount: b.totalAmount,
        hasReviewed: b.hasReviewed
      }
    })));
  }

  if ((type === 'all' || type === 'driver') && req.user.isDriver) {
    const rides = await Ride.find({
      driver: userId,
      status: 'completed'
    }).sort({ updatedAt: -1 });

    for (const ride of rides) {
      const bookings = await Booking.find({
        ride: ride._id,
        status: 'completed'
      }).populate('passenger', 'name profilePicture');

      history.push({
        type: 'driver',
        date: ride.updatedAt,
        ride,
        passengers: bookings.map(b => ({
          name: b.passenger.name,
          profilePicture: b.passenger.profilePicture,
          seatsBooked: b.seatsBooked
        })),
        totalEarnings: bookings.reduce((sum, b) => sum + b.totalAmount, 0)
      });
    }
  }

  // Sort by date
  history.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const paginatedHistory = history.slice(startIndex, startIndex + parseInt(limit));

  res.status(200).json({
    success: true,
    count: paginatedHistory.length,
    total: history.length,
    page: parseInt(page),
    pages: Math.ceil(history.length / parseInt(limit)),
    data: {
      history: paginatedHistory
    }
  });
});

/**
 * Deactivate account
 * DELETE /api/v1/users/account
 */
exports.deactivateAccount = asyncHandler(async (req, res, next) => {
  // Check for active bookings
  const activeBookings = await Booking.countDocuments({
    passenger: req.user._id,
    status: { $in: ['pending', 'confirmed'] }
  });

  if (activeBookings > 0) {
    return next(new AppError('Please cancel your active bookings before deactivating', 400));
  }

  // Check for scheduled rides (if driver)
  if (req.user.isDriver) {
    const scheduledRides = await Ride.countDocuments({
      driver: req.user._id,
      status: 'scheduled',
      departureTime: { $gt: new Date() }
    });

    if (scheduledRides > 0) {
      return next(new AppError('Please cancel your scheduled rides before deactivating', 400));
    }
  }

  await User.findByIdAndUpdate(req.user._id, { isActive: false });

  res.status(200).json({
    success: true,
    message: 'Account deactivated successfully'
  });
});

/**
 * Get nearby drivers (for debugging/admin)
 * GET /api/v1/users/drivers
 */
exports.getDrivers = asyncHandler(async (req, res, next) => {
  const drivers = await User.findActiveDrivers()
    .select('name profilePicture rating carDetails');

  res.status(200).json({
    success: true,
    count: drivers.length,
    data: {
      drivers
    }
  });
});
