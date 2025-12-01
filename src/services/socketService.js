/**
 * Socket.IO Service
 * Handles real-time communication for notifications, messages, and ride updates
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

let io = null;
const userSockets = new Map(); // userId -> Set of socket IDs

/**
 * Initialize Socket.IO server
 */
function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: config.socketCorsOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwtSecret);
      socket.userId = decoded.id;
      socket.userEmail = decoded.email;
      next();
    } catch (error) {
      logger.error('Socket authentication error:', error.message);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    logger.info(`User ${userId} connected via socket ${socket.id}`);

    // Track user's socket connections
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Handle joining ride rooms
    socket.on('join:ride', (rideId) => {
      socket.join(`ride:${rideId}`);
      logger.debug(`User ${userId} joined ride room ${rideId}`);
    });

    // Handle leaving ride rooms
    socket.on('leave:ride', (rideId) => {
      socket.leave(`ride:${rideId}`);
      logger.debug(`User ${userId} left ride room ${rideId}`);
    });

    // Handle joining conversation rooms
    socket.on('join:conversation', (conversationId) => {
      socket.join(`conversation:${conversationId}`);
      logger.debug(`User ${userId} joined conversation ${conversationId}`);
    });

    // Handle leaving conversation rooms
    socket.on('leave:conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Handle typing indicators
    socket.on('typing:start', (conversationId) => {
      socket.to(`conversation:${conversationId}`).emit('user:typing', {
        conversationId,
        userId
      });
    });

    socket.on('typing:stop', (conversationId) => {
      socket.to(`conversation:${conversationId}`).emit('user:stopped_typing', {
        conversationId,
        userId
      });
    });

    // Handle location updates (for active rides)
    socket.on('location:update', (data) => {
      if (data.rideId) {
        socket.to(`ride:${data.rideId}`).emit('driver:location', {
          rideId: data.rideId,
          location: data.location,
          timestamp: new Date()
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`User ${userId} disconnected: ${reason}`);
      
      // Remove socket from tracking
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket error for user ${userId}:`, error);
    });
  });

  logger.info('Socket.IO initialized');
  return io;
}

/**
 * Get Socket.IO instance
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
}

/**
 * Check if user is online
 */
function isUserOnline(userId) {
  return userSockets.has(userId) && userSockets.get(userId).size > 0;
}

/**
 * Get online users count
 */
function getOnlineUsersCount() {
  return userSockets.size;
}

/**
 * Emit event to specific user
 */
function emitToUser(userId, event, data) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
    logger.debug(`Emitted ${event} to user ${userId}`);
  }
}

/**
 * Emit event to multiple users
 */
function emitToUsers(userIds, event, data) {
  if (io) {
    userIds.forEach(userId => {
      io.to(`user:${userId}`).emit(event, data);
    });
    logger.debug(`Emitted ${event} to ${userIds.length} users`);
  }
}

/**
 * Emit event to a ride room
 */
function emitToRide(rideId, event, data) {
  if (io) {
    io.to(`ride:${rideId}`).emit(event, data);
    logger.debug(`Emitted ${event} to ride ${rideId}`);
  }
}

/**
 * Emit event to a conversation
 */
function emitToConversation(conversationId, event, data) {
  if (io) {
    io.to(`conversation:${conversationId}`).emit(event, data);
    logger.debug(`Emitted ${event} to conversation ${conversationId}`);
  }
}

/**
 * Emit notification to user
 */
function sendNotification(userId, notification) {
  emitToUser(userId, 'notification', {
    id: notification._id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data,
    createdAt: notification.createdAt
  });
}

/**
 * Emit new message to conversation
 */
function sendMessage(conversationId, message, excludeUserId = null) {
  if (io) {
    const room = `conversation:${conversationId}`;
    
    if (excludeUserId) {
      // Get all sockets in room except sender
      const sockets = io.sockets.adapter.rooms.get(room);
      if (sockets) {
        sockets.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket && socket.userId !== excludeUserId) {
            socket.emit('message:new', message);
          }
        });
      }
    } else {
      io.to(room).emit('message:new', message);
    }
  }
}

/**
 * Emit booking update
 */
function sendBookingUpdate(booking, event = 'booking:updated') {
  // Notify passenger
  emitToUser(booking.passenger.toString(), event, {
    bookingId: booking._id,
    status: booking.status,
    rideId: booking.ride
  });

  // Notify driver (via ride)
  emitToRide(booking.ride.toString(), event, {
    bookingId: booking._id,
    status: booking.status,
    passengerId: booking.passenger
  });
}

/**
 * Emit ride update to all participants
 */
function sendRideUpdate(ride, event = 'ride:updated') {
  emitToRide(ride._id.toString(), event, {
    rideId: ride._id,
    status: ride.status,
    availableSeats: ride.availableSeats,
    departureTime: ride.departureTime
  });
}

/**
 * Broadcast system announcement
 */
function broadcastAnnouncement(message) {
  if (io) {
    io.emit('system:announcement', {
      message,
      timestamp: new Date()
    });
    logger.info('System announcement broadcast:', message);
  }
}

module.exports = {
  initializeSocket,
  getIO,
  isUserOnline,
  getOnlineUsersCount,
  emitToUser,
  emitToUsers,
  emitToRide,
  emitToConversation,
  sendNotification,
  sendMessage,
  sendBookingUpdate,
  sendRideUpdate,
  broadcastAnnouncement
};
