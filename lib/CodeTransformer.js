/**
 * CodeTransformer class for console.log transformation capabilities
 * Handles conversion of console.log to console.error, console.info, and safe removal
 */
class CodeTransformer {
  constructor() {
    // Preserve original formatting patterns
    this.indentPattern = /^(\s*)/;
    this.trailingPattern = /(\s*)$/;
  }

  /**
   * Convert console.log to console.error (typically for catch blocks)
   * @param {string} line - Original line containing console.log
   * @returns {string} Transformed line with console.error
   */
  convertToConsoleError(line) {
    // Preserve original formatting and indentation
    const indentMatch = line.match(this.indentPattern);
    const trailingMatch = line.match(this.trailingPattern);
    const indent = indentMatch ? indentMatch[1] : '';
    const trailing = trailingMatch ? trailingMatch[1] : '';
    
    // Replace console.log with console.error while preserving everything else
    const transformed = line.replace(/console\.log/g, 'console.error');
    
    return transformed;
  }

  /**
   * Convert console.log to console.info (for informational logging)
   * @param {string} line - Original line containing console.log
   * @returns {string} Transformed line with console.info
   */
  convertToConsoleInfo(line) {
    // Preserve original formatting and indentation
    const indentMatch = line.match(this.indentPattern);
    const trailingMatch = line.match(this.trailingPattern);
    const indent = indentMatch ? indentMatch[1] : '';
    const trailing = trailingMatch ? trailingMatch[1] : '';
    
    // Replace console.log with console.info while preserving everything else
    const transformed = line.replace(/console\.log/g, 'console.info');
    
    return transformed;
  }

  /**
   * Safely remove a console.log statement while preserving code structure
   * @param {string} line - Original line containing console.log
   * @returns {string|null} Empty string if line should be removed, original line if unsafe to remove
   */
  safelyRemoveConsoleLog(line) {
    const trimmed = line.trim();
    
    // Check if it's a standalone console.log statement that's safe to remove
    if (this._isStandaloneConsoleLog(line)) {
      return null; // Indicates line should be removed
    }
    
    // If console.log is part of a larger expression, we can't safely remove it
    // Return the original line unchanged
    return line;
  }

  /**
   * Remove commented console.log statements safely
   * @param {string} line - Line that may contain commented console.log
   * @returns {string|null} Cleaned line or null if entire line should be removed
   */
  removeCommentedConsoleLog(line) {
    const trimmed = line.trim();
    
    // Handle single-line comments
    if (trimmed.startsWith('//') && trimmed.includes('console.log')) {
      // Check if there's other content on the line besides the comment
      const beforeComment = line.substring(0, line.indexOf('//'));
      const hasOtherContent = beforeComment.trim().length > 0;
      
      if (hasOtherContent) {
        // Preserve the non-comment part
        return beforeComment.trimEnd();
      } else {
        // Entire line is just the commented console.log
        return null; // Indicates line should be removed
      }
    }
    
    // Handle multi-line comments that are on a single line
    if (trimmed.startsWith('/*') && trimmed.includes('console.log') && trimmed.includes('*/')) {
      // Extract content before and after the comment
      const commentStart = line.indexOf('/*');
      const commentEnd = line.indexOf('*/') + 2;
      const beforeComment = line.substring(0, commentStart);
      const afterComment = line.substring(commentEnd);
      
      // Check if the comment contains console.log
      const commentContent = line.substring(commentStart, commentEnd);
      if (commentContent.includes('console.log')) {
        const remainingContent = (beforeComment + afterComment).trim();
        if (remainingContent.length > 0) {
          return beforeComment + afterComment;
        } else {
          return null; // Entire line should be removed
        }
      }
    }
    
    // Handle inline comments with console.log
    if (line.includes('//') && line.includes('console.log')) {
      const commentIndex = line.indexOf('//');
      const commentPart = line.substring(commentIndex);
      
      if (commentPart.includes('console.log')) {
        const beforeComment = line.substring(0, commentIndex);
        if (beforeComment.trim().length > 0) {
          return beforeComment.trimEnd();
        } else {
          return null;
        }
      }
    }
    
    return line; // No commented console.log found, return original
  }

