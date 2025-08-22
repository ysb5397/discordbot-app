// commands/chat.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');

// Flowise 관련 환경 변수
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

module.exports = {
    // 1. 명령어 설정
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    
    // 2. 명령어 실행 로직
    async execute(interaction) {
        if (interaction.deferred || interaction.replied) return;
        try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const attachment = interaction.options.getAttachment('file');
        const botName = interaction.client.user.username; // client 객체에서 봇 이름 가져오기

        const requestBody = {
            question: userQuestion,
            overrideConfig: { sessionId: sessionId, vars: { bot_name: botName } }
        };
        if (attachment) {
            requestBody.uploads = [{ type: 'url', name: attachment.name, mime: attachment.contentType || 'application/octet-stream', data: attachment.url }];
            const images = [];

            for (var i = 0; i < requestBody.uploads.length; i++) {
               images[i] = Buffer.to(requestBody.uploads[i], 'base64');
               fs.writeFileSync('gemini-image.png', images[i]);
            }

            requestBody.uploads = images;
        }

        console.log(`[/chat Session: ${sessionId}] Sending to Flowise...`);

        try {
            const response = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[/chat Session: ${sessionId}] Flowise API Error: ${response.status}`, errorData);
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            const flowiseResponse = await response.json();
            const replyEmbed = new EmbedBuilder()
                .setColor(0x00FA9A)
                .setDescription(flowiseResponse.text || 'AI로부터 답변을 받지 못했습니다.')
                .setTimestamp()
                .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });

            if (flowiseResponse.imageUrl) {
                replyEmbed.setImage(flowiseResponse.imageUrl);
            }

            await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: [replyEmbed] });

        } catch (error) {
            console.error(`[/chat Session: ${sessionId}] Error processing Flowise request:`, error);
            try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
        }
    },
};
