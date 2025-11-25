const { SlashCommandBuilder, InteractionContextType, AttachmentBuilder } = require('discord.js');
const { deepResearch } = require('../utils/ai_helper.js');
const { createAiResponseEmbed } = require('../utils/embed_builder.js');
const { logToDiscord } = require('../utils/catch_log.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('research')
        .setDescription('AI 에이전트가 심층 리서치를 수행하고 보고서를 작성합니다. (시간 소요됨)')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ])
        .addStringOption(option =>
            option.setName('topic')
                .setDescription('조사할 주제')
                .setRequired(true)),

    async execute(interaction) {
        const client = interaction.client;
        const startTime = Date.now();
        const topic = interaction.options.getString('topic');

        await interaction.deferReply();

        try {
            await interaction.editReply(`🧐 **'${topic}'**에 대해 샅샅이 뒤지는 중이야, 5분 정도 걸려...! \n(계획 수립 -> 자료 조사 -> 검증 -> 보고서 작성 중)`);

            const { fileContent, embedContent } = await deepResearch(topic);

            const files = [];

            if (fileContent) {
                const buffer = Buffer.from(fileContent, 'utf-8');
                const attachment = new AttachmentBuilder(buffer, { name: `DeepResearch_${Date.now()}.md` });
                files.push(attachment);
            }

            const embed = createAiResponseEmbed({
                title: `📑 심층 리서치 완료: ${topic}`,
                description: embedContent,
                user: interaction.user,
                duration: Date.now() - startTime,
                footerPrefix: "Deep Research Agent"
            });

            await interaction.editReply({
                content: `✅ 조사가 끝났어! 상세한 내용은 첨부파일을 확인해줘.`,
                embeds: [embed],
                files: files
            });

        } catch (error) {
            console.error(`[/research] 오류:`, error);
            logToDiscord(client, 'ERROR', `/research 실행 중 오류`, interaction, error);

            const errorMessage = `작업을 처리하는 도중 문제가 생겼어...\n> ${error.message}`;

            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage, embeds: [] });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    },
};