  /**
   * Enhanced multi-line comment detection and removal
   * @param {Array<string>} lines - All lines in the file
   * @param {number} startIndex - Starting line index to check
   * @returns {Object} Result with lines to remove and any modifications
   */
  detectMultiLineCommentedConsoleLog(lines, startIndex) {
    const result = {
      found: false,
      startLine: startIndex,
      endLine: startIndex,
      linesToRemove: [],
      modifiedLines: new Map()
    };

    const currentLine = lines[startIndex];
    if (!currentLine) return result;

    // Check if this line starts a multi-line comment containing console.log
    const commentStartMatch = currentLine.match(/\/\*/);
    if (!commentStartMatch) return result;

    const commentStartPos = commentStartMatch.index;
    let commentEndLine = startIndex;
    let commentEndPos = -1;
    let commentContent = '';

    // Find the end of the multi-line comment
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const searchStart = (i === startIndex) ? commentStartPos : 0;
      const lineContent = line.substring(searchStart);
      commentContent += lineContent;

      const endMatch = lineContent.match(/\*\//);
      if (endMatch) {
        commentEndLine = i;
        commentEndPos = searchStart + endMatch.index + 2;
        break;
      }
    }

    // Check if the comment contains console.log
    if (!commentContent.includes('console.log')) {
      return result;
    }

    result.found = true;
    result.endLine = commentEndLine;

    // Handle different scenarios for multi-line comment removal
    if (startIndex === commentEndLine) {
      // Single line with /* ... console.log ... */
      const beforeComment = currentLine.substring(0, commentStartPos);
      const afterComment = currentLine.substring(commentEndPos);
      const remainingContent = (beforeComment + afterComment).trim();

      if (remainingContent.length > 0) {
        result.modifiedLines.set(startIndex, beforeComment + afterComment);
      } else {
        result.linesToRemove.push(startIndex);
      }
    } else {
      // Multi-line comment spanning multiple lines
      const firstLine = lines[startIndex];
      const lastLine = lines[commentEndLine];

      const beforeComment = firstLine.substring(0, commentStartPos).trim();
      const afterComment = lastLine.substring(commentEndPos).trim();

      // Remove all lines that are entirely within the comment
      for (let i = startIndex; i <= commentEndLine; i++) {
        if (i === startIndex && beforeComment.length > 0) {
          // First line has content before comment
          result.modifiedLines.set(i, firstLine.substring(0, commentStartPos));
        } else if (i === commentEndLine && afterComment.length > 0) {
          // Last line has content after comment
          result.modifiedLines.set(i, lastLine.substring(commentEndPos));
        } else {
          // Line is entirely within comment or empty
          result.linesToRemove.push(i);
        }
      }
    }

    return result;
  }

  /**
   * Process an entire file to remove all commented console.log statements
   * @param {Array<string>} lines - All lines in the file
   * @returns {Object} Processing result with modified lines and removal info
   */
  processFileForCommentedConsoleLog(lines) {
    const result = {
      modifiedLines: [...lines], // Start with copy of original lines
      removedLines: [],
      modifiedLineNumbers: [],
      totalRemoved: 0
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      
      // Check for single-line commented console.log
      const singleLineResult = this.removeCommentedConsoleLog(line);
      if (singleLineResult !== line) {
        if (singleLineResult === null) {
          // Mark line for removal
          result.removedLines.push(i);
          result.totalRemoved++;
        } else {
          // Line was modified
          result.modifiedLines[i] = singleLineResult;
          result.modifiedLineNumbers.push(i);
        }
        i++;
        continue;
      }

      // Check for multi-line commented console.log
      const multiLineResult = this.detectMultiLineCommentedConsoleLog(lines, i);
      if (multiLineResult.found) {
        // Apply modifications from multi-line comment processing
        multiLineResult.linesToRemove.forEach(lineIndex => {
          result.removedLines.push(lineIndex);
          result.totalRemoved++;
        });

        multiLineResult.modifiedLines.forEach((newContent, lineIndex) => {
          result.modifiedLines[lineIndex] = newContent;
          result.modifiedLineNumbers.push(lineIndex);
        });

        // Skip to after the processed comment
        i = multiLineResult.endLine + 1;
      } else {
        i++;
      }
    }

    // Remove lines marked for removal (in reverse order to maintain indices)
    result.removedLines.sort((a, b) => b - a).forEach(lineIndex => {
      result.modifiedLines.splice(lineIndex, 1);
    });

    return result;
  }

