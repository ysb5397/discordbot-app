const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI, Modality } = require('@google/genai');
const { logToDiscord } = require('./catch_log.js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ai_live = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

const proModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
const flashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * Flowise API를 호출하고, 실패 시 Gemini로 폴백하는 함수.
 * 항상 { text: string, message: string | null } 형태의 JSON 문자열을 반환.
 * @param {object|string} prompt - AI에게 보낼 프롬프트 (객체라면 question 속성 포함)
 * @param {string} sessionId - 대화 세션 ID
 * @param {string} task - 고유 세션 ID 및 로깅을 위한 작업 설명자
 * @param {import('discord.js').Client | null} [client=null] - Discord 로깅을 위한 클라이언트
 * @param {import('discord.js').Interaction | null} [interaction=null] - Discord 로깅을 위한 상호작용
 * @returns {Promise<string>} AI 응답 (JSON 문자열: {"text": "...", "message": "..."})
 */
async function callFlowise(prompt, sessionId, task, client = null, interaction = null) {
    const question = typeof prompt === 'object' && prompt.question ? prompt.question : prompt;
    const body = typeof prompt === 'object' ? prompt : { question };

    body.overrideConfig = {
        ...body.overrideConfig,
        sessionId: `flowise-${task}-${sessionId}`,
    };

    try {
        // 1. Flowise 호출 시도
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
            throw new Error(`Flowise API 호출 실패 ('${task}'): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const contentType = response.headers.get("content-type");

        // 2. Flowise 응답 처리 (항상 {text, message} 구조로)
        if (contentType && contentType.includes("application/json")) {
            const aiResponse = await response.json();
            // message 필드가 없으면 null로 추가 (일관성 유지)
            if (!aiResponse.hasOwnProperty('message')) {
                 aiResponse.message = null;
            }
            // text 필드가 없으면 빈 문자열로 추가 (일관성 유지)
             if (!aiResponse.hasOwnProperty('text')) {
                 aiResponse.text = "";
             }

            if (client) {
                await logToDiscord(client, 'DEBUG', `Flowise ('${task}') JSON 응답 수신`, interaction, null, aiResponse);
            } else {
                console.log(`[Flowise JSON] ('${task}') ${JSON.stringify(aiResponse).substring(0,100)}...`);
            }
            return JSON.stringify(aiResponse);

        } else {
            // 순수 텍스트 응답이면 text 필드에 넣고 message는 null
            const responseText = await response.text();
            if (client) {
                 await logToDiscord(client, 'DEBUG', `Flowise ('${task}') 텍스트 응답 수신`, interaction, null, responseText);
            } else {
                 console.log(`[Flowise Text] ('${task}') ${responseText.substring(0,100)}...`);
            }
            return JSON.stringify({ text: responseText, message: null });
        }

    } catch (flowiseError) {
        // 3. Flowise 실패 시 Gemini 폴백 호출
        if (client) {
            await logToDiscord(client, 'WARN', `Flowise ('${task}') 호출 실패. Gemini 폴백 시도.`, interaction, flowiseError, `callFlowise`);
        } else {
             console.error(`[Flowise Error] ('${task}') ${flowiseError.message}. Gemini 폴백 시도.`);
        }
        // 폴백 함수는 이미 {text, message} JSON 문자열을 반환함
        return callGeminiFallback(prompt, client, interaction, task); // client 등 전달 추가
    }
}

/**
 * Gemini Flash 폴백 함수.
 * Flowise 실패 시 호출되며, { text: string, message: string } 형태의 JSON 문자열 반환.
 * @param {object|string} prompt - AI에게 보낼 프롬프트
 * @param {import('discord.js').Client | null} [client=null] - Discord 로깅용
 * @param {import('discord.js').Interaction | null} [interaction=null] - Discord 로깅용
 * @param {string} task - Discord 로깅용 작업 설명자
 * @returns {Promise<string>} AI 응답 (JSON 문자열: {"text": "...", "message": "..."})
 */
async function callGeminiFallback(prompt, client = null, interaction = null, task = 'fallback') {
    console.warn('[Gemini Fallback] Flowise 에이전트 호출 실패. Gemini (Flash) 폴백으로 전환합니다.');

    let questionText = '';
    if (typeof prompt === 'string') {
        questionText = prompt;
    } else if (typeof prompt === 'object' && prompt.question) {
        questionText = prompt.question;
    } else {
        questionText = JSON.stringify(prompt);
    }

    try {
        const result = await flashModel.generateContent(questionText);
        const fallbackResponse = result.response.text();
        const fallbackMessage = "*(앗, Flowise 에이전트 연결에 실패해서, Gemini 기본 모델이 대신 답했어!)*";

        if (client) {
             await logToDiscord(client, 'INFO', `Gemini 폴백 ('${task}') 성공`, interaction, null, { text: fallbackResponse, message: fallbackMessage });
        }

        // text에는 순수 답변, message에는 폴백 알림
        return JSON.stringify({
            text: fallbackResponse,
            message: fallbackMessage
        });

    } catch (geminiError) {
        console.error(`[Gemini Fallback] 폴백조차 실패...`, geminiError);
        const errorMessage = "미안... Flowise도, Gemini 폴백도 모두 실패했어... 😭";

         if (client) {
             await logToDiscord(client, 'ERROR', `Gemini 폴백 ('${task}') 실패`, interaction, geminiError, 'callGeminiFallback');
         }

        // 에러 시 text는 비우고 message에 에러 알림
        return JSON.stringify({
            text: "",
            message: errorMessage
        });
    }
}


/**
 * 자연어 쿼리를 이용해 MongoDB 필터를 생성하는 함수
 * @param {string} query - 사용자의 자연어 쿼리
 * @param {string} userId - 사용자 ID
 * @returns {Promise<object>} 생성된 MongoDB 필터 객체
 */
async function generateMongoFilter(query, userId) {
    const prompt = `
    You are a MongoDB query filter generator. A user wants to find an entry in their interaction history.
    Based on their request, create a JSON filter for a MongoDB 'find' operation.

    - The user's ID is: "${userId}"
    - The user's natural language query is: "${query}"
    - The current date is: "${new Date().toISOString()}"

    - The schema has these fields: 'userId', 'type', 'content', 'timestamp', 'channelId'.
    - The 'type' can be 'MESSAGE', 'MENTION', or 'EARTHQUAKE'. Search all these types unless specified otherwise.
    - For text matching, use the '$regex' operator with '$options: "i"' for case-insensitivity.

    Respond ONLY with the raw JSON filter object. Do not include any other text or markdown formatting (like \`\`\`json).
    `;

    // generateMongoFilter는 내부적으로 AI를 호출하므로, client/interaction 전달 불필요
    const aiResponseJsonString = await callFlowise(prompt, userId, 'mongo-filter-gen');

    try {
        // callFlowise는 항상 JSON 문자열을 반환하므로 바로 파싱 시도
        const aiResponse = JSON.parse(aiResponseJsonString);
        let filterJsonString = aiResponse.text || '{}'; // text 필드에 필터 JSON이 있을 것으로 기대

        // 만약 text 필드가 JSON 객체처럼 보이지 않으면 추가 처리 시도
        if (!filterJsonString.trim().startsWith('{')) {
             const jsonMatch = filterJsonString.match(/\{.*\}/s);
             if (jsonMatch) {
                 filterJsonString = jsonMatch[0];
             } else {
                 // message 필드도 확인
                 if(aiResponse.message) console.warn(`Mongo 필터 생성 AI가 JSON 대신 메시지 반환: ${aiResponse.message}`);
                 throw new Error("AI 응답에서 유효한 JSON 필터 객체를 찾을 수 없습니다.");
             }
        }

        const filter = JSON.parse(filterJsonString);
        filter.userId = userId; // 사용자 ID는 항상 필터에 포함
        return filter;

    } catch (e) {
        console.error("AI 생성 필터 파싱/처리 실패:", aiResponseJsonString, e);
        throw new Error(`AI가 생성한 필터를 분석하는 데 실패했습니다: ${e.message}`);
    }
}

/**
 * 오디오 버퍼를 텍스트로 변환하는 함수
 * @param {Buffer} audioBuffer - 변환할 오디오 버퍼
 * @returns {Promise<string|null>} 변환된 텍스트 또는 에러 시 null
 */
async function getTranscript(audioBuffer) {
    try {
        const audioPart = { inlineData: { data: audioBuffer.toString('base64'), mimeType: "audio/ogg" } };
        const result = await flashModel.generateContent(["Transcribe this audio in Korean.", audioPart]);
        return result.response.text();
    } catch (error) {
        console.error("음성 텍스트 변환(STT) 중 오류:", error);
        return null;
    }
}

/**
 * 첨부 파일(이미지, 텍스트)을 분석하고 설명을 생성하는 함수
 * @param {object} attachment - Discord 첨부 파일 객체 (url, contentType, name 포함)
 * @returns {Promise<string>} 생성된 설명 텍스트
 */
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
            // 모델의 토큰 제한 고려 (예: 4000자)
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

/**
 * Gemini Imagen API를 사용해 이미지를 생성하는 함수 (모델명 확인 필요)
 * @param {string} prompt - 이미지 생성을 위한 프롬프트
 * @param {number} count - 생성할 이미지 개수 (1~4)
 * @returns {Promise<Buffer[]>} 생성된 이미지의 Buffer 배열
 */
async function generateImage(prompt, count = 1) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const imagenEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict";

    if (!geminiKey) {
        throw new Error("이미지 생성 API 키(GEMINI_API_KEY)가 설정되지 않았습니다.");
    }

    if (count < 1 || count > 4) {
        count = 1;
    }

    const requestBody = {
        "instances": [{ "prompt": prompt }],
        "parameters": { "sampleCount": count }
    };

    try {
        const response = await fetch(imagenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': geminiKey
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: "Unknown API error" } }));
            console.error(`Gemini Imagen API Error: ${response.status}`, errorData);
            throw new Error(errorData.error?.message || "AI 이미지 생성 중 오류가 발생했습니다.");
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

/**
 * Gemini 실시간 API에 연결하여 사용자 음성 스트림을 보내고, 스트리밍 오디오/텍스트 응답을 받습니다.
 * (모델명 확인 및 안정성 테스트 필요)
 * @param {string} systemPrompt - AI를 위한 시스템 명령어
 * @param {Readable} userAudioStream - 사용자의 음성 오디오 스트림 (16kHz s16le PCM)
 * @returns {Promise<{audioBuffers: Buffer[], aiTranscript: string, session: any}>}
 */
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
            else setTimeout(check, 100); // 100ms 대기 후 다시 확인
        };
        check();
    });

    const handleTurn = async () => {
        const turns = [];
        try {
            while (!connectionClosed) { // 연결 종료 플래그 확인
                const message = await waitMessage();
                turns.push(message);
                // 응답 형태 확인 필요 (실제 API 응답 구조에 맞게)
                if (message.serverContent && message.serverContent.turnComplete) {
                     console.log('[디버그] Live API로부터 Turn Complete 수신');
                     return turns;
                }
            }
             // 루프 종료 후에도 turns 반환 (중간에 끊겼을 경우)
             console.warn('[디버그] Live API 연결이 종료되어 Turn 처리 중단');
             return turns;
        } catch (error) {
             console.error('[디버그] Live API Turn 처리 중 오류:', error);
             throw error; // 에러 전파
        }
    };

    console.log('[디버그] Live API 연결을 시도합니다...');
    let session;
    try {
        session = await ai_live.live.connect({
            model: liveApiModel,
            callbacks: {
                onmessage: (m) => responseQueue.push(m),
                onerror: (e) => {
                    console.error('Live API Error:', e.message);
                    closeReason = e.message;
                    connectionClosed = true; // 에러 발생 시 연결 종료 처리
                },
                onclose: (e) => {
                    console.log('Live API Close:', e.reason);
                    closeReason = e.reason;
                    connectionClosed = true; // 정상 종료 시에도 플래그 설정
                }
            },
            config: {
                inputModalities: [Modality.AUDIO],
                responseModalities: [Modality.AUDIO], // 오디오 응답도 받을 것인지 확인
                systemInstruction: { parts: [{ text: systemPrompt }] }
            },
        });
        console.log('[디버그] Live API 세션이 성공적으로 연결되었습니다. 오디오 전송을 시작합니다.');
    } catch (connectError) {
         console.error('[디버그] Live API 연결 실패:', connectError);
         throw connectError; // 연결 실패 시 에러 전파
    }


    async function sendAudioToSession(stream) {
        try {
            for await (const chunk of stream) {
                if (connectionClosed) {
                     console.warn('[디버그] 오디오 전송 중단 (Live API 연결 종료됨)');
                     break;
                }
                session.sendAudio({ data: chunk });
            }
            if (!connectionClosed) {
                 console.log('[디버그] 사용자 오디오 스트림 전송이 완료되었습니다.');
            }
        } catch (error) {
            // stream 오류 또는 session.sendAudio 오류 처리
            console.error('[디버그] 오디오 전송 중 오류:', error);
            if (session && !connectionClosed) session.close();
            connectionClosed = true;
        } finally {
             console.log('[디버그] 오디오 전송 함수 종료.');
        }
    }

    // 오디오 전송 시작 (백그라운드에서 실행, 에러는 내부에서 처리)
    sendAudioToSession(userAudioStream).catch(e => console.error("sendAudioToSession 내부 오류 전파됨:", e)); // 예외 처리

    try {
        const turns = await handleTurn();

        const audioBuffers = turns
            .map(t => t.data ? Buffer.from(t.data, 'base64') : null)
            .filter(Boolean);

        const aiTranscript = turns
             .map(t => t.text)
             .filter(Boolean)
             .join(' ');

        return { audioBuffers, aiTranscript, session };

    } catch (error) {
         console.error('[디버그] Live API 응답 처리 중 최종 오류:', error);
         if (session && !connectionClosed) session.close();
         throw error;
    }
}


