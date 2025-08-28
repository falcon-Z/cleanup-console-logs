const assert = require('assert');
const ErrorHandler = require('../lib/ErrorHandler');

describe('ErrorHandler', function() {
  let errorHandler;
  
  beforeEach(function() {
    errorHandler = new ErrorHandler({
      logErrors: false, // Don't log to file during tests
      verbose: false
    });
  });

  describe('handleFileSystemError', function() {
    it('should handle ENOENT error with skip recovery', function() {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      const result = errorHandler.handleFileSystemError(error, '/test/file.js', 'read');
      
      assert.strictEqual(result.category, 'file_system');
      assert.strictEqual(result.recoverable, true);
      assert.strictEqual(result.recovery, 'skip_file');
      assert(result.message.includes('File not found'));
    });
    
    it('should handle EACCES error with skip recovery', function() {
      const error = new Error('Permission denied');
      error.code = 'EACCES';
      
      const result = errorHandler.handleFileSystemError(error, '/test/file.js', 'write');
      
      assert.strictEqual(result.category, 'file_system');
      assert.strictEqual(result.recoverable, true);
      assert.strictEqual(result.recovery, 'skip_file');
      assert(result.message.includes('Permission denied'));
    });
    
    it('should handle ENOSPC error as non-recoverable', function() {
      const error = new Error('No space left on device');
      error.code = 'ENOSPC';
      
      const result = errorHandler.handleFileSystemError(error, '/test/file.js', 'write');
      
      assert.strictEqual(result.category, 'file_system');
      assert.strictEqual(result.recoverable, false);
      assert.strictEqual(result.recovery, 'abort');
      assert(result.message.includes('No space left'));
    });
  });

  describe('handleParsingError', function() {
    it('should handle syntax errors with skip recovery', function() {
      const error = new Error('Unexpected token');
      
      const result = errorHandler.handleParsingError(error, '/test/file.js', 10, 'console.log(');
      
      assert.strictEqual(result.category, 'parsing');
      assert.strictEqual(result.type, 'unexpected_token');
      assert.strictEqual(result.recoverable, true);
      assert.strictEqual(result.recovery, 'skip_file');
      assert.strictEqual(result.lineNumber, 10);
    });
  });

  describe('handleUserInputError', function() {
    it('should handle invalid choice with suggestions', function() {
      const result = errorHandler.handleUserInputError('invalid', 'choice', ['delete', 'keep', 'convert']);
      
      assert.strictEqual(result.category, 'user_input');
      assert.strictEqual(result.recoverable, true);
      assert.strictEqual(result.recovery, 'prompt_again');
      assert(result.suggestions.length > 0);
    });
  });

  describe('validateUserInput', function() {
    it('should validate valid choice input', function() {
      const validation = errorHandler.validateUserInput('delete', 'choice', {
        validChoices: ['delete', 'keep', 'convert']
      });
      
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.sanitized, 'delete');
      assert.strictEqual(validation.errors.length, 0);
    });
    
    it('should reject invalid choice input', function() {
      const validation = errorHandler.validateUserInput('invalid', 'choice', {
        validChoices: ['delete', 'keep', 'convert']
      });
      
      assert.strictEqual(validation.valid, false);
      assert(validation.errors.length > 0);
      assert(validation.errors[0].includes('Invalid choice'));
    });
    
    it('should validate number input', function() {
      const validation = errorHandler.validateUserInput('42', 'number', {
        min: 0,
        max: 100
      });
      
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.sanitized, 42);
    });
    
    it('should reject number input outside range', function() {
      const validation = errorHandler.validateUserInput('150', 'number', {
        min: 0,
        max: 100
      });
      
      assert.strictEqual(validation.valid, false);
      assert(validation.errors.some(error => error.includes('no more than 100')));
    });
    
    it('should validate boolean input', function() {
      const testCases = [
        { input: 'true', expected: true },
        { input: 'yes', expected: true },
        { input: 'y', expected: true },
        { input: '1', expected: true },
        { input: 'false', expected: false },
        { input: 'no', expected: false },
        { input: 'n', expected: false },
        { input: '0', expected: false }
      ];
      
      testCases.forEach(testCase => {
        const validation = errorHandler.validateUserInput(testCase.input, 'boolean');
        assert.strictEqual(validation.valid, true, `Should validate "${testCase.input}" as boolean`);
        assert.strictEqual(validation.sanitized, testCase.expected, `Should convert "${testCase.input}" to ${testCase.expected}`);
      });
    });
    
    it('should reject invalid boolean input', function() {
      const validation = errorHandler.validateUserInput('maybe', 'boolean');
      
      assert.strictEqual(validation.valid, false);
      assert(validation.errors.some(error => error.includes('boolean value')));
    });
  });

  describe('gracefullyDegrade', function() {
    it('should provide skip strategy for permission errors', function() {
      const errorInfo = {
        category: 'file_system',
        code: 'EACCES',
        error: 'Permission denied'
      };
      
      const degradation = errorHandler.gracefullyDegrade('/test/file.js', errorInfo);
      
      assert.strictEqual(degradation.strategy, 'skip_with_warning');
      assert(degradation.message.includes('permission issues'));
      assert(degradation.alternatives.length > 0);
    });
    
    it('should provide skip strategy for parsing errors', function() {
      const errorInfo = {
        category: 'parsing',
        type: 'syntax_error',
        error: 'Unexpected token'
      };
      
      const degradation = errorHandler.gracefullyDegrade('/test/file.js', errorInfo);
      
      assert.strictEqual(degradation.strategy, 'skip_with_warning');
      assert.strictEqual(degradation.impact, 'moderate');
      assert(degradation.alternatives.length > 0);
    });
  });

  describe('getErrorStats', function() {
    it('should track error statistics', function() {
      // Generate some test errors
      const error1 = new Error('Test error 1');
      error1.code = 'ENOENT';
      errorHandler.handleFileSystemError(error1, '/test/file1.js');
      
      const error2 = new Error('Test error 2');
      errorHandler.handleParsingError(error2, '/test/file2.js');
      
      const stats = errorHandler.getErrorStats();
      
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.recoverable, 2);
      assert.strictEqual(stats.fatal, 0);
      assert.strictEqual(stats.byCategory.file_system, 1);
      assert.strictEqual(stats.byCategory.parsing, 1);
    });
    
    it('should calculate error rates correctly', function() {
      // Generate mix of recoverable and fatal errors
      const recoverableError = new Error('Recoverable');
      recoverableError.code = 'ENOENT';
      errorHandler.handleFileSystemError(recoverableError, '/test/file1.js');
      
      const fatalError = new Error('Fatal');
      fatalError.code = 'ENOSPC';
      errorHandler.handleFileSystemError(fatalError, '/test/file2.js');
      
      const stats = errorHandler.getErrorStats();
      
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.recoverable, 1);
      assert.strictEqual(stats.fatal, 1);
      assert.strictEqual(stats.errorRate, 0.5); // 1 fatal out of 2 total
      assert.strictEqual(stats.recoveryRate, 0.5); // 1 recoverable out of 2 total
    });
  });

  describe('clearErrorLog', function() {
    it('should clear error log and reset statistics', function() {
      // Generate some errors
      const error = new Error('Test error');
      error.code = 'ENOENT';
      errorHandler.handleFileSystemError(error, '/test/file.js');
      
      // Verify errors exist
      let stats = errorHandler.getErrorStats();
      assert(stats.total > 0);
      
      // Clear log
      errorHandler.clearErrorLog();
      
      // Verify errors are cleared
      stats = errorHandler.getErrorStats();
      assert.strictEqual(stats.total, 0);
      assert.strictEqual(stats.recoverable, 0);
      assert.strictEqual(stats.fatal, 0);
    });
  });
});