const CodeAnalyzer = require('./CodeAnalyzer');
const InteractiveUI = require('./InteractiveUI');
const CodeTransformer = require('./CodeTransformer');

/**
 * ModeController class to handle manual vs auto mode logic
 * Integrates interactive prompts into existing file processing pipeline
 * Ensures manual mode decisions are applied consistently across files
 */
class ModeController {
  constructor(config, colors) {
    this.config = config;
    this.colors = colors;
    
    // Initialize components
    this.codeAnalyzer = new CodeAnalyzer();
    this.codeTransformer = new CodeTransformer();
    this.interactiveUI = config.interactive ? new InteractiveUI(colors) : null;
    
    // Track decisions and statistics
    this.sessionStats = {
      filesProcessed: 0,
      totalReviewed: 0,
      deleted: 0,
      kept: 0,
      convertedToInfo: 0,
      convertedToError: 0,
      skipped: 0,
      commentedLogsRemoved: 0,
      potentiallySensitive: 0
    };
    
    // Track user decisions for consistency
    this.userDecisions = new Map(); // filePath -> decisions array
    this.skipPatterns = new Set(); // Patterns to skip in current file
    this.bulkActions = new Map(); // action -> count for bulk confirmations
  }

  /**
   * Process a file according to the configured mode
   * @param {string} filePath - Path to the file to process
   * @param {string} content - File content
   * @returns {Promise<Object>} Processing result with modifications and statistics
   */
  async processFile(filePath, content) {
    const result = {
      modified: false,
      originalContent: content,
      newContent: content,
      changes: [],
      statistics: {
        consoleLogsFound: 0,
        consoleLogsRemoved: 0,
        consoleLogsConverted: 0,
        commentedLogsRemoved: 0,
        potentiallySensitive: 0
      }
    };

    try {
      // Analyze the file for console.log instances
      const instances = this.codeAnalyzer.analyzeFile(filePath, content);
      
      if (instances.length === 0) {
        if (this.config.verbose) {
          console.log(`${this.colors.yellow}  No console.log statements found in ${filePath}${this.colors.reset}`);
        }
        return result;
      }

      result.statistics.consoleLogsFound = instances.length;
      this.sessionStats.filesProcessed++;

      if (this.config.mode === 'manual' && this.config.interactive) {
        return await this._processFileManualMode(filePath, content, instances, result);
      } else {
        return await this._processFileAutoMode(filePath, content, instances, result);
      }

    } catch (error) {
      console.error(`${this.colors.red}Error processing ${filePath}: ${error.message}${this.colors.reset}`);
      return result;
    }
  }

  /**
   * Process file in manual mode with interactive prompts
   * @param {string} filePath - File path
   * @param {string} content - File content
   * @param {Array} instances - Console.log instances
   * @param {Object} result - Result object to populate
   * @returns {Promise<Object>} Processing result
   */
  async _processFileManualMode(filePath, content, instances, result) {
    const lines = content.split('\n');
    const decisions = [];
    
    // Clear skip patterns for new file
    this.skipPatterns.clear();

    console.log(`\n${this.colors.blue}${this.colors.bold}Processing file: ${filePath}${this.colors.reset}`);
    console.log(`${this.colors.blue}Found ${instances.length} console.log statement(s)${this.colors.reset}`);

    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      
      // Update instance with functional analysis
      instance.isFunctional = this.codeAnalyzer.isFunctionalLog(instance);
      
      // Check for sensitive data
      const sensitiveData = this._detectSensitiveData(instance.content);
      if (sensitiveData.isSensitive) {
        result.statistics.potentiallySensitive++;
        this.sessionStats.potentiallySensitive++;
        instance.sensitiveData = sensitiveData;
      }

      // Show progress
      if (this.interactiveUI) {
        this.interactiveUI.showProgress(i + 1, instances.length, filePath);
      }

      // Check if we should skip this instance based on previous decisions
      if (this._shouldSkipInstance(instance)) {
        decisions.push({ instance, action: 'skip' });
        this.sessionStats.skipped++;
        continue;
      }

      // Handle commented console.logs automatically in manual mode
      if (instance.isCommented) {
        const choice = await this._handleCommentedConsoleLog(instance, filePath);
        decisions.push({ instance, action: choice.action });
        this._updateSessionStats(choice.action);
        continue;
      }

      // Get user decision for this console.log
      let userChoice;
      do {
        userChoice = await this.interactiveUI.promptUser(instance, filePath);
        
        if (userChoice.action === 'quit') {
          console.log(`${this.colors.yellow}Processing stopped by user${this.colors.reset}`);
          break;
        }
        
        if (userChoice.action === 'skip') {
          this._addSkipPattern(instance);
          userChoice.action = 'keep'; // Treat skip as keep for this instance
        }
        
      } while (userChoice.action === 'invalid');

      if (userChoice.action === 'quit') {
        break;
      }

      decisions.push({ instance, action: userChoice.action });
      this._updateSessionStats(userChoice.action);
      this.sessionStats.totalReviewed++;
    }

