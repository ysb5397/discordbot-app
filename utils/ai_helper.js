const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { GoogleGenAI, Modality } = require('@google/genai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ai_live = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

const proModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
const flashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * [수정] Flowise API를 호출하는 함수 (폴백 기능 탑재!)
 * @param {object|string} prompt - AI에게 보낼 프롬프트
 * @param {string} sessionId - 대화 세션 ID
 * @param {string} task - 고유 세션 ID를 만들기 위한 작업 설명자
 * @returns {Promise<string>} AI의 텍스트 응답 (Flowise 또는 Gemini Fallback의 JSON 문자열)
 */
async function callFlowise(prompt, sessionId, task) {
    const question = typeof prompt === 'object' && prompt.question ? prompt.question : prompt;
    const body = typeof prompt === 'object' ? prompt : { question };
    
    body.overrideConfig = {
        ...body.overrideConfig,
        sessionId: `flowise-${task}-${sessionId}`,
    };

    // --- [ 여기가 핵심! ] ---
    try {
        // 1. (기존 로직) Flowise를 먼저 시도
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
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const aiResponse = await response.json();
            // Flowise가 JSON 객체를 반환하면, 우리도 일관성을 위해 문자열로 반환
            return JSON.stringify(aiResponse);
        } else {
            // Flowise가 순수 텍스트를 반환하면, JSON 객체 문자열로 포장
            return JSON.stringify({ text: await response.text() });
        }

    } catch (flowiseError) {
        // 2. (신규 로직) Flowise가 실패하면, Gemini 폴백을 호출!
        console.error(flowiseError.message); // Flowise가 왜 실패했는지 로그 남기기
        return callGeminiProFallback(prompt); // 1단계에서 만든 폴백 함수 호출
    }
}

/**
 * [신규] Gemini Pro 폴백(Fallback) 전용 함수
 * Flowise가 실패했을 때 호출되는 비상용 Gemini API
 * @param {object|string} prompt - AI에게 보낼 프롬프트 (Flowise가 받던 것과 동일)
 * @returns {Promise<string>} AI의 텍스트 응답 (JSON 문자열이 아닌, 순수 텍스트)
 */
