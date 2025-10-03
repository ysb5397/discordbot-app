// commands/imagen.js

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { generateImage } = require('../utils/ai_helper.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('imagen')
        .setDescription('Gemini AI에게 이미지 생성을 요청합니다.')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('생성할 이미지에 대한 설명 (영어로 작성 권장)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('imagecount')
                .setDescription('생성할 이미지 개수를 설정합니다. (기본: 1, 최대: 4)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(4)), // 설명과 값을 4로 통일

    async execute(interaction) {
        await interaction.deferReply();

        const prompt = interaction.options.getString('prompt');
        // 옵션이 제공되지 않으면 기본값 1을 사용
        const imageCount = interaction.options.getInteger('imagecount') || 1; 

        try {
            // 1. ai_helper의 함수를 호출해서 이미지 버퍼 배열을 받아옴
            const imageBuffers = await generateImage(prompt, imageCount);

            // 2. Buffer 배열을 Discord 첨부 파일 형식으로 변환
            const attachments = imageBuffers.map((buffer, index) => {
                return new AttachmentBuilder(buffer, { name: `gemini-image-${index + 1}.png` });
            });

            // 3. 결과 임베드 생성
            const replyEmbed = new EmbedBuilder()
                .setColor(0x4A90E2)
                .setTitle(`"${prompt}"`)
                .setDescription(`${attachments.length}개의 이미지가 생성되었습니다.`)
                .setImage(`attachment://${attachments[0].name}`) // 첫 번째 이미지를 대표로 표시
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });
            
            // 4. 임베드와 파일을 함께 전송
            await interaction.editReply({
                content: `<@${interaction.user.id}>`,
                embeds: [replyEmbed],
                files: attachments
            });

        } catch (error) {
            console.error(`[/imagen] Error:`, error);
            await interaction.editReply({
                content: `<@${interaction.user.id}> 죄송합니다, 이미지를 생성하는 중 오류가 발생했습니다.\n> ${error.message}`
            }).catch(console.error);
        }
    },
};
