/**
 * Location Controller
 * Handles geocoding, routing, and location services using OSM/OSRM
 */

const locationService = require('../services/locationService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

/**
 * Geocode an address
 * POST /api/v1/location/geocode
 */
exports.geocode = asyncHandler(async (req, res, next) => {
  const { address } = req.body;

  if (!address) {
    return next(new AppError('Address is required', 400));
  }

  const result = await locationService.geocode(address);

  if (!result) {
    return next(new AppError('Could not find location', 404));
  }

  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Reverse geocode coordinates
 * POST /api/v1/location/reverse-geocode
 */
exports.reverseGeocode = asyncHandler(async (req, res, next) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const result = await locationService.reverseGeocode(lat, lng);

  if (!result) {
    return next(new AppError('Could not find address', 404));
  }

  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Search for places
 * GET /api/v1/location/search
 */
exports.searchPlaces = asyncHandler(async (req, res, next) => {
  const { q, limit = 10 } = req.query;

  if (!q) {
    return next(new AppError('Search query is required', 400));
  }

  const results = await locationService.searchPlaces(q, { limit: parseInt(limit) });

  res.status(200).json({
    success: true,
    count: results.length,
    data: results
  });
});

/**
 * Calculate route between two points
 * POST /api/v1/location/route
 */
exports.calculateRoute = asyncHandler(async (req, res, next) => {
  const { start, end, options = {} } = req.body;

  if (!start?.lat || !start?.lng || !end?.lat || !end?.lng) {
    return next(new AppError('Start and end coordinates are required', 400));
  }

  // Validate coordinates are within service area
  if (!locationService.isWithinServiceArea(start)) {
    return next(new AppError('Start location is outside the service area', 400));
  }
  if (!locationService.isWithinServiceArea(end)) {
    return next(new AppError('End location is outside the service area', 400));
  }

  try {
    const route = await locationService.calculateRoute(start, end, options);

    res.status(200).json({
      success: true,
      data: route
    });
  } catch (error) {
    return next(new AppError('Unable to calculate route', 400));
  }
});

/**
 * Calculate route with multiple stops
 * POST /api/v1/location/multi-route
 */
exports.calculateMultiStopRoute = asyncHandler(async (req, res, next) => {
  const { waypoints } = req.body;

  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return next(new AppError('At least 2 waypoints are required', 400));
  }

  // Validate all waypoints
  for (const wp of waypoints) {
    if (!wp.lat || !wp.lng) {
      return next(new AppError('All waypoints must have lat and lng', 400));
    }
    if (!locationService.isWithinServiceArea(wp)) {
      return next(new AppError('One or more waypoints are outside the service area', 400));
    }
  }

  try {
    const route = await locationService.calculateMultiStopRoute(waypoints);

    res.status(200).json({
      success: true,
      data: route
    });
  } catch (error) {
    return next(new AppError('Unable to calculate route', 400));
  }
});

/**
 * Calculate distance matrix
 * POST /api/v1/location/distance-matrix
 */
exports.calculateDistanceMatrix = asyncHandler(async (req, res, next) => {
  const { origins, destinations } = req.body;

  if (!Array.isArray(origins) || !Array.isArray(destinations)) {
    return next(new AppError('Origins and destinations arrays are required', 400));
  }

  if (origins.length === 0 || destinations.length === 0) {
    return next(new AppError('At least one origin and one destination are required', 400));
  }

  try {
    const matrix = await locationService.calculateDistanceMatrix(origins, destinations);

    res.status(200).json({
      success: true,
      data: matrix
    });
  } catch (error) {
    return next(new AppError('Unable to calculate distance matrix', 400));
  }
});

/**
 * Snap point to nearest road
 * POST /api/v1/location/snap-to-road
 */
exports.snapToRoad = asyncHandler(async (req, res, next) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const snappedPoint = await locationService.snapToRoad({ lat, lng });

  res.status(200).json({
    success: true,
    data: snappedPoint
  });
});

/**
 * Get ETA between two points
 * POST /api/v1/location/eta
 */
exports.getETA = asyncHandler(async (req, res, next) => {
  const { start, end, departureTime } = req.body;

  if (!start?.lat || !start?.lng || !end?.lat || !end?.lng) {
    return next(new AppError('Start and end coordinates are required', 400));
  }

  const departure = departureTime ? new Date(departureTime) : new Date();

  if (departure < new Date()) {
    return next(new AppError('Departure time cannot be in the past', 400));
  }

  try {
    const eta = await locationService.getEstimatedArrival(start, end, departure);

    res.status(200).json({
      success: true,
      data: eta
    });
  } catch (error) {
    return next(new AppError('Unable to calculate ETA', 400));
  }
});

/**
 * Validate if coordinates are in service area
 * POST /api/v1/location/validate
 */
exports.validateLocation = asyncHandler(async (req, res, next) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const isValid = locationService.isWithinServiceArea({ lat, lng });

  res.status(200).json({
    success: true,
    data: {
      isValid,
      message: isValid 
        ? 'Location is within service area' 
        : 'Location is outside the service area (Bahrain)'
    }
  });
});

/**
 * Get service area bounds
 * GET /api/v1/location/service-area
 */
exports.getServiceArea = asyncHandler(async (req, res, next) => {
  const config = require('../config');
  
  res.status(200).json({
    success: true,
    data: {
      bounds: config.geoBounds,
      center: {
        lat: (config.geoBounds.minLat + config.geoBounds.maxLat) / 2,
        lng: (config.geoBounds.minLng + config.geoBounds.maxLng) / 2
      },
      name: 'Kingdom of Bahrain'
    }
  });
});
