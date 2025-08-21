// commands/chat.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');

// Flowise 관련 환경 변수
const imagenEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent";
const geminiKey = process.env.GEMINI_API_KEY;

module.exports = {
    // 1. 명령어 설정
    data: new SlashCommandBuilder()
        .setName('imagen')
        .setDescription('AI에게 이미지 생성을 요청합니다.')
        .addUserOption(option =>
            option.setName('prompt')
                .setDescription('AI에게 요청할 이미지 프롬프트 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 이미지를 첨부하세요')
                .setRequired(false)),

    // 2. 명령어 실행 로직
    async execute(interaction) {
        if (interaction.deferred || interaction.replied) return;
        try { await interaction.deferReply(); } catch (e) { console.error("Defer failed:", e); return; }

        const userQuestion = interaction.options.getUser('prompt');
        const sessionId = interaction.user.id;
        const attachment = interaction.options.getAttachment('file');
        const botName = interaction.client.user.username; // client 객체에서 봇 이름 가져오기

        const requestBody = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": userQuestion
                        }
                    ]
                }],
            "generationConfig": {
                "responseModalities": [
                    "TEXT",
                    "IMAGE"]
            }
        };
        if (attachment) {
            requestBody.uploads = [{ type: 'url', name: attachment.name, mime: attachment.contentType || 'application/octet-stream', data: attachment.url }];
        }

        console.log(`[/chat Session: ${sessionId}] Sending to Flowise...`);

        try {
            const response = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[/imagen Session: ${sessionId}] Gemini API Error: ${response.status}`, errorData);
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 이미지 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            const geminiResponse = await response.json();
            const part = geminiResponse.candidates[0].content.parts;
            const replyEmbed = new EmbedBuilder()
                .setColor(0x00FA9A)
                .setDescription(part[0] || 'AI로부터 이미지를 받지 못했습니다.')
                .setTimestamp()
                .setFooter({ text: '해당 이미지는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });

            if (part[1]) {
                const imageData = part[1].inlineData.data;
                const buffer = Buffer.from(imageData, 'base64');
                FileSystem.writeFileSync("gemini-image.png", buffer);
                replyEmbed.setImage(geminiResponse.imageUrl);
            }

            await interaction.editReply({ content: `<@${interaction.user.id}>`, embeds: [replyEmbed] });

        } catch (error) {
            console.error(`[/imagen Session: ${sessionId}] Error processing gemini request:`, error);
            try { await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`); } catch (e) { console.error("Edit reply failed:", e); }
        }
    },
};