/**
 * Payment Controller
 * Handles all payment-related API endpoints
 * 
 * Endpoints:
 * - Wallet management (balance, top-up, withdrawal)
 * - Cost splitting preview
 * - Payment processing
 * - Refunds
 * - Transaction history
 * - Earnings/spending summaries
 */

const paymentService = require('../services/paymentService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const { Ride, Booking } = require('../models/models-index');

// ============================================
// WALLET ENDPOINTS
// ============================================

/**
 * Get wallet balance
 * GET /api/v1/payments/wallet
 */
exports.getWalletBalance = asyncHandler(async (req, res, next) => {
  const balance = await paymentService.getBalance(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      wallet: balance
    }
  });
});

/**
 * Top up wallet
 * POST /api/v1/payments/wallet/top-up
 * 
 * Body: { amount, paymentMethod: { type, cardNumber, expiryDate, cvv } }
 * 
 * Note: In production, this would integrate with a payment gateway like Stripe
 * For now, it simulates the top-up process
 */
exports.topUpWallet = asyncHandler(async (req, res, next) => {
  const { amount, paymentMethod } = req.body;

  if (!amount || amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  if (amount > 500) {
    return next(new AppError('Maximum top-up amount is 500 BHD', 400));
  }

  // In production, validate and process with payment gateway here
  // For demo, we'll simulate successful payment
  const paymentDetails = {
    type: paymentMethod?.type || 'card',
    last4: paymentMethod?.cardNumber?.slice(-4) || '0000',
    brand: 'Visa', // Would be detected from card number
    externalId: `sim_${Date.now()}` // Simulated external ID
  };

  const result = await paymentService.topUpWallet(
    req.user._id,
    amount,
    paymentDetails
  );

  res.status(200).json({
    success: true,
    message: `Successfully added ${amount} BHD to your wallet`,
    data: {
      transactionId: result.transactionId,
      amount: result.amount,
      newBalance: result.newBalance,
      currency: 'BHD'
    }
  });
});

/**
 * Withdraw from wallet
 * POST /api/v1/payments/wallet/withdraw
 * 
 * Body: { amount, withdrawalMethod: { type, bankName, accountNumber, iban } }
 */
exports.withdrawFromWallet = asyncHandler(async (req, res, next) => {
  const { amount, withdrawalMethod } = req.body;

  if (!amount || amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  if (amount < 5) {
    return next(new AppError('Minimum withdrawal amount is 5 BHD', 400));
  }

  // Validate withdrawal method
  if (!withdrawalMethod?.iban && !withdrawalMethod?.accountNumber) {
    return next(new AppError('Bank account details required', 400));
  }

  const result = await paymentService.withdrawFromWallet(
    req.user._id,
    amount,
    {
      type: withdrawalMethod?.type || 'bank_transfer',
      bankName: withdrawalMethod?.bankName,
      accountNumber: withdrawalMethod?.accountNumber,
      iban: withdrawalMethod?.iban
    }
  );

  res.status(200).json({
    success: true,
    message: 'Withdrawal request submitted. Funds will be transferred within 1-3 business days.',
    data: {
      transactionId: result.transactionId,
      amount: result.amount,
      newBalance: result.newBalance,
      status: result.status
    }
  });
});

// ============================================
// COST SPLITTING ENDPOINTS
// ============================================

/**
 * Get cost split breakdown for a ride
 * GET /api/v1/payments/rides/:rideId/cost-split
 */
exports.getRideCostSplit = asyncHandler(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findById(rideId);
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Only driver or booked passengers can see full breakdown
  const isDriver = ride.driver.toString() === req.user._id.toString();
  const booking = await Booking.findOne({
    ride: rideId,
    passenger: req.user._id,
    status: { $in: ['confirmed', 'completed'] }
  });

  if (!isDriver && !booking) {
    return next(new AppError('You can only view cost split for your own rides', 403));
  }

  const costSplit = await paymentService.calculateRideCostSplit(rideId);

  // If passenger, only show their portion
  if (!isDriver) {
    const myPayment = costSplit.passengers.find(
      p => p.passengerId.toString() === req.user._id.toString()
    );
    
    return res.status(200).json({
      success: true,
      data: {
        ride: costSplit.ride,
        myPayment: myPayment || null,
        totalPassengers: costSplit.passengers.length
      }
    });
  }

  // Driver sees full breakdown
  res.status(200).json({
    success: true,
    data: costSplit
  });
});

/**
 * Preview booking cost before confirming
 * GET /api/v1/payments/rides/:rideId/preview?seats=1
 */
exports.previewBookingCost = asyncHandler(async (req, res, next) => {
  const { rideId } = req.params;
  const seats = parseInt(req.query.seats) || 1;

  if (seats < 1 || seats > 4) {
    return next(new AppError('Seats must be between 1 and 4', 400));
  }

  const ride = await Ride.findById(rideId);
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (ride.availableSeats < seats) {
    return next(new AppError(`Only ${ride.availableSeats} seats available`, 400));
  }

  const preview = await paymentService.previewBookingCost(rideId, seats);
  
  // Check user's wallet balance
  const eligibility = await paymentService.checkPaymentEligibility(
    req.user._id,
    rideId,
    seats
  );

  res.status(200).json({
    success: true,
    data: {
      ...preview,
      walletBalance: eligibility.currentBalance,
      canPayWithWallet: eligibility.eligible,
      shortfall: eligibility.shortfall
    }
  });
});

// ============================================
// PAYMENT PROCESSING ENDPOINTS
// ============================================

/**
 * Pay for a booking using wallet
 * POST /api/v1/payments/bookings/:bookingId/pay
 */
exports.payForBooking = asyncHandler(async (req, res, next) => {
  const { bookingId } = req.params;

  const booking = await Booking.findById(bookingId).populate('ride');
  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Verify ownership
  if (booking.passenger.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only pay for your own bookings', 403));
  }

  // Check booking status
  if (!['pending', 'confirmed'].includes(booking.status)) {
    return next(new AppError('Cannot pay for this booking', 400));
  }

  if (booking.paymentStatus === 'paid') {
    return next(new AppError('Booking is already paid', 400));
  }

  // Check wallet balance
  const eligibility = await paymentService.checkPaymentEligibility(
    req.user._id,
    booking.ride._id,
    booking.seatsBooked
  );

  if (!eligibility.eligible) {
    return next(new AppError(
      `Insufficient balance. You need ${eligibility.shortfall} BHD more. Please top up your wallet.`,
      400
    ));
  }

  const result = await paymentService.processBookingPayment(bookingId);

  res.status(200).json({
    success: true,
    message: 'Payment successful',
    data: {
      transactionId: result.transactionId,
      amountPaid: result.amount,
      newBalance: result.newBalance,
      currency: 'BHD'
    }
  });
});

/**
 * Check payment eligibility for a ride
 * GET /api/v1/payments/rides/:rideId/eligibility?seats=1
 */
exports.checkPaymentEligibility = asyncHandler(async (req, res, next) => {
  const { rideId } = req.params;
  const seats = parseInt(req.query.seats) || 1;

  const eligibility = await paymentService.checkPaymentEligibility(
    req.user._id,
    rideId,
    seats
  );

  res.status(200).json({
    success: true,
    data: eligibility
  });
});

// ============================================
// DRIVER PAYMENT ENDPOINTS
// ============================================

/**
 * Collect payments for a ride (Driver only)
 * POST /api/v1/payments/rides/:rideId/collect
 */
exports.collectRidePayments = asyncHandler(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findById(rideId);
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Verify driver
  if (ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the driver can collect payments', 403));
  }

  // Check ride status
  if (!['scheduled', 'in_progress'].includes(ride.status)) {
    return next(new AppError('Cannot collect payments for this ride', 400));
  }

  const results = await paymentService.collectRidePayments(rideId);

  res.status(200).json({
    success: true,
    message: `Collected payments from ${results.successful.length} passengers`,
    data: {
      successful: results.successful,
      failed: results.failed,
      totalCollected: results.successful.reduce((sum, s) => sum + s.amount, 0)
    }
  });
});

