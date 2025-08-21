// commands/imagen.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');

// Gemini 이미지 생성 API 관련 환경 변수
const imagenEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent`;
const geminiKey = process.env.GEMINI_API_KEY;

module.exports = {
    // 1. 명령어 설정 수정
    data: new SlashCommandBuilder()
        .setName('imagen')
        .setDescription('Gemini AI에게 이미지 생성을 요청합니다.')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('AI에게 요청할 이미지 프롬프트 내용 (영어로 작성 권장)')
                .setRequired(true)),


    // 2. 명령어 실행 로직
    async execute(interaction) {
        if (!geminiKey) {
            console.error("[Imagen] GEMINI_API_KEY가 설정되지 않았습니다.");
            return interaction.reply({ content: "이미지 생성 API 키가 설정되지 않아 명령어를 실행할 수 없습니다.", ephemeral: true });
        }

        try {
            await interaction.deferReply();
        } catch (e) {
            console.error("Defer failed:", e);
            return;
        }

        const prompt = interaction.options.getString('prompt');
        const sessionId = interaction.user.id;


        const requestBody = {
            "contents": [{
                "parts": [
                    { "text": prompt }
                ]
            }],
            "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
        };

        console.log(`[/imagen Session: ${sessionId}] Sending to Gemini API... Prompt: ${prompt}`);

        try {

            const response = await fetch(imagenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error(`[/imagen Session: ${sessionId}] Gemini API Error: ${response.status}`, errorData);
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 이미지 생성 중 오류가 발생했습니다.\n> Error: ${errorData.error.message}`);
                return;
            }

            const geminiResponse = await response.json();


            const imageData = geminiResponse.images[0].image;
            const buffer = Buffer.from(imageData, 'base64');

            const replyEmbed = new EmbedBuilder()
                .setColor(0x4A90E2)
                .setTitle(`"${prompt}"`)
                .setImage('attachment://gemini-image.png')
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            await interaction.editReply({
                content: `<@${interaction.user.id}>`,
                embeds: [replyEmbed],
                files: [{
                    attachment: buffer,
                    name: 'gemini-image.png'
                }]
            });

        } catch (error) {
            console.error(`[/imagen Session: ${sessionId}] Error processing Gemini request:`, error);
            try {
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`);
            } catch (e) {
                console.error("Edit reply failed:", e);
            }
        }
    },
};
