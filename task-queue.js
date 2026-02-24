/**
 * Task Queue Module
 * Handles task queuing using Redis for async processing
 */

const Redis = require('ioredis');

// Redis client configuration
const getRedisClient = () => {
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
  });
};

const TASK_QUEUE = 'slack:tasks';
const TASK_STATUS_PREFIX = 'slack:task:';

/**
 * Add a task to the queue
 * @param {object} task - Task object containing type, payload, and metadata
 * @returns {string} - Task ID
 */
async function enqueueTask(task) {
  const redis = getRedisClient();
  const taskId = `task:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  
  const taskData = {
    id: taskId,
    ...task,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  
  // Store task data
  await redis.set(
    `${TASK_STATUS_PREFIX}${taskId}`,
    JSON.stringify(taskData),
    'EX',
    3600 // Expire after 1 hour
  );
  
  // Add to queue
  await redis.rpush(TASK_QUEUE, taskId);
  
  await redis.quit();
  
  return taskId;
}

/**
 * Get a task from the queue
 * @returns {object|null} - Task data or null if queue is empty
 */
async function dequeueTask() {
  const redis = getRedisClient();
  
  // Blocking pop from queue (wait up to 5 seconds for a task)
  const taskId = await redis.blpop(TASK_QUEUE, 5);
  
  if (!taskId) {
    await redis.quit();
    return null;
  }
  
  const taskData = await redis.get(`${TASK_STATUS_PREFIX}${taskId[1]}`);
  
  if (!taskData) {
    await redis.quit();
    return null;
  }
  
  const task = JSON.parse(taskData);
  task.status = 'processing';
  
  // Update status
  await redis.set(
    `${TASK_STATUS_PREFIX}${task.id}`,
    JSON.stringify(task),
    'EX',
    3600
  );
  
  await redis.quit();
  
  return task;
}

/**
 * Update task status
 * @param {string} taskId - Task ID
 * @param {string} status - New status
 * @param {object} additionalData - Additional data to merge
 */
async function updateTaskStatus(taskId, status, additionalData = {}) {
  const redis = getRedisClient();
  
  const taskData = await redis.get(`${TASK_STATUS_PREFIX}${taskId}`);
  
  if (!taskData) {
    await redis.quit();
    return null;
  }
  
  const task = JSON.parse(taskData);
  task.status = status;
  task.updatedAt = new Date().toISOString();
  Object.assign(task, additionalData);
  
  await redis.set(
    `${TASK_STATUS_PREFIX}${taskId}`,
    JSON.stringify(task),
    'EX',
    3600
  );
  
  await redis.quit();
  
  return task;
}

/**
 * Get task status
 * @param {string} taskId - Task ID
 * @returns {object|null} - Task data or null if not found
 */
async function getTaskStatus(taskId) {
  const redis = getRedisClient();
  
  const taskData = await redis.get(`${TASK_STATUS_PREFIX}${taskId}`);
  
  await redis.quit();
  
  return taskData ? JSON.parse(taskData) : null;
}

/**
 * Process tasks from the queue
 * @param {function} handler - Handler function for processing tasks
 */
async function processQueue(handler) {
  console.log('📋 Task queue worker started...');
  
  while (true) {
    try {
      const task = await dequeueTask();
      
      if (task) {
        console.log(`Processing task: ${task.id} (${task.type})`);
        await handler(task);
      }
    } catch (error) {
      console.error('Error processing task:', error);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

module.exports = {
  enqueueTask,
  dequeueTask,
  updateTaskStatus,
  getTaskStatus,
  processQueue,
  getRedisClient,
};
