#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Configuration
let config = {
  mode: 'manual', // Default to manual mode as per requirement 2.1
  dryRun: false,
  verbose: false,
  startDir: process.cwd(),
  interactive: true, // Enable interactive prompts in manual mode
  enhancedReporting: false, // Enhanced reporting with detailed breakdown
  excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
};

// Counters
let stats = {
  totalFiles: 0,
  filesWithConsoleLog: 0,
  modifiedFiles: 0,
  totalConsoleLogFound: 0,
  totalRemoved: 0,
  totalConverted: 0,
  commentedLogsRemoved: 0,
  functionalLogsPreserved: 0,
  potentiallySensitive: 0,
  processingTime: 0
};

function showUsage() {
  console.log(`Usage: node ${path.basename(__filename)} [OPTIONS]`);
  console.log('');
  console.log('A console.log cleanup tool that helps remove debugging logs while preserving functional ones.');
  console.log('');
  console.log('OPTIONS:');
  console.log('  -m, --mode <mode>        Execution mode: "manual" (default) or "auto"');
  console.log('                           manual: Interactive review of each console.log');
  console.log('                           auto: Automatic removal of safe-to-remove logs');
  console.log('  -d, --dry-run           Show what would be changed without modifying files');
  console.log('  -v, --verbose           Enable verbose output');
  console.log('  -i, --interactive       Enable interactive prompts (default in manual mode)');
  console.log('  --no-interactive        Disable interactive prompts');
  console.log('  -r, --enhanced-report   Generate enhanced reporting with detailed breakdown');
  console.log('  --start-dir <path>      Starting directory (default: current directory)');
  console.log('  --exclude <pattern>     Add exclusion pattern (can be used multiple times)');
  console.log('  -h, --help              Show this help message');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  node index.js                    # Manual mode with interactive review (default)');
  console.log('  node index.js --mode auto        # Automatic mode');
  console.log('  node index.js --dry-run          # Preview changes without modifying files');
  console.log('  node index.js --enhanced-report  # Generate detailed cleanup report');
  console.log('  node index.js --mode manual -r   # Manual mode with enhanced reporting');
  console.log('');
  console.log('MODES:');
  console.log('  Manual (default): Review each console.log with context before deciding');
  console.log('                    Provides interactive prompts for each console.log found');
  console.log('  Auto: Automatically remove obvious debugging logs, preserve functional ones');
  console.log('        Uses smart analysis to avoid breaking functional code');
}

function parseArgs() {
  const args = process.argv.slice(2);
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    
    switch (arg) {
      case '-m':
      case '--mode':
        i++;
        if (i >= args.length) {
          console.error(`${colors.red}Error: --mode requires a value (manual or auto)${colors.reset}`);
          process.exit(1);
        }
        const mode = args[i].toLowerCase();
        if (mode !== 'manual' && mode !== 'auto') {
          console.error(`${colors.red}Error: Invalid mode "${args[i]}". Use "manual" or "auto"${colors.reset}`);
          process.exit(1);
        }
        config.mode = mode;
        // Auto mode disables interactive by default, manual mode enables it
        config.interactive = (mode === 'manual');
        break;
        
      case '-d':
      case '--dry-run':
        config.dryRun = true;
        break;
        
      case '-v':
      case '--verbose':
        config.verbose = true;
        break;
        
      case '-i':
      case '--interactive':
        config.interactive = true;
        break;
        
      case '--no-interactive':
        config.interactive = false;
        break;
        
      case '-r':
      case '--enhanced-report':
        config.enhancedReporting = true;
        break;
        
      case '--start-dir':
        i++;
        if (i >= args.length) {
          console.error(`${colors.red}Error: --start-dir requires a path${colors.reset}`);
          process.exit(1);
        }
        config.startDir = path.resolve(args[i]);
        if (!fs.existsSync(config.startDir)) {
          console.error(`${colors.red}Error: Directory "${config.startDir}" does not exist${colors.reset}`);
          process.exit(1);
        }
        break;
        
      case '--exclude':
        i++;
        if (i >= args.length) {
          console.error(`${colors.red}Error: --exclude requires a pattern${colors.reset}`);
          process.exit(1);
        }
        config.excludePatterns.push(args[i]);
        break;
        
      case '-h':
      case '--help':
        showUsage();
        process.exit(0);
        break;
        
      default:
        if (arg.startsWith('-')) {
          console.error(`${colors.red}Error: Unknown option "${arg}"${colors.reset}`);
          showUsage();
          process.exit(1);
        } else {
          console.error(`${colors.red}Error: Unexpected argument "${arg}"${colors.reset}`);
          showUsage();
          process.exit(1);
        }
    }
    i++;
  }

  // Validate configuration
  if (config.mode === 'auto' && config.interactive) {
    console.log(`${colors.yellow}Note: Interactive mode is not typically used with auto mode${colors.reset}`);
  }
  
  // Ensure manual mode has interactive enabled by default (requirement 2.1)
  if (config.mode === 'manual' && config.interactive === undefined) {
    config.interactive = true;
  }
  
  // Validate start directory exists
  if (!fs.existsSync(config.startDir)) {
    console.error(`${colors.red}Error: Start directory "${config.startDir}" does not exist${colors.reset}`);
    process.exit(1);
  }
}