  /**
   * Transform a line based on the specified action
   * @param {string} line - Original line
   * @param {string} action - Action to perform: 'delete', 'convert-error', 'convert-info', 'remove-comment'
   * @returns {Object} Transformation result with success flag and new content
   */
  transformLine(line, action) {
    const result = {
      success: false,
      originalLine: line,
      transformedLine: line,
      action: action,
      removed: false
    };

    try {
      switch (action) {
        case 'convert-error':
          result.transformedLine = this.convertToConsoleError(line);
          result.success = true;
          break;
          
        case 'convert-info':
          result.transformedLine = this.convertToConsoleInfo(line);
          result.success = true;
          break;
          
        case 'delete':
          const removeResult = this.safelyRemoveConsoleLog(line);
          if (removeResult === null) {
            result.removed = true;
            result.transformedLine = '';
          } else {
            result.transformedLine = removeResult;
          }
          result.success = true;
          break;
          
        case 'remove-comment':
          const commentResult = this.removeCommentedConsoleLog(line);
          if (commentResult === null) {
            result.removed = true;
            result.transformedLine = '';
          } else {
            result.transformedLine = commentResult;
          }
          result.success = true;
          break;
          
        case 'keep':
          // Keep the line unchanged
          result.transformedLine = line;
          result.success = true;
          break;
          
        default:
          result.success = false;
          result.error = `Unknown action: ${action}`;
      }
    } catch (error) {
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  /**
   * Validate that a transformation preserves code structure
   * @param {string} originalLine - Original line
   * @param {string} transformedLine - Transformed line
   * @returns {Object} Validation result
   */
  validateTransformation(originalLine, transformedLine) {
    const validation = {
      valid: true,
      warnings: [],
      errors: []
    };

    // Check for balanced parentheses
    const originalParens = this._countCharacters(originalLine, '(', ')');
    const transformedParens = this._countCharacters(transformedLine, '(', ')');
    
    if (originalParens.open !== transformedParens.open || 
        originalParens.close !== transformedParens.close) {
      validation.errors.push('Parentheses balance changed after transformation');
      validation.valid = false;
    }

    // Check for balanced braces
    const originalBraces = this._countCharacters(originalLine, '{', '}');
    const transformedBraces = this._countCharacters(transformedLine, '{', '}');
    
    if (originalBraces.open !== transformedBraces.open || 
        originalBraces.close !== transformedBraces.close) {
      validation.errors.push('Braces balance changed after transformation');
      validation.valid = false;
    }

    // Check for balanced brackets
    const originalBrackets = this._countCharacters(originalLine, '[', ']');
    const transformedBrackets = this._countCharacters(transformedLine, '[', ']');
    
    if (originalBrackets.open !== transformedBrackets.open || 
        originalBrackets.close !== transformedBrackets.close) {
      validation.errors.push('Brackets balance changed after transformation');
      validation.valid = false;
    }

    // Check for semicolon preservation in statements
    const originalHasSemicolon = originalLine.trim().endsWith(';');
    const transformedHasSemicolon = transformedLine.trim().endsWith(';');
    
    if (originalHasSemicolon !== transformedHasSemicolon && transformedLine.trim().length > 0) {
      validation.warnings.push('Semicolon presence changed after transformation');
    }

    return validation;
  }

  /**
   * Validate that comment removal doesn't break code structure
   * @param {Array<string>} originalLines - Original file lines
   * @param {Array<string>} modifiedLines - Modified file lines
   * @returns {Object} Validation result for the entire file
   */
  validateCommentRemoval(originalLines, modifiedLines) {
    const validation = {
      valid: true,
      warnings: [],
      errors: [],
      structureIntact: true
    };

    // Check overall brace balance
    const originalBraceBalance = this._calculateBraceBalance(originalLines);
    const modifiedBraceBalance = this._calculateBraceBalance(modifiedLines);

    if (originalBraceBalance !== modifiedBraceBalance) {
      validation.errors.push('Overall brace balance changed after comment removal');
      validation.valid = false;
      validation.structureIntact = false;
    }

    // Check parentheses balance
    const originalParenBalance = this._calculateParenBalance(originalLines);
    const modifiedParenBalance = this._calculateParenBalance(modifiedLines);

    if (originalParenBalance !== modifiedParenBalance) {
      validation.errors.push('Overall parentheses balance changed after comment removal');
      validation.valid = false;
      validation.structureIntact = false;
    }

    // Check for potential syntax issues
    const syntaxIssues = this._detectPotentialSyntaxIssues(modifiedLines);
    if (syntaxIssues.length > 0) {
      validation.warnings.push(...syntaxIssues);
    }

    // Check for orphaned semicolons or operators
    const orphanedElements = this._detectOrphanedElements(modifiedLines);
    if (orphanedElements.length > 0) {
      validation.warnings.push(...orphanedElements);
    }

    return validation;
  }

  /**
   * Safe removal validation - checks if removing a line/comment is safe
   * @param {string} line - Line to potentially remove
   * @param {Array<string>} surroundingLines - Context lines around the target
   * @param {number} lineIndex - Index of the line in the surrounding context
   * @returns {Object} Safety assessment
   */
  validateSafeRemoval(line, surroundingLines, lineIndex) {
    const safety = {
      safe: true,
      risks: [],
      recommendations: []
    };

    const trimmed = line.trim();

    // Check if removing this line would create syntax errors
    if (this._wouldCreateSyntaxError(line, surroundingLines, lineIndex)) {
      safety.safe = false;
      safety.risks.push('Removal would create syntax error');
      safety.recommendations.push('Keep the line or modify surrounding code');
    }

    // Check if line contains important structural elements
    if (this._containsStructuralElements(line)) {
      safety.safe = false;
      safety.risks.push('Line contains structural code elements');
      safety.recommendations.push('Only remove the comment portion');
    }

    // Check for potential impact on control flow
    if (this._affectsControlFlow(line, surroundingLines, lineIndex)) {
      safety.risks.push('May affect control flow');
      safety.recommendations.push('Review surrounding code after removal');
    }

    return safety;
  }

  // Private helper methods

  /**
   * Check if a console.log statement is standalone and safe to remove
   * @param {string} line - Line to check
   * @returns {boolean} True if standalone and safe to remove
   */
  _isStandaloneConsoleLog(line) {
    const trimmed = line.trim();
    
    // Must start with console.log (possibly with indentation)
    if (!trimmed.startsWith('console.log')) {
      return false;
    }
    
    // Must end with semicolon or be a complete statement
    if (!trimmed.endsWith(';') && !trimmed.endsWith(')')) {
      return false;
    }
    
    // Should not be part of an assignment
    if (line.includes('=') && line.indexOf('=') < line.indexOf('console.log')) {
      return false;
    }
    
    // Should not be part of a return statement
    if (line.includes('return') && line.indexOf('return') < line.indexOf('console.log')) {
      return false;
    }
    
    // Should not be part of a ternary operator
    if ((line.includes('?') && line.includes(':')) || 
        (line.includes(':') && !trimmed.startsWith('console.log'))) {
      return false;
    }
    
    // Should not be part of a method chain
    if (/[a-zA-Z0-9_)\]]\..*console\.log/.test(line) || 
        /console\.log.*\.[a-zA-Z]/.test(line)) {
      return false;
    }
    
    return true;
  }

