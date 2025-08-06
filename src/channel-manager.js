import "dotenv/config";
import express from 'express';
import dynamicChannelService from './services/DynamicPublicChannelService.js';
import { getConfiguredServerIds, getServerConfig } from './config/serverConfigs.js';

const app = express();
const PORT = process.env.WEB_PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Authentication credentials from environment
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';

console.log('🌐 Channel Manager Starting...');
console.log(`📊 Admin ID: ${ADMIN_ID}`);
console.log(`🔐 Admin Password: ${ADMIN_PASSWORD}`);

// Authentication middleware
const authenticateUser = (req, res, next) => {
  const { adminId, adminPassword } = req.body;
  
  if (adminId === ADMIN_ID && adminPassword === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HTML PAGE
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FrodoBots - Dynamic Channel Manager</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }

        .card {
            background: white;
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            transition: transform 0.3s ease;
        }

        .card:hover {
            transform: translateY(-2px);
        }

        .login-section {
            max-width: 400px;
            margin: 0 auto;
        }

        .management-section {
            display: none;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }

        input, select {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s ease;
        }

        input:focus, select:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-right: 10px;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }

        .btn-success {
            background: linear-gradient(135deg, #2ed573 0%, #0984e3 100%);
        }

        .btn-danger {
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
        }

        .alert {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-weight: 500;
        }

        .alert-success {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }

        .alert-error {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }

        .channels-list {
            margin-top: 20px;
        }

        .channel-item {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .channel-info {
            flex-grow: 1;
        }

        .channel-id {
            font-family: 'Courier New', monospace;
            font-weight: bold;
            color: #495057;
        }

        .channel-meta {
            font-size: 0.9rem;
            color: #6c757d;
            margin-top: 5px;
        }

        .loading {
            text-align: center;
            padding: 20px;
            color: #6c757d;
        }

        .section-title {
            color: #333;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #667eea;
        }

        .guild-info {
            background: #e9ecef;
            padding: 10px 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }

        .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
        }

        .status-active { background-color: #28a745; }
        .status-static { background-color: #6c757d; }
        .status-dynamic { background-color: #007bff; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 FrodoBots</h1>
            <p>Dynamic Public Channel Manager</p>
        </div>

        <!-- Login Section -->
        <div class="card login-section" id="loginSection">
            <h2 style="text-align: center; margin-bottom: 30px; color: #333;">Admin Login</h2>
            <form id="loginForm">
                <div class="form-group">
                    <label for="adminId">Admin ID:</label>
                    <input type="text" id="adminId" name="adminId" required placeholder="Enter admin ID">
                </div>
                <div class="form-group">
                    <label for="adminPassword">Password:</label>
                    <input type="password" id="adminPassword" name="adminPassword" required placeholder="Enter password">
                </div>
                <button type="submit" class="btn" style="width: 100%;">Login</button>
            </form>
        </div>

        <!-- Management Section -->
        <div class="management-section" id="managementSection">
            <!-- Guild Selection -->
            <div class="card">
                <h2 class="section-title">🔧 Server Selection</h2>
                <div class="form-group">
                    <label for="guildSelect">Select Discord Server:</label>
                    <select id="guildSelect" onchange="loadChannels()">
                        <option value="">Select a server...</option>
                    </select>
                </div>
                <div id="guildInfo" class="guild-info" style="display: none;"></div>
            </div>

            <!-- Add Channel Section -->
            <div class="card" id="addChannelSection" style="display: none;">
                <h2 class="section-title">➕ Add New Public Channel</h2>
                <form id="addChannelForm">
                    <div class="form-group">
                        <label for="channelId">Channel ID:</label>
                        <input type="text" id="channelId" name="channelId" required 
                               placeholder="1234567890123456789" pattern="[0-9]{17,19}">
                        <small style="color: #6c757d;">Right-click on Discord channel → Copy Channel ID</small>
                    </div>
                    <div class="form-group">
                        <label for="channelName">Channel Name (Optional):</label>
                        <input type="text" id="channelName" name="channelName" 
                               placeholder="general-chat">
                    </div>
                    <button type="submit" class="btn btn-success">Add Channel</button>
                </form>
            </div>

            <!-- Current Channels Section -->
            <div class="card" id="channelsSection" style="display: none;">
                <h2 class="section-title">📋 Current Public Channels</h2>
                <div id="channelsList" class="loading">
                    Select a server to view channels...
                </div>
            </div>
        </div>

        <!-- Alert Container -->
        <div id="alertContainer"></div>
    </div>

    <script>
        let currentGuild = '';
        let credentials = {};

        // Login form handler
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            credentials = {
                adminId: formData.get('adminId'),
                adminPassword: formData.get('adminPassword')
            };
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(credentials)
                });
                
                if (response.ok) {
                    document.getElementById('loginSection').style.display = 'none';
                    document.getElementById('managementSection').style.display = 'block';
                    await loadGuilds();
                } else {
                    showAlert('Invalid credentials. Please try again.', 'error');
                }
            } catch (error) {
                showAlert('Login failed. Please try again.', 'error');
            }
        });

        // Add channel form handler
        document.getElementById('addChannelForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const channelData = {
                ...credentials,
                guildId: currentGuild,
                channelId: formData.get('channelId'),
                channelName: formData.get('channelName')
            };
            
            try {
                const response = await fetch('/api/channels/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(channelData)
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showAlert('✅ Channel added successfully! Bot can now respond to messages in this channel immediately.', 'success');
                    e.target.reset();
                    await loadChannels();
                } else {
                    showAlert(result.error || 'Failed to add channel', 'error');
                }
            } catch (error) {
                showAlert('Failed to add channel. Please try again.', 'error');
            }
        });

        // Load guilds
        async function loadGuilds() {
            try {
                const response = await fetch('/api/guilds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(credentials)
                });
                
                const guilds = await response.json();
                const select = document.getElementById('guildSelect');
                
                select.innerHTML = '<option value="">Select a server...</option>';
                guilds.forEach(guild => {
                    const option = document.createElement('option');
                    option.value = guild.guildId;
                    option.textContent = \`\${guild.name} (\${guild.guildId})\`;
                    select.appendChild(option);
                });
            } catch (error) {
                showAlert('Failed to load servers', 'error');
            }
        }

        // Load channels for selected guild
        async function loadChannels() {
            const guildId = document.getElementById('guildSelect').value;
            currentGuild = guildId;
            
            const addSection = document.getElementById('addChannelSection');
            const channelsSection = document.getElementById('channelsSection');
            const guildInfo = document.getElementById('guildInfo');
            const channelsList = document.getElementById('channelsList');
            
            if (!guildId) {
                addSection.style.display = 'none';
                channelsSection.style.display = 'none';
                guildInfo.style.display = 'none';
                return;
            }
            
            // Show sections
            addSection.style.display = 'block';
            channelsSection.style.display = 'block';
            guildInfo.style.display = 'block';
            
            // Load guild info
            const guildData = document.getElementById('guildSelect').selectedOptions[0].textContent;
            guildInfo.innerHTML = \`<strong>Selected:</strong> \${guildData}\`;
            
            // Load channels
            channelsList.innerHTML = '<div class="loading">Loading channels...</div>';
            
            try {
                const response = await fetch('/api/channels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...credentials, guildId })
                });
                
                const data = await response.json();
                
                channelsList.innerHTML = '';
                
                if (data.dynamic.length === 0) {
                    channelsList.innerHTML = '<p style="text-align: center; color: #6c757d;">No public channels configured for this server. Add some channels above!</p>';
                    return;
                }
                
                // Show dynamic channels only
                const dynamicHeader = document.createElement('h4');
                dynamicHeader.textContent = 'Public Channels';
                dynamicHeader.style.color = '#007bff';
                dynamicHeader.style.marginBottom = '10px';
                channelsList.appendChild(dynamicHeader);
                
                data.dynamic.forEach(channel => {
                    const channelDiv = document.createElement('div');
                    channelDiv.className = 'channel-item';
                    channelDiv.innerHTML = \`
                        <div class="channel-info">
                            <div class="channel-id">
                                <span class="status-indicator status-dynamic"></span>
                                \${channel.channelId}
                            </div>
                            <div class="channel-meta">
                                Added: \${new Date(channel.addedAt).toLocaleDateString()} | 
                                Name: \${channel.name || 'N/A'}
                            </div>
                        </div>
                        <button class="btn btn-danger" onclick="removeChannel('\${channel.channelId}')">Remove</button>
                    \`;
                    channelsList.appendChild(channelDiv);
                });
                
            } catch (error) {
                channelsList.innerHTML = '<p style="text-align: center; color: #dc3545;">Failed to load channels</p>';
            }
        }

        // Remove channel
        async function removeChannel(channelId) {
            if (!confirm('Are you sure you want to remove this channel?')) {
                return;
            }
            
            try {
                const response = await fetch('/api/channels/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...credentials, guildId: currentGuild, channelId })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showAlert('✅ Channel removed successfully!', 'success');
                    await loadChannels();
                } else {
                    showAlert(result.error || 'Failed to remove channel', 'error');
                }
            } catch (error) {
                showAlert('Failed to remove channel. Please try again.', 'error');
            }
        }

        // Show alert
        function showAlert(message, type) {
            const alertContainer = document.getElementById('alertContainer');
            const alert = document.createElement('div');
            alert.className = \`alert alert-\${type}\`;
            alert.innerHTML = message;
            
            alertContainer.appendChild(alert);
            
            setTimeout(() => {
                alert.remove();
            }, 8000);
        }
    </script>
</body>
</html>
  `);
});

// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// Login endpoint
app.post('/api/login', authenticateUser, (req, res) => {
  res.json({ success: true });
});

// Get configured guilds
app.post('/api/guilds', authenticateUser, async (req, res) => {
  try {
    const guilds = getConfiguredServerIds().map(guildId => {
      const config = getServerConfig(guildId);
      return {
        guildId,
        name: config?.name || 'Unknown Server'
      };
    });
    res.json(guilds);
  } catch (error) {
    console.error('Error getting guilds:', error);
    res.status(500).json({ error: 'Failed to get servers' });
  }
});

// Get channels for a guild
app.post('/api/channels', authenticateUser, async (req, res) => {
  try {
    const { guildId } = req.body;
    
    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    // Get dynamic channels from Redis only
    const dynamicChannels = await dynamicChannelService.getChannelDetails(guildId);

    res.json({
      dynamic: dynamicChannels
    });
  } catch (error) {
    console.error('Error getting channels:', error);
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

// Add a channel
app.post('/api/channels/add', authenticateUser, async (req, res) => {
  try {
    const { guildId, channelId, channelName } = req.body;
    
    if (!guildId || !channelId) {
      return res.status(400).json({ error: 'Guild ID and Channel ID are required' });
    }

    // Validate channel ID format (Discord snowflake)
    if (!/^\d{17,19}$/.test(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID format. Must be 17-19 digits.' });
    }

    const success = await dynamicChannelService.addPublicChannel(guildId, channelId, {
      name: channelName,
      addedBy: 'web-admin'
    });

    if (success) {
      res.json({ success: true, message: 'Channel added successfully! Bot will respond immediately.' });
    } else {
      res.status(500).json({ error: 'Failed to add channel' });
    }
  } catch (error) {
    console.error('Error adding channel:', error);
    res.status(500).json({ error: 'Failed to add channel' });
  }
});

// Remove a channel
app.post('/api/channels/remove', authenticateUser, async (req, res) => {
  try {
    const { guildId, channelId } = req.body;
    
    if (!guildId || !channelId) {
      return res.status(400).json({ error: 'Guild ID and Channel ID are required' });
    }

    const success = await dynamicChannelService.removePublicChannel(guildId, channelId);

    if (success) {
      res.json({ success: true, message: 'Channel removed successfully!' });
    } else {
      res.status(404).json({ error: 'Channel not found or already removed' });
    }
  } catch (error) {
    console.error('Error removing channel:', error);
    res.status(500).json({ error: 'Failed to remove channel' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`🌐 Channel Manager Server running on http://localhost:${PORT}`);
  console.log(`🔐 Login with ID: "${ADMIN_ID}" and Password: "${ADMIN_PASSWORD}"`);
  console.log(`📊 Ready to manage dynamic public channels!`);
}); 