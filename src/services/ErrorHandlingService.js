/**
 * Centralized service for error handling and logging
 */
class ErrorHandlingService {
  /**
   * Handle async operations with consistent error logging
   * @param {Function} operation - Async operation to execute
   * @param {string} context - Context description for logging
   * @param {Function} fallback - Optional fallback function
   * @returns {Promise<any>} Operation result or fallback result
   */
  static async handleAsync(operation, context, fallback = null) {
    try {
      return await operation();
    } catch (error) {
      console.error(`❌ Error in ${context}:`, error.message);
      
      if (fallback) {
        try {
          return await fallback(error);
        } catch (fallbackError) {
          console.error(`❌ Fallback failed for ${context}:`, fallbackError.message);
          throw fallbackError;
        }
      }
      
      throw error;
    }
  }

  /**
   * Log error with consistent formatting
   * @param {string} context - Context where error occurred
   * @param {Error} error - Error object
   * @param {Object} additionalInfo - Additional information to log
   */
  static logError(context, error, additionalInfo = {}) {
    console.error(`❌ [${context}] Error:`, error.message);
    if (error.stack) {
      console.error(`Stack trace:`, error.stack);
    }
    if (Object.keys(additionalInfo).length > 0) {
      console.error(`Additional info:`, additionalInfo);
    }
  }

  /**
   * Log warning with consistent formatting
   * @param {string} context - Context where warning occurred
   * @param {string} message - Warning message
   * @param {Object} additionalInfo - Additional information to log
   */
  static logWarning(context, message, additionalInfo = {}) {
    console.warn(`⚠️ [${context}] Warning:`, message);
    if (Object.keys(additionalInfo).length > 0) {
      console.warn(`Additional info:`, additionalInfo);
    }
  }

  /**
   * Log info with consistent formatting
   * @param {string} context - Context for the log
   * @param {string} message - Info message
   * @param {Object} additionalInfo - Additional information to log
   */
  static logInfo(context, message, additionalInfo = {}) {
    console.log(`ℹ️ [${context}]:`, message);
    if (Object.keys(additionalInfo).length > 0) {
      console.log(`Details:`, additionalInfo);
    }
  }

  /**
   * Log success with consistent formatting
   * @param {string} context - Context for the log
   * @param {string} message - Success message
   * @param {Object} additionalInfo - Additional information to log
   */
  static logSuccess(context, message, additionalInfo = {}) {
    console.log(`✅ [${context}]:`, message);
    if (Object.keys(additionalInfo).length > 0) {
      console.log(`Details:`, additionalInfo);
    }
  }

  /**
   * Create a safe async wrapper that won't throw
   * @param {Function} operation - Async operation to wrap
   * @param {string} context - Context for error logging
   * @param {any} defaultValue - Default value to return on error
   * @returns {Promise<any>} Operation result or default value
   */
  static async safeAsync(operation, context, defaultValue = null) {
    try {
      return await operation();
    } catch (error) {
      this.logError(context, error);
      return defaultValue;
    }
  }

  /**
   * Retry an async operation with exponential backoff
   * @param {Function} operation - Async operation to retry
   * @param {number} maxRetries - Maximum number of retries
   * @param {string} context - Context for logging
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {Promise<any>} Operation result
   */
  static async retryAsync(operation, maxRetries = 3, context = 'operation', baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        this.logWarning(context, `Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    this.logError(context, lastError, { attempts: maxRetries });
    throw lastError;
  }
}

export default ErrorHandlingService;
