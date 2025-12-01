/**
 * Notification Routes
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');
const { validateMongoId } = require('../middleware/validation');

// All routes require authentication
router.use(protect);

// Get notifications
router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);

// Mark as read
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', validateMongoId('id'), notificationController.markAsRead);

// Delete
router.delete('/clear-read', notificationController.clearReadNotifications);
router.delete('/:id', validateMongoId('id'), notificationController.deleteNotification);

module.exports = router;
