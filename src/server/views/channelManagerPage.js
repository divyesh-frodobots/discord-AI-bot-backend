export function renderChannelManagerPage() {
  return `
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

        /* Product selector */
        .product-search {
            width: 100%;
            padding: 12px 14px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            font-size: 16px;
            margin-bottom: 12px;
            transition: border-color 0.2s ease;
        }
        .product-search:focus { border-color: #667eea; outline: none; }

        .product-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 16px;
        }
        .product-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 18px 20px;
            border: 1px solid #e1e5e9;
            border-radius: 14px;
            background: #fafbfc;
            min-height: 96px;
            box-shadow: 0 1px 0 rgba(0,0,0,0.02);
            transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
        }
        .product-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.06); background: #ffffff; }
        .product-checkbox { width: 18px; height: 18px; accent-color: #667eea; }
        .product-title { font-weight: 700; font-size: 18px; color: #202124; line-height: 1.25; }

        /* Google Docs Links Styles */
        .google-docs-section {
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 15px;
            background-color: #f9f9f9;
            margin-top: 10px;
        }

        .add-link-container {
            display: flex;
            margin-bottom: 15px;
            align-items: center;
        }

        .links-list {
            max-height: 150px;
            overflow-y: auto;
        }

        .link-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            margin-bottom: 5px;
            background-color: white;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
        }

        .link-text {
            flex: 1;
            color: #007bff;
            margin-right: 10px;
            word-break: break-all;
            font-size: 14px;
        }

        .remove-link-btn {
            background-color: #dc3545;
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }

        .remove-link-btn:hover {
            background-color: #c82333;
        }

        .links-count {
            color: #28a745;
            font-weight: bold;
            margin-top: 5px;
        }

        .btn-secondary {
            background: linear-gradient(135deg, #6c757d 0%, #495057 100%);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 FrodoBots</h1>
            <p>Dynamic Channel Manager</p>
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
                <h2 class="section-title">➕ Add New Channel</h2>
                <form id="addChannelForm">
                    <div class="form-group">
                        <label for="channelType">Channel Type:</label>
                        <select id="channelType" name="channelType" required>
                            <option value="public" selected>Public</option>
                            <option value="ticket">Ticket</option>
                        </select>
                    </div>
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
                    <div class="form-group" id="productsGroup">
                        <label>Products (Required):</label>
                        <input type="text" id="productSearch" class="product-search" placeholder="Search products...">
                        <div id="productGrid" class="product-grid"></div>
                        <input type="hidden" name="products" id="productsHidden" required>
                    </div>
                    <div class="form-group">
                        <label>Google Docs Links (Optional):</label>
                        <div class="google-docs-section">
                            <div class="add-link-container">
                                <input type="url" id="newGoogleDocLink" 
                                       placeholder="https://docs.google.com/document/d/abc123/edit" 
                                       style="flex: 1; margin-right: 10px;">
                                <button type="button" id="addGoogleDocBtn" class="btn btn-secondary">Add Link</button>
                            </div>
                            <div id="googleDocsLinksList" class="links-list">
                                <!-- Links will be shown here -->
                            </div>
                            <small style="color: #6c757d;">
                                Add Google Docs links containing support content. Links will be saved when you submit the form.
                            </small>
                        </div>
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
            
            <!-- Ticket Channels Section (List only) -->
            <div class="card" id="ticketChannelsSection" style="display: none;">
                <h2 class="section-title">🎫 Ticket Channels</h2>
                <div class="channels-list" id="ticketChannelsList" style="margin-top: 16px;"></div>
            </div>
        </div>

        <!-- Alert Container -->
        <div id="alertContainer"></div>
    </div>

    <script>
        let currentGuild = '';
        let credentials = {};
        const availableProducts = [
            { key: 'earthrover', label: 'EarthRover (Personal Bot)' },
            { key: 'earthrover_school', label: 'EarthRover School' },
            { key: 'ufb', label: 'UFB (Ultimate Fighting Bots)' },
            { key: 'sam', label: 'SAM' },
            { key: 'robotsfun', label: 'Robots.Fun' },
            { key: 'et_fugi', label: 'ET Fugi' },
            { key: 'telearms', label: 'TeleArms' }
        ];

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

        // Local Google Docs Links Management
        let localGoogleDocLinks = [];

        // Add Google Doc link to local array
        document.getElementById('addGoogleDocBtn').addEventListener('click', () => {
            const linkInput = document.getElementById('newGoogleDocLink');
            const link = linkInput.value.trim();
            
            if (!link) {
                showAlert('Please enter a Google Docs link', 'error');
                return;
            }
            
            // Check if link already exists locally
            if (localGoogleDocLinks.includes(link)) {
                showAlert('This link has already been added', 'error');
                return;
            }
            
            // Add to local array
            localGoogleDocLinks.push(link);
            updateLinksDisplay();
            linkInput.value = '';
            showAlert('✅ Link added locally (' + localGoogleDocLinks.length + ' total)', 'success');
        });

        // Update the links display
        function updateLinksDisplay() {
            const linksList = document.getElementById('googleDocsLinksList');
            
            if (localGoogleDocLinks.length === 0) {
                linksList.innerHTML = '<p style="color: #6c757d; text-align: center; margin: 10px 0;">No links added yet</p>';
                return;
            }
            
            let html = '';
            localGoogleDocLinks.forEach((link, index) => {
                const displayLink = link.length > 60 ? link.substring(0, 60) + '...' : link;
                html += '<div class="link-item">' +
                       '<span class="link-text" title="' + link + '">' + displayLink + '</span>' +
                       '<button type="button" class="remove-link-btn" onclick="removeLocalLink(' + index + ')">Remove</button>' +
                       '</div>';
            });
            
            html += '<div class="links-count">' + localGoogleDocLinks.length + ' link(s) ready to save</div>';
            linksList.innerHTML = html;
        }

        // Remove link from local array
        function removeLocalLink(index) {
            localGoogleDocLinks.splice(index, 1);
            updateLinksDisplay();
            showAlert('Link removed from local list', 'info');
        }

        // Clear local links when form is reset
        function clearLocalGoogleDocLinks() {
            localGoogleDocLinks = [];
            updateLinksDisplay();
        }

        // Initialize empty display
        updateLinksDisplay();

        // Add channel form handler
        document.getElementById('addChannelForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            // Collect selected products from checkbox grid
            const selectedProducts = Array.from(
                document.querySelectorAll('#productGrid input[type="checkbox"]:checked')
            ).map(el => el.value);
            document.getElementById('productsHidden').value = selectedProducts.join(',');

            const channelType = document.getElementById('channelType').value;
            const channelData = {
                ...credentials,
                guildId: currentGuild,
                channelId: formData.get('channelId'),
                channelName: formData.get('channelName')
            };
            if (channelType === 'public') {
                channelData.products = selectedProducts;
                channelData.googleDocLinks = localGoogleDocLinks;
                if (!channelData.products || channelData.products.length === 0) {
                    showAlert('Please select at least one product.', 'error');
                    return;
                }
            } else {
                channelData.googleDocLinks = localGoogleDocLinks;
            }
            
            try {
                const response = await fetch(channelType === 'public' ? '/api/public-channels/add' : '/api/ticket-channels/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(channelData)
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    const message = localGoogleDocLinks.length > 0 
                        ? '✅ Channel added successfully with ' + localGoogleDocLinks.length + ' Google Docs links!'
                        : '✅ Channel added successfully!';
                    showAlert(message, 'success');
                    e.target.reset();
                    clearLocalGoogleDocLinks();
                    await loadChannels();
                } else {
                    showAlert(result.error || 'Failed to add channel', 'error');
                }
            } catch (error) {
                showAlert('Failed to add channel. Please try again.', 'error');
            }
        });

        // Initialize product grid UI
        function renderProductGrid(filterText = '') {
            const grid = document.getElementById('productGrid');
            if (!grid) return;
            grid.innerHTML = '';
            const term = (filterText || '').toLowerCase();
            const items = availableProducts.filter(p => !term || p.label.toLowerCase().includes(term) || p.key.includes(term));
            items.forEach(p => {
                const id = 'prod_' + p.key;
                const card = document.createElement('label');
                card.className = 'product-card';
                card.innerHTML = '<input class="product-checkbox" type="checkbox" value="' + p.key + 
                    '" id="' + id + '"><span class="product-title">' + p.label + '</span>';
                grid.appendChild(card);
            });
        }

        renderProductGrid();
        const searchInput = document.getElementById('productSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => renderProductGrid(e.target.value));
        }
        // Toggle public-only groups
        const channelTypeEl = document.getElementById('channelType');
        const productsGroup = document.getElementById('productsGroup');
        function updateTypeUI() {
            const isPublic = channelTypeEl.value === 'public';
            productsGroup.style.display = isPublic ? 'block' : 'none';
        }
        channelTypeEl.addEventListener('change', updateTypeUI);
        updateTypeUI();

        // Load guilds
        async function loadGuilds() {
            try {
                const response = await fetch('/api/guilds/list', {
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
                    option.textContent = guild.name + ' (' + guild.guildId + ')';
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
            const ticketChannelsSection = document.getElementById('ticketChannelsSection');
            const guildInfo = document.getElementById('guildInfo');
            const channelsList = document.getElementById('channelsList');
            const ticketChannelsList = document.getElementById('ticketChannelsList');
            
            if (!guildId) {
                addSection.style.display = 'none';
                channelsSection.style.display = 'none';
                if (ticketChannelsSection) ticketChannelsSection.style.display = 'none';
                guildInfo.style.display = 'none';
                return;
            }
            
            // Show sections
            addSection.style.display = 'block';
            channelsSection.style.display = 'block';
            if (ticketChannelsSection) ticketChannelsSection.style.display = 'block';
            guildInfo.style.display = 'block';
            
            // Load guild info
            const guildData = document.getElementById('guildSelect').selectedOptions[0].textContent;
            guildInfo.innerHTML = '<strong>Selected:</strong> ' + guildData;
            
            // Load channels
            channelsList.innerHTML = '<div class="loading">Loading channels...</div>';
            
            try {
                const response = await fetch('/api/aggregate/channels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...credentials, guildId })
                });
                
                const data = await response.json();
                
                channelsList.innerHTML = '';
                
                if (!data.public || data.public.length === 0) {
                    channelsList.innerHTML = '<p style="text-align: center; color: #6c757d;">No public channels configured for this server. Add some channels above!</p>';
                } else {
                    // Show dynamic channels only
                    const dynamicHeader = document.createElement('h4');
                    dynamicHeader.textContent = 'Public Channels';
                    dynamicHeader.style.color = '#007bff';
                    dynamicHeader.style.marginBottom = '10px';
                    channelsList.appendChild(dynamicHeader);
                    
                    data.public.forEach(function(channel) {
                        const channelDiv = document.createElement('div');
                        channelDiv.className = 'channel-item';
                        var meta = 'Added: ' + new Date(channel.addedAt).toLocaleDateString() + ' | ' +
                                   'Name: ' + (channel.name || 'N/A') + ' | ' +
                                   'Products: ' + ((channel.products && channel.products.length) ? channel.products.join(', ') : 'None') + ' | ' +
                                   'Google Docs: ' + ((channel.googleDocLinks && channel.googleDocLinks.length) ? (channel.googleDocLinks.length + ' links') : 'None');
                        channelDiv.innerHTML = '<div class="channel-info">' +
                                                  '<div class="channel-id">' +
                                                    '<span class="status-indicator status-dynamic"></span>' + channel.channelId +
                                                  '</div>' +
                                                  '<div class="channel-meta">' + meta + '</div>' +
                                                '</div>';
                        const removeBtn = document.createElement('button');
                        removeBtn.className = 'btn btn-danger';
                        removeBtn.textContent = 'Remove';
                        removeBtn.addEventListener('click', () => removeChannel(channel.channelId));
                        channelDiv.appendChild(removeBtn);
                        channelsList.appendChild(channelDiv);
                    });
                }
                
                // Ticket channels list
                if (ticketChannelsList) {
                    ticketChannelsList.innerHTML = '';
                    if (!data.ticket || data.ticket.length === 0) {
                        ticketChannelsList.innerHTML = '<p style="text-align: center; color: #6c757d;">No ticket channels configured. Add one above.</p>';
                    } else {
                        data.ticket.forEach(function(ch) {
                            const div = document.createElement('div');
                            div.className = 'channel-item';
                            var meta = 'Added: ' + new Date(ch.addedAt).toLocaleDateString() + ' | ' +
                                       'Name: ' + (ch.name || 'N/A') + ' | ' +
                                       'Google Docs: ' + ((ch.googleDocLinks && ch.googleDocLinks.length) ? (ch.googleDocLinks.length + ' links') : 'None');
                            div.innerHTML = '<div class="channel-info">' +
                                              '<div class="channel-id">' +
                                                '<span class="status-indicator status-dynamic"></span>' + ch.channelId +
                                              '</div>' +
                                              '<div class="channel-meta">' + meta + '</div>' +
                                            '</div>';
                            const removeBtn = document.createElement('button');
                            removeBtn.className = 'btn btn-danger';
                            removeBtn.textContent = 'Remove';
                            removeBtn.addEventListener('click', () => removeTicketChannel(ch.channelId));
                            div.appendChild(removeBtn);
                            ticketChannelsList.appendChild(div);
                        });
                    }
                }
                
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
                const response = await fetch('/api/public-channels/remove', {
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

        // Remove ticket channel
        async function removeTicketChannel(channelId) {
            if (!confirm('Are you sure you want to remove this ticket channel?')) {
                return;
            }
            try {
                const resp = await fetch('/api/ticket-channels/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...credentials, guildId: currentGuild, channelId })
                });
                const result = await resp.json();
                if (resp.ok) {
                    showAlert('✅ Ticket channel removed successfully!', 'success');
                    await loadChannels();
                } else {
                    showAlert(result.error || 'Failed to remove ticket channel', 'error');
                }
            } catch (err) {
                showAlert('Failed to remove ticket channel. Please try again.', 'error');
            }
        }

        // Show alert
        function showAlert(message, type) {
            const alertContainer = document.getElementById('alertContainer');
            const alert = document.createElement('div');
            alert.className = 'alert alert-' + type;
            alert.innerHTML = message;
            
            alertContainer.appendChild(alert);
            
            setTimeout(() => {
                alert.remove();
            }, 8000);
        }
    </script>
</body>
</html>
  `;
}

export default renderChannelManagerPage;


