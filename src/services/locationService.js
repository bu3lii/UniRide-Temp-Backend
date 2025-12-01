/**
 * Location Service
 * Uses OpenStreetMap (Nominatim) for geocoding
 * Uses OSRM for routing calculations
 * Free alternative to Google Maps API
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class LocationService {
  constructor() {
    this.osrmUrl = config.osrmServerUrl;
    this.nominatimUrl = config.nominatimUrl;
    this.geoBounds = config.geoBounds;
    
    // User agent required by Nominatim TOS
    this.userAgent = 'UniRide/1.0 (University Carpooling App)';
  }

  /**
   * Geocode an address to coordinates
   * @param {string} address - Address to geocode
   * @returns {Object} Coordinates and formatted address
   */
  async geocode(address) {
    try {
      const response = await axios.get(`${this.nominatimUrl}/search`, {
        params: {
          q: address,
          format: 'json',
          addressdetails: 1,
          limit: 5,
          countrycodes: 'bh', // Restrict to Bahrain
          viewbox: `${this.geoBounds.minLng},${this.geoBounds.maxLat},${this.geoBounds.maxLng},${this.geoBounds.minLat}`,
          bounded: 1
        },
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 10000
      });

      if (!response.data || response.data.length === 0) {
        return null;
      }

      const result = response.data[0];
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        displayName: result.display_name,
        address: {
          road: result.address?.road,
          suburb: result.address?.suburb,
          city: result.address?.city || result.address?.town,
          country: result.address?.country
        },
        boundingBox: result.boundingbox
      };
    } catch (error) {
      logger.error('Geocoding error:', error.message);
      throw new Error('Failed to geocode address');
    }
  }

  /**
   * Reverse geocode coordinates to address
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Object} Address information
   */
  async reverseGeocode(lat, lng) {
    try {
      const response = await axios.get(`${this.nominatimUrl}/reverse`, {
        params: {
          lat,
          lon: lng,
          format: 'json',
          addressdetails: 1
        },
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 10000
      });

      if (!response.data) {
        return null;
      }

      return {
        displayName: response.data.display_name,
        address: {
          road: response.data.address?.road,
          suburb: response.data.address?.suburb,
          city: response.data.address?.city || response.data.address?.town,
          country: response.data.address?.country
        }
      };
    } catch (error) {
      logger.error('Reverse geocoding error:', error.message);
      throw new Error('Failed to reverse geocode coordinates');
    }
  }

  /**
   * Search for places/addresses
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array} List of matching places
   */
  async searchPlaces(query, options = {}) {
    try {
      const response = await axios.get(`${this.nominatimUrl}/search`, {
        params: {
          q: query,
          format: 'json',
          addressdetails: 1,
          limit: options.limit || 10,
          countrycodes: 'bh',
          viewbox: `${this.geoBounds.minLng},${this.geoBounds.maxLat},${this.geoBounds.maxLng},${this.geoBounds.minLat}`,
          bounded: options.bounded !== false ? 1 : 0
        },
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 10000
      });

      return response.data.map(item => ({
        id: item.place_id,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        displayName: item.display_name,
        type: item.type,
        importance: item.importance,
        address: {
          road: item.address?.road,
          suburb: item.address?.suburb,
          city: item.address?.city || item.address?.town,
          country: item.address?.country
        }
      }));
    } catch (error) {
      logger.error('Place search error:', error.message);
      throw new Error('Failed to search places');
    }
  }

  /**
   * Calculate route between two points using OSRM
   * @param {Object} start - Start coordinates {lat, lng}
   * @param {Object} end - End coordinates {lat, lng}
   * @param {Object} options - Route options
   * @returns {Object} Route information
   */
  async calculateRoute(start, end, options = {}) {
    try {
      const profile = options.profile || 'driving';
      const coordinates = `${start.lng},${start.lat};${end.lng},${end.lat}`;

      const response = await axios.get(
        `${this.osrmUrl}/route/v1/${profile}/${coordinates}`,
        {
          params: {
            overview: options.overview || 'full',
            geometries: 'geojson',
            steps: options.steps !== false,
            annotations: options.annotations || 'distance,duration'
          },
          timeout: 15000
        }
      );

      if (!response.data || response.data.code !== 'Ok') {
        throw new Error('Route calculation failed');
      }

      const route = response.data.routes[0];
      return {
        distance: route.distance, // meters
        duration: route.duration, // seconds
        distanceKm: (route.distance / 1000).toFixed(2),
        durationMinutes: Math.ceil(route.duration / 60),
        geometry: route.geometry,
        legs: route.legs.map(leg => ({
          distance: leg.distance,
          duration: leg.duration,
          steps: leg.steps?.map(step => ({
            distance: step.distance,
            duration: step.duration,
            instruction: step.maneuver?.instruction,
            name: step.name,
            mode: step.mode
          }))
        })),
        waypoints: response.data.waypoints.map(wp => ({
          name: wp.name,
          location: {
            lng: wp.location[0],
            lat: wp.location[1]
          }
        }))
      };
    } catch (error) {
      logger.error('Route calculation error:', error.message);
      throw new Error('Failed to calculate route');
    }
  }

  /**
   * Calculate route with multiple waypoints
   * @param {Array} waypoints - Array of {lat, lng} objects
   * @returns {Object} Route information
   */
  async calculateMultiStopRoute(waypoints) {
    if (waypoints.length < 2) {
      throw new Error('At least 2 waypoints required');
    }

    try {
      const coordinates = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(';');

      const response = await axios.get(
        `${this.osrmUrl}/route/v1/driving/${coordinates}`,
        {
          params: {
            overview: 'full',
            geometries: 'geojson',
            steps: true
          },
          timeout: 15000
        }
      );

      if (!response.data || response.data.code !== 'Ok') {
        throw new Error('Multi-stop route calculation failed');
      }

      const route = response.data.routes[0];
      return {
        distance: route.distance,
        duration: route.duration,
        distanceKm: (route.distance / 1000).toFixed(2),
        durationMinutes: Math.ceil(route.duration / 60),
        geometry: route.geometry,
        legs: route.legs.map((leg, index) => ({
          from: waypoints[index],
          to: waypoints[index + 1],
          distance: leg.distance,
          duration: leg.duration,
          distanceKm: (leg.distance / 1000).toFixed(2),
          durationMinutes: Math.ceil(leg.duration / 60)
        })),
        waypoints: response.data.waypoints
      };
    } catch (error) {
      logger.error('Multi-stop route error:', error.message);
      throw new Error('Failed to calculate multi-stop route');
    }
  }

  /**
   * Calculate distance matrix between multiple points
   * @param {Array} origins - Array of origin coordinates
   * @param {Array} destinations - Array of destination coordinates
   * @returns {Object} Distance matrix
   */
  async calculateDistanceMatrix(origins, destinations) {
    try {
      const allPoints = [...origins, ...destinations];
      const coordinates = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
      
      const sourceIndices = origins.map((_, i) => i).join(';');
      const destIndices = destinations.map((_, i) => i + origins.length).join(';');

      const response = await axios.get(
        `${this.osrmUrl}/table/v1/driving/${coordinates}`,
        {
          params: {
            sources: sourceIndices,
            destinations: destIndices,
            annotations: 'distance,duration'
          },
          timeout: 20000
        }
      );

      if (!response.data || response.data.code !== 'Ok') {
        throw new Error('Distance matrix calculation failed');
      }

      return {
        distances: response.data.distances, // meters
        durations: response.data.durations, // seconds
        sources: response.data.sources,
        destinations: response.data.destinations
      };
    } catch (error) {
      logger.error('Distance matrix error:', error.message);
      throw new Error('Failed to calculate distance matrix');
    }
  }

  /**
   * Find nearest point on road network
   * @param {Object} coordinates - {lat, lng}
   * @returns {Object} Nearest road point
   */
  async snapToRoad(coordinates) {
    try {
      const response = await axios.get(
        `${this.osrmUrl}/nearest/v1/driving/${coordinates.lng},${coordinates.lat}`,
        {
          params: {
            number: 1
          },
          timeout: 5000
        }
      );

      if (!response.data || response.data.code !== 'Ok') {
        return coordinates; // Return original if snap fails
      }

      const waypoint = response.data.waypoints[0];
      return {
        lat: waypoint.location[1],
        lng: waypoint.location[0],
        name: waypoint.name,
        distance: waypoint.distance // Distance from original point
      };
    } catch (error) {
      logger.error('Snap to road error:', error.message);
      return coordinates;
    }
  }

  /**
   * Validate if coordinates are within service area (Bahrain)
   * @param {Object} coordinates - {lat, lng}
   * @returns {boolean}
   */
  isWithinServiceArea(coordinates) {
    return (
      coordinates.lat >= this.geoBounds.minLat &&
      coordinates.lat <= this.geoBounds.maxLat &&
      coordinates.lng >= this.geoBounds.minLng &&
      coordinates.lng <= this.geoBounds.maxLng
    );
  }

  /**
   * Calculate straight-line distance between two points (Haversine)
   * @param {Object} point1 - {lat, lng}
   * @param {Object} point2 - {lat, lng}
   * @returns {number} Distance in meters
   */
  calculateHaversineDistance(point1, point2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (point1.lat * Math.PI) / 180;
    const φ2 = (point2.lat * Math.PI) / 180;
    const Δφ = ((point2.lat - point1.lat) * Math.PI) / 180;
    const Δλ = ((point2.lng - point1.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Get estimated arrival time
   * @param {Object} start - Start coordinates
   * @param {Object} end - End coordinates
   * @param {Date} departureTime - Departure time
   * @returns {Object} ETA information
   */
  async getEstimatedArrival(start, end, departureTime) {
    const route = await this.calculateRoute(start, end);
    const arrivalTime = new Date(departureTime.getTime() + route.duration * 1000);

    return {
      departureTime,
      arrivalTime,
      durationSeconds: route.duration,
      durationMinutes: route.durationMinutes,
      distanceMeters: route.distance,
      distanceKm: route.distanceKm
    };
  }
}

// Export singleton instance
module.exports = new LocationService();
