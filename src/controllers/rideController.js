/**
 * Ride Controller
 * Handles ride creation, search, update, and management
 */

const { Ride, Booking, User, Notification } = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const locationService = require('../services/locationService');
const { sendRideUpdate, emitToUser } = require('../services/socketService');

/**
 * Create a new ride
 * POST /api/v1/rides
 */
exports.createRide = asyncHandler(async (req, res, next) => {
  const driver = req.user;

  // Verify driver status
  if (!driver.isDriver || !driver.carDetails?.licensePlate) {
    return next(new AppError('Please complete your driver profile first', 400));
  }

  const {
    startLocation,
    destination,
    departureTime,
    totalSeats,
    pricePerSeat,
    genderPreference,
    notes,
    isRecurring,
    recurringDays
  } = req.body;

  // Validate locations are within service area
  if (!locationService.isWithinServiceArea(startLocation.coordinates)) {
    return next(new AppError('Start location is outside the service area', 400));
  }
  if (!locationService.isWithinServiceArea(destination.coordinates)) {
    return next(new AppError('Destination is outside the service area', 400));
  }

  // Calculate route
  let routeInfo;
  try {
    routeInfo = await locationService.calculateRoute(
      startLocation.coordinates,
      destination.coordinates
    );
  } catch (error) {
    return next(new AppError('Unable to calculate route. Please try again.', 400));
  }

  // Calculate estimated arrival time
  const departureDate = new Date(departureTime);
  const estimatedArrivalTime = new Date(departureDate.getTime() + routeInfo.duration * 1000);

  // Create ride
  const ride = await Ride.create({
    driver: driver._id,
    startLocation,
    destination,
    route: {
      polyline: routeInfo.geometry?.coordinates ? JSON.stringify(routeInfo.geometry.coordinates) : null,
      distance: routeInfo.distance,
      duration: routeInfo.duration
    },
    departureTime: departureDate,
    estimatedArrivalTime,
    totalSeats,
    availableSeats: totalSeats,
    pricePerSeat,
    genderPreference: genderPreference || 'any',
    notes,
    isRecurring: isRecurring || false,
    recurringDays: recurringDays || []
  });

  // Populate driver info
  await ride.populate('driver', 'name rating profilePicture carDetails phoneNumber');

  res.status(201).json({
    success: true,
    data: {
      ride,
      route: {
        distanceKm: routeInfo.distanceKm,
        durationMinutes: routeInfo.durationMinutes
      }
    }
  });
});

/**
 * Get all available rides
 * GET /api/v1/rides
 */
exports.getRides = asyncHandler(async (req, res, next) => {
  const {
    startLat,
    startLng,
    destLat,
    destLng,
    date,
    minSeats,
    maxPrice,
    genderPreference,
    page = 1,
    limit = 20
  } = req.query;

  // Build filter object
  const filters = {};
  
  if (minSeats) filters.minSeats = parseInt(minSeats);
  if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
  if (genderPreference) filters.genderPreference = genderPreference;
  if (date) filters.departureDate = date;

  let rides;

  // If start location provided, search by proximity
  if (startLat && startLng) {
    const startCoords = { lat: parseFloat(startLat), lng: parseFloat(startLng) };
    rides = await Ride.findRidesNearLocation(startCoords, 5000); // 5km radius
  } else {
    rides = await Ride.findAvailableRides(filters);
  }

  // Apply pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedRides = rides.slice(startIndex, endIndex);

  // If destination provided, calculate distance for each ride
  if (destLat && destLng) {
    const destCoords = { lat: parseFloat(destLat), lng: parseFloat(destLng) };
    
    for (let ride of paginatedRides) {
      const distanceToDestination = locationService.calculateHaversineDistance(
        ride.destination.coordinates,
        destCoords
      );
      ride._doc.distanceToDestination = Math.round(distanceToDestination);
    }
  }

  res.status(200).json({
    success: true,
    count: paginatedRides.length,
    total: rides.length,
    page: parseInt(page),
    pages: Math.ceil(rides.length / parseInt(limit)),
    data: {
      rides: paginatedRides
    }
  });
});

/**
 * Search rides with advanced filters
 * POST /api/v1/rides/search
 */