  /**
   * Count opening and closing characters
   * @param {string} str - String to analyze
   * @param {string} openChar - Opening character
   * @param {string} closeChar - Closing character
   * @returns {Object} Count of opening and closing characters
   */
  _countCharacters(str, openChar, closeChar) {
    const open = (str.match(new RegExp('\\' + openChar, 'g')) || []).length;
    const close = (str.match(new RegExp('\\' + closeChar, 'g')) || []).length;
    return { open, close };
  }

  /**
   * Calculate overall brace balance for an array of lines
   * @param {Array<string>} lines - Lines to analyze
   * @returns {number} Net brace balance (positive = more opening, negative = more closing)
   */
  _calculateBraceBalance(lines) {
    let balance = 0;
    for (const line of lines) {
      if (line) {
        const braces = this._countCharacters(line, '{', '}');
        balance += braces.open - braces.close;
      }
    }
    return balance;
  }

  /**
   * Calculate overall parentheses balance for an array of lines
   * @param {Array<string>} lines - Lines to analyze
   * @returns {number} Net parentheses balance
   */
  _calculateParenBalance(lines) {
    let balance = 0;
    for (const line of lines) {
      if (line) {
        const parens = this._countCharacters(line, '(', ')');
        balance += parens.open - parens.close;
      }
    }
    return balance;
  }

