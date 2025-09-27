const { Events } = require('discord.js');
const { Interaction } = require('../../utils/database');

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
            const newMessage = new Interaction({
                interactionId: message.id,
                userId: message.author.id,
                userName: message.author.username,
                type: 'MESSAGE',
                content: message.content
            });
            await newMessage.save();
            console.log(`'${message.author.username}'의 메시지를 저장했어: "${message.content}"`);
        }
    },
};
