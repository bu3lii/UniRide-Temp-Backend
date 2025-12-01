/**
 * Email Service
 * Handles all email communications including verification and notifications
 */

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    if (config.email.host && config.email.user) {
      this.transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.port === 465,
        auth: {
          user: config.email.user,
          pass: config.email.pass
        }
      });

      // Verify connection
      this.transporter.verify((error) => {
        if (error) {
          logger.error('Email transporter verification failed:', error.message);
        } else {
          logger.info('Email service ready');
        }
      });
    } else {
      logger.warn('Email service not configured - emails will be logged only');
    }
  }

  /**
   * Send email
   */
  async sendEmail(options) {
    const mailOptions = {
      from: config.email.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text
    };

    if (!this.transporter) {
      logger.info('Email (not sent - no transporter):', {
        to: options.to,
        subject: options.subject
      });
      return { messageId: 'mock-' + Date.now() };
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${options.to}: ${info.messageId}`);
      return info;
    } catch (error) {
      logger.error('Email send error:', error.message);
      throw error;
    }
  }

  /**
   * Send email verification
   */
  async sendVerificationEmail(user, verificationToken) {
    const verificationUrl = `${config.frontendUrl}/verify-email/${verificationToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #10B981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚗 UniRide</h1>
          </div>
          <div class="content">
            <h2>Verify Your Email</h2>
            <p>Hi ${user.name},</p>
            <p>Welcome to UniRide! Please verify your AUBH email address to start sharing rides with fellow students.</p>
            <p style="text-align: center;">
              <a href="${verificationUrl}" class="button">Verify Email</a>
            </p>
            <p>Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
            <p>This link expires in 24 hours.</p>
            <p>If you didn't create an account, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>UniRide - Cut Costs. Share Rides. Go Green!</p>
            <p>American University of Bahrain</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Verify Your UniRide Account',
      html,
      text: `Hi ${user.name}, Please verify your email by visiting: ${verificationUrl}`
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${config.frontendUrl}/reset-password/${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #EF4444; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #EF4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset</h1>
          </div>
          <div class="content">
            <h2>Reset Your Password</h2>
            <p>Hi ${user.name},</p>
            <p>You requested to reset your UniRide password. Click the button below to create a new password:</p>
            <p style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p>Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all; color: #666;">${resetUrl}</p>
            <p><strong>This link expires in 10 minutes.</strong></p>
            <p>If you didn't request this, please ignore this email. Your password will remain unchanged.</p>
          </div>
          <div class="footer">
            <p>UniRide - Cut Costs. Share Rides. Go Green!</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Reset Your UniRide Password',
      html,
      text: `Hi ${user.name}, Reset your password by visiting: ${resetUrl} (expires in 10 minutes)`
    });
  }

  /**
   * Send booking confirmation email
   */
  async sendBookingConfirmationEmail(user, booking, ride, driver) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Booking Confirmed!</h1>
          </div>
          <div class="content">
            <p>Hi ${user.name},</p>
            <p>Great news! Your ride has been confirmed.</p>
            
            <div class="details">
              <h3>Ride Details</h3>
              <div class="detail-row">
                <span>From:</span>
                <span>${ride.startLocation.address}</span>
              </div>
              <div class="detail-row">
                <span>To:</span>
                <span>${ride.destination.address}</span>
              </div>
              <div class="detail-row">
                <span>Date & Time:</span>
                <span>${new Date(ride.departureTime).toLocaleString()}</span>
              </div>
              <div class="detail-row">
                <span>Driver:</span>
                <span>${driver.name}</span>
              </div>
              <div class="detail-row">
                <span>Car:</span>
                <span>${driver.carDetails?.model} - ${driver.carDetails?.color}</span>
              </div>
              <div class="detail-row">
                <span>License Plate:</span>
                <span>${driver.carDetails?.licensePlate}</span>
              </div>
              <div class="detail-row">
                <span>Seats Booked:</span>
                <span>${booking.seatsBooked}</span>
              </div>
              <div class="detail-row">
                <span>Total Amount:</span>
                <span>${booking.totalAmount} BHD</span>
              </div>
            </div>
            
            <p>The driver will contact you before pickup. Make sure to be ready on time!</p>
          </div>
          <div class="footer">
            <p>UniRide - Cut Costs. Share Rides. Go Green!</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Your UniRide Booking is Confirmed!',
      html,
      text: `Hi ${user.name}, Your booking is confirmed! Ride from ${ride.startLocation.address} to ${ride.destination.address} on ${new Date(ride.departureTime).toLocaleString()}`
    });
  }

  /**
   * Send ride cancellation notification
   */
  async sendRideCancellationEmail(user, ride, reason) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #EF4444; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>❌ Ride Cancelled</h1>
          </div>
          <div class="content">
            <p>Hi ${user.name},</p>
            <p>Unfortunately, your ride has been cancelled.</p>
            <p><strong>Route:</strong> ${ride.startLocation.address} → ${ride.destination.address}</p>
            <p><strong>Scheduled for:</strong> ${new Date(ride.departureTime).toLocaleString()}</p>
            ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
            <p>Please search for alternative rides on UniRide.</p>
          </div>
          <div class="footer">
            <p>UniRide - Cut Costs. Share Rides. Go Green!</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Your UniRide Has Been Cancelled',
      html,
      text: `Hi ${user.name}, Your ride from ${ride.startLocation.address} to ${ride.destination.address} has been cancelled.`
    });
  }
}

module.exports = new EmailService();