/**
 * Request payout after ride completion (Driver only)
 * POST /api/v1/payments/rides/:rideId/payout
 */
exports.requestDriverPayout = asyncHandler(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findById(rideId);
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Verify driver
  if (ride.driver.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the driver can request payout', 403));
  }

  // Check ride is completed
  if (ride.status !== 'completed') {
    return next(new AppError('Ride must be completed before payout', 400));
  }

  const result = await paymentService.payDriverForRide(rideId);

  res.status(200).json({
    success: true,
    message: `Payout of ${result.driverEarnings} BHD processed`,
    data: {
      earnings: result.driverEarnings,
      platformFee: result.platformFee,
      currency: 'BHD'
    }
  });
});

/**
 * Get driver earnings summary
 * GET /api/v1/payments/earnings?period=week
 */
exports.getDriverEarnings = asyncHandler(async (req, res, next) => {
  const { period = 'all' } = req.query;

  if (!req.user.isDriver) {
    return next(new AppError('Only drivers can view earnings', 403));
  }

  const earnings = await paymentService.getDriverEarnings(req.user._id, period);

  res.status(200).json({
    success: true,
    data: {
      earnings
    }
  });
});

// ============================================
// REFUND ENDPOINTS
// ============================================

/**
 * Request refund for a cancelled booking
 * POST /api/v1/payments/bookings/:bookingId/refund
 */
