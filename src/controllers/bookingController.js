/**
 * Booking Controller
 * Handles ride booking, cancellation, and management
 */

const { Booking, Ride, User, Notification } = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const emailService = require('../services/emailService');
const { sendBookingUpdate, emitToUser } = require('../services/socketService');

/**
 * Create a booking
 * POST /api/v1/bookings
 */
exports.createBooking = asyncHandler(async (req, res, next) => {
  const { rideId, seatsBooked = 1, pickupLocation, specialRequests } = req.body;
  const passenger = req.user;

  // Get ride
  const ride = await Ride.findById(rideId).populate('driver');

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Validate ride is available
  if (ride.status !== 'scheduled') {
    return next(new AppError('This ride is no longer available for booking', 400));
  }

  if (ride.departureTime <= new Date()) {
    return next(new AppError('Cannot book a ride that has already departed', 400));
  }

  // Check if user is trying to book their own ride
  if (ride.driver._id.toString() === passenger._id.toString()) {
    return next(new AppError('You cannot book your own ride', 400));
  }

  // Check seat availability
  if (ride.availableSeats < seatsBooked) {
    return next(new AppError(`Only ${ride.availableSeats} seats available`, 400));
  }

  // Check gender preference
  if (ride.genderPreference !== 'any' && ride.genderPreference !== passenger.gender) {
    return next(new AppError(`This ride is only for ${ride.genderPreference} passengers`, 400));
  }

  // Check if user already has a booking for this ride
  const existingBooking = await Booking.hasExistingBooking(rideId, passenger._id);
  if (existingBooking) {
    return next(new AppError('You already have a booking for this ride', 400));
  }

  // Calculate total amount
  const totalAmount = ride.pricePerSeat * seatsBooked;

  // Create booking
  const booking = await Booking.create({
    ride: rideId,
    passenger: passenger._id,
    seatsBooked,
    pickupLocation: pickupLocation || {
      address: ride.startLocation.address,
      coordinates: ride.startLocation.coordinates
    },
    totalAmount,
    specialRequests,
    status: 'confirmed', // Auto-confirm for now
    confirmedAt: new Date(),
    confirmedBy: 'auto'
  });

  // Update ride seat count
  await ride.decrementSeats(seatsBooked);

  // Populate booking data
  await booking.populate([
    { path: 'passenger', select: 'name profilePicture phoneNumber gender' },
    { 
      path: 'ride', 
      populate: { 
        path: 'driver', 
        select: 'name profilePicture phoneNumber carDetails rating' 
      } 
    }
  ]);

  // Create notification for driver
  await Notification.createNotification('booking_request', ride.driver._id, {
    rideId: ride._id,
    bookingId: booking._id,
    passengerName: passenger.name
  });

  // Create notification for passenger
  await Notification.createNotification('booking_confirmed', passenger._id, {
    rideId: ride._id,
    bookingId: booking._id,
    pickupTime: ride.departureTime
  });

  // Real-time notification to driver
  emitToUser(ride.driver._id.toString(), 'booking:new', {
    booking: {
      _id: booking._id,
      passenger: {
        name: passenger.name,
        profilePicture: passenger.profilePicture
      },
      seatsBooked,
      status: booking.status
    },
    ride: {
      _id: ride._id,
      availableSeats: ride.availableSeats
    }
  });

  // Send confirmation email
  try {
    await emailService.sendBookingConfirmationEmail(passenger, booking, ride, ride.driver);
  } catch (error) {
    console.error('Failed to send confirmation email:', error.message);
  }

  res.status(201).json({
    success: true,
    data: {
      booking
    }
  });
});

/**
 * Get user's bookings
 * GET /api/v1/bookings
 */
exports.getMyBookings = asyncHandler(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const bookings = await Booking.findByPassenger(req.user._id, status);

  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const paginatedBookings = bookings.slice(startIndex, startIndex + parseInt(limit));

  res.status(200).json({
    success: true,
    count: paginatedBookings.length,
    total: bookings.length,
    page: parseInt(page),
    pages: Math.ceil(bookings.length / parseInt(limit)),
    data: {
      bookings: paginatedBookings
    }
  });
});

/**
 * Get single booking
 * GET /api/v1/bookings/:id
 */
exports.getBooking = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id)
    .populate('passenger', 'name profilePicture phoneNumber gender rating')
    .populate({
      path: 'ride',
      populate: {
        path: 'driver',
        select: 'name profilePicture phoneNumber carDetails rating'
      }
    });

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Check authorization
  const isPassenger = booking.passenger._id.toString() === req.user._id.toString();
  const isDriver = booking.ride.driver._id.toString() === req.user._id.toString();

  if (!isPassenger && !isDriver) {
    return next(new AppError('You are not authorized to view this booking', 403));
  }

  res.status(200).json({
    success: true,
    data: {
      booking
    }
  });
});

