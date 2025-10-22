const { Events } = require('discord.js');
const { Interaction } = require('../../utils/database');
const { generateAttachmentDescription, callFlowise, genAI } = require('../../utils/ai_helper');

/**
 * AI를 사용하여 문맥에 맞는 답변을 생성하는 함수
 * (Flowise 실패 시 Gemini로 폴백 기능 추가됨)
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
    
    // --- 4. ★★★ (수정됨) Flowise 호출 (try) / Gemini 폴백 (catch) ★★★
    try {
        console.log(`[Flowise Mention] '${sessionId}'님의 질문으로 에이전트 호출 시도...`);
        const aiResponseText = await callFlowise(requestBody, sessionId, 'mention-reply');
        
        try {
            const responseJson = JSON.parse(aiResponseText);
            return responseJson.text || "음... 뭐라고 답해야 할지 모르겠어.";
        } catch (e) {
            return aiResponseText;
        }

    } catch (flowiseError) {
        // --- 4B. (폴백) Flowise 실패 시 Gemini Pro 직접 호출 ---
        console.error(`[Flowise Mention] 에이전트 호출 실패. Gemini (Pro) 폴백으로 전환합니다.`, flowiseError);
        
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
            const result = await model.generateContent(message.content);
            const fallbackResponse = result.response.text();
            
            return `${fallbackResponse}\n\n*(앗, Flowise 에이전트 연결에 실패해서, Gemini 기본 모델이 대신 답했어!)*`;

        } catch (geminiError) {
            console.error(`[Gemini Fallback] 멘션 폴백조차 실패...`, geminiError);
            return "미안... Flowise도, Gemini 폴백도 모두 실패했어... 😭";
        }
    }
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
                console.error('봇 답변 처리/수정 중 오류 발생:', error);
                
                if (thinkingMessage) {
                    await thinkingMessage.edit("미안, 지금은 생각 회로에 문제가 생긴 것 같아... 😵");
                }
                
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
                console.log(`'${message.author.username}'의 메시지를 저장했어: "${contentToSave.substring(0, 50)}..."`);
            }
        }
    },
};