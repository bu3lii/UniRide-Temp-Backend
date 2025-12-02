/**
 * Payment Service
 * Handles payment processing, cost splitting, and wallet management
 * 
 * Key Features:
 * - Automatic cost splitting among passengers
 * - Wallet management (top-up, withdrawal)
 * - Ride payment collection
 * - Driver earnings disbursement
 * - Refund processing
 */

const { Wallet, Transaction, RidePayment } = require('../models/Payment');
const { Booking, Ride, User, Notification } = require('../models/models-index');
const config = require('../config');
const logger = require('../utils/logger');
const { emitToUser } = require('./socketService');

class PaymentService {
  constructor() {
    // Platform fee percentage (configurable)
    this.platformFeePercentage = config.payment?.platformFeePercentage || 10;
    
    // Minimum wallet balance for rides
    this.minimumBalance = config.payment?.minimumBalance || 0;
    
    // Currency
    this.currency = 'BHD';
  }

  // ============================================
  // WALLET OPERATIONS
  // ============================================

  /**
   * Get or create wallet for user
   */
  async getWallet(userId) {
    return Wallet.findOrCreateForUser(userId);
  }

  /**
   * Get wallet balance
   */
  async getBalance(userId) {
    const wallet = await this.getWallet(userId);
    return {
      balance: wallet.balance,
      pendingBalance: wallet.pendingBalance,
      totalBalance: wallet.balance + wallet.pendingBalance,
      currency: wallet.currency,
      status: wallet.status
    };
  }

  /**
   * Top up wallet (add funds)
   * In production, this would integrate with a payment gateway
   */
  async topUpWallet(userId, amount, paymentMethod = {}) {
    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    const transaction = await Transaction.createWithWalletUpdate({
      type: 'top_up',
      amount,
      direction: 'credit',
      user: userId,
      paymentMethod,
      description: `Wallet top-up via ${paymentMethod.type || 'unknown'}`
    });

    // Notify user
    await Notification.createNotification('payment_received', userId, {
      amount,
      message: `${amount} ${this.currency} added to your wallet`
    });

    emitToUser(userId.toString(), 'wallet:updated', {
      balance: transaction.balanceAfter,
      type: 'top_up',
      amount
    });

    logger.info(`Wallet topped up for user ${userId}: ${amount} ${this.currency}`);

    return {
      transactionId: transaction.transactionId,
      amount,
      newBalance: transaction.balanceAfter
    };
  }

  /**
   * Withdraw from wallet
   * In production, this would integrate with bank transfer
   */
  async withdrawFromWallet(userId, amount, withdrawalDetails = {}) {
    const wallet = await this.getWallet(userId);

    if (!wallet.canDebit(amount)) {
      throw new Error('Insufficient balance for withdrawal');
    }

    const transaction = await Transaction.createWithWalletUpdate({
      type: 'withdrawal',
      amount,
      direction: 'debit',
      user: userId,
      paymentMethod: withdrawalDetails,
      description: `Withdrawal to ${withdrawalDetails.type || 'bank account'}`
    });

    emitToUser(userId.toString(), 'wallet:updated', {
      balance: transaction.balanceAfter,
      type: 'withdrawal',
      amount
    });

    logger.info(`Withdrawal processed for user ${userId}: ${amount} ${this.currency}`);

    return {
      transactionId: transaction.transactionId,
      amount,
      newBalance: transaction.balanceAfter,
      status: 'processing' // In production, withdrawals might be pending
    };
  }

  // ============================================
  // COST SPLITTING
  // ============================================

