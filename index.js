import { getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// The URL of your deployed Telegram Bridge server
// If you deploy this bridge somewhere else, update this URL!
const BRIDGE_URL = 'https://ais-dev-dt4nqv275ftc6hw74dddp2-167497036422.europe-west3.run.app';

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
                
                await fetch(`${BRIDGE_URL}/api/forward`, {
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
