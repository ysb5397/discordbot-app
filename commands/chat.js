// 파일 위치: /commands/chat.js

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const { getChatResponseStreamOrFallback } = require('../utils/ai_helper.js');
const { logToDiscord } = require('../utils/catch_log.js');
const { createAiResponseEmbed } = require('../utils/embed_builder.js');


/**
 * getChatResponseStreamOrFallback 제너레이터를 사용하여 응답 처리
 */
async function handleRegularConversation(interaction, startTime, selectedModel, tokenLimit) {
    const client = interaction.client;
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    const attachment = interaction.options.getAttachment('file');

    let history = []; // Gemini 형식 [{ role: 'user'/'model', parts: [...] }]
    let promptData = { question: userQuestion }; // 초기 프롬프트 데이터

    // --- 1. 대화 기록 준비 ---
    try {
        const recentInteractions = await Interaction.find({
            userId: sessionId, type: { $in: ['MESSAGE', 'MENTION'] }
        }).sort({ timestamp: -1 }).limit(10).lean();
        if (recentInteractions.length > 0) {
            history = recentInteractions.reverse().flatMap(doc => {
                 const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                 const userTurn = { role: 'user', parts: [{ text: userMessage }] };
                 if (doc.type === 'MENTION' && doc.botResponse) {
                     return [userTurn, { role: 'model', parts: [{ text: doc.botResponse }] }];
                 }
                 return userTurn;
             });
             promptData.history = history; // 프롬프트 데이터에 기록 추가
        }
    } catch (dbError) {
        console.error('[/chat] 대화 기록 불러오기 실패:', dbError);
        logToDiscord(client, 'ERROR', '대화 기록 불러오기 실패', interaction, dbError, 'handleRegularConversation_HistoryLoad');
    }

    // --- 2. 스트리밍 응답 처리 ---
    let fullResponseText = "";
    let finalMessage = null; // 최종 메시지 (폴백 알림 등)
    let isFallback = false; // 폴백 여부 플래그
    let finalError = null; // 최종 에러 객체

    let lastUpdateTime = 0;
    const updateInterval = 1800; // 업데이트 간격
    let currentEmbed = null; // 현재 표시 중인 Embed

    const debouncedUpdate = async (isFinal = false) => {
        const now = Date.now();
        if (!isFinal && now - lastUpdateTime < updateInterval) return;
        lastUpdateTime = now;

        const duration = now - startTime;
        const isStreaming = !isFinal && !finalError; // 에러 발생 시 스트리밍 중단

        let description = fullResponseText.substring(0, 4090) + (isStreaming ? "..." : "");
        if (finalMessage) description += `\n\n${finalMessage}`;

        currentEmbed = createAiResponseEmbed({
            title: userQuestion.substring(0, 250) + (userQuestion.length > 250 ? '...' : ''),
            description: description,
            duration: duration,
            user: interaction.user,
            isFallback: isFallback,
            imageUrl: attachment ? attachment.url : undefined
        });

        try {
            await interaction.editReply({
                 content: `<@${sessionId}>${isStreaming ? ' 생각 중...' : ''}`,
                 embeds: [currentEmbed]
            });
        } catch (editError) {
             console.error('[/chat] 스트리밍 중 editReply 실패:', editError);
             logToDiscord(client, 'WARN', '스트리밍 응답 업데이트 실패', interaction, editError, 'handleRegularConversation_StreamUpdate');
             finalError = editError; // 에러 발생 플래그 (루프 중단용)
        }
    };


    try {
        const stream = getChatResponseStreamOrFallback(promptData, attachment, sessionId, { client, interaction, task: 'chat' }, selectedModel, tokenLimit);

        // 스트림 처리 루프
        for await (const result of stream) {
            if (result.error) {
                finalError = result.error; // 에러 저장
                break; // 루프 중단
            }
            if (result.textChunk) {
                fullResponseText += result.textChunk;
                // 바로 업데이트하지 않고 디바운스 함수 호출
                await debouncedUpdate(false);
            }
            if (result.finalResponse) {
                // 스트리밍 없이 최종 결과가 바로 온 경우 (Flowise 폴백 등)
                fullResponseText = result.finalResponse.text;
                finalMessage = result.finalResponse.message;
                isFallback = result.isFallback ?? false;
                break; // 루프 중단
            }
        }

        // 루프 종료 후 최종 상태 처리
        if (finalError) {
             throw finalError; // 잡힌 에러를 다시 던져서 아래 catch 블록으로
        } else {
             await debouncedUpdate(true); // 최종 Embed 업데이트

             // --- 성공 시 DB 저장 ---
             try {
                 const finalDescription = fullResponseText + (finalMessage ? `\n\n${finalMessage}` : '');
                 const successInteraction = new Interaction({
                     interactionId: interaction.id + (isFallback ? '-fallback' : ''), // ID 구분
                     channelId: interaction.channelId,
                     userId: sessionId,
                     userName: interaction.user.username,
                     type: 'MESSAGE',
                     content: userQuestion + (attachment ? ` (첨부: ${attachment.name})` : '') + (isFallback ? ' (Flowise Fallback)' : ''),
                     botResponse: finalDescription.substring(0, 4000) // DB 저장 길이 제한
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
                .setDescription('AI 응답의 최대 토큰 수를 설정합니다. (기본: 1000)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(1200))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),

    async execute(interaction) {
        const startTime = Date.now();
        await interaction.deferReply();
        
        const selectedModel = interaction.options.getString('model');
        const tokenLimit = interaction.options.getInteger('token_limit') || 1000;
        await handleRegularConversation(interaction, startTime, selectedModel, tokenLimit);
    },
};