  /**
   * Calculate cost split for a ride
   * Returns breakdown of what each passenger pays and driver earns
   */
  async calculateRideCostSplit(rideId) {
    const ride = await Ride.findById(rideId).populate('driver', 'name');
    if (!ride) {
      throw new Error('Ride not found');
    }

    const bookings = await Booking.find({
      ride: rideId,
      status: { $in: ['confirmed', 'completed'] }
    }).populate('passenger', 'name');

    if (bookings.length === 0) {
      return {
        ride: {
          id: ride._id,
          pricePerSeat: ride.pricePerSeat,
          totalSeats: ride.totalSeats,
          bookedSeats: 0
        },
        breakdown: {
          totalFromPassengers: 0,
          platformFee: 0,
          platformFeePercentage: this.platformFeePercentage,
          driverEarnings: 0
        },
        passengers: []
      };
    }

    const passengers = bookings.map(booking => ({
      passengerId: booking.passenger._id,
      passengerName: booking.passenger.name,
      bookingId: booking._id,
      seatsBooked: booking.seatsBooked,
      amountDue: ride.pricePerSeat * booking.seatsBooked,
      paymentStatus: booking.paymentStatus
    }));

    const totalFromPassengers = passengers.reduce((sum, p) => sum + p.amountDue, 0);
    const platformFee = Number((totalFromPassengers * (this.platformFeePercentage / 100)).toFixed(3));
    const driverEarnings = Number((totalFromPassengers - platformFee).toFixed(3));
    const bookedSeats = passengers.reduce((sum, p) => sum + p.seatsBooked, 0);

    return {
      ride: {
        id: ride._id,
        pricePerSeat: ride.pricePerSeat,
        totalSeats: ride.totalSeats,
        bookedSeats,
        driver: {
          id: ride.driver._id,
          name: ride.driver.name
        }
      },
      breakdown: {
        totalFromPassengers,
        platformFee,
        platformFeePercentage: this.platformFeePercentage,
        driverEarnings,
        currency: this.currency
      },
      passengers
    };
  }

  /**
   * Preview cost split before booking
   * Shows user what they'll pay before confirming
   */
  async previewBookingCost(rideId, seatsRequested) {
    const ride = await Ride.findById(rideId);
    if (!ride) {
      throw new Error('Ride not found');
    }

    const costPerSeat = ride.pricePerSeat;
    const totalCost = costPerSeat * seatsRequested;

    return {
      pricePerSeat: costPerSeat,
      seatsRequested,
      totalCost,
      currency: this.currency,
      breakdown: {
        basePrice: totalCost,
        serviceFee: 0, // Can add service fee for passengers if needed
        total: totalCost
      }
    };
  }

  // ============================================
  // RIDE PAYMENT PROCESSING
  // ============================================

  /**
   * Initialize payment record for a ride
   * Called when ride is created or first booking is made
   */
  async initializeRidePayment(rideId) {
    const ridePayment = await RidePayment.createForRide(rideId);
    logger.info(`Ride payment initialized for ride ${rideId}`);
    return ridePayment;
  }

  /**
   * Update ride payment when new booking is made
   */
  async addBookingToRidePayment(rideId, bookingId) {
    const ride = await Ride.findById(rideId);
    const booking = await Booking.findById(bookingId);

    if (!ride || !booking) {
      throw new Error('Ride or booking not found');
    }

    let ridePayment = await RidePayment.findOne({ ride: rideId });
    
    if (!ridePayment) {
      ridePayment = await this.initializeRidePayment(rideId);
    } else {
      // Recalculate with new booking
      const costSplit = await RidePayment.calculateCostSplit(rideId);
      ridePayment.totalAmount = costSplit.totalAmount;
      ridePayment.platformFee = costSplit.platformFee;
      ridePayment.driverEarnings = costSplit.driverEarnings;
      ridePayment.passengerPayments = costSplit.passengerPayments;
      await ridePayment.save();
    }

    return ridePayment;
  }

  /**
   * Check if passenger has sufficient balance for booking
   */
  async checkPaymentEligibility(userId, rideId, seatsRequested) {
    const wallet = await this.getWallet(userId);
    const preview = await this.previewBookingCost(rideId, seatsRequested);

    const hasBalance = wallet.canDebit(preview.totalCost);
    const shortfall = hasBalance ? 0 : preview.totalCost - wallet.balance;

    return {
      eligible: hasBalance,
      required: preview.totalCost,
      currentBalance: wallet.balance,
      shortfall,
      currency: this.currency
    };
  }

  /**
   * Process payment for a single booking
   * Called when passenger confirms booking with in-app payment
   */
  async processBookingPayment(bookingId) {
    const booking = await Booking.findById(bookingId)
      .populate('ride')
      .populate('passenger');

    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.paymentStatus === 'paid') {
      throw new Error('Booking already paid');
    }

