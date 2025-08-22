// commands/imagen.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');

// Gemini 이미지 생성 API 관련 환경 변수
const imagenEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict`;
const geminiKey = process.env.GEMINI_API_KEY;

module.exports = {
    // 1. 명령어 설정 수정
    data: new SlashCommandBuilder()
        .setName('imagen')
        .setDescription('Gemini AI에게 이미지 생성을 요청합니다.')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('AI에게 요청할 이미지 프롬프트 내용 (영어로 작성 권장)')
                .setRequired(true))
        .addIntegerOption(option => // <-- .addNumberOption을 .addIntegerOption으로 변경
            option.setName('imagecount') // Discord에서는 옵션 이름이 소문자여야 합니다.
                .setDescription('AI가 만드는 이미지의 개수를 설정합니다. (기본: 1, 최대: 8)')
                .setRequired(false)
                .setMinValue(1) // 최소값 설정
                .setMaxValue(4)),


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
        const imageCount = interaction.option.getNumber('imageCount');
        const sessionId = interaction.user.id;


        const requestBody = {
            "instances": [
                {
                "prompt": prompt
                }
            ],
            "parameters": {
                "sampleCount": imageCount
            }
        };

        console.log(`[/imagen Session: ${sessionId}] Sending to Gemini API... Prompt: ${prompt}`);

        try {
    const response = await fetch(imagenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' /* 'x-goog-api-key' is usually not needed if key is in URL */ },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error(`[/imagen Session: ${sessionId}] Gemini API Error: ${response.status}`, errorData);
        await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 이미지 생성 중 오류가 발생했습니다.\n> Error: ${errorData.error.message}`);
        return;
    }

    const geminiResponse = await response.json();
    const predictions = geminiResponse.predictions;

    if (!predictions || predictions.length === 0) {
        return interaction.editReply(`<@${interaction.user.id}> AI로부터 이미지를 생성하지 못했습니다.`);
    }

    // 1. 여러 개의 첨부 파일을 담을 배열을 준비합니다.
    const attachments = [];

    // 2. forEach 반복문을 사용해 각 예측 결과를 순회합니다.
    predictions.forEach((prediction, index) => {
        // 3. 각 이미지의 Base64 데이터를 올바르게 추출합니다.
        const imageBase64 = prediction.bytesBase64Encoded;
        
        // 4. Base64를 Buffer로 변환합니다.
        const buffer = Buffer.from(imageBase64, 'base64');
        
        // 5. 각 이미지를 AttachmentBuilder를 사용해 첨부 파일 객체로 만듭니다.
        attachments.push({
            attachment: buffer,
            name: `gemini-image-${index + 1}.png` // (예: gemini-image-1.png)
        });
    });

    // 6. 첫 번째 이미지를 썸네일로 보여줄 Embed를 만듭니다.
    const replyEmbed = new EmbedBuilder()
        .setColor(0x4A90E2)
        .setTitle(`"${prompt}"`)
        .setDescription(`${attachments.length}개의 이미지가 생성되었습니다.`)
        .setImage(`attachment://${attachments[0].name}`) // 첫 번째 이미지 이름을 참조
        .setTimestamp()
        .setFooter({ text: `Requested by ${interaction.user.tag}` });

    // 7. 생성된 모든 첨부 파일을 'files' 배열에 담아 한 번에 전송합니다.
    await interaction.editReply({
        content: `<@${interaction.user.id}>`,
        embeds: [replyEmbed],
        files: attachments
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
