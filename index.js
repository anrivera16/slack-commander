require('dotenv').config();
const { App } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');

// Workspace directory for file operations
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

/**
 * Sanitize a user-provided path to prevent directory traversal attacks
 * @param {string} userInput - The user-provided path component
 * @param {string} baseDir - The base directory (defaults to WORKSPACE_DIR)
 * @returns {string} - The sanitized absolute path
 * @throws {Error} - If path traversal is detected
 */
function sanitizePath(userInput, baseDir = WORKSPACE_DIR) {
  // Normalize the base directory to an absolute path
  const resolvedBase = path.resolve(baseDir);
  
  // Remove null bytes and normalize the user input
  const normalizedInput = userInput.replace(/\0/g, '');
  
  // Join with base directory and resolve to absolute path
  const fullPath = path.resolve(resolvedBase, normalizedInput);
  
  // Verify the resolved path is still within the base directory
  if (!fullPath.startsWith(resolvedBase + path.sep) && fullPath !== resolvedBase) {
    throw new Error('Invalid path: directory traversal detected');
  }
  
  return fullPath;
}

/**
 * Validate a project name to ensure it's safe
 * @param {string} projectName - The project name to validate
 * @returns {string} - The sanitized project name
 * @throws {Error} - If the project name is invalid
 */
function validateProjectName(projectName) {
  // Only allow alphanumeric characters, dashes, and underscores
  const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '');
  
  if (safeName !== projectName || safeName.length === 0) {
    throw new Error('Invalid project name. Use only letters, numbers, dashes, and underscores.');
  }
  
  return safeName;
}

// Import Kilo Code API client
const { scaffoldProject, implementFeature, reviewFile } = require('./kilocode-client');

// Import task queue (optional - Redis-based)
let taskQueue = null;
try {
  taskQueue = require('./task-queue');
} catch (e) {
  console.log('Task queue not available (Redis not configured)');
}

// Check if running as worker
const isWorker = process.env.WORKER_MODE === 'true';

// Initialize the app with your tokens and enable Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// Helper to send status updates to Slack
async function sendStatusUpdate(channelId, threadTs, message, blocks = null) {
  try {
    const { WebClient } = require('@slack/web-api');
    const client = new WebClient(process.env.SLACK_BOT_TOKEN);
    
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: message,
      blocks: blocks,
    });
  } catch (error) {
    console.error('Error sending status update:', error);
  }
}

/**
 * Create interactive blocks for approval/rejection actions
 * @param {string} taskId - Unique identifier for the task
 * @param {string} taskType - Type of task (scaffold, implement, review)
 * @param {string} description - Description of the changes
 * @returns {Array} - Slack Block Kit blocks
 */
function createApprovalBlocks(taskId, taskType, description) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Action Required:* ${taskType === 'scaffold' ? 'Project scaffolding' : taskType === 'implement' ? 'Feature implementation' : 'Code review'} complete!`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:* ${description}`,
      },
    },
    {
      type: 'actions',
      block_id: `approval_${taskId}`,
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ Approve',
          },
          style: 'primary',
          action_id: 'approve_changes',
          value: taskId,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔄 Retry',
          },
          style: 'danger',
          action_id: 'retry_changes',
          value: taskId,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📝 View Details',
          },
          action_id: 'view_details',
          value: taskId,
        },
      ],
    },
  ];
}

/**
 * Create confirmation blocks after approval
 * @param {string} taskId - Task ID
 * @returns {Array} - Slack Block Kit blocks
 */
function createApprovalConfirmationBlocks(taskId) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '✅ *Changes Approved!* The files have been applied to your workspace.',
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Task ID: ${taskId}`,
        },
      ],
    },
  ];
}

/**
 * Create retry confirmation blocks
 * @param {string} taskId - Task ID
 * @returns {Array} - Slack Block Kit blocks
 */
function createRetryConfirmationBlocks(taskId) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '🔄 *Retrying task...* Please wait while the agent processes your request again.',
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Task ID: ${taskId}`,
        },
      ],
    },
  ];
}

