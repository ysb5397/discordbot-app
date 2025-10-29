const { SlashCommandBuilder, AttachmentBuilder, InteractionContextType } = require('discord.js');
const { generateImage } = require('../utils/ai_helper.js');
const { createImageGenEmbed } = require('../utils/embed_builder.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('imagen')
        .setDescription('Gemini AI에게 이미지 생성을 요청합니다.')
        .setContexts([
            InteractionContextType.Guild,          // 1. 서버
            InteractionContextType.BotDM,          // 2. 봇과의 1:1 DM
            InteractionContextType.PrivateChannel, // 3. 그룹 DM
        ])
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('생성할 이미지에 대한 설명 (영어로 작성 권장)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('imagecount')
                .setDescription('생성할 이미지 개수를 설정합니다. (기본: 1, 최대: 4)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(4)),

    async execute(interaction) {
        const startTime = Date.now();
        await interaction.deferReply();

        const prompt = interaction.options.getString('prompt');
        const imageCount = interaction.options.getInteger('imagecount') || 1; 

        const imageBuffers = await generateImage(prompt, imageCount);

        const attachments = imageBuffers.map((buffer, index) => {
            return new AttachmentBuilder(buffer, { name: `gemini-image-${index + 1}.png` });
        });

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        const replyEmbed = createImageGenEmbed({
            prompt: prompt.substring(0, 250) + (prompt.length > 250 ? '...' : ''),
            imageCount: imageCount,
            attachmentUrl: `attachment://${attachments[0].name}`,
            duration: duration,
            user: interaction.user
        });
        
        await interaction.editReply({
            content: `<@${interaction.user.id}>`,
            embeds: [replyEmbed],
            files: attachments
        });
    },
};