exports.searchRides = asyncHandler(async (req, res, next) => {
  const {
    startLocation,
    destination,
    departureDate,
    departureTimeRange,
    minSeats = 1,
    maxPrice,
    genderPreference,
    maxWalkingDistance = 1000 // meters
  } = req.body;

  // Base query
  const query = {
    status: 'scheduled',
    availableSeats: { $gte: minSeats },
    departureTime: { $gt: new Date() }
  };

  // Date filter
  if (departureDate) {
    const startOfDay = new Date(departureDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(departureDate);
    endOfDay.setHours(23, 59, 59, 999);
    query.departureTime = { $gte: startOfDay, $lte: endOfDay };
  }

  // Time range filter
  if (departureTimeRange) {
    const { start, end } = departureTimeRange;
    if (start) query.departureTime.$gte = new Date(start);
    if (end) query.departureTime.$lte = new Date(end);
  }

  // Price filter
  if (maxPrice) {
    query.pricePerSeat = { $lte: maxPrice };
  }

  // Gender preference filter
  if (genderPreference && genderPreference !== 'any') {
    query.genderPreference = { $in: ['any', genderPreference] };
  }

  // Get rides
  let rides = await Ride.find(query)
    .populate('driver', 'name rating profilePicture carDetails phoneNumber gender')
    .sort({ departureTime: 1 });

  // Filter by start location proximity
  if (startLocation?.coordinates) {
    rides = rides.filter(ride => {
      const distance = locationService.calculateHaversineDistance(
        startLocation.coordinates,
        ride.startLocation.coordinates
      );
      ride._doc.distanceFromStart = Math.round(distance);
      return distance <= maxWalkingDistance;
    });
  }

  // Filter by destination proximity
  if (destination?.coordinates) {
    rides = rides.filter(ride => {
      const distance = locationService.calculateHaversineDistance(
        destination.coordinates,
        ride.destination.coordinates
      );
      ride._doc.distanceToDestination = Math.round(distance);
      return distance <= maxWalkingDistance;
    });
  }

  // Sort by relevance (closest to start, then by departure time)
  rides.sort((a, b) => {
    const distA = a._doc.distanceFromStart || Infinity;
    const distB = b._doc.distanceFromStart || Infinity;
    if (distA !== distB) return distA - distB;
    return new Date(a.departureTime) - new Date(b.departureTime);
  });

  res.status(200).json({
    success: true,
    count: rides.length,
    data: {
      rides
    }
  });
});

/**
 * Get single ride
 * GET /api/v1/rides/:id
 */
exports.getRide = asyncHandler(async (req, res, next) => {
  const ride = await Ride.findById(req.params.id)
    .populate('driver', 'name rating profilePicture carDetails phoneNumber gender')
    .populate({
      path: 'bookings',
      match: { status: { $in: ['confirmed', 'pending'] } },
      populate: {
        path: 'passenger',
        select: 'name profilePicture gender'
      }
    });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      ride
    }
  });
});

/**
 * Update ride
 * PATCH /api/v1/rides/:id
 */
exports.updateRide = asyncHandler(async (req, res, next) => {
  const ride = await Ride.findById(req.params.id);

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Check ownership
  if (ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only update your own rides', 403));
  }

  // Check if ride is still scheduled
  if (ride.status !== 'scheduled') {
    return next(new AppError('Cannot update a ride that is not scheduled', 400));
  }

  // Check if ride has bookings (limit what can be updated)
  const hasBookings = await Booking.exists({ 
    ride: ride._id, 
    status: { $in: ['pending', 'confirmed'] } 
  });

  const allowedUpdates = ['notes', 'departureTime'];
  if (!hasBookings) {
    allowedUpdates.push('pricePerSeat', 'totalSeats', 'genderPreference');
  }

  const updates = {};
  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  // If updating seats, also update available seats
  if (updates.totalSeats) {
    const bookedSeats = ride.totalSeats - ride.availableSeats;
    if (updates.totalSeats < bookedSeats) {
      return next(new AppError(`Cannot reduce seats below ${bookedSeats} (already booked)`, 400));
    }
    updates.availableSeats = updates.totalSeats - bookedSeats;
  }

  // If updating departure time, recalculate arrival
  if (updates.departureTime) {
    const newDeparture = new Date(updates.departureTime);
    updates.estimatedArrivalTime = new Date(newDeparture.getTime() + ride.route.duration * 1000);
  }

  Object.assign(ride, updates);
  await ride.save();

  // Notify passengers about the update
  if (hasBookings) {
    const bookings = await Booking.find({ 
      ride: ride._id, 
      status: { $in: ['pending', 'confirmed'] } 
    });

    for (const booking of bookings) {
      await Notification.createNotification('ride_updated', booking.passenger, {
        rideId: ride._id
      });
    }

    // Real-time notification
    sendRideUpdate(ride, 'ride:updated');
  }

  await ride.populate('driver', 'name rating profilePicture carDetails');

  res.status(200).json({
    success: true,
    data: {
      ride
    }
  });
});