// Listen for the /kilo slash command
app.command('/kilo', async ({ command, ack, respond }) => {
  // Acknowledge the command request immediately
  await ack();

  const args = command.text.trim().split(' ');
  const action = args[0];

  if (action === 'ping') {
    await respond('Pong! 🏓 The Kilo Orchestrator is online and listening via Socket Mode.');
  } else if (action === 'touch') {
    const filename = args[1];
    if (!filename) {
      await respond('Usage: `/kilo touch <filename>` - Creates an empty file in the workspace.');
      return;
    }
    
    try {
      const filePath = sanitizePath(filename);
      fs.writeFileSync(filePath, '', { encoding: 'utf8' });
      await respond(`✅ Created empty file: \`${filename}\` at /workspace/`);
    } catch (error) {
      await respond(`❌ Error creating file: ${error.message}`);
    }
  } else if (action === 'scaffold') {
    // Parse: /kilo scaffold <project-name> <description>
    const projectName = args[1];
    const description = args.slice(2).join(' ');
    
    if (!projectName || !description) {
      await respond('Usage: `/kilo scaffold <project-name> <description>` - Scaffolds a new project using AI.');
      return;
    }
    
    // Validate project name to prevent path traversal
    let safeProjectName;
    try {
      safeProjectName = validateProjectName(projectName);
    } catch (validationError) {
      await respond(`❌ ${validationError.message}`);
      return;
    }
    
    // Check if task queue is available
    if (taskQueue) {
      // Use async task queue
      try {
        const taskId = await taskQueue.enqueueTask({
          type: 'scaffold',
          projectName: safeProjectName,
          description,
          channelId: command.channel_id,
          userId: command.user_id,
        });
        
        await respond(`🚀 Task queued! Your project \`${safeProjectName}\` will be scaffolded shortly. (Task ID: ${taskId})`);
        
        // Start worker in background if not already running
        startWorker();
      } catch (error) {
        await respond(`❌ Error queueing task: ${error.message}`);
      }
    } else {
      // Direct processing (fallback)
      try {
        await respond(`🚀 Scaffolding project \`${safeProjectName}\`... This may take a moment.`);
        
        const result = await scaffoldProject(safeProjectName, description);
        
        // The new Kilo Code agent returns results differently
        // Check for files created in the response
        let createdFiles = [];
        
        if (result.result?.files && Array.isArray(result.result.files)) {
          // Files returned directly in result
          for (const file of result.result.files) {
            const filePath = sanitizePath(path.join(safeProjectName, file.path));
            const dirPath = path.dirname(filePath);
            
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            
            fs.writeFileSync(filePath, file.content, { encoding: 'utf8' });
            createdFiles.push(file.path);
          }
        } else if (result.result?.tool_calls) {
          // Check for write_to_file tool calls in the agent result
          const writeCalls = result.result.tool_calls.filter(tc => tc.tool === 'write_to_file');
          for (const call of writeCalls) {
            const filePath = sanitizePath(call.path);
            const dirPath = path.dirname(filePath);
            
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            
            fs.writeFileSync(filePath, call.content || '', { encoding: 'utf8' });
            createdFiles.push(call.path);
          }
        }
        
        const responseMsg = result.message || result.result?.output || 'Project scaffolded successfully';
        
        // Generate a unique task ID for this operation
        const taskId = `scaffold_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (createdFiles.length > 0) {
          const blocks = createApprovalBlocks(taskId, 'scaffold', `Scaffolded project \`${safeProjectName}\` with ${createdFiles.length} files`);
          await respond({
            text: `✅ Successfully scaffolded \`${safeProjectName}\` with ${createdFiles.length} files:\n${createdFiles.map(f => `• \`${f}\``).join('\n')}\n\n📝 ${responseMsg}`,
            blocks: blocks,
          });
        } else {
          const blocks = createApprovalBlocks(taskId, 'scaffold', `Scaffolded project \`${safeProjectName}\``);
          await respond({
            text: `✅ Project \`${safeProjectName}\` scaffolded!\n\n📝 ${responseMsg}`,
            blocks: blocks,
          });
        }
      } catch (error) {
        await respond(`❌ Error scaffolding project: ${error.message}`);
      }
    }
  } else if (action === 'status') {
    // Check task status
    const taskId = args[1];
    if (!taskId || !taskQueue) {
      await respond('Usage: `/kilo status <task-id>` - Check the status of a queued task.');
      return;
    }
    
    try {
      const status = await taskQueue.getTaskStatus(taskId);
      if (status) {
        await respond(`📋 Task Status: \`${status.status}\`\nType: ${status.type}\nCreated: ${status.createdAt}`);
      } else {
        await respond(`❌ Task not found: ${taskId}`);
      }
    } catch (error) {
      await respond(`❌ Error checking status: ${error.message}`);
    }
  } else if (action === 'implement') {
    // Parse: /kilo implement <feature description>
    const featureDescription = args.slice(1).join(' ');
    
    if (!featureDescription) {
      await respond('Usage: `/kilo implement <feature description>` - Implement a feature using AI.');
      return;
    }
    
    try {
      await respond(`🔨 Implementing feature: "${featureDescription}"... This may take a moment.`);
      
      // Read existing files in workspace for context
      const context = { files: [] };
      
      const result = await implementFeature(featureDescription, context);
      
      // Handle the new Kilo Code agent response format
      let changedFiles = [];
      
      if (result.result?.files && Array.isArray(result.result.files)) {
        // Files returned directly in result
        for (const file of result.result.files) {
          const filePath = sanitizePath(file.path);
          const dirPath = path.dirname(filePath);
          
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
          
          if (file.action === 'delete') {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              changedFiles.push(`🗑️ \`${file.path}\``);
            }
          } else {
            fs.writeFileSync(filePath, file.content, { encoding: 'utf8' });
            changedFiles.push(file.action === 'create' ? `➕ \`${file.path}\`` : `✏️ \`${file.path}\``);
          }
        }
      } else if (result.result?.tool_calls) {
        // Check for write_to_file tool calls in the agent result
        const writeCalls = result.result.tool_calls.filter(tc => tc.tool === 'write_to_file');
        for (const call of writeCalls) {
          const filePath = sanitizePath(call.path);
          const dirPath = path.dirname(filePath);
          
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
          
          fs.writeFileSync(filePath, call.content || '', { encoding: 'utf8' });
          changedFiles.push(`✏️ \`${call.path}\``);
        }
      }
      
      const explanation = result.message || result.result?.output || '';
      
      // Generate a unique task ID for this operation
      const taskId = `implement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      if (changedFiles.length > 0) {
        const blocks = createApprovalBlocks(taskId, 'implement', `Implemented feature: "${featureDescription}" with ${changedFiles.length} file changes`);
        await respond({
          text: `✅ Implemented feature with ${changedFiles.length} file changes:\n${changedFiles.join('\n')}${explanation ? `\n\n📝 ${explanation}` : ''}`,
          blocks: blocks,
        });
      } else {
        const blocks = createApprovalBlocks(taskId, 'implement', `Implemented feature: "${featureDescription}"`);
        await respond({
          text: `✅ Feature implementation complete!\n\n📝 ${explanation || 'The agent has processed your request.'}`,
          blocks: blocks,
        });
      }
    } catch (error) {
      await respond(`❌ Error implementing feature: ${error.message}`);
    }
  } else if (action === 'review') {
    // Parse: /kilo review <file path>
    const filePath = args.slice(1).join(' ');
    
    if (!filePath) {
      await respond('Usage: `/kilo review <file path>` - Review a file using AI.');
      return;
    }
    
    try {
      // Sanitize the file path to prevent directory traversal
      const fullPath = sanitizePath(filePath);
      
      if (!fs.existsSync(fullPath)) {
        await respond(`❌ File not found: \`${filePath}\``);
        return;
      }
      
      const fileContent = fs.readFileSync(fullPath, { encoding: 'utf8' });
      
      await respond(`🔍 Reviewing file: \`${filePath}\`...`);
      
      const result = await reviewFile(filePath, fileContent);
      
      let responseMessage = `📋 *Code Review: \`${filePath}\`*\n\n`;
      responseMessage += `*Summary:* ${result.summary || 'N/A'}\n\n`;
      
      if (result.issues && result.issues.length > 0) {
        responseMessage += `*Issues (${result.issues.length}):*\n`;
        for (const issue of result.issues) {
          const emoji = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
          responseMessage += `${emoji} ${issue.description}`;
          if (issue.suggestion) {
            responseMessage += ` → ${issue.suggestion}`;
          }
          responseMessage += '\n';
        }
        responseMessage += '\n';
      }
      
      if (result.strengths && result.strengths.length > 0) {
        responseMessage += `*Strengths:*\n${result.strengths.map(s => `• ${s}`).join('\n')}\n\n`;
      }
      
      if (result.recommendations && result.recommendations.length > 0) {
        responseMessage += `*Recommendations:*\n${result.recommendations.map(r => `• ${r}`).join('\n')}`;
      }
      
      // Generate a unique task ID for this review
      const taskId = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Add approval blocks
      const blocks = createApprovalBlocks(taskId, 'review', `Code review for \`${filePath}\``);
      
      await respond({
        text: responseMessage,
        blocks: blocks,
      });
    } catch (error) {
      await respond(`❌ Error reviewing file: ${error.message}`);
    }
  } else {
    await respond(`I received the command: \`/kilo ${command.text}\`, but I don't know how to handle the action "${action}" yet.`);
  }
});

