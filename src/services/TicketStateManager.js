/**
 * TicketStateManager - Enhanced ticket state management
 * 
 * This service improves upon TicketSelectionService with:
 * - Type validation and error checking
 * - State transition validation
 * - Enhanced monitoring and debugging
 * - Performance optimizations
 * - Better data structure
 * 
 * Can be used as a drop-in replacement for TicketSelectionService
 */
class TicketStateManager {
  constructor() {
    // Map to store ticket state: channelId -> ticketState
    this.ticketStates = new Map();
    
    // Performance monitoring
    this.metrics = {
      totalTickets: 0,
      activeTickets: 0,
      escalatedTickets: 0,
      resolvedTickets: 0,
      averageResolutionTime: 0
    };
    
    // Valid state transitions
    this.validTransitions = {
      'created': ['category_selected', 'escalated', 'closed'],
      'category_selected': ['product_selected', 'escalated', 'closed'],
      'product_selected': ['escalated', 'closed'],
      'escalated': ['closed'],
      'closed': [] // Terminal state
    };
    
    // Valid states
    this.validStates = ['created', 'category_selected', 'product_selected', 'escalated', 'closed'];
    
    // Valid categories
    this.validCategories = [
      'category_general', 'category_software', 'category_hardware', 
      'category_bug', 'category_billing'
    ];
    
    // Valid products
    this.validProducts = [
      'ufb', 'earthrover', 'earthrover_school', 'sam', 'robotsfun', 'et_fugi'
    ];
  }

  /**
   * Get current ticket state for a channel
   * @param {string} channelId - Discord channel ID
   * @returns {Object} Ticket state object
   */
  get(channelId) {
    if (!channelId || typeof channelId !== 'string') {
      console.warn('⚠️ Invalid channelId provided to get():', channelId);
      return this.getDefaultState();
    }
    
    return this.ticketStates.get(channelId) || this.getDefaultState();
  }

  /**
   * Set ticket state for a channel with validation
   * @param {string} channelId - Discord channel ID
   * @param {Object} state - New ticket state
   * @returns {boolean} Success status
   */
  set(channelId, state) {
    if (!channelId || typeof channelId !== 'string') {
      console.error('❌ Invalid channelId provided to set():', channelId);
      return false;
    }
    
    if (!state || typeof state !== 'object') {
      console.error('❌ Invalid state provided to set():', state);
      return false;
    }
    
    try {
      const currentState = this.get(channelId);
      const newState = { ...this.getDefaultState(), ...currentState, ...state };
      
      // Validate the new state
      if (!this.validateState(newState)) {
        console.error('❌ State validation failed for:', newState);
        return false;
      }
      
      // Validate state transition if state field is being updated
      if (state.state && currentState.state && !this.isValidTransition(currentState.state, state.state)) {
        console.error(`❌ Invalid state transition: ${currentState.state} -> ${state.state}`);
        return false;
      }
      
      // Update timestamps
      newState.lastUpdated = Date.now();
      if (!currentState.createdAt) {
        newState.createdAt = Date.now();
        this.metrics.totalTickets++;
      }
      
      // Store the state
      this.ticketStates.set(channelId, newState);
      
      // Update metrics
      this.updateMetrics(currentState, newState);
      
      console.log(`✅ State updated for ${channelId}:`, {
        oldState: currentState.state || 'new',
        newState: newState.state,
        product: newState.product,
        escalated: newState.humanHelp
      });
      
      return true;
    } catch (error) {
      console.error('❌ Error setting ticket state:', error);
      return false;
    }
  }

  /**
   * Clear ticket state when channel is closed
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} Success status
   */
  clear(channelId) {
    if (!channelId || typeof channelId !== 'string') {
      console.warn('⚠️ Invalid channelId provided to clear():', channelId);
      return false;
    }
    
    const state = this.get(channelId);
    if (state.createdAt) {
      // Calculate resolution time
      const resolutionTime = Date.now() - state.createdAt;
      this.updateResolutionMetrics(resolutionTime);
      
      // Update metrics
      this.metrics.activeTickets = Math.max(0, this.metrics.activeTickets - 1);
      if (state.humanHelp) {
        this.metrics.escalatedTickets = Math.max(0, this.metrics.escalatedTickets - 1);
      }
      this.metrics.resolvedTickets++;
    }
    
    const deleted = this.ticketStates.delete(channelId);
    if (deleted) {
      console.log(`🗑️ Cleared state for ${channelId}`);
    }
    
    return deleted;
  }