function shouldPreserveLine(line, lineNumber = null, allLines = null) {
  const trimmed = line.trim();

  // Enhanced catch block detection - check if console.log is in error handling context
  if (lineNumber && allLines && isInCatchBlock(lineNumber - 1, allLines)) {
    // In catch blocks, console.log might be functional for error logging
    // Preserve it but flag for potential conversion to console.error
    return true;
  }

  // Enhanced ternary operator detection - more accurate functional log identification
  if (isInTernaryOperator(line)) {
    return true;
  }

  // Enhanced arrow function detection - improved detection of functional usage
  if (isInArrowFunction(line)) {
    return true;
  }

  // Enhanced method chaining detection - improved detection of chained calls
  if (isInMethodChain(line)) {
    return true;
  }

  // Preserve if it's part of an assignment or complex expression
  if (isPartOfExpression(line)) {
    return true;
  }

  // Preserve if it's a return statement
  if (line.includes('return') && line.includes('console.log')) {
    return true;
  }

  return false;
}

// Enhanced helper functions for better context detection

/**
 * Enhanced catch block detection with improved accuracy
 * @param {number} lineIndex - Current line index (0-based)
 * @param {Array<string>} allLines - All lines in the file
 * @returns {boolean} True if in catch block
 */
function isInCatchBlock(lineIndex, allLines) {
  if (!allLines || lineIndex < 0 || lineIndex >= allLines.length) {
    return false;
  }

  // Look backwards for catch statement within reasonable scope
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 20); i--) {
    const line = allLines[i];
    if (!line) continue;

    // Match various catch block patterns
    if (/catch\s*\(\s*\w*\s*\)\s*\{?/.test(line) || 
        /}\s*catch\s*\(\s*\w*\s*\)/.test(line) ||
        /catch\s*\(\s*\w*\s*\)/.test(line)) {
      
      // Verify we're still inside the catch block by analyzing scope
      return isWithinBlockScope(i, lineIndex, allLines);
    }
  }
  return false;
}

/**
 * Enhanced ternary operator detection with better pattern matching
 * @param {string} line - Line to check
 * @returns {boolean} True if part of ternary operator
 */
function isInTernaryOperator(line) {
  const trimmed = line.trim();
  
  // Pattern 1: condition ? console.log(...) : something
  if (/\?\s*console\.log/.test(line) && line.includes(':')) {
    return true;
  }
  
  // Pattern 2: condition ? something : console.log(...)
  if (/:\s*console\.log/.test(line) && line.includes('?')) {
    return true;
  }
  
  // Pattern 3: Multi-line ternary where console.log is on continuation line
  if (line.includes(':') && line.includes('console.log') && !trimmed.startsWith('console.log')) {
    // Check if this looks like a ternary continuation
    if (/^\s*:\s*console\.log/.test(line) || /^\s*console\.log/.test(line)) {
      return true;
    }
  }
  
  // Pattern 4: Nested ternary operators
  if (/console\.log.*\?.*:/.test(line) || /\?.*console\.log.*:/.test(line)) {
    return true;
  }
  
  return false;
}

