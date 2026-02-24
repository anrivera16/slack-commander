/**
 * Kilo Code API Client
 * Handles communication with the Kilo Code Agent API for AI-powered code generation
 */

const API_BASE_URL = 'https://api.kilocode.io/v1';

/**
 * Execute an agent task with Kilo Code API
 * @param {string} message - The prompt/instruction for the agent
 * @param {object} options - Additional options for the agent
 * @returns {Promise<object>} - The agent execution result
 */
async function executeAgent(message, options = {}) {
  const apiKey = process.env.KILOCODE_API_KEY;
  
  if (!apiKey) {
    throw new Error('KILOCODE_API_KEY is not set in environment variables');
  }

  const defaultOptions = {
    mode: options.mode || 'code',
    tools: options.tools || ['read_file', 'write_to_file', 'execute_command', 'list_files'],
    workspace: options.workspace || '/workspace',
    maxIterations: options.maxIterations || 50,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/agent/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        message: message,
        mode: defaultOptions.mode,
        tools: defaultOptions.tools,
        workspace: defaultOptions.workspace,
        max_iterations: defaultOptions.maxIterations,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Kilo Code API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Kilo Code API Error:', error.message);
    throw error;
  }
}

/**
 * Generate scaffolding code for a new project using Kilo Code agent
 * @param {string} projectName - Name of the project to scaffold
 * @param {string} description - Description of what the project should do
 * @returns {Promise<object>} - Object containing files created
 */
async function scaffoldProject(projectName, description) {
  const workspace = process.env.WORKSPACE_DIR || '/workspace';
  
  // Validate and sanitize project name
  const safeProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '');
  
  const message = `Create a new project called "${safeProjectName}" with the following description: "${description}"

Please:
1. First, create the project directory: ${workspace}/${safeProjectName}
2. Generate all necessary files for a complete, working project
3. Include a package.json with appropriate dependencies
4. Write actual working code (not placeholders)

Project types I can scaffold:
- Node.js/Express APIs
- React/Vue/Angular frontends  
- Python Flask/Django apps
- Go services
- Any other framework based on the description

Generate the complete file structure and all necessary code files.`;

  const result = await executeAgent(message, {
    mode: 'architect',
    workspace: workspace,
    tools: ['read_file', 'write_to_file', 'execute_command', 'list_files', 'search_files'],
  });

  return {
    success: true,
    projectName: safeProjectName,
    result: result,
    message: result.output || 'Project scaffolded successfully',
  };
}

/**
 * Implement a feature by using the Kilo Code agent
 * @param {string} featureDescription - Description of the feature to implement
 * @param {object} context - Context containing existing information
 * @returns {Promise<object>} - Result of the implementation
 */
async function implementFeature(featureDescription, context = {}) {
  const workspace = process.env.WORKSPACE_DIR || '/workspace';
  
  let contextInfo = '';
  if (context.files && Array.isArray(context.files)) {
    contextInfo = '\n\n## Existing files in the workspace:\n';
    for (const file of context.files) {
      contextInfo += `- ${file.path}\n`;
    }
  }

  const message = `Implement the following feature: "${featureDescription}"${contextInfo}

Please:
1. First, explore the existing project structure in ${workspace}
2. Understand the current code patterns and style
3. Implement the feature following existing conventions
4. Make minimal, focused changes
5. If you need to create new files, put them in appropriate locations
6. If you need to modify existing files, make surgical changes`;

  const result = await executeAgent(message, {
    mode: 'code',
    workspace: workspace,
    tools: ['read_file', 'write_to_file', 'execute_command', 'list_files', 'search_files'],
  });

  return {
    success: true,
    result: result,
    message: result.output || 'Feature implemented successfully',
  };
}

/**
 * Review a file and suggest improvements using Kilo Code agent
 * @param {string} filePath - Path to the file to review
 * @param {string} fileContent - Content of the file (optional if agent can read)
 * @returns {Promise<object>} - Review results
 */
