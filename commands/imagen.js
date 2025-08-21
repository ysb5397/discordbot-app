// commands/imagen.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs'); // <--- 1. fs 모듈 추가 (파일 저장 테스트용이지만, 실제로는 필요 없음)

// Gemini 이미지 생성 API 관련 환경 변수
const imagenEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/image-generation-001:generateImages`;
const geminiKey = process.env.GEMINI_API_KEY;

module.exports = {
    // 1. 명령어 설정 수정
    data: new SlashCommandBuilder()
        .setName('imagen')
        .setDescription('Gemini AI에게 이미지 생성을 요청합니다.')
        .addStringOption(option => // <-- 3. addUserOption -> addStringOption 으로 변경
            option.setName('prompt')
                .setDescription('AI에게 요청할 이미지 프롬프트 내용 (영어로 작성 권장)')
                .setRequired(true)),
        // .addAttachmentOption() // Gemini 이미지 생성 모델은 이미지 입력을 받지 않으므로 일단 제거

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

        const prompt = interaction.options.getString('prompt'); // <-- 4. getUser -> getString 으로 변경
        const sessionId = interaction.user.id;

        // 5. Gemini API가 요구하는 형식에 맞게 요청 본문 수정
        const requestBody = {
            "prompt": prompt,
            "number_of_images": 1, // 생성할 이미지 개수
        };

        console.log(`[/imagen Session: ${sessionId}] Sending to Gemini API... Prompt: ${prompt}`);

        try {
            // 6. flowiseEndpoint -> imagenEndpoint 변수명 수정 및 헤더 정리
            const response = await fetch(imagenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json(); // Gemini 오류는 json 형식일 수 있음
                console.error(`[/imagen Session: ${sessionId}] Gemini API Error: ${response.status}`, errorData);
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 이미지 생성 중 오류가 발생했습니다.\n> Error: ${errorData.error.message}`);
                return;
            }

            const geminiResponse = await response.json();
            
            // 7. Base64 이미지 데이터 처리 및 디스코드로 바로 전송
            const imageData = geminiResponse.images[0].image; // 응답 구조에 맞게 수정
            const buffer = Buffer.from(imageData, 'base64');

            const replyEmbed = new EmbedBuilder()
                .setColor(0x4A90E2)
                .setTitle(`"${prompt}"`)
                .setImage('attachment://gemini-image.png') // <-- 8. 로컬 파일이 아닌 첨부파일을 참조하도록 변경
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });
            
            await interaction.editReply({
                content: `<@${interaction.user.id}>`,
                embeds: [replyEmbed],
                files: [{ // <-- 9. 이미지 버퍼를 파일로 직접 첨부
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