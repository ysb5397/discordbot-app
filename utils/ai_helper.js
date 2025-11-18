// utils/ai_helper.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI, Modality } = require('@google/genai');
const { logToDiscord } = require('./catch_log.js');
const { PassThrough } = require('stream');
const fetch = require('node-fetch');

const PYTHON_AI_SERVICE_URL = process.env.PYTHON_AI_SERVICE_URL;
const GOOGLE_API_KEY = process.env.GEMINI_API_KEY;

const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const ai_live = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
const flashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
const proModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });


// --- 헬퍼: Gemini 프롬프트 구성 (채팅 스트리밍용 - Node.js 유지) ---
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
             throw attachError; 
        }
    } else {
        parts.push({ text: promptData.question });
    }
    return parts;
}

/**
 * Gemini 스트리밍 채팅 (Node.js 유지)
 * - 채팅은 스트리밍이 중요해서 일단 Node.js에 두는 게 반응 속도 면에서 유리할 수 있어.
 * - 원한다면 이것도 나중에 파이썬으로 옮길 수 있어.
 */
async function* getChatResponseStreamOrFallback(promptData, attachment, sessionId, { client, interaction, task = 'chat' }, selectedModel, tokenLimit) {
    let history = promptData.history || [];
    let currentPromptParts;
    let model;

    try {
        if (attachment || selectedModel === proModel) {
            model = proModel; 
            currentPromptParts = await buildGeminiPrompt(promptData, attachment);
        } else {
            model = flashModel;
            currentPromptParts = [{ text: promptData.question }];
        }
    } catch (setupError) {
         yield { error: setupError };
         return;
    }

    try {
        console.log(`[/chat ${task}] Gemini 스트리밍 시작...`);
        const generationConfig = { maxOutputTokens: tokenLimit };
        const chat = model.startChat({ history, generationConfig });
        const result = await chat.sendMessageStream(currentPromptParts);

        let fullResponseText = "";
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                 fullResponseText += chunkText;
                 yield { textChunk: chunkText };
            }
        }
        console.log(`[/chat ${task}] Gemini 스트리밍 정상 종료.`);
        yield { finalResponse: { text: fullResponseText, message: null }, isFallback: false };

    } catch (geminiError) {
        console.error(`[/chat ${task}] Gemini 스트리밍 실패:`, geminiError);
        logToDiscord(client, 'ERROR', `Gemini 스트리밍 실패 (${task}), Flowise 폴백 시도`, interaction, geminiError, 'getChatResponseStreamOrFallback_GeminiFail');

        try {
             const flowiseRequestBody = {
                 question: promptData.question,
                 overrideConfig: {
                     sessionId: `flowise-fallback-${task}-${sessionId}`,
                     vars: {
                         bot_name: client?.user?.username || 'AI 비서',
                         user_name: interaction?.user?.username || '사용자'
                     }
                 },
                 history: history.map(turn => ({
                      role: turn.role === 'model' ? 'ai' : 'user',
                      content: turn.parts[0].text
                 }))
             };

             const flowiseResponseText = await callFlowise(flowiseRequestBody, sessionId, task + '-fallback', client, interaction);
             const flowiseResponse = JSON.parse(flowiseResponseText);

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
    try {
        if (!PYTHON_AI_SERVICE_URL) throw new Error("PYTHON_AI_SERVICE_URL 설정 안됨");
        
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/generate-filter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                user_id: userId,
                current_time: new Date().toISOString()
            })
        });
        
        if (!response.ok) throw new Error(`Python API Error: ${response.status}`);
        
        const filter = await response.json();
        if (filter.status === 'error') throw new Error(filter.message);
        
        filter.userId = userId;
        return filter;
    } catch (error) {
        console.error("Mongo 필터 생성 실패 (Python):", error);
        if (client) logToDiscord(client, 'ERROR', 'Mongo 필터 생성 실패 (Python)', interaction, error, 'generateMongoFilter');
        throw error;
    }
}

