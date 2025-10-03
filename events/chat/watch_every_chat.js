const { Events } = require('discord.js');
const { Interaction } = require('../../utils/database');
const { generateAttachmentDescription, callFlowise } = require('../../utils/ai_helper');

/**
 * AI를 사용하여 문맥에 맞는 답변을 생성하는 함수
 * @param {import('discord.js').Message} message - 사용자가 보낸 메시지 객체
 * @returns {Promise<string>} AI가 생성한 답변 문자열
 */
async function generateSmartReply(message) {
    const sessionId = message.author.id;
    const botName = message.client.user.username;
    
    const recentInteractions = await Interaction.find({ 
        userId: sessionId, 
        type: { $in: ['MESSAGE', 'MENTION'] } 
    }).sort({ timestamp: -1 }).limit(10);
    
    const history = recentInteractions.reverse().flatMap(doc => {
        const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
        const userTurn = { role: 'user', content: userMessage };
        if (doc.type === 'MENTION' && doc.botResponse) {
            return [userTurn, { role: 'assistant', content: doc.botResponse }];
        }
        return userTurn;
    });

    const requestBody = {
        question: message.content,
        overrideConfig: { 
            sessionId: `flowise-mention-${sessionId}`,
            vars: { bot_name: botName } 
        },
        history: history
    };
    
    console.log(`AI 답변 생성 시도: "${message.content}"`);
    const aiResponseText = await callFlowise(requestBody, sessionId, 'mention-reply');
    
    try {
        const responseJson = JSON.parse(aiResponseText);
        return responseJson.text || "음... 뭐라고 답해야 할지 모르겠어.";
    } catch (e) {
        return aiResponseText;
    }
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (message.author.bot) return;

        const shouldBotReply = message.mentions.has(client.user);

        if (shouldBotReply) {
            try {
                await message.channel.sendTyping();
                
                const botReplyText = await generateSmartReply(message);

                const newMention = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'MENTION',
                    content: message.content,
                    botResponse: botReplyText
                });
                await newMention.save();
                message.reply(botReplyText);
            } catch (error) {
                console.error('봇 답변 생성 중 오류 발생:', error);
                const newError = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'ERROR',
                    content: `멘션 답변 생성 실패: ${message.content}`,
                    botResponse: error.message
                });
                await newError.save();
                message.reply("미안, 지금은 생각 회로에 문제가 생긴 것 같아... 😵");
            }
        } else {
            let contentToSave = message.content;

            if (message.attachments.size > 0 && message.content.trim() === '') {
                 if (message.attachments.size >= 5) {
                    await message.react('❌');
                    await message.reply('파일 분석은 한 번에 4개까지만 가능해! 😵');
                    return;
                }
                
                await message.react('🤔');

                const attachmentPromises = message.attachments.map(att => generateAttachmentDescription(att));

                const results = await Promise.all(attachmentPromises);
                contentToSave = results.join('\n\n');
                
                await message.reactions.cache.get('🤔')?.remove();
                await message.react('✅');
            }

            if (contentToSave.trim() !== '') {
                const newMessage = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'MESSAGE',
                    content: contentToSave
                });
                await newMessage.save();
                console.log(`'${message.author.username}'의 메시지를 저장했어: "${contentToSave.substring(0, 50)}..."`);
            }
        }
    },
};