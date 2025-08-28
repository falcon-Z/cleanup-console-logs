const CodeAnalyzer = require('./CodeAnalyzer');
const InteractiveUI = require('./InteractiveUI');
const CodeTransformer = require('./CodeTransformer');
const BackupManager = require('./BackupManager');
const ErrorHandler = require('./ErrorHandler');

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
    
    // Initialize backup and error handling
    this.backupManager = new BackupManager({
      backupDir: config.backupDir || '.console-log-cleanup-backups',
      autoCleanup: config.autoCleanup !== false
    });
    
    this.errorHandler = new ErrorHandler({
      colors: colors,
      verbose: config.verbose,
      logErrors: config.logErrors !== false
    });
    
    // Enhanced session statistics tracking
    this.sessionStats = {
      // File processing
      filesProcessed: 0,
      totalReviewed: 0,
      
      // User decisions in manual mode
      deleted: 0,
      kept: 0,
      convertedToInfo: 0,
      convertedToError: 0,
      skipped: 0,
      
      // Specific action tracking
      commentedLogsRemoved: 0,
      functionalLogsPreserved: 0,
      
      // Security tracking
      potentiallySensitive: 0,
      sensitiveLogsProcessed: 0,
      sensitiveLogsByRisk: {
        high: 0,
        medium: 0,
        low: 0
      },
      
      // Context-based tracking
      catchBlockLogsFound: 0,
      catchBlockLogsConverted: 0,
      functionalLogsDetected: 0,
      
      // Performance tracking
      startTime: Date.now(),
      processingTime: 0
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
      backupPath: null,
      errors: [],
      statistics: {
        // Basic counts
        consoleLogsFound: 0,
        consoleLogsProcessed: 0,
        consoleLogsRemoved: 0,
        consoleLogsConverted: 0,
        consoleLogsKept: 0,
        
        // Specific action tracking
        commentedLogsRemoved: 0,
        commentedLogsFound: 0,
        convertedToInfo: 0,
        convertedToError: 0,
        
        // Security tracking
        potentiallySensitive: 0,
        sensitiveLogsProcessed: 0,
        sensitiveLogsRemoved: 0,
        sensitiveLogsKept: 0,
        sensitiveLogsByRisk: {
          high: 0,
          medium: 0,
          low: 0
        },
        
        // Context tracking
        catchBlockLogsFound: 0,
        catchBlockLogsConverted: 0,
        functionalLogsDetected: 0,
        functionalLogsPreserved: 0
      }
    };

    try {
      // Validate file path and content
      const validation = this.errorHandler.validateUserInput(filePath, 'file_path');
      if (!validation.valid) {
        const errorInfo = this.errorHandler.handleUserInputError(filePath, 'file_path');
        result.errors.push(errorInfo);
        return result;
      }

      // Analyze the file for console.log instances
      let instances;
      try {
        instances = this.codeAnalyzer.analyzeFile(filePath, content);
      } catch (error) {
        const errorInfo = this.errorHandler.handleParsingError(error, filePath);
        result.errors.push(errorInfo);
        
        // Apply graceful degradation
        const degradation = this.errorHandler.gracefullyDegrade(filePath, errorInfo);
        if (degradation.strategy === 'skip_file' || degradation.strategy === 'skip_with_warning') {
          if (this.config.verbose) {
            console.log(`${this.colors.yellow}${degradation.message}${this.colors.reset}`);
          }
          return result;
        }
        throw error; // Re-throw if we can't gracefully degrade
      }
      
      if (instances.length === 0) {
        if (this.config.verbose) {
          console.log(`${this.colors.yellow}  No console.log statements found in ${filePath}${this.colors.reset}`);
        }
        return result;
      }

      result.statistics.consoleLogsFound = instances.length;
      this.sessionStats.filesProcessed++;

      // Create backup before processing (unless in dry-run mode)
      if (!this.config.dryRun) {
        try {
          result.backupPath = await this.backupManager.createBackup(filePath);
          if (this.config.verbose) {
            console.log(`${this.colors.blue}  Created backup: ${result.backupPath}${this.colors.reset}`);
          }
        } catch (error) {
          const errorInfo = this.errorHandler.handleBackupError(error, 'create', filePath);
          result.errors.push(errorInfo);
          
          // Backup failure is critical - cannot proceed without backup
          if (!errorInfo.recoverable) {
            throw new Error(`Cannot proceed without backup: ${error.message}`);
          }
        }
      }

      // Process file based on mode
      if (this.config.mode === 'manual' && this.config.interactive) {
        return await this._processFileManualMode(filePath, content, instances, result);
      } else {
        return await this._processFileAutoMode(filePath, content, instances, result);
      }

    } catch (error) {
      // Handle processing errors
      const errorInfo = this.errorHandler.handleProcessingError(error, filePath, {
        operation: 'file_processing',
        mode: this.config.mode
      });
      result.errors.push(errorInfo);
      
      // Apply graceful degradation
      const degradation = this.errorHandler.gracefullyDegrade(filePath, errorInfo);
      console.error(`${this.colors.red}${degradation.message}${this.colors.reset}`);
      
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
      try {
        const isFunctional = this.codeAnalyzer.isFunctionalLog(instance);
        instance.isFunctional = isFunctional;
      } catch (error) {
        console.log('Error setting isFunctional:', error.message);
        // Set a default value if assignment fails
        try {
          Object.defineProperty(instance, 'isFunctional', { value: false, writable: true });
        } catch (e) {
          // If we can't set the property, continue without it
        }
      }
      
      // Check for sensitive data and track by risk level
      const sensitiveData = this._detectSensitiveData(instance.content);
      if (sensitiveData.isSensitive) {
        result.statistics.potentiallySensitive++;
        this.sessionStats.potentiallySensitive++;
        this.sessionStats.sensitiveLogsByRisk[sensitiveData.riskLevel]++;
        try {
          instance.sensitiveData = sensitiveData;
        } catch (error) {
          console.log('Error setting sensitiveData:', error.message);
          // Continue without setting sensitive data if assignment fails
        }
      }
      
      // Track context-based statistics
      if (instance.isInCatchBlock) {
        this.sessionStats.catchBlockLogsFound++;
      }
      
      if (instance.isFunctional) {
        this.sessionStats.functionalLogsDetected++;
      }
      
      if (instance.isCommented) {
        // This will be tracked in result.statistics.commentedLogsFound
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
        this._updateSessionStats(choice.action, instance);
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
      this._updateSessionStats(userChoice.action, instance);
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
      try {
        const isFunctional = this.codeAnalyzer.isFunctionalLog(instance);
        instance.isFunctional = isFunctional;
      } catch (error) {
        console.log('Error setting isFunctional:', error.message);
        // Set a default value if assignment fails
        try {
          Object.defineProperty(instance, 'isFunctional', { value: false, writable: true });
        } catch (e) {
          // If we can't set the property, continue without it
        }
      }
      
      // Check for sensitive data and track by risk level
      const sensitiveData = this._detectSensitiveData(instance.content);
      if (sensitiveData.isSensitive) {
        result.statistics.potentiallySensitive++;
        this.sessionStats.potentiallySensitive++;
        this.sessionStats.sensitiveLogsByRisk[sensitiveData.riskLevel]++;
        try {
          instance.sensitiveData = sensitiveData;
        } catch (error) {
          console.log('Error setting sensitiveData:', error.message);
          // Continue without setting sensitive data if assignment fails
        }
        
        // Flag sensitive data for user attention
        this._flagSensitiveData(instance, filePath);
      }
      
      // Track context-based statistics
      if (instance.isInCatchBlock) {
        this.sessionStats.catchBlockLogsFound++;
      }
      
      if (instance.isFunctional) {
        this.sessionStats.functionalLogsDetected++;
      }

      // Determine action based on auto mode rules
      const action = this._determineAutoAction(instance);
      decisions.push({ instance, action });
      this._updateSessionStats(action, instance);
      
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
    try {
      const lines = content.split('\n');
      const linesToRemove = new Set();
      const lineModifications = new Map();
      const transformationErrors = [];

      // Process decisions in reverse order to maintain line numbers
      const sortedDecisions = decisions.sort((a, b) => b.instance.line - a.instance.line);

      for (const { instance, action } of sortedDecisions) {
        const lineIndex = instance.line - 1; // Convert to 0-based index
        const originalLine = lines[lineIndex];

        if (!originalLine) {
          transformationErrors.push({
            line: instance.line,
            action,
            error: 'Line not found in content'
          });
          continue;
        }

        try {
          const transformResult = this.codeTransformer.transformLine(originalLine, action);
          
          if (transformResult.success) {
            // Validate transformation before applying
            const validation = this.codeTransformer.validateTransformation(originalLine, transformResult.transformedLine);
            
            if (!validation.valid) {
              const errorInfo = this.errorHandler.handleValidationError('transformation', validation, `line ${instance.line}`);
              transformationErrors.push({
                line: instance.line,
                action,
                error: errorInfo.message,
                validation: validation
              });
              continue;
            }
            
            if (transformResult.removed) {
              linesToRemove.add(lineIndex);
            } else if (transformResult.transformedLine !== originalLine) {
              lineModifications.set(lineIndex, transformResult.transformedLine);
            }
          } else {
            transformationErrors.push({
              line: instance.line,
              action,
              error: transformResult.error
            });
            
            if (this.config.verbose) {
              console.log(`${this.colors.yellow}Warning: Could not apply ${action} to line ${instance.line}: ${transformResult.error}${this.colors.reset}`);
            }
          }
        } catch (error) {
          const errorInfo = this.errorHandler.handleProcessingError(error, 'transformation', {
            operation: 'transformation',
            lineNumber: instance.line,
            action
          });
          
          transformationErrors.push({
            line: instance.line,
            action,
            error: errorInfo.message
          });
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

      const modifiedContent = lines.join('\n');

      // Validate overall file structure after modifications
      if (lineModifications.size > 0 || linesToRemove.size > 0) {
        const originalLines = content.split('\n');
        const modifiedLines = modifiedContent.split('\n');
        
        const structureValidation = this.codeTransformer.validateCommentRemoval(originalLines, modifiedLines);
        
        if (!structureValidation.valid) {
          const errorInfo = this.errorHandler.handleValidationError('syntax', structureValidation, 'file structure');
          
          // If structure validation fails, we should not apply changes
          if (!structureValidation.structureIntact) {
            throw new Error(`File structure validation failed: ${structureValidation.errors.join(', ')}`);
          }
        }
      }

      // Log transformation errors if any occurred
      if (transformationErrors.length > 0 && this.config.verbose) {
        console.log(`${this.colors.yellow}Transformation completed with ${transformationErrors.length} warnings${this.colors.reset}`);
      }

      return modifiedContent;
      
    } catch (error) {
      throw new Error(`Failed to apply decisions: ${error.message}`);
    }
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
   * Update comprehensive session statistics based on action and instance
   * @param {string} action - Action taken
   * @param {Object} instance - Console.log instance (optional)
   */
  _updateSessionStats(action, instance = null) {
    switch (action) {
      case 'delete':
        this.sessionStats.deleted++;
        break;
      case 'remove-comment':
        this.sessionStats.deleted++;
        this.sessionStats.commentedLogsRemoved++;
        break;
      case 'keep':
      case 'skip':
        this.sessionStats.kept++;
        if (instance && instance.isFunctional) {
          this.sessionStats.functionalLogsPreserved++;
        }
        break;
      case 'convert-info':
        this.sessionStats.convertedToInfo++;
        break;
      case 'convert-error':
        this.sessionStats.convertedToError++;
        if (instance && instance.isInCatchBlock) {
          this.sessionStats.catchBlockLogsConverted++;
        }
        break;
    }
    
    // Track sensitive data processing
    if (instance && instance.sensitiveData && instance.sensitiveData.isSensitive) {
      this.sessionStats.sensitiveLogsProcessed++;
    }
  }

  /**
   * Calculate comprehensive file-specific statistics
   * @param {Array} decisions - Decisions made for the file
   * @param {Object} result - Result object to update
   */
  _calculateFileStatistics(decisions, result) {
    // Count different types of console.logs found
    let commentedCount = 0;
    let catchBlockCount = 0;
    let functionalCount = 0;
    let sensitiveCount = 0;
    
    for (const { instance, action } of decisions) {
      // Count by action type
      switch (action) {
        case 'delete':
          result.statistics.consoleLogsRemoved++;
          // Track if sensitive data was removed
          if (instance.sensitiveData && instance.sensitiveData.isSensitive) {
            result.statistics.sensitiveLogsRemoved++;
          }
          break;
          
        case 'remove-comment':
          result.statistics.consoleLogsRemoved++;
          result.statistics.commentedLogsRemoved++;
          break;
          
        case 'convert-info':
          result.statistics.consoleLogsConverted++;
          result.statistics.convertedToInfo++;
          break;
          
        case 'convert-error':
          result.statistics.consoleLogsConverted++;
          result.statistics.convertedToError++;
          // Track catch block conversions
          if (instance.isInCatchBlock) {
            result.statistics.catchBlockLogsConverted++;
          }
          break;
          
        case 'keep':
        case 'skip':
          result.statistics.consoleLogsKept++;
          // Track if sensitive data was kept
          if (instance.sensitiveData && instance.sensitiveData.isSensitive) {
            result.statistics.sensitiveLogsKept++;
          }
          // Track functional logs preserved
          if (instance.isFunctional) {
            result.statistics.functionalLogsPreserved++;
          }
          break;
      }
      
      // Count by instance characteristics
      if (instance.isCommented) {
        commentedCount++;
      }
      
      if (instance.isInCatchBlock) {
        catchBlockCount++;
      }
      
      if (instance.isFunctional) {
        functionalCount++;
      }
      
      if (instance.sensitiveData && instance.sensitiveData.isSensitive) {
        sensitiveCount++;
        result.statistics.sensitiveLogsByRisk[instance.sensitiveData.riskLevel]++;
      }
    }
    
    // Set context-based statistics
    result.statistics.commentedLogsFound = commentedCount;
    result.statistics.catchBlockLogsFound = catchBlockCount;
    result.statistics.functionalLogsDetected = functionalCount;
    result.statistics.sensitiveLogsProcessed = sensitiveCount;
    result.statistics.consoleLogsProcessed = decisions.length;
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  getSessionStats() {
    return { ...this.sessionStats };
  }

  /**
   * Display enhanced session summary with detailed breakdown
   */
  displaySessionSummary() {
    if (this.interactiveUI) {
      this.interactiveUI.displaySummary(this.sessionStats);
    } else {
      console.log(`\n${this.colors.blue}${this.colors.bold}═══ Interactive Session Summary ═══${this.colors.reset}`);
      console.log(`Files processed: ${this.colors.cyan}${this.sessionStats.filesProcessed}${this.colors.reset}`);
      console.log(`Console.logs reviewed: ${this.colors.cyan}${this.sessionStats.totalReviewed}${this.colors.reset}`);
      
      console.log(`\n${this.colors.blue}Actions Taken:${this.colors.reset}`);
      console.log(`  ${this.colors.red}🗑️  Deleted: ${this.sessionStats.deleted}${this.colors.reset}`);
      console.log(`  ${this.colors.green}✅ Kept: ${this.sessionStats.kept}${this.colors.reset}`);
      console.log(`  ${this.colors.cyan}ℹ️  Converted to info: ${this.sessionStats.convertedToInfo}${this.colors.reset}`);
      console.log(`  ${this.colors.magenta}❌ Converted to error: ${this.sessionStats.convertedToError}${this.colors.reset}`);
      
      if (this.sessionStats.potentiallySensitive > 0) {
        console.log(`\n${this.colors.yellow}Security Findings:${this.colors.reset}`);
        console.log(`  ${this.colors.red}⚠️  Potentially sensitive: ${this.sessionStats.potentiallySensitive}${this.colors.reset}`);
        
        if (this.sessionStats.sensitiveLogsByRisk.high > 0) {
          console.log(`    ${this.colors.red}High risk: ${this.sessionStats.sensitiveLogsByRisk.high}${this.colors.reset}`);
        }
        if (this.sessionStats.sensitiveLogsByRisk.medium > 0) {
          console.log(`    ${this.colors.yellow}Medium risk: ${this.sessionStats.sensitiveLogsByRisk.medium}${this.colors.reset}`);
        }
        if (this.sessionStats.sensitiveLogsByRisk.low > 0) {
          console.log(`    ${this.colors.blue}Low risk: ${this.sessionStats.sensitiveLogsByRisk.low}${this.colors.reset}`);
        }
      }
      
      if (this.sessionStats.functionalLogsDetected > 0) {
        console.log(`\n${this.colors.blue}Smart Analysis:${this.colors.reset}`);
        console.log(`  ${this.colors.cyan}Functional logs detected: ${this.sessionStats.functionalLogsDetected}${this.colors.reset}`);
        console.log(`  ${this.colors.green}Functional logs preserved: ${this.sessionStats.functionalLogsPreserved}${this.colors.reset}`);
      }
      
      if (this.sessionStats.catchBlockLogsFound > 0) {
        console.log(`  ${this.colors.magenta}Catch block logs found: ${this.sessionStats.catchBlockLogsFound}${this.colors.reset}`);
        console.log(`  ${this.colors.magenta}Catch block logs converted: ${this.sessionStats.catchBlockLogsConverted}${this.colors.reset}`);
      }
      
      // Calculate session time
      const sessionTime = Date.now() - this.sessionStats.startTime;
      console.log(`\n${this.colors.dim}Session time: ${sessionTime}ms${this.colors.reset}`);
    }
  }

  /**
   * Rollback all changes made during the session
   * @returns {Promise<Object>} Rollback result
   */
  async rollbackSession() {
    try {
      console.log(`${this.colors.yellow}Rolling back all changes...${this.colors.reset}`);
      
      const rollbackResult = await this.backupManager.rollbackSession();
      
      if (rollbackResult.successful.length > 0) {
        console.log(`${this.colors.green}Successfully rolled back ${rollbackResult.successful.length} files${this.colors.reset}`);
      }
      
      if (rollbackResult.failed.length > 0) {
        console.log(`${this.colors.red}Failed to rollback ${rollbackResult.failed.length} files${this.colors.reset}`);
        rollbackResult.failed.forEach(failure => {
          console.log(`  ${this.colors.red}${failure.filePath}: ${failure.error}${this.colors.reset}`);
        });
      }
      
      return rollbackResult;
      
    } catch (error) {
      const errorInfo = this.errorHandler.handleBackupError(error, 'rollback', 'session');
      console.error(`${this.colors.red}Rollback failed: ${errorInfo.message}${this.colors.reset}`);
      throw error;
    }
  }

  /**
   * Clean up backup files after successful operations
   * @param {boolean} force - Force cleanup even if there were errors
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupBackups(force = false) {
    try {
      const cleanupResult = await this.backupManager.cleanupBackups(force);
      
      if (this.config.verbose) {
        console.log(`${this.colors.blue}Cleaned up ${cleanupResult.cleaned.length} backup files (${cleanupResult.bytesFreed} bytes freed)${this.colors.reset}`);
      }
      
      if (cleanupResult.failed.length > 0) {
        console.log(`${this.colors.yellow}Failed to cleanup ${cleanupResult.failed.length} backup files${this.colors.reset}`);
      }
      
      return cleanupResult;
      
    } catch (error) {
      const errorInfo = this.errorHandler.handleBackupError(error, 'cleanup', 'session');
      
      if (this.config.verbose) {
        console.log(`${this.colors.yellow}Backup cleanup warning: ${errorInfo.message}${this.colors.reset}`);
      }
      
      return { cleaned: [], failed: [], bytesFreed: 0 };
    }
  }

  /**
   * Get comprehensive session information including backups and errors
   * @returns {Object} Session information
   */
  getSessionInfo() {
    return {
      stats: this.getSessionStats(),
      backups: this.backupManager.getSessionInfo(),
      errors: this.errorHandler.getErrorStats()
    };
  }

  /**
   * Validate session integrity
   * @returns {Promise<Object>} Validation result
   */
  async validateSession() {
    const validation = {
      valid: true,
      backupValidation: null,
      errorSummary: null,
      recommendations: []
    };

    try {
      // Validate backup integrity
      validation.backupValidation = await this.backupManager.validateBackups();
      
      if (!validation.backupValidation.valid) {
        validation.valid = false;
        validation.recommendations.push('Some backups are invalid or missing - consider running rollback');
      }
      
      // Get error summary
      validation.errorSummary = this.errorHandler.getErrorStats();
      
      if (validation.errorSummary.fatal > 0) {
        validation.valid = false;
        validation.recommendations.push('Fatal errors occurred - review error log and consider rollback');
      }
      
      if (validation.errorSummary.errorRate > 0.1) {
        validation.recommendations.push('High error rate detected - review operations carefully');
      }
      
    } catch (error) {
      validation.valid = false;
      validation.error = error.message;
      validation.recommendations.push('Session validation failed - manual review recommended');
    }

    return validation;
  }

  /**
   * Generate comprehensive error report
   * @returns {Promise<string>} Path to error report file
   */
  async generateErrorReport() {
    try {
      const reportPath = await this.errorHandler.generateErrorReport();
      
      if (reportPath) {
        console.log(`${this.colors.blue}Error report generated: ${reportPath}${this.colors.reset}`);
      }
      
      return reportPath;
      
    } catch (error) {
      console.error(`${this.colors.red}Failed to generate error report: ${error.message}${this.colors.reset}`);
      return null;
    }
  }

  /**
   * Clean up resources and perform final session tasks
   */
  async cleanup() {
    try {
      // Close interactive UI
      if (this.interactiveUI) {
        this.interactiveUI.close();
      }
      
      // Validate session before cleanup
      const validation = await this.validateSession();
      
      if (!validation.valid && this.config.verbose) {
        console.log(`${this.colors.yellow}Session validation warnings:${this.colors.reset}`);
        validation.recommendations.forEach(rec => {
          console.log(`  ${this.colors.yellow}- ${rec}${this.colors.reset}`);
        });
      }
      
      // Auto-cleanup backups if enabled and no fatal errors
      if (this.backupManager.config.autoCleanup && validation.errorSummary.fatal === 0) {
        await this.cleanupBackups();
      }
      
    } catch (error) {
      console.error(`${this.colors.red}Error during cleanup: ${error.message}${this.colors.reset}`);
    }
  }
}

module.exports = ModeController;