async function generateAttachmentDescription(attachment) {
    try {
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/describe-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: attachment.url,
                mime_type: attachment.contentType || 'application/octet-stream',
                file_name: attachment.name
            })
        });

        if (!response.ok) throw new Error(`Python API Error: ${response.status}`);

        const data = await response.json();
        return data.description || `(AI 분석 실패: 응답 없음)`;

    } catch (error) {
        console.error(`파일 분석 요청 실패 (${attachment.name}):`, error);
        return `(AI 분석 실패: ${attachment.name})`;
    }
}

async function generateImage(prompt, count = 1) {
    if (!PYTHON_AI_SERVICE_URL) throw new Error("PYTHON_AI_SERVICE_URL 설정 안됨");

    try {
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, count }),
        });

        if (!response.ok) throw new Error(`Python API Error: ${response.status}`);

        const pythonResponse = await response.json();
        if (pythonResponse.status === 'error') throw new Error(pythonResponse.message);

        const base64Strings = pythonResponse.images;
        if (!base64Strings || base64Strings.length === 0) throw new Error("유효한 이미지를 받지 못함");
        
        return base64Strings.map(b64 => Buffer.from(b64, 'base64'));

    } catch (error) {
        console.error('Python AI 서비스(generateImage) 호출 중 예외 발생:', error);
        throw error;
    }
}

async function startVideoGeneration(prompt) {
    const response = await fetch(`${PYTHON_AI_SERVICE_URL}/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    });
    
    const data = await response.json();
    if (data.status === 'error') throw new Error(data.message);
    if (!data.name) throw new Error('Veo 작업 이름을 받지 못했습니다.');
    
    return data.name;
}

async function checkVideoGenerationStatus(operationName) {
    const safeOpName = encodeURIComponent(operationName); 
    
    const response = await fetch(`${PYTHON_AI_SERVICE_URL}/check-operation/${safeOpName}`, { 
       method: 'GET' 
    });
    return await response.json();
}

async function downloadVideoFromUri(videoUri) {
    console.log(`[디버그] 영상 다운로드 시작: ${videoUri}`);
    try {
        const response = await fetch(videoUri, {
            method: 'GET',
            headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }
        });
        if (!response.ok) throw new Error(`영상 다운로드 실패: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
         console.error(`영상 다운로드 오류:`, error);
         throw error;
    }
}

