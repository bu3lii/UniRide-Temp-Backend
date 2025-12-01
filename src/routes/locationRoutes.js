/**
 * Location Routes
 * OSM/OSRM based location services
 */

const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');
const { optionalAuth } = require('../middleware/auth');

// All routes are public but with optional auth for logging
router.use(optionalAuth);

// Geocoding
router.post('/geocode', locationController.geocode);
router.post('/reverse-geocode', locationController.reverseGeocode);
router.get('/search', locationController.searchPlaces);

// Routing
router.post('/route', locationController.calculateRoute);
router.post('/multi-route', locationController.calculateMultiStopRoute);
router.post('/distance-matrix', locationController.calculateDistanceMatrix);

// Utilities
router.post('/snap-to-road', locationController.snapToRoad);
router.post('/eta', locationController.getETA);
router.post('/validate', locationController.validateLocation);
router.get('/service-area', locationController.getServiceArea);

module.exports = router;