/**
 * Cancel ride
 * DELETE /api/v1/rides/:id
 */
exports.cancelRide = asyncHandler(async (req, res, next) => {
  const ride = await Ride.findById(req.params.id);

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Check ownership
  if (ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only cancel your own rides', 403));
  }

  // Check if ride can be cancelled
  if (ride.status !== 'scheduled') {
    return next(new AppError('Cannot cancel a ride that is not scheduled', 400));
  }

  const { reason } = req.body;

  // Cancel ride
  await ride.cancelRide(reason || 'Cancelled by driver');

  // Cancel all bookings and notify passengers
  const bookings = await Booking.find({ 
    ride: ride._id, 
    status: { $in: ['pending', 'confirmed'] } 
  }).populate('passenger');

  const emailService = require('../services/emailService');

  for (const booking of bookings) {
    await booking.cancel('Ride cancelled by driver', 'driver');
    
    // Create notification
    await Notification.createNotification('ride_cancelled', booking.passenger._id, {
      rideId: ride._id
    });

    // Send email
    try {
      await emailService.sendRideCancellationEmail(booking.passenger, ride, reason);
    } catch (error) {
      console.error('Failed to send cancellation email:', error.message);
    }

    // Real-time notification
    emitToUser(booking.passenger._id.toString(), 'ride:cancelled', {
      rideId: ride._id,
      message: 'Your ride has been cancelled by the driver'
    });
  }

  res.status(200).json({
    success: true,
    message: 'Ride cancelled successfully'
  });
});

/**
 * Get driver's rides
 * GET /api/v1/rides/my-rides
 */
exports.getMyRides = asyncHandler(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const query = { driver: req.user._id };
  if (status) query.status = status;

  const rides = await Ride.find(query)
    .sort({ departureTime: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));

  const total = await Ride.countDocuments(query);

  res.status(200).json({
    success: true,
    count: rides.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    data: {
      rides
    }
  });
});

/**
 * Start ride
 * PATCH /api/v1/rides/:id/start
 */
exports.startRide = asyncHandler(async (req, res, next) => {
  const ride = await Ride.findById(req.params.id);

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only start your own rides', 403));
  }

  if (ride.status !== 'scheduled') {
    return next(new AppError('Ride cannot be started', 400));
  }

  await ride.startRide();

  // Notify passengers
  const bookings = await Booking.find({ 
    ride: ride._id, 
    status: 'confirmed' 
  });

  for (const booking of bookings) {
    await Notification.createNotification('ride_starting', booking.passenger, {
      rideId: ride._id,
      minutes: 0
    });

    emitToUser(booking.passenger.toString(), 'ride:started', {
      rideId: ride._id
    });
  }

  res.status(200).json({
    success: true,
    message: 'Ride started',
    data: { ride }
  });
});

/**
 * Complete ride
 * PATCH /api/v1/rides/:id/complete
 */
exports.completeRide = asyncHandler(async (req, res, next) => {
  const ride = await Ride.findById(req.params.id);

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only complete your own rides', 403));
  }

  if (ride.status !== 'in_progress') {
    return next(new AppError('Ride must be in progress to complete', 400));
  }

  await ride.completeRide();

  // Complete all confirmed bookings and update stats
  const bookings = await Booking.find({ 
    ride: ride._id, 
    status: 'confirmed' 
  });

  const driver = await User.findById(ride.driver);
  driver.stats.totalRidesAsDriver += 1;
  await driver.save();

  for (const booking of bookings) {
    await booking.complete();

    // Update passenger stats
    const passenger = await User.findById(booking.passenger);
    passenger.stats.totalRidesAsRider += 1;
    passenger.stats.moneySaved += booking.totalAmount * 0.3; // Estimate savings
    await passenger.save();

    // Notify passenger
    await Notification.createNotification('ride_completed', booking.passenger, {
      rideId: ride._id,
      bookingId: booking._id
    });
  }

  sendRideUpdate(ride, 'ride:completed');

  res.status(200).json({
    success: true,
    message: 'Ride completed',
    data: { ride }
  });
});

/**
 * Get route details (using OSM)
 * POST /api/v1/rides/route
 */
exports.getRoute = asyncHandler(async (req, res, next) => {
  const { start, end } = req.body;

  if (!start || !end) {
    return next(new AppError('Start and end coordinates are required', 400));
  }

  try {
    const route = await locationService.calculateRoute(start, end);

    res.status(200).json({
      success: true,
      data: {
        route
      }
    });
  } catch (error) {
    return next(new AppError('Unable to calculate route', 400));
  }
});
