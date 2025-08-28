const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

/**
 * ErrorHandler class for comprehensive error handling throughout the application
 * Provides try-catch blocks around file operations with meaningful error messages
 * Implements graceful degradation when files cannot be processed
 * Adds validation for user inputs in manual mode
 */
class ErrorHandler {
  constructor(config = {}) {
    this.config = {
      logErrors: config.logErrors !== false, // Default to true
      logFile: config.logFile || '.console-log-cleanup-errors.log',
      maxLogSize: config.maxLogSize || 10 * 1024 * 1024, // 10MB
      colors: config.colors || {},
      verbose: config.verbose || false,
      ...config
    };
    
    // Error categories and their handling strategies
    this.errorCategories = {
      FILE_SYSTEM: 'file_system',
      PARSING: 'parsing',
      USER_INPUT: 'user_input',
      PROCESSING: 'processing',
      BACKUP: 'backup',
      VALIDATION: 'validation'
    };
    
    // Track errors during session
    this.errorLog = [];
    this.errorStats = {
      total: 0,
      byCategory: {},
      byFile: new Map(),
      recoverable: 0,
      fatal: 0
    };
    
    // Initialize error categories stats
    Object.values(this.errorCategories).forEach(category => {
      this.errorStats.byCategory[category] = 0;
    });
  }

  /**
   * Handle file system errors with appropriate recovery strategies
   * @param {Error} error - The error object
   * @param {string} filePath - Path to the file that caused the error
   * @param {string} operation - The operation that failed
   * @returns {Object} Error handling result with recovery options
   */
  handleFileSystemError(error, filePath, operation = 'unknown') {
    const errorInfo = {
      category: this.errorCategories.FILE_SYSTEM,
      type: this._categorizeFileSystemError(error),
      filePath,
      operation,
      error: error.message,
      code: error.code,
      recoverable: false,
      recovery: null,
      timestamp: new Date()
    };

    // Determine recovery strategy based on error type
    switch (error.code) {
      case 'ENOENT':
        errorInfo.recoverable = true;
        errorInfo.recovery = 'skip_file';
        errorInfo.message = `File not found: ${filePath}. Skipping file.`;
        break;
        
      case 'EACCES':
      case 'EPERM':
        errorInfo.recoverable = true;
        errorInfo.recovery = 'skip_file';
        errorInfo.message = `Permission denied: ${filePath}. Skipping file.`;
        break;
        
      case 'EMFILE':
      case 'ENFILE':
        errorInfo.recoverable = true;
        errorInfo.recovery = 'retry_later';
        errorInfo.message = `Too many open files. Will retry processing ${filePath}.`;
        break;
        
      case 'ENOSPC':
        errorInfo.recoverable = false;
        errorInfo.recovery = 'abort';
        errorInfo.message = `No space left on device. Cannot continue processing.`;
        break;
        
      case 'EISDIR':
        errorInfo.recoverable = true;
        errorInfo.recovery = 'skip_file';
        errorInfo.message = `${filePath} is a directory, not a file. Skipping.`;
        break;
        
      default:
        errorInfo.recoverable = true;
        errorInfo.recovery = 'skip_file';
        errorInfo.message = `File system error for ${filePath}: ${error.message}. Skipping file.`;
    }

    this._logError(errorInfo);
    return errorInfo;
  }

  /**
   * Handle parsing errors with context information
   * @param {Error} error - The parsing error
   * @param {string} filePath - Path to the file being parsed
   * @param {number} lineNumber - Line number where error occurred (if known)
   * @param {string} content - Content that caused the error (optional)
   * @returns {Object} Error handling result
   */
  handleParsingError(error, filePath, lineNumber = null, content = null) {
    const errorInfo = {
      category: this.errorCategories.PARSING,
      type: 'syntax_error',
      filePath,
      lineNumber,
      content: content ? content.substring(0, 100) : null, // Limit content length
      error: error.message,
      recoverable: true,
      recovery: 'skip_file',
      timestamp: new Date()
    };

    // Determine specific parsing error type
    if (error.message.includes('Unexpected token')) {
      errorInfo.type = 'unexpected_token';
      errorInfo.message = `Syntax error in ${filePath}${lineNumber ? ` at line ${lineNumber}` : ''}: ${error.message}. Skipping file.`;
    } else if (error.message.includes('Unexpected end of input')) {
      errorInfo.type = 'incomplete_syntax';
      errorInfo.message = `Incomplete syntax in ${filePath}: ${error.message}. Skipping file.`;
    } else {
      errorInfo.message = `Parse error in ${filePath}${lineNumber ? ` at line ${lineNumber}` : ''}: ${error.message}. Skipping file.`;
    }

    this._logError(errorInfo);
    return errorInfo;
  }

