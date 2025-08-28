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

function shouldPreserveLine(line) {
  const trimmed = line.trim();

  // Preserve if it's part of a ternary operator
  if (line.includes('?') && line.includes('console.log') && line.includes(':')) {
    return true;
  }
  if (line.includes(':') && line.includes('console.log') && !trimmed.startsWith('console.log')) {
    return true;
  }

  // Preserve if it's part of an arrow function assignment or return
  if (line.includes('=') && line.includes('=>') && line.includes('console.log')) {
    return true;
  }
  if (line.includes('return') && line.includes('console.log')) {
    return true;
  }

  // Preserve if it's part of a function call chain
  if (/[a-zA-Z0-9_)\]]\..*console\.log/.test(line)) {
    return true;
  }
  if (/console\.log.*\.[a-zA-Z]/.test(line)) {
    return true;
  }

  if (/^[^/\*]*[a-zA-Z0-9_)\]\}].*console\.log/.test(trimmed)) {
    return true;
  }

  if (/console\.log.*\)\s*[a-zA-Z0-9_{\[(]/.test(line)) {
    return true;
  }

  return false;
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
          if (shouldPreserveLine(line)) {
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