async function callGeminiProFallback(prompt) {
    console.warn('[Gemini Fallback] Flowise 에이전트 호출 실패. Gemini (Pro) 폴백으로 전환합니다.');
    
    // 1. 프롬프트가 문자열이 아닌 객체(history 포함)일 수 있으니, 질문 텍스트만 추출
    let questionText = '';
    if (typeof prompt === 'string') {
        questionText = prompt;
    } else if (typeof prompt === 'object' && prompt.question) {
        questionText = prompt.question;
        // (참고: 히스토리는 Gemini Pro 기본 모델에겐 일단 무시됨)
    } else {
        questionText = JSON.stringify(prompt); // 최악의 경우, 그냥 문자열로 변환
    }

    try {
        const result = await proModel.generateContent(questionText);
        const fallbackResponse = result.response.text();
        
        // 2. 다른 파일들이 JSON.parse()를 시도할 수 있으므로, Flowise처럼 JSON 객체 문자열로 포장
        return JSON.stringify({
            text: `${fallbackResponse}\n\n*(앗, Flowise 에이전트 연결에 실패해서, Gemini 기본 모델이 대신 답했어!)*`
        });

    } catch (geminiError) {
        console.error(`[Gemini Fallback] 폴백조차 실패...`, geminiError);
        // 3. 폴백마저 실패하면, 역시 JSON 객체 문자열로 에러 반환
        return JSON.stringify({
            text: "미안... Flowise도, Gemini 폴백도 모두 실패했어... 😭"
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

    const aiResponseText = await callFlowise(prompt, userId, 'mongo-filter-gen');

    try {
        const jsonMatch = aiResponseText.match(/\{.*\}/s);
        if (!jsonMatch) {
            throw new Error("응답에서 유효한 JSON 객체를 찾을 수 없습니다.");
        }
        const filter = JSON.parse(jsonMatch[0]);
        
        filter.userId = userId; 
        return filter;
    } catch (e) {
        console.error("AI 생성 필터 파싱 실패:", aiResponseText, e);
        throw new Error("AI가 생성한 필터를 분석하는 데 실패했습니다.");
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
        const result = await proModel.generateContent(["Transcribe this audio in Korean.", audioPart]);
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
            const truncatedContent = fileContent.substring(0, 4000);
            contentParts.push(truncatedContent);

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
 * Gemini Imagen API를 사용해 이미지를 생성하는 함수
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
    
    const requestBody = {
        "instances": [{ "prompt": prompt }],
        "parameters": { "sampleCount": count }
    };

    const response = await fetch(imagenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiKey
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error(`Gemini Imagen API Error: ${response.status}`, errorData);
        throw new Error(errorData.error.message || "AI 이미지 생성 중 오류가 발생했습니다.");
    }

    const geminiResponse = await response.json();
    const predictions = geminiResponse.predictions;

    if (!predictions || predictions.length === 0) {
        throw new Error("AI로부터 이미지를 생성하지 못했습니다.");
    }

    return predictions.map(p => Buffer.from(p.bytesBase64Encoded, 'base64'));
}

/**
 * Gemini 실시간 API에 연결하여 사용자 음성 스트림을 보내고, 스트리밍 오디오/텍스트 응답을 받습니다.
 * @param {string} systemPrompt - AI를 위한 시스템 명령어
 * @param {Readable} userAudioStream - 사용자의 음성 오디오 스트림 (16kHz s16le PCM)
 * @returns {Promise<{audioBuffers: Buffer[], aiTranscript: string, session: any}>}
 */
async function getLiveAiAudioResponse(systemPrompt, userAudioStream) {
    const responseQueue = [];
    const waitMessage = () => new Promise(resolve => {
        const check = () => {
            const msg = responseQueue.shift();
            if (msg) resolve(msg);
            else setTimeout(check, 100);
        };
        check();
    });

    const handleTurn = async () => {
        const turns = [];
        while (true) {
            const message = await waitMessage();
            turns.push(message);
            if (message.serverContent && message.serverContent.turnComplete) return turns;
        }
    };

    console.log('[디버그] Live API 연결을 시도합니다...');
    const session = await ai_live.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
            onmessage: (m) => responseQueue.push(m),
            onerror: (e) => console.error('Live API Error:', e.message),
            onclose: (e) => console.log('Live API Close:', e.reason)
        },
        config: {
            inputModalities: [Modality.AUDIO],
            responseModalities: [Modality.AUDIO],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        },
    });
    console.log('[디버그] Live API 세션이 성공적으로 연결되었습니다. 오디오 전송을 시작합니다.');

    async function sendAudioToSession(stream) {
        try {
            for await (const chunk of stream) {
                session.sendAudio({ data: chunk });
            }
            console.log('[디버그] 사용자 오디오 스트림 전송이 완료되었습니다.');
        } catch (error) {
            console.error('[디버그] 오디오 전송 중 오류:', error);
        }
    }
    
    sendAudioToSession(userAudioStream);

    const turns = await handleTurn();
    const audioBuffers = turns.map(t => t.data ? Buffer.from(t.data, 'base64') : null).filter(Boolean);
    const aiTranscript = turns.map(t => t.text).filter(Boolean).join(' ');

    return { audioBuffers, aiTranscript, session };
}

const VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Veo 영상 생성 작업을 시작하고 작업 이름을 반환합니다.
 * @param {string} prompt - 영상 생성을 위한 프롬프트
 * @returns {Promise<string|null>} 작업 이름 (예: operations/...)
 */
async function startVideoGeneration(prompt) {
    const endpoint = `${VEO_BASE_URL}/models/veo-3.0-generate-001:predictLongRunning`;
    const requestBody = {
        instances: [{ prompt: prompt }]
    };

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
    return data.name;
}

/**
 * 영상 생성 작업의 현재 상태를 확인합니다.
 * @param {string} operationName - 확인할 작업의 이름
 * @returns {Promise<object>} 작업 상태 응답 객체
 */
async function checkVideoGenerationStatus(operationName) {
    const endpoint = `${VEO_BASE_URL}/${operationName}`;
    
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Veo API 상태 확인 실패: ${response.status} ${errorText}`);
    }

    return await response.json();
}

/**
 * Veo API가 제공한 URI에서 실제 비디오 파일을 다운로드합니다.
 * @param {string} videoUri - 다운로드할 비디오의 URI
 *- returns {Promise<Buffer>} - 비디오 파일 데이터 버퍼
 */
async function downloadVideoFromUri(videoUri) {
    console.log(`[디버그] 영상 다운로드를 시작합니다: ${videoUri}`);
    const response = await fetch(videoUri, {
        method: 'GET',
        headers: {
            'x-goog-api-key': process.env.GEMINI_API_KEY
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`영상 다운로드 실패: ${response.status} ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

module.exports = {
    callFlowise,
    generateMongoFilter,
    getTranscript,
    getLiveAiAudioResponse,
    generateAttachmentDescription,
    generateImage,
    genAI,
    startVideoGeneration,
    checkVideoGenerationStatus,
    downloadVideoFromUri,
};