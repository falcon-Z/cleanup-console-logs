#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Import the new ModeController
const ModeController = require('./lib/ModeController');

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// Configuration
let config = {
  mode: 'manual', // Default to manual mode as per requirement 2.1
  dryRun: false,
  verbose: false,
  startDir: process.cwd(),
  interactive: true, // Enable interactive prompts in manual mode
  enhancedReporting: false, // Enhanced reporting with detailed breakdown
  excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
  // Backup and error handling configuration
  backupDir: '.console-log-cleanup-backups',
  autoCleanup: true, // Automatically cleanup backups after successful operations
  logErrors: true // Log errors to file
};

// Enhanced statistics tracking for comprehensive reporting
let stats = {
  // File-level statistics
  totalFiles: 0,
  filesWithConsoleLog: 0,
  modifiedFiles: 0,
  
  // Console.log detection statistics
  totalConsoleLogFound: 0,
  totalConsoleLogProcessed: 0,
  
  // Action statistics - tracking found vs removed vs converted
  totalRemoved: 0,
  totalConverted: 0,
  totalKept: 0,
  
  // Breakdown by action type
  convertedToInfo: 0,
  convertedToError: 0,
  commentedLogsRemoved: 0,
  functionalLogsPreserved: 0,
  
  // Security-related statistics
  potentiallySensitive: 0,
  sensitiveLogsRemoved: 0,
  sensitiveLogsKept: 0,
  sensitiveLogsByRiskLevel: {
    high: 0,
    medium: 0,
    low: 0
  },
  
  // Manual mode decision tracking
  userDecisions: {
    delete: 0,
    keep: 0,
    convertInfo: 0,
    convertError: 0,
    skip: 0
  },
  
  // Performance and processing statistics
  processingTime: 0,
  averageTimePerFile: 0,
  
  // Context-based statistics
  consoleLogsInCatchBlocks: 0,
  functionalConsoleLogsDetected: 0,
  commentedConsoleLogsFound: 0,
  
  // Error and warning tracking
  processingErrors: 0,
  warningsGenerated: 0,
  
  // Recommendations tracking
  recommendationsGenerated: [],
  securityImprovements: []
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
  console.log('  --backup-dir <path>     Backup directory (default: .console-log-cleanup-backups)');
  console.log('  --no-backup-cleanup     Disable automatic backup cleanup after successful operations');
  console.log('  --no-error-log          Disable error logging to file');
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
        
      case '--backup-dir':
        i++;
        if (i >= args.length) {
          console.error(`${colors.red}Error: --backup-dir requires a path${colors.reset}`);
          process.exit(1);
        }
        config.backupDir = args[i];
        break;
        
      case '--no-backup-cleanup':
        config.autoCleanup = false;
        break;
        
      case '--no-error-log':
        config.logErrors = false;
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
 * Generate comprehensive summary report with security improvements and recommendations
 * @param {Object} stats - Statistics object
 * @param {Object} config - Configuration object
 * @param {Object} colors - Color constants
 */
function generateSummaryReport(stats, config, colors) {
  console.log(`\n${colors.blue}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.blue}${colors.bold}           CONSOLE.LOG CLEANUP SUMMARY REPORT${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(60)}${colors.reset}`);
  
  // Basic file processing statistics
  console.log(`\n${colors.blue}📁 FILE PROCESSING OVERVIEW${colors.reset}`);
  console.log(`   Files scanned: ${colors.cyan}${stats.totalFiles}${colors.reset}`);
  console.log(`   Files with console.log: ${colors.cyan}${stats.filesWithConsoleLog}${colors.reset}`);
  
  if (config.dryRun) {
    console.log(`   Files that would be modified: ${colors.yellow}${stats.modifiedFiles}${colors.reset}`);
  } else {
    console.log(`   Files modified: ${colors.green}${stats.modifiedFiles}${colors.reset}`);
  }
  
  // Console.log analysis breakdown
  console.log(`\n${colors.blue}🔍 CONSOLE.LOG ANALYSIS${colors.reset}`);
  console.log(`   Total console.log statements found: ${colors.cyan}${stats.totalConsoleLogFound}${colors.reset}`);
  console.log(`   Statements processed: ${colors.cyan}${stats.totalConsoleLogProcessed}${colors.reset}`);
  
  // Actions taken breakdown
  console.log(`\n${colors.blue}⚡ ACTIONS TAKEN${colors.reset}`);
  const actionVerb = config.dryRun ? 'would be' : 'were';
  
  if (stats.totalRemoved > 0) {
    console.log(`   ${colors.red}🗑️  Removed: ${stats.totalRemoved} statements ${actionVerb} deleted${colors.reset}`);
  }
  
  if (stats.totalConverted > 0) {
    console.log(`   ${colors.yellow}🔄 Converted: ${stats.totalConverted} statements ${actionVerb} converted${colors.reset}`);
    if (stats.convertedToInfo > 0) {
      console.log(`      ├─ To console.info: ${colors.cyan}${stats.convertedToInfo}${colors.reset}`);
    }
    if (stats.convertedToError > 0) {
      console.log(`      └─ To console.error: ${colors.magenta}${stats.convertedToError}${colors.reset}`);
    }
  }
  
  if (stats.totalKept > 0) {
    console.log(`   ${colors.green}✅ Preserved: ${stats.totalKept} statements ${actionVerb} kept${colors.reset}`);
  }
  
  if (stats.commentedLogsRemoved > 0) {
    console.log(`   ${colors.dim}💬 Commented logs removed: ${stats.commentedLogsRemoved}${colors.reset}`);
  }
  
  // Security improvements section
  if (stats.potentiallySensitive > 0) {
    console.log(`\n${colors.red}🔒 SECURITY IMPROVEMENTS${colors.reset}`);
    console.log(`   Potentially sensitive logs identified: ${colors.red}${stats.potentiallySensitive}${colors.reset}`);
    
    if (stats.sensitiveLogsByRiskLevel.high > 0) {
      console.log(`   ${colors.red}⚠️  HIGH RISK: ${stats.sensitiveLogsByRiskLevel.high} statements${colors.reset}`);
    }
    if (stats.sensitiveLogsByRiskLevel.medium > 0) {
      console.log(`   ${colors.yellow}⚠️  MEDIUM RISK: ${stats.sensitiveLogsByRiskLevel.medium} statements${colors.reset}`);
    }
    if (stats.sensitiveLogsByRiskLevel.low > 0) {
      console.log(`   ${colors.blue}ℹ️  LOW RISK: ${stats.sensitiveLogsByRiskLevel.low} statements${colors.reset}`);
    }
    
    if (stats.sensitiveLogsRemoved > 0) {
      console.log(`   ${colors.green}✅ Sensitive logs removed: ${stats.sensitiveLogsRemoved}${colors.reset}`);
    }
    if (stats.sensitiveLogsKept > 0) {
      console.log(`   ${colors.yellow}⚠️  Sensitive logs remaining: ${stats.sensitiveLogsKept}${colors.reset}`);
    }
  }
  
  // Context-based analysis
  if (stats.consoleLogsInCatchBlocks > 0 || stats.functionalConsoleLogsDetected > 0) {
    console.log(`\n${colors.blue}🧠 INTELLIGENT ANALYSIS${colors.reset}`);
    
    if (stats.functionalConsoleLogsDetected > 0) {
      console.log(`   Functional logs detected: ${colors.cyan}${stats.functionalConsoleLogsDetected}${colors.reset}`);
      console.log(`   Functional logs preserved: ${colors.green}${stats.functionalLogsPreserved}${colors.reset}`);
    }
    
    if (stats.consoleLogsInCatchBlocks > 0) {
      console.log(`   Console.logs in catch blocks: ${colors.cyan}${stats.consoleLogsInCatchBlocks}${colors.reset}`);
    }
    
    if (stats.commentedConsoleLogsFound > 0) {
      console.log(`   Commented console.logs found: ${colors.dim}${stats.commentedConsoleLogsFound}${colors.reset}`);
    }
  }
  
  // Manual mode decision tracking
  if (config.mode === 'manual' && stats.userDecisions.delete + stats.userDecisions.keep + stats.userDecisions.convertInfo + stats.userDecisions.convertError > 0) {
    console.log(`\n${colors.blue}👤 USER DECISIONS (Manual Mode)${colors.reset}`);
    console.log(`   Delete decisions: ${colors.red}${stats.userDecisions.delete}${colors.reset}`);
    console.log(`   Keep decisions: ${colors.green}${stats.userDecisions.keep}${colors.reset}`);
    console.log(`   Convert to info: ${colors.cyan}${stats.userDecisions.convertInfo}${colors.reset}`);
    console.log(`   Convert to error: ${colors.magenta}${stats.userDecisions.convertError}${colors.reset}`);
    if (stats.userDecisions.skip > 0) {
      console.log(`   Skipped: ${colors.dim}${stats.userDecisions.skip}${colors.reset}`);
    }
  }
  
  // Performance metrics
  console.log(`\n${colors.blue}⏱️  PERFORMANCE METRICS${colors.reset}`);
  console.log(`   Processing time: ${colors.cyan}${stats.processingTime}ms${colors.reset}`);
  if (stats.totalFiles > 0) {
    console.log(`   Average time per file: ${colors.cyan}${Math.round(stats.averageTimePerFile)}ms${colors.reset}`);
  }
  
  // Generate recommendations
  const recommendations = generateRecommendations(stats, config);
  if (recommendations.length > 0) {
    console.log(`\n${colors.blue}💡 RECOMMENDATIONS${colors.reset}`);
    recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
  }
  
  // Security summary
  generateSecuritySummary(stats, config, colors);
  
  // Final status
  console.log(`\n${colors.blue}${'='.repeat(60)}${colors.reset}`);
  if (config.dryRun) {
    console.log(`${colors.yellow}🔍 DRY RUN COMPLETE - No files were modified${colors.reset}`);
    if (stats.totalRemoved > 0 || stats.totalConverted > 0) {
      console.log(`${colors.blue}Run without --dry-run to apply these changes${colors.reset}`);
    }
  } else if (stats.totalRemoved === 0 && stats.totalConverted === 0) {
    console.log(`${colors.green}✅ CLEANUP COMPLETE - No unnecessary console.log statements found!${colors.reset}`);
  } else {
    console.log(`${colors.green}✅ CLEANUP COMPLETE - Codebase successfully cleaned!${colors.reset}`);
  }
  console.log(`${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
}

/**
 * Generate intelligent recommendations based on analysis results
 * @param {Object} stats - Statistics object
 * @param {Object} config - Configuration object
 * @returns {Array<string>} Array of recommendation strings
 */
function generateRecommendations(stats, config) {
  const recommendations = [];
  
  // Security recommendations
  if (stats.sensitiveLogsKept > 0) {
    if (stats.sensitiveLogsByRiskLevel.high > 0) {
      recommendations.push(`${colors.red}URGENT: Review ${stats.sensitiveLogsByRiskLevel.high} high-risk console.log statements that may expose credentials${colors.reset}`);
    }
    if (stats.sensitiveLogsByRiskLevel.medium > 0) {
      recommendations.push(`${colors.yellow}Review ${stats.sensitiveLogsByRiskLevel.medium} medium-risk console.log statements for privacy concerns${colors.reset}`);
    }
    recommendations.push(`${colors.blue}Consider implementing a logging framework with proper log levels${colors.reset}`);
  }
  
  // Functional logging recommendations
  if (stats.functionalLogsPreserved > 0) {
    recommendations.push(`${colors.green}Consider converting ${stats.functionalLogsPreserved} functional console.log statements to appropriate log levels (info, warn, error)${colors.reset}`);
  }
  
  // Catch block recommendations
  if (stats.consoleLogsInCatchBlocks > 0) {
    const unconverted = stats.consoleLogsInCatchBlocks - (stats.convertedToError || 0);
    if (unconverted > 0) {
      recommendations.push(`${colors.yellow}Convert remaining ${unconverted} console.log statements in catch blocks to console.error${colors.reset}`);
    }
  }
  
  // Mode-specific recommendations
  if (config.mode === 'auto' && stats.functionalLogsPreserved > 0) {
    recommendations.push(`${colors.blue}Run in manual mode to review ${stats.functionalLogsPreserved} preserved statements individually${colors.reset}`);
  }
  
  // Performance recommendations
  if (stats.totalFiles > 100 && stats.averageTimePerFile > 50) {
    recommendations.push(`${colors.blue}Consider using exclusion patterns to skip non-essential directories for better performance${colors.reset}`);
  }
  
  // Best practices
  if (stats.totalRemoved > 0 || stats.totalConverted > 0) {
    recommendations.push(`${colors.green}Set up pre-commit hooks to prevent console.log statements from entering the codebase${colors.reset}`);
    recommendations.push(`${colors.blue}Consider using a linting rule to catch console.log statements during development${colors.reset}`);
  }
  
  return recommendations;
}

/**
 * Generate security-focused summary and improvements made
 * @param {Object} stats - Statistics object
 * @param {Object} config - Configuration object
 * @param {Object} colors - Color constants
 */
function generateSecuritySummary(stats, config, colors) {
  if (stats.potentiallySensitive === 0 && stats.totalRemoved === 0) {
    return; // No security improvements to report
  }
  
  console.log(`\n${colors.green}🛡️  SECURITY IMPROVEMENTS SUMMARY${colors.reset}`);
  
  const improvements = [];
  
  if (stats.sensitiveLogsRemoved > 0) {
    improvements.push(`Removed ${stats.sensitiveLogsRemoved} potentially sensitive console.log statements`);
  }
  
  if (stats.totalRemoved > 0) {
    improvements.push(`Eliminated ${stats.totalRemoved} debugging console.log statements that could leak information`);
  }
  
  if (stats.commentedLogsRemoved > 0) {
    improvements.push(`Cleaned up ${stats.commentedLogsRemoved} commented console.log statements`);
  }
  
  if (stats.convertedToError > 0) {
    improvements.push(`Converted ${stats.convertedToError} console.log statements to proper error logging`);
  }
  
  if (improvements.length > 0) {
    improvements.forEach((improvement, index) => {
      console.log(`   ${colors.green}✓${colors.reset} ${improvement}`);
    });
    
    console.log(`\n   ${colors.green}🎯 Security Impact:${colors.reset}`);
    console.log(`   • Reduced risk of credential exposure in logs`);
    console.log(`   • Improved error handling and debugging practices`);
    console.log(`   • Cleaner codebase with better maintainability`);
    
    if (stats.sensitiveLogsKept > 0) {
      console.log(`\n   ${colors.yellow}⚠️  Action Required:${colors.reset}`);
      console.log(`   • ${stats.sensitiveLogsKept} potentially sensitive logs still remain`);
      console.log(`   • Manual review recommended for remaining sensitive statements`);
      console.log(`   • Consider implementing proper secret management practices`);
    }
  }
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

// Legacy processFile function - now delegates to ModeController
async function processFile(filePath, modeController) {
  try {
    const content = await readFile(filePath, 'utf8');
    
    if (!content.includes('console.log')) {
      if (config.verbose) {
        console.log(`${colors.yellow}  No console.log statements found in ${filePath}${colors.reset}`);
      }
      return 0;
    }

    // Track that this file has console.log statements
    stats.filesWithConsoleLog++;

    // Use ModeController to process the file
    const result = await modeController.processFile(filePath, content);
    
    // Update enhanced global statistics from the result
    stats.totalConsoleLogFound += result.statistics.consoleLogsFound;
    stats.totalConsoleLogProcessed += result.statistics.consoleLogsProcessed || result.statistics.consoleLogsFound;
    stats.potentiallySensitive += result.statistics.potentiallySensitive;
    stats.commentedLogsRemoved += result.statistics.commentedLogsRemoved;
    stats.totalConverted += result.statistics.consoleLogsConverted;
    stats.totalRemoved += result.statistics.consoleLogsRemoved;
    
    // Track security-related statistics
    if (result.statistics.sensitiveLogsProcessed) {
      stats.sensitiveLogsRemoved += result.statistics.sensitiveLogsRemoved || 0;
      stats.sensitiveLogsKept += result.statistics.sensitiveLogsKept || 0;
      
      // Track by risk level
      if (result.statistics.sensitiveLogsByRisk) {
        stats.sensitiveLogsByRiskLevel.high += result.statistics.sensitiveLogsByRisk.high || 0;
        stats.sensitiveLogsByRiskLevel.medium += result.statistics.sensitiveLogsByRisk.medium || 0;
        stats.sensitiveLogsByRiskLevel.low += result.statistics.sensitiveLogsByRisk.low || 0;
      }
    }
    
    // Track context-based statistics
    stats.consoleLogsInCatchBlocks += result.statistics.catchBlockLogsFound || 0;
    stats.functionalConsoleLogsDetected += result.statistics.functionalLogsDetected || 0;
    stats.commentedConsoleLogsFound += result.statistics.commentedLogsFound || 0;
    
    // Handle file writing and statistics
    if (result.modified) {
      if (!config.dryRun) {
        await writeFile(filePath, result.newContent);
        console.log(`${colors.green}Modified ${filePath}: processed ${result.statistics.consoleLogsFound} console.log statements${colors.reset}`);
      } else {
        console.log(`${colors.yellow}Would modify ${filePath}: ${result.statistics.consoleLogsFound} console.log statements${colors.reset}`);
      }
      
      return result.statistics.consoleLogsRemoved + result.statistics.consoleLogsConverted;
    }
    
    return 0;
  } catch (error) {
    console.error(`${colors.red}Error processing ${filePath}: ${error.message}${colors.reset}`);
    return 0;
  }
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
  let modeController = null;
  let sessionValid = true;
  
  try {
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
    } else {
      console.log(`${colors.blue}Backup system enabled - files will be backed up before modification${colors.reset}`);
    }
    
    if (config.interactive && config.mode === 'manual') {
      console.log(`${colors.blue}Interactive mode enabled${colors.reset}`);
    }
    
    if (config.enhancedReporting) {
      console.log(`${colors.blue}Enhanced reporting enabled${colors.reset}`);
    }

    // Initialize ModeController with current configuration
    modeController = new ModeController(config, colors);

    // Find all JavaScript/TypeScript files
    const files = await findFiles(config.startDir);

    console.log(`${colors.blue}Found ${files.length} JavaScript/TypeScript files${colors.reset}`);

    if (files.length === 0) {
      console.log(`${colors.yellow}No JavaScript/TypeScript files found${colors.reset}`);
      return;
    }

    // Process each file using ModeController with comprehensive error handling
    let processedFiles = 0;
    let errorCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      stats.totalFiles++;

      if (config.verbose || (stats.totalFiles % 50 === 0)) {
        console.log(`${colors.blue}Processing file ${stats.totalFiles}/${files.length}: ${file}${colors.reset}`);
      }

      try {
        const removedCount = await processFile(file, modeController);

        if (removedCount > 0) {
          stats.modifiedFiles++;
          stats.totalRemoved += removedCount;
        }
        
        processedFiles++;
        
      } catch (error) {
        errorCount++;
        console.error(`${colors.red}Failed to process ${file}: ${error.message}${colors.reset}`);
        
        // Check if we should continue or abort
        if (errorCount > files.length * 0.1) { // More than 10% failure rate
          console.error(`${colors.red}High error rate detected (${errorCount}/${i + 1} files failed). Aborting operation.${colors.reset}`);
          sessionValid = false;
          break;
        }
        
        if (config.verbose) {
          console.log(`${colors.yellow}Continuing with remaining files...${colors.reset}`);
        }
      }
    }
    
    console.log(`${colors.blue}Processing completed: ${processedFiles}/${files.length} files processed successfully${colors.reset}`);
    
    if (errorCount > 0) {
      console.log(`${colors.yellow}${errorCount} files encountered errors during processing${colors.reset}`);
    }

    // Get comprehensive session statistics from ModeController
    if (modeController) {
      const sessionStats = modeController.getSessionStats();
      
      // Update global stats with enhanced session data
      stats.totalKept = sessionStats.kept;
      stats.convertedToInfo = sessionStats.convertedToInfo;
      stats.convertedToError = sessionStats.convertedToError;
      stats.functionalLogsPreserved = sessionStats.functionalLogsPreserved;
      
      // Update user decision tracking for manual mode
      if (config.mode === 'manual') {
        stats.userDecisions.delete = sessionStats.deleted;
        stats.userDecisions.keep = sessionStats.kept;
        stats.userDecisions.convertInfo = sessionStats.convertedToInfo;
        stats.userDecisions.convertError = sessionStats.convertedToError;
        stats.userDecisions.skip = sessionStats.skipped;
      }
      
      // Calculate averages and derived statistics
      stats.averageTimePerFile = stats.totalFiles > 0 ? stats.processingTime / stats.totalFiles : 0;
    }

  } catch (error) {
    console.error(`${colors.red}Critical error during processing: ${error.message}${colors.reset}`);
    sessionValid = false;
    
    // Generate error report if possible
    if (modeController) {
      try {
        await modeController.generateErrorReport();
      } catch (reportError) {
        console.error(`${colors.red}Failed to generate error report: ${reportError.message}${colors.reset}`);
      }
    }
    
    throw error;
    
  } finally {
    // Always cleanup ModeController resources and handle backups
    if (modeController) {
      try {
        // Validate session integrity
        const validation = await modeController.validateSession();
        
        if (!validation.valid) {
          console.log(`${colors.yellow}Session validation warnings detected${colors.reset}`);
          
          if (validation.recommendations.length > 0) {
            console.log(`${colors.yellow}Recommendations:${colors.reset}`);
            validation.recommendations.forEach(rec => {
              console.log(`  ${colors.yellow}- ${rec}${colors.reset}`);
            });
          }
          
          // Ask user if they want to rollback in case of validation issues
          if (!config.dryRun && !sessionValid && config.interactive) {
            console.log(`${colors.red}Session validation failed. Consider rolling back changes.${colors.reset}`);
            // In a real implementation, you might want to prompt the user here
          }
        }
        
        // Cleanup resources
        await modeController.cleanup();
        
      } catch (cleanupError) {
        console.error(`${colors.red}Error during cleanup: ${cleanupError.message}${colors.reset}`);
      }
    }
  }

  // Calculate processing time
  stats.processingTime = Date.now() - startTime;

  // Display ModeController session summary if in manual mode
  if (modeController && config.mode === 'manual' && config.interactive) {
    modeController.displaySessionSummary();
  }

  // Generate comprehensive summary report
  generateSummaryReport(stats, config, colors);

  if (stats.totalRemoved > 0 && config.dryRun) {
    console.log(`${colors.yellow}Run without --dry-run to actually remove the console.log statements${colors.reset}`);
  } else if (stats.totalRemoved === 0) {
    console.log(`${colors.green}No unnecessary console.log statements found!${colors.reset}`);
  }
  
  // Display backup information if backups were created
  if (!config.dryRun && modeController && stats.modifiedFiles > 0) {
    const sessionInfo = modeController.getSessionInfo();
    if (sessionInfo.backups.totalBackups > 0) {
      console.log(`${colors.blue}Backup information:${colors.reset}`);
      console.log(`  ${colors.cyan}${sessionInfo.backups.totalBackups} files backed up${colors.reset}`);
      console.log(`  ${colors.cyan}Backup directory: ${sessionInfo.backups.backupDir}${colors.reset}`);
      
      if (sessionValid) {
        console.log(`${colors.green}All operations completed successfully. Backups will be cleaned up automatically.${colors.reset}`);
      } else {
        console.log(`${colors.yellow}Some operations failed. Backups are preserved for manual recovery.${colors.reset}`);
        console.log(`${colors.yellow}Use the backup directory to manually restore files if needed.${colors.reset}`);
      }
    }
  }
}

// Run the script
main().catch(error => {
  console.error(`${colors.red}Script failed: ${error.message}${colors.reset}`);
  process.exit(1);
});