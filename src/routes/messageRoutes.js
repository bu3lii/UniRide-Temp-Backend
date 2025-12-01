/**
 * Message Routes
 */

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { protect, checkMessagingPermission } = require('../middleware/auth');
const { messageValidation, validateMongoId } = require('../middleware/validation');

// All routes require authentication
router.use(protect);

// Get unread count
router.get('/unread', messageController.getUnreadCount);

// Get moderation status
router.get('/moderation-status', messageController.getModerationStatus);

// Conversations
router.get('/conversations', messageController.getConversations);
router.get('/conversations/:conversationId', validateMongoId('conversationId'), messageController.getConversationMessages);
router.patch('/conversations/:conversationId/read', validateMongoId('conversationId'), messageController.markAsRead);
router.patch('/conversations/:conversationId/block', validateMongoId('conversationId'), messageController.toggleBlock);
router.delete('/conversations/:conversationId', validateMongoId('conversationId'), messageController.deleteConversation);

// Send message (with moderation check)
router.post('/', checkMessagingPermission, messageValidation.send, messageController.sendMessage);

module.exports = router;
