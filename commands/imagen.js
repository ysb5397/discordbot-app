const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, InteractionContextType } = require('discord.js');
const { generateImage } = require('../utils/ai_helper.js');

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
        await interaction.deferReply();

        const prompt = interaction.options.getString('prompt');
        const imageCount = interaction.options.getInteger('imagecount') || 1; 

        try {
            const imageBuffers = await generateImage(prompt, imageCount);

            const attachments = imageBuffers.map((buffer, index) => {
                return new AttachmentBuilder(buffer, { name: `gemini-image-${index + 1}.png` });
            });

            const replyEmbed = new EmbedBuilder()
                .setColor(0x4A90E2)
                .setTitle(`"${prompt}"`)
                .setDescription(`${attachments.length}개의 이미지가 생성되었습니다.`)
                .setImage(`attachment://${attachments[0].name}`)
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });
            
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