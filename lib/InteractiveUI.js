const readline = require('readline');
const SyntaxHighlighter = require('./SyntaxHighlighter');

/**
 * InteractiveUI class for handling user interactions in manual mode
 * Provides methods for displaying console.log context and prompting user choices
 */
class InteractiveUI {
  constructor(colors = {}) {
    this.colors = {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      ...colors
    };
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.syntaxHighlighter = new SyntaxHighlighter(this.colors);
  }

  /**
   * Display progress information showing current position in processing
   * @param {number} current - Current item number
   * @param {number} total - Total number of items
   * @param {string} fileName - Current file being processed
   */
  showProgress(current, total, fileName = '') {
    const percentage = Math.round((current / total) * 100);
    const progressBar = this._createProgressBar(current, total, 20);
    
    console.log(`\n${this.colors.blue}${this.colors.bold}Progress: ${current}/${total} (${percentage}%)${this.colors.reset}`);
    console.log(`${this.colors.blue}${progressBar}${this.colors.reset}`);
    
    if (fileName) {
      console.log(`${this.colors.dim}File: ${fileName}${this.colors.reset}`);
    }
  }

  /**
   * Display context around a console.log statement with syntax highlighting
   * @param {Object} instance - Console.log instance with context information
   * @param {string} filePath - Path to the file containing the console.log
   */
  displayContext(instance, filePath) {
    console.log(`\n${this.colors.cyan}${this.colors.bold}═══ Console.log Found ═══${this.colors.reset}`);
    console.log(`${this.colors.dim}File: ${filePath}${this.colors.reset}`);
    console.log(`${this.colors.dim}Line: ${instance.line}${this.colors.reset}`);
    
    if (instance.isCommented) {
      console.log(`${this.colors.yellow}⚠ This console.log is commented out${this.colors.reset}`);
    }
    
    if (instance.isInCatchBlock) {
      console.log(`${this.colors.magenta}ℹ This console.log is in a catch block${this.colors.reset}`);
    }
    
    if (instance.isFunctional) {
      console.log(`${this.colors.green}⚠ This appears to be functional code${this.colors.reset}`);
    }

    // Display code context with line numbers
    console.log(`\n${this.colors.bold}Code Context:${this.colors.reset}`);
    this._displayCodeLines(instance.surroundingLines, instance.line);
    
    // Highlight the specific console.log content
    console.log(`\n${this.colors.bold}Console.log content:${this.colors.reset}`);
    console.log(`${this.colors.yellow}${instance.content.trim()}${this.colors.reset}`);
  }

  /**
   * Prompt user for action on a console.log statement
   * @param {Object} instance - Console.log instance
   * @param {string} filePath - Path to the file
   * @returns {Promise<Object>} User choice object
   */
  async promptUser(instance, filePath) {
    this.displayContext(instance, filePath);
    
    console.log(`\n${this.colors.bold}What would you like to do?${this.colors.reset}`);
    console.log(`${this.colors.green}[d]${this.colors.reset} Delete this console.log`);
    console.log(`${this.colors.blue}[k]${this.colors.reset} Keep this console.log`);
    console.log(`${this.colors.cyan}[i]${this.colors.reset} Convert to console.info`);
    
    if (instance.isInCatchBlock) {
      console.log(`${this.colors.magenta}[e]${this.colors.reset} Convert to console.error (recommended for catch blocks)`);
    } else {
      console.log(`${this.colors.magenta}[e]${this.colors.reset} Convert to console.error`);
    }
    
    console.log(`${this.colors.yellow}[s]${this.colors.reset} Skip similar console.logs in this file`);
    console.log(`${this.colors.red}[q]${this.colors.reset} Quit processing`);

    const choice = await this._getInput('\nYour choice: ');
    
    return this._parseUserChoice(choice.toLowerCase().trim());
  }

  /**
   * Confirm a bulk action with the user
   * @param {string} action - The action to be performed
   * @param {number} count - Number of items affected
   * @returns {Promise<boolean>} User confirmation
   */
  async confirmBulkAction(action, count) {
    console.log(`\n${this.colors.yellow}${this.colors.bold}Bulk Action Confirmation${this.colors.reset}`);
    console.log(`About to ${action} ${count} console.log statement(s).`);
    
    const response = await this._getInput('Continue? [y/N]: ');
    return response.toLowerCase().trim() === 'y' || response.toLowerCase().trim() === 'yes';
  }

  /**
   * Display a summary of actions taken
   * @param {Object} summary - Summary statistics
   */
  displaySummary(summary) {
    console.log(`\n${this.colors.blue}${this.colors.bold}═══ Interactive Session Summary ═══${this.colors.reset}`);
    console.log(`Files processed: ${summary.filesProcessed}`);
    console.log(`Console.logs reviewed: ${summary.totalReviewed}`);
    console.log(`${this.colors.red}Deleted: ${summary.deleted}${this.colors.reset}`);
    console.log(`${this.colors.green}Kept: ${summary.kept}${this.colors.reset}`);
    console.log(`${this.colors.cyan}Converted to info: ${summary.convertedToInfo}${this.colors.reset}`);
    console.log(`${this.colors.magenta}Converted to error: ${summary.convertedToError}${this.colors.reset}`);
    console.log(`${this.colors.yellow}Skipped: ${summary.skipped}${this.colors.reset}`);
  }

  /**
   * Close the readline interface
   */
  close() {
    this.rl.close();
  }

  // Private helper methods

  /**
   * Create a visual progress bar
   * @param {number} current - Current progress
   * @param {number} total - Total items
   * @param {number} width - Width of progress bar
   * @returns {string} Progress bar string
   */
  _createProgressBar(current, total, width = 20) {
    const percentage = current / total;
    const filled = Math.round(width * percentage);
    const empty = width - filled;
    
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }

  /**
   * Display code lines with line numbers and syntax highlighting
   * @param {Array<string>} lines - Array of code lines
   * @param {number} targetLine - Line number to highlight
   */
  _displayCodeLines(lines, targetLine) {
    const startLine = Math.max(1, targetLine - Math.floor(lines.length / 2));
    
    const formattedLines = this.syntaxHighlighter.formatCodeContext(lines, targetLine, startLine);
    
    // Add visual separation
    console.log(`${this.colors.dim}┌${'─'.repeat(60)}┐${this.colors.reset}`);
    
    formattedLines.forEach(line => {
      console.log(`${this.colors.dim}│${this.colors.reset} ${line}`);
    });
    
    console.log(`${this.colors.dim}└${'─'.repeat(60)}┘${this.colors.reset}`);
  }

  /**
   * Get input from user via readline
   * @param {string} prompt - Prompt message
   * @returns {Promise<string>} User input
   */
  _getInput(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Parse user choice into action object
   * @param {string} choice - User input choice
   * @returns {Object} Parsed choice object
   */
  _parseUserChoice(choice) {
    switch (choice) {
      case 'd':
      case 'delete':
        return { action: 'delete', skipSimilar: false };
      
      case 'k':
      case 'keep':
        return { action: 'keep', skipSimilar: false };
      
      case 'i':
      case 'info':
        return { action: 'convert-info', skipSimilar: false };
      
      case 'e':
      case 'error':
        return { action: 'convert-error', skipSimilar: false };
      
      case 's':
      case 'skip':
        return { action: 'skip', skipSimilar: true };
      
      case 'q':
      case 'quit':
        return { action: 'quit', skipSimilar: false };
      
      default:
        console.log(`${this.colors.red}Invalid choice. Please try again.${this.colors.reset}`);
        return { action: 'invalid', skipSimilar: false };
    }
  }
}

module.exports = InteractiveUI;