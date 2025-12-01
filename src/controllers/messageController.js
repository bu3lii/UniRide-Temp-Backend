/**
 * Message Controller
 * Handles in-app messaging with content moderation
 */

const { Message, Conversation, User, Notification } = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const moderationService = require('../services/moderationService');
const { sendMessage, emitToUser, sendNotification } = require('../services/socketService');

/**
 * Send a message
 * POST /api/v1/messages
 */
exports.sendMessage = asyncHandler(async (req, res, next) => {
  const { recipientId, content, rideId } = req.body;
  const sender = req.user;

  // Check if user can send messages
  const canSend = await moderationService.canUserSendMessages(sender._id);
  if (!canSend.allowed) {
    return next(new AppError(canSend.reason, 403));
  }

  // Verify recipient exists
  const recipient = await User.findById(recipientId);
  if (!recipient) {
    return next(new AppError('Recipient not found', 404));
  }

  // Cannot message yourself
  if (recipientId === sender._id.toString()) {
    return next(new AppError('You cannot message yourself', 400));
  }

  // Find or create conversation
  const conversation = await Conversation.findOrCreate(sender._id, recipientId, rideId);

  // Check if conversation is blocked
  if (conversation.blockedBy) {
    if (conversation.blockedBy.toString() === sender._id.toString()) {
      return next(new AppError('You have blocked this conversation', 400));
    } else {
      return next(new AppError('You cannot send messages to this user', 400));
    }
  }

  // Create message
  let message = await Message.create({
    conversation: conversation._id,
    sender: sender._id,
    content,
    messageType: 'text',
    metadata: {
      rideId: rideId || null
    }
  });

  // Moderate message content
  const moderationResult = await moderationService.moderateMessage(message, sender);

  // If severely moderated, don't send the message
  if (moderationResult.action === 'suspend') {
    return res.status(200).json({
      success: true,
      moderated: true,
      message: 'Your message could not be sent due to policy violations.'
    });
  }

  // Update conversation's last message
  await conversation.updateLastMessage(message);

  // Populate message for response
  await message.populate('sender', 'name profilePicture');

  // Prepare message for sending
  const messageData = {
    _id: message._id,
    conversationId: conversation._id,
    sender: {
      _id: sender._id,
      name: sender.name,
      profilePicture: sender.profilePicture
    },
    content: message.content,
    messageType: message.messageType,
    createdAt: message.createdAt,
    moderated: message.moderation.isModerated
  };

  // Send real-time message to recipient
  sendMessage(conversation._id.toString(), messageData, sender._id.toString());

  // Create notification for recipient
  const notification = await Notification.createNotification('new_message', recipientId, {
    conversationId: conversation._id,
    senderName: sender.name
  });

  // Send real-time notification
  sendNotification(recipientId, notification);

  // Response includes moderation info if warning issued
  const response = {
    success: true,
    data: {
      message: messageData,
      conversationId: conversation._id
    }
  };

  if (moderationResult.action === 'warning') {
    response.warning = 'Your message was flagged for policy violations. Please keep conversations respectful.';
  }

  res.status(201).json(response);
});

/**
 * Get conversations
 * GET /api/v1/messages/conversations
 */
exports.getConversations = asyncHandler(async (req, res, next) => {
  const conversations = await Conversation.getUserConversations(req.user._id);

  // Add unread count for each conversation
  const conversationsWithUnread = await Promise.all(
    conversations.map(async (conv) => {
      const unreadCount = await Message.getUnreadCount(req.user._id, conv._id);
      return {
        ...conv.toObject(),
        unreadCount
      };
    })
  );

  res.status(200).json({
    success: true,
    count: conversationsWithUnread.length,
    data: {
      conversations: conversationsWithUnread
    }
  });
});

/**
 * Get messages in a conversation
 * GET /api/v1/messages/conversations/:conversationId
 */
