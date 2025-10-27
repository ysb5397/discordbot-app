const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const { google } = require('googleapis');
const { callFlowise } = require('../utils/ai_helper.js');
const customsearch = google.customsearch('v1');

const googleApiKey = process.env.GOOGLE_SEARCH_API;
const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

async function generateSearchQuery(userQuestion, sessionId) {
    const prompt = `
        You are a search query optimization expert. Your task is to convert a user's natural language question into a highly effective, keyword-focused search query for Google. The query should be in English to maximize search results.

        User Question: "${userQuestion}"

        Optimized Google Search Query:
    `;
    const query = await callFlowise(prompt, sessionId, 'query-generation');
    return query.replace(/"/g, '').trim();
}


async function searchWeb(query) {
    const searchResponse = await customsearch.cse.list({
        auth: googleApiKey,
        cx: googleSearchEngineId,
        q: query,
        num: 5,
    });
    return searchResponse.data.items || [];
}

function formatSearchResults(items) {
    if (!items || items.length === 0) {
        return "웹 검색 결과가 없습니다.";
    }
    return items.map((item, index) => 
        `[출처 ${index + 1}: ${item.title}]\n${item.snippet}\n링크: ${item.link}`
    ).join('\n\n');
}

async function handleError(interaction, error) {
    console.error(`[/deep_research] An error occurred:`, error);
    const errorMessage = `죄송합니다. 심층 분석 중 오류가 발생했습니다.\n오류: ${error.message}`;
    
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage, embeds: [], files: [] });
    } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deep_research')
        .setDescription('AI가 질문을 분석하여 심층 리서치를 수행합니다.')
        .setContexts([
            InteractionContextType.Guild,          // 1. 서버
            InteractionContextType.BotDM,          // 2. 봇과의 1:1 DM
            InteractionContextType.PrivateChannel, // 3. 그룹 DM
        ])
        .addStringOption(option =>
            option.setName('question')
                .setDescription('리서치할 주제 또는 질문')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const userQuestion = interaction.options.getString('question');
            const sessionId = interaction.user.id;

            await interaction.editReply('AI가 더 나은 검색을 위해 질문을 분석하고 있어요... 🤔');
            
            const searchQuery = await generateSearchQuery(userQuestion, sessionId);

            await interaction.editReply(`AI가 생성한 검색어(\"${searchQuery}\")로 웹 검색을 시작합니다... 🕵️‍♂️`);

            const searchResults = await searchWeb(searchQuery);
            if (searchResults.length === 0) {
                await interaction.editReply(`'${searchQuery}'에 대한 관련 정보를 찾는 데 실패했어요. 😥 다른 질문으로 시도해볼래?`);
                return;
            }

            const formattedResults = formatSearchResults(searchResults);
            
            await interaction.editReply('수집된 정보를 바탕으로 AI가 최종 분석을 시작합니다... 🧠');

            const analysisPrompt = `
                Please act as a professional researcher. Your goal is to provide a comprehensive, in-depth answer to the user's original question. Use the provided web search results to synthesize the information. Structure your response clearly and cite the sources used for each part of your analysis.

                [User's Original Question]
                ${userQuestion}

                [Web Search Results for query: "${searchQuery}"]
                ${formattedResults}

                [Your In-depth Analysis]
            `;

            const analysis = await callFlowise(analysisPrompt, sessionId, 'analysis');

            const resultEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`'${userQuestion}'에 대한 심층 분석 결과`)
                .setDescription(analysis)
                .addFields({ name: '출처 정보 (AI가 생성한 검색어 기준)', value: formattedResults.substring(0, 1024) })
                .setTimestamp()
                .setFooter({ text: `Powered by Gemini & Google Search. Searched with: "${searchQuery}"` });

            await interaction.editReply({ content: `'${userQuestion}'에 대한 심층 분석이 완료되었어요! ✨`, embeds: [resultEmbed] });

        } catch (error) {
            await handleError(interaction, error);
        }
    },
};