const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { GoogleGenAI, Modality } = require('@google/genai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ai_live = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

const proModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
const flashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * Flowise API를 호출하는 함수
 * @param {object|string} prompt - AI에게 보낼 프롬프트
 * @param {string} sessionId - 대화 세션 ID
 * @param {string} task - 고유 세션 ID를 만들기 위한 작업 설명자
 * @returns {Promise<string>} AI의 텍스트 응답
 */
async function callFlowise(prompt, sessionId, task) {
    const question = typeof prompt === 'object' && prompt.question ? prompt.question : prompt;

    const body = typeof prompt === 'object' ? prompt : { question };
    
    body.overrideConfig = {
        ...body.overrideConfig,
        sessionId: `flowise-${task}-${sessionId}`,
    };

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
        if (aiResponse.text) {
             return aiResponse.text;
        }
        return JSON.stringify(aiResponse);
    } else {
        return await response.text();
    };
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
        const result = await proModel.generateContent(["이 오디오를 한국어 텍스트로 바꿔서 전달해줘.", audioPart]);
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
 * Gemini 실시간 API에 연결하여 스트리밍 오디오 및 텍스트 응답을 가져옵니다.
 * @param {string} prompt - AI를 위한 시스템 명령어 프롬프트
 * @returns {Promise<{audioBuffers: Buffer[], aiTranscript: string, session: any}>}
 */
async function getLiveAiAudioResponse(prompt) {
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

    const session = await ai_live.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
            onmessage: (m) => responseQueue.push(m),
            onerror: (e) => console.error('Live API Error:', e.message),
            onclose: (e) => console.log('Live API Close:', e.reason)
        },
        config: {
            responseModalities: [Modality.AUDIO, Modality.TEXT],
            systemInstruction: { parts: [{ text: prompt }] }
        },
    });

    const turns = await handleTurn();
    const audioBuffers = turns.map(t => t.data ? Buffer.from(t.data, 'base64') : null).filter(Boolean);
    const aiTranscript = turns.map(t => t.text).filter(Boolean).join(' ');

    return { audioBuffers, aiTranscript, session };
}

module.exports = {
    callFlowise,
    generateMongoFilter,
    getTranscript,
    getLiveAiAudioResponse,
    generateAttachmentDescription,
    generateImage,
    genAI,
};