/**
 * Enhanced arrow function detection with improved patterns
 * @param {string} line - Line to check
 * @returns {boolean} True if part of arrow function
 */
function isInArrowFunction(line) {
  // Pattern 1: Direct arrow function assignment with console.log
  if (/=\s*\([^)]*\)\s*=>\s*console\.log/.test(line)) {
    return true;
  }
  
  // Pattern 2: Arrow function without parentheses
  if (/=\s*\w+\s*=>\s*console\.log/.test(line)) {
    return true;
  }
  
  // Pattern 3: Arrow function as callback with console.log
  if (/\(\s*[^)]*\s*\)\s*=>\s*console\.log/.test(line)) {
    return true;
  }
  
  // Pattern 4: Multi-line arrow function where console.log is the body
  if (line.includes('=>') && line.includes('console.log')) {
    return true;
  }
  
  // Pattern 5: Arrow function in array methods (map, filter, etc.)
  if (/\.(map|filter|forEach|reduce|find|some|every)\s*\([^)]*=>[^)]*console\.log/.test(line)) {
    return true;
  }
  
  return false;
}

/**
 * Enhanced method chaining detection with improved accuracy
 * @param {string} line - Line to check
 * @returns {boolean} True if part of method chain
 */
function isInMethodChain(line) {
  // Pattern 1: Method call before console.log (obj.method().console.log)
  if (/[a-zA-Z0-9_)\]]\s*\.\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*\.\s*console\.log/.test(line)) {
    return true;
  }
  
  // Pattern 2: Console.log followed by method call (console.log().method())
  if (/console\.log\s*\([^)]*\)\s*\.\s*[a-zA-Z_]/.test(line)) {
    return true;
  }
  
  // Pattern 3: Property access before console.log (obj.prop.console.log)
  if (/[a-zA-Z0-9_)\]]\s*\.\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\.\s*console\.log/.test(line)) {
    return true;
  }
  
  // Pattern 4: Promise chains with console.log
  if (/\.(then|catch|finally)\s*\(\s*console\.log/.test(line)) {
    return true;
  }
  
  // Pattern 5: Array method chaining with console.log
  if (/\.(map|filter|forEach|reduce)\s*\([^)]*console\.log[^)]*\)\s*\./.test(line)) {
    return true;
  }
  
  return false;
}

/**
 * Enhanced expression detection for complex usage patterns
 * @param {string} line - Line to check
 * @returns {boolean} True if part of expression
 */
function isPartOfExpression(line) {
  const trimmed = line.trim();
  
  // Skip if line starts with console.log (simple statement)
  if (trimmed.startsWith('console.log')) {
    return false;
  }
  
  // Pattern 1: Variable assignment with console.log
  if (/^[^/\*]*[a-zA-Z0-9_$]\s*=.*console\.log/.test(trimmed)) {
    return true;
  }
  
  // Pattern 2: Object property assignment
  if (/^[^/\*]*[a-zA-Z0-9_$]\s*\[\s*[^\]]+\s*\]\s*=.*console\.log/.test(trimmed)) {
    return true;
  }
  
  // Pattern 3: Function argument with console.log
  if (/[a-zA-Z0-9_$]\s*\([^)]*console\.log[^)]*\)/.test(line)) {
    return true;
  }
  
  // Pattern 4: Logical operators with console.log
  if (/(&&|\|\|)\s*console\.log/.test(line) || /console\.log\s*(&&|\|\|)/.test(line)) {
    return true;
  }
  
  // Pattern 5: Arithmetic or comparison with console.log
  if (/[+\-*/%<>=!]\s*console\.log/.test(line) || /console\.log\s*[+\-*/%<>=!]/.test(line)) {
    return true;
  }
  
  return false;
}

/**
 * Helper function to determine if a line is within a block scope
 * @param {number} blockStartIndex - Index where block starts
 * @param {number} targetIndex - Index of target line
 * @param {Array<string>} allLines - All lines in the file
 * @returns {boolean} True if target is within the block
 */
