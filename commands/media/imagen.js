const { SlashCommandBuilder, AttachmentBuilder, InteractionContextType, Client, GatewayIntentBits } = require('discord.js');
const { generateImage } = require('../../utils/ai/ai_helper.js');
const { createImageGenEmbed } = require('../../utils/ui/embed_builder.js');
const { logToDiscord } = require('../../utils/system/catch_log.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
    ]
});

module.exports = {
    data: new SlashCommandBuilder()
        .setName('imagen')
        .setDescription('Gemini AI에게 이미지 생성을 요청합니다.(Nano Banana 2)')
        .setContexts([
            InteractionContextType.Guild,          // 1. 서버
            InteractionContextType.BotDM,          // 2. 봇과의 1:1 DM
            InteractionContextType.PrivateChannel, // 3. 그룹 DM
        ])
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('생성할 이미지에 대한 설명 (영어로 작성 권장)')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('reference_image')
                .setDescription('참조할 이미지가 있다면 첨부해줘 (선택)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('aspect_ratio')
                .setDescription('이미지 비율')
                .setRequired(false)
                .addChoices(
                    { name: '1:1 (Square)', value: '1:1' },
                    { name: '16:9 (Landscape)', value: '16:9' },
                    { name: '9:16 (Portrait)', value: '9:16' },
                    { name: '4:3', value: '4:3' },
                    { name: '3:4', value: '3:4' }
                ))
        .addStringOption(option =>
            option.setName('resolution')
                .setDescription('해상도 (기본: 1K)')
                .setRequired(false)
                .addChoices(
                    { name: '1K', value: '1K' },
                    { name: '2K', value: '2K' },
                    { name: '4K', value: '4K' }
                )),

    async execute(interaction) {
        const startTime = Date.now();
        await interaction.deferReply();

        const prompt = interaction.options.getString('prompt');

        const referenceImage = interaction.options.getAttachment('reference_image');
        const aspectRatio = interaction.options.getString('aspect_ratio') || '1:1';
        const resolution = interaction.options.getString('resolution') || '1K';

        try {
            const imageBuffers = await generateImage({
                prompt,
                aspectRatio,
                resolution,
                referenceImageUrl: referenceImage ? referenceImage.url : null,
                mimeType: referenceImage ? referenceImage.contentType : null
            });

            const attachments = imageBuffers.map((buffer, index) => {
                return new AttachmentBuilder(buffer, { name: `gemini-3.0-image-${index + 1}.png` });
            });

            const endTime = Date.now();
            const duration = endTime - startTime;

            const replyEmbed = createImageGenEmbed({
                prompt: prompt.substring(0, 250) + (prompt.length > 250 ? '...' : ''),
                imageCount: attachments.length,
                attachmentUrl: `attachment://${attachments[0].name}`,
                duration: duration,
                user: interaction.user
            });

            await interaction.editReply({
                content: `<@${interaction.user.id}>`,
                embeds: [replyEmbed],
                files: attachments
            });
        } catch (error) {
            if (error.message && (error.message.includes("Responsible AI") || error.message.includes("safety"))) {
                console.warn(`[/imagen] 안전 필터 차단: "${prompt}"`);
                await interaction.editReply({
                    content: `❌ <@${interaction.user.id}>, 안전 정책 때문에 이미지를 생성할 수 없어. 프롬프트를 수정해봐.`
                });
            } else {
                logToDiscord(interaction.client, 'ERROR', '이미지 생성 실패', interaction, error, 'imagen_execute');
                await interaction.editReply({ content: `❌ 오류가 발생했어: ${error.message}` });
            }
        }
    },
};