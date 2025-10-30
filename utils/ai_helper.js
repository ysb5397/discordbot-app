// utils/ai_helper.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI, Modality } = require('@google/genai'); // Live API용
const { logToDiscord } = require('./catch_log.js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ai_live = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); // Live API용
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

// 모델 이름 확인 필요
const proModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
const flashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- 헬퍼: Gemini 프롬프트 구성 ---
async function buildGeminiPrompt(promptData, attachment) {
    const parts = [];
    if (attachment) {
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`첨부파일 다운로드 실패: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const imageBuffer = Buffer.from(arrayBuffer);
            const mimeType = attachment.contentType || 'application/octet-stream';
            parts.push({ inlineData: { data: imageBuffer.toString("base64"), mimeType } });
            parts.push({ text: promptData.question + `\n(첨부 파일: ${attachment.name})` });
        } catch (attachError) {
             console.error('[AI Helper] 첨부파일 처리 중 오류:', attachError);
             throw attachError; // 오류 전파
        }
    } else {
        parts.push({ text: promptData.question });
    }
    return parts;
}

/**
 * Gemini 스트리밍 채팅 응답을 시도하고, 실패 시 Flowise 폴백으로 전환하는 비동기 제너레이터.
 * @param {object} promptData - 프롬프트 데이터 { question: string, history?: Array<{role: string, parts: Array<{text: string}>}> }
 * @param {object | null} attachment - Discord 첨부 파일 객체 (선택)
 * @param {string} sessionId - 세션 ID
 * @param {object} options - 추가 옵션 { client, interaction, task }
 * @param {string} model - 사용할 AI 모델 ('gemini-2.5-flash' 또는 'gemini-2.5-pro')
 * @param {number} tokenLimit - AI 응답의 최대 토큰 수
 * @yields {object} 스트리밍 상태 객체: { textChunk?: string, finalResponse?: { text: string, message: string | null }, error?: Error, isFallback?: boolean }
 */
async function* getChatResponseStreamOrFallback(promptData, attachment, sessionId, { client, interaction, task = 'chat' }, selectedModel, tokenLimit) {
    let history = promptData.history || [];
    let currentPromptParts;
    let model;

    // --- 1. 모델 및 프롬프트 준비 ---
    try {
        if (attachment || selectedModel === 'gemini-2.5-pro') {
            model = proModel; // 이미지 처리용 모델
            // buildGeminiPrompt가 attachment 처리 및 에러 throw
            currentPromptParts = await buildGeminiPrompt(promptData, attachment);
        } else {
            model = flashModel; // 텍스트 전용 모델
            currentPromptParts = [{ text: promptData.question }];
        }
    } catch (setupError) {
         yield { error: setupError }; // 준비 단계 에러
         return;
    }


    // --- 2. Gemini 스트리밍 시도 ---
    try {
        console.log(`[/chat ${task}] Gemini 스트리밍 시작...`);
        // Gemini 설정
        const generationConfig = {
            // temperature: 0.7, // 창의성 조절 (0 ~ 1)
            // topP: 0.9,       // 단어 선택 다양성 (0 ~ 1)
            // topK: 40,        // 고려할 단어 수
            maxOutputTokens: tokenLimit, // 최대 출력 토큰 제한
        };
        const chat = model.startChat({ history, generationConfig });
        const result = await chat.sendMessageStream(currentPromptParts);

        let fullResponseText = "";
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) { // 빈 청크 방지
                 fullResponseText += chunkText;
                 yield { textChunk: chunkText }; // 스트리밍 청크 반환
            }
        }
        console.log(`[/chat ${task}] Gemini 스트리밍 정상 종료.`);
        // 스트리밍 완료 후 최종 결과 반환
        yield { finalResponse: { text: fullResponseText, message: null }, isFallback: false };

    } catch (geminiError) {
        // --- 3. Gemini 실패 시 Flowise 폴백 시도 ---
        console.error(`[/chat ${task}] Gemini 스트리밍 실패:`, geminiError);
        logToDiscord(client, 'ERROR', `Gemini 스트리밍 실패 (${task}), Flowise 폴백 시도`, interaction, geminiError, 'getChatResponseStreamOrFallback_GeminiFail');

        try {
             // Flowise 요청 본문 준비 (Flowise 형식으로 변환)
             const flowiseRequestBody = {
                 question: promptData.question,
                 overrideConfig: {
                     sessionId: `flowise-fallback-${task}-${sessionId}`,
                     vars: {
                         // 여기에 변수 추가
                         // options 객체에서 interaction 정보를 가져와 사용
                         bot_name: client?.user?.username || 'AI 비서', // client가 있으면 봇 이름 사용
                         user_name: interaction?.user?.username || '사용자' // interaction이 있으면 사용자 이름 사용
                         // 필요하다면 다른 변수들도 추가 가능:
                         // channel_name: interaction?.channel?.name,
                         // guild_name: interaction?.guild?.name,
                     }
                 },
                 history: history.map(turn => ({
                      role: turn.role === 'model' ? 'ai' : 'user',
                      content: turn.parts[0].text
                 }))
             };

             // callFlowise 호출 (폴백 전용)
             const flowiseResponseText = await callFlowise(flowiseRequestBody, sessionId, task + '-fallback', client, interaction);
             const flowiseResponse = JSON.parse(flowiseResponseText); // { text, message }

             console.log(`[/chat ${task}] Flowise 폴백 성공.`);
             yield { finalResponse: flowiseResponse, isFallback: true };

        } catch (fallbackError) {
             console.error(`[/chat ${task}] Flowise 폴백 실패:`, fallbackError);
             logToDiscord(client, 'ERROR', `Gemini 및 Flowise 폴백 모두 실패 (${task})`, interaction, fallbackError, 'getChatResponseStreamOrFallback_FallbackFail');
             yield { error: new Error(`AI 응답 생성 및 폴백 처리에 모두 실패했습니다. (${fallbackError.message})`) };
        }
    }
}


/**
 * Flowise API를 호출하는 함수 (이제 폴백 전용).
 * 항상 { text: string, message: string | null } 형태의 JSON 문자열 반환.
 * @param {object|string} prompt - AI에게 보낼 프롬프트
 * @param {string} sessionId - 대화 세션 ID
 * @param {string} task - 작업 설명자
 * @param {import('discord.js').Client | null} [client=null] - 로깅용
 * @param {import('discord.js').Interaction | null} [interaction=null] - 로깅용
 * @returns {Promise<string>} AI 응답 (JSON 문자열: {"text": "...", "message": "..."})
 */
async function callFlowise(prompt, sessionId, task, client = null, interaction = null) {
    const question = typeof prompt === 'object' && prompt.question ? prompt.question : prompt;
    const body = typeof prompt === 'object' ? prompt : { question };

    body.overrideConfig = {
        ...body.overrideConfig,
        sessionId: `flowise-${task}-${sessionId}`,
    };

    console.log(`[Flowise Fallback Call] ('${task}') 호출 시도...`);

    try {
        const response = await fetch(flowiseEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            if (client && interaction) {
                logToDiscord(client, 'WARN', `Flowise API 호출 실패 ('${task}'): ${response.status}`, interaction, new Error(errorBody), `callFlowise/${task}`);
            } else if (client) {
                logToDiscord(client, 'WARN', `Flowise API 호출 실패 ('${task}'): ${response.status}`, null, new Error(errorBody), `callFlowise/${task}`);
            }
            throw new Error(`Flowise API 호출 실패 ('${task}'): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("application/json")) {
            const aiResponse = await response.json();
            if (!aiResponse.hasOwnProperty('message')) aiResponse.message = null;
            if (!aiResponse.hasOwnProperty('text')) aiResponse.text = "";

            if (client) {
                logToDiscord(client, 'INFO', `Flowise 폴백 ('${task}') JSON 응답 수신`, interaction, null, `callFlowise/${task}`);
            }

            logToDiscord(client, 'INFO', `Flowise 폴백 ('${task}') JSON 응답 수신`, interaction, null, `callFlowise/${task}`);
            return JSON.stringify(aiResponse);
        } else {
            const responseText = await response.text();
            logToDiscord(client, 'INFO', `Flowise 폴백 ('${task}') 텍스트 응답 수신`, interaction, null, `callFlowise/${task}`);
            return JSON.stringify({ text: responseText, message: null });
        }

    } catch (flowiseError) {
        console.error(`[Flowise Fallback Error] ('${task}') ${flowiseError.message}`);
        
        if (client) {
            logToDiscord(client, 'ERROR', `Flowise 폴백 ('${task}') 호출 실패`, interaction, flowiseError, `callFlowise/${task}`);
        }

        return JSON.stringify({
            text: "",
            message: `미안... Gemini 연결 실패 후 Flowise 폴백도 실패했어... 😭 (${flowiseError.message})`
        });
    }
}

