// 파일 위치: /commands/deep_research.js

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const { searchWeb, generateSearchQuery, generateMongoFilter, callFlowise, deepResearch } = require('../utils/ai_helper.js');
const { logToDiscord } = require('../utils/catch_log.js');
const { createAiResponseEmbed } = require('../utils/embed_builder.js');

/**
 * MongoDB에서 기억(메모리)을 검색하는 함수
 * @param {string} query - 사용자의 자연어 쿼리
 * @param {string} userId - 사용자 ID
 * @param {object} client - 디스코드 클라이언트
 * @param {object} interaction - 상호작용 객체
 * @returns {Promise<string>} - 포맷팅된 기억 문자열
 */
async function searchMemories(query, userId, client, interaction) {
    try {
        const filter = await generateMongoFilter(query, userId, client, interaction);
        const results = await Interaction.find(filter)
            .sort({ timestamp: -1 })
            .limit(5)
            .lean();

        if (results.length === 0) {
            return "검색된 관련 기억이 없습니다.";
        }

        return results.map((item, index) =>
            `[기억 ${index + 1}: ${new Date(item.timestamp).toLocaleString('ko-KR')}]\n- ${item.content || 'N/A'}\n- (봇 응답: ${item.botResponse || 'N/A'})`
        ).join('\n\n');

    } catch (dbError) {
        console.error('[/search] 기억 검색(DB) 중 오류:', dbError);
        logToDiscord(client, 'ERROR', '기억 검색(DB) 실패', interaction, dbError, 'searchMemories');
        return "기억을 검색하는 중 오류가 발생했습니다.";
    }
}

/**
 * 검색 결과를 AI 프롬프트용(상세)으로 포맷하는 함수
 */
function formatWebResultsForAI(items) {
    if (!items || items.length === 0) {
        return "웹 검색 결과가 없습니다.";
    }
    return items.map((item, index) =>
        `[웹 출처 ${index + 1}: ${item.title || '제목 없음'}]\n${item.snippet || '내용 없음'}\n링크: ${item.link || '링크 없음'}`
    ).join('\n\n');
}

/**
 * 검색 결과를 Discord 메시지(요약)용으로 포맷하는 함수
 */
function formatWebResultsForMessage(items) {
    if (!items || items.length === 0) {
        return "*(참고한 웹 출처가 없습니다)*";
    }
    // [[출처1]](링크) [[출처2]](링크) ... 형식으로 반환
    return items.map((item, index) =>
        `[[출처${index + 1}]](${item.link || 'about:blank'})`
    ).join(' ');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dev_search')
        .setDescription('AI가 웹 또는 기억(DB)을 검색하여 질문에 답합니다.')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ])
        .addSubcommand(subcommand =>
            subcommand
                .setName('normal')
                .setDescription('웹을 검색하여 질문에 대한 요약 답변을 받습니다.')
                .addStringOption(option =>
                    option.setName('question')
                        .setDescription('검색할 주제 또는 질문')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('detailed')
                .setDescription('웹과 기억(DB)을 모두 검색하여 심층 분석 답변을 받습니다.')
                .addStringOption(option =>
                    option.setName('question')
                        .setDescription('리서치할 주제 또는 질문')
                        .setRequired(true))
        ),

    async execute(interaction) {
        const startTime = Date.now();
        const client = interaction.client;
        const subcommand = interaction.options.getSubcommand();
        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;

        await interaction.deferReply();

        let analysisPrompt = "";
        let formattedWebResultsForAI = "";
        let formattedWebResultsForMsg = "";
        let formattedMemoryResults = "";
        let finalTitle = `질문: ${userQuestion.substring(0, 240)}`;
        let fields = [];
        
        try {
            if (subcommand === 'detailed') {
                await interaction.editReply(`🕵️‍♂️ '${userQuestion}'에 대한 심층 리서치를 시작합니다... (최대 1~2분 소요)`);
                
                const reportText = await deepResearch(userQuestion);
                
                const buffer = Buffer.from(reportText, 'utf-8');
                const attachment = new AttachmentBuilder(buffer, { name: 'deep_research_report.txt' });

                const endTime = Date.now();
                const duration = endTime - startTime;

                const summaryEmbed = createAiResponseEmbed({
                    title: `📑 심층 리서치 완료: ${userQuestion.substring(0, 50)}...`,
                    description: reportText.substring(0, 300) + "...\n\n**(전체 내용은 첨부된 텍스트 파일을 확인해 주세요!)**",
                    duration: duration,
                    user: interaction.user,
                    footerPrefix: "Powered by Gemini 2.0 & Google Search"
                });

                await interaction.editReply({
                    content: "✅ 리서치가 완료되었습니다!",
                    embeds: [summaryEmbed],
                    files: [attachment]
                });

            }  else {
                    analysisPrompt = `
                        Please act as a professional researcher. Provide a concise summary answering the user's question based *only* on the provided web search results.
                        Cite the sources used (e.g., "[웹 출처 1]", "[웹 출처 2, 3]"). Respond in Korean.

                        [User's Original Question]
                        ${userQuestion}

                        [Web Search Results]
                        ${formattedWebResultsForAI}

                        [Your Concise Summary (Korean)]
                    `;
            }

            const analysisResponseText = await callFlowise(analysisPrompt, sessionId, 'search-analysis', client, interaction);
            
            let analysis = '분석 결과를 가져오는 데 실패했습니다.';
            let analysisMessage = null;

            try {
                const analysisResponse = JSON.parse(analysisResponseText);
                analysis = analysisResponse.text || analysis;
                analysisMessage = analysisResponse.message;
            } catch (parseError) {
                console.error(`[/search] 분석 결과 파싱 실패:`, analysisResponseText, parseError);
                logToDiscord(client, 'ERROR', 'AI 분석 결과 응답(JSON) 파싱 실패', interaction, parseError, 'execute');
                analysis = analysisResponseText;
            }

            if(analysisMessage){
                analysis += `\n\n${analysisMessage}`;
            }

            const endTime = Date.now();
            const duration = endTime - startTime;

            const resultEmbed = createAiResponseEmbed({
                title: finalTitle,
                description: analysis.substring(0, 4090),
                fields: fields,
                duration: duration,
                user: interaction.user,
                footerPrefix: `Powered by Google Search & Gemini`
            });

            await interaction.editReply({ 
                content: `'${userQuestion}'에 대한 ${subcommand === 'detailed' ? '심층' : '일반'} 분석이 완료되었어요! ✨\n\n${formattedWebResultsForMsg}`, 
                embeds: [resultEmbed] 
            });

        } catch (error) {
            console.error(`[/search] ${subcommand} 실행 중 최종 오류:`, error);
            await interaction.editReply({
                content: `❌ 앗! ${subcommand === 'detailed' ? '심층' : '일반'} 검색 중 오류가 발생했어요...!\n\n> ${error.message}`
            });
        }
    },
};