  /**
   * Check if channel has active ticket state
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} True if ticket state exists
   */
  has(channelId) {
    if (!channelId || typeof channelId !== 'string') {
      return false;
    }
    
    return this.ticketStates.has(channelId);
  }

  /**
   * Get default ticket state
   * @returns {Object} Default state object
   */
  getDefaultState() {
    return {
      product: null,              // Selected product (ufb, earthrover, etc.)
      category: null,             // Selected category (hardware, billing, etc.)
      humanHelp: false,           // Whether human help is requested
      questionsAnswered: false,   // Whether category questions were answered
      state: 'created',           // Current state in the flow
      createdAt: null,           // Timestamp when ticket was created
      lastUpdated: null,         // Timestamp of last update
      lastActivity: Date.now(),  // Timestamp of last user activity
      interactionCount: 0,       // Number of user interactions
      escalationReason: null     // Reason for escalation
    };
  }

  /**
   * Update specific field in ticket state with validation
   * @param {string} channelId - Discord channel ID
   * @param {string} field - Field name to update
   * @param {any} value - New value
   * @returns {boolean} Success status
   */
  updateField(channelId, field, value) {
    if (!channelId || typeof channelId !== 'string') {
      console.error('❌ Invalid channelId provided to updateField():', channelId);
      return false;
    }
    
    if (!field || typeof field !== 'string') {
      console.error('❌ Invalid field provided to updateField():', field);
      return false;
    }
    
    const currentState = this.get(channelId);
    const updates = { [field]: value };
    
    return this.set(channelId, updates);
  }

  /**
   * Check if ticket is ready for AI responses
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} True if AI can respond
   */
  canAIRespond(channelId) {
    const state = this.get(channelId);
    return !state.humanHelp && 
           state.product !== null && 
           state.state !== 'escalated' &&
           state.state !== 'closed';
  }

  /**
   * Mark ticket for human escalation
   * @param {string} channelId - Discord channel ID
   * @param {string} reason - Escalation reason (optional)
   * @returns {boolean} Success status
   */
  escalateToHuman(channelId, reason = null) {
    return this.set(channelId, {
      humanHelp: true,
      state: 'escalated',
      escalationReason: reason
    });
  }

  /**
   * Reset ticket to allow AI responses again
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} Success status
   */
  resetForAI(channelId) {
    return this.set(channelId, {
      humanHelp: false,
      state: 'created',
      escalationReason: null
    });
  }

  /**
   * Validate ticket state object
   * @param {Object} state - State object to validate
   * @returns {boolean} True if valid
   */
  validateState(state) {
    // Check required fields exist
    const requiredFields = ['product', 'category', 'humanHelp', 'questionsAnswered', 'state'];
    for (const field of requiredFields) {
      if (!(field in state)) {
        console.error(`❌ Missing required field: ${field}`);
        return false;
      }
    }
    
    // Validate state value
    if (state.state && !this.validStates.includes(state.state)) {
      console.error(`❌ Invalid state: ${state.state}`);
      return false;
    }
    
    // Validate category
    if (state.category && !this.validCategories.includes(state.category)) {
      console.error(`❌ Invalid category: ${state.category}`);
      return false;
    }
    
    // Validate product
    if (state.product && !this.validProducts.includes(state.product)) {
      console.error(`❌ Invalid product: ${state.product}`);
      return false;
    }
    
    // Validate boolean fields
    if (typeof state.humanHelp !== 'boolean') {
      console.error(`❌ humanHelp must be boolean: ${state.humanHelp}`);
      return false;
    }
    
    if (typeof state.questionsAnswered !== 'boolean') {
      console.error(`❌ questionsAnswered must be boolean: ${state.questionsAnswered}`);
      return false;
    }
    
    return true;
  }

  /**
   * Check if state transition is valid
   * @param {string} fromState - Current state
   * @param {string} toState - Target state
   * @returns {boolean} True if transition is valid
   */
  isValidTransition(fromState, toState) {
    if (!fromState || !toState) return true; // Allow initial state setting
    
    const validNextStates = this.validTransitions[fromState] || [];
    return validNextStates.includes(toState);
  }

