// index.js

const {
    extensionSettings,
    deleteLastMessage,
    saveSettingsDebounced,
} = SillyTavern.getContext();

import {
    eventSource,
    event_types,
    getPastCharacterChats,
    sendMessageAsUser,
    doNewChat,
    selectCharacterById,
    openCharacterChat,
    Generate,
    setExternalAbortController,
} from "../../../../script.js";

// Dynamically determine the module name from the folder it's loaded from
const moduleUrl = new URL(import.meta.url);
const pathSegments = moduleUrl.pathname.split('/');
const MODULE_NAME = pathSegments[pathSegments.length - 2] || 'telegram-bridge';

const DEFAULT_SETTINGS = {
    bridgeUrl: 'ws://127.0.0.1:3000',
    autoConnect: true,
};

let ws = null;
let lastProcessedChatId = null;
let isStreamingMode = false;

function getSettings() {
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    }
    return extensionSettings[MODULE_NAME];
}

function updateStatus(message, color) {
    const statusEl = document.getElementById('telegram_connection_status');
    if (statusEl) {
        statusEl.textContent = `Status: ${message}`;
        statusEl.style.color = color;
    }
}

function reloadPage() {
    window.location.reload();
}

function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('[Telegram Bridge] Already connected');
        return;
    }

    const settings = getSettings();
    if (!settings.bridgeUrl) {
        updateStatus('URL not set!', 'red');
        return;
    }

    updateStatus('Connecting...', 'orange');
    console.log(`[Telegram Bridge] Connecting to ${settings.bridgeUrl}...`);

    ws = new WebSocket(settings.bridgeUrl);

    ws.onopen = () => {
        console.log('[Telegram Bridge] Connected successfully!');
        updateStatus('Connected', 'green');
    };

    ws.onmessage = async (event) => {
        let data;
        try {
            data = JSON.parse(event.data);

            if (data.type === 'user_message') {
                console.log('[Telegram Bridge] Received user message.', data);
                lastProcessedChatId = data.chatId;
                isStreamingMode = false;

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'typing_action', chatId: data.chatId }));
                }

                await sendMessageAsUser(data.text);

                try {
                    const abortController = new AbortController();
                    setExternalAbortController(abortController);
                    await Generate('normal', { signal: abortController.signal });
                } catch (error) {
                    console.error("[Telegram Bridge] Generate() Error:", error);
                    await deleteLastMessage();
                    
                    const errorMessage = `Sorry, an error occurred while generating the AI reply.\nYour last message was withdrawn, please try again.\n\nError details: ${error.message || 'Unknown error'}`;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'error_message',
                            chatId: data.chatId,
                            text: errorMessage,
                        }));
                    }
                }
                return;
            }

            if (data.type === 'system_command') {
                console.log('[Telegram Bridge] Received system command', data);
                if (data.command === 'reload_ui_only') {
                    console.log('[Telegram Bridge] Reloading UI...');
                    setTimeout(reloadPage, 500);
                }
                return;
            }

            if (data.type === 'execute_command') {
                console.log('[Telegram Bridge] Executing command', data);

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'typing_action', chatId: data.chatId }));
                }

                let replyText = 'Command execution failed, please try again later.';
                const context = SillyTavern.getContext();
                let commandSuccess = false;

                try {
                    switch (data.command) {
                        case 'new':
                            await doNewChat({ deleteCurrentChat: false });
                            replyText = 'A new chat has started.';
                            commandSuccess = true;
                            break;
                        case 'listchars': {
                            const characters = context.characters.slice(1);
                            if (characters.length > 0) {
                                replyText = 'Available characters:\n\n';
                                characters.forEach((char, index) => {
                                    replyText += `${index + 1}. /switchchar_${index + 1} - ${char.name}\n`;
                                });
                                replyText += '\nUse /switchchar_number or /switchchar name to switch characters';
                            } else {
                                replyText = 'No available characters found.';
                            }
                            commandSuccess = true;
                            break;
                        }
                        case 'switchchar': {
                            if (!data.args || data.args.length === 0) {
                                replyText = 'Please provide a character name or number. Usage: /switchchar <name> or /switchchar_number';
                                break;
                            }
                            const targetName = data.args.join(' ');
                            const characters = context.characters;
                            const targetChar = characters.find(c => c.name === targetName);

                            if (targetChar) {
                                const charIndex = characters.indexOf(targetChar);
                                await selectCharacterById(charIndex);
                                replyText = `Successfully switched to character "${targetName}".`;
                                commandSuccess = true;
                            } else {
                                replyText = `Character "${targetName}" not found.`;
                            }
                            break;
                        }
                        case 'listchats': {
                            if (context.characterId === undefined) {
                                replyText = 'Please select a character first.';
                                break;
                            }
                            const chatFiles = await getPastCharacterChats(context.characterId);
                            if (chatFiles.length > 0) {
                                replyText = 'Chat history for current character:\n\n';
                                chatFiles.forEach((chat, index) => {
                                    const chatName = chat.file_name.replace('.jsonl', '');
                                    replyText += `${index + 1}. /switchchat_${index + 1} - ${chatName}\n`;
                                });
                                replyText += '\nUse /switchchat_number or /switchchat name to switch chats';
                            } else {
                                replyText = 'No chat history found for the current character.';
                            }
                            commandSuccess = true;
                            break;
                        }
                        case 'switchchat': {
                            if (!data.args || data.args.length === 0) {
                                replyText = 'Please provide a chat name. Usage: /switchchat <name>';
                                break;
                            }
                            const targetChatFile = `${data.args.join(' ')}`;
                            try {
                                await openCharacterChat(targetChatFile);
                                replyText = `Loaded chat: ${targetChatFile}`;
                                commandSuccess = true;
                            } catch (err) {
                                console.error(err);
                                replyText = `Failed to load chat "${targetChatFile}". Please ensure the name is correct.`;
                            }
                            break;
                        }
                        default: {
                            const charMatch = data.command.match(/^switchchar_(\d+)$/);
                            if (charMatch) {
                                const index = parseInt(charMatch[1]) - 1;
                                const characters = context.characters.slice(1);
                                if (index >= 0 && index < characters.length) {
                                    const targetChar = characters[index];
                                    const charIndex = context.characters.indexOf(targetChar);
                                    await selectCharacterById(charIndex);
                                    replyText = `Switched to character "${targetChar.name}".`;
                                    commandSuccess = true;
                                } else {
                                    replyText = `Invalid character number: ${index + 1}. Use /listchars to see available characters.`;
                                }
                                break;
                            }

                            const chatMatch = data.command.match(/^switchchat_(\d+)$/);
                            if (chatMatch) {
                                if (context.characterId === undefined) {
                                    replyText = 'Please select a character first.';
                                    break;
                                }
                                const index = parseInt(chatMatch[1]) - 1;
                                const chatFiles = await getPastCharacterChats(context.characterId);

                                if (index >= 0 && index < chatFiles.length) {
                                    const targetChat = chatFiles[index];
                                    const chatName = targetChat.file_name.replace('.jsonl', '');
                                    try {
                                        await openCharacterChat(chatName);
                                        replyText = `Loaded chat: ${chatName}`;
                                        commandSuccess = true;
                                    } catch (err) {
                                        console.error(err);
                                        replyText = `Failed to load chat.`;
                                    }
                                } else {
                                    replyText = `Invalid chat number: ${index + 1}. Use /listchats to see available chats.`;
                                }
                                break;
                            }

                            replyText = `Unknown command: /${data.command}. Use /help to see all commands.`;
                        }
                    }
                } catch (error) {
                    console.error('[Telegram Bridge] Error executing command:', error);
                    replyText = `Error executing command: ${error.message || 'Unknown error'}`;
                }

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ai_reply', chatId: data.chatId, text: replyText }));
                    ws.send(JSON.stringify({
                        type: 'command_executed',
                        command: data.command,
                        success: commandSuccess,
                        message: replyText
                    }));
                }

                return;
            }
        } catch (error) {
            console.error('[Telegram Bridge] Error processing request:', error);
            if (data && data.chatId && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error_message', chatId: data.chatId, text: 'An internal error occurred while processing your request.' }));
            }
        }
    };

    ws.onclose = () => {
        console.log('[Telegram Bridge] Connection closed.');
        updateStatus('Disconnected', 'red');
        ws = null;
    };

    ws.onerror = (error) => {
        console.error('[Telegram Bridge] WebSocket Error:', error);
        updateStatus('Connection Error', 'red');
        ws = null;
    };
}

