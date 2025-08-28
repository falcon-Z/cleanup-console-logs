const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const BackupManager = require('../lib/BackupManager');

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);
const stat = promisify(fs.stat);

describe('BackupManager', function() {
  let backupManager;
  let testFile;
  let testContent;
  
  beforeEach(async function() {
    // Create a test file
    testFile = path.join(__dirname, 'test-backup-file.js');
    testContent = 'console.log("test content");';
    await writeFile(testFile, testContent, 'utf8');
    
    // Initialize backup manager with test configuration
    backupManager = new BackupManager({
      backupDir: path.join(__dirname, 'test-backups'),
      autoCleanup: false // Don't auto-cleanup during tests
    });
  });
  
  afterEach(async function() {
    // Cleanup test file
    try {
      await unlink(testFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
    
    // Cleanup backup directory
    try {
      await backupManager.cleanupBackups(true); // Force cleanup
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('createBackup', function() {
    it('should create a backup of an existing file', async function() {
      const backupPath = await backupManager.createBackup(testFile);
      
      // Verify backup file exists
      const backupExists = await fileExists(backupPath);
      assert.strictEqual(backupExists, true, 'Backup file should exist');
      
      // Verify backup content matches original
      const backupContent = await readFile(backupPath, 'utf8');
      assert.strictEqual(backupContent, testContent, 'Backup content should match original');
    });
    
    it('should throw error for non-existent file', async function() {
      const nonExistentFile = path.join(__dirname, 'non-existent.js');
      
      try {
        await backupManager.createBackup(nonExistentFile);
        assert.fail('Should have thrown an error for non-existent file');
      } catch (error) {
        assert(error.message.includes('does not exist'), 'Error should mention file does not exist');
      }
    });
    
    it('should track backed up files', async function() {
      await backupManager.createBackup(testFile);
      
      const sessionInfo = backupManager.getSessionInfo();
      assert.strictEqual(sessionInfo.totalBackups, 1, 'Should track one backup');
      assert(sessionInfo.backedUpFiles.includes(testFile), 'Should track the backed up file');
    });
  });

  describe('restoreFromBackup', function() {
    it('should restore a file from its backup', async function() {
      // Create backup
      await backupManager.createBackup(testFile);
      
      // Modify original file
      const modifiedContent = 'console.info("modified content");';
      await writeFile(testFile, modifiedContent, 'utf8');
      
      // Restore from backup
      const restored = await backupManager.restoreFromBackup(testFile);
      assert.strictEqual(restored, true, 'Restore should succeed');
      
      // Verify content is restored
      const restoredContent = await readFile(testFile, 'utf8');
      assert.strictEqual(restoredContent, testContent, 'Content should be restored to original');
    });
    
    it('should throw error for file without backup', async function() {
      const fileWithoutBackup = path.join(__dirname, 'no-backup.js');
      
      try {
        await backupManager.restoreFromBackup(fileWithoutBackup);
        assert.fail('Should have thrown an error for file without backup');
      } catch (error) {
        assert(error.message.includes('No backup found'), 'Error should mention no backup found');
      }
    });
  });

  describe('validateBackups', function() {
    it('should validate existing backups', async function() {
      await backupManager.createBackup(testFile);
      
      const validation = await backupManager.validateBackups();
      assert.strictEqual(validation.valid, true, 'Validation should pass for valid backup');
      assert.strictEqual(validation.validBackups, 1, 'Should have one valid backup');
      assert.strictEqual(validation.missingBackups.length, 0, 'Should have no missing backups');
    });
    
    it('should detect missing backups', async function() {
      // Create backup then delete it manually
      const backupPath = await backupManager.createBackup(testFile);
      await unlink(backupPath);
      
      const validation = await backupManager.validateBackups();
      assert.strictEqual(validation.valid, false, 'Validation should fail for missing backup');
      assert.strictEqual(validation.missingBackups.length, 1, 'Should detect one missing backup');
    });
  });

  describe('rollbackSession', function() {
    it('should rollback all files in session', async function() {
      // Create backup
      await backupManager.createBackup(testFile);
      
      // Modify original file
      const modifiedContent = 'console.error("rollback test");';
      await writeFile(testFile, modifiedContent, 'utf8');
      
      // Rollback session
      const rollbackResult = await backupManager.rollbackSession();
      
      assert.strictEqual(rollbackResult.successful.length, 1, 'Should successfully rollback one file');
      assert.strictEqual(rollbackResult.failed.length, 0, 'Should have no failed rollbacks');
      
      // Verify content is restored
      const restoredContent = await readFile(testFile, 'utf8');
      assert.strictEqual(restoredContent, testContent, 'Content should be rolled back to original');
    });
  });

  describe('cleanupBackups', function() {
    it('should cleanup backup files', async function() {
      const backupPath = await backupManager.createBackup(testFile);
      
      // Verify backup exists before cleanup
      const backupExistsBefore = await fileExists(backupPath);
      assert.strictEqual(backupExistsBefore, true, 'Backup should exist before cleanup');
      
      // Cleanup backups
      const cleanupResult = await backupManager.cleanupBackups(true); // Force cleanup
      
      assert.strictEqual(cleanupResult.cleaned.length, 1, 'Should cleanup one backup');
      assert.strictEqual(cleanupResult.failed.length, 0, 'Should have no failed cleanups');
      
      // Verify backup is removed
      const backupExistsAfter = await fileExists(backupPath);
      assert.strictEqual(backupExistsAfter, false, 'Backup should be removed after cleanup');
    });
  });

  describe('getBackupStats', function() {
    it('should provide accurate backup statistics', async function() {
      await backupManager.createBackup(testFile);
      
      const stats = await backupManager.getBackupStats();
      
      assert.strictEqual(stats.totalFiles, 1, 'Should report one backed up file');
      assert(stats.totalSize > 0, 'Should report positive total size');
      assert.strictEqual(stats.operations.backups, 1, 'Should report one backup operation');
    });
  });
});

// Helper function to check if file exists
async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    return false;
  }
}