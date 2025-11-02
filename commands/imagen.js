const { SlashCommandBuilder, AttachmentBuilder, InteractionContextType, Client, GatewayIntentBits } = require('discord.js');
const { generateImage } = require('../utils/ai_helper.js');
const { createImageGenEmbed } = require('../utils/embed_builder.js');
const { logToDiscord } = require('../utils/catch_log.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildVoiceStates
    ]
});

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

        try{
            const imageBuffers = await generateImage(prompt, imageCount);

            const attachments = imageBuffers.map((buffer, index) => {
                return new AttachmentBuilder(buffer, { name: `gemini-image-${index + 1}.png` });
            });

            const endTime = Date.now();
            const duration = endTime - startTime;

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
        } catch (error) {
            if (error.message && (error.message.includes("Responsible AI practices") || error.message.includes("safety policies"))) {
                console.warn(`[/imagen] Google AI 안전 필터가 프롬프트를 차단했습니다: "${prompt}"`);
                
                await interaction.editReply({
                    content: `❌ <@${interaction.user.id}>, 네 프롬프트가 Google의 AI 안전 정책에 위반되어 이미지를 생성할 수 없었어.\n\n> " ${prompt.substring(0, 1000)}... "\n\n프롬프트를 좀 더 순화해서 다시 시도해볼래?`
                });
            } else {
                logToDiscord(client, 'ERROR', '이미지 생성 실패', interaction, error, 'imagen_execute');
                throw error;
            }
        }
    },
};