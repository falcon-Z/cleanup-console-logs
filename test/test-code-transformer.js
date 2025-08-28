const CodeTransformer = require('../lib/CodeTransformer');

// Simple test function
function runTests() {
  const transformer = new CodeTransformer();
  let passed = 0;
  let failed = 0;

  function test(description, testFn) {
    try {
      testFn();
      console.log(`✓ ${description}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${description}: ${error.message}`);
      failed++;
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}: expected "${expected}", got "${actual}"`);
    }
  }

  function assertNull(actual, message) {
    if (actual !== null) {
      throw new Error(`${message}: expected null, got "${actual}"`);
    }
  }

  console.log('Running CodeTransformer tests...\n');

  // Test convertToConsoleError
  test('convertToConsoleError preserves formatting', () => {
    const input = '    console.log("error message");';
    const result = transformer.convertToConsoleError(input);
    assertEqual(result, '    console.error("error message");', 'Should replace console.log with console.error');
  });

  // Test convertToConsoleInfo
  test('convertToConsoleInfo preserves formatting', () => {
    const input = '  console.log("info message");  ';
    const result = transformer.convertToConsoleInfo(input);
    assertEqual(result, '  console.info("info message");  ', 'Should replace console.log with console.info');
  });

  // Test safelyRemoveConsoleLog - standalone statement
  test('safelyRemoveConsoleLog removes standalone statements', () => {
    const input = '    console.log("debug");';
    const result = transformer.safelyRemoveConsoleLog(input);
    assertNull(result, 'Should return null for standalone console.log');
  });

  // Test safelyRemoveConsoleLog - functional usage
  test('safelyRemoveConsoleLog preserves functional usage', () => {
    const input = 'const result = console.log("test") || defaultValue;';
    const result = transformer.safelyRemoveConsoleLog(input);
    assertEqual(result, input, 'Should preserve functional console.log usage');
  });

  // Test removeCommentedConsoleLog - single line comment
  test('removeCommentedConsoleLog removes single line comments', () => {
    const input = '    // console.log("debug");';
    const result = transformer.removeCommentedConsoleLog(input);
    assertNull(result, 'Should return null for commented console.log');
  });

  // Test removeCommentedConsoleLog - inline comment with code
  test('removeCommentedConsoleLog preserves code with inline comments', () => {
    const input = '    const x = 5; // console.log("debug");';
    const result = transformer.removeCommentedConsoleLog(input);
    assertEqual(result, '    const x = 5;', 'Should preserve code and remove comment');
  });

  // Test removeCommentedConsoleLog - multi-line comment on single line
  test('removeCommentedConsoleLog handles single-line multi-line comments', () => {
    const input = '    /* console.log("debug"); */ const x = 5;';
    const result = transformer.removeCommentedConsoleLog(input);
    assertEqual(result, '     const x = 5;', 'Should remove comment and preserve code');
  });

  // Test transformLine method
  test('transformLine handles convert-error action', () => {
    const input = 'console.log("error");';
    const result = transformer.transformLine(input, 'convert-error');
    assertEqual(result.success, true, 'Should succeed');
    assertEqual(result.transformedLine, 'console.error("error");', 'Should convert to console.error');
  });

  // Test transformLine method with delete action
  test('transformLine handles delete action', () => {
    const input = 'console.log("debug");';
    const result = transformer.transformLine(input, 'delete');
    assertEqual(result.success, true, 'Should succeed');
    assertEqual(result.removed, true, 'Should mark as removed');
  });

  // Test validation
  test('validateTransformation detects parentheses imbalance', () => {
    const original = 'console.log("test");';
    const transformed = 'console.error("test";'; // Missing closing parenthesis
    const result = transformer.validateTransformation(original, transformed);
    assertEqual(result.valid, false, 'Should detect parentheses imbalance');
  });

  console.log(`\nTest Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Run tests if this file is executed directly
if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}

module.exports = { runTests };