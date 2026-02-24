require('dotenv').config();
const { App } = require('@slack/bolt');

// Initialize the app with your tokens and enable Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// Listen for the /kilo slash command
app.command('/kilo', async ({ command, ack, respond }) => {
  // Acknowledge the command request immediately
  await ack();

  const args = command.text.trim().split(' ');
  const action = args[0];

  if (action === 'ping') {
    await respond('Pong! 🏓 The Kilo Orchestrator is online and listening via Socket Mode.');
  } else {
    await respond(`I received the command: \`/kilo ${command.text}\`, but I don't know how to handle the action "${action}" yet.`);
  }
});

(async () => {
  // Start the app
  await app.start();
  console.log('⚡️ Kilo Orchestrator is running in Socket Mode!');
})();
