const serverConfigs = {
  // "943055769157402624": {
  //   guildId: "943055769157402624", // Correct guild ID from logs
  //   name: "FrodoBots", 
  //   ticketChannelId: "1400330024011300894", // Parent channel for tickets
  //   supportTeamRoleId: "1183965714508423329",
  //   staffRoleIds: [
  //     "1183965714508423329", // Support team role ID
  //   ],
  //   staffRoles: [
  //       "📞FrodoBots - Support team",
  //   ],
  //   staffPermissions: [
  //     "ManageMessages",
  //     "ManageChannels",
  //     "ManageRoles",
  //     "ManageGuild",
  //   ],
  //   loggingChannels: {
  //     ticketLogs: "1183956359008485496",
  //     adminLogs: "1183956359008485497", // Replace with actual admin-logs channel ID
  //     publicLogs: "1402275545495900272" // Replace with actual logging-public channel ID
  //   },
  //   escalationRole: "@SupportTeam",
  // },
  // "1205162105205166151": {
  //   guildId: "1205162105205166151", // Correct guild ID from logs
  //   name: "frodobots_owner", 
  //   ticketChannelId: "1215167614649765960", // Parent channel for tickets
  //   supportTeamRoleId: "1217016478193422406",
  //   staffRoleIds: [
  //     "1217016478193422406", // Support team role ID
  //     "1206793648734347284", // Staff role ID
  //   ],
  //   staffRoles: [
  //       "Customer Support",
  //       "FrodoBots Team",
  //   ],
  //   staffPermissions: [
  //     "ManageMessages",
  //     "ManageChannels",
  //     "ManageRoles",
  //     "ManageGuild",
  //   ],
  //   loggingChannels: {
  //     ticketLogs: "1215167403848114217",
  //     adminLogs: "1215167403848114218", // Replace with actual admin-logs channel ID
  //     publicLogs: "1402274942954897572" // Replace with actual logging-public channel ID
  //   },
  //   escalationRole: "@SupportTeam",
  // },
  "1375027327582470205": {
    guildId: "1375027327582470205", // Correct guild ID from logs
    name: "dev-test", 
    ticketChannelId: "1215167614649765960", // Parent channel for tickets
    supportTeamRoleId: "1384038915106934924",
    staffRoleIds: [
      "1384038915106934924", // Support team role ID
    ],
    staffRoles: [
        "My Support team"
    ],
    staffPermissions: [
      "ManageMessages",
      "ManageChannels",
      "ManageRoles",
      "ManageGuild",
    ],
    loggingChannels: {
      ticketLogs: "1215167403848114217",
      adminLogs: "1215167403848114218", // Replace with actual admin-logs channel ID
      publicLogs: "1215167403848114219" // Replace with actual logging-public channel ID
    },
    escalationRole: "@SupportTeam",
  }
  // "943055769157402624": {
  //   guildId: "943055769157402624", // Correct guild ID from logs
  //   name: "FrodoBots", 
  //   ticketChannelId: "1400330024011300894", // Parent channel for tickets
  //   supportTeamRoleId: "1400342826012905472",
  //   staffRoleIds: [
  //     "1400342826012905472", // Support team role ID
  //   ],
  //   staffRoles: [
  //       "Customer Support",
  //   ],
  //   staffPermissions: [
  //     "ManageMessages",
  //     "ManageChannels",
  //     "ManageRoles",
  //     "ManageGuild",
  //   ],
  //   loggingChannels: {
  //     // ticketLogs: "1183956359008485496",
  //     adminLogs: "1183956359008485497", // Replace with actual admin-logs channel ID
  //     // publicLogs: "1402275545495900272" // Replace with actual logging-public channel ID
  //   },
  //   escalationRole: "@SupportTeam",
  // }, 
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
  return `We've received your request!  \n<@&${supportTeamId}> will review it and get back to you as soon as possible. \n\n**Support Hours:** Mon-Fri, 10am-6pm SGT. \n(*AI bot will no longer respond to messages in this ticket.*)`;
} 