/**
 * Authentication Controller
 * Handles user registration, login, password reset, and email verification
 */

const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { User } = require('../models');
const config = require('../config');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const emailService = require('../services/emailService');

/**
 * Create and send JWT token
 */
const createSendToken = (user, statusCode, res) => {
  const token = user.generateAuthToken();

  // Cookie options
  const cookieOptions = {
    expires: new Date(Date.now() + config.jwtCookieExpiresIn * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict'
  };

  res.cookie('jwt', token, cookieOptions);

  // Remove sensitive data from output
  user.password = undefined;
  user.twoFactorSecret = undefined;

  res.status(statusCode).json({
    success: true,
    token,
    data: {
      user
    }
  });
};

/**
 * Register new user
 * POST /api/v1/auth/register
 */
exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, universityId, password, phoneNumber, gender } = req.body;

  // Check if email domain is valid
  if (!User.isValidUniversityEmail(email)) {
    return next(new AppError(`Only ${config.universityEmailDomain} emails are allowed`, 400));
  }

  // Check if user already exists
  const existingUser = await User.findOne({ 
    $or: [{ email }, { universityId }] 
  });

  if (existingUser) {
    if (existingUser.email === email.toLowerCase()) {
      return next(new AppError('Email already registered', 400));
    }
    if (existingUser.universityId === universityId) {
      return next(new AppError('University ID already registered', 400));
    }
  }

  // Create user
  const user = await User.create({
    name,
    email,
    universityId,
    password,
    phoneNumber,
    gender
  });

  // Generate email verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Send verification email
  try {
    await emailService.sendVerificationEmail(user, verificationToken);
  } catch (error) {
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });
    // Don't fail registration if email fails
    console.error('Email send failed:', error.message);
  }

  createSendToken(user, 201, res);
});

/**
 * Login user
 * POST /api/v1/auth/login
 */
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password, twoFactorCode } = req.body;

  // Find user with password
  const user = await User.findOne({ email }).select('+password +twoFactorSecret');

  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password', 401));
  }

  // Check if account is active
  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated', 401));
  }

  // Check if account is suspended
  if (user.accountStatus === 'suspended') {
    return next(new AppError('Your account has been suspended. Please contact support.', 403));
  }

  // Check 2FA if enabled
  if (user.twoFactorEnabled) {
    if (!twoFactorCode) {
      return res.status(200).json({
        success: true,
        requiresTwoFactor: true,
        message: 'Please provide your 2FA code'
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: twoFactorCode
    });

    if (!verified) {
      return next(new AppError('Invalid 2FA code', 401));
    }
  }

  createSendToken(user, 200, res);
});

/**
 * Logout user
 * POST /api/v1/auth/logout
 */
exports.logout = (req, res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
};

/**
 * Verify email
 * GET /api/v1/auth/verify-email/:token
 */
exports.verifyEmail = asyncHandler(async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() }
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Email verified successfully'
  });
});

/**
 * Resend verification email
 * POST /api/v1/auth/resend-verification
 */
exports.resendVerificationEmail = asyncHandler(async (req, res, next) => {
  const user = req.user;

  if (user.isEmailVerified) {
    return next(new AppError('Email is already verified', 400));
  }

  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  try {
    await emailService.sendVerificationEmail(user, verificationToken);
    res.status(200).json({
      success: true,
      message: 'Verification email sent'
    });
  } catch (error) {
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError('Error sending email. Please try again later.', 500));
  }
});

/**
 * Forgot password
 * POST /api/v1/auth/forgot-password
 */
exports.forgotPassword = asyncHandler(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    // Don't reveal if email exists
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent'
    });
  }

  const resetToken = user.generatePasswordResetToken();
  await user.save({ validateBeforeSave: false });

  try {
    await emailService.sendPasswordResetEmail(user, resetToken);
    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent'
    });
  } catch (error) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError('Error sending email. Please try again later.', 500));
  }
});

/**
 * Reset password
 * PATCH /api/v1/auth/reset-password/:token
 */
exports.resetPassword = asyncHandler(async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  createSendToken(user, 200, res);
});

/**
 * Update password (when logged in)
 * PATCH /api/v1/auth/update-password
 */
exports.updatePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');

  if (!(await user.comparePassword(currentPassword))) {
    return next(new AppError('Current password is incorrect', 401));
  }

  user.password = newPassword;
  await user.save();

  createSendToken(user, 200, res);
});

/**
 * Setup Two-Factor Authentication
 * POST /api/v1/auth/2fa/setup
 */
exports.setupTwoFactor = asyncHandler(async (req, res, next) => {
  const user = req.user;

  if (user.twoFactorEnabled) {
    return next(new AppError('2FA is already enabled', 400));
  }

  const secret = speakeasy.generateSecret({
    name: `${config.twoFaAppName}:${user.email}`
  });

  user.twoFactorSecret = secret.base32;
  await user.save({ validateBeforeSave: false });

  const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

  res.status(200).json({
    success: true,
    data: {
      secret: secret.base32,
      qrCode: qrCodeUrl
    }
  });
});

/**
 * Enable Two-Factor Authentication
 * POST /api/v1/auth/2fa/enable
 */
exports.enableTwoFactor = asyncHandler(async (req, res, next) => {
  const { code } = req.body;
  const user = await User.findById(req.user._id).select('+twoFactorSecret');

  if (!user.twoFactorSecret) {
    return next(new AppError('Please setup 2FA first', 400));
  }

  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code
  });

  if (!verified) {
    return next(new AppError('Invalid verification code', 400));
  }

  user.twoFactorEnabled = true;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: '2FA enabled successfully'
  });
});

/**
 * Disable Two-Factor Authentication
 * POST /api/v1/auth/2fa/disable
 */
exports.disableTwoFactor = asyncHandler(async (req, res, next) => {
  const { code, password } = req.body;
  const user = await User.findById(req.user._id).select('+password +twoFactorSecret');

  // Verify password
  if (!(await user.comparePassword(password))) {
    return next(new AppError('Password is incorrect', 401));
  }

  // Verify 2FA code
  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code
  });

  if (!verified) {
    return next(new AppError('Invalid 2FA code', 400));
  }

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: '2FA disabled successfully'
  });
});

/**
 * Get current user
 * GET /api/v1/auth/me
 */
exports.getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      user
    }
  });
});
