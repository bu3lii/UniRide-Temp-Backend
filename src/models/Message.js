/**
 * Message Model
 * Handles in-app messaging between riders and drivers
 * Includes content moderation tracking
 */

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // Conversation Reference
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },

  // Sender
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Sender is required']
  },

  // Content
  content: {
    type: String,
    required: [true, 'Message content is required'],
    maxlength: [1000, 'Message cannot exceed 1000 characters'],
    trim: true
  },

  // Message Type
  messageType: {
    type: String,
    enum: ['text', 'system', 'ride_update'],
    default: 'text'
  },

  // Read Status
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },

  // Moderation
  moderation: {
    isModerated: {
      type: Boolean,
      default: false
    },
    isRemoved: {
      type: Boolean,
      default: false
    },
    toxicityScore: {
      type: Number,
      min: 0,
      max: 1
    },
    moderationAction: {
      type: String,
      enum: ['none', 'warning', 'removed', 'muted', 'suspended'],
      default: 'none'
    },
    moderatedAt: {
      type: Date
    },
    originalContent: {
      type: String  // Store original if removed
    }
  },

  // Metadata
  metadata: {
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ride'
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking'
    }
  }
}, {
  timestamps: true
});

// Indexes
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ isRead: 1 });

// Instance Methods

// Mark as read
messageSchema.methods.markAsRead = async function() {
  if (!this.isRead) {
    this.isRead = true;
    this.readAt = new Date();
    await this.save();
  }
};

// Apply moderation action
messageSchema.methods.applyModeration = async function(toxicityScore, action) {
  this.moderation.isModerated = true;
  this.moderation.toxicityScore = toxicityScore;
  this.moderation.moderationAction = action;
  this.moderation.moderatedAt = new Date();

  if (action === 'removed') {
    this.moderation.originalContent = this.content;
    this.moderation.isRemoved = true;
    this.content = '[Message removed due to policy violation]';
  }

  await this.save();
};

// Static Methods

// Get messages for a conversation
messageSchema.statics.getConversationMessages = function(conversationId, limit = 50, before = null) {
  const query = { conversation: conversationId };
  if (before) {
    query.createdAt = { $lt: before };
  }

  return this.find(query)
    .populate('sender', 'name profilePicture')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Mark all messages as read
messageSchema.statics.markAllAsRead = async function(conversationId, userId) {
  return this.updateMany(
    {
      conversation: conversationId,
      sender: { $ne: userId },
      isRead: false
    },
    {
      isRead: true,
      readAt: new Date()
    }
  );
};

// Get unread count for user
messageSchema.statics.getUnreadCount = async function(userId, conversationId = null) {
  const Conversation = mongoose.model('Conversation');
  
  // Get user's conversations
  const conversationQuery = conversationId 
    ? { _id: conversationId }
    : { participants: userId };
  
  const conversations = await Conversation.find(conversationQuery).select('_id');
  const conversationIds = conversations.map(c => c._id);

  return this.countDocuments({
    conversation: { $in: conversationIds },
    sender: { $ne: userId },
    isRead: false
  });
};

const Message = mongoose.model('Message', messageSchema);

// Conversation Model (in same file for simplicity)
const conversationSchema = new mongoose.Schema({
  // Participants
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],

  // Related Ride (optional - conversations can be about specific rides)
  ride: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride'
  },

  // Last Message Preview
  lastMessage: {
    content: String,
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: Date
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },

  // Blocked status
  blockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// Indexes
conversationSchema.index({ participants: 1 });
conversationSchema.index({ ride: 1 });
conversationSchema.index({ updatedAt: -1 });

// Instance Methods

// Update last message
conversationSchema.methods.updateLastMessage = async function(message) {
  this.lastMessage = {
    content: message.content.substring(0, 100),
    sender: message.sender,
    timestamp: message.createdAt
  };
  await this.save();
};

// Block conversation
conversationSchema.methods.block = async function(userId) {
  this.blockedBy = userId;
  await this.save();
};

// Unblock conversation
conversationSchema.methods.unblock = async function() {
  this.blockedBy = null;
  await this.save();
};

// Static Methods

// Find or create conversation between two users
conversationSchema.statics.findOrCreate = async function(user1Id, user2Id, rideId = null) {
  let conversation = await this.findOne({
    participants: { $all: [user1Id, user2Id] },
    ...(rideId && { ride: rideId })
  });

  if (!conversation) {
    conversation = await this.create({
      participants: [user1Id, user2Id],
      ride: rideId
    });
  }

  return conversation;
};

// Get user's conversations
conversationSchema.statics.getUserConversations = function(userId) {
  return this.find({
    participants: userId,
    isActive: true
  })
    .populate('participants', 'name profilePicture')
    .populate('ride', 'startLocation destination departureTime')
    .sort({ updatedAt: -1 });
};

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = { Message, Conversation };
