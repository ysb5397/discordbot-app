// 변경점 1: 'node-fetch'는 Node.js 18+부터 내장되어 있어 별도 설치가 필요 없어.
// const fetch = require('node-fetch'); 
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

// AI 클라이언트 초기화
// 참고: @google/genai 패키지는 @google/generative-ai의 새로운 버전이야. 
// 특별히 live.connect 같은 베타 기능을 쓰는 게 아니라면 하나로 통일하는 게 좋아.
// 여기서는 원래 코드의 구조를 유지하기 위해 그대로 둘게.
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;
const imagenEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict`;
const geminiKey = process.env.GEMINI_API_KEY;

// 변경점 2: 모델은 한 번만 생성해서 재사용하는 게 효율적이야.
const visionModel = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
const flashModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Flowise API를 호출하는 함수
 * @param {string} prompt - AI에게 보낼 프롬프트
 * @param {string} sessionId - 대화 세션 ID
 * @param {string} task - 고유 세션 ID를 만들기 위한 작업 설명자
 * @returns {Promise<string>} AI의 텍스트 응답
 */
async function callFlowise(prompt, sessionId, task) {
    const response = await fetch(flowiseEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
        },
        body: JSON.stringify({
            question: prompt,
            overrideConfig: {
                sessionId: `flowise-${task}-${sessionId}`,
            }
        }),
    });

    if (!response.ok) {
        // 변경점 3: 에러 메시지에 상태 코드를 포함하면 디버깅에 더 유용해.
        const errorBody = await response.text();
        throw new Error(`Flowise API 호출 실패 ('${task}'): ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const aiResponse = await response.json();
    return aiResponse.text;
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
        // 변경점 4: AI가 markdown 코드를 포함해서 응답할 경우를 대비해 더 안정적인 파싱 로직으로 변경
        const jsonMatch = aiResponseText.match(/\{.*\}/s);
        if (!jsonMatch) {
            throw new Error("응답에서 유효한 JSON 객체를 찾을 수 없습니다.");
        }
        const filter = JSON.parse(jsonMatch[0]);
        
        // 이 부분은 보안상 아주 중요한 로직이라 잘 유지했어! 훌륭해!
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
        // 미리 생성해둔 flashModel 재사용
        const audioPart = { inlineData: { data: audioBuffer.toString('base64'), mimeType: "audio/ogg" } }; // ogg나 opus가 pcm보다 효율적일 수 있어.
        const result = await flashModel.generateContent(["이 오디오를 한국어로 전사해 줘.", audioPart]);
        return result.response.text();
    } catch (error) {
        console.error("음성 텍스트 변환(STT) 중 오류:", error);
        return null;
    }
}

// 변경점 5: 이미지와 텍스트 파일 분석 함수를 하나로 통합 (코드 중복 제거)
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
            model = visionModel; // vision 모델 사용
            prompt = "이 이미지를 데이터베이스 검색 항목으로 사용할 수 있도록 간결하고 사실적으로 묘사해 줘. 한국어로 답변해 줘.";
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            contentParts.push({ inlineData: { data: imageBuffer.toString('base64'), mimeType: contentType } });

        } else if (contentType.startsWith('text/')) {
            model = flashModel; // flash 모델 사용
            prompt = "이 텍스트 파일 내용을 데이터베이스 검색 항목으로 사용할 수 있도록 간결하고 사실적으로 요약해 줘. 한국어로 답변해 줘.";
            const fileContent = await response.text();
            // 파일 내용이 너무 길 경우를 대비 (좋은 아이디어야!)
            const truncatedContent = fileContent.substring(0, 4000);
            contentParts.push(truncatedContent);

        } else {
            // 지원하지 않는 파일 타입
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
        // 에러 메시지를 호출한 쪽으로 전달
        throw new Error(errorData.error.message || "AI 이미지 생성 중 오류가 발생했습니다.");
    }

    const geminiResponse = await response.json();
    const predictions = geminiResponse.predictions;

    if (!predictions || predictions.length === 0) {
        throw new Error("AI로부터 이미지를 생성하지 못했습니다.");
    }

    // Base64 인코딩된 이미지 데이터를 Buffer 객체 배열로 변환하여 반환
    return predictions.map(p => Buffer.from(p.bytesBase64Encoded, 'base64'));
}


module.exports = {
    callFlowise,
    generateMongoFilter,
    getTranscript,
    // getLiveAiAudioResponse, // @google/genai 관련 코드는 별도 파일로 관리하거나, 이 파일에서 @google/generative-ai 대신 @google/genai로 통일하는 것을 추천
    generateAttachmentDescription, // 통합된 함수 export
    generateImage,
    genAI, // 클라이언트 객체 이름 변경
};