function disconnect() {
    if (ws) {
        ws.close();
    }
}

jQuery(async () => {
    console.log('[Telegram Bridge] Attempting to load settings UI...');
    try {
        const settingsHtml = await $.get(`/scripts/extensions/third-party/${MODULE_NAME}/settings.html`);
        $('#extensions_settings').append(settingsHtml);
        console.log('[Telegram Bridge] Settings UI added.');

        const settings = getSettings();
        $('#telegram_bridge_url').val(settings.bridgeUrl);
        $('#telegram_auto_connect').prop('checked', settings.autoConnect);

        $('#telegram_bridge_url').on('input', () => {
            const settings = getSettings();
            settings.bridgeUrl = $('#telegram_bridge_url').val();
            saveSettingsDebounced();
        });

        $('#telegram_auto_connect').on('change', function () {
            const settings = getSettings();
            settings.autoConnect = $(this).prop('checked');
            saveSettingsDebounced();
        });

        $('#telegram_connect_button').on('click', connect);
        $('#telegram_disconnect_button').on('click', disconnect);

        if (settings.autoConnect) {
            console.log('[Telegram Bridge] Auto-connect enabled, connecting...');
            connect();
        }

    } catch (error) {
        console.error('[Telegram Bridge] Failed to load settings HTML.', error);
    }
    console.log('[Telegram Bridge] Extension loaded.');
});