/**
 * Cancel booking
 * PATCH /api/v1/bookings/:id/cancel
 */
exports.cancelBooking = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id)
    .populate('passenger')
    .populate({
      path: 'ride',
      populate: { path: 'driver' }
    });

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Check authorization
  const isPassenger = booking.passenger._id.toString() === req.user._id.toString();
  const isDriver = booking.ride.driver._id.toString() === req.user._id.toString();

  if (!isPassenger && !isDriver) {
    return next(new AppError('You are not authorized to cancel this booking', 403));
  }

  // Check if booking can be cancelled
  if (!['pending', 'confirmed'].includes(booking.status)) {
    return next(new AppError('This booking cannot be cancelled', 400));
  }

  // Check cancellation timing (e.g., at least 1 hour before departure)
  const ride = booking.ride;
  const hoursUntilDeparture = (new Date(ride.departureTime) - new Date()) / (1000 * 60 * 60);
  
  if (isPassenger && hoursUntilDeparture < 1) {
    return next(new AppError('Cannot cancel less than 1 hour before departure', 400));
  }

  const { reason } = req.body;
  const cancelledBy = isPassenger ? 'passenger' : 'driver';

  // Cancel booking
  await booking.cancel(reason || 'No reason provided', cancelledBy);

  // Restore seats to ride
  await ride.incrementSeats(booking.seatsBooked);

  // Notify the other party
  const recipientId = isPassenger ? ride.driver._id : booking.passenger._id;
  await Notification.createNotification('booking_cancelled', recipientId, {
    rideId: ride._id,
    bookingId: booking._id,
    cancelledBy
  });

  // Real-time notification
  sendBookingUpdate(booking, 'booking:cancelled');

  res.status(200).json({
    success: true,
    message: 'Booking cancelled successfully',
    data: {
      booking
    }
  });
});

/**
 * Get bookings for a ride (driver only)
 * GET /api/v1/bookings/ride/:rideId
 */
exports.getRideBookings = asyncHandler(async (req, res, next) => {
  const ride = await Ride.findById(req.params.rideId);

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Check if user is the driver
  if (ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only view bookings for your own rides', 403));
  }

  const bookings = await Booking.findByRide(req.params.rideId);

  res.status(200).json({
    success: true,
    count: bookings.length,
    data: {
      bookings
    }
  });
});

/**
 * Mark passenger as picked up
 * PATCH /api/v1/bookings/:id/pickup
 */
exports.markPickedUp = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id).populate('ride');

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Check if user is the driver
  if (booking.ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the driver can mark passengers as picked up', 403));
  }

  if (booking.status !== 'confirmed') {
    return next(new AppError('Booking must be confirmed', 400));
  }

  await booking.markPickedUp();

  emitToUser(booking.passenger.toString(), 'booking:picked_up', {
    bookingId: booking._id
  });

  res.status(200).json({
    success: true,
    message: 'Passenger marked as picked up',
    data: { booking }
  });
});

/**
 * Mark passenger as no-show
 * PATCH /api/v1/bookings/:id/no-show
 */
exports.markNoShow = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id).populate('ride');

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Check if user is the driver
  if (booking.ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the driver can mark passengers as no-show', 403));
  }

  if (booking.status !== 'confirmed') {
    return next(new AppError('Booking must be confirmed', 400));
  }

  await booking.markNoShow();

  // Notify passenger
  await Notification.createNotification('booking_cancelled', booking.passenger, {
    bookingId: booking._id,
    message: 'You were marked as a no-show for your ride'
  });

  res.status(200).json({
    success: true,
    message: 'Passenger marked as no-show',
    data: { booking }
  });
});

/**
 * Get booking statistics
 * GET /api/v1/bookings/stats
 */
exports.getBookingStats = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  const [totalBookings, completedBookings, cancelledBookings, totalSpent] = await Promise.all([
    Booking.countDocuments({ passenger: userId }),
    Booking.countDocuments({ passenger: userId, status: 'completed' }),
    Booking.countDocuments({ passenger: userId, status: 'cancelled' }),
    Booking.getTotalSpent(userId)
  ]);

  res.status(200).json({
    success: true,
    data: {
      stats: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        completionRate: totalBookings > 0 
          ? ((completedBookings / totalBookings) * 100).toFixed(1) 
          : 0,
        totalSpent
      }
    }
  });
});