// Interactive button action listeners
app.action('approve_changes', async ({ ack, body, respond }) => {
  await ack();
  
  const taskId = body.actions[0].value;
  const userId = body.user.id;
  const channelId = body.container.channel_id;
  
  console.log(`User ${userId} approved task ${taskId}`);
  
  // Send confirmation with blocks
  await respond({
    response_type: 'in_channel',
    text: '✅ Changes Approved!',
    blocks: createApprovalConfirmationBlocks(taskId),
  });
});

app.action('retry_changes', async ({ ack, body, respond }) => {
  await ack();
  
  const taskId = body.actions[0].value;
  const userId = body.user.id;
  const channelId = body.container.channel_id;
  
  console.log(`User ${userId} requested retry for task ${taskId}`);
  
  // Send retry confirmation with blocks
  await respond({
    response_type: 'in_channel',
    text: '🔄 Retrying task...',
    blocks: createRetryConfirmationBlocks(taskId),
  });
  
  // If task queue is available, re-queue the task
  if (taskQueue) {
    try {
      // Get the original task and re-queue it
      const status = await taskQueue.getTaskStatus(taskId);
      if (status) {
        const newTaskId = await taskQueue.enqueueTask({
          type: status.type,
          projectName: status.projectName,
          description: status.description,
          channelId: channelId,
          userId: userId,
          retryOf: taskId,
        });
        
        await sendStatusUpdate(channelId, null, `🔄 Task re-queued as Task ID: ${newTaskId}`);
        startWorker();
      }
    } catch (error) {
      console.error('Error re-queuing task:', error);
      await sendStatusUpdate(channelId, null, `❌ Error re-queuing task: ${error.message}`);
    }
  }
});

