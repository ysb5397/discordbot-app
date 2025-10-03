const { Events } = require('discord.js');
const { Interaction } = require('../../utils/database');
const { generateImageDescription, generateTextFileDescription } = require('../../utils/ai_helper');

async function generateSmartReply(userMessage) {
    console.log(`답변 생성 시도: "${userMessage}"`);
    return Promise.resolve(`네가 "${userMessage}" 라고 말했구나! 나는 그걸 기억할게.`);
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (message.author.bot) return;

        const shouldBotReply = message.mentions.has(client.user);

        if (shouldBotReply) {
            try {
                const botReplyText = await generateSmartReply(message.content);
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
                message.channel.send(botReplyText);
            } catch (error) {
                console.error('봇 답변 생성 중 오류 발생:', error);
                const newError = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'ERROR',
                    content: message.content,
                    botResponse: error.message
                });
                await newError.save();
                message.channel.send("미안, 지금은 생각 회로에 문제가 생긴 것 같아... 😵");
            }
        } else {
            let contentToSave = message.content;

            // --- 첨부파일 처리 로직 ---
            if (message.attachments.size > 0 && message.content.trim() === '') {
                if (message.attachments.size >= 5) {
                    await message.react('❌');
                    await message.reply('파일 분석은 한 번에 4개까지만 가능해! 😵');
                    return;
                }

                await message.react('🤔');

                const attachmentPromises = message.attachments.map(att => {
                    if (att.contentType?.startsWith('image/')) {
                        return generateImageDescription(att);
                    } else if (att.contentType?.startsWith('text/') || att.name.match(/\.(txt|md|js|json|html|css|py|java|c|cpp|h|hpp|cs|xml|yaml|log)$/i)) {
                        return generateTextFileDescription(att);
                    } else {
                        return Promise.resolve(`[기타 파일] ${att.name}`);
                    }
                });

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
                console.log(`'${message.author.username}'의 메시지를 저장했어: "${contentToSave}"`);
            }
        }
    },
};