// 파일 위치: /commands/search.js

const { SlashCommandBuilder, InteractionContextType, AttachmentBuilder } = require('discord.js');
const { searchWeb, deepResearch } = require('../utils/ai_helper.js');
const { createAiResponseEmbed } = require('../utils/embed_builder.js');
const { logToDiscord } = require('../utils/catch_log.js');

function formatSearchResults(items) {
    if (!items || items.length === 0) return "검색 결과가 없습니다.";
    return items.map((item, index) => 
        `**${index + 1}. [${item.title}](${item.link})**\n${item.snippet}`
    ).join('\n\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('인터넷 검색 또는 심층 리서치를 수행합니다.')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ])
        .addSubcommand(subcommand =>
            subcommand
                .setName('normal')
                .setDescription('구글 검색 결과를 빠르고 간략하게 보여줍니다.')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('검색할 키워드')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('detailed')
                .setDescription('AI 에이전트가 심층적으로 조사하여 보고서를 작성합니다. (시간 소요됨)')
                .addStringOption(option =>
                    option.setName('topic')
                        .setDescription('조사할 주제')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const client = interaction.client;
        const startTime = Date.now();
        
        await interaction.deferReply();

        try {
            if (subcommand === 'normal') {
                const userQuery = interaction.options.getString('query');
                const searchResults = await searchWeb(userQuery);
                const formattedText = formatSearchResults(searchResults);

                const embedDescription = formattedText.length > 4000 
                    ? formattedText.substring(0, 4000) + '...\n(내용이 너무 길어서 잘렸어!)' 
                    : formattedText;

                const embed = createAiResponseEmbed({
                    title: `🔍 검색 결과: "${userQuery}"`,
                    description: embedDescription,
                    user: interaction.user,
                    duration: Date.now() - startTime,
                    footerPrefix: "Google Search"
                });

                await interaction.editReply({ embeds: [embed] });
            } 
            
            else if (subcommand === 'detailed') {
                const topic = interaction.options.getString('topic');
                
                await interaction.editReply(`🧐 **'${topic}'**에 대한 심층 조사를 시작할게! (최대 3분 정도 걸릴 수 있어...)`);

                const report = await deepResearch(topic);
                
                const files = [];
                let description = report;

                if (report.length > 2000) {
                    const buffer = Buffer.from(report, 'utf-8');
                    const attachment = new AttachmentBuilder(buffer, { name: 'DeepResearch_Report.md' });
                    files.push(attachment);
                    
                    description = `📑 **보고서 내용이 길어서 파일로 첨부했어!**\n\n위의 \`DeepResearch_Report.md\` 파일을 확인해줘.\n\n(요약)\n${report.substring(0, 500)}...`;
                }

                const embed = createAiResponseEmbed({
                    title: `📑 심층 리서치 보고서: ${topic}`,
                    description: description,
                    user: interaction.user,
                    duration: Date.now() - startTime,
                    footerPrefix: "Deep Research Agent"
                });

                await interaction.editReply({ 
                    content: `✅ 조사가 끝났어!`, 
                    embeds: [embed],
                    files: files
                });
            }

        } catch (error) {
            console.error(`[/search ${subcommand}] 오류:`, error);
            logToDiscord(client, 'ERROR', `/search ${subcommand} 실행 중 오류`, interaction, error);
            
            const errorMessage = `작업을 처리하는 도중 문제가 생겼어...\n> ${error.message}`;
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage, embeds: [] });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    },
};