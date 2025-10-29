// 파일 위치: /commands/chat.js (스트리밍 + Flowise 폴백 적용)

const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const { Interaction } = require('../utils/database.js');
// ★ genAI 직접 사용을 위해 가져오기 ★
const { generateMongoFilter, callFlowise, genAI } = require('../utils/ai_helper.js');
const { logToDiscord } = require('../utils/catch_log.js');
// ★ Embed Builder 가져오기 ★
const { createAiResponseEmbed } = require('../utils/embed_builder.js');

// ... (formatMemoryContent 함수는 그대로) ...
function formatMemoryContent(doc) {
    let contentText = '';
    if (typeof doc.content === 'string') {
        contentText = doc.content;
    } else if (typeof doc.content === 'object' && doc.content !== null) {
        if (doc.type === 'EARTHQUAKE' && doc.content.eqPt) {
            contentText = `[지진] ${doc.content.eqPt} (규모 ${doc.content.magMl})`;
        } else {
            try {
                contentText = JSON.stringify(doc.content);
            } catch {
                contentText = '[내용 표시 불가]';
            }
        }
    } else {
        contentText = String(doc.content || '내용 없음');
    }
    const maxLength = 100;
    return contentText.length > maxLength ? contentText.substring(0, maxLength - 3) + '...' : contentText;
}


/**
 * 검색된 기억을 바탕으로 임베드를 만들어 응답하는 함수 (이전과 동일)
 */
