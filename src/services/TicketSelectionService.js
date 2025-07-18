/**
 * TicketSelectionService - Manages ticket state and selections
 * 
 * This service tracks the current state of each ticket channel including:
 * - Selected product/category
 * - Human help status
 * - Question flow state
 * 
 * STEP 1: State Management
 */
class TicketSelectionService {
  constructor() {
    // Map to store ticket state: channelId -> ticketState
    this.ticketStates = new Map();
  }

  /**
   * Get current ticket state for a channel
   * @param {string} channelId - Discord channel ID
   * @returns {Object} Ticket state object
   */
  get(channelId) {
    return this.ticketStates.get(channelId) || this.getDefaultState();
  }

  /**
   * Set ticket state for a channel
   * @param {string} channelId - Discord channel ID
   * @param {Object} state - New ticket state
   */
  set(channelId, state) {
    this.ticketStates.set(channelId, { ...this.getDefaultState(), ...state });
  }

  /**
   * Clear ticket state when channel is closed
   * @param {string} channelId - Discord channel ID
   */
  clear(channelId) {
    this.ticketStates.delete(channelId);
  }

  /**
   * Check if channel has active ticket state
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} True if ticket state exists
   */
  has(channelId) {
    return this.ticketStates.has(channelId);
  }

  /**
   * Get default ticket state
   * @returns {Object} Default state object
   */
  getDefaultState() {
    return {
      product: null,        // Selected product (ufb, earthrover, etc.)
      category: null,       // Selected category (hardware, billing, etc.)
      humanHelp: false,     // Whether human help is requested
      questionsAnswered: false, // Whether category questions were answered
      lastActivity: Date.now() // Timestamp of last activity
    };
  }

  /**
   * Update specific field in ticket state
   * @param {string} channelId - Discord channel ID
   * @param {string} field - Field name to update
   * @param {any} value - New value
   */
  updateField(channelId, field, value) {
    const currentState = this.get(channelId);
    this.set(channelId, { ...currentState, [field]: value });
  }

  /**
   * Check if ticket is ready for AI responses
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} True if AI can respond
   */
  canAIRespond(channelId) {
    const state = this.get(channelId);
    return !state.humanHelp && state.product !== null;
  }

  /**
   * Mark ticket for human escalation
   * @param {string} channelId - Discord channel ID
   */
  escalateToHuman(channelId) {
    this.updateField(channelId, 'humanHelp', true);
  }

  /**
   * Reset ticket to allow AI responses again
   * @param {string} channelId - Discord channel ID
   */
  resetForAI(channelId) {
    this.set(channelId, { ...this.getDefaultState() });
  }
}

export default TicketSelectionService; 