    const wallet = await this.getWallet(booking.passenger._id);
    
    if (!wallet.canDebit(booking.totalAmount)) {
      throw new Error('Insufficient wallet balance');
    }

    // Create transaction
    const transaction = await Transaction.createWithWalletUpdate({
      type: 'ride_payment',
      amount: booking.totalAmount,
      direction: 'debit',
      user: booking.passenger._id,
      relatedRide: booking.ride._id,
      relatedBooking: booking._id,
      toUser: booking.ride.driver,
      description: `Payment for ride to ${booking.ride.destination.address}`
    });

    // Update booking
    booking.paymentStatus = 'paid';
    booking.paymentMethod = 'in_app';
    await booking.save();

    // Update ride payment record
    const ridePayment = await RidePayment.findOne({ ride: booking.ride._id });
    if (ridePayment) {
      const passengerPayment = ridePayment.passengerPayments.find(
        p => p.booking.toString() === bookingId.toString()
      );
      if (passengerPayment) {
        passengerPayment.status = 'paid';
        passengerPayment.paidAt = new Date();
        passengerPayment.transactionId = transaction._id;
        await ridePayment.save();
      }
    }

    // Notify passenger
    emitToUser(booking.passenger._id.toString(), 'payment:completed', {
      bookingId,
      amount: booking.totalAmount,
      newBalance: transaction.balanceAfter
    });

    logger.info(`Payment processed for booking ${bookingId}: ${booking.totalAmount} ${this.currency}`);