async function getLiveAiAudioResponse(systemPrompt, userAudioStream, activeSession) {
    
    const liveApiModel = "gemini-2.5-flash";
    const responseQueue = [];
    const smoothingBufferStream = new PassThrough({
        highWaterMark: 48000
    }); 
    let connectionClosed = false;
    let closeReason = null;

    let fullTranscript = "";
    let resolveSessionReady;
    const sessionReadyPromise = new Promise(resolve => resolveSessionReady = resolve);

    const processMessages = () => new Promise((resolve, reject) => {
        const check = () => {
            if (connectionClosed) {
                if (!smoothingBufferStream.destroyed) smoothingBufferStream.push(null);
                return reject(new Error(`Live API 연결 종료: ${closeReason || 'Unknown'}`));
            }
            const msg = responseQueue.shift();
            if (msg) {
                if (msg.data && !smoothingBufferStream.destroyed) {
                    smoothingBufferStream.write(Buffer.from(msg.data, 'base64'));
                }
                if (msg.text) fullTranscript += msg.text + " ";
                if (msg.serverContent && msg.serverContent.turnComplete) {
                    console.log('[디버그] Turn Complete 수신');
                    if (!smoothingBufferStream.destroyed) smoothingBufferStream.push(null);
                    resolve(fullTranscript.trim());
                    return;
                }
            }
            setTimeout(check, 50);
        };
        check();
    });

    (async () => {
        let session;
        try {
            console.log('[디버그] Live API 연결 시도...');
            session = await ai_live.live.connect({
                model: liveApiModel,
                config: { responseModalities: [Modality.AUDIO] },
                callbacks: {
                    onmessage: (m) => responseQueue.push(m),
                    onerror: (e) => { 
                        console.error('Live API Error:', e);
                        closeReason = e.message; 
                        connectionClosed = true; 
                    },
                    onclose: (e) => { 
                        console.log('Live API Close:', e.reason); 
                        closeReason = e.reason; 
                        connectionClosed = true; 
                    }
                }
            });
            console.log('[디버그] Live API 연결 성공.');
            
            if (activeSession) activeSession.liveSession = session;
            resolveSessionReady(session);

            if (systemPrompt) {
                session.sendClientContent({
                    turns: [{ role: "user", parts: [{ text: systemPrompt }] }],
                    turnComplete: false
                });
            }

            userAudioStream.on('data', (chunk) => {
                if (connectionClosed) { userAudioStream.destroy(); return; }
                try {
                    session.sendRealtimeInput({
                        media: {
                            data: chunk.toString('base64'),
                            mimeType: 'audio/pcm;rate=16000'
                        }
                    });
                } catch (e) {
                    if (!connectionClosed) session.close();
                    connectionClosed = true;
                }
            });

            userAudioStream.on('end', () => console.log('[디버그] 유저 오디오 스트림 종료.'));

        } catch (connectError) {
             console.error('[디버그] Live API 연결 실패:', connectError);
             if (!smoothingBufferStream.destroyed) smoothingBufferStream.push(null);
             if (resolveSessionReady) resolveSessionReady(null);
             connectionClosed = true;
        }
    })();

    console.log('[디버그] AI 응답 처리 대기 중...');
    const aiTranscriptPromise = processMessages();
    
    return { aiTranscriptPromise, smoothingBufferStream, sessionReadyPromise };
}

async function getTranscript(audioBuffer) {
    try {
        const audioPart = { inlineData: { data: audioBuffer.toString('base64'), mimeType: "audio/ogg" } };
        const result = await proModel.generateContent(["Transcribe this audio in Korean.", audioPart]);
        return result.response.text();
    } catch (error) {
        console.error("STT 오류:", error);
        return null;
    }
}

async function generateSearchQuery(userQuestion, sessionId, client, interaction) {
    const prompt = `You are a search query optimization expert... (생략) User Question: "${userQuestion}"`;
    const aiResponseText = await callFlowise(prompt, sessionId, 'query-generation', client, interaction);
    try {
        const aiResponse = JSON.parse(aiResponseText);
        return (aiResponse.text || '').replace(/"/g, '').trim();
    } catch (parseError) {
        return userQuestion;
    }
}

async function searchWeb(query) {
    const googleApiKey = process.env.GOOGLE_SEARCH_API;
    const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    const customsearch = require('googleapis').google.customsearch('v1');

    if (!googleApiKey || !googleSearchEngineId) throw new Error("구글 검색 키 설정 안됨");
    
    try {
        const res = await customsearch.cse.list({
            auth: googleApiKey, cx: googleSearchEngineId, q: query, num: 5
        });
        return res.data.items || [];
    } catch (error) {
        throw new Error(`웹 검색 실패: ${error.message}`);
    }
}

async function deepResearch(query) {
    if (!PYTHON_AI_SERVICE_URL) throw new Error("PYTHON_AI_SERVICE_URL 설정 안됨");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/deep-research`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text().catch(() => "No error details");
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (data.status === 'error') throw new Error(data.message);

        return data.report;

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.error('Deep Research 시간 초과 (Node.js Client Timeout)');
            throw new Error('리서치 시간이 너무 오래 걸려서 중단되었어. (3분 초과)');
        }
        console.error('Deep Research 실패:', error);
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
    generateSearchQuery,
    searchWeb,
    deepResearch
};