  /**
   * Handle user input errors with validation and suggestions
   * @param {string} input - The invalid input
   * @param {string} expectedType - What type of input was expected
   * @param {Array<string>} validOptions - Valid options (if applicable)
   * @returns {Object} Error handling result with suggestions
   */
  handleUserInputError(input, expectedType, validOptions = []) {
    const errorInfo = {
      category: this.errorCategories.USER_INPUT,
      type: 'invalid_input',
      input,
      expectedType,
      validOptions,
      recoverable: true,
      recovery: 'prompt_again',
      timestamp: new Date()
    };

    // Generate helpful error message
    if (validOptions.length > 0) {
      errorInfo.message = `Invalid input "${input}". Expected ${expectedType}. Valid options: ${validOptions.join(', ')}`;
    } else {
      errorInfo.message = `Invalid input "${input}". Expected ${expectedType}.`;
    }

    // Provide suggestions based on input
    errorInfo.suggestions = this._generateInputSuggestions(input, validOptions);

    this._logError(errorInfo);
    return errorInfo;
  }

  /**
   * Handle processing errors during console.log analysis or transformation
   * @param {Error} error - The processing error
   * @param {string} filePath - File being processed
   * @param {Object} context - Additional context (line number, operation, etc.)
   * @returns {Object} Error handling result
   */
  handleProcessingError(error, filePath, context = {}) {
    const errorInfo = {
      category: this.errorCategories.PROCESSING,
      type: 'processing_failure',
      filePath,
      context,
      error: error.message,
      recoverable: true,
      recovery: 'skip_operation',
      timestamp: new Date()
    };

    // Categorize processing errors
    if (error.message.includes('memory') || error.message.includes('heap')) {
      errorInfo.type = 'memory_error';
      errorInfo.recovery = 'skip_file';
      errorInfo.message = `Memory error processing ${filePath}: ${error.message}. File may be too large. Skipping.`;
    } else if (error.message.includes('timeout')) {
      errorInfo.type = 'timeout_error';
      errorInfo.recovery = 'retry_with_timeout';
      errorInfo.message = `Timeout processing ${filePath}: ${error.message}. Will retry with extended timeout.`;
    } else if (context.operation === 'transformation') {
      errorInfo.type = 'transformation_error';
      errorInfo.message = `Failed to transform console.log in ${filePath}${context.lineNumber ? ` at line ${context.lineNumber}` : ''}: ${error.message}. Skipping this console.log.`;
    } else {
      errorInfo.message = `Processing error in ${filePath}: ${error.message}. Skipping operation.`;
    }

    this._logError(errorInfo);
    return errorInfo;
  }

  /**
   * Handle backup-related errors
   * @param {Error} error - The backup error
   * @param {string} operation - Backup operation (create, restore, cleanup)
   * @param {string} filePath - File path related to backup
   * @returns {Object} Error handling result
   */
  handleBackupError(error, operation, filePath) {
    const errorInfo = {
      category: this.errorCategories.BACKUP,
      type: `backup_${operation}_error`,
      operation,
      filePath,
      error: error.message,
      recoverable: false,
      recovery: 'abort',
      timestamp: new Date()
    };

    switch (operation) {
      case 'create':
        errorInfo.message = `Failed to create backup for ${filePath}: ${error.message}. Cannot proceed without backup.`;
        break;
      case 'restore':
        errorInfo.message = `Failed to restore ${filePath} from backup: ${error.message}. Manual intervention may be required.`;
        break;
      case 'cleanup':
        errorInfo.recoverable = true;
        errorInfo.recovery = 'continue';
        errorInfo.message = `Failed to cleanup backup for ${filePath}: ${error.message}. Continuing with other operations.`;
        break;
      default:
        errorInfo.message = `Backup operation '${operation}' failed for ${filePath}: ${error.message}.`;
    }

    this._logError(errorInfo);
    return errorInfo;
  }