// Global event listeners for streaming and final messages
eventSource.on(event_types.STREAM_TOKEN_RECEIVED, (cumulativeText) => {
    isStreamingMode = true;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stream_chunk',
            chatId: lastProcessedChatId || 'default',
            text: cumulativeText,
        }));
    }
});

function handleStreamEnd() {
    if (ws && ws.readyState === WebSocket.OPEN && isStreamingMode) {
        ws.send(JSON.stringify({ type: 'stream_end', chatId: lastProcessedChatId || 'default' }));
    }
}

function handleFinalMessage(lastMessageIdInChatArray) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }

    const lastMessageIndex = lastMessageIdInChatArray - 1;
    if (lastMessageIndex < 0) return;

    setTimeout(() => {
        const context = SillyTavern.getContext();
        const lastMessage = context.chat[lastMessageIndex];

        if (lastMessage && !lastMessage.is_user && !lastMessage.is_system) {
            const messageElement = $(`#chat .mes[mesid="${lastMessageIndex}"]`);

            if (messageElement.length > 0) {
                const messageTextElement = messageElement.find('.mes_text');

                let renderedText = messageTextElement.html()
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>\s*<p>/gi, '\n\n');

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = renderedText;
                renderedText = tempDiv.textContent;

                const targetChatId = lastProcessedChatId || 'default';
                console.log(`[Telegram Bridge] Captured final text, sending update to chatId: ${targetChatId}`);

                if (isStreamingMode) {
                    ws.send(JSON.stringify({
                        type: 'final_message_update',
                        chatId: targetChatId,
                        text: renderedText,
                    }));
                    isStreamingMode = false;
                } else {
                    ws.send(JSON.stringify({
                        type: 'ai_reply',
                        chatId: targetChatId,
                        text: renderedText,
                    }));
                }
            }
        }
    }, 100);
}

eventSource.on(event_types.GENERATION_ENDED, () => {
    handleStreamEnd();
    handleFinalMessage(SillyTavern.getContext().chat.length);
});

eventSource.on(event_types.GENERATION_STOPPED, () => {
    handleStreamEnd();
    handleFinalMessage(SillyTavern.getContext().chat.length);
});
