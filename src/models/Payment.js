/**
 * Payment Model
 * Handles wallet, transactions, and cost splitting for rides
 * 
 * Cost Splitting Logic:
 * - Total ride cost is divided equally among all passengers
 * - Each passenger pays: (pricePerSeat * seatsBooked)
 * - Driver receives: sum of all passenger payments minus platform fee
 */

const mongoose = require('mongoose');

// ============================================
// WALLET SCHEMA - User's payment wallet
// ============================================
const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // Balance in BHD (Bahraini Dinar)
  balance: {
    type: Number,
    default: 0,
    min: [0, 'Balance cannot be negative']
  },

  // Pending balance (from completed rides, awaiting clearance)
  pendingBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  // Currency
  currency: {
    type: String,
    default: 'BHD'
  },

  // Wallet status
  status: {
    type: String,
    enum: ['active', 'frozen', 'suspended'],
    default: 'active'
  },

  // Last activity
  lastTransactionAt: {
    type: Date
  }
}, {
  timestamps: true
});

// ============================================
// TRANSACTION SCHEMA - Payment records
// ============================================
const transactionSchema = new mongoose.Schema({
  // Transaction ID (human-readable)
  transactionId: {
    type: String,
    unique: true,
    required: true
  },

  // Transaction type
  type: {
    type: String,
    enum: [
      'top_up',           // Add money to wallet
      'withdrawal',       // Withdraw from wallet
      'ride_payment',     // Passenger pays for ride
      'ride_earning',     // Driver receives from ride
      'refund',           // Refund to passenger
      'platform_fee',     // Platform commission
      'bonus',            // Promotional bonus
      'penalty'           // Penalty deduction
    ],
    required: true
  },

  // Amount (positive for credit, stored as absolute value)
  amount: {
    type: Number,
    required: true,
    min: [0.001, 'Amount must be greater than 0']
  },

  // Direction
  direction: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },

  // Currency
  currency: {
    type: String,
    default: 'BHD'
  },

  // User involved
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Related entities
  relatedRide: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride'
  },
  relatedBooking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },

  // For transfers between users
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending'
  },

  // Balance after transaction
  balanceAfter: {
    type: Number
  },

  // Description
  description: {
    type: String,
    maxlength: 500
  },

  // Payment method details (for top-ups)
  paymentMethod: {
    type: {
      type: String,
      enum: ['card', 'bank_transfer', 'benefit_pay', 'wallet']
    },
    last4: String,        // Last 4 digits of card
    brand: String,        // Visa, Mastercard, etc.
    externalId: String    // External payment provider ID
  },

  // Metadata for additional info
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },

  // Processing timestamps
  processedAt: Date,
  failedAt: Date,
  failureReason: String
}, {
  timestamps: true
});

// ============================================
// RIDE PAYMENT SCHEMA - Cost split details per ride
// ============================================
const ridePaymentSchema = new mongoose.Schema({
  ride: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    required: true,
    unique: true
  },

  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Total ride cost (sum of all passenger payments)
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },

  // Platform fee (percentage of total)
  platformFee: {
    type: Number,
    default: 0
  },

  platformFeePercentage: {
    type: Number,
    default: 10  // 10% default
  },

  // Net amount to driver
  driverEarnings: {
    type: Number,
    required: true
  },

  // Payment status
  status: {
    type: String,
    enum: ['pending', 'collecting', 'collected', 'paid_to_driver', 'partially_refunded', 'fully_refunded'],
    default: 'pending'
  },

  // Individual passenger payments
  passengerPayments: [{
    passenger: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true
    },
    seatsBooked: {
      type: Number,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'failed'],
      default: 'pending'
    },
    paidAt: Date,
    refundedAt: Date,
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction'
    }
  }],

  // Timestamps
  collectionStartedAt: Date,
  collectionCompletedAt: Date,
  driverPaidAt: Date
}, {
  timestamps: true
});

// ============================================
// INDEXES
// ============================================
walletSchema.index({ user: 1 });
walletSchema.index({ status: 1 });

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ relatedRide: 1 });
transactionSchema.index({ relatedBooking: 1 });

ridePaymentSchema.index({ ride: 1 });
ridePaymentSchema.index({ driver: 1 });
ridePaymentSchema.index({ status: 1 });

// ============================================
// WALLET METHODS
// ============================================

// Credit wallet
walletSchema.methods.credit = async function(amount, description = '') {
  if (this.status !== 'active') {
    throw new Error('Wallet is not active');
  }
  this.balance += amount;
  this.lastTransactionAt = new Date();
  await this.save();
  return this.balance;
};

