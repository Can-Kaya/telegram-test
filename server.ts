import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import TelegramBot from "node-telegram-bot-api";
import AdmZip from "adm-zip";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // In-memory config (for demo purposes, in a real app you'd use a DB or persistent storage)
  let config = {
    telegramToken: process.env.TELEGRAM_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    characterName: "Narrator",
    enabled: false
  };

  let bot: TelegramBot | null = null;

  const initBot = () => {
    if (config.telegramToken && config.enabled) {
      try {
        bot = new TelegramBot(config.telegramToken, { polling: false });
        console.log("Telegram Bot initialized");
      } catch (e) {
        console.error("Failed to init bot:", e);
      }
    } else {
      bot = null;
    }
  };

  initBot();

  // API Routes
  app.get("/api/config", (req, res) => {
    res.json(config);
  });

  app.post("/api/config", (req, res) => {
    config = { ...config, ...req.body };
    initBot();
    res.json({ status: "ok", config });
  });

  // Extension endpoints for SillyTavern
  app.get("/api/download-extension", (req, res) => {
    // Determine the base URL dynamically based on the request host
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    const appUrl = process.env.APP_URL || `${protocol}://${host}`;
    
    const manifest = {
      name: "Telegram Bridge",
      description: "Automatically forwards specific character messages to your Telegram Bridge.",
      version: "1.0.0",
      author: "AI Studio",
      main: "index.js"
    };

    const script = `
import { getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

jQuery(async () => {
    console.log('Telegram Bridge Extension Loaded');
    
    // Keep track of processed messages to avoid duplicates
    const processedMessages = new Set();

    eventSource.on(event_types.MESSAGE_RECEIVED, async function (messageId) {
        try {
            if (processedMessages.has(messageId)) return;
            processedMessages.add(messageId);

            const context = getContext();
            const message = context.chat[messageId];
            
            if (message && !message.is_user) {
                const characterName = message.name;
                const text = message.mes;
                
                await fetch('${appUrl}/api/forward', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        character: characterName,
                        message: text
                    })
                });
            }
        } catch (e) {
            console.error('Telegram Bridge Error:', e);
        }
    });
});
    `;

    try {
      const zip = new AdmZip();
      zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
      zip.addFile("index.js", Buffer.from(script));

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

  // Forward endpoint for the custom extension
  app.post("/api/forward", async (req, res) => {
    const { character, message } = req.body;
    
    console.log("Received message from extension:", req.body);

    if (!config.enabled || !bot || !config.chatId) {
      return res.status(200).json({ status: "disabled" });
    }

    const senderName = character || "Unknown";
    
    if (senderName.toLowerCase() === config.characterName.toLowerCase()) {
      try {
        await bot.sendMessage(config.chatId, `*${senderName}*: ${message}`, { parse_mode: 'Markdown' });
        console.log(`Forwarded message from ${senderName} to Telegram`);
      } catch (e) {
        console.error("Error sending to Telegram:", e);
      }
    }

    res.json({ status: "processed" });
  });

  // Vite middleware for development
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
