const { Events } = require('discord.js');
const { Interaction } = require('../../utils/database');
const { generateAttachmentDescription, callFlowise } = require('../../utils/ai_helper');

/**
 * AI를 사용하여 문맥에 맞는 답변을 생성하는 함수
 * (Flowise 실패 시 Gemini로 폴백 기능은 callFlowise가 담당)
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
    };

    if (history.length > 0) {
        requestBody.history = history;
    }
    
    console.log(`[Flowise Mention] '${sessionId}'님의 질문으로 에이전트 호출 시도...`);
    
    const aiResponseText = await callFlowise(requestBody, sessionId, 'mention-reply');
    
    const responseJson = JSON.parse(aiResponseText);
    return responseJson.text || "음... 뭐라고 답해야 할지 모르겠어.";
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (message.author.bot) return;

        const shouldBotReply = message.mentions.has(client.user);

        if (shouldBotReply) {
            let thinkingMessage = null;
            try {
                thinkingMessage = await message.reply("잠깐만... 생각 중이야! 🤔");
            } catch (replyError) {
                try {
                    thinkingMessage = await message.channel.send("잠깐만... 생각 중이야! 🤔");
                } catch (sendError) {
                    console.error("멘션 응답 '생각 중' 메시지 전송 실패:", sendError);
                    return;
                }
            }

            try {
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
                await thinkingMessage.edit(botReplyText);

            } catch (error) {
                // (유지) generateSmartReply가 실패했을 때의 최종 방어선
                console.error('봇 답변 처리/수정 중 오류 발생:', error);
                
                if (thinkingMessage) {
                    await thinkingMessage.edit("미안, 지금은 생각 회로에 문제가 생긴 것 같아... 😵");
                }
                
                // (유지) 실패 기록을 DB에 저장
                const newError = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'ERROR',
                    content: `멘션 답변 생성/수정 실패: ${message.content}`,
                    botResponse: error.message
                });
                await newError.save();
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
                console.log(`'${message.author.username}'의 메시지를 저장했습니다: "${contentToSave.substring(0, 50)}..."`);
            }
        }
    },
};