/**
 * Models Index
 * Central export for all database models
 */

const User = require('./User');
const Ride = require('./Ride');
const Booking = require('./Booking');
const Review = require('./Review');
const { Message, Conversation } = require('./Message');
const Notification = require('./Notification');

module.exports = {
  User,
  Ride,
  Booking,
  Review,
  Message,
  Conversation,
  Notification
};
