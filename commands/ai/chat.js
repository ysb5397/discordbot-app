const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { Interaction } = require('../../utils/system/database.js');
const { getChatResponseStreamOrFallback, getEmbedding, searchWeb } = require('../../utils/ai/ai_helper.js');
const { logToDiscord } = require('../../utils/system/catch_log.js');
const { createAiResponseEmbed } = require('../../utils/ui/embed_builder.js');

/**
 * 유사한 기억을 검색하여 프롬프트에 추가할 텍스트를 생성하는 함수
 */
async function retrieveMemories(query, userId) {
    try {
        const queryVector = await getEmbedding(query);
        if (!queryVector) return "";

        const results = await Interaction.aggregate([
            {
                "$vectorSearch": {
                    "index": "default",
                    "path": "embedding",
                    "queryVector": queryVector,
                    "numCandidates": 50, // 후보군 50개 검색
                    "limit": 3,          // 상위 3개만 선택
                    "filter": {
                        "userId": { "$eq": userId } // 내 기억만 검색
                    }
                }
            },
            {
                "$project": {
                    "content": 1,
                    "botResponse": 1,
                    "score": { "$meta": "vectorSearchScore" }
                }
            },
            {
                "$match": {
                    "score": { "$gte": 0.75 } // 유사도 0.75 이상만 사용 (엄격하게)
                }
            }
        ]);

        if (results.length === 0) return "";

        console.log(`[Memory RAG] '${userId}'님의 질문에 대해 ${results.length}개의 관련 기억을 찾았습니다.`);

        // 기억 포맷팅
        const memoryContext = results.map((doc, i) =>
            `[기억 ${i + 1}] (유사도: ${(doc.score * 100).toFixed(0)}%)\n사용자: ${doc.content}\nAI: ${doc.botResponse}`
        ).join('\n\n');

        return `\n\n[참고할 과거 대화 기억]\n${memoryContext}\n----------------\n위 기억을 참고해서 자연스럽게 대답해줘.\n`;

    } catch (error) {
        console.error('[Memory RAG Error]', error);
        return ""; // 검색 실패 시 기억 없이 진행
    }
}

/**
 * 웹 검색 결과를 포맷팅하는 함수
 */
function formatSearchResults(items) {
    if (!items || items.length === 0) return "";
    const searchContext = items.map((item, index) =>
        `[검색 결과 ${index + 1}]\n제목: ${item.title}\n링크: ${item.link}\n내용: ${item.snippet}`
    ).join('\n\n');
    return `\n\n[실시간 웹 검색 결과]\n${searchContext}\n----------------\n위 검색 결과를 바탕으로 최신 정보를 반영해서 대답해줘.\n`;
}

/**
 * getChatResponseStreamOrFallback 제너레이터를 사용하여 응답 처리
 */
