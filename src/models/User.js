/**
 * User Model
 * Represents both drivers and riders in the system
 * Supports university email verification and 2FA
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

const userSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      'Please provide a valid email address'
    ]
  },
  universityId: {
    type: String,
    required: [true, 'University ID is required'],
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    match: [/^\+973\d{8}$/, 'Please provide a valid Bahrain phone number (+973XXXXXXXX)']
  },
  gender: {
    type: String,
    enum: ['male', 'female'],
    required: [true, 'Gender is required']
  },
  profilePicture: {
    type: String,
    default: null
  },

  // Role and Status
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  accountStatus: {
    type: String,
    enum: ['active', 'muted', 'suspended'],
    default: 'active'
  },
  mutedUntil: {
    type: Date,
    default: null
  },
  suspendedAt: {
    type: Date,
    default: null
  },
  suspensionReason: {
    type: String,
    default: null
  },

  // Driver-specific fields
  isDriver: {
    type: Boolean,
    default: false
  },
  carDetails: {
    model: {
      type: String,
      trim: true
    },
    color: {
      type: String,
      trim: true
    },
    licensePlate: {
      type: String,
      uppercase: true,
      trim: true
    },
    totalSeats: {
      type: Number,
      min: [1, 'Must have at least 1 seat'],
      max: [7, 'Cannot exceed 7 seats']
    }
  },

  // Ratings
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  },

  // Statistics
  stats: {
    totalRidesAsDriver: {
      type: Number,
      default: 0
    },
    totalRidesAsRider: {
      type: Number,
      default: 0
    },
    moneySaved: {
      type: Number,
      default: 0
    }
  },

  // Two-Factor Authentication
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: {
    type: String,
    select: false
  },

  // Password Reset
  passwordResetToken: String,
  passwordResetExpires: Date,

  // Email Verification
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // Moderation
  moderationWarnings: {
    type: Number,
    default: 0
  },
  lastModerationAction: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ universityId: 1 });
userSchema.index({ accountStatus: 1 });
userSchema.index({ 'carDetails.licensePlate': 1 });

// Virtual for full profile URL
userSchema.virtual('profileUrl').get(function() {
  return this.profilePicture || `/api/v1/users/${this._id}/avatar`;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Instance Methods

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token
userSchema.methods.generateAuthToken = function() {
  return jwt.sign(
    { 
      id: this._id, 
      email: this.email,
      role: this.role 
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

// Generate password reset token
userSchema.methods.generatePasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  
  return resetToken;
};

// Generate email verification token
userSchema.methods.generateEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
  
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  
  return verificationToken;
};

// Check if user can send messages (not muted or suspended)
userSchema.methods.canSendMessages = function() {
  if (this.accountStatus === 'suspended') return false;
  if (this.accountStatus === 'muted' && this.mutedUntil > new Date()) return false;
  return true;
};

// Check if mute has expired and update status
userSchema.methods.checkMuteStatus = async function() {
  if (this.accountStatus === 'muted' && this.mutedUntil <= new Date()) {
    this.accountStatus = 'active';
    this.mutedUntil = null;
    await this.save();
  }
  return this.accountStatus;
};

// Update rating
userSchema.methods.updateRating = async function(newRating) {
  const totalScore = this.rating.average * this.rating.count + newRating;
  this.rating.count += 1;
  this.rating.average = totalScore / this.rating.count;
  await this.save();
};

// Static Methods

// Find by email
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

// Find active drivers
userSchema.statics.findActiveDrivers = function() {
  return this.find({ 
    isDriver: true, 
    isActive: true, 
    accountStatus: 'active' 
  });
};

// Validate university email
userSchema.statics.isValidUniversityEmail = function(email) {
  const domain = email.split('@')[1];
  return domain === config.universityEmailDomain;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