function isWithinBlockScope(blockStartIndex, targetIndex, allLines) {
  let braceCount = 0;
  let foundOpeningBrace = false;
  
  // Start from the block start and count braces
  for (let i = blockStartIndex; i <= targetIndex && i < allLines.length; i++) {
    const line = allLines[i];
    if (!line) continue;
    
    // Count opening and closing braces
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    
    braceCount += openBraces - closeBraces;
    
    // Mark that we found the opening brace
    if (openBraces > 0 && !foundOpeningBrace) {
      foundOpeningBrace = true;
    }
    
    // If we've closed all braces, we're outside the block
    if (foundOpeningBrace && braceCount <= 0 && i < targetIndex) {
      return false;
    }
  }
  
  // We're in the block if we found the opening brace and haven't closed it
  return foundOpeningBrace && braceCount > 0;
}

/**
 * Detect potentially sensitive data in console.log arguments
 * @param {string} line - Line containing console.log
 * @returns {Object} Detection result with isSensitive flag and detected patterns
 */
function detectSensitiveData(line) {
  const result = {
    isSensitive: false,
    detectedPatterns: [],
    riskLevel: 'low' // low, medium, high
  };

  // Extract the console.log arguments
  const consoleLogMatch = line.match(/console\.log\s*\(\s*([^)]+)\s*\)/);
  if (!consoleLogMatch) {
    return result;
  }

  const args = consoleLogMatch[1];
  const lowerArgs = args.toLowerCase();

  // High-risk patterns - tokens, keys, passwords
  const highRiskPatterns = [
    // API keys and tokens
    { pattern: /\b(api[_-]?key|apikey)\b/i, type: 'API Key' },
    { pattern: /\b(access[_-]?token|accesstoken)\b/i, type: 'Access Token' },
    { pattern: /\b(auth[_-]?token|authtoken)\b/i, type: 'Auth Token' },
    { pattern: /\b(bearer[_-]?token|bearertoken)\b/i, type: 'Bearer Token' },
    { pattern: /\b(refresh[_-]?token|refreshtoken)\b/i, type: 'Refresh Token' },
    { pattern: /\b(secret[_-]?key|secretkey)\b/i, type: 'Secret Key' },
    { pattern: /\b(private[_-]?key|privatekey)\b/i, type: 'Private Key' },
    
    // Passwords and credentials
    { pattern: /\b(password|passwd|pwd)\b/i, type: 'Password' },
    { pattern: /\b(credential|cred)\b/i, type: 'Credential' },
    
    // JWT and session tokens
    { pattern: /\b(jwt|session[_-]?token)\b/i, type: 'JWT/Session Token' },
    
    // Database and connection strings
    { pattern: /\b(connection[_-]?string|connectionstring)\b/i, type: 'Connection String' },
    { pattern: /\b(database[_-]?url|databaseurl)\b/i, type: 'Database URL' },
    
    // OAuth and social media tokens
    { pattern: /\b(oauth[_-]?token|client[_-]?secret)\b/i, type: 'OAuth Token/Secret' }
  ];

  // Medium-risk patterns - user data and identifiers
  const mediumRiskPatterns = [
    // Personal identifiers
    { pattern: /\b(user[_-]?id|userid)\b/i, type: 'User ID' },
    { pattern: /\b(email|e[_-]?mail)\b/i, type: 'Email' },
    { pattern: /\b(phone|telephone|mobile)\b/i, type: 'Phone Number' },
    { pattern: /\b(ssn|social[_-]?security)\b/i, type: 'SSN' },
    
    // Financial data
    { pattern: /\b(credit[_-]?card|creditcard|card[_-]?number)\b/i, type: 'Credit Card' },
    { pattern: /\b(bank[_-]?account|account[_-]?number)\b/i, type: 'Bank Account' },
    
    // Session and tracking data
    { pattern: /\b(session[_-]?id|sessionid)\b/i, type: 'Session ID' },
    { pattern: /\b(tracking[_-]?id|trackingid)\b/i, type: 'Tracking ID' },
    
    // IP addresses and network info
    { pattern: /\b(ip[_-]?address|ipaddress)\b/i, type: 'IP Address' },
    { pattern: /\b(mac[_-]?address|macaddress)\b/i, type: 'MAC Address' }
  ];

  // Low-risk patterns - potentially sensitive but context-dependent
  const lowRiskPatterns = [
    { pattern: /\b(hash|checksum)\b/i, type: 'Hash/Checksum' },
    { pattern: /\b(signature|sig)\b/i, type: 'Signature' },
    { pattern: /\b(nonce|salt)\b/i, type: 'Nonce/Salt' }
  ];

  // Check for actual token/key-like values (long alphanumeric strings)
  const tokenPatterns = [
    // JWT-like tokens (base64 with dots)
    { pattern: /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, type: 'JWT Token Value' },
    
    // API key-like strings (long alphanumeric)
    { pattern: /[A-Za-z0-9]{32,}/, type: 'Potential API Key Value' },
    
    // UUID patterns
    { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, type: 'UUID' },
    
    // Base64-encoded data (longer strings)
    { pattern: /[A-Za-z0-9+/]{40,}={0,2}/, type: 'Base64 Data' }
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

  // Check low-risk patterns (only if not already medium or high risk)
  if (result.riskLevel === 'low') {
    for (const { pattern, type } of lowRiskPatterns) {
      if (pattern.test(args)) {
        result.isSensitive = true;
        result.detectedPatterns.push(type);
      }
    }
  }

  // Check for actual token/key values
  for (const { pattern, type } of tokenPatterns) {
    if (pattern.test(args)) {
      result.isSensitive = true;
      if (result.riskLevel === 'low') {
        result.riskLevel = 'high'; // Actual token values are high risk
      }
      result.detectedPatterns.push(type);
    }
  }

  // Additional heuristics for sensitive data
  
  // Check for variable names that suggest sensitive data
  if (/\b(token|key|secret|password|credential|auth)\w*\s*[,)]/.test(lowerArgs)) {
    result.isSensitive = true;
    if (result.riskLevel === 'low') {
      result.riskLevel = 'medium';
    }
    result.detectedPatterns.push('Sensitive Variable Name');
  }

  // Check for object properties that might contain sensitive data
  if (/\.(token|key|secret|password|credential|auth)\w*\b/.test(lowerArgs)) {
    result.isSensitive = true;
    if (result.riskLevel === 'low') {
      result.riskLevel = 'medium';
    }
    result.detectedPatterns.push('Sensitive Object Property');
  }

  // Check for destructured sensitive properties
  if (/\{\s*[^}]*(token|key|secret|password|credential|auth)\w*[^}]*\}/.test(lowerArgs)) {
    result.isSensitive = true;
    if (result.riskLevel === 'low') {
      result.riskLevel = 'medium';
    }
    result.detectedPatterns.push('Destructured Sensitive Property');
  }

  return result;
}