async function handleRegularConversation(interaction, startTime, selectedModel, tokenLimit, useSearch) {
    const client = interaction.client;
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    const attachment = interaction.options.getAttachment('file');

    let history = [];
    let promptData = { question: userQuestion };
    let contextPrefix = "";
    let footerInfo = [];

    // --- 1. Google Search (선택 사항) ---
    if (useSearch) {
        try {
            await interaction.editReply(`🔍 **'${userQuestion}'** 검색 중...`);
            const searchResults = await searchWeb(userQuestion);
            const searchContext = formatSearchResults(searchResults);
            if (searchContext) {
                contextPrefix += searchContext;
                footerInfo.push("Google Search");
            }
        } catch (searchError) {
            console.error('[/chat] 검색 실패:', searchError);
            // 검색 실패해도 대화는 계속 진행
        }
    }

    // --- 2. RAG: 벡터 검색으로 관련 기억 가져오기 ---
    const memoryContext = await retrieveMemories(userQuestion, sessionId);
    if (memoryContext) {
        contextPrefix += memoryContext;
        footerInfo.push("Memory RAG");
    }

    // 질문 보강 (검색 결과 + 기억 + 원본 질문)
    if (contextPrefix) {
        promptData.question = `${contextPrefix}\n사용자 질문: ${userQuestion}`;
    }

    // --- 3. 최근 대화 기록 (Short-term Memory) 불러오기 ---
    try {
        const recentInteractions = await Interaction.find({
            userId: sessionId, type: { $in: ['MESSAGE', 'MENTION'] }
        }).sort({ timestamp: -1 }).limit(10).lean();

        if (recentInteractions.length > 0) {
            history = recentInteractions.reverse().flatMap(doc => {
                const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                const userTurn = { role: 'user', parts: [{ text: userMessage }] };

                if (doc.botResponse) {
                    return [userTurn, { role: 'model', parts: [{ text: doc.botResponse }] }];
                }
                return [];
            });
            promptData.history = history;
        }
    } catch (dbError) {
        console.error('[/chat] 대화 기록 불러오기 실패:', dbError);
        logToDiscord(client, 'ERROR', '대화 기록 불러오기 실패', interaction, dbError, 'handleRegularConversation_HistoryLoad');
    }

    // --- 4. 스트리밍 응답 처리 ---
    let fullResponseText = "";
    let finalMessage = null;
    let isFallback = false;
    let finalError = null;

    let lastUpdateTime = 0;
    const updateInterval = 1800;
    let currentEmbed = null;

    const debouncedUpdate = async (isFinal = false) => {
        const now = Date.now();
        if (!isFinal && now - lastUpdateTime < updateInterval) return;
        lastUpdateTime = now;

        const duration = now - startTime;
        const isStreaming = !isFinal && !finalError;

        let description = fullResponseText.substring(0, 4090) + (isStreaming ? "..." : "");
        if (finalMessage) description += `\n\n${finalMessage}`;

        const footerPrefix = `Powered by AI ${footerInfo.length > 0 ? `(${footerInfo.join(', ')})` : ''}`;

        currentEmbed = createAiResponseEmbed({
            title: userQuestion.substring(0, 250) + (userQuestion.length > 250 ? '...' : ''),
            description: description,
            duration: duration,
            user: interaction.user,
            isFallback: isFallback,
            imageUrl: attachment ? attachment.url : undefined,
            footerPrefix: footerPrefix
        });

        try {
            await interaction.editReply({
                content: `<@${sessionId}>${isStreaming ? ' 생각 중...' : ''}`,
                embeds: [currentEmbed]
            });
        } catch (editError) {
            console.error('[/chat] 스트리밍 중 editReply 실패:', editError);
            logToDiscord(client, 'WARN', '스트리밍 응답 업데이트 실패', interaction, editError, 'handleRegularConversation_StreamUpdate');
            finalError = editError;
        }
    };

    try {
        const stream = getChatResponseStreamOrFallback(promptData, attachment, sessionId, { client, interaction, task: 'chat' }, selectedModel, tokenLimit);

        for await (const result of stream) {
            if (result.error) {
                finalError = result.error;
                break;
            }
            if (result.textChunk) {
                fullResponseText += result.textChunk;
                await debouncedUpdate(false);
            }
            if (result.finalResponse) {
                fullResponseText = result.finalResponse.text;
                finalMessage = result.finalResponse.message;
                isFallback = result.isFallback ?? false;
                break;
            }
        }

        if (finalError) {
            throw finalError;
        } else {
            await debouncedUpdate(true);

            // --- 성공 시 DB 저장 ---
            try {
                const contentToSave = userQuestion + (attachment ? ` (첨부: ${attachment.name})` : '');
                const embedding = await getEmbedding(contentToSave);

                const finalDescription = fullResponseText + (finalMessage ? `\n\n${finalMessage}` : '');

                const successInteraction = new Interaction({
                    interactionId: interaction.id + (isFallback ? '-fallback' : ''),
                    channelId: interaction.channelId,
                    userId: sessionId,
                    userName: interaction.user.username,
                    type: 'MESSAGE',
                    content: contentToSave,
                    botResponse: finalDescription.substring(0, 4000),
                    embedding: embedding
                });
                await successInteraction.save();
            } catch (dbError) {
                console.error('[/chat] 대화 저장 실패:', dbError);
                logToDiscord(client, 'ERROR', '대화 저장 실패', interaction, dbError, 'handleRegularConversation_DBSave');
            }
        }

    } catch (error) {
        console.error('[/chat] 최종 에러:', error);
        throw error;
    }
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화하거나, 저장된 기억을 검색합니다.')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ])
        .addStringOption(option =>
            option.setName('model')
                .setDescription('사용할 AI 모델을 선택합니다. (기본: Gemini 2.5 Flash)')
                .setRequired(true)
                .addChoices(
                    { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
                    { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
                ))
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 또는 검색할 내용')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('token_limit')
                .setDescription('AI 응답의 최대 토큰 수를 설정합니다. (기본: 2048)')
                .setRequired(false)
                .setMinValue(0))
        .addBooleanOption(option =>
            option.setName('use_search')
                .setDescription('Google 검색 결과를 함께 참고할까요? (최신 정보 필요시 체크)')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),

    async execute(interaction) {
        const startTime = Date.now();
        await interaction.deferReply();

        const selectedModel = interaction.options.getString('model');
        const tokenLimit = interaction.options.getInteger('token_limit') || 2048;
        const useSearch = interaction.options.getBoolean('use_search') || false;

        await handleRegularConversation(interaction, startTime, selectedModel, tokenLimit, useSearch);
    },
};