async function generateMongoFilter(query, userId, client = null, interaction = null) {
    const prompt = `
    You are an expert MongoDB query filter generator. Your task is to analyze a user's natural language request and generate a valid JSON filter object for a MongoDB 'find' operation.

    **--- ⚡️ VERY STRICT OUTPUT RULES ---**
    1.  Your **entire response MUST be a valid JSON object**.
    2.  Do NOT include any explanations, comments, greetings, or markdown (like \`\`\`json\`).
    3.  Do NOT include the 'userId' field in the filter. The calling system adds this automatically.
    4.  For text matching, use the '$regex' operator with '$options: "i"'.
    5.  For time-related queries (e.g., "yesterday", "last week", "October"), use the 'timestamp' field with '$gte' and/or '$lt'.

    **--- 📖 Schema Information (User-searchable fields) ---**
    - content: (String) The text content of the message.
    - type: (String) Can be 'MESSAGE', 'MENTION', 'EARTHQUAKE'.
    - timestamp: (ISODate) The time the interaction was saved.
    - channelId: (String) The ID of the channel.

    **--- ✍️ Examples ---**

    [Request]: "yesterday's pizza talk"
    [Current Time]: "2025-10-30T08:30:00.000Z"
    [Your Response]:
    {
      "$and": [
        { "content": { "$regex": "pizza", "$options": "i" } },
        { "timestamp": { "$gte": "2025-10-29T00:00:00.000Z", "$lt": "2025-10-30T00:00:00.000Z" } }
      ]
    }

    [Request]: "images from last week, not messages"
    [Current Time]: "2025-10-30T08:30:00.000Z"
    [Your Response]:
    {
      "$and": [
        { "content": { "$regex": "image", "$options": "i" } },
        { "type": { "$ne": "MESSAGE" } },
        { "timestamp": { "$gte": "2025-10-20T00:00:00.000Z", "$lt": "2025-10-27T00:00:00.000Z" } }
      ]
    }

    [Request]: "earthquake"
    [Current Time]: "2025-10-30T08:30:00.000Z"
    [Your Response]:
    {
      "type": "EARTHQUAKE"
    }

    **--- 🚀 Current Task ---**

    - User (for context only): "${userId}"
    - User's natural language query: "${query}"
    - Current date (ISO): "${new Date().toISOString()}"

    Respond ONLY with the valid JSON object.
    `;

    let aiResponseJsonString = '{}';
    try {
        const filterClient = client || (interaction ? interaction.client : null);
        aiResponseJsonString = await callFlowise(prompt, userId, 'mongo-filter-gen', filterClient, interaction);
    } catch (aiError) {
        console.error("Mongo 필터 생성 AI 호출 실패:", aiError);
        throw new Error(`AI 호출에 실패하여 필터를 생성할 수 없습니다: ${aiError.message}`);
    }


    try {
        const aiResponse = JSON.parse(aiResponseJsonString);
        let filterJsonString = aiResponse.text || '{}';

        // JSON 문자열 추출 로직 강화
        if (filterJsonString.trim().startsWith('{') && filterJsonString.trim().endsWith('}')) {
             // 이미 JSON 형태면 그대로 사용
        } else {
             // ```json ... ``` 블록 추출 시도
             const codeBlockMatch = filterJsonString.match(/```json\s*(\{.*\})\s*```/s);
             if (codeBlockMatch && codeBlockMatch[1]) {
                 filterJsonString = codeBlockMatch[1];
             } else {
                 // 그냥 중괄호로 시작하는 부분 추출 시도
                 const jsonMatch = filterJsonString.match(/\{.*\}/s);
                 if (jsonMatch) {
                     filterJsonString = jsonMatch[0];
                 } else {
                     if(aiResponse.message) console.warn(`Mongo 필터 생성 AI가 JSON 대신 메시지 반환: ${aiResponse.message}`);
                     throw new Error(`AI 응답에서 유효한 JSON 필터 객체를 찾을 수 없습니다. 응답 내용: ${aiResponseJsonString.substring(0, 200)}...`);
                 }
             }
        }

        const filter = JSON.parse(filterJsonString); // 여기서 실패할 수도 있음
        filter.userId = userId;
        return filter;

    } catch (parseError) {
        console.error("AI 생성 필터 파싱/처리 실패:", aiResponseJsonString, parseError);
        throw new Error(`AI가 생성한 필터를 분석하는 데 실패했습니다 (${parseError.message}). AI 응답: ${aiResponseJsonString.substring(0, 200)}...`);
    }
}