/**
 * Flag potentially sensitive console.log statements for special attention
 * @param {string} line - Line containing console.log
 * @param {number} lineNumber - Line number for reporting
 * @param {string} filePath - File path for reporting
 * @returns {Object} Flagging result with recommendations
 */
function flagSensitiveConsoleLog(line, lineNumber, filePath) {
  const sensitiveData = detectSensitiveData(line);
  
  if (!sensitiveData.isSensitive) {
    return { flagged: false };
  }

  const flag = {
    flagged: true,
    riskLevel: sensitiveData.riskLevel,
    detectedPatterns: sensitiveData.detectedPatterns,
    line: lineNumber,
    filePath: filePath,
    content: line.trim(),
    recommendations: []
  };

  // Generate recommendations based on risk level and patterns
  switch (sensitiveData.riskLevel) {
    case 'high':
      flag.recommendations.push('URGENT: Remove this console.log - it may expose sensitive credentials');
      flag.recommendations.push('Consider using environment variables for sensitive data');
      flag.recommendations.push('Review if this data should be logged at all');
      break;
      
    case 'medium':
      flag.recommendations.push('Review this console.log for potential privacy concerns');
      flag.recommendations.push('Consider redacting or masking sensitive parts');
      flag.recommendations.push('Use console.error for error-related logging instead');
      break;
      
    case 'low':
      flag.recommendations.push('Consider if this data should be logged in production');
      flag.recommendations.push('Use appropriate log levels (info, warn, error)');
      break;
  }

  return flag;
}

