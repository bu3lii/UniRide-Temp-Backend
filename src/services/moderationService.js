/**
 * Content Moderation Service
 * Uses Google Perspective API to analyze message toxicity
 * Implements tiered moderation actions based on severity
 * 
 * Thresholds:
 * - Moderate (0.5-0.7): Warning + message removal
 * - High (0.7-0.85): 1-hour mute
 * - Severe (0.85+): Account suspension
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { User, Notification } = require('../models');

class ModerationService {
  constructor() {
    this.apiKey = config.perspectiveApiKey;
    this.apiUrl = 'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';
    this.thresholds = config.moderation;
  }

  /**
   * Analyze text for toxicity using Perspective API
   * @param {string} text - Text to analyze
   * @returns {Object} Analysis results with scores
   */
  async analyzeText(text) {
    if (!this.apiKey) {
      logger.warn('Perspective API key not configured, skipping moderation');
      return { toxicity: 0, shouldModerate: false };
    }

    try {
      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        {
          comment: { text },
          languages: ['en', 'ar'], // Support English and Arabic
          requestedAttributes: {
            TOXICITY: {},
            SEVERE_TOXICITY: {},
            IDENTITY_ATTACK: {},
            INSULT: {},
            PROFANITY: {},
            THREAT: {},
            SEXUALLY_EXPLICIT: {}
          }
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        }
      );

      const scores = this.extractScores(response.data);
      return {
        ...scores,
        shouldModerate: scores.maxScore >= this.thresholds.moderateToxicityThreshold
      };
    } catch (error) {
      logger.error('Perspective API error:', error.message);
      // Fail open - don't block messages if API fails
      return { toxicity: 0, shouldModerate: false, error: true };
    }
  }

  /**
   * Extract and normalize scores from API response
   */
  extractScores(data) {
    const attributes = data.attributeScores;
    
    const scores = {
      toxicity: attributes.TOXICITY?.summaryScore?.value || 0,
      severeToxicity: attributes.SEVERE_TOXICITY?.summaryScore?.value || 0,
      identityAttack: attributes.IDENTITY_ATTACK?.summaryScore?.value || 0,
      insult: attributes.INSULT?.summaryScore?.value || 0,
      profanity: attributes.PROFANITY?.summaryScore?.value || 0,
      threat: attributes.THREAT?.summaryScore?.value || 0,
      sexuallyExplicit: attributes.SEXUALLY_EXPLICIT?.summaryScore?.value || 0
    };

    // Calculate max score for action determination
    scores.maxScore = Math.max(
      scores.toxicity,
      scores.severeToxicity,
      scores.threat * 1.2, // Weight threats higher
      scores.identityAttack * 1.1
    );

    return scores;
  }

  /**
   * Determine moderation action based on toxicity score
   * @param {number} score - Maximum toxicity score
   * @returns {string} Action to take
   */
  determineAction(score) {
    if (score >= this.thresholds.severeToxicityThreshold) {
      return 'suspend';
    }
    if (score >= this.thresholds.highToxicityThreshold) {
      return 'mute';
    }
    if (score >= this.thresholds.moderateToxicityThreshold) {
      return 'warning';
    }
    return 'none';
  }

  /**
   * Process a message and apply moderation if needed
   * @param {Object} message - Message document
   * @param {Object} sender - User document
   * @returns {Object} Moderation result
   */
  async moderateMessage(message, sender) {
    const analysis = await this.analyzeText(message.content);
    
    if (!analysis.shouldModerate) {
      return {
        action: 'none',
        allowed: true,
        scores: analysis
      };
    }

    const action = this.determineAction(analysis.maxScore);
    const result = {
      action,
      allowed: action === 'warning', // Warnings still allow the message (after removal)
      scores: analysis,
      originalContent: message.content
    };

    // Apply action to message
    await message.applyModeration(analysis.maxScore, action === 'none' ? 'none' : 
      (action === 'warning' ? 'removed' : action));

    // Apply action to user account
    await this.applyUserAction(sender, action, analysis);

    return result;
  }

  /**
   * Apply moderation action to user account
   */
  async applyUserAction(user, action, analysis) {
    switch (action) {
      case 'warning':
        await this.issueWarning(user, analysis);
        break;
      case 'mute':
        await this.muteUser(user, analysis);
        break;
      case 'suspend':
        await this.suspendUser(user, analysis);
        break;
    }
  }

  /**
   * Issue a warning to user
   */
  async issueWarning(user, analysis) {
    user.moderationWarnings += 1;
    user.lastModerationAction = new Date();
    await user.save();

    // Check if warnings exceed threshold for escalation
    if (user.moderationWarnings >= 3) {
      // Escalate to mute after 3 warnings
      await this.muteUser(user, analysis, 'Exceeded warning threshold');
      return;
    }

    // Send notification
    await Notification.createNotification('account_warning', user._id, {
      message: `Your message was removed due to policy violation. Warning ${user.moderationWarnings}/3.`
    });

    logger.info(`Warning issued to user ${user._id}. Total warnings: ${user.moderationWarnings}`);
  }

  /**
   * Mute user for 1 hour
   */
  async muteUser(user, analysis, reason = 'High toxicity detected') {
    const muteDuration = this.thresholds.muteDurationMs;
    
    user.accountStatus = 'muted';
    user.mutedUntil = new Date(Date.now() + muteDuration);
    user.lastModerationAction = new Date();
    await user.save();

    // Send notification
    await Notification.createNotification('account_muted', user._id, {
      message: `Your messaging privileges have been suspended for 1 hour. Reason: ${reason}`
    });

    logger.warn(`User ${user._id} muted for 1 hour. Reason: ${reason}. Score: ${analysis.maxScore}`);

    // Schedule automatic unmute
    this.scheduleUnmute(user._id, muteDuration);
  }

  /**
   * Suspend user account
   */
  async suspendUser(user, analysis, reason = 'Severe policy violation') {
    user.accountStatus = 'suspended';
    user.suspendedAt = new Date();
    user.suspensionReason = `Automated: ${reason}. Toxicity score: ${analysis.maxScore.toFixed(2)}`;
    user.lastModerationAction = new Date();
    await user.save();

    // Send notification
    await Notification.createNotification('account_suspended', user._id, {
      message: 'Your account has been suspended due to severe policy violations. Please contact support for review.'
    });

    logger.error(`User ${user._id} SUSPENDED. Reason: ${reason}. Score: ${analysis.maxScore}`);

    // TODO: Send email notification to user
    // TODO: Alert admin dashboard
  }

  /**
   * Schedule automatic unmute
   */
  scheduleUnmute(userId, delayMs) {
    setTimeout(async () => {
      try {
        const user = await User.findById(userId);
        if (user && user.accountStatus === 'muted') {
          user.accountStatus = 'active';
          user.mutedUntil = null;
          await user.save();
          logger.info(`User ${userId} automatically unmuted`);
        }
      } catch (error) {
        logger.error(`Error unmuting user ${userId}:`, error);
      }
    }, delayMs);
  }

  /**
   * Check if user can send messages
   */
  async canUserSendMessages(userId) {
    const user = await User.findById(userId);
    if (!user) {
      return { allowed: false, reason: 'User not found' };
    }

    // Check mute status (auto-expire if needed)
    await user.checkMuteStatus();

    if (user.accountStatus === 'suspended') {
      return { 
        allowed: false, 
        reason: 'Your account is suspended. Please contact support.'
      };
    }

    if (user.accountStatus === 'muted') {
      const remainingTime = Math.ceil((user.mutedUntil - new Date()) / 60000);
      return { 
        allowed: false, 
        reason: `You are muted for ${remainingTime} more minutes.`
      };
    }

    return { allowed: true };
  }

  /**
   * Admin: Manually lift suspension
   */
  async liftSuspension(userId, adminId, reason) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.accountStatus = 'active';
    user.suspendedAt = null;
    user.suspensionReason = null;
    user.moderationWarnings = 0; // Reset warnings
    await user.save();

    logger.info(`Suspension lifted for user ${userId} by admin ${adminId}. Reason: ${reason}`);

    return user;
  }

  /**
   * Get moderation statistics for a user
   */
  async getUserModerationHistory(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      currentStatus: user.accountStatus,
      warnings: user.moderationWarnings,
      mutedUntil: user.mutedUntil,
      suspendedAt: user.suspendedAt,
      suspensionReason: user.suspensionReason,
      lastAction: user.lastModerationAction
    };
  }
}

// Export singleton instance
module.exports = new ModerationService();
