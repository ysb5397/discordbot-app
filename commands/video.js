const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { startVideoGeneration, checkVideoGenerationStatus, downloadVideoFromUri } = require('../utils/ai_helper.js');
const { createVideoGenEmbed } = require('../utils/embed_builder.js');

const POLLING_INTERVAL = 10000;
const MAX_ATTEMPTS = 18;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('video')
        .setDescription('Veo AI에게 영상 생성을 요청합니다.')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('생성할 영상에 대한 설명 (영어로 작성 권장)')
                .setRequired(true)),

    async execute(interaction) {
        const startTime = Date.now();
        await interaction.deferReply();

        const prompt = interaction.options.getString('prompt');

        try {
            await interaction.editReply(`⏳ AI가 프롬프트("${prompt.substring(0, 100)}...")를 분석하여 영상 생성 작업을 시작합니다...`);
            const operationName = await startVideoGeneration(prompt);

            if (!operationName) {
                throw new Error('영상 생성 작업을 시작하지 못했습니다.');
            }

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                await interaction.editReply(`🎬 영상 생성 중... 잠시만 기다려주세요. (${attempt}/${MAX_ATTEMPTS})`);

                const statusResponse = await checkVideoGenerationStatus(operationName);

                if (statusResponse.done) {
                    await interaction.editReply('✅ 영상 생성이 완료되었습니다! 최종 파일을 다운로드합니다...');
                    
                    const videoUri = statusResponse.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;

                    if (!videoUri) {
                        console.error("영상 URI를 찾을 수 없습니다. 전체 응답 객체:", JSON.stringify(statusResponse, null, 2));
                        throw new Error('생성된 영상의 URI를 응답에서 찾을 수 없습니다.');
                    }
                    
                    const videoBuffer = await downloadVideoFromUri(videoUri);
                    const attachment = new AttachmentBuilder(videoBuffer, { name: 'generated-video.mp4' });

                    const endTime = Date.now();
                    const duration = endTime - startTime;
                    
                    const embedTitle = prompt.length > 250 ? prompt.substring(0, 250) + '...' : prompt;

                    const resultEmbed = createVideoGenEmbed({
                        prompt: embedTitle,
                        duration: duration,
                        user: interaction.user
                    });
                        
                    await interaction.editReply({
                        content: `🎉 영상이 준비됐어!`,
                        embeds: [resultEmbed],
                        files: [attachment]
                    });
                    return;
                }

                await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
            }

            throw new Error(`영상 생성 시간이 너무 오래 걸려 타임아웃되었습니다. (${((Date.now() - startTime) / 1000).toFixed(0)}초 경과)`);

        } catch (error) {
            console.error('[/video] Error:', error);
            
            if (error.message.includes('Request entity too large')) {
                await interaction.editReply({ content: `❌ 영상 생성에는 성공했지만, 파일 크기가 너무 커서(25MB 이상) 디스코드에 업로드할 수 없어... 😥` });
            } else if (error.message.includes('타임아웃되었습니다')) {
                 await interaction.editReply({ content: `❌ ${error.message}` });
            } else {
                throw error;
            }
        }
    },
};