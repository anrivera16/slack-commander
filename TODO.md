# Implementation Plan: Slack + Kilo Code Local Orchestrator

This document outlines the step-by-step plan to build the local-first MVP workflow described in the main architecture document.

## Phase 1: Slack App & Basic Connectivity (The "Hello World")

**Goal:** Establish a secure, local connection between Slack and a basic Node.js/Python script using Socket Mode.

- [ ] **Create Slack App:**
  - Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app.
  - Enable **Socket Mode**.
  - Generate an App-Level Token (`xapp-...`) with `connections:write` scope.
  - Under "OAuth & Permissions", add bot token scopes: `app_mentions:read`, `chat:write`, `commands`.
  - Install the app to your workspace and copy the Bot User OAuth Token (`xoxb-...`).
- [ ] **Initialize Local Project:**
  - Create a new directory for the orchestrator.
  - Initialize a Node.js (or Python) project.
  - Install the official Slack SDK (e.g., `@slack/bolt` for Node.js).
- [ ] **Implement Socket Mode Listener:**
  - Write a basic script that connects to Slack using the `xapp` and `xoxb` tokens.
  - Listen for a simple slash command (e.g., `/kilo ping`).
  - Respond with "Pong! Orchestrator is online."
- [ ] **Test Locally:** Run the script and verify the command works in your Slack workspace.

## Phase 2: Dockerization & Volume Mounts

**Goal:** Move the basic listener into a Docker container while maintaining access to your local file system.

- [ ] **Create Dockerfile:**
  - Write a `Dockerfile` for the orchestrator service.
- [ ] **Create `docker-compose.yml`:**
  - Define the `orchestrator` service.
  - Pass the Slack tokens as environment variables.
  - **Crucial Step:** Add a volume mount mapping your local development directory (e.g., `~/projects`) to a directory inside the container (e.g., `/workspace`).
- [ ] **Test File System Access:**
  - Add a new Slack command: `/kilo touch <filename>`.
  - Have the orchestrator script create an empty file at `/workspace/<filename>`.
  - Run `docker-compose up`, trigger the command in Slack, and verify the file appears on your host machine.

## Phase 3: Kilo Code API Integration & The Scaffolding Agent

**Goal:** Connect the orchestrator to the Kilo Code API and implement the first MVP-focused agent.

- [ ] **Obtain Kilo Code API Key:** Ensure you have access to the Kilo Code API.
- [ ] **Implement API Client:**
  - Add a module to your orchestrator to interact with the Kilo Code API (sending prompts, receiving code/actions).
- [ ] **Create the "Scaffold" Command:**
  - Listen for `/kilo scaffold <project-name> <description>`.
  - Parse the command and prepare a prompt for the Kilo Code API.
- [ ] **Configure the Scaffolding Agent:**
  - Define the agent's system prompt (e.g., "You are an expert architect. Generate boilerplate code for...").
  - Select a fast, smaller model (e.g., Claude 3 Haiku or Gemini Flash) for rapid generation.
  - Provide the agent with tools to write files to the `/workspace` directory.
- [ ] **End-to-End Test:**
  - Run `/kilo scaffold express-api "A basic Express server with a /health endpoint"`.
  - Verify the agent generates the files locally via the Docker volume mount.

## Phase 4: Task Queuing & State Management (Optional but Recommended)

**Goal:** Handle multiple requests gracefully and track task status.

- [ ] **Add Redis to `docker-compose.yml`:**
  - Add a Redis container to handle task queuing.
- [ ] **Implement Task Queue:**
  - When a Slack command is received, push a job to the Redis queue instead of processing it immediately.
  - Acknowledge the Slack command immediately (e.g., "Task queued...").
- [ ] **Implement Worker Process:**
  - Have the orchestrator pull jobs from the queue and execute the Kilo Code API calls.
- [ ] **Status Updates:**
  - Update the Slack thread as the agent progresses (e.g., "Generating files...", "Done!").

## Phase 5: Expanding Agent Capabilities

**Goal:** Add more specialized agents for the "Co-Pilot" workflow.

- [ ] **Implement Feature Agent:**
  - Command: `/kilo implement <feature description>`.
  - Agent reads existing local files (context) and writes new implementations.
- [ ] **Implement Refactor/Review Agent:**
  - Command: `/kilo review <file path>`.
  - Agent analyzes the local file and suggests improvements in a Slack thread.
- [ ] **Interactive Slack UI:**
  - Use Slack Block Kit to add buttons (e.g., "Approve Changes", "Retry") to the agent's responses.