    // Store decisions for this file
    this.userDecisions.set(filePath, decisions);

    // Apply decisions to create modified content
    result.newContent = await this._applyDecisions(content, decisions);
    result.modified = result.newContent !== result.originalContent;
    
    // Calculate statistics
    this._calculateFileStatistics(decisions, result);

    return result;
  }

  /**
   * Process file in auto mode with intelligent removal
   * @param {string} filePath - File path
   * @param {string} content - File content
   * @param {Array} instances - Console.log instances
   * @param {Object} result - Result object to populate
   * @returns {Promise<Object>} Processing result
   */
  async _processFileAutoMode(filePath, content, instances, result) {
    const lines = content.split('\n');
    const decisions = [];

    if (this.config.verbose) {
      console.log(`${this.colors.blue}Auto-processing: ${filePath} (${instances.length} console.log statements)${this.colors.reset}`);
    }

    for (const instance of instances) {
      // Update instance with functional analysis
      instance.isFunctional = this.codeAnalyzer.isFunctionalLog(instance);
      
      // Check for sensitive data
      const sensitiveData = this._detectSensitiveData(instance.content);
      if (sensitiveData.isSensitive) {
        result.statistics.potentiallySensitive++;
        this.sessionStats.potentiallySensitive++;
        instance.sensitiveData = sensitiveData;
        
        // Flag sensitive data for user attention
        this._flagSensitiveData(instance, filePath);
      }

      // Determine action based on auto mode rules
      const action = this._determineAutoAction(instance);
      decisions.push({ instance, action });
      this._updateSessionStats(action);
      
      if (this.config.verbose) {
        const dimColor = this.colors.dim || '';
        const resetColor = this.colors.reset || '';
        console.log(`${dimColor}  Line ${instance.line}: ${action} - ${instance.content.trim()}${resetColor}`);
      }
    }

    // Apply decisions to create modified content
    result.newContent = await this._applyDecisions(content, decisions);
    result.modified = result.newContent !== result.originalContent;
    
    // Calculate statistics
    this._calculateFileStatistics(decisions, result);

    return result;
  }

  /**
   * Apply user decisions to modify file content
   * @param {string} content - Original file content
   * @param {Array} decisions - Array of decisions to apply
   * @returns {Promise<string>} Modified content
   */
  async _applyDecisions(content, decisions) {
    const lines = content.split('\n');
    const linesToRemove = new Set();
    const lineModifications = new Map();

    // Process decisions in reverse order to maintain line numbers
    const sortedDecisions = decisions.sort((a, b) => b.instance.line - a.instance.line);

    for (const { instance, action } of sortedDecisions) {
      const lineIndex = instance.line - 1; // Convert to 0-based index
      const originalLine = lines[lineIndex];

      if (!originalLine) continue;

      const transformResult = this.codeTransformer.transformLine(originalLine, action);
      
      if (transformResult.success) {
        if (transformResult.removed) {
          linesToRemove.add(lineIndex);
        } else if (transformResult.transformedLine !== originalLine) {
          lineModifications.set(lineIndex, transformResult.transformedLine);
        }
      } else if (this.config.verbose) {
        console.log(`${this.colors.yellow}Warning: Could not apply ${action} to line ${instance.line}: ${transformResult.error}${this.colors.reset}`);
      }
    }

    // Apply modifications
    lineModifications.forEach((newContent, lineIndex) => {
      lines[lineIndex] = newContent;
    });

    // Remove lines (in reverse order to maintain indices)
    Array.from(linesToRemove).sort((a, b) => b - a).forEach(lineIndex => {
      lines.splice(lineIndex, 1);
    });

    return lines.join('\n');
  }

  /**
   * Determine the appropriate action for auto mode
   * @param {Object} instance - Console.log instance
   * @returns {string} Action to take
   */
  _determineAutoAction(instance) {
    // Always remove commented console.logs
    if (instance.isCommented) {
      return 'remove-comment';
    }

    // Preserve functional logs
    if (instance.isFunctional) {
      return 'keep';
    }

    // Convert catch block logs to console.error
    if (instance.isInCatchBlock) {
      return 'convert-error';
    }

    // Flag sensitive data but don't auto-remove (let user decide)
    if (instance.sensitiveData && instance.sensitiveData.riskLevel === 'high') {
      return 'keep'; // Require manual review for high-risk sensitive data
    }

    // Remove simple debugging logs
    return 'delete';
  }

  /**
   * Handle commented console.log with user confirmation in manual mode
   * @param {Object} instance - Console.log instance
   * @param {string} filePath - File path
   * @returns {Promise<Object>} User choice
   */
  async _handleCommentedConsoleLog(instance, filePath) {
    console.log(`\n${this.colors.yellow}Found commented console.log at line ${instance.line}:${this.colors.reset}`);
    console.log(`${this.colors.dim}${instance.content}${this.colors.reset}`);
    
    if (this.interactiveUI) {
      const confirmed = await this.interactiveUI.confirmBulkAction('remove commented console.log', 1);
      return { action: confirmed ? 'remove-comment' : 'keep' };
    }
    
    return { action: 'remove-comment' }; // Default to remove if no UI
  }

  /**
   * Check if an instance should be skipped based on user patterns
   * @param {Object} instance - Console.log instance
   * @returns {boolean} True if should skip
   */
  _shouldSkipInstance(instance) {
    // Check against skip patterns
    for (const pattern of this.skipPatterns) {
      if (this._matchesPattern(instance, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Add a skip pattern based on current instance
   * @param {Object} instance - Console.log instance to create pattern from
   */
  _addSkipPattern(instance) {
    // Create a pattern based on the instance characteristics
    const pattern = {
      isCommented: instance.isCommented,
      isInCatchBlock: instance.isInCatchBlock,
      isFunctional: instance.isFunctional,
      contentPattern: this._extractContentPattern(instance.content)
    };
    
    this.skipPatterns.add(pattern);
  }

  /**
   * Check if an instance matches a skip pattern
   * @param {Object} instance - Console.log instance
   * @param {Object} pattern - Skip pattern
   * @returns {boolean} True if matches
   */
  _matchesPattern(instance, pattern) {
    return instance.isCommented === pattern.isCommented &&
           instance.isInCatchBlock === pattern.isInCatchBlock &&
           instance.isFunctional === pattern.isFunctional &&
           this._contentMatchesPattern(instance.content, pattern.contentPattern);
  }

  /**
   * Extract a content pattern from console.log content
   * @param {string} content - Console.log content
   * @returns {string} Simplified pattern
   */
  _extractContentPattern(content) {
    // Simplify content to create a matchable pattern
    return content.replace(/console\.log\s*\([^)]*\)/, 'console.log(...)').trim();
  }

  /**
   * Check if content matches a pattern
   * @param {string} content - Content to check
   * @param {string} pattern - Pattern to match against
   * @returns {boolean} True if matches
   */
  _contentMatchesPattern(content, pattern) {
    const simplifiedContent = this._extractContentPattern(content);
    return simplifiedContent === pattern;
  }

  /**
   * Detect sensitive data in console.log content
   * @param {string} content - Console.log content
   * @returns {Object} Sensitive data detection result
   */
  _detectSensitiveData(content) {
    const result = {
      isSensitive: false,
      detectedPatterns: [],
      riskLevel: 'low'
    };

    // Extract the console.log arguments
    const consoleLogMatch = content.match(/console\.log\s*\(\s*([^)]+)\s*\)/);
    if (!consoleLogMatch) {
      return result;
    }

    const args = consoleLogMatch[1];
    const lowerArgs = args.toLowerCase();

    // High-risk patterns - tokens, keys, passwords
    const highRiskPatterns = [
      { pattern: /\b(api[_-]?key|apikey)\b/i, type: 'API Key' },
      { pattern: /\b(access[_-]?token|accesstoken)\b/i, type: 'Access Token' },
      { pattern: /\b(auth[_-]?token|authtoken)\b/i, type: 'Auth Token' },
      { pattern: /\b(secret[_-]?key|secretkey)\b/i, type: 'Secret Key' },
      { pattern: /\b(password|passwd|pwd)\b/i, type: 'Password' },
      { pattern: /\b(credential|cred)\b/i, type: 'Credential' }
    ];

    // Medium-risk patterns
    const mediumRiskPatterns = [
      { pattern: /\b(user[_-]?id|userid)\b/i, type: 'User ID' },
      { pattern: /\b(email|e[_-]?mail)\b/i, type: 'Email' },
      { pattern: /\b(session[_-]?id|sessionid)\b/i, type: 'Session ID' }
    ];

    // Check high-risk patterns
    for (const { pattern, type } of highRiskPatterns) {
      if (pattern.test(args)) {
        result.isSensitive = true;
        result.riskLevel = 'high';
        result.detectedPatterns.push(type);
      }
    }

    // Check medium-risk patterns (only if not already high risk)
    if (result.riskLevel !== 'high') {
      for (const { pattern, type } of mediumRiskPatterns) {
        if (pattern.test(args)) {
          result.isSensitive = true;
          result.riskLevel = 'medium';
          result.detectedPatterns.push(type);
        }
      }
    }

    return result;
  }

  /**
   * Flag sensitive data for user attention
   * @param {Object} instance - Console.log instance with sensitive data
   * @param {string} filePath - File path
   */
  _flagSensitiveData(instance, filePath) {
    const riskColor = instance.sensitiveData.riskLevel === 'high' ? this.colors.red : 
                     instance.sensitiveData.riskLevel === 'medium' ? this.colors.yellow : this.colors.blue;
    
    console.log(`${riskColor}⚠ SENSITIVE DATA DETECTED (${instance.sensitiveData.riskLevel.toUpperCase()} RISK) - ${filePath}:${instance.line}${this.colors.reset}`);
    console.log(`  ${instance.content.trim()}`);
    console.log(`  Detected: ${instance.sensitiveData.detectedPatterns.join(', ')}`);
  }

  /**
   * Update session statistics based on action
   * @param {string} action - Action taken
   */
  _updateSessionStats(action) {
    switch (action) {
      case 'delete':
      case 'remove-comment':
        this.sessionStats.deleted++;
        break;
      case 'keep':
        this.sessionStats.kept++;
        break;
      case 'convert-info':
        this.sessionStats.convertedToInfo++;
        break;
      case 'convert-error':
        this.sessionStats.convertedToError++;
        break;
    }
  }

  /**
   * Calculate file-specific statistics
   * @param {Array} decisions - Decisions made for the file
   * @param {Object} result - Result object to update
   */
  _calculateFileStatistics(decisions, result) {
    for (const { action } of decisions) {
      switch (action) {
        case 'delete':
        case 'remove-comment':
          result.statistics.consoleLogsRemoved++;
          break;
        case 'convert-info':
        case 'convert-error':
          result.statistics.consoleLogsConverted++;
          break;
      }
    }
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  getSessionStats() {
    return { ...this.sessionStats };
  }

  /**
   * Display session summary
   */
  displaySessionSummary() {
    if (this.interactiveUI) {
      this.interactiveUI.displaySummary(this.sessionStats);
    } else {
      console.log(`\n${this.colors.blue}${this.colors.bold}═══ Session Summary ═══${this.colors.reset}`);
      console.log(`Files processed: ${this.sessionStats.filesProcessed}`);
      console.log(`Console.logs reviewed: ${this.sessionStats.totalReviewed}`);
      console.log(`${this.colors.red}Deleted: ${this.sessionStats.deleted}${this.colors.reset}`);
      console.log(`${this.colors.green}Kept: ${this.sessionStats.kept}${this.colors.reset}`);
      console.log(`${this.colors.cyan}Converted to info: ${this.sessionStats.convertedToInfo}${this.colors.reset}`);
      console.log(`${this.colors.magenta}Converted to error: ${this.sessionStats.convertedToError}${this.colors.reset}`);
      console.log(`${this.colors.yellow}Potentially sensitive: ${this.sessionStats.potentiallySensitive}${this.colors.reset}`);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.interactiveUI) {
      this.interactiveUI.close();
    }
  }
}

module.exports = ModeController;