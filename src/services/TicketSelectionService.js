import { getTicketState, setTicketState, clearTicketState } from './TicketStateStore.js';

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
  constructor() {}

  /**
   * Get current ticket state for a channel
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<Object>} Ticket state object
   */
  async get(channelId) {
    return (await getTicketState(channelId)) || this.getDefaultState();
  }

  /**
   * Set ticket state for a channel
   * @param {string} channelId - Discord channel ID
   * @param {Object} state - New ticket state
   */
  async set(channelId, state) {
    await setTicketState(channelId, { ...this.getDefaultState(), ...state });
  }

  /**
   * Clear ticket state when channel is closed
   * @param {string} channelId - Discord channel ID
   */
  async clear(channelId) {
    await clearTicketState(channelId);
  }

  /**
   * Check if channel has active ticket state
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<boolean>} True if ticket state exists
   */
  async has(channelId) {
    return (await getTicketState(channelId)) !== null;
  }

  /**
   * Get default ticket state
   * @returns {Object} Default state object
   */
  getDefaultState() {
    return {
      product: null,
      category: null,
      humanHelp: false,
      questionsAnswered: false,
      lastActivity: Date.now()
    };
  }

  /**
   * Update specific field in ticket state
   * @param {string} channelId - Discord channel ID
   * @param {string} field - Field name to update
   * @param {any} value - New value
   */
  async updateField(channelId, field, value) {
    const currentState = await this.get(channelId);
    await this.set(channelId, { ...currentState, [field]: value });
  }

  /**
   * Check if ticket is ready for AI responses
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<boolean>} True if AI can respond
   */
  async canAIRespond(channelId) {
    const state = await this.get(channelId);
    return !state.humanHelp && state.product !== null;
  }

  /**
   * Mark ticket for human escalation
   * @param {string} channelId - Discord channel ID
   */
  async escalateToHuman(channelId) {
    await this.updateField(channelId, 'humanHelp', true);
  }

  /**
   * Reset ticket to allow AI responses again
   * @param {string} channelId - Discord channel ID
   */
  async resetForAI(channelId) {
    await this.set(channelId, { ...this.getDefaultState() });
  }
}

export default TicketSelectionService; 