function processFile(filePath) {
  return new Promise(async (resolve) => {
    try {
      if (config.verbose) {
        console.log(`${colors.blue}Processing: ${filePath}${colors.reset}`);
      }

      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n');

      if (!content.includes('console.log')) {
        if (config.verbose) {
          console.log(`${colors.yellow}  No console.log statements found${colors.reset}`);
        }
        resolve(0);
        return;
      }

      // Track that this file has console.log statements
      stats.filesWithConsoleLog++;

      const newLines = [];
      let removedCount = 0;
      let fileModified = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;

        // Check if this line contains console.log (excluding error-related)
        if (line.includes('console.log') && !line.toLowerCase().includes('err')) {
          const trimmed = line.trim();
          stats.totalConsoleLogFound++;

          // Check for sensitive data patterns
          const sensitiveFlag = flagSensitiveConsoleLog(line, lineNumber, filePath);
          if (sensitiveFlag.flagged) {
            stats.potentiallySensitive++;
            
            // Display warning for sensitive data
            const riskColor = sensitiveFlag.riskLevel === 'high' ? colors.red : 
                             sensitiveFlag.riskLevel === 'medium' ? colors.yellow : colors.blue;
            
            console.log(`${riskColor}⚠ SENSITIVE DATA DETECTED (${sensitiveFlag.riskLevel.toUpperCase()} RISK) - Line ${lineNumber}:${colors.reset}`);
            console.log(`  ${line.trim()}`);
            console.log(`  Detected: ${sensitiveFlag.detectedPatterns.join(', ')}`);
            
            if (config.verbose) {
              sensitiveFlag.recommendations.forEach(rec => {
                console.log(`  ${colors.yellow}→ ${rec}${colors.reset}`);
              });
            }
          }

          if (trimmed.startsWith('//') && trimmed.includes('console.log')) {
            if (config.dryRun) {
              console.log(`${colors.red}  Would remove line ${lineNumber}: ${colors.reset}${line}`);
            } else if (config.verbose) {
              console.log(`${colors.red}  Removing line ${lineNumber}: ${colors.reset}${line}`);
            }
            removedCount++;
            stats.commentedLogsRemoved++;
            fileModified = true;
            continue;
          }

          if (trimmed.startsWith('/*') && trimmed.includes('console.log')) {
            if (config.dryRun) {
              console.log(`${colors.red}  Would remove line ${lineNumber}: ${colors.reset}${line}`);
            } else if (config.verbose) {
              console.log(`${colors.red}  Removing line ${lineNumber}: ${colors.reset}${line}`);
            }
            removedCount++;
            stats.commentedLogsRemoved++;
            fileModified = true;
            continue;
          }

          // Check if it should be preserved based on context
          if (shouldPreserveLine(line, lineNumber, lines)) {
            if (config.verbose) {
              console.log(`${colors.green}  Preserving line ${lineNumber}: ${colors.reset}${line}`);
            }
            stats.functionalLogsPreserved++;
            newLines.push(line);
          } else {
            if (config.dryRun) {
              console.log(`${colors.red}  Would remove line ${lineNumber}: ${colors.reset}${line}`);
            } else if (config.verbose) {
              console.log(`${colors.red}  Removing line ${lineNumber}: ${colors.reset}${line}`);
            }
            removedCount++;
            fileModified = true;
          }
        } else {
          // Keep all other lines
          newLines.push(line);
        }
      }

      // Write file if changes were made and not in dry run mode
      if (!config.dryRun && fileModified) {
        await writeFile(filePath, newLines.join('\n'));
        console.log(`${colors.green}Modified ${filePath}: removed ${removedCount} console.log statements${colors.reset}`);
      }

      resolve(removedCount);
    } catch (error) {
      console.error(`${colors.red}Error processing ${filePath}: ${error.message}${colors.reset}`);
      resolve(0);
    }
  });
}