  /**
   * Handle validation errors
   * @param {string} validationType - Type of validation that failed
   * @param {Object} validationResult - Result from validation
   * @param {string} context - Context where validation failed
   * @returns {Object} Error handling result
   */
  handleValidationError(validationType, validationResult, context) {
    const errorInfo = {
      category: this.errorCategories.VALIDATION,
      type: `validation_${validationType}_error`,
      validationType,
      validationResult,
      context,
      recoverable: true,
      recovery: 'skip_operation',
      timestamp: new Date()
    };

    switch (validationType) {
      case 'syntax':
        errorInfo.message = `Syntax validation failed in ${context}: ${validationResult.errors?.join(', ') || 'Unknown syntax error'}. Skipping operation.`;
        break;
      case 'backup_integrity':
        errorInfo.message = `Backup integrity validation failed: ${validationResult.errors?.join(', ') || 'Backup corruption detected'}. Manual verification recommended.`;
        errorInfo.recovery = 'manual_intervention';
        break;
      case 'transformation':
        errorInfo.message = `Transformation validation failed in ${context}: Code structure may be compromised. Skipping transformation.`;
        break;
      default:
        errorInfo.message = `Validation error (${validationType}) in ${context}: Operation may not be safe. Skipping.`;
    }

    this._logError(errorInfo);
    return errorInfo;
  }

  /**
   * Validate user input with comprehensive checks
   * @param {string} input - User input to validate
   * @param {string} inputType - Expected input type
   * @param {Object} constraints - Validation constraints
   * @returns {Object} Validation result
   */
  validateUserInput(input, inputType, constraints = {}) {
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
      sanitized: input
    };

    // Basic null/undefined check
    if (input === null || input === undefined) {
      validation.valid = false;
      validation.errors.push('Input cannot be null or undefined');
      return validation;
    }

    // Convert to string for validation
    const inputStr = String(input).trim();
    validation.sanitized = inputStr;

    switch (inputType) {
      case 'choice':
        validation = this._validateChoice(inputStr, constraints.validChoices || [], validation);
        break;
      case 'file_path':
        validation = this._validateFilePath(inputStr, constraints, validation);
        break;
      case 'directory_path':
        validation = this._validateDirectoryPath(inputStr, constraints, validation);
        break;
      case 'number':
        validation = this._validateNumber(inputStr, constraints, validation);
        break;
      case 'boolean':
        validation = this._validateBoolean(inputStr, validation);
        break;
      case 'pattern':
        validation = this._validatePattern(inputStr, constraints.pattern, validation);
        break;
      default:
        validation.warnings.push(`Unknown input type: ${inputType}`);
    }

    // Check length constraints
    if (constraints.minLength && inputStr.length < constraints.minLength) {
      validation.valid = false;
      validation.errors.push(`Input must be at least ${constraints.minLength} characters long`);
    }

    if (constraints.maxLength && inputStr.length > constraints.maxLength) {
      validation.valid = false;
      validation.errors.push(`Input must be no more than ${constraints.maxLength} characters long`);
    }