  /**
   * Update performance metrics
   * @param {Object} oldState - Previous state
   * @param {Object} newState - New state
   */
  updateMetrics(oldState, newState) {
    // Track active tickets
    if (!oldState.createdAt && newState.createdAt) {
      this.metrics.activeTickets++;
    }
    
    // Track escalations
    if (!oldState.humanHelp && newState.humanHelp) {
      this.metrics.escalatedTickets++;
    } else if (oldState.humanHelp && !newState.humanHelp) {
      this.metrics.escalatedTickets = Math.max(0, this.metrics.escalatedTickets - 1);
    }
  }

  /**
   * Update resolution time metrics
   * @param {number} resolutionTime - Time in milliseconds
   */
  updateResolutionMetrics(resolutionTime) {
    const currentAvg = this.metrics.averageResolutionTime;
    const resolvedCount = this.metrics.resolvedTickets;
    
    // Calculate new average (simple moving average)
    if (resolvedCount === 0) {
      this.metrics.averageResolutionTime = resolutionTime;
    } else {
      this.metrics.averageResolutionTime = 
        ((currentAvg * resolvedCount) + resolutionTime) / (resolvedCount + 1);
    }
  }

  /**
   * Get all tickets in a specific state
   * @param {string} state - State to filter by
   * @returns {Array} Array of {channelId, state} objects
   */
  getTicketsByState(state) {
    const tickets = [];
    for (const [channelId, ticketState] of this.ticketStates) {
      if (ticketState.state === state) {
        tickets.push({ channelId, state: ticketState });
      }
    }
    return tickets;
  }

  /**
   * Get tickets that have been inactive for a certain time
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Array} Array of inactive tickets
   */
  getInactiveTickets(timeoutMs = 60 * 60 * 1000) { // Default 1 hour
    const now = Date.now();
    const inactiveTickets = [];
    
    for (const [channelId, state] of this.ticketStates) {
      if (now - state.lastActivity > timeoutMs) {
        inactiveTickets.push({ channelId, state, inactiveFor: now - state.lastActivity });
      }
    }
    
    return inactiveTickets;
  }

  /**
   * Get comprehensive metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return {
      ...this.metrics,
      averageResolutionTimeFormatted: this.formatDuration(this.metrics.averageResolutionTime),
      escalationRate: this.metrics.totalTickets > 0 ? 
        (this.metrics.escalatedTickets / this.metrics.totalTickets * 100).toFixed(2) + '%' : '0%'
    };
  }

  /**
   * Format duration in milliseconds to human readable format
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(ms) {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  }

  /**
   * Get system health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const now = Date.now();
    return {
      status: 'healthy',
      timestamp: new Date(now).toISOString(),
      ticketCount: this.ticketStates.size,
      metrics: this.getMetrics(),
      memory: {
        ticketStatesSize: this.ticketStates.size,
        estimatedMemoryUsage: `${Math.round(this.ticketStates.size * 0.5)}KB`
      }
    };
  }

  /**
   * Clean up old ticket states (maintenance)
   * @param {number} maxAge - Maximum age in milliseconds
   * @returns {number} Number of states cleaned up
   */
  cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) { // Default 7 days
    const now = Date.now();
    let cleanedUp = 0;
    
    for (const [channelId, state] of this.ticketStates) {
      if (state.state === 'closed' && now - state.lastUpdated > maxAge) {
        this.ticketStates.delete(channelId);
        cleanedUp++;
      }
    }
    
    if (cleanedUp > 0) {
      console.log(`🧹 Cleaned up ${cleanedUp} old ticket states`);
    }
    
    return cleanedUp;
  }

  /**
   * Export ticket data for analysis
   * @returns {Array} Array of ticket data
   */
  exportData() {
    const data = [];
    for (const [channelId, state] of this.ticketStates) {
      data.push({
        channelId,
        ...state,
        duration: state.createdAt ? Date.now() - state.createdAt : null,
        durationFormatted: state.createdAt ? this.formatDuration(Date.now() - state.createdAt) : null
      });
    }
    return data;
  }
}

export default TicketStateManager; 