// Veo API 관련 상수 및 함수들
const VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Veo 영상 생성 작업을 시작하고 작업 이름을 반환합니다.
 * @param {string} prompt - 영상 생성을 위한 프롬프트
 * @returns {Promise<string>} 작업 이름 (예: operations/...)
 */
async function startVideoGeneration(prompt) {
    const endpoint = `${VEO_BASE_URL}/models/veo-3.0-generate-001:predictLongRunning`;
    const requestBody = {
        instances: [{ prompt: prompt }]
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_API_KEY
            },
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

/**
 * 영상 생성 작업의 현재 상태를 확인합니다.
 * @param {string} operationName - 확인할 작업의 이름 ("operations/..." 형태)
 * @returns {Promise<object>} 작업 상태 응답 객체 (done, response, error 등 포함)
 */
async function checkVideoGenerationStatus(operationName) {
    const endpoint = `${VEO_BASE_URL}/${operationName}`;

    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_API_KEY
            }
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

/**
 * Veo API가 제공한 URI에서 실제 비디오 파일을 다운로드합니다.
 * @param {string} videoUri - 다운로드할 비디오의 URI
 * @returns {Promise<Buffer>} - 비디오 파일 데이터 버퍼
 */
async function downloadVideoFromUri(videoUri) {
    console.log(`[디버그] 영상 다운로드를 시작합니다: ${videoUri}`);
    try {
        const response = await fetch(videoUri, {
            method: 'GET',
            headers: {
                'x-goog-api-key': process.env.GEMINI_API_KEY
            }
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
    callFlowise,
    generateMongoFilter,
    getTranscript,
    getLiveAiAudioResponse,
    generateAttachmentDescription,
    generateImage,
    startVideoGeneration,
    checkVideoGenerationStatus,
    downloadVideoFromUri,
};