// utils/ai_helper.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI, Modality } = require('@google/genai');
const { logToDiscord } = require('../system/catch_log.js');
const { PassThrough } = require('stream');
const fetch = require('node-fetch');
const config = require('../../config/manage_environments.js');

const PYTHON_AI_SERVICE_URL = config.ai.pythonServiceUrl;
const GOOGLE_API_KEY = config.ai.geminiKey;

const FLOWISE_ENDPOINT = config.ai.flowise.endpoint;
const FLOWISE_API_KEY = config.ai.flowise.apiKey;

const GOOGLE_SEARCH_API = config.ai.googleSearch.apiKey;
const GOOGLE_SEARCH_ENGINE_ID = config.ai.googleSearch.engineId;
const SYSTEM_INSTRUCTION = config.ai.persona;

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const ai_live = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

const flashModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION
});

const proModel = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    systemInstruction: SYSTEM_INSTRUCTION
});

const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

async function getEmbedding(text) {
    try {
        const result = await embeddingModel.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error("임베딩 생성 실패:", error);
        return null;
    }
}

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
            throw attachError;
        }
    } else {
        parts.push({ text: promptData.question });
    }
    return parts;
}

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

// 멘션 답변 전용 함수
async function generateMentionReply(history, userMessage) {
    try {
        const chat = flashModel.startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.9
            }
        });

        const finalMessage = `${userMessage} (너는 사용자의 친한 친구이자 유능한 AI 비서야. 
                            설명은 친절하고 귀엽게 반말(해체)로 해줘. 
                            전문적인 내용이라도 쉽고 재미있게 풀어서 설명해줘. 
                            상황에 맞춰서 유연하게 1천 글자 이내로 대답해줘)`;

        const result = await chat.sendMessage(finalMessage);
        return result.response.text();
    } catch (error) {
        console.error('[Gemini Mention] 생성 실패:', error);
        throw error;
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
        vars: {
            persona: config.ai.persona,
            bot_name: '챗별이' || 'AI',
        }
    };

    console.log(`[Flowise Fallback Call] ('${task}') 호출 시도...`);

    try {
        const response = await fetch(FLOWISE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(FLOWISE_API_KEY ? { 'Authorization': `Bearer ${FLOWISE_API_KEY}` } : {})
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

async function generateImage(params) {
    if (!PYTHON_AI_SERVICE_URL) throw new Error("PYTHON_AI_SERVICE_URL 설정 안됨");

    try {
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Python API Error: ${response.status} - ${errText}`);
        }

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
            headers: { 'x-goog-api-key': GOOGLE_API_KEY }
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

    const liveApiModel = "gemini-2.5-flash-native-audio-preview-12-2025";
    const responseQueue = [];
    const smoothingBufferStream = new PassThrough({
        highWaterMark: 192000
    });
    let connectionClosed = false;
    let closeReason = null;

    let fullTranscript = "";
    let resolveSessionReady;
    const sessionReadyPromise = new Promise(resolve => resolveSessionReady = resolve);

    // 바이트 정렬을 위한 임시 저장소 (홀수 바이트 처리용)
    let leftOverBuffer = Buffer.alloc(0);

    const processMessages = () => new Promise((resolve, reject) => {
        const check = () => {
            if (connectionClosed) {
                if (!smoothingBufferStream.destroyed) smoothingBufferStream.push(null);
                return reject(new Error(`Live API 연결 종료: ${closeReason || 'Unknown'}`));
            }
            const msg = responseQueue.shift();
            if (msg) {
                if (msg.data && !smoothingBufferStream.destroyed) {
                    const rawChunk = Buffer.from(msg.data, 'base64');

                    // 남겨둔 바이트가 있다면 합침
                    const combinedChunk = Buffer.concat([leftOverBuffer, rawChunk]);

                    // 짝수 바이트인지 확인 (16-bit PCM은 2바이트가 1샘플)
                    const remainder = combinedChunk.length % 2;

                    if (remainder !== 0) {
                        // 홀수라면 마지막 1바이트를 잘라서 보관하고, 나머지만 전송
                        const validLength = combinedChunk.length - 1;
                        smoothingBufferStream.write(combinedChunk.subarray(0, validLength));
                        leftOverBuffer = combinedChunk.subarray(validLength);
                    } else {
                        // 짝수라면 그대로 전송하고 버퍼 비움
                        smoothingBufferStream.write(combinedChunk);
                        leftOverBuffer = Buffer.alloc(0);
                    }
                }
                if (msg.text) fullTranscript += msg.text + " ";
                if (msg.serverContent && msg.serverContent.turnComplete) {
                    console.log('[디버그] Turn Complete 수신');

                    // 남은 찌꺼기 바이트가 있다면 패딩해서 처리 (데이터 유실 방지)
                    if (leftOverBuffer.length > 0 && !smoothingBufferStream.destroyed) {
                        const padding = Buffer.concat([leftOverBuffer, Buffer.alloc(1)]);
                        smoothingBufferStream.write(padding);
                        leftOverBuffer = Buffer.alloc(0);
                    }

                    if (!smoothingBufferStream.destroyed) smoothingBufferStream.push(null);
                    resolve(fullTranscript.trim());
                    return;
                }
            }
            setTimeout(check, 20);
        };
        check();
    });

    (async () => {
        let session;
        try {
            console.log('[디버그] Live API 연결 시도...');
            // const tools = [{ googleSearch: {} }];

            session = await ai_live.live.connect({
                model: liveApiModel,
                config: {
                    responseModalities: [Modality.AUDIO],
                    // tools: tools,
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    }
                },
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
    const googleApiKey = GOOGLE_SEARCH_API;
    const googleSearchEngineId = GOOGLE_SEARCH_ENGINE_ID;
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
    const timeoutId = setTimeout(() => controller.abort(), 300000);
    const currentKstTime = new Date().toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false // 24시간제 사용 (AI가 헷갈리지 않게)
    }) + " (KST)";

    try {
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/deep-research`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, current_kst_time: currentKstTime }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text().catch(() => "No error details");
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (data.status === 'error') throw new Error(data.message);

        const rawText = data.report;

        // --- [핵심 로직] 태그 파싱 ---
        // 1. 파일 내용 추출 (<REPORT_FILE> ... </REPORT_FILE>)
        const fileMatch = rawText.match(/<REPORT_FILE>([\s\S]*?)<\/REPORT_FILE>/);
        let fileContent = "";
        if (fileMatch && fileMatch[1]) {
            fileContent = fileMatch[1].trim();
        } else {
            // 태그가 없으면 전체를 파일로 간주 (혹은 에러 처리)
            fileContent = rawText;
        }

        // 2. 임베드 내용 추출 (<DISCORD_EMBED> ... </DISCORD_EMBED>)
        const embedMatch = rawText.match(/<DISCORD_EMBED>([\s\S]*?)<\/DISCORD_EMBED>/);
        let embedContent = "";
        if (embedMatch && embedMatch[1]) {
            embedContent = embedMatch[1].trim();
        } else {
            // 태그가 없으면 앞부분만 잘라서 요약으로 사용 (Fallback)
            embedContent = "요약본을 분리하지 못했어! 파일을 확인해줘.\n\n" + rawText.substring(0, 200) + "...";
        }

        // 파싱된 객체 반환
        return {
            fileContent: fileContent,
            embedContent: embedContent
        };

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.error('Deep Research 시간 초과 (Node.js Client Timeout)');
            throw new Error('너무 꼼꼼하게 조사하다 보니 시간이 초과됐어... (5분 경과)');
        }
        console.error('Deep Research 실패:', error);
        throw error;
    }
}

