const { Events } = require('discord.js');
const { Interaction } = require('../../utils/database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateSmartReply(userMessage) {
    console.log(`답변 생성 시도: "${userMessage}"`);
    return Promise.resolve(`네가 "${userMessage}" 라고 말했구나! 나는 그걸 기억할게.`);
}

async function generateImageDescription(message) {
    try {
        const attachment = message.attachments.first();
        const visionModel = ai.getGenerativeModel({ model: "gemini-2.5-pro" });
        const prompt = "Describe this image for use as a searchable database entry. Be concise and factual. Answer in Korean.";
        
        const imageResponse = await fetch(attachment.url);
        if (!imageResponse.ok) return `파일을 불러오는데 실패했어: ${imageResponse.statusText}`;
        
        const imageBuffer = await imageResponse.buffer();
        const base64Data = imageBuffer.toString('base64');

        const imagePart = { inlineData: { data: base64Data, mimeType: attachment.contentType } };
        const result = await visionModel.generateContent([prompt, imagePart]);
        const description = result.response.text();
        return description;
    } catch (error) {
        console.error('AI 이미지 설명 생성 중 오류:', error);
        message.reply("미안, 이미지를 이해하는데 문제가 생긴 것 같아... 😵, 대신 DB에 파일명으로 저장할게.");
        return `AI가 파일을 분석하는 데 실패했어. 파일명: ${attachment.name}`;
    }
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

            // 텍스트 없이 파일만 있는 경우
            if (message.attachments.size > 0 && message.content.trim() === '') {
                const attachment = message.attachments.first();
                // 이미지만 처리 (동영상, 기타 파일은 일단 파일명으로 저장)
                if (attachment.contentType?.startsWith('image/')) {
                    await message.react('🤔'); // 생각 중이라는 표시
                    contentToSave = await generateImageDescription(message);
                    await message.reactions.cache.get('🤔')?.remove();
                    await message.react('✅'); // 처리 완료 표시
                } else {
                    contentToSave = `[파일] ${attachment.name}`;
                }
            }

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
    },
};
