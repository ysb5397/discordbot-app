// utils/ai/training_helper.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { DevProfile, QuizLog } = require('../system/database');
const { getEmbedding } = require('./ai_helper');
const config = require('../../config/manage_environments');

const genAI = new GoogleGenerativeAI(config.ai.geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

/**
 * AI 응답에서 순수 JSON 문자열만 추출하여 파싱하는 헬퍼 함수
 */
function cleanAndParseJSON(text) {
    try {
        // 1. 마크다운 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        // 2. 혹시 모를 앞뒤 공백 제거 후 파싱
        return JSON.parse(cleanText);
    } catch (error) {
        console.error("[JSON Parse Error] Raw Text:", text);
        throw new Error("AI 응답을 JSON으로 변환하는 데 실패했어.");
    }
}

/**
 * 맞춤형 문제 생성하기
 */
async function generateQuiz(userId, topic) {
    // 1. 유저 프로필 조회
    let profile = await DevProfile.findOne({ userId });
    if (!profile) profile = await DevProfile.create({ userId });

    // 2. 과거 오답 노트 검색 (Vector Search or Recent Failures)
    const recentFails = await QuizLog.find({ userId, isCorrect: false })
        .sort({ timestamp: -1 })
        .limit(3)
        .select('question topic');

    const weakPoints = recentFails.length > 0
        ? recentFails.map(f => `[${f.topic}] ${f.question}`).join('\n')
        : "데이터 없음 (신규 유저)";

    // 3. 프롬프트 구성
    const prompt = `
        너는 시니어 개발자 기술 면접관이야.
        사용자(Lv.${profile.level})에게 '${topic}' 주제로 실무 면접 질문을 하나만 만들어줘.
        
        [사용자의 약점/과거 오답]
        ${weakPoints}

        [요구사항]
        1. 사용자의 약점을 보완하거나, 레벨에 맞는 깊이 있는 질문을 해줘.
        2. "네/아니오" 단답형보다는 원리를 묻거나 상황을 제시하는 문제를 선호해.
        3. 반드시 아래 JSON 형식으로만 응답해. (마크다운 없이)
        
        { 
            "question": "질문 내용 (한국어)", 
            "difficulty": "Easy/Medium/Hard 중 하나" 
        }
    `;


    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return cleanAndParseJSON(text);
}

/**
 * 답변 채점하기
 */
async function evaluateAnswer(userId, topic, questionData, userAnswer) {
    const prompt = `
        [면접 질문 (${topic} / ${questionData.difficulty})]
        ${questionData.question}

        [사용자 답변]
        ${userAnswer}

        위 답변을 시니어 개발자 관점에서 평가해줘.
        반드시 아래 JSON 형식으로만 응답해.

        {
            "isCorrect": true (핵심을 잘 짚었으면) 또는 false,
            "score": 0~100 사이 정수,
            "feedback": "구체적인 피드백 (반말, 친근하게, 부족한 점 지적)",
            "betterAnswer": "모범 답안 요약"
        }
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const evalData = cleanAndParseJSON(text);

    try {
        const embedding = await getEmbedding(questionData.question);

        await QuizLog.create({
            userId,
            topic: topic || "General",
            question: questionData.question,
            userAnswer,
            aiEvaluation: evalData.feedback,
            isCorrect: evalData.isCorrect,
            difficulty: questionData.difficulty,
            embedding
        });

        // 정답일 경우 경험치 지급
        if (evalData.isCorrect) {
            const xpGain = evalData.difficulty === 'Hard' ? 50 : (evalData.difficulty === 'Medium' ? 30 : 10);
            await DevProfile.updateOne(
                { userId },
                {
                    $inc: { xp: xpGain },
                    $set: { lastTrainedAt: new Date() }
                }
            );
        }
    } catch (dbError) {
        console.error("[Training DB Error]", dbError);
    }

    return evalData;
}

module.exports = { generateQuiz, evaluateAnswer };