exports.getConversationMessages = asyncHandler(async (req, res, next) => {
  const { conversationId } = req.params;
  const { limit = 50, before } = req.query;

  // Verify user is part of conversation
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return next(new AppError('Conversation not found', 404));
  }

  if (!conversation.participants.includes(req.user._id)) {
    return next(new AppError('You are not part of this conversation', 403));
  }

  // Get messages
  const messages = await Message.getConversationMessages(
    conversationId,
    parseInt(limit),
    before ? new Date(before) : null
  );

  // Mark messages as read
  await Message.markAllAsRead(conversationId, req.user._id);

  res.status(200).json({
    success: true,
    count: messages.length,
    data: {
      messages: messages.reverse(), // Return in chronological order
      conversation
    }
  });
});

/**
 * Mark messages as read
 * PATCH /api/v1/messages/conversations/:conversationId/read
 */
exports.markAsRead = asyncHandler(async (req, res, next) => {
  const { conversationId } = req.params;

  // Verify user is part of conversation
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return next(new AppError('Conversation not found', 404));
  }

  if (!conversation.participants.includes(req.user._id)) {
    return next(new AppError('You are not part of this conversation', 403));
  }

  const result = await Message.markAllAsRead(conversationId, req.user._id);

  res.status(200).json({
    success: true,
    message: `${result.modifiedCount} messages marked as read`
  });
});

/**
 * Get unread message count
 * GET /api/v1/messages/unread
 */
exports.getUnreadCount = asyncHandler(async (req, res, next) => {
  const count = await Message.getUnreadCount(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      unreadCount: count
    }
  });
});

/**
 * Block/unblock conversation
 * PATCH /api/v1/messages/conversations/:conversationId/block
 */
exports.toggleBlock = asyncHandler(async (req, res, next) => {
  const { conversationId } = req.params;

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return next(new AppError('Conversation not found', 404));
  }

  if (!conversation.participants.includes(req.user._id)) {
    return next(new AppError('You are not part of this conversation', 403));
  }

  if (conversation.blockedBy) {
    // Only the blocker can unblock
    if (conversation.blockedBy.toString() !== req.user._id.toString()) {
      return next(new AppError('Only the user who blocked can unblock', 403));
    }
    await conversation.unblock();
    return res.status(200).json({
      success: true,
      message: 'Conversation unblocked'
    });
  } else {
    await conversation.block(req.user._id);
    return res.status(200).json({
      success: true,
      message: 'Conversation blocked'
    });
  }
});

/**
 * Delete conversation (hide from user)
 * DELETE /api/v1/messages/conversations/:conversationId
 */
exports.deleteConversation = asyncHandler(async (req, res, next) => {
  const { conversationId } = req.params;

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return next(new AppError('Conversation not found', 404));
  }

  if (!conversation.participants.includes(req.user._id)) {
    return next(new AppError('You are not part of this conversation', 403));
  }

  // Soft delete - mark as inactive for this user
  // In a full implementation, you'd track this per-user
  conversation.isActive = false;
  await conversation.save();

  res.status(200).json({
    success: true,
    message: 'Conversation deleted'
  });
});

/**
 * Send system message (internal use)
 */
exports.sendSystemMessage = async (conversationId, content, metadata = {}) => {
  const message = await Message.create({
    conversation: conversationId,
    sender: null, // System message has no sender
    content,
    messageType: 'system',
    metadata
  });

  const conversation = await Conversation.findById(conversationId);
  if (conversation) {
    await conversation.updateLastMessage(message);

    // Notify all participants
    for (const participantId of conversation.participants) {
      sendMessage(conversationId, {
        _id: message._id,
        conversationId,
        content,
        messageType: 'system',
        createdAt: message.createdAt
      });
    }
  }

  return message;
};

/**
 * Get user's moderation status
 * GET /api/v1/messages/moderation-status
 */
exports.getModerationStatus = asyncHandler(async (req, res, next) => {
  const status = await moderationService.getUserModerationHistory(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      canSendMessages: status.currentStatus === 'active',
      status
    }
  });
});