  /**
   * Detect potential syntax issues in modified lines
   * @param {Array<string>} lines - Lines to check
   * @returns {Array<string>} Array of potential issues
   */
  _detectPotentialSyntaxIssues(lines) {
    const issues = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      const trimmed = line.trim();
      
      // Check for orphaned operators
      if (/^[+\-*/%&|^<>=!]+\s*$/.test(trimmed)) {
        issues.push(`Line ${i + 1}: Orphaned operator detected`);
      }
      
      // Check for incomplete statements
      if (trimmed.endsWith(',') && i === lines.length - 1) {
        issues.push(`Line ${i + 1}: Trailing comma at end of file`);
      }
      
      // Check for unmatched quotes (basic check)
      const singleQuotes = (trimmed.match(/'/g) || []).length;
      const doubleQuotes = (trimmed.match(/"/g) || []).length;
      if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
        issues.push(`Line ${i + 1}: Potentially unmatched quotes`);
      }
    }
    
    return issues;
  }

  /**
   * Detect orphaned elements after comment removal
   * @param {Array<string>} lines - Lines to check
   * @returns {Array<string>} Array of orphaned element warnings
   */
  _detectOrphanedElements(lines) {
    const orphaned = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      const trimmed = line.trim();
      
      // Check for orphaned semicolons
      if (trimmed === ';') {
        orphaned.push(`Line ${i + 1}: Orphaned semicolon`);
      }
      
      // Check for orphaned closing braces/parentheses
      if (/^[)\]}]+\s*;?\s*$/.test(trimmed)) {
        orphaned.push(`Line ${i + 1}: Potentially orphaned closing delimiter`);
      }
    }
    
    return orphaned;
  }

  /**
   * Check if removing a line would create a syntax error
   * @param {string} line - Line to potentially remove
   * @param {Array<string>} surroundingLines - Context lines
   * @param {number} lineIndex - Index in surrounding lines
   * @returns {boolean} True if removal would create syntax error
   */
  _wouldCreateSyntaxError(line, surroundingLines, lineIndex) {
    // Check if line contains structural elements that can't be removed
    const trimmed = line.trim();
    
    // Check for function/class/control structure keywords
    if (/^(function|class|if|else|for|while|switch|try|catch|finally)\b/.test(trimmed)) {
      return true;
    }
    
    // Check for opening braces that would become unmatched
    const braces = this._countCharacters(line, '{', '}');
    if (braces.open > braces.close) {
      // Check if there's a matching closing brace in subsequent lines
      let netBraces = braces.open - braces.close;
      for (let i = lineIndex + 1; i < surroundingLines.length && netBraces > 0; i++) {
        const nextLine = surroundingLines[i];
        if (nextLine) {
          const nextBraces = this._countCharacters(nextLine, '{', '}');
          netBraces += nextBraces.open - nextBraces.close;
        }
      }
      if (netBraces > 0) {
        return true; // Unmatched opening braces
      }
    }
    
    return false;
  }

  /**
   * Check if line contains structural code elements
   * @param {string} line - Line to check
   * @returns {boolean} True if contains structural elements
   */
  _containsStructuralElements(line) {
    const trimmed = line.trim();
    
    // Remove comments to check actual code
    const codeOnly = trimmed.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    
    // Check for structural keywords
    if (/\b(function|class|if|else|for|while|switch|try|catch|finally|return|break|continue)\b/.test(codeOnly)) {
      return true;
    }
    
    // Check for variable declarations
    if (/\b(var|let|const)\b/.test(codeOnly)) {
      return true;
    }
    
    // Check for assignments (but not console.log assignments)
    if (/[a-zA-Z0-9_$]\s*=/.test(codeOnly) && !codeOnly.includes('console.log')) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if removing a line would affect control flow
   * @param {string} line - Line to potentially remove
   * @param {Array<string>} surroundingLines - Context lines
   * @param {number} lineIndex - Index in surrounding lines
   * @returns {boolean} True if may affect control flow
   */
  _affectsControlFlow(line, surroundingLines, lineIndex) {
    const trimmed = line.trim();
    
    // Check if line is inside a control structure
    for (let i = Math.max(0, lineIndex - 5); i < lineIndex; i++) {
      const prevLine = surroundingLines[i];
      if (prevLine && /\b(if|else|for|while|switch|try|catch)\b/.test(prevLine)) {
        return true;
      }
    }
    
    // Check if line contains control flow statements
    if (/\b(return|break|continue|throw)\b/.test(trimmed)) {
      return true;
    }
    
    return false;
  }
}

module.exports = CodeTransformer;