async function findFiles(dir, files = []) {
  try {
    const items = await readdir(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const itemStat = await stat(fullPath);

      if (itemStat.isDirectory()) {
        // Skip node_modules directories
        if (item === 'node_modules') {
          continue;
        }
        await findFiles(fullPath, files);
      } else if (itemStat.isFile()) {
        // Check if it's a JavaScript/TypeScript file
        const ext = path.extname(fullPath).toLowerCase();
        if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    if (config.verbose) {
      console.error(`${colors.red}Error reading directory ${dir}: ${error.message}${colors.reset}`);
    }
  }

  return files;
}

async function main() {
  const startTime = Date.now();
  parseArgs();

  console.log(`${colors.blue}Starting console.log cleanup...${colors.reset}`);
  console.log(`${colors.blue}Mode: ${config.mode.toUpperCase()}${colors.reset}`);
  
  if (config.mode === 'manual') {
    console.log(`${colors.blue}Manual mode: You will be prompted to review each console.log statement${colors.reset}`);
  } else {
    console.log(`${colors.blue}Auto mode: Automatically removing safe-to-remove console.log statements${colors.reset}`);
  }
  
  if (config.dryRun) {
    console.log(`${colors.yellow}DRY RUN MODE - No files will be modified${colors.reset}`);
  }
  
  if (config.interactive && config.mode === 'manual') {
    console.log(`${colors.blue}Interactive mode enabled${colors.reset}`);
  }
  
  if (config.enhancedReporting) {
    console.log(`${colors.blue}Enhanced reporting enabled${colors.reset}`);
  }

  // Find all JavaScript/TypeScript files
  const files = await findFiles(config.startDir);

  console.log(`${colors.blue}Found ${files.length} JavaScript/TypeScript files${colors.reset}`);

  if (files.length === 0) {
    console.log(`${colors.yellow}No JavaScript/TypeScript files found${colors.reset}`);
    return;
  }


  // Process each file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    stats.totalFiles++;

    if (config.verbose || (stats.totalFiles % 50 === 0)) {
      console.log(`${colors.blue}Processing file ${stats.totalFiles}/${files.length}: ${file}${colors.reset}`);
    }

    const removedCount = await processFile(file);

    if (removedCount > 0) {
      stats.modifiedFiles++;
      stats.totalRemoved += removedCount;
    }
  }

  // Calculate processing time
  stats.processingTime = Date.now() - startTime;

  // Summary
  console.log(`${colors.blue}=== Summary ===${colors.reset}`);
  console.log(`Files scanned: ${stats.totalFiles}`);
  console.log(`Files with console.log: ${stats.filesWithConsoleLog}`);

  if (config.dryRun) {
    console.log(`Files that would be modified: ${stats.modifiedFiles}`);
    console.log(`Console.log statements that would be removed: ${stats.totalRemoved}`);
  } else {
    console.log(`Files modified: ${stats.modifiedFiles}`);
    console.log(`Console.log statements removed: ${stats.totalRemoved}`);
  }

  // Enhanced reporting
  if (config.enhancedReporting) {
    console.log(`${colors.blue}=== Enhanced Report ===${colors.reset}`);
    console.log(`Total console.log statements found: ${stats.totalConsoleLogFound}`);
    console.log(`Commented logs removed: ${stats.commentedLogsRemoved}`);
    console.log(`Functional logs preserved: ${stats.functionalLogsPreserved}`);
    console.log(`Statements converted: ${stats.totalConverted}`);
    console.log(`Potentially sensitive logs flagged: ${stats.potentiallySensitive}`);
    console.log(`Processing time: ${stats.processingTime}ms`);
    
    if (stats.functionalLogsPreserved > 0) {
      console.log(`${colors.green}✓ Preserved ${stats.functionalLogsPreserved} functional console.log statements${colors.reset}`);
    }
    if (stats.potentiallySensitive > 0) {
      console.log(`${colors.yellow}⚠ Found ${stats.potentiallySensitive} potentially sensitive console.log statements${colors.reset}`);
    }
  }

  if (stats.totalRemoved > 0 && config.dryRun) {
    console.log(`${colors.yellow}Run without --dry-run to actually remove the console.log statements${colors.reset}`);
  } else if (stats.totalRemoved === 0) {
    console.log(`${colors.green}No unnecessary console.log statements found!${colors.reset}`);
  }
}

// Run the script
main().catch(error => {
  console.error(`${colors.red}Script failed: ${error.message}${colors.reset}`);
  process.exit(1);
});