    return {
      transactionId: transaction.transactionId,
      amount: booking.totalAmount,
      newBalance: transaction.balanceAfter
    };
  }

  /**
   * Collect all payments for a ride
   * Called when ride is about to start or has started
   */
  async collectRidePayments(rideId) {
    let ridePayment = await RidePayment.findOne({ ride: rideId });
    
    if (!ridePayment) {
      ridePayment = await this.initializeRidePayment(rideId);
    }

    const results = await ridePayment.collectPayments();

    // Notify driver about collection status
    const ride = await Ride.findById(rideId);
    emitToUser(ride.driver.toString(), 'payments:collected', {
      rideId,
      successful: results.successful.length,
      failed: results.failed.length,
      totalCollected: results.successful.reduce((sum, s) => sum + s.amount, 0)
    });

    return results;
  }

  /**
   * Pay driver after ride completion
   */
  async payDriverForRide(rideId) {
    const ridePayment = await RidePayment.findOne({ ride: rideId });
    
    if (!ridePayment) {
      throw new Error('Ride payment record not found');
    }

    // Ensure all payments are collected first
    if (ridePayment.status === 'pending' || ridePayment.status === 'collecting') {
      await this.collectRidePayments(rideId);
      await ridePayment.reload();
    }

    if (ridePayment.status !== 'collected') {
      throw new Error('Not all payments collected yet');
    }

    const result = await ridePayment.payDriver();

    // Notify driver
    await Notification.createNotification('payment_received', ridePayment.driver, {
      amount: result.driverEarnings,
      message: `You earned ${result.driverEarnings} ${this.currency} from your ride`
    });

    emitToUser(ridePayment.driver.toString(), 'earnings:received', {
      rideId,
      amount: result.driverEarnings,
      platformFee: result.platformFee
    });

    logger.info(`Driver paid for ride ${rideId}: ${result.driverEarnings} ${this.currency}`);

    return result;
  }

  // ============================================
  // REFUNDS
  // ============================================

  /**
   * Process refund for cancelled booking
   */
  async refundBooking(bookingId, reason = 'Booking cancelled') {
    const booking = await Booking.findById(bookingId).populate('ride');
    
    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.paymentStatus !== 'paid') {
      // No payment to refund
      return { refunded: false, reason: 'No payment was made' };
    }

    const ridePayment = await RidePayment.findOne({ ride: booking.ride._id });
    
    if (ridePayment) {
      const result = await ridePayment.refundPassenger(booking.passenger, reason);

      // Notify passenger
      await Notification.createNotification('payment_received', booking.passenger, {
        amount: result.refundedAmount,
        message: `Refund of ${result.refundedAmount} ${this.currency}: ${reason}`
      });

      emitToUser(booking.passenger.toString(), 'refund:processed', {
        bookingId,
        amount: result.refundedAmount,
        reason
      });

      logger.info(`Refund processed for booking ${bookingId}: ${result.refundedAmount} ${this.currency}`);

      return {
        refunded: true,
        amount: result.refundedAmount
      };
    }

    // Fallback: direct refund without ride payment record
    const transaction = await Transaction.createWithWalletUpdate({
      type: 'refund',
      amount: booking.totalAmount,
      direction: 'credit',
      user: booking.passenger,
      relatedBooking: bookingId,
      relatedRide: booking.ride._id,
      description: `Refund: ${reason}`
    });

    booking.paymentStatus = 'refunded';
    await booking.save();

    return {
      refunded: true,
      amount: booking.totalAmount,
      transactionId: transaction.transactionId
    };
  }

  /**
   * Process full ride cancellation refunds
   * Called when driver cancels ride
   */
  async refundAllPassengers(rideId, reason = 'Ride cancelled by driver') {
    const bookings = await Booking.find({
      ride: rideId,
      paymentStatus: 'paid'
    });

    const results = {
      successful: [],
      failed: []
    };

    for (const booking of bookings) {
      try {
        const result = await this.refundBooking(booking._id, reason);
        if (result.refunded) {
          results.successful.push({
            passengerId: booking.passenger,
            amount: result.amount
          });
        }
      } catch (error) {
        results.failed.push({
          passengerId: booking.passenger,
          reason: error.message
        });
      }
    }

    logger.info(`Ride ${rideId} refunds: ${results.successful.length} successful, ${results.failed.length} failed`);

    return results;
  }

  // ============================================
  // TRANSACTION HISTORY
  // ============================================

  /**
   * Get user's transaction history
   */
  async getTransactionHistory(userId, options = {}) {
    const transactions = await Transaction.getUserHistory(userId, options);
    const total = await Transaction.countDocuments({ user: userId });

    return {
      transactions,
      total,
      page: Math.floor((options.skip || 0) / (options.limit || 50)) + 1,
      pages: Math.ceil(total / (options.limit || 50))
    };
  }

  /**
   * Get earnings summary for driver
   */
  async getDriverEarnings(driverId, period = 'all') {
    const matchStage = {
      user: new mongoose.Types.ObjectId(driverId),
      type: 'ride_earning',
      status: 'completed'
    };

    // Add date filter based on period
    const now = new Date();
    if (period === 'today') {
      matchStage.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchStage.createdAt = { $gte: weekAgo };
    } else if (period === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchStage.createdAt = { $gte: monthAgo };
    }

    const result = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$amount' },
          rideCount: { $sum: 1 }
        }
      }
    ]);

    const wallet = await this.getWallet(driverId);

    return {
      period,
      totalEarnings: result.length > 0 ? result[0].totalEarnings : 0,
      rideCount: result.length > 0 ? result[0].rideCount : 0,
      currentBalance: wallet.balance,
      pendingBalance: wallet.pendingBalance,
      currency: this.currency
    };
  }

  /**
   * Get spending summary for passenger
   */
  async getPassengerSpending(passengerId, period = 'all') {
    const matchStage = {
      user: new mongoose.Types.ObjectId(passengerId),
      type: 'ride_payment',
      status: 'completed'
    };

    const now = new Date();
    if (period === 'today') {
      matchStage.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchStage.createdAt = { $gte: weekAgo };
    } else if (period === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchStage.createdAt = { $gte: monthAgo };
    }

    const result = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$amount' },
          rideCount: { $sum: 1 }
        }
      }
    ]);

    const wallet = await this.getWallet(passengerId);

    return {
      period,
      totalSpent: result.length > 0 ? result[0].totalSpent : 0,
      rideCount: result.length > 0 ? result[0].rideCount : 0,
      currentBalance: wallet.balance,
      currency: this.currency
    };
  }
}

// Add mongoose import at top (needed for ObjectId)
const mongoose = require('mongoose');

module.exports = new PaymentService();