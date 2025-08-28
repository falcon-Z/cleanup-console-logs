const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);

/**
 * BackupManager class for handling file backup functionality
 * Creates backup system before modifying files in both manual and auto modes
 * Provides rollback capability for batch operations
 * Implements backup cleanup after successful operations
 */
class BackupManager {
  constructor(config = {}) {
    this.config = {
      backupDir: config.backupDir || '.console-log-cleanup-backups',
      maxBackups: config.maxBackups || 10,
      autoCleanup: config.autoCleanup !== false, // Default to true
      timestampFormat: config.timestampFormat || 'YYYY-MM-DD_HH-mm-ss',
      ...config
    };
    
    // Track backup operations
    this.backupSession = {
      sessionId: this._generateSessionId(),
      backupDir: null,
      backedUpFiles: new Map(), // filePath -> backupPath
      createdAt: new Date(),
      operations: []
    };
    
    // Initialize backup directory
    this._initializeBackupDirectory();
  }

  /**
   * Create a backup of a file before modification
   * @param {string} filePath - Path to the file to backup
   * @returns {Promise<string>} Path to the backup file
   */
  async createBackup(filePath) {
    try {
      // Validate input
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path provided for backup');
      }

      // Check if file exists
      const fileExists = await this._fileExists(filePath);
      if (!fileExists) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Generate backup path
      const backupPath = await this._generateBackupPath(filePath);
      
      // Ensure backup directory exists
      await this._ensureBackupDirectory(path.dirname(backupPath));
      
      // Read original file content
      const originalContent = await readFile(filePath, 'utf8');
      
      // Write backup file
      await writeFile(backupPath, originalContent, 'utf8');
      
      // Track the backup
      this.backupSession.backedUpFiles.set(filePath, backupPath);
      this.backupSession.operations.push({
        type: 'backup',
        filePath,
        backupPath,
        timestamp: new Date(),
        size: originalContent.length
      });
      
      return backupPath;
      
    } catch (error) {
      throw new Error(`Failed to create backup for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Create backups for multiple files
   * @param {Array<string>} filePaths - Array of file paths to backup
   * @returns {Promise<Map>} Map of filePath -> backupPath
   */
  async createBatchBackup(filePaths) {
    const backupResults = new Map();
    const errors = [];
    
    for (const filePath of filePaths) {
      try {
        const backupPath = await this.createBackup(filePath);
        backupResults.set(filePath, backupPath);
      } catch (error) {
        errors.push({ filePath, error: error.message });
      }
    }
    
    if (errors.length > 0) {
      const errorMessage = errors.map(e => `${e.filePath}: ${e.error}`).join('; ');
      throw new Error(`Batch backup failed for some files: ${errorMessage}`);
    }
    
    return backupResults;
  }

  /**
   * Restore a file from its backup
   * @param {string} filePath - Path to the file to restore
   * @returns {Promise<boolean>} True if restoration was successful
   */
  async restoreFromBackup(filePath) {
    try {
      const backupPath = this.backupSession.backedUpFiles.get(filePath);
      
      if (!backupPath) {
        throw new Error(`No backup found for file: ${filePath}`);
      }
      
      // Check if backup file exists
      const backupExists = await this._fileExists(backupPath);
      if (!backupExists) {
        throw new Error(`Backup file does not exist: ${backupPath}`);
      }
      
      // Read backup content
      const backupContent = await readFile(backupPath, 'utf8');
      
      // Restore original file
      await writeFile(filePath, backupContent, 'utf8');
      
      // Track the restoration
      this.backupSession.operations.push({
        type: 'restore',
        filePath,
        backupPath,
        timestamp: new Date()
      });
      
      return true;
      
    } catch (error) {
      throw new Error(`Failed to restore ${filePath}: ${error.message}`);
    }
  }

  /**
   * Restore multiple files from their backups
   * @param {Array<string>} filePaths - Array of file paths to restore
   * @returns {Promise<Object>} Result with successful and failed restorations
   */
  async restoreBatchFromBackup(filePaths) {
    const results = {
      successful: [],
      failed: []
    };
    
    for (const filePath of filePaths) {
      try {
        await this.restoreFromBackup(filePath);
        results.successful.push(filePath);
      } catch (error) {
        results.failed.push({ filePath, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Rollback all files in the current session
   * @returns {Promise<Object>} Rollback result with statistics
   */
  async rollbackSession() {
    const rollbackResult = {
      totalFiles: this.backupSession.backedUpFiles.size,
      successful: [],
      failed: [],
      startTime: new Date()
    };
    
    try {
      // Restore all backed up files
      for (const [filePath, backupPath] of this.backupSession.backedUpFiles) {
        try {
          await this.restoreFromBackup(filePath);
          rollbackResult.successful.push(filePath);
        } catch (error) {
          rollbackResult.failed.push({ filePath, error: error.message });
        }
      }
      
      rollbackResult.endTime = new Date();
      rollbackResult.duration = rollbackResult.endTime - rollbackResult.startTime;
      
      // Track rollback operation
      this.backupSession.operations.push({
        type: 'rollback',
        timestamp: new Date(),
        result: rollbackResult
      });
      
      return rollbackResult;
      
    } catch (error) {
      throw new Error(`Rollback session failed: ${error.message}`);
    }
  }

  /**
   * Clean up backup files after successful operations
   * @param {boolean} force - Force cleanup even if operations failed
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupBackups(force = false) {
    const cleanupResult = {
      totalBackups: this.backupSession.backedUpFiles.size,
      cleaned: [],
      failed: [],
      bytesFreed: 0
    };
    
    try {
      // Only cleanup if no failed operations (unless forced)
      const hasFailures = this.backupSession.operations.some(op => op.error);
      if (hasFailures && !force) {
        throw new Error('Cannot cleanup backups: session has failures. Use force=true to override.');
      }
      
      // Remove backup files
      for (const [filePath, backupPath] of this.backupSession.backedUpFiles) {
        try {
          // Get file size before deletion
          const stats = await stat(backupPath);
          const fileSize = stats.size;
          
          // Delete backup file
          await unlink(backupPath);
          
          cleanupResult.cleaned.push(backupPath);
          cleanupResult.bytesFreed += fileSize;
          
        } catch (error) {
          cleanupResult.failed.push({ backupPath, error: error.message });
        }
      }
      
      // Try to remove empty backup directories
      await this._cleanupEmptyDirectories();
      
      // Track cleanup operation
      this.backupSession.operations.push({
        type: 'cleanup',
        timestamp: new Date(),
        result: cleanupResult
      });
      
      return cleanupResult;
      
    } catch (error) {
      throw new Error(`Backup cleanup failed: ${error.message}`);
    }
  }

  /**
   * Get information about the current backup session
   * @returns {Object} Session information
   */
  getSessionInfo() {
    return {
      sessionId: this.backupSession.sessionId,
      backupDir: this.backupSession.backupDir,
      createdAt: this.backupSession.createdAt,
      totalBackups: this.backupSession.backedUpFiles.size,
      operations: this.backupSession.operations.length,
      backedUpFiles: Array.from(this.backupSession.backedUpFiles.keys())
    };
  }

  /**
   * List all backup files in the current session
   * @returns {Array<Object>} Array of backup file information
   */
  async listBackups() {
    const backups = [];
    
    for (const [filePath, backupPath] of this.backupSession.backedUpFiles) {
      try {
        const stats = await stat(backupPath);
        backups.push({
          originalFile: filePath,
          backupFile: backupPath,
          size: stats.size,
          created: stats.mtime,
          exists: true
        });
      } catch (error) {
        backups.push({
          originalFile: filePath,
          backupFile: backupPath,
          size: 0,
          created: null,
          exists: false,
          error: error.message
        });
      }
    }
    
    return backups;
  }

  /**
   * Validate backup integrity
   * @returns {Promise<Object>} Validation result
   */
  async validateBackups() {
    const validation = {
      valid: true,
      totalBackups: this.backupSession.backedUpFiles.size,
      validBackups: 0,
      invalidBackups: [],
      missingBackups: [],
      corruptedBackups: []
    };
    
    for (const [filePath, backupPath] of this.backupSession.backedUpFiles) {
      try {
        // Check if backup file exists
        const backupExists = await this._fileExists(backupPath);
        if (!backupExists) {
          validation.missingBackups.push({ filePath, backupPath });
          validation.valid = false;
          continue;
        }
        
        // Check if backup is readable
        try {
          await readFile(backupPath, 'utf8');
          validation.validBackups++;
        } catch (error) {
          validation.corruptedBackups.push({ filePath, backupPath, error: error.message });
          validation.valid = false;
        }
        
      } catch (error) {
        validation.invalidBackups.push({ filePath, backupPath, error: error.message });
        validation.valid = false;
      }
    }
    
    return validation;
  }

  /**
   * Get backup statistics
   * @returns {Promise<Object>} Backup statistics
   */
  async getBackupStats() {
    const stats = {
      sessionId: this.backupSession.sessionId,
      totalFiles: this.backupSession.backedUpFiles.size,
      totalSize: 0,
      operations: {
        backups: 0,
        restores: 0,
        rollbacks: 0,
        cleanups: 0
      },
      errors: 0
    };
    
    // Calculate total backup size
    for (const [filePath, backupPath] of this.backupSession.backedUpFiles) {
      try {
        const fileStats = await stat(backupPath);
        stats.totalSize += fileStats.size;
      } catch (error) {
        stats.errors++;
      }
    }
    
    // Count operations by type
    for (const operation of this.backupSession.operations) {
      if (stats.operations.hasOwnProperty(operation.type + 's')) {
        stats.operations[operation.type + 's']++;
      }
      if (operation.error) {
        stats.errors++;
      }
    }
    
    return stats;
  }

  // Private helper methods

  /**
   * Generate a unique session ID
   * @returns {string} Session ID
   */
  _generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `backup-${timestamp}-${random}`;
  }

  /**
   * Initialize the backup directory structure
   */
  async _initializeBackupDirectory() {
    try {
      const baseBackupDir = path.resolve(this.config.backupDir);
      const sessionBackupDir = path.join(baseBackupDir, this.backupSession.sessionId);
      
      await this._ensureBackupDirectory(sessionBackupDir);
      this.backupSession.backupDir = sessionBackupDir;
      
    } catch (error) {
      throw new Error(`Failed to initialize backup directory: ${error.message}`);
    }
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param {string} dirPath - Directory path to ensure
   */
  async _ensureBackupDirectory(dirPath) {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Generate a backup path for a given file
   * @param {string} filePath - Original file path
   * @returns {string} Backup file path
   */
  async _generateBackupPath(filePath) {
    const relativePath = path.relative(process.cwd(), filePath);
    const normalizedPath = relativePath.replace(/\.\./g, 'parent').replace(/[<>:"|?*]/g, '_');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${path.basename(normalizedPath)}.${timestamp}.backup`;
    const backupDir = path.join(this.backupSession.backupDir, path.dirname(normalizedPath));
    
    return path.join(backupDir, backupFileName);
  }

  /**
   * Check if a file exists
   * @param {string} filePath - File path to check
   * @returns {Promise<boolean>} True if file exists
   */
  async _fileExists(filePath) {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up empty backup directories
   */
  async _cleanupEmptyDirectories() {
    try {
      await this._removeEmptyDirsRecursive(this.backupSession.backupDir);
    } catch (error) {
      // Ignore errors during directory cleanup
    }
  }

  /**
   * Recursively remove empty directories
   * @param {string} dirPath - Directory path to check
   */
  async _removeEmptyDirsRecursive(dirPath) {
    try {
      const entries = await readdir(dirPath);
      
      // Recursively process subdirectories
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        const stats = await stat(entryPath);
        
        if (stats.isDirectory()) {
          await this._removeEmptyDirsRecursive(entryPath);
        }
      }
      
      // Check if directory is now empty
      const remainingEntries = await readdir(dirPath);
      if (remainingEntries.length === 0 && dirPath !== this.config.backupDir) {
        await rmdir(dirPath);
      }
      
    } catch (error) {
      // Ignore errors - directory might not be empty or might not exist
    }
  }
}

module.exports = BackupManager;