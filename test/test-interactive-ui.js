const InteractiveUI = require('../lib/InteractiveUI');
const CodeAnalyzer = require('../lib/CodeAnalyzer');

// Test data - sample JavaScript code with various console.log patterns
const testCode = `function processUser(userData) {
  console.log("Processing user:", userData.name);
  
  try {
    const result = validateUser(userData);
    return result;
  } catch (error) {
    console.log("Validation failed:", error.message);
    throw error;
  }
}

const debugMode = true;
// console.log("Debug mode enabled");

const result = condition ? console.log("success") : null;
api.call().then(console.log).catch(handleError);`;

async function testInteractiveUI() {
  console.log('Testing InteractiveUI and CodeAnalyzer...\n');
  
  const ui = new InteractiveUI();
  const analyzer = new CodeAnalyzer();
  
  // Analyze the test code
  const instances = analyzer.analyzeFile('test.js', testCode);
  
  console.log(`Found ${instances.length} console.log instances:\n`);
  
  // Display each instance with context
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    
    // Set functional flag
    instance.isFunctional = analyzer.isFunctionalLog(instance);
    
    console.log(`\n=== Instance ${i + 1} ===`);
    ui.displayContext(instance, 'test.js');
    
    console.log('\nContext Analysis:');
    console.log(`- Is commented: ${instance.isCommented}`);
    console.log(`- Is in catch block: ${instance.isInCatchBlock}`);
    console.log(`- Is functional: ${instance.isFunctional}`);
    console.log(`- Context:`, instance.context);
    
    console.log('\n' + '='.repeat(60));
  }
  
  // Test progress display
  console.log('\nTesting progress display:');
  ui.showProgress(3, 10, 'test.js');
  
  // Test summary display
  console.log('\nTesting summary display:');
  ui.displaySummary({
    filesProcessed: 5,
    totalReviewed: 12,
    deleted: 8,
    kept: 2,
    convertedToInfo: 1,
    convertedToError: 1,
    skipped: 0
  });
  
  ui.close();
  console.log('\nTest completed!');
}

// Run the test
testInteractiveUI().catch(console.error);