import { getServerConfig, getServerFallbackResponse, getSupportTeamId } from '../config/serverConfigs.js';
import dynamicTicketChannelService from './dynamic/DynamicTicketChannelService.js';
import botRules from '../config/botRules.js';

/**
 * Centralized service for server configuration access and management
 */
class ConfigService {
  /**
   * Get server configuration with fallbacks
   * @param {string} guildId - Discord guild ID
   * @returns {Object|null} Server configuration
   */
  static getConfig(guildId) {
    return getServerConfig(guildId);
  }

  /**
   * Get server-specific fallback response
   * @param {string} guildId - Discord guild ID
   * @returns {string} Fallback response message
   */
  static getFallbackResponse(guildId) {
    return getServerFallbackResponse(guildId);
  }

  /**
   * Get support team role ID for a server
   * @param {string} guildId - Discord guild ID
   * @returns {string} Support team role ID
   */
  static getSupportTeamId(guildId) {
    return getSupportTeamId(guildId);
  }

  /**
   * Get staff roles for a server (with fallback to global config)
   * @param {string} guildId - Discord guild ID
   * @returns {Array} Array of staff role names
   */
  static getStaffRoles(guildId) {
    const serverConfig = this.getConfig(guildId);
    return serverConfig?.staffRoles || botRules.TICKET_CHANNELS.STAFF_ROLES;
  }

  /**
   * Get staff role IDs for a server (with fallback to global config)
   * @param {string} guildId - Discord guild ID
   * @returns {Array} Array of staff role IDs
   */
  static getStaffRoleIds(guildId) {
    const serverConfig = this.getConfig(guildId);
    return serverConfig?.staffRoleIds || botRules.TICKET_CHANNELS.STAFF_ROLE_IDS;
  }

  /**
   * Get ticket channel ID for a server
   * @param {string} guildId - Discord guild ID
   * @returns {string|null} Ticket channel ID
   */
  static getTicketChannelId(guildId) {
    // Dynamic ticket channels only
    const dynamicParents = dynamicTicketChannelService.getCachedTicketChannels(guildId);
    return (dynamicParents && dynamicParents.length > 0) ? dynamicParents[0] : null;
  }

  /**
   * Get logging channels for a server
   * @param {string} guildId - Discord guild ID
   * @returns {Object} Logging channels configuration
   */
  static getLoggingChannels(guildId) {
    const serverConfig = this.getConfig(guildId);
    return serverConfig?.loggingChannels || {};
  }

  /**
   * Check if a server is configured
   * @param {string} guildId - Discord guild ID
   * @returns {boolean} True if server has configuration
   */
  static isServerConfigured(guildId) {
    return this.getConfig(guildId) !== null;
  }

  /**
   * Get escalation role for a server
   * @param {string} guildId - Discord guild ID
   * @returns {string} Escalation role mention
   */
  static getEscalationRole(guildId) {
    const serverConfig = this.getConfig(guildId);
    return serverConfig?.escalationRole || botRules.PUBLIC_CHANNELS.ESCALATION_ROLE;
  }

  /**
   * Get rate limits configuration
   * @param {string} context - Context ('public' or 'ticket')
   * @returns {Object} Rate limits configuration
   */
  static getRateLimits(context = 'public') {
    if (context === 'ticket') {
      return botRules.TICKET_CHANNELS.RATE_LIMITS;
    }
    return botRules.PUBLIC_CHANNELS.RATE_LIMITS;
  }

  /**
   * Get confidence threshold for AI responses
   * @param {string} context - Context ('public' or 'ticket')
   * @returns {number} Confidence threshold
   */
  static getConfidenceThreshold(context = 'public') {
    if (context === 'ticket') {
      return botRules.TICKET_CHANNELS.CONFIDENCE_THRESHOLD;
    }
    return botRules.PUBLIC_CHANNELS.CONFIDENCE_THRESHOLD;
  }

  /**
   * Get escalation phrases
   * @param {string} context - Context ('public' or 'ticket')
   * @returns {Array} Array of escalation phrases
   */
  static getEscalationPhrases(context = 'public') {
    if (context === 'ticket') {
      return botRules.TICKET_CHANNELS.ESCALATION_PHRASES;
    }
    return botRules.PUBLIC_CHANNELS.ESCALATION_PHRASES;
  }

  /**
   * Check if developer controls are enabled
   * @param {string} control - Control name
   * @returns {boolean} True if control is enabled
   */
  static isDeveloperControlEnabled(control) {
    return botRules.DEVELOPER_CONTROLS[control] || false;
  }

  /**
   * Get bot identity information
   * @returns {Object} Bot identity configuration
   */
  static getBotIdentity() {
    return botRules.BOT_IDENTITY;
  }
}

export default ConfigService;