async function reviewFile(filePath, fileContent) {
  const workspace = process.env.WORKSPACE_DIR || '/workspace';
  
  // If fileContent is provided, use it; otherwise let the agent read the file
  const contentSection = fileContent 
    ? `\n\n## File Content:\n\`\`\`\n${fileContent}\n\`\`\``
    : `\n\nPlease read the file ${filePath} to review its contents.`;

  const message = `Please review the following file and provide detailed feedback.

## File: ${filePath}${contentSection}

Please analyze:
1. Bugs and issues
2. Security vulnerabilities
3. Performance problems
4. Code style violations
5. Best practice deviations
6. Areas of strength

Provide a detailed review with specific line numbers and actionable suggestions for improvement.`;

  const result = await executeAgent(message, {
    mode: 'ask',
    workspace: workspace,
    tools: ['read_file', 'list_files', 'search_files'],
  });

  // Parse the result to extract review information
  const output = result?.output || '';
  
  // Try to extract structured information from the response
  return {
    summary: extractSummary(output),
    issues: extractIssues(output),
    strengths: extractStrengths(output),
    recommendations: extractRecommendations(output),
    fullReview: output,
  };
}

/**
 * Helper function to extract summary from review output
 */
function extractSummary(text) {
  const lines = text.split('\n');
  const summaryLines = [];
  let collecting = false;
  
  for (const line of lines) {
    if (line.toLowerCase().includes('summary') || line.toLowerCase().includes('overview')) {
      collecting = true;
      continue;
    }
    if (collecting && (line.startsWith('## ') || line.startsWith('### '))) {
      break;
    }
    if (collecting && line.trim()) {
      summaryLines.push(line.trim());
    }
  }
  
  return summaryLines.length > 0 ? summaryLines.join(' ').substring(0, 500) : 'See full review below';
}

/**
 * Helper function to extract issues from review output
 */
function extractIssues(text) {
  const issues = [];
  const lines = text.split('\n');
  let currentIssue = null;
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('issue') || lowerLine.includes('bug') || lowerLine.includes('problem') || lowerLine.includes('error')) {
      if (currentIssue) {
        issues.push(currentIssue);
      }
      const severity = lowerLine.includes('critical') || lowerLine.includes('high') ? 'high' 
        : lowerLine.includes('medium') ? 'medium' 
        : 'low';
      currentIssue = {
        severity: severity,
        description: line.replace(/^[\s*\-#]+/, '').trim(),
        suggestion: '',
      };
    } else if (currentIssue && (line.trim().startsWith('-') || line.trim().startsWith('→'))) {
      currentIssue.suggestion += ' ' + line.trim().replace(/^[\s*\-→]+/, '');
    }
  }
  
  if (currentIssue) {
    issues.push(currentIssue);
  }
  
  return issues.length > 0 ? issues : [{ severity: 'low', description: 'Review completed - see details below', suggestion: '' }];
}

/**
 * Helper function to extract strengths from review output
 */
function extractStrengths(text) {
  const strengths = [];
  const lines = text.split('\n');
  let collecting = false;
  
  for (const line of lines) {
    if (line.toLowerCase().includes('strength') || line.toLowerCase().includes('good') || line.toLowerCase().includes('well')) {
      collecting = true;
      continue;
    }
    if (collecting && line.startsWith('## ')) {
      break;
    }
    if (collecting && (line.trim().startsWith('-') || line.trim().startsWith('•'))) {
      strengths.push(line.replace(/^[\s*\-•]+/, '').trim());
    }
  }
  
  return strengths;
}

/**
 * Helper function to extract recommendations from review output
 */
function extractRecommendations(text) {
  const recommendations = [];
  const lines = text.split('\n');
  let collecting = false;
  
  for (const line of lines) {
    if (line.toLowerCase().includes('recommend') || line.toLowerCase().includes('suggestion')) {
      collecting = true;
      continue;
    }
    if (collecting && line.startsWith('## ') && !line.toLowerCase().includes('recommend')) {
      break;
    }
    if (collecting && (line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().startsWith('1.'))) {
      recommendations.push(line.replace(/^[\s*\-•1-9.]+/, '').trim());
    }
  }
  
  return recommendations;
}

module.exports = {
  executeAgent,
  scaffoldProject,
  implementFeature,
  reviewFile,
};
