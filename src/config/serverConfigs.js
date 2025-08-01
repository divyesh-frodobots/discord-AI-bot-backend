const serverConfigs = {
  "1205162105205166151": {
    guildId: "1205162105205166151", // Correct guild ID from logs
    name: "frodobots_owner", 
    ticketChannelId: "1215167614649765960", // Parent channel for tickets
    supportTeamRoleId: "1217016478193422406",
    staffRoleIds: [
      "1217016478193422406", // Support team role ID
      "1206793648734347284", // Staff role ID
    ],
    staffRoles: [
        "Customer Support",
        "FrodoBots Team",
    ],
    staffPermissions: [
      "ManageMessages",
      "ManageChannels",
      "ManageRoles",
      "ManageGuild",
    ],
    loggingChannels: {
      ticketLogs: "1215167403848114217",
      adminLogs: "admin-logs",
      publicLogs: "logging-public"
    },
    escalationRole: "@SupportTeam"
  }
};

export default serverConfigs;

// Helper function to get server config by guild ID
export function getServerConfig(guildId) {
  const config = serverConfigs[guildId] || null;
  return config;
}

// Helper function to get all configured server IDs  
export function getConfiguredServerIds() {
  return Object.keys(serverConfigs);
}

// Helper function to get server-specific support team ID
export function getSupportTeamId(guildId) {
  const serverConfig = getServerConfig(guildId);
  if (serverConfig && serverConfig.supportTeamRoleId) {
    return serverConfig.supportTeamRoleId;
  }
  // Fallback to default support team ID from constants
  return '1217016478193422406'; // Default fallback
}

// Helper function to get server-specific fallback response
export function getServerFallbackResponse(guildId) {
  const supportTeamId = getSupportTeamId(guildId);
  return `Thanks for reaching out!  \n<@&${supportTeamId}> will review your request and get back to you as soon as possible. \n\n**Support Hours:** Mon-Fri, 10am-6pm SGT. \n(*AI bot will no longer respond to messages in this ticket.*)`;
} 