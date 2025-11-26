// utils/ai/training_helper.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { DevProfile, QuizLog } = require('../system/database');
const { getEmbedding } = require('./ai_helper');
const config = require('../../config/manage_environments');

const genAI = new GoogleGenerativeAI(config.ai.geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

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

    const weakPoints = recentFails.map(f => `[${f.topic}] ${f.question}`).join('\n');

    // 3. 프롬프트 구성
    const prompt = `
        너는 시니어 개발자 면접관이자 멘토야.
        사용자(레벨 ${profile.level})에게 '${topic}' 관련 실무/기술 면접 질문을 하나만 내줘.
        
        [사용자의 약점 (최근 틀린 문제)]
        ${weakPoints || "아직 데이터 없음. 기초부터 시작."}

        [요구사항]
        1. 약점을 보완할 수 있거나, 사용자의 레벨에 맞는 문제를 내줘.
        2. 단순 암기보다는 "상황 제시형"이나 "원리 설명" 문제를 선호해.
        3. 출력 형식은 JSON으로 해줘: { "question": "문제 내용", "difficulty": "난이도(Easy/Medium/Hard)" }
        4. 한국어로 질문해.
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(text);
}

/**
 * 답변 채점하기
 */
async function evaluateAnswer(userId, questionData, userAnswer) {
    const prompt = `
        [문제] ${questionData.question}
        [사용자 답변] ${userAnswer}

        위 답변을 시니어 개발자 관점에서 평가해줘.
        
        [출력 형식 JSON]
        {
            "isCorrect": true/false (핵심을 찔렀으면 true),
            "score": 0~100점,
            "feedback": "피드백 내용 (반말, 친절하게, 부족한 점 지적)",
            "betterAnswer": "모범 답안 요약"
        }
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    const evalData = JSON.parse(text);

    // DB 저장 (비동기)
    const embedding = await getEmbedding(questionData.question);

    await QuizLog.create({
        userId,
        topic: "General",
        question: questionData.question,
        userAnswer,
        aiEvaluation: evalData.feedback,
        isCorrect: evalData.isCorrect,
        difficulty: questionData.difficulty,
        embedding
    });

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

    return evalData;
}

module.exports = { generateQuiz, evaluateAnswer };