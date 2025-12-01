/**
 * Notification Controller
 * Handles user notifications
 */

const { Notification } = require('../models');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

/**
 * Get user's notifications
 * GET /api/v1/notifications
 */
exports.getNotifications = asyncHandler(async (req, res, next) => {
  const { 
    unreadOnly = false, 
    type, 
    page = 1, 
    limit = 20 
  } = req.query;

  const options = {
    unreadOnly: unreadOnly === 'true',
    type,
    limit: parseInt(limit),
    skip: (parseInt(page) - 1) * parseInt(limit)
  };

  const notifications = await Notification.getUserNotifications(req.user._id, options);
  const unreadCount = await Notification.getUnreadCount(req.user._id);

  res.status(200).json({
    success: true,
    count: notifications.length,
    unreadCount,
    page: parseInt(page),
    data: {
      notifications
    }
  });
});

/**
 * Get unread notification count
 * GET /api/v1/notifications/unread-count
 */
exports.getUnreadCount = asyncHandler(async (req, res, next) => {
  const count = await Notification.getUnreadCount(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      unreadCount: count
    }
  });
});

/**
 * Mark notification as read
 * PATCH /api/v1/notifications/:id/read
 */
exports.markAsRead = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    recipient: req.user._id
  });

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  await notification.markAsRead();

  res.status(200).json({
    success: true,
    data: {
      notification
    }
  });
});

/**
 * Mark all notifications as read
 * PATCH /api/v1/notifications/read-all
 */
exports.markAllAsRead = asyncHandler(async (req, res, next) => {
  const result = await Notification.markAllAsRead(req.user._id);

  res.status(200).json({
    success: true,
    message: `${result.modifiedCount} notifications marked as read`
  });
});

/**
 * Delete a notification
 * DELETE /api/v1/notifications/:id
 */
exports.deleteNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipient: req.user._id
  });

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  res.status(200).json({
    success: true,
    message: 'Notification deleted'
  });
});

/**
 * Delete all read notifications
 * DELETE /api/v1/notifications/clear-read
 */
exports.clearReadNotifications = asyncHandler(async (req, res, next) => {
  const result = await Notification.deleteMany({
    recipient: req.user._id,
    isRead: true
  });

  res.status(200).json({
    success: true,
    message: `${result.deletedCount} notifications deleted`
  });
});
