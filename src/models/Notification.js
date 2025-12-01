/**
 * Notification Model
 * Handles all system notifications for users
 */

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Recipient
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Recipient is required']
  },

  // Notification Type
  type: {
    type: String,
    enum: [
      'booking_confirmed',
      'booking_cancelled',
      'booking_request',
      'ride_cancelled',
      'ride_updated',
      'ride_starting',
      'ride_completed',
      'new_message',
      'new_review',
      'payment_received',
      'account_warning',
      'account_muted',
      'account_suspended',
      'system_announcement'
    ],
    required: [true, 'Notification type is required']
  },

  // Title and Message
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    maxlength: 100
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    maxlength: 500
  },

  // References
  data: {
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ride'
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking'
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Review'
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation'
    }
  },

  // Status
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },

  // Priority
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },

  // Action URL (for deep linking)
  actionUrl: {
    type: String
  },

  // Expiry
  expiresAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Instance Methods

// Mark as read
notificationSchema.methods.markAsRead = async function() {
  if (!this.isRead) {
    this.isRead = true;
    this.readAt = new Date();
    await this.save();
  }
};

// Static Methods

// Create notification with templates
notificationSchema.statics.createNotification = async function(type, recipientId, data = {}) {
  const templates = {
    booking_confirmed: {
      title: 'Booking Confirmed',
      message: `Your booking has been confirmed! The driver will pick you up at ${data.pickupTime || 'the scheduled time'}.`,
      priority: 'high'
    },
    booking_cancelled: {
      title: 'Booking Cancelled',
      message: data.cancelledBy === 'driver' 
        ? 'Unfortunately, the driver has cancelled your ride. Please look for alternative rides.'
        : 'Your booking has been cancelled.',
      priority: 'high'
    },
    booking_request: {
      title: 'New Booking Request',
      message: `${data.passengerName || 'A rider'} wants to join your ride.`,
      priority: 'high'
    },
    ride_cancelled: {
      title: 'Ride Cancelled',
      message: 'The ride you booked has been cancelled by the driver.',
      priority: 'urgent'
    },
    ride_updated: {
      title: 'Ride Updated',
      message: 'The ride details have been updated. Please check the new information.',
      priority: 'normal'
    },
    ride_starting: {
      title: 'Ride Starting Soon',
      message: `Your ride is starting in ${data.minutes || 15} minutes. Get ready!`,
      priority: 'high'
    },
    ride_completed: {
      title: 'Ride Completed',
      message: 'Your ride has been completed. Don\'t forget to leave a review!',
      priority: 'normal'
    },
    new_message: {
      title: 'New Message',
      message: `You have a new message from ${data.senderName || 'someone'}.`,
      priority: 'normal'
    },
    new_review: {
      title: 'New Review',
      message: `You received a ${data.rating || 5}-star review!`,
      priority: 'low'
    },
    payment_received: {
      title: 'Payment Received',
      message: `You received ${data.amount || 0} BHD for your ride.`,
      priority: 'normal'
    },
    account_warning: {
      title: 'Account Warning',
      message: 'Your message was removed due to policy violation. Repeated violations may result in account restrictions.',
      priority: 'urgent'
    },
    account_muted: {
      title: 'Account Temporarily Muted',
      message: 'Your messaging privileges have been temporarily suspended for 1 hour due to policy violations.',
      priority: 'urgent'
    },
    account_suspended: {
      title: 'Account Suspended',
      message: 'Your account has been suspended due to severe policy violations. Please contact support.',
      priority: 'urgent'
    },
    system_announcement: {
      title: data.title || 'System Announcement',
      message: data.message || 'Important system update.',
      priority: 'normal'
    }
  };

  const template = templates[type];
  if (!template) {
    throw new Error(`Unknown notification type: ${type}`);
  }

  return this.create({
    recipient: recipientId,
    type,
    title: template.title,
    message: template.message,
    priority: template.priority,
    data: {
      rideId: data.rideId,
      bookingId: data.bookingId,
      userId: data.userId,
      reviewId: data.reviewId,
      conversationId: data.conversationId
    },
    actionUrl: data.actionUrl,
    expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days default
  });
};

// Get user notifications
notificationSchema.statics.getUserNotifications = function(userId, options = {}) {
  const query = { recipient: userId };
  
  if (options.unreadOnly) {
    query.isRead = false;
  }

  if (options.type) {
    query.type = options.type;
  }

  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50)
    .skip(options.skip || 0);
};

// Get unread count
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    recipient: userId,
    isRead: false
  });
};

// Mark all as read
notificationSchema.statics.markAllAsRead = async function(userId) {
  return this.updateMany(
    { recipient: userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
};

// Delete old notifications
notificationSchema.statics.deleteOldNotifications = async function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return this.deleteMany({
    createdAt: { $lt: cutoffDate },
    isRead: true
  });
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