async function getTranscript(audioBuffer) {
    try {
        const audioPart = { inlineData: { data: audioBuffer.toString('base64'), mimeType: "audio/ogg" } };
        const result = await proModel.generateContent(["Transcribe this audio in Korean.", audioPart]);
        return result.response.text();
    } catch (error) {
        console.error("음성 텍스트 변환(STT) 중 오류:", error);
        return null;
    }
}

async function generateAttachmentDescription(attachment) {
    try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
            return `(파일 불러오기 실패: ${response.statusText})`;
        }
        const contentType = attachment.contentType || '';
        let model;
        let prompt;
        let contentParts = [];

        if (contentType.startsWith('image/')) {
            model = proModel;
            prompt = "이 이미지를 데이터베이스 검색 항목으로 사용할 수 있도록 간결하고 사실적으로 묘사해 줘. 한국어로 답변해 줘.";
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            contentParts.push({ inlineData: { data: imageBuffer.toString('base64'), mimeType: contentType } });
        } else if (contentType.startsWith('text/')) {
            model = flashModel;
            prompt = "이 텍스트 파일 내용을 데이터베이스 검색 항목으로 사용할 수 있도록 간결하고 사실적으로 요약해 줘. 한국어로 답변해 줘.";
            const fileContent = await response.text();
            const truncatedContent = fileContent.substring(0, 4000);
            contentParts.push({ text: truncatedContent });
        } else {
            return `(분석 미지원 파일: ${attachment.name})`;
        }

        const result = await model.generateContent([prompt, ...contentParts]);
        const description = result.response.text();

        if (contentType.startsWith('text/')) {
             return `[텍스트 파일: ${attachment.name}]\n${description}`;
        }
        return description;
    } catch (error) {
        console.error(`AI 파일 분석 중 오류 (${attachment.name}):`, error);
        return `(AI 분석 실패: ${attachment.name})`;
    }
}

