/**
 * SyntaxHighlighter class for basic JavaScript syntax highlighting in terminal
 * Provides colored output for better code readability in context display
 */
class SyntaxHighlighter {
  constructor(colors = {}) {
    this.colors = {
      keyword: '\x1b[35m',    // Magenta for keywords
      string: '\x1b[32m',     // Green for strings
      comment: '\x1b[90m',    // Gray for comments
      number: '\x1b[33m',     // Yellow for numbers
      operator: '\x1b[36m',   // Cyan for operators
      console: '\x1b[31m',    // Red for console methods
      reset: '\x1b[0m',
      ...colors
    };

    // JavaScript keywords
    this.keywords = new Set([
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
      'do', 'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
      'finally', 'throw', 'new', 'this', 'class', 'extends', 'import', 'export',
      'from', 'async', 'await', 'true', 'false', 'null', 'undefined'
    ]);

    // Operators and symbols
    this.operators = new Set([
      '=', '==', '===', '!=', '!==', '<', '>', '<=', '>=', '+', '-', '*', '/',
      '%', '&&', '||', '!', '?', ':', '=>', '++', '--', '+=', '-=', '*=', '/='
    ]);
  }

  /**
   * Apply syntax highlighting to a line of JavaScript code
   * @param {string} line - Line of code to highlight
   * @param {boolean} highlightConsoleLog - Whether to specially highlight console.log
   * @returns {string} Highlighted line with ANSI color codes
   */
  highlight(line, highlightConsoleLog = false) {
    let highlighted = line;

    // Highlight console.log specially if requested
    if (highlightConsoleLog && line.includes('console.log')) {
      highlighted = highlighted.replace(
        /console\.log/g,
        `${this.colors.console}console.log${this.colors.reset}`
      );
    }

    // Highlight strings (both single and double quotes)
    highlighted = this._highlightStrings(highlighted);

    // Highlight comments
    highlighted = this._highlightComments(highlighted);

    // Highlight numbers
    highlighted = this._highlightNumbers(highlighted);

    // Highlight keywords
    highlighted = this._highlightKeywords(highlighted);

    // Highlight operators
    highlighted = this._highlightOperators(highlighted);

    return highlighted;
  }

  /**
   * Format code context with line numbers and highlighting
   * @param {Array<string>} lines - Array of code lines
   * @param {number} targetLine - Line number to specially highlight
   * @param {number} startLineNumber - Starting line number for display
   * @returns {Array<string>} Array of formatted lines
   */
  formatCodeContext(lines, targetLine, startLineNumber = 1) {
    return lines.map((line, index) => {
      const lineNum = startLineNumber + index;
      const isTarget = lineNum === targetLine;
      const lineNumStr = lineNum.toString().padStart(4, ' ');
      
      // Apply syntax highlighting
      const highlightedLine = this.highlight(line, isTarget);
      
      if (isTarget) {
        return `${this.colors.console}→ ${lineNumStr} │ ${highlightedLine}${this.colors.reset}`;
      } else {
        return `  ${lineNumStr} │ ${highlightedLine}`;
      }
    });
  }

  // Private helper methods

  /**
   * Highlight string literals
   * @param {string} line - Line to process
   * @returns {string} Line with highlighted strings
   */
  _highlightStrings(line) {
    // Handle single quotes
    line = line.replace(
      /'([^'\\]|\\.)*'/g,
      `${this.colors.string}$&${this.colors.reset}`
    );
    
    // Handle double quotes
    line = line.replace(
      /"([^"\\]|\\.)*"/g,
      `${this.colors.string}$&${this.colors.reset}`
    );
    
    // Handle template literals
    line = line.replace(
      /`([^`\\]|\\.)*`/g,
      `${this.colors.string}$&${this.colors.reset}`
    );
    
    return line;
  }

  /**
   * Highlight comments
   * @param {string} line - Line to process
   * @returns {string} Line with highlighted comments
   */
  _highlightComments(line) {
    // Single line comments
    line = line.replace(
      /(\/\/.*$)/,
      `${this.colors.comment}$1${this.colors.reset}`
    );
    
    // Multi-line comments (basic support)
    line = line.replace(
      /(\/\*.*?\*\/)/g,
      `${this.colors.comment}$1${this.colors.reset}`
    );
    
    return line;
  }

  /**
   * Highlight numeric literals
   * @param {string} line - Line to process
   * @returns {string} Line with highlighted numbers
   */
  _highlightNumbers(line) {
    return line.replace(
      /\b\d+(\.\d+)?\b/g,
      `${this.colors.number}$&${this.colors.reset}`
    );
  }

  /**
   * Highlight JavaScript keywords
   * @param {string} line - Line to process
   * @returns {string} Line with highlighted keywords
   */
  _highlightKeywords(line) {
    this.keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      line = line.replace(regex, `${this.colors.keyword}${keyword}${this.colors.reset}`);
    });
    
    return line;
  }

  /**
   * Highlight operators
   * @param {string} line - Line to process
   * @returns {string} Line with highlighted operators
   */
  _highlightOperators(line) {
    // Sort operators by length (longest first) to avoid partial matches
    const sortedOperators = Array.from(this.operators).sort((a, b) => b.length - a.length);
    
    sortedOperators.forEach(operator => {
      // Escape special regex characters
      const escapedOperator = operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedOperator, 'g');
      line = line.replace(regex, `${this.colors.operator}${operator}${this.colors.reset}`);
    });
    
    return line;
  }
}

module.exports = SyntaxHighlighter;