async function handleMemoryFound(interaction, searchResults, startTime) {
    // ... (이 함수 내용은 이전 답변과 동일하게 유지) ...
    const client = interaction.client;
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    let aiComment = '';
    let isFallbackComment = false;

    try {
        const commentPrompt = `사용자가 "${userQuestion}" 라고 질문해서 관련 기억을 찾았어. 사용자가 찾던 기억이 맞을 것 같다는 뉘앙스로 짧고 자연스러운 코멘트를 한국어로 해줘.`;
        const aiResponseText = await callFlowise(commentPrompt, sessionId, 'memory-comment', client, interaction);
        try {
            const aiResponse = JSON.parse(aiResponseText);
            aiComment = aiResponse.text || '';
            if (aiResponse.message) {
                console.log(`[/chat memory comment] AI 메시지: ${aiResponse.message}`);
                logToDiscord(client, 'INFO', `기억 코멘트 AI 메시지: ${aiResponse.message}`, interaction, null, 'handleMemoryFound');
                if (aiResponse.message.includes('Flowise 에이전트 연결에 실패')) isFallbackComment = true;
            }
        } catch (parseError) {
            console.error(`[/chat memory comment] AI 코멘트 파싱 실패:`, aiResponseText, parseError);
            logToDiscord(client, 'WARN', '기억 검색 코멘트 AI 응답 파싱 실패', interaction, parseError, 'handleMemoryFound');
            aiComment = aiResponseText;
        }
    } catch (commentError) {
        console.error(`[/chat memory comment] AI 코멘트 생성 실패:`, commentError);
        logToDiscord(client, 'WARN', '기억 검색 코멘트 생성 실패', interaction, commentError, 'handleMemoryFound');
    }

    const description = searchResults.map((doc, index) => {
        const content = formatMemoryContent(doc);
        const messageLink = doc.channelId && interaction.guildId
            ? `https://discord.com/channels/${interaction.guildId}/${doc.channelId}/${doc.interactionId}`
            : '(메시지 링크는 서버 채널에서만 가능)';
        const timestamp = new Date(doc.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        return `**${index + 1}.** ${messageLink.startsWith('http') ? `[메시지 바로가기](${messageLink})` : messageLink} "${content}"\n*(${timestamp})*`;
    }).join('\n\n');

    const endTime = Date.now();
    const duration = endTime - startTime;

    const embedData = {
        title: '혹시 이 기억들을 찾고 있었어? 🤔',
        description: description,
        footerPrefix: '기억 검색 완료',
        duration: duration,
        user: interaction.user,
        fields: aiComment ? [{ name: "AI의 코멘트", value: aiComment.substring(0, 1024) }] : undefined,
        isFallback: isFallbackComment // 코멘트 생성 폴백 여부 반영
    };
    const embed = createAiResponseEmbed(embedData);
    embed.setColor(0xFFD700); // 기억 검색은 주황색(Warn)

    await interaction.editReply({ content: `<@${sessionId}>`, embeds: [embed] });
}


/**
 * ★★★ [대폭 수정됨] ★★★
 * Gemini 스트리밍을 우선 시도하고, 실패 시 Flowise 폴백으로 전환하는 함수
 */
async function handleRegularConversation(interaction, startTime) {
    const client = interaction.client;
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    const attachment = interaction.options.getAttachment('file');
    const botName = interaction.client.user.username;

    let history = []; // 대화 기록
    let generationConfig = {
      // temperature: 0.7, // 필요 시 설정
      // topP: 0.9,
      // topK: 40,
      // maxOutputTokens: 2048, // 필요 시 설정
    };
    let safetySettings = [ // 기본 안전 설정 (필요시 조정)
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ];

    // --- 1. 대화 기록 준비 ---
    try {
        const recentInteractions = await Interaction.find({
            userId: sessionId,
            type: { $in: ['MESSAGE', 'MENTION'] }
        }).sort({ timestamp: -1 }).limit(10).lean();

        if (recentInteractions.length > 0) {
            history = recentInteractions.reverse().flatMap(doc => {
                const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                // Gemini API 형식에 맞게 role을 'user'와 'model'로 변경
                const userTurn = { role: 'user', parts: [{ text: userMessage }] };
                if (doc.type === 'MENTION' && doc.botResponse) {
                    return [userTurn, { role: 'model', parts: [{ text: doc.botResponse }] }];
                }
                return userTurn;
            });
        }
    } catch (dbError) {
        console.error('[/chat] 대화 기록 로딩 실패:', dbError);
        // 기록 로딩 실패는 치명적이지 않으므로 경고만 하고 진행
        logToDiscord(client, 'WARN', '대화 기록 로딩 실패', interaction, dbError, 'handleRegularConversation_History');
    }

    // --- 2. Gemini 모델 및 프롬프트 준비 ---
    // 첨부파일 유무에 따라 모델과 프롬프트 구성 변경
    let model;
    let currentPromptParts = [];

    if (attachment) {
        // 이미지를 처리할 수 있는 Pro 모델 사용 (모델명 확인 필요)
        model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" }); // 또는 Vision 모델
        await interaction.editReply('첨부파일 분석 중... 잠시만 기다려줘! 🖼️');
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`첨부파일(${attachment.name}) 다운로드 실패: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const imageBuffer = Buffer.from(arrayBuffer);
            const mimeType = attachment.contentType || 'application/octet-stream'; // MIME 타입 확인

            // Gemini API 형식에 맞게 이미지 데이터 추가
            currentPromptParts.push({ inlineData: { data: imageBuffer.toString("base64"), mimeType } });
            // 텍스트 질문 추가
            currentPromptParts.push({ text: userQuestion });
            await interaction.editReply('첨부파일 처리 완료! AI 응답 생성 중... 🧠');
        } catch (attachError) {
             console.error('[/chat] 첨부파일 처리 오류:', attachError);
             logToDiscord(client, 'ERROR', '첨부파일 처리 중 오류 발생', interaction, attachError, 'handleRegularConversation_Attach');
             // 첨부파일 실패 시 텍스트 질문만으로 진행할지, 아니면 에러 처리할지 결정
             // 여기서는 에러를 던져서 중앙 핸들러가 처리하도록 함
             throw attachError;
        }
    } else {
        // 텍스트 전용 모델 사용 (Flash 또는 Pro)
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // 또는 Pro
        currentPromptParts.push({ text: userQuestion });
    }

    // --- 3. Gemini 스트리밍 시도 ---
    let fullResponseText = "";
    let lastUpdateTime = 0;
    const updateInterval = 1800; // 1.8초 간격으로 업데이트 (Discord Rate Limit 고려)
    let intervalId = null;
    let streamFinished = false;
    let currentEmbed = null; // 업데이트할 Embed 객체

    const updateReply = async (isFinal = false) => {
         const now = Date.now();
         // 너무 자주 업데이트하지 않도록 제어 (마지막 업데이트는 무조건 실행)
         if (!isFinal && now - lastUpdateTime < updateInterval) {
             return;
         }
         lastUpdateTime = now;

         const duration = now - startTime;
         const isStreaming = !isFinal;

         // 진행 중 Embed 생성
         currentEmbed = createAiResponseEmbed({
             title: userQuestion.substring(0, 250) + (userQuestion.length > 250 ? '...' : ''),
             // 스트리밍 중에는 임시 표시 추가
             description: fullResponseText.substring(0, 4090) + (isStreaming ? "..." : ""),
             duration: duration,
             user: interaction.user,
             isFallback: false, // Gemini가 기본이므로 false
             imageUrl: attachment ? attachment.url : undefined // 첨부 이미지를 보여줄 수도 있음
         });

         try {
             await interaction.editReply({ content: `<@${sessionId}>${isStreaming ? ' 생각 중...' : ''}`, embeds: [currentEmbed] });
         } catch (editError) {
             // editReply 실패 (예: interaction 만료) 시 인터벌 중지 및 로깅
             console.error('[/chat] 스트리밍 중 editReply 실패:', editError);
             logToDiscord(client, 'WARN', '스트리밍 응답 업데이트 실패', interaction, editError, 'handleRegularConversation_StreamUpdate');
             if (intervalId) clearInterval(intervalId);
             streamFinished = true; // 스트림 처리 중단 플래그
         }
    };


    try {
        console.log('[/chat] Gemini 스트리밍 시작...');
        const chat = model.startChat({ history, generationConfig, safetySettings });
        const result = await chat.sendMessageStream(currentPromptParts);

        // 업데이트 인터벌 시작
        intervalId = setInterval(() => {
             if (!streamFinished) updateReply();
        }, updateInterval);

        for await (const chunk of result.stream) {
            if (streamFinished) break; // editReply 실패 시 루프 중단
            const chunkText = chunk.text();
            process.stdout.write(chunkText); // 콘솔에도 실시간 출력 (디버깅용)
            fullResponseText += chunkText;
        }
        streamFinished = true; // 스트림 정상 종료
        console.log('\n[/chat] Gemini 스트리밍 종료.');
        if (intervalId) clearInterval(intervalId); // 인터벌 중지
        await updateReply(true); // 최종 응답 업데이트

        // --- 4. 성공 시 DB 저장 ---
         try {
             const successInteraction = new Interaction({
                 interactionId: interaction.id,
                 channelId: interaction.channelId,
                 userId: sessionId,
                 userName: interaction.user.username,
                 type: 'MESSAGE',
                 content: userQuestion + (attachment ? ` (첨부: ${attachment.name})` : ''),
                 botResponse: fullResponseText // 최종 결과 저장
             });
             await successInteraction.save();
         } catch (dbError) {
             console.error(`[/chat] 성공 상호작용 DB 저장 실패:`, dbError);
             logToDiscord(client, 'WARN', '성공한 상호작용 DB 기록 실패', interaction, dbError, 'handleRegularConversation_Save');
         }

    } catch (geminiError) {
        // --- 5. Gemini 실패 시 Flowise 폴백 시도 ---
        console.error('[/chat] Gemini 스트리밍 실패:', geminiError);
        logToDiscord(client, 'ERROR', 'Gemini 스트리밍 실패, Flowise 폴백 시도', interaction, geminiError, 'handleRegularConversation_GeminiFail');
        if (intervalId) clearInterval(intervalId); // 인터벌 중지

        try {
            await interaction.editReply({ content: `<@${sessionId}> Gemini 연결에 문제가 있어 Flowise로 다시 시도해볼게... 🤔`, embeds: [] });

            // Flowise 호출 준비 (Gemini용 history/parts 대신 Flowise용 requestBody 사용)
             const flowiseRequestBody = {
                 question: userQuestion,
                 overrideConfig: { sessionId: `flowise-chat-fallback-${sessionId}-${interaction.channelId}`, vars: { bot_name: botName } },
                 history: history.map(turn => ({ // Flowise 형식에 맞게 history 변환 (role: user/ai)
                      role: turn.role === 'model' ? 'ai' : 'user',
                      content: turn.parts[0].text // parts 구조 해제
                 }))
             };
             // Flowise는 스트리밍 미지원 가정 -> 전체 응답 기다림
            const flowiseResponseText = await callFlowise(flowiseRequestBody, sessionId, 'chat-fallback', client, interaction);
            const flowiseResponse = JSON.parse(flowiseResponseText);

            let fallbackDescription = flowiseResponse.text || 'Flowise 폴백 응답을 가져오는 데 실패했습니다.';
            // Flowise 자체 폴백 메시지(message) 추가
            if (flowiseResponse.message) {
                 fallbackDescription += `\n\n${flowiseResponse.message}`;
            }

            const fallbackEndTime = Date.now();
            const fallbackDuration = fallbackEndTime - startTime;

            // 폴백 결과 Embed 생성
            const fallbackEmbed = createAiResponseEmbed({
                 title: userQuestion.substring(0, 250) + (userQuestion.length > 250 ? '...' : ''),
                 description: fallbackDescription,
                 duration: fallbackDuration,
                 user: interaction.user,
                 isFallback: true, // 폴백 플래그 true
                 footerPrefix: "Powered by Flowise (Fallback)",
                 imageUrl: flowiseResponse.imageUrl // Flowise가 이미지 URL 반환 시
             });

            await interaction.editReply({ content: `<@${sessionId}>`, embeds: [fallbackEmbed] });

             try {
                 const fallbackInteraction = new Interaction({
                     interactionId: interaction.id + '-fallback',
                     channelId: interaction.channelId,
                     userId: sessionId,
                     userName: interaction.user.username,
                     type: 'MESSAGE',
                     content: userQuestion + (attachment ? ` (첨부: ${attachment.name})` : '') + ' (Flowise Fallback)',
                     botResponse: fallbackDescription
                 });
                 await fallbackInteraction.save();
             } catch (dbError) {
                 console.error(`[/chat] Flowise 폴백 DB 저장 실패:`, dbError);
                 logToDiscord(client, 'WARN', 'Flowise 폴백 상호작용 DB 기록 실패', interaction, dbError, 'handleRegularConversation_FallbackSave');
             }

        } catch (fallbackError) {
            console.error('[/chat] Flowise 폴백 실패:', fallbackError);
            logToDiscord(client, 'ERROR', 'Gemini 및 Flowise 폴백 모두 실패', interaction, fallbackError, 'handleRegularConversation_FallbackFail');
            throw new Error(`AI 응답 생성 및 폴백 처리에 모두 실패했습니다. (${fallbackError.message})`);
        }
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
            option.setName('question')
                .setDescription('AI에게 할 질문 또는 검색할 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),

    async execute(interaction) {
        const startTime = Date.now();
        await interaction.deferReply();
        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;

        const filter = await generateMongoFilter(userQuestion, sessionId);
        const searchResults = await Interaction.find(filter).sort({ timestamp: -1 }).limit(5).lean();

        if (searchResults.length > 0) {
            await handleMemoryFound(interaction, searchResults, startTime);
        } else {
            await handleRegularConversation(interaction, startTime);
        }
    },
};