exports.requestRefund = asyncHandler(async (req, res, next) => {
  const { bookingId } = req.params;
  const { reason } = req.body;

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Verify ownership or driver
  const ride = await Ride.findById(booking.ride);
  const isPassenger = booking.passenger.toString() === req.user._id.toString();
  const isDriver = ride.driver.toString() === req.user._id.toString();

  if (!isPassenger && !isDriver) {
    return next(new AppError('Unauthorized to request refund', 403));
  }

  // Check if booking is cancelled
  if (booking.status !== 'cancelled') {
    return next(new AppError('Refund only available for cancelled bookings', 400));
  }

  const result = await paymentService.refundBooking(bookingId, reason || 'Booking cancelled');

  res.status(200).json({
    success: true,
    message: result.refunded 
      ? `Refund of ${result.amount} BHD processed`
      : 'No payment to refund',
    data: result
  });
});

// ============================================
// TRANSACTION HISTORY ENDPOINTS
// ============================================

/**
 * Get transaction history
 * GET /api/v1/payments/transactions?type=ride_payment&limit=20&page=1
 */
exports.getTransactionHistory = asyncHandler(async (req, res, next) => {
  const { type, status, startDate, endDate, limit = 20, page = 1 } = req.query;

  const options = {
    limit: Math.min(parseInt(limit), 100),
    skip: (parseInt(page) - 1) * parseInt(limit)
  };

  if (type) options.type = type;
  if (status) options.status = status;
  if (startDate) options.startDate = new Date(startDate);
  if (endDate) options.endDate = new Date(endDate);

  const result = await paymentService.getTransactionHistory(req.user._id, options);

  res.status(200).json({
    success: true,
    count: result.transactions.length,
    total: result.total,
    page: result.page,
    pages: result.pages,
    data: {
      transactions: result.transactions
    }
  });
});

/**
 * Get spending summary (for passengers)
 * GET /api/v1/payments/spending?period=month
 */
exports.getSpendingSummary = asyncHandler(async (req, res, next) => {
  const { period = 'all' } = req.query;

  const spending = await paymentService.getPassengerSpending(req.user._id, period);

  res.status(200).json({
    success: true,
    data: {
      spending
    }
  });
});

// ============================================
// RIDE PAYMENT STATUS
// ============================================

/**
 * Get payment status for a ride
 * GET /api/v1/payments/rides/:rideId/status
 */
exports.getRidePaymentStatus = asyncHandler(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findById(rideId);
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Verify driver or passenger
  const isDriver = ride.driver.toString() === req.user._id.toString();
  const booking = await Booking.findOne({
    ride: rideId,
    passenger: req.user._id
  });

  if (!isDriver && !booking) {
    return next(new AppError('Unauthorized to view payment status', 403));
  }

  const { RidePayment } = require('../models/Payment');
  const ridePayment = await RidePayment.findOne({ ride: rideId })
    .populate('passengerPayments.passenger', 'name');

  if (!ridePayment) {
    return res.status(200).json({
      success: true,
      data: {
        status: 'not_initialized',
        message: 'No payments have been initialized for this ride'
      }
    });
  }

  // If passenger, show only their status
  if (!isDriver) {
    const myPayment = ridePayment.passengerPayments.find(
      p => p.passenger._id.toString() === req.user._id.toString()
    );

    return res.status(200).json({
      success: true,
      data: {
        overallStatus: ridePayment.status,
        myPayment: myPayment ? {
          amount: myPayment.amount,
          status: myPayment.status,
          paidAt: myPayment.paidAt
        } : null
      }
    });
  }

  // Driver sees full status
  res.status(200).json({
    success: true,
    data: {
      status: ridePayment.status,
      totalAmount: ridePayment.totalAmount,
      platformFee: ridePayment.platformFee,
      driverEarnings: ridePayment.driverEarnings,
      passengerPayments: ridePayment.passengerPayments.map(p => ({
        passenger: p.passenger.name,
        amount: p.amount,
        status: p.status,
        paidAt: p.paidAt
      })),
      collectionStartedAt: ridePayment.collectionStartedAt,
      collectionCompletedAt: ridePayment.collectionCompletedAt,
      driverPaidAt: ridePayment.driverPaidAt
    }
  });
});