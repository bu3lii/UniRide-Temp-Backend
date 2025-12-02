/**
 * Models Index
 * Central export for all database models
 * 
 * UPDATED: Added Payment models (Wallet, Transaction, RidePayment)
 */

const User = require('./User');
const Ride = require('./Ride');
const Booking = require('./Booking');
const Review = require('./Review');
const { Message, Conversation } = require('./Message');
const Notification = require('./Notification');
const { Wallet, Transaction, RidePayment } = require('./Payment');

module.exports = {
  User,
  Ride,
  Booking,
  Review,
  Message,
  Conversation,
  Notification,
  // Payment models
  Wallet,
  Transaction,
  RidePayment
};