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
  dryRun: false,
  verbose: false,
  startDir: process.cwd()
};

// Counters
let stats = {
  totalFiles: 0,
  modifiedFiles: 0,
  totalRemoved: 0
};

function showUsage() {
  console.log(`Usage: node ${path.basename(__filename)} [OPTIONS]`);
  console.log('This script removes unnecessary console.log statements that are:');
  console.log('  - Commented out (// console.log or /* console.log)');
  console.log('It preserves console.log statements that are:');
}

function parseArgs() {
  const args = process.argv.slice(2);

  for (const arg of args) {
    switch (arg) {
      case '-d':
      case '--dry-run':
        config.dryRun = true;
        break;
      case '-v':
      case '--verbose':
        config.verbose = true;
        break;
      case '-h':
      case '--help':
        showUsage();
        process.exit(0);
        break;
      default:
        showUsage();
        process.exit(1);
    }
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

      const newLines = [];
      let removedCount = 0;
      let fileModified = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;

        // Check if this line contains console.log (excluding error-related)
        if (line.includes('console.log') && !line.toLowerCase().includes('err')) {
          const trimmed = line.trim();

          if (trimmed.startsWith('//') && trimmed.includes('console.log')) {
            if (config.dryRun) {
              console.log(`${colors.red}  Would remove line ${lineNumber}: ${colors.reset}${line}`);
            } else if (config.verbose) {
              console.log(`${colors.red}  Removing line ${lineNumber}: ${colors.reset}${line}`);
            }
            removedCount++;
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
            fileModified = true;
            continue;
          }

          // Check if it should be preserved based on context
          if (shouldPreserveLine(line)) {
            if (config.verbose) {
              console.log(`${colors.green}  Preserving line ${lineNumber}: ${colors.reset}${line}`);
            }
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
  parseArgs();

  console.log(`${colors.blue}Starting console.log cleanup...${colors.reset}`);
  if (config.dryRun) {
    console.log(`${colors.yellow}DRY RUN MODE - No files will be modified${colors.reset}`);
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

  // Summary
  console.log(`${colors.blue}=== Summary ===${colors.reset}`);
  console.log(`Files scanned: ${stats.totalFiles}`);

  if (config.dryRun) {
    console.log(`Files that would be modified: ${stats.modifiedFiles}`);
    console.log(`Console.log statements that would be removed: ${stats.totalRemoved}`);
  } else {
    console.log(`Files modified: ${stats.modifiedFiles}`);
    console.log(`Console.log statements removed: ${stats.totalRemoved}`);
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