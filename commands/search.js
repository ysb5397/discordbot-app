// 파일 위치: /commands/search.js

const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { callFlowise } = require('../utils/ai_helper.js');
const { logToDiscord } = require('../utils/catch_log.js');
const { createAiResponseEmbed } = require('../utils/embed_builder.js');
const config = require('../config');

const googleApiKey = config.ai.googleSearch.apiKey;
const googleSearchEngineId = config.ai.googleSearch.engineId;

const customsearch = google.customsearch('v1');

const MAX_EXECUTION_TIME = 14 * 60 * 1000; 
const UPDATE_INTERVAL = 5000;

/**
 * AI를 이용해 검색어를 생성하는 함수
 */
async function generateSearchQuery(userQuestion, sessionId, client, interaction) {
    const prompt = `
        You are a search query optimization expert. Your task is to convert a user's natural language question into a highly effective, keyword-focused search query for Google. The query should be in English to maximize search results. Avoid using quotes unless absolutely necessary for the search.

        User Question: "${userQuestion}"

        Optimized Google Search Query:
    `;

    const aiResponseText = await callFlowise(prompt, sessionId, 'query-generation', client, interaction);

    try {
        const aiResponse = JSON.parse(aiResponseText);
        let query = aiResponse.text || '';

        if (aiResponse.message) {
            logToDiscord(client, 'INFO', `검색어 생성 AI 메시지: ${aiResponse.message}`, interaction, null, 'generateSearchQuery');
        }

        return query.replace(/"/g, '').trim();

    } catch (parseError) {
        console.error(`[/deep_research] 검색어 생성 AI 응답 파싱 실패:`, aiResponseText, parseError);
        logToDiscord(client, 'ERROR', '검색어 생성 AI 응답을 해석(JSON 파싱)하는 데 실패했습니다.', interaction, parseError, 'generateSearchQuery');
        return userQuestion;
    }
}

/**
 * 구글 웹 검색을 수행하는 함수
 */
async function searchWeb(query) {
    if (!googleApiKey || !googleSearchEngineId) {
        throw new Error("Google Search API 키 또는 엔진 ID가 설정되지 않았습니다.");
    }
    try {
        const searchResponse = await customsearch.cse.list({
            auth: googleApiKey,
            cx: googleSearchEngineId,
            q: query,
            num: 5,
        });
        return searchResponse.data.items || [];
    } catch (searchError) {
        console.error(`[/deep_research] Google Search API 오류:`, searchError.message);
        if (searchError.message && searchError.message.includes('API key expired')) {
            throw new Error("구글 검색 API 키가 만료되었습니다. 관리자에게 문의하세요.");
        } else if (searchError.message && (searchError.message.includes('invalid') || searchError.message.includes('forbidden'))) {
            throw new Error("구글 검색 API 키 또는 엔진 ID가 잘못되었거나 권한이 없습니다. 관리자 설정을 확인하세요.");
        }
        throw new Error(`웹 검색 중 예상치 못한 오류 발생: ${searchError.message}`);
    }
}

/**
 * 검색 결과를 포맷하는 함수
 */
function formatSearchResults(items) {
    if (!items || items.length === 0) {
        return "웹 검색 결과가 없습니다.";
    }
    return items.map((item, index) =>
        `[출처 ${index + 1}: ${item.title || '제목 없음'}]\n${item.snippet || '내용 없음'}\n링크: ${item.link || '링크 없음'}`
    ).join('\n\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('AI가 웹 또는 기억(DB)을 검색하여 질문에 답합니다.')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ])
        .addStringOption(option =>
            option.setName('question')
                .setDescription('리서치할 주제 또는 질문')
                .setRequired(true)),

    async execute(interaction) {
        const startTime = Date.now();
        const client = interaction.client;
        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;

        await interaction.deferReply();

        let updateIntervalId;
        let isFinished = false;

        // --- 1. 진행 상황 업데이트 타이머 시작 ---
        const startProgressUpdate = (messagePrefix) => {
            clearInterval(updateIntervalId);
            updateIntervalId = setInterval(async () => {
                if (isFinished) return clearInterval(updateIntervalId);
                
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                
                // 14분이 넘어가면 강제 종료 처리
                if (Date.now() - startTime > MAX_EXECUTION_TIME) {
                    clearInterval(updateIntervalId);
                    isFinished = true;
                    try {
                        await interaction.editReply({ content: `❌ **시간 초과!**\n작업 시간이 너무 길어져서(14분 초과) 중단되었어요. 질문을 조금 더 구체적으로 나눠서 해주시겠어요?` });
                    } catch (e) { console.error('타임아웃 메시지 전송 실패:', e); }
                    return;
                }

                try {
                    await interaction.editReply(`${messagePrefix} (${elapsed}초 경과...) ⏳`);
                } catch (e) {
                    // 15분 토큰 만료 등으로 수정 실패 시 타이머 정지
                    console.warn('진행 상황 업데이트 실패 (무시됨):', e.message);
                    clearInterval(updateIntervalId);
                }
            }, UPDATE_INTERVAL);
        };

        try {
            // 단계 1: 검색어 생성
            startProgressUpdate('AI가 더 나은 검색을 위해 질문을 분석하고 있어요... 🤔');
            const searchQuery = await generateSearchQuery(userQuestion, sessionId, client, interaction);

            console.log(`[/deep_research] Generated Search Query: "${searchQuery}"`);
            logToDiscord(client, 'DEBUG', `Generated Search Query: "${searchQuery}"`, interaction, null, 'execute');

            // 단계 2: 웹 검색
            startProgressUpdate(`AI가 생성한 검색어(\`${searchQuery}\`)로 웹 정보를 수집하고 있어요... 🕵️‍♂️`);
            const searchResults = await searchWeb(searchQuery);

            if (searchResults.length === 0) {
                isFinished = true;
                clearInterval(updateIntervalId);
                await interaction.editReply(`'${searchQuery}'에 대한 관련 정보를 찾는 데 실패했어요. 😥 다른 질문으로 시도해볼래?`);
                return;
            }

            const formattedResults = formatSearchResults(searchResults);

            // 단계 3: AI 심층 분석 (여기가 가장 오래 걸림)
            startProgressUpdate('수집된 정보를 바탕으로 AI가 최종 보고서를 작성 중입니다... (조금 더 걸릴 수 있어요) 🧠');

            const analysisPrompt = `
                Please act as a professional researcher. Your goal is to provide a comprehensive, in-depth answer to the user's original question based *only* on the provided web search results. Synthesize the information clearly and cite the sources used (e.g., "[출처 1]", "[출처 2, 3]") for each part of your analysis. If the search results are insufficient or irrelevant to answer the question, state that clearly. Respond in Korean.

                [User's Original Question]
                ${userQuestion}

                [Web Search Results for query: "${searchQuery}"]
                ${formattedResults}

                [Your In-depth Analysis (Korean)]
            `;

            const analysisResponseText = await callFlowise(analysisPrompt, sessionId, 'analysis', client, interaction);
            
            isFinished = true; // 작업 완료 플래그
            clearInterval(updateIntervalId); // 타이머 정지

            let analysis = '분석 결과를 가져오는 데 실패했습니다.';
            let analysisMessage = null;

            try {
                const analysisResponse = JSON.parse(analysisResponseText);
                analysis = analysisResponse.text || analysis;
                analysisMessage = analysisResponse.message;
            } catch (parseError) {
                console.error(`[/deep_research] 분석 결과 파싱 실패:`, analysisResponseText, parseError);
                logToDiscord(client, 'ERROR', 'AI 분석 결과 응답을 해석(JSON 파싱)하는 데 실패했습니다.', interaction, parseError, 'execute');
                analysis = analysisResponseText;
            }

            if (analysisMessage) {
                analysis += `\n\n${analysisMessage}`;
            }

            const endTime = Date.now();
            const duration = endTime - startTime;

            const resultEmbed = createAiResponseEmbed({
                title: userQuestion.substring(0, 250) + (userQuestion.length > 250 ? '...' : ''),
                description: analysis.substring(0, 4090),
                fields: [{ name: '참고한 출처 정보 (요약)', value: formattedResults.substring(0, 1024) }],
                duration: duration,
                user: interaction.user,
                searchQuery: searchQuery
            });

            await interaction.editReply({ content: `'${userQuestion}'에 대한 심층 분석이 완료되었어요! ✨`, embeds: [resultEmbed] });

        } catch (error) {
            isFinished = true;
            clearInterval(updateIntervalId);
            console.error('[/deep_research] 실행 중 오류:', error);
            
            // 이미 defer된 상태이므로 editReply 사용
            await interaction.editReply({ 
                content: `❌ 작업 처리 중 오류가 발생했습니다.\n> ${error.message}`,
                embeds: [] 
            }).catch(e => console.error('오류 메시지 전송 실패:', e));
        }
    },
};