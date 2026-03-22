import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import TelegramBot from "node-telegram-bot-api";
import AdmZip from "adm-zip";
import { WebSocketServer, WebSocket } from "ws";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  let config = {
    telegramToken: process.env.TELEGRAM_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    characterName: "Narrator",
    enabled: false
  };

  let bot: TelegramBot | null = null;
  let sillyTavernClient: WebSocket | null = null;
  const ongoingStreams = new Map();

  const initBot = () => {
    if (bot) {
      bot.stopPolling();
      bot = null;
    }
    if (config.telegramToken && config.enabled) {
      try {
        bot = new TelegramBot(config.telegramToken, { polling: true });
        console.log("Telegram Bot initialized");

        bot.on('message', (msg) => {
          const chatId = msg.chat.id;
          const text = msg.text;

          if (!text) return;

          if (text.startsWith('/')) {
            const parts = text.slice(1).trim().split(/\s+/);
            const command = parts[0].toLowerCase();
            const args = parts.slice(1);

            if (command === 'ping') {
              bot?.sendMessage(chatId, `Bridge Status: Connected ✅\nSillyTavern Status: ${sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN ? 'Connected ✅' : 'Disconnected ❌'}`);
              return;
            }

            if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
              sillyTavernClient.send(JSON.stringify({
                type: 'execute_command',
                command: command,
                args: args,
                chatId: chatId
              }));
            } else {
              bot?.sendMessage(chatId, 'SillyTavern is not connected. Please ensure the extension is running.');
            }
            return;
          }

          if (sillyTavernClient && sillyTavernClient.readyState === WebSocket.OPEN) {
            console.log(`Received message from Telegram user ${chatId}: "${text}"`);
            sillyTavernClient.send(JSON.stringify({ type: 'user_message', chatId, text }));
          } else {
            console.warn('Received Telegram message, but SillyTavern is not connected.');
            bot?.sendMessage(chatId, 'Sorry, I cannot connect to SillyTavern right now. Please ensure it is open and the extension is connected.');
          }
        });
      } catch (e) {
        console.error("Failed to init bot:", e);
      }
    }
  };

  initBot();

  app.get("/api/config", (req, res) => {
    res.json(config);
  });

  app.post("/api/config", (req, res) => {
    config = { ...config, ...req.body };
    initBot();
    res.json({ status: "ok", config });
  });

  app.get("/api/download-extension", (req, res) => {
    const manifest = {
      name: "telegram-bridge",
      display_name: "Telegram Bridge",
      description: "Automatically forwards specific character messages to your Telegram Bridge.",
      version: "1.0.0",
      author: "AI Studio",
      js: "index.js",
      css: "style.css",
      loading_order: 9,
      requires: [],
      optional: []
    };

    try {
      const zip = new AdmZip();
      const folderName = "telegram-bridge";
      zip.addFile(`${folderName}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
      
      // We will read the actual files from the project root
      const fs = require('fs');
      if (fs.existsSync('index.js')) zip.addFile(`${folderName}/index.js`, fs.readFileSync('index.js'));
      if (fs.existsSync('settings.html')) zip.addFile(`${folderName}/settings.html`, fs.readFileSync('settings.html'));
      if (fs.existsSync('style.css')) zip.addFile(`${folderName}/style.css`, fs.readFileSync('style.css'));

      const zipBuffer = zip.toBuffer();

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename=telegram-bridge.zip');
      res.set('Content-Length', zipBuffer.length.toString());
      res.send(zipBuffer);
    } catch (e) {
      console.error("Error generating zip:", e);
      res.status(500).send("Error generating extension zip");
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', ws => {
    console.log('SillyTavern extension connected via WebSocket!');
    sillyTavernClient = ws;

    ws.on('message', async (message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
        const targetChatId = data.chatId === 'default' ? config.chatId : data.chatId;

        if (!bot || !targetChatId) return;

        if (data.type === 'stream_chunk') {
          let session = ongoingStreams.get(targetChatId);

          if (!session) {
            let resolveMessagePromise: any;
            const messagePromise = new Promise(resolve => {
              resolveMessagePromise = resolve;
            });

            session = {
              messagePromise: messagePromise,
              lastText: data.text,
              timer: null,
              isEditing: false,
            };
            ongoingStreams.set(targetChatId, session);

            bot.sendMessage(targetChatId, 'Thinking...')
              .then(sentMessage => {
                resolveMessagePromise(sentMessage.message_id);
              }).catch(err => {
                console.error('Failed to send initial Telegram message:', err);
                ongoingStreams.delete(targetChatId);
              });
          } else {
            session.lastText = data.text;
          }

          const messageId = await session.messagePromise;

          if (messageId && !session.isEditing && !session.timer) {
            session.timer = setTimeout(async () => {
              const currentSession = ongoingStreams.get(targetChatId);
              if (currentSession) {
                const currentMessageId = await currentSession.messagePromise;
                if (currentMessageId) {
                  currentSession.isEditing = true;
                  bot?.editMessageText(currentSession.lastText + ' ...', {
                    chat_id: targetChatId,
                    message_id: currentMessageId,
                  }).catch(err => {
                    if (!err.message.includes('message is not modified'))
                      console.error('Failed to edit Telegram message:', err.message);
                  }).finally(() => {
                    if (ongoingStreams.has(targetChatId)) ongoingStreams.get(targetChatId).isEditing = false;
                  });
                }
                currentSession.timer = null;
              }
            }, 2000);
          }
          return;
        }

        if (data.type === 'stream_end') {
          const session = ongoingStreams.get(targetChatId);
          if (session && session.timer) {
            clearTimeout(session.timer);
          }
          return;
        }

        if (data.type === 'final_message_update') {
          const session = ongoingStreams.get(targetChatId);
          if (session) {
            const messageId = await session.messagePromise;
            if (messageId) {
              await bot.editMessageText(data.text, {
                chat_id: targetChatId,
                message_id: messageId,
              }).catch(err => {
                if (!err.message.includes('message is not modified'))
                  console.error('Failed to edit final Telegram message:', err.message);
              });
            }
            ongoingStreams.delete(targetChatId);
          } else {
            await bot.sendMessage(targetChatId, data.text).catch(err => {
              console.error('Failed to send non-streaming reply:', err.message);
            });
          }
          return;
        }

        if (data.type === 'error_message') {
          bot.sendMessage(targetChatId, data.text);
        } else if (data.type === 'ai_reply') {
          if (ongoingStreams.has(targetChatId)) {
            ongoingStreams.delete(targetChatId);
          }
          await bot.sendMessage(targetChatId, data.text).catch(err => {
            console.error(`Failed to send AI reply: ${err.message}`);
          });
        } else if (data.type === 'typing_action') {
          bot.sendChatAction(targetChatId, 'typing').catch(error =>
            console.error('Failed to send typing action:', error));
        }
      } catch (error) {
        console.error('Error processing SillyTavern message:', error);
      }
    });

    ws.on('close', () => {
      console.log('SillyTavern extension disconnected.');
      sillyTavernClient = null;
      ongoingStreams.clear();
    });

    ws.on('error', (error) => {
      console.error('WebSocket Error:', error);
      sillyTavernClient = null;
      ongoingStreams.clear();
    });
  });
}

startServer();
