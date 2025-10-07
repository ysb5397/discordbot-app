// commands/video.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { startVideoGeneration, checkVideoGenerationStatus } = require('../utils/ai_helper.js');

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
        await interaction.deferReply();

        const prompt = interaction.options.getString('prompt');

        try {
            await interaction.editReply(`⏳ AI가 프롬프트("${prompt}")를 분석하여 영상 생성 작업을 시작합니다...`);
            const operationName = await startVideoGeneration(prompt);

            if (!operationName) {
                throw new Error('영상 생성 작업을 시작하지 못했습니다.');
            }

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                await interaction.editReply(`🎬 영상 생성 중... 잠시만 기다려주세요. (${attempt}/${MAX_ATTEMPTS})`);

                const statusResponse = await checkVideoGenerationStatus(operationName);

                if (statusResponse.done) {
                    await interaction.editReply('✅ 영상 생성이 완료되었습니다! 최종 파일을 처리 중입니다...');
                    console.log("===== Veo API 최종 응답 객체 =====");
                    console.log(JSON.stringify(statusResponse, null, 2));
                    console.log("===================================");

                    const videoUri = statusResponse.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;

                    if (!videoUri) {
                        await interaction.editReply({
                            content: `❌ 생성된 영상의 URL을 찾을 수 없습니다.`
                        });
                        return;
                    }
                    
                    const resultEmbed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle(`"${prompt}"`)
                        .setDescription(`영상 생성이 완료되었어! 아래 링크를 확인해봐.`)
                        .setFooter({ text: `Requested by ${interaction.user.tag}` })
                        .setTimestamp();
                        
                    await interaction.editReply({
                        content: `🎉 영상이 준비됐어!\n${videoUri}`,
                        embeds: [resultEmbed]
                    });
                    return;
                }

                await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
            }

            throw new Error('영상 생성 시간이 너무 오래 걸려 타임아웃되었습니다.');

        } catch (error) {
            console.error('[/video] Error:', error);
            await interaction.editReply({
                content: `❌ 영상을 생성하는 중 오류가 발생했습니다.\n> ${error.message}`
            }).catch(console.error);
        }
    },
};