    return validation;
  }

  /**
   * Implement graceful degradation when files cannot be processed
   * @param {string} filePath - File that cannot be processed
   * @param {Object} errorInfo - Error information
   * @returns {Object} Degradation strategy
   */
  gracefullyDegrade(filePath, errorInfo) {
    const degradation = {
      strategy: 'skip',
      message: '',
      alternatives: [],
      impact: 'minimal'
    };

    switch (errorInfo.category) {
      case this.errorCategories.FILE_SYSTEM:
        if (errorInfo.code === 'EACCES' || errorInfo.code === 'EPERM') {
          degradation.strategy = 'skip_with_warning';
          degradation.message = `Skipping ${filePath} due to permission issues. Consider running with appropriate permissions.`;
          degradation.alternatives = ['Run with elevated permissions', 'Change file permissions', 'Skip this file'];
        } else if (errorInfo.code === 'ENOENT') {
          degradation.strategy = 'skip_silently';
          degradation.message = `File ${filePath} no longer exists. Skipping.`;
        }
        break;

      case this.errorCategories.PARSING:
        degradation.strategy = 'skip_with_warning';
        degradation.message = `Skipping ${filePath} due to syntax errors. File may not be valid JavaScript.`;
        degradation.alternatives = ['Fix syntax errors manually', 'Skip this file', 'Process other files'];
        degradation.impact = 'moderate';
        break;

      case this.errorCategories.PROCESSING:
        if (errorInfo.type === 'memory_error') {
          degradation.strategy = 'skip_with_suggestion';
          degradation.message = `Skipping ${filePath} due to memory constraints. File may be too large.`;
          degradation.alternatives = ['Process file manually', 'Increase memory limit', 'Split large file'];
          degradation.impact = 'moderate';
        } else {
          degradation.strategy = 'partial_processing';
          degradation.message = `Continuing with partial processing of ${filePath}. Some console.log statements may not be processed.`;
          degradation.impact = 'minimal';
        }
        break;

      default:
        degradation.message = `Skipping ${filePath} due to unexpected error: ${errorInfo.error}`;
    }

    return degradation;
  }

  /**
   * Get comprehensive error statistics
   * @returns {Object} Error statistics
   */
  getErrorStats() {
    return {
      ...this.errorStats,
      errorRate: this.errorStats.total > 0 ? (this.errorStats.fatal / this.errorStats.total) : 0,
      recoveryRate: this.errorStats.total > 0 ? (this.errorStats.recoverable / this.errorStats.total) : 0,
      recentErrors: this.errorLog.slice(-10) // Last 10 errors
    };
  }

  /**
   * Generate error report
   * @returns {Promise<string>} Path to error report file
   */
  async generateErrorReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.getErrorStats(),
      errors: this.errorLog,
      recommendations: this._generateRecommendations()
    };

    const reportContent = JSON.stringify(report, null, 2);
    const reportPath = `error-report-${Date.now()}.json`;

    try {
      await writeFile(reportPath, reportContent, 'utf8');
      return reportPath;
    } catch (error) {
      console.error(`Failed to write error report: ${error.message}`);
      return null;
    }
  }

  /**
   * Clear error log and reset statistics
   */
  clearErrorLog() {
    this.errorLog = [];
    this.errorStats = {
      total: 0,
      byCategory: {},
      byFile: new Map(),
      recoverable: 0,
      fatal: 0
    };

    // Reset category stats
    Object.values(this.errorCategories).forEach(category => {
      this.errorStats.byCategory[category] = 0;
    });
  }

  // Private helper methods

  /**
   * Log an error with appropriate formatting and storage
   * @param {Object} errorInfo - Error information object
   */
  _logError(errorInfo) {
    // Update statistics
    this.errorStats.total++;
    this.errorStats.byCategory[errorInfo.category]++;
    
    if (errorInfo.recoverable) {
      this.errorStats.recoverable++;
    } else {
      this.errorStats.fatal++;
    }

    // Track errors by file
    if (errorInfo.filePath) {
      const fileErrors = this.errorStats.byFile.get(errorInfo.filePath) || 0;
      this.errorStats.byFile.set(errorInfo.filePath, fileErrors + 1);
    }

    // Store error in log
    this.errorLog.push(errorInfo);

    // Display error if verbose or if it's fatal
    if (this.config.verbose || !errorInfo.recoverable) {
      this._displayError(errorInfo);
    }

    // Write to log file if enabled
    if (this.config.logErrors) {
      this._writeErrorToFile(errorInfo);
    }
  }

  /**
   * Display error with appropriate formatting
   * @param {Object} errorInfo - Error information
   */
  _displayError(errorInfo) {
    const colors = this.config.colors;
    const errorColor = errorInfo.recoverable ? (colors.yellow || '') : (colors.red || '');
    const resetColor = colors.reset || '';
    
    const prefix = errorInfo.recoverable ? 'WARNING' : 'ERROR';
    console.error(`${errorColor}${prefix}: ${errorInfo.message}${resetColor}`);
    
    if (this.config.verbose && errorInfo.context) {
      console.error(`  Context: ${JSON.stringify(errorInfo.context)}`);
    }
  }

  /**
   * Write error to log file
   * @param {Object} errorInfo - Error information
   */
  async _writeErrorToFile(errorInfo) {
    try {
      const logEntry = `${errorInfo.timestamp.toISOString()} [${errorInfo.category.toUpperCase()}] ${errorInfo.message}\n`;
      
      // Ensure log directory exists
      const logDir = path.dirname(this.config.logFile);
      if (logDir !== '.') {
        await mkdir(logDir, { recursive: true });
      }
      
      // Append to log file
      await writeFile(this.config.logFile, logEntry, { flag: 'a' });
      
    } catch (error) {
      // Ignore errors writing to log file to avoid infinite recursion
    }
  }

  /**
   * Categorize file system errors
   * @param {Error} error - File system error
   * @returns {string} Error category
   */
  _categorizeFileSystemError(error) {
    const code = error.code;
    
    if (['ENOENT', 'ENOTDIR'].includes(code)) return 'not_found';
    if (['EACCES', 'EPERM'].includes(code)) return 'permission';
    if (['EMFILE', 'ENFILE'].includes(code)) return 'resource_limit';
    if (['ENOSPC', 'EDQUOT'].includes(code)) return 'storage_full';
    if (['EISDIR', 'ENOTDIR'].includes(code)) return 'wrong_type';
    
    return 'unknown';
  }

  /**
   * Generate input suggestions based on invalid input
   * @param {string} input - Invalid input
   * @param {Array<string>} validOptions - Valid options
   * @returns {Array<string>} Suggestions
   */
  _generateInputSuggestions(input, validOptions) {
    const suggestions = [];
    
    if (validOptions.length === 0) return suggestions;
    
    const inputLower = input.toLowerCase();
    
    // Find close matches
    for (const option of validOptions) {
      const optionLower = option.toLowerCase();
      
      // Exact match (case insensitive)
      if (inputLower === optionLower) {
        suggestions.push(`Did you mean "${option}"?`);
        break;
      }
      
      // Starts with
      if (optionLower.startsWith(inputLower) || inputLower.startsWith(optionLower)) {
        suggestions.push(`Did you mean "${option}"?`);
      }
      
      // Contains
      if (optionLower.includes(inputLower) || inputLower.includes(optionLower)) {
        suggestions.push(`Did you mean "${option}"?`);
      }
    }
    
    // If no close matches, suggest first few options
    if (suggestions.length === 0) {
      const maxSuggestions = Math.min(3, validOptions.length);
      suggestions.push(`Try one of: ${validOptions.slice(0, maxSuggestions).join(', ')}`);
    }
    
    return suggestions;
  }

  /**
   * Validate choice input
   * @param {string} input - Input to validate
   * @param {Array<string>} validChoices - Valid choices
   * @param {Object} validation - Validation object to update
   * @returns {Object} Updated validation object
   */
  _validateChoice(input, validChoices, validation) {
    const inputLower = input.toLowerCase();
    const validChoice = validChoices.find(choice => choice.toLowerCase() === inputLower);
    
    if (!validChoice) {
      validation.valid = false;
      validation.errors.push(`Invalid choice "${input}". Valid options: ${validChoices.join(', ')}`);
    } else {
      validation.sanitized = validChoice; // Use the properly cased version
    }
    
    return validation;
  }

  /**
   * Validate file path input
   * @param {string} input - Input to validate
   * @param {Object} constraints - Validation constraints
   * @param {Object} validation - Validation object to update
   * @returns {Object} Updated validation object
   */
  _validateFilePath(input, constraints, validation) {
    // Check for dangerous characters
    const dangerousChars = /[<>:"|?*\x00-\x1f]/;
    if (dangerousChars.test(input)) {
      validation.valid = false;
      validation.errors.push('File path contains invalid characters');
    }
    
    // Check if path is absolute when it shouldn't be
    if (constraints.relative && path.isAbsolute(input)) {
      validation.valid = false;
      validation.errors.push('Path must be relative');
    }
    
    // Normalize path
    validation.sanitized = path.normalize(input);
    
    return validation;
  }

  /**
   * Validate directory path input
   * @param {string} input - Input to validate
   * @param {Object} constraints - Validation constraints
   * @param {Object} validation - Validation object to update
   * @returns {Object} Updated validation object
   */
  _validateDirectoryPath(input, constraints, validation) {
    // Use same validation as file path
    validation = this._validateFilePath(input, constraints, validation);
    
    // Additional directory-specific validation could go here
    
    return validation;
  }

  /**
   * Validate number input
   * @param {string} input - Input to validate
   * @param {Object} constraints - Validation constraints
   * @param {Object} validation - Validation object to update
   * @returns {Object} Updated validation object
   */
  _validateNumber(input, constraints, validation) {
    const num = Number(input);
    
    if (isNaN(num)) {
      validation.valid = false;
      validation.errors.push('Input must be a valid number');
      return validation;
    }
    
    if (constraints.min !== undefined && num < constraints.min) {
      validation.valid = false;
      validation.errors.push(`Number must be at least ${constraints.min}`);
    }
    
    if (constraints.max !== undefined && num > constraints.max) {
      validation.valid = false;
      validation.errors.push(`Number must be no more than ${constraints.max}`);
    }
    
    if (constraints.integer && !Number.isInteger(num)) {
      validation.valid = false;
      validation.errors.push('Number must be an integer');
    }
    
    validation.sanitized = num;
    return validation;
  }

  /**
   * Validate boolean input
   * @param {string} input - Input to validate
   * @param {Object} validation - Validation object to update
   * @returns {Object} Updated validation object
   */
  _validateBoolean(input, validation) {
    const inputLower = input.toLowerCase();
    const trueValues = ['true', 'yes', 'y', '1', 'on'];
    const falseValues = ['false', 'no', 'n', '0', 'off'];
    
    if (trueValues.includes(inputLower)) {
      validation.sanitized = true;
    } else if (falseValues.includes(inputLower)) {
      validation.sanitized = false;
    } else {
      validation.valid = false;
      validation.errors.push('Input must be a boolean value (true/false, yes/no, y/n, 1/0, on/off)');
    }
    
    return validation;
  }

  /**
   * Validate pattern input
   * @param {string} input - Input to validate
   * @param {RegExp} pattern - Pattern to match against
   * @param {Object} validation - Validation object to update
   * @returns {Object} Updated validation object
   */
  _validatePattern(input, pattern, validation) {
    if (!pattern.test(input)) {
      validation.valid = false;
      validation.errors.push(`Input does not match required pattern: ${pattern.toString()}`);
    }
    
    return validation;
  }

  /**
   * Generate recommendations based on error patterns
   * @returns {Array<string>} Array of recommendations
   */
  _generateRecommendations() {
    const recommendations = [];
    
    // File system error recommendations
    const fsErrors = this.errorStats.byCategory[this.errorCategories.FILE_SYSTEM] || 0;
    if (fsErrors > 0) {
      recommendations.push('Consider checking file permissions and disk space');
      recommendations.push('Verify that all file paths are correct and accessible');
    }
    
    // Parsing error recommendations
    const parseErrors = this.errorStats.byCategory[this.errorCategories.PARSING] || 0;
    if (parseErrors > 0) {
      recommendations.push('Review files with syntax errors - they may not be valid JavaScript');
      recommendations.push('Consider using a linter to identify syntax issues before running the cleanup tool');
    }
    
    // High error rate recommendations
    const errorRate = this.errorStats.total > 0 ? (this.errorStats.fatal / this.errorStats.total) : 0;
    if (errorRate > 0.1) {
      recommendations.push('High error rate detected - consider running in dry-run mode first');
      recommendations.push('Review error log for patterns that might indicate systematic issues');
    }
    
    return recommendations;
  }
}

module.exports = ErrorHandler;