// Debit wallet
walletSchema.methods.debit = async function(amount, description = '') {
  if (this.status !== 'active') {
    throw new Error('Wallet is not active');
  }
  if (this.balance < amount) {
    throw new Error('Insufficient balance');
  }
  this.balance -= amount;
  this.lastTransactionAt = new Date();
  await this.save();
  return this.balance;
};

// Check if can debit
walletSchema.methods.canDebit = function(amount) {
  return this.status === 'active' && this.balance >= amount;
};

// Move pending to available
walletSchema.methods.clearPendingBalance = async function(amount) {
  if (this.pendingBalance < amount) {
    throw new Error('Insufficient pending balance');
  }
  this.pendingBalance -= amount;
  this.balance += amount;
  await this.save();
  return this.balance;
};

// ============================================
// WALLET STATICS
// ============================================

// Find or create wallet for user
walletSchema.statics.findOrCreateForUser = async function(userId) {
  let wallet = await this.findOne({ user: userId });
  if (!wallet) {
    wallet = await this.create({ user: userId });
  }
  return wallet;
};

// ============================================
// TRANSACTION METHODS
// ============================================

// Generate unique transaction ID
transactionSchema.statics.generateTransactionId = function() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN-${timestamp}-${random}`;
};

// Create transaction with wallet update
transactionSchema.statics.createWithWalletUpdate = async function(data) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const Wallet = mongoose.model('Wallet');
    const wallet = await Wallet.findOrCreateForUser(data.user);

    // Generate transaction ID
    const transactionId = this.generateTransactionId();

    let balanceAfter;

    if (data.direction === 'credit') {
      balanceAfter = await wallet.credit(data.amount);
    } else {
      balanceAfter = await wallet.debit(data.amount);
    }

    const transaction = await this.create([{
      ...data,
      transactionId,
      balanceAfter,
      status: 'completed',
      processedAt: new Date()
    }], { session });

    await session.commitTransaction();
    return transaction[0];
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Get user transaction history
transactionSchema.statics.getUserHistory = function(userId, options = {}) {
  const query = { user: userId };
  
  if (options.type) query.type = options.type;
  if (options.status) query.status = options.status;
  if (options.startDate) query.createdAt = { $gte: options.startDate };
  if (options.endDate) {
    query.createdAt = query.createdAt || {};
    query.createdAt.$lte = options.endDate;
  }

  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50)
    .skip(options.skip || 0);
};

// ============================================
// RIDE PAYMENT METHODS
// ============================================

// Calculate cost split for a ride
ridePaymentSchema.statics.calculateCostSplit = async function(rideId) {
  const Ride = mongoose.model('Ride');
  const Booking = mongoose.model('Booking');

  const ride = await Ride.findById(rideId);
  if (!ride) throw new Error('Ride not found');

  const bookings = await Booking.find({
    ride: rideId,
    status: { $in: ['confirmed', 'completed'] }
  });

  if (bookings.length === 0) {
    return {
      totalAmount: 0,
      platformFee: 0,
      driverEarnings: 0,
      passengerPayments: []
    };
  }

  const passengerPayments = bookings.map(booking => ({
    passenger: booking.passenger,
    booking: booking._id,
    seatsBooked: booking.seatsBooked,
    amount: ride.pricePerSeat * booking.seatsBooked,
    status: 'pending'
  }));

  const totalAmount = passengerPayments.reduce((sum, p) => sum + p.amount, 0);
  const platformFeePercentage = 10; // 10% platform fee
  const platformFee = totalAmount * (platformFeePercentage / 100);
  const driverEarnings = totalAmount - platformFee;

  return {
    totalAmount,
    platformFee,
    platformFeePercentage,
    driverEarnings,
    passengerPayments
  };
};

// Create or update ride payment record
ridePaymentSchema.statics.createForRide = async function(rideId) {
  const Ride = mongoose.model('Ride');
  const ride = await Ride.findById(rideId);
  
  if (!ride) throw new Error('Ride not found');

  const costSplit = await this.calculateCostSplit(rideId);

  const ridePayment = await this.findOneAndUpdate(
    { ride: rideId },
    {
      ride: rideId,
      driver: ride.driver,
      ...costSplit
    },
    { upsert: true, new: true }
  );

  return ridePayment;
};

// Process all passenger payments for a ride
ridePaymentSchema.methods.collectPayments = async function() {
  const Transaction = mongoose.model('Transaction');
  const Wallet = mongoose.model('Wallet');
  const Booking = mongoose.model('Booking');

  this.status = 'collecting';
  this.collectionStartedAt = new Date();
  await this.save();

  const results = {
    successful: [],
    failed: []
  };

  for (const payment of this.passengerPayments) {
    if (payment.status === 'paid') continue;

    try {
      const wallet = await Wallet.findOrCreateForUser(payment.passenger);
      
      if (!wallet.canDebit(payment.amount)) {
        payment.status = 'failed';
        results.failed.push({
          passenger: payment.passenger,
          reason: 'Insufficient balance'
        });
        continue;
      }

      // Create transaction
      const transaction = await Transaction.createWithWalletUpdate({
        type: 'ride_payment',
        amount: payment.amount,
        direction: 'debit',
        user: payment.passenger,
        relatedRide: this.ride,
        relatedBooking: payment.booking,
        toUser: this.driver,
        description: `Payment for ride ${this.ride}`
      });

      payment.status = 'paid';
      payment.paidAt = new Date();
      payment.transactionId = transaction._id;

      // Update booking payment status
      await Booking.findByIdAndUpdate(payment.booking, {
        paymentStatus: 'paid',
        paymentMethod: 'in_app'
      });

      results.successful.push({
        passenger: payment.passenger,
        amount: payment.amount
      });
    } catch (error) {
      payment.status = 'failed';
      results.failed.push({
        passenger: payment.passenger,
        reason: error.message
      });
    }
  }

  // Check if all payments collected
  const allPaid = this.passengerPayments.every(p => p.status === 'paid');
  if (allPaid) {
    this.status = 'collected';
    this.collectionCompletedAt = new Date();
  }

  await this.save();
  return results;
};

// Pay driver after ride completion
ridePaymentSchema.methods.payDriver = async function() {
  if (this.status !== 'collected') {
    throw new Error('Payments not yet collected from all passengers');
  }

  const Transaction = mongoose.model('Transaction');
  const Wallet = mongoose.model('Wallet');

  // Credit driver's wallet
  const driverWallet = await Wallet.findOrCreateForUser(this.driver);
  
  // Add to pending balance first (can implement clearance period)
  driverWallet.pendingBalance += this.driverEarnings;
  await driverWallet.save();

  // Immediately clear for now (in production, might have a delay)
  await driverWallet.clearPendingBalance(this.driverEarnings);

  // Create earning transaction
  await Transaction.createWithWalletUpdate({
    type: 'ride_earning',
    amount: this.driverEarnings,
    direction: 'credit',
    user: this.driver,
    relatedRide: this.ride,
    description: `Earnings from ride ${this.ride}`
  });

  // Create platform fee transaction (internal)
  await Transaction.create({
    transactionId: Transaction.generateTransactionId(),
    type: 'platform_fee',
    amount: this.platformFee,
    direction: 'credit',
    user: this.driver, // Associated with driver for tracking
    relatedRide: this.ride,
    status: 'completed',
    description: `Platform fee for ride ${this.ride}`
  });

  this.status = 'paid_to_driver';
  this.driverPaidAt = new Date();
  await this.save();

  return {
    driverEarnings: this.driverEarnings,
    platformFee: this.platformFee
  };
};

// Process refund for a passenger
ridePaymentSchema.methods.refundPassenger = async function(passengerId, reason = 'Ride cancelled') {
  const Transaction = mongoose.model('Transaction');
  const Booking = mongoose.model('Booking');

  const payment = this.passengerPayments.find(
    p => p.passenger.toString() === passengerId.toString()
  );

  if (!payment) {
    throw new Error('Passenger payment not found');
  }

  if (payment.status !== 'paid') {
    throw new Error('Payment was not completed, cannot refund');
  }

  // Create refund transaction
  await Transaction.createWithWalletUpdate({
    type: 'refund',
    amount: payment.amount,
    direction: 'credit',
    user: payment.passenger,
    relatedRide: this.ride,
    relatedBooking: payment.booking,
    description: `Refund: ${reason}`
  });

  payment.status = 'refunded';
  payment.refundedAt = new Date();

  // Update booking
  await Booking.findByIdAndUpdate(payment.booking, {
    paymentStatus: 'refunded'
  });

  // Update ride payment status
  const hasRefunds = this.passengerPayments.some(p => p.status === 'refunded');
  const allRefunded = this.passengerPayments.every(p => p.status === 'refunded');
  
  if (allRefunded) {
    this.status = 'fully_refunded';
  } else if (hasRefunds) {
    this.status = 'partially_refunded';
  }

  await this.save();

  return { refundedAmount: payment.amount };
};

// ============================================
// CREATE MODELS
// ============================================
const Wallet = mongoose.model('Wallet', walletSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const RidePayment = mongoose.model('RidePayment', ridePaymentSchema);

module.exports = {
  Wallet,
  Transaction,
  RidePayment
};