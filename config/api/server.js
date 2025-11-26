const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const config = require('../manage_environments.js');
const { ApiKey } = require('../../utils/system/database.js');
const { callFlowise } = require('../../utils/ai/ai_helper.js');
const { logToDiscord } = require('../../utils/system/catch_log.js');

// Express 앱 생성
const app = express();

// CORS (모든 도메인 허용 - 나중에는 특정 도메인만 허용하게 수정)
app.use(cors());
app.use(express.json());

const jwtSecret = config.server.jwtSecret;
const port = config.server.port;

// --- 미들웨어: AI API 키 인증 ---
const authenticateApiKey = async (req, res, next) => {
    try {
        const authHeader = req.headers['cs-auth-key'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).send({ error: 'AI 키 인증 헤더(cs-auth-key: Bearer <key>)가 필요합니다.' });
        }
        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).send({ error: '헤더에 AI API 키 값이 없습니다.' });
        }

        const validKey = await ApiKey.findOne({
            keyName: "Flutter AI",
            apiKey: token,
            isActive: true
        });

        if (!validKey) {
            return res.status(401).send({ error: '유효하지 않은 AI API 키입니다.' });
        }
        next();
    } catch (err) {
        console.error('[HTTP API Chat Auth Error] DB 조회 오류:', err);
        res.status(500).send({ error: 'AI 키 인증 처리 중 서버 오류 발생' });
    }
};

// --- 미들웨어: JWT 인증 ---
const verifyJwt = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ error: '인증 헤더(Authorization: Bearer <token>)가 필요합니다.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).send({ error: '헤더에 JWT 토큰이 없습니다.' });
    }

    jwt.verify(token, jwtSecret, (err, decoded) => {
        if (err) {
            console.warn('[HTTP API JWT] 토큰 검증 실패:', err.message);
            return res.status(401).send({ error: '유효하지 않은 토큰입니다.' });
        }
        req.user = decoded;
        next();
    });
};

/**
 * Express 서버를 시작하는 함수
 * @param {import('discord.js').Client} client - 디스코드 봇 클라이언트 (로그 전송용)
 */
function startApiServer(client) {

    // 1. 헬스 체크 경로
    app.get('/', (req, res) => {
        res.send('Discord bot & AI API Server is running! 🚀');
    });

    // 2. 로그인 (JWT 발급)
    app.post('/api/login', async (req, res) => {
        const { secret } = req.body;

        if (!secret) {
            return res.status(400).send({ error: '비밀번호(secret)가 필요합니다.' });
        }

        try {
            const loginConfig = await ApiKey.findOne({ keyName: "Flutter Login" });

            if (!loginConfig || !loginConfig.apiKey) {
                return res.status(500).send({ error: '서버 로그인 설정 오류 (DB)' });
            }

            if (secret === loginConfig.apiKey) {
                const payload = { appName: "Flutter App" };
                const options = { expiresIn: '1h' };
                const token = jwt.sign(payload, jwtSecret, options);
                console.log('[HTTP API Login] Flutter 앱 로그인 성공.');
                res.status(200).send({ accessToken: token });
            } else {
                res.status(401).send({ error: '로그인 정보가 잘못되었습니다.' });
            }
        } catch (err) {
            console.error('[HTTP API Login Error]', err);
            res.status(500).send({ error: '로그인 처리 중 서버 오류 발생' });
        }
    });

    // 3. 설정 조회 (현재 AI 키 반환)
    app.get('/api/config', verifyJwt, async (req, res) => {
        try {
            const currentAiKey = await ApiKey.findOne({
                keyName: "Flutter AI",
                isCurrent: true
            });

            if (!currentAiKey) {
                return res.status(500).send({ error: '현재 사용 가능한 AI API 키 설정을 찾을 수 없습니다.' });
            }

            res.status(200).send({ 'aiApiKey': currentAiKey.apiKey });
        } catch (err) {
            console.error('[HTTP API Config Error]', err);
            res.status(500).send({ error: '설정 조회 중 DB 오류 발생' });
        }
    });

    // 4. AI 채팅 중계
    app.post('/api/chat', authenticateApiKey, verifyJwt, async (req, res) => {
        try {
            const { question, sessionId } = req.body;

            if (!question) {
                return res.status(400).send({ error: '질문(question)은 필수입니다.' });
            }

            const aiResponseText = await callFlowise(
                question,
                sessionId || 'http-default-session',
                'http-api-chat',
                client
            );

            try {
                const aiJson = JSON.parse(aiResponseText);
                res.status(200).send(aiJson);
            } catch (e) {
                res.status(200).send({ text: aiResponseText });
            }

        } catch (error) {
            console.error("[HTTP API Error]", error);
            res.status(500).send({ error: `AI 서버 처리 중 오류 발생: ${error.message}` });
        }
    });

    // --- 5. 대시보드용 통계 API ---
    app.get('/api/dashboard/stats', verifyJwt, async (req, res) => {
        try {

            const [totalInteractions, errorCount, recentLogs] = await Promise.all([
                Interaction.countDocuments({}),
                Interaction.countDocuments({ type: 'ERROR', botResponse: 'Unresolved' }),
                Interaction.find().sort({ timestamp: -1 }).limit(1).select('timestamp')
            ]);

            const uptime = process.uptime();

            res.status(200).send({
                totalInteractions,
                errorCount,
                uptime,
                lastActive: recentLogs[0]?.timestamp || new Date()
            });
        } catch (err) {
            console.error('[API Stats Error]', err);
            res.status(500).send({ error: '통계 조회 실패' });
        }
    });

    // --- 6. 로그 조회 API ---
    app.get('/api/dashboard/logs', verifyJwt, async (req, res) => {
        try {
            const logs = await Interaction.find()
                .sort({ timestamp: -1 })
                .limit(20) // 최근 20개만
                .select('type timestamp userId content botResponse'); // 필요한 필드만 선택

            res.status(200).send(logs);
        } catch (err) {
            console.error('[API Logs Error]', err);
            res.status(500).send({ error: '로그 조회 실패' });
        }
    });

    // --- 7. 화이트리스트 조회 API ---
    app.get('/api/dashboard/whitelist', verifyJwt, async (req, res) => {
        try {
            const whitelist = await WhiteList.find().sort({ timestamp: -1 });
            res.status(200).send(whitelist);
        } catch (err) {
            console.error('[API Whitelist Error]', err);
            res.status(500).send({ error: '화이트리스트 조회 실패' });
        }
    });

    // 서버 리스닝 시작
    app.listen(port, () => {
        console.log(`✅ 웹 서버(API)가 포트 ${port}에서 시작되었습니다.`);
    });
}

module.exports = { startApiServer };