app.action('view_details', async ({ ack, body, respond }) => {
  await ack();
  
  const taskId = body.actions[0].value;
  const channelId = body.container.channel_id;
  
  console.log(`User requested details for task ${taskId}`);
  
  // If task queue is available, get task details
  if (taskQueue) {
    try {
      const status = await taskQueue.getTaskStatus(taskId);
      if (status) {
        let details = `*Task Details (${taskId})*\n`;
        details += `• Type: ${status.type}\n`;
        details += `• Status: ${status.status}\n`;
        details += `• Created: ${status.createdAt}\n`;
        
        if (status.result?.files) {
          details += `\n*Files:*\n${status.result.files.map(f => `• \`${f}\``).join('\n')}`;
        }
        
        await respond({
          response_type: 'in_channel',
          text: details,
        });
      } else {
        await respond({
          response_type: 'in_channel',
          text: `❌ Task not found: ${taskId}`,
        });
      }
    } catch (error) {
      await respond({
        response_type: 'in_channel',
        text: `❌ Error getting task details: ${error.message}`,
      });
    }
  } else {
    await respond({
      response_type: 'in_channel',
      text: `📋 Task ID: ${taskId}\nTask queue not available for detailed view.`,
    });
  }
});

// Worker process to handle queued tasks
async function startWorker() {
  if (!taskQueue) return;
  
  console.log('🔄 Starting task worker...');
  
  await taskQueue.processQueue(async (task) => {
    console.log(`Processing ${task.type} task: ${task.id}`);
    
    try {
      if (task.type === 'scaffold') {
        // Send status update
        await sendStatusUpdate(task.channelId, null, `🔨 Starting to scaffold \`${task.projectName}\`...`);
        
        // Process the scaffold request
        const result = await scaffoldProject(task.projectName, task.description);
        
        // Handle the new Kilo Code agent response format
        let createdFiles = [];
        
        if (result.result?.files && Array.isArray(result.result.files)) {
          for (const file of result.result.files) {
            const filePath = sanitizePath(path.join(task.projectName, file.path));
            const dirPath = path.dirname(filePath);
            
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            
            fs.writeFileSync(filePath, file.content, { encoding: 'utf8' });
            createdFiles.push(file.path);
          }
        } else if (result.result?.tool_calls) {
          const writeCalls = result.result.tool_calls.filter(tc => tc.tool === 'write_to_file');
          for (const call of writeCalls) {
            const filePath = sanitizePath(call.path);
            const dirPath = path.dirname(filePath);
            
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            
            fs.writeFileSync(filePath, call.content || '', { encoding: 'utf8' });
            createdFiles.push(call.path);
          }
        }
        
        const responseMsg = result.message || result.result?.output || 'Project scaffolded successfully';
        
        const taskId = task.id;
        
        if (createdFiles.length > 0) {
          const blocks = createApprovalBlocks(taskId, 'scaffold', `Scaffolded project \`${task.projectName}\` with ${createdFiles.length} files`);
          await sendStatusUpdate(
            task.channelId, 
            null, 
            `✅ Successfully scaffolded \`${task.projectName}\` with ${createdFiles.length} files:\n${createdFiles.map(f => `• \`${f}\``).join('\n')}\n\n📝 ${responseMsg}`,
            blocks
          );
          await taskQueue.updateTaskStatus(task.id, 'completed', { files: createdFiles });
        } else {
          const blocks = createApprovalBlocks(taskId, 'scaffold', `Scaffolded project \`${task.projectName}\``);
          await sendStatusUpdate(
            task.channelId, 
            null, 
            `✅ Project \`${task.projectName}\` scaffolded!\n\n📝 ${responseMsg}`,
            blocks
          );
          await taskQueue.updateTaskStatus(task.id, 'completed', {});
        }
      }
    } catch (error) {
      console.error(`Error processing task ${task.id}:`, error);
      await sendStatusUpdate(task.channelId, null, `❌ Error: ${error.message}`);
      await taskQueue.updateTaskStatus(task.id, 'failed', { error: error.message });
    }
  });
}

// Start the app or worker
(async () => {
  if (isWorker) {
    // Run as worker
    await startWorker();
  } else {
    // Run as Slack app
    await app.start();
    console.log('⚡️ Kilo Orchestrator is running in Socket Mode!');
  }
})();
