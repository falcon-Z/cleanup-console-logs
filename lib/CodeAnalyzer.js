/**
 * CodeAnalyzer class for enhanced console.log detection and context analysis
 * Provides methods for analyzing code context and capturing surrounding lines
 */
class CodeAnalyzer {
  constructor() {
    this.contextLines = 3; // Number of lines to show before/after console.log
  }

  /**
   * Analyze a file and return all console.log instances with context
   * @param {string} filePath - Path to the file
   * @param {string} content - File content
   * @returns {Array<Object>} Array of console.log instances with context
   */
  analyzeFile(filePath, content) {
    const lines = content.split('\n');
    const instances = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      if (this._containsConsoleLog(line)) {
        const instance = this._createConsoleLogInstance(line, lineNumber, lines, filePath);
        instances.push(instance);
      }
    }

    return instances;
  }

  /**
   * Detect the context of a console.log statement
   * @param {string} line - The line containing console.log
   * @param {number} lineNumber - Line number (1-based)
   * @param {Array<string>} allLines - All lines in the file
   * @returns {Object} Context information
   */
  detectContext(line, lineNumber, allLines) {
    const context = {
      isInFunction: false,
      isInTernary: false,
      isInChain: false,
      isReturnValue: false,
      isInCatchBlock: false,
      isInConditional: false,
      indentLevel: this._getIndentLevel(line)
    };

    // Check if in catch block by looking at surrounding lines
    context.isInCatchBlock = this._isInCatchBlock(lineNumber - 1, allLines);
    
    // Check if it's a return value
    context.isReturnValue = line.trim().startsWith('return') && line.includes('console.log');
    
    // Check if it's part of a ternary operator
    context.isInTernary = this._isInTernary(line);
    
    // Check if it's part of a method chain
    context.isInChain = this._isInMethodChain(line);
    
    // Check if it's in a function context
    context.isInFunction = this._isInFunction(lineNumber - 1, allLines);
    
    // Check if it's in a conditional statement
    context.isInConditional = this._isInConditional(lineNumber - 1, allLines);

    return context;
  }

  /**
   * Determine if a console.log appears to be functional (not just debugging)
   * @param {Object} instance - Console.log instance with context
   * @returns {boolean} True if appears to be functional code
   */
  isFunctionalLog(instance) {
    const { context, content } = instance;
    
    // If it's a return value, likely functional
    if (context.isReturnValue) {
      return true;
    }
    
    // If it's part of a ternary operator, likely functional
    if (context.isInTernary) {
      return true;
    }
    
    // If it's part of a method chain, likely functional
    if (context.isInChain) {
      return true;
    }
    
    // If it's assigned to a variable or used in an expression
    if (this._isPartOfExpression(content)) {
      return true;
    }
    
    return false;
  }

  /**
   * Capture surrounding lines for context display
   * @param {number} lineNumber - Target line number (1-based)
   * @param {Array<string>} allLines - All lines in the file
   * @param {number} contextSize - Number of lines before/after to include
   * @returns {Array<string>} Array of surrounding lines
   */
  captureSurroundingLines(lineNumber, allLines, contextSize = this.contextLines) {
    const startIndex = Math.max(0, lineNumber - 1 - contextSize);
    const endIndex = Math.min(allLines.length, lineNumber + contextSize);
    
    return allLines.slice(startIndex, endIndex);
  }

  // Private helper methods

  /**
   * Check if a line contains console.log
   * @param {string} line - Line to check
   * @returns {boolean} True if contains console.log
   */
  _containsConsoleLog(line) {
    return line.includes('console.log') && line.trim().length > 0;
  }

  /**
   * Create a console.log instance object with full context
   * @param {string} line - The line containing console.log
   * @param {number} lineNumber - Line number (1-based)
   * @param {Array<string>} allLines - All lines in the file
   * @param {string} filePath - File path
   * @returns {Object} Console.log instance with context
   */
  _createConsoleLogInstance(line, lineNumber, allLines, filePath) {
    const context = this.detectContext(line, lineNumber, allLines);
    const surroundingLines = this.captureSurroundingLines(lineNumber, allLines);
    const isInCatchBlock = this._isInCatchBlock(lineNumber - 1, allLines);
    
    return {
      line: lineNumber,
      column: line.indexOf('console.log') + 1,
      content: line.trim(),
      context: context,
      isCommented: this._isCommented(line),
      isInCatchBlock: isInCatchBlock,
      isFunctional: false, // Will be set by isFunctionalLog method
      surroundingLines: surroundingLines,
      filePath: filePath
    };
  }

  /**
   * Check if a line is commented out
   * @param {string} line - Line to check
   * @returns {boolean} True if commented
   */
  _isCommented(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || 
           (trimmed.startsWith('/*') && trimmed.includes('console.log'));
  }

  /**
   * Get the indentation level of a line
   * @param {string} line - Line to analyze
   * @returns {number} Indentation level
   */
  _getIndentLevel(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  /**
   * Check if console.log is in a catch block
   * @param {number} lineIndex - Current line index (0-based)
   * @param {Array<string>} allLines - All lines in the file
   * @returns {boolean} True if in catch block
   */
  _isInCatchBlock(lineIndex, allLines) {
    // Look backwards for catch statement
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 15); i--) {
      const line = allLines[i];
      if (line && /catch\s*\(/.test(line)) {
        // Check if we're still inside the catch block by counting braces
        let braceCount = 0;
        let foundCatchBrace = false;
        
        // Start from the catch line and count braces
        for (let j = i; j <= lineIndex; j++) {
          const checkLine = allLines[j];
          if (checkLine) {
            // Count opening and closing braces
            const openBraces = (checkLine.match(/\{/g) || []).length;
            const closeBraces = (checkLine.match(/\}/g) || []).length;
            
            braceCount += openBraces - closeBraces;
            
            // Mark that we found the opening brace for the catch block
            if (j === i && openBraces > 0) {
              foundCatchBrace = true;
            }
          }
        }
        
        // We're in the catch block if:
        // 1. We found the opening brace for the catch
        // 2. The brace count is still positive (we haven't closed the catch block)
        if (foundCatchBrace && braceCount > 0) {
          return true;
        }
        
        // Alternative check: if catch is on previous line and current line is indented more
        if (i === lineIndex - 1) {
          const catchIndent = this._getIndentLevel(line);
          const currentIndent = this._getIndentLevel(allLines[lineIndex]);
          return currentIndent > catchIndent;
        }
      }
    }
    return false;
  }

  /**
   * Check if console.log is part of a ternary operator
   * @param {string} line - Line to check
   * @returns {boolean} True if part of ternary
   */
  _isInTernary(line) {
    return (line.includes('?') && line.includes('console.log') && line.includes(':')) ||
           (line.includes(':') && line.includes('console.log') && !line.trim().startsWith('console.log'));
  }

  /**
   * Check if console.log is part of a method chain
   * @param {string} line - Line to check
   * @returns {boolean} True if part of method chain
   */
  _isInMethodChain(line) {
    // Check for chaining before console.log
    if (/[a-zA-Z0-9_)\]]\..*console\.log/.test(line)) {
      return true;
    }
    
    // Check for chaining after console.log
    if (/console\.log.*\.[a-zA-Z]/.test(line)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if console.log is part of an expression or assignment
   * @param {string} content - Line content
   * @returns {boolean} True if part of expression
   */
  _isPartOfExpression(content) {
    const trimmed = content.trim();
    
    // Check for assignment
    if (/^[^/\*]*[a-zA-Z0-9_)\]\}].*console\.log/.test(trimmed) && 
        !trimmed.startsWith('console.log')) {
      return true;
    }
    
    // Check for use in expression
    if (/console\.log.*\)\s*[a-zA-Z0-9_{\[(]/.test(content)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we're inside a function
   * @param {number} lineIndex - Current line index (0-based)
   * @param {Array<string>} allLines - All lines in the file
   * @returns {boolean} True if inside function
   */
  _isInFunction(lineIndex, allLines) {
    let braceCount = 0;
    
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 20); i--) {
      const line = allLines[i];
      if (line) {
        // Count braces to track scope
        braceCount += (line.match(/\}/g) || []).length;
        braceCount -= (line.match(/\{/g) || []).length;
        
        // Look for function declarations
        if (braceCount <= 0 && 
            (line.includes('function') || 
             line.includes('=>') || 
             /\w+\s*\([^)]*\)\s*\{/.test(line))) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check if we're inside a conditional statement
   * @param {number} lineIndex - Current line index (0-based)
   * @param {Array<string>} allLines - All lines in the file
   * @returns {boolean} True if inside conditional
   */
  _isInConditional(lineIndex, allLines) {
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 5); i--) {
      const line = allLines[i];
      if (line && /^\s*(if|else|while|for|switch)\s*[\(\{]/.test(line.trim())) {
        return true;
      }
    }
    return false;
  }
}

module.exports = CodeAnalyzer;