async function generateImage(prompt, count = 1) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const imagenEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict";

    if (!geminiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
    count = Math.max(1, Math.min(count, 4));

    const requestBody = { "instances": [{ "prompt": prompt }], "parameters": { "sampleCount": count } };

    try {
        const response = await fetch(imagenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: "Unknown API error" } }));
            console.error(`Gemini Imagen API Error: ${response.status}`, errorData);
            throw new Error(errorData.error?.message || "AI 이미지 생성 오류");
        }
        const geminiResponse = await response.json();
        const predictions = geminiResponse.predictions;
        if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
            console.warn('Gemini Imagen API 응답 형식:', geminiResponse);
            throw new Error("AI로부터 유효한 이미지를 생성하지 못했습니다.");
        }
        return predictions.map(p => {
             if (!p || !p.bytesBase64Encoded) throw new Error("API 응답에 이미지 데이터가 없습니다.");
             return Buffer.from(p.bytesBase64Encoded, 'base64')
        });
    } catch (error) {
        console.error('Gemini Imagen API 호출 중 예외 발생:', error);
        throw error;
    }
}

async function getLiveAiAudioResponse(systemPrompt, userAudioStream) {
    const liveApiModel = "gemini-2.5-flash-native-audio-preview-09-2025";
    const responseQueue = [];
    let connectionClosed = false;
    let closeReason = null;

    const waitMessage = () => new Promise((resolve, reject) => {
        const check = () => {
            if (connectionClosed) return reject(new Error(`Live API 연결 종료됨: ${closeReason || 'Unknown'}`));
            const msg = responseQueue.shift();
            if (msg) resolve(msg);
            else setTimeout(check, 100);
        };
        check();
    });

    const handleTurn = async () => {
        const turns = [];
        try {
            while (!connectionClosed) {
                const message = await waitMessage();
                turns.push(message);
                if (message.serverContent && message.serverContent.turnComplete) {
                     console.log('[디버그] Live API로부터 Turn Complete 수신');
                     return turns;
                }
            }
             console.warn('[디버그] Live API 연결이 종료되어 Turn 처리 중단');
             return turns;
        } catch (error) {
             console.error('[디버그] Live API Turn 처리 중 오류:', error);
             throw error;
        }
    };

    console.log('[디버그] Live API 연결을 시도합니다...');
    let session;
    try {
        const configForConnect = {
            responseModalities: [Modality.AUDIO],
        };

        console.log('[디버그] 전송할 config 객체:', JSON.stringify(configForConnect));

        session = await ai_live.live.connect({
            model: liveApiModel,
            callbacks: {
                onmessage: (m) => responseQueue.push(m),
                onerror: (e) => { 
                    console.error('Live API Error (Full Object):', e); // <--- 객체 전체를 상세히 찍음
                    closeReason = e.message || JSON.stringify(e); 
                    connectionClosed = true; 
                },
                onclose: (e) => { console.log('Live API Close:', e.reason); closeReason = e.reason; connectionClosed = true; }
            },
            config: configForConnect,
        });
        console.log('[디버그] Live API 세션 연결 성공.');

        if (systemPrompt) {
            console.log('[디버그] 시스템 프롬프트를 텍스트로 먼저 전송합니다...');
            session.sendClientContent({
                turns: [{ role: "user", parts: [{ text: systemPrompt }] }],
                turnComplete: false // <--- 오디오가 이어지므로 턴 종료 아님
            });
        }
        
        console.log('[디버그] 오디오 전송 시작.');


    } catch (connectError) {
         console.error('[디버그] Live API 연결 실패:', connectError);
         throw connectError;
    }

    async function sendAudioToSession(stream) {
        return new Promise((resolve, reject) => {
            
            // 'data' 이벤트: FFMPEG가 오디오 청크를 만들 때마다 발생
            stream.on('data', (chunk) => {
                try {
                    if (connectionClosed) {
                        console.warn('[디버그] 오디오 전송 중단 (연결 종료)');
                        stream.destroy(); // 스트림 중단
                        return;
                    }
                    
                    // (Blob_2 형식 + 모델 정보 MIME 타입)
                    session.sendRealtimeInput({
                        media: {
                            data: chunk.toString('base64'),
                            mimeType: 'audio/pcm; rate=16000'
                        }
                    });
                } catch (e) {
                    // 청크 전송 중 동기적 에러 발생 시
                    console.error('[디버그] 오디오 청크 전송 중 동기 오류:', e);
                    if (!connectionClosed) session.close();
                    connectionClosed = true;
                    reject(e);
                }
            });

            // 'end' 이벤트: 오디오 스트림이 (정상적으로) 끝났을 때
            stream.on('end', () => {
                try {
                    if (!connectionClosed) {
                        console.log('[디버그] 사용자 오디오 스트림 전송 완료.');
                        // 턴이 끝났다고 AI에게 알림
                        session.sendClientContent({ turnComplete: true });
                    }
                    console.log('[디버그] 오디오 전송 함수 종료 (end event).');
                    resolve(); // Promise 성공
                } catch (e) {
                    console.error('[디버그] 오디오 전송 end/resolve 중 오류:', e);
                    reject(e);
                }
            });

            // 'error' 이벤트: FFMPEG 등 스트림 자체에서 에러 발생 시
            stream.on('error', (err) => {
                console.error('[디버그] 오디오 전송 스트림 오류:', err);
                if (session && !connectionClosed) session.close();
                connectionClosed = true;
                reject(err); // Promise 실패
            });
        });
    }

    sendAudioToSession(userAudioStream).catch(e => console.error("sendAudioToSession 내부 오류:", e));

    try {
        const turns = await handleTurn();
        const audioBuffers = turns.map(t => t.data ? Buffer.from(t.data, 'base64') : null).filter(Boolean);
        const aiTranscript = turns.map(t => t.text).filter(Boolean).join(' ');
        return { audioBuffers, aiTranscript, session };
    } catch (error) {
         console.error('[디버그] Live API 응답 처리 중 최종 오류:', error);
         if (session && !connectionClosed) session.close();
         throw error;
    }
}

const VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

async function startVideoGeneration(prompt) {
    const endpoint = `${VEO_BASE_URL}/models/veo-3.0-generate-001:predictLongRunning`;
    const requestBody = { instances: [{ prompt: prompt }] };
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Veo API 작업 시작 실패: ${response.status} ${errorText}`);
        }
        const data = await response.json();
        if (!data || !data.name) {
            console.error('Veo API 작업 시작 응답 형식 오류:', data);
            throw new Error('Veo API 작업 이름을 받지 못했습니다.');
        }
        return data.name;
    } catch (error) {
        console.error('Veo API 작업 시작 중 예외 발생:', error);
        throw error;
    }
}

async function checkVideoGenerationStatus(operationName) {
    const endpoint = `${VEO_BASE_URL}/${operationName}`;
    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Veo API 상태 확인 실패 (${operationName}): ${response.status} ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Veo API 상태 확인 중 예외 발생 (${operationName}):`, error);
        throw error;
    }
}

async function downloadVideoFromUri(videoUri) {
    console.log(`[디버그] 영상 다운로드를 시작합니다: ${videoUri}`);
    try {
        const response = await fetch(videoUri, {
            method: 'GET',
            headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`영상 다운로드 실패 (${videoUri}): ${response.status} ${errorText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
         console.error(`영상 다운로드 중 예외 발생 (${videoUri}):`, error);
         throw error;
    }
}

module.exports = {
    getChatResponseStreamOrFallback,
    callFlowise,
    generateMongoFilter,
    getTranscript,
    generateAttachmentDescription,
    generateImage,
    getLiveAiAudioResponse,
    startVideoGeneration,
    checkVideoGenerationStatus,
    downloadVideoFromUri,
};