/**
 * Kilo Code API Client
 * Handles communication with the Kilo Code API for AI-powered code generation
 */

const API_BASE_URL = 'https://api.kilocode.io/v1';

/**
 * Send a prompt to the Kilo Code API and receive the response
 * @param {string} prompt - The prompt to send to the API
 * @param {object} options - Additional options for the API call
 * @returns {Promise<object>} - The API response
 */
async function sendPrompt(prompt, options = {}) {
  const apiKey = process.env.KILOCODE_API_KEY;
  
  if (!apiKey) {
    throw new Error('KILOCODE_API_KEY is not set in environment variables');
  }

  const defaultOptions = {
    model: 'claude-3-haiku', // Fast, smaller model for rapid generation
    max_tokens: 4000,
    temperature: 0.7,
  };

  const mergedOptions = { ...defaultOptions, ...options };

  try {
    const response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: mergedOptions.model,
        messages: [
          {
            role: 'system',
            content: options.systemPrompt || getScaffoldingSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: mergedOptions.max_tokens,
        temperature: mergedOptions.temperature,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Kilo Code API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Kilo Code API Error:', error.message);
    throw error;
  }
}

/**
 * Generate scaffolding code for a new project
 * @param {string} projectName - Name of the project to scaffold
 * @param {string} description - Description of what the project should do
 * @returns {Promise<object>} - Object containing files to create
 */
async function scaffoldProject(projectName, description) {
  const prompt = `Create a new project called "${projectName}" with the following description: "${description}"
  
Please provide the file structure and code for this project. Format your response as a JSON object with the following structure:
{
  "files": [
    {
      "path": "filename.ext",
      "content": "file content here"
    }
  ]
}

Only include the JSON in your response, no other text.`;

  const response = await sendPrompt(prompt, {
    systemPrompt: getScaffoldingSystemPrompt()
  });

  // Parse the JSON response
  try {
    // Try to extract JSON from the response (in case there's any surrounding text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(response);
  } catch (parseError) {
    console.error('Failed to parse API response:', parseError);
    throw new Error('Failed to parse scaffolding response from AI');
  }
}

/**
 * System prompt for the scaffolding agent
 */
function getScaffoldingSystemPrompt() {
  return `You are an expert software architect specializing in rapid project scaffolding. 
Your role is to generate clean, production-ready boilerplate code for various project types.

When scaffolding a project:
1. Choose the appropriate framework and structure based on the description
2. Include necessary configuration files (package.json, tsconfig.json, etc.)
3. Write clean, well-commented code
4. Follow best practices for the specific framework/language

Available project types you should handle:
- Node.js/Express APIs
- React/Vue/Angular frontends
- Python Flask/Django apps
- Go services
- And more

Always respond with valid JSON containing the files array.`;
}

/**
 * Implement a feature by reading existing context and writing new code
 * @param {string} featureDescription - Description of the feature to implement
 * @param {object} context - Context containing existing file contents
 * @returns {Promise<object>} - Object containing files to create/modify
 */
async function implementFeature(featureDescription, context = {}) {
  let contextInfo = '';
  
  if (context.files && Array.isArray(context.files)) {
    contextInfo = '\n\n## Existing Code Context:\n';
    for (const file of context.files) {
      contextInfo += `\n### ${file.path}\n\n${file.content}\n`;
    }
  }
  
  const prompt = `Implement the following feature: "${featureDescription}"${contextInfo}

Please provide the changes needed. Format your response as a JSON object:
{
  "files": [
    {
      "path": "filename.ext",
      "content": "file content here",
      "action": "create|modify|delete"
    }
  ],
  "explanation": "Brief explanation of changes"
}

Only include the JSON in your response, no other text.`;

  const response = await sendPrompt(prompt, {
    systemPrompt: getImplementationSystemPrompt()
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(response);
  } catch (parseError) {
    console.error('Failed to parse API response:', parseError);
    throw new Error('Failed to parse implementation response from AI');
  }
}

/**
 * Review a file and suggest improvements
 * @param {string} filePath - Path to the file to review
 * @param {string} fileContent - Content of the file
 * @returns {Promise<object>} - Review results
 */
async function reviewFile(filePath, fileContent) {
  const prompt = `Please review the following file and provide feedback.

## File: ${filePath}

\`\`\`
${fileContent}
\`\`\`

Provide a detailed review with the following structure as JSON:
{
  "summary": "Brief summary of the code",
  "issues": [
    {
      "severity": "high|medium|low",
      "line": "line number or null",
      "description": "issue description",
      "suggestion": "how to fix"
    }
  ],
  "strengths": ["list of good practices"],
  "recommendations": ["list of recommendations"]
}

Only include the JSON in your response, no other text.`;

  const response = await sendPrompt(prompt, {
    systemPrompt: getReviewSystemPrompt(),
    max_tokens: 6000
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(response);
  } catch (parseError) {
    console.error('Failed to parse API response:', parseError);
    throw new Error('Failed to parse review response from AI');
  }
}

function getImplementationSystemPrompt() {
  return `You are an expert software developer specializing in feature implementation.
Your role is to implement new features by understanding existing code context and adding new functionality.

When implementing features:
1. Read and understand the existing code context
2. Follow the existing code style and patterns
3. Add clean, well-documented code
4. Handle edge cases and errors appropriately
5. Write tests if needed`;
}

function getReviewSystemPrompt() {
  return `You are an expert code reviewer.
Your role is to analyze code and provide constructive feedback.

When reviewing code:
1. Identify bugs, security issues, and performance problems
2. Note code style violations and best practice deviations
3. Highlight good practices and strengths
4. Provide actionable suggestions for improvement
5. Be constructive and helpful in your feedback`;
}

module.exports = {
  sendPrompt,
  scaffoldProject,
  getScaffoldingSystemPrompt,
  implementFeature,
  reviewFile,
};
