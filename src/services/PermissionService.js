import { getServerConfig } from '../config/serverConfigs.js';
import TicketChannelUtil from '../utils/TicketChannelUtil.js';
import botRules from '../config/botRules.js';

/**
 * Centralized service for handling permissions and staff role validation
 */
class PermissionService {
  /**
   * Check if a user is a staff member
   * @param {Object} message - Discord message object
   * @returns {boolean} True if user is staff
   */
  static isStaffMember(message) {
    const guildId = message.guild?.id;
    const serverConfig = getServerConfig(guildId);
    
    // Use server-specific staff roles if configured, otherwise fall back to global config
    const staffRoles = serverConfig?.staffRoles || botRules.TICKET_CHANNELS.STAFF_ROLES;
    const staffRoleIds = serverConfig?.staffRoleIds || botRules.TICKET_CHANNELS.STAFF_ROLE_IDS;
    
    if (!message.member) {
      return false;
    }
    
    // Check staff roles by name
    const hasStaffRoleByName = message.member.roles.cache.some(role => 
      staffRoles.includes(role.name)
    );
    
    // Check staff roles by ID
    const hasStaffRoleById = message.member.roles.cache.some(role => 
      staffRoleIds.includes(role.id)
    );
    
    return hasStaffRoleByName || hasStaffRoleById;
  }

  /**
   * Check if a user is a staff member (async version for when member needs to be fetched)
   * @param {Object} message - Discord message object
   * @returns {Promise<boolean>} True if user is staff
   */
  static async isStaffMemberAsync(message) {
    const guildId = message.guild?.id;
    const serverConfig = getServerConfig(guildId);
    
    if (!serverConfig || !serverConfig.staffRoleIds) {
      return false;
    }
    
    try {
      const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member) return false;
      
      return serverConfig.staffRoleIds.some(roleId => 
        member.roles.cache.has(roleId)
      );
    } catch (error) {
      console.error('Error checking staff member:', error);
      return false;
    }
  }

  /**
   * Check if an interaction user has support permissions
   * @param {Object} interaction - Discord interaction object
   * @returns {boolean} True if user has support permissions
   */
  static hasSupportPermission(interaction) {
    const serverConfig = getServerConfig(interaction.guild.id);
    if (!serverConfig) {
      return false;
    }

    const staffRoles = serverConfig.staffRoles || [];
    const staffRoleIds = serverConfig.staffRoleIds || [];

    // Check by role name
    const hasRoleByName = interaction.member.roles.cache.some(role => 
      staffRoles.includes(role.name)
    );

    // Check by role ID
    const hasRoleById = interaction.member.roles.cache.some(role => 
      staffRoleIds.includes(role.id)
    );

    return hasRoleByName || hasRoleById;
  }

  /**
   * Check if a channel is a ticket channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if channel is a ticket channel
   */
  static isTicketChannel(channel) {
    return TicketChannelUtil.isTicketChannel(channel);
  }

  /**
   * Log permission check for debugging
   * @param {Object} user - Discord user object
   * @param {Object} member - Discord member object
   * @param {Array} requiredRoles - Required role names
   * @param {Array} requiredRoleIds - Required role IDs
   * @param {boolean} hasPermission - Whether user has permission
   */
  static logPermissionCheck(user, member, requiredRoles = [], requiredRoleIds = [], hasPermission = false) {
    console.log(`User ${user.tag} roles:`, 
      member.roles.cache.map(r => `${r.name} (${r.id})`));
    console.log(`Required roles:`, requiredRoles);
    console.log(`Required role IDs:`, requiredRoleIds);
    console.log(`Has permission: ${hasPermission}`);
  }
}

export default PermissionService;