async function analyzeCode(diffData) {
    if (!PYTHON_AI_SERVICE_URL) throw new Error("PYTHON_AI_SERVICE_URL 설정 안됨");

    try {
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/code-review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ diff: diffData })
        });

        if (!response.ok) {
            throw new Error(`Python API Error: ${response.status}`);
        }

        const data = await response.json();
        if (data.status === 'error') throw new Error(data.message);

        const rawText = data.report;

        // --- 태그 파싱 (Deep Research와 동일한 로직 재사용) ---
        const fileMatch = rawText.match(/<REPORT_FILE>([\s\S]*?)<\/REPORT_FILE>/);
        const embedMatch = rawText.match(/<DISCORD_EMBED>([\s\S]*?)<\/DISCORD_EMBED>/);

        return {
            fileContent: fileMatch ? fileMatch[1].trim() : rawText,
            embedContent: embedMatch ? embedMatch[1].trim() : "요약본 분리 실패! 파일을 확인해줘."
        };

    } catch (error) {
        console.error('Code Review 요청 실패:', error);
        throw error;
    }
}

/**
 * 기억 통합(Consolidation) 함수
 * @param {string} prevSummary - 기존 요약본 (없으면 빈 문자열)
 * @param {Array<string>} newMemories - 새로 추가된 대화 내용들
 */
async function consolidateMemories(prevSummary, newMemories) {
    if (!newMemories || newMemories.length === 0) return prevSummary;

    // 대화 내용 합치기 (너무 길면 여기서 자르는 로직 추가 가능)
    const conversationText = newMemories.join('\n');

    const prompt = `
    너는 사용자의 "장기 기억 관리자"야.
    
    [기존 사용자 프로필 및 기억 요약]
    ${prevSummary || "(없음)"}

    [새로 추가된 대화 내용]
    ${conversationText}

    [임무]
    위의 [기존 기억]과 [새 대화]를 통합하여, 최신의 "사용자 프로필 및 장기 기억 보고서"를 작성해줘.
    
    [규칙]
    1. 사용자의 이름, 취향, 성격, 주요 사건, 관계 정보 등 "변하지 않거나 중요한 정보"는 반드시 유지해.
    2. 새로운 대화에서 알게 된 사실을 추가하거나, 기존 정보가 변경되었다면 갱신해.
    3. 불필요한 인사말이나 잡담은 제거하고 "정보" 위주로 요약해.
    4. 말투는 건조한 서술형(예: "~함", "~임")으로 작성해.
    5. 전체 길이는 너무 길지 않게 핵심만 요약해.
    `;

    try {
        const result = await proModel.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('[Memory Consolidation] AI 요약 실패:', error);
        throw error;
    }
}

async function analyzeStock(query) {
    if (!PYTHON_AI_SERVICE_URL) throw new Error("PYTHON_AI_SERVICE_URL 설정 안됨");

    console.log(`[Stock Analysis] '${query}' 분석 요청 시작...`);

    try {
        const response = await fetch(`${PYTHON_AI_SERVICE_URL}/analyze-stock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => "No error details");
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (data.status === 'error') throw new Error(data.message);

        return data;

    } catch (error) {
        console.error('[Stock Analysis] 분석 요청 실패:', error);
        throw error;
    }
}

module.exports = {
    getEmbedding,
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
    deepResearch,
    generateMentionReply,
    analyzeCode,
    consolidateMemories,
    analyzeStock
};