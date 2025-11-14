const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, } = require('discord.js');
const dotenv = require('dotenv');
const fetch = require('node-fetch');

dotenv.config();
const jwt = require('jsonwebtoken');
const { connectDB, ApiKey } = require('./utils/database');
const { callFlowise } = require('./utils/ai_helper');
const { logToDiscord } = require('./utils/catch_log');
const { registerGlobalCommands } = require('./deploy-commands.js');

const jwtSecret = process.env.JWT_SECRET;
const PING_URL = process.env.APP_URL;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

client.voiceManagers = new Map();

process.on('uncaughtException', (error, origin) => {
    console.error('!!! 치명적인 예외 발생 (Uncaught Exception) !!!', error);
    if (client.isReady()) {
        logToDiscord(client, 'ERROR', '처리되지 않은 치명적인 예외가 발생했습니다!', null, error, origin);
    } else {
        console.error('봇이 준비되지 않아 디스코드 로그를 남길 수 없습니다.');
    }
    // process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('!!! 처리되지 않은 Promise 거부 (Unhandled Rejection) !!!', reason);
    const error = (reason instanceof Error) ? reason : new Error(String(reason));
    if (client.isReady()) {
        logToDiscord(client, 'ERROR', '처리되지 않은 Promise 거부가 발생했습니다!', null, error, 'unhandledRejection');
    } else {
        console.error('봇이 준비되지 않아 디스코드 로그를 남길 수 없습니다.');
    }
});

// --- 명령어 핸들러 로딩 ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[경고] ${filePath} 명령어에 필요한 "data" 또는 "execute" 속성이 없습니다.`);
    }
}

// --- 이벤트 핸들러 로딩 (재귀적) ---
const eventsPath = path.join(__dirname, 'events');

const loadEvents = (dir) => {
    const eventFiles = fs.readdirSync(dir).filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(dir, file);
        const event = require(filePath);
        if (event.name) {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            console.log(`[이벤트 로드] ${file} 이벤트가 로드되었습니다.`);
        } else {
            console.log(`[경고] ${filePath} 이벤트에 필요한 "name" 속성이 없습니다.`);
        }
    }
};

// 최상위 events 폴더 로드
loadEvents(eventsPath);

// events 하위 폴더 로드
const eventFolders = fs.readdirSync(eventsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

for (const folder of eventFolders) {
    loadEvents(path.join(eventsPath, folder));
}

// Cloud Run의 헬스 체크(PORT=5000)를 통과하기 위한 더미 웹서버
const app = express();
app.use(express.json());
const port = process.env.PORT || 5500;

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

        // DB에서 "Flutter AI" 키이고 활성화된 키인지 검증!
        const validKey = await ApiKey.findOne({
            keyName: "Flutter AI", // 이름으로 필터링!
            apiKey: token,
            isActive: true
        });

        if (!validKey) {
            return res.status(401).send({ error: '유효하지 않은 AI API 키입니다.' });
        }
        console.log(`[HTTP API Chat Auth] DB AI 키 인증 성공 (키: ${token.substring(0, 5)}...)`);
        next();
    } catch (err) {
        console.error('[HTTP API Chat Auth Error] AI 키 인증 미들웨어 DB 조회 중 오류 발생:', err);
        res.status(500).send({ error: 'AI 키 인증 처리 중 서버 오류 발생' });
    }
};

app.get('/', (req, res) => {
  res.send('Discord bot is running! (And AI API Server is ready!)');
});

app.post('/api/login', async (req, res) => { // async 추가!
    const { secret } = req.body;

    if (!jwtSecret) {
         console.error('[HTTP API Login Error] JWT_SECRET가 .env에 없습니다.');
         return res.status(500).send({ error: '서버 로그인 설정 오류 (JWT)' });
    }
    if (!secret) {
        return res.status(400).send({ error: '로그인 비밀번호(secret)가 필요합니다.' });
    }

    try {
        // DB에서 "Flutter Login" 이름으로 저장된 비밀번호 조회
        const loginConfig = await ApiKey.findOne({ keyName: "Flutter Login" });

        if (!loginConfig || !loginConfig.apiKey) {
             console.error('[HTTP API Login Error] DB에서 Flutter Login 비밀번호를 찾을 수 없습니다.');
             return res.status(500).send({ error: '서버 로그인 설정 오류 (DB)' });
        }

        // 입력된 비밀번호와 DB의 비밀번호 비교
        if (secret === loginConfig.apiKey) {
            // 비밀번호 일치! JWT 발급
            const payload = { appName: "Flutter App" };
            const options = { expiresIn: '1h' }; // 1시간 유효
            const token = jwt.sign(payload, jwtSecret, options);
            console.log('[HTTP API Login] Flutter 앱 로그인 성공, JWT 발급됨.');
            res.status(200).send({ accessToken: token });
        } else {
            console.warn('[HTTP API Login] Flutter 앱 로그인 실패 (잘못된 Secret).');
            res.status(401).send({ error: '로그인 정보가 잘못되었습니다.' });
        }
    } catch (err) {
        console.error('[HTTP API Login Error] 로그인 처리 중 DB 오류 발생:', err);
        res.status(500).send({ error: '로그인 처리 중 서버 오류 발생' });
    }
});

const verifyJwt = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ error: '인증 헤더(Authorization: Bearer <token>)가 필요합니다.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).send({ error: '헤더에 JWT 토큰이 없습니다.' });
    }
    if (!jwtSecret) {
         console.error('[HTTP API JWT Error] JWT_SECRET가 .env에 없습니다.');
         return res.status(500).send({ error: '서버 JWT 설정 오류' });
    }

    jwt.verify(token, jwtSecret, (err, decoded) => {
        if (err) {
            console.warn('[HTTP API JWT] 토큰 검증 실패:', err.message);
            // 에러 종류에 따라 다른 상태 코드 반환 가능 (예: 만료 시 403)
            return res.status(401).send({ error: '유효하지 않은 토큰입니다.' });
        }
        
        // 토큰이 유효함! 요청 객체에 디코딩된 정보(payload)를 추가해 줄 수도 있음
        req.user = decoded; // 예: req.user.appName 확인 가능
        console.log('[HTTP API JWT] 토큰 검증 성공.');
        next(); // 다음 단계로 통과!
    });
};

app.get('/api/config', verifyJwt, async (req, res) => { // JWT 문지기 적용!
    try {
        // DB에서 "Flutter AI" 키이고 현재 사용(isCurrent) 키를 찾음!
        const currentAiKey = await ApiKey.findOne({
             keyName: "Flutter AI", // 이름으로 필터링!
             isCurrent: true
        });

        if (!currentAiKey) {
            return res.status(500).send({ error: '현재 사용 가능한 AI API 키 설정을 찾을 수 없습니다.' });
        }

        res.status(200).send({
            'aiApiKey': currentAiKey.apiKey // 필드 이름 변경 aiApiKey
        });
    } catch (err) {
        console.error('[HTTP API Config Error] AI 키 조회 중 DB 오류 발생:', err);
        res.status(500).send({ error: 'AI 키 설정 조회 중 DB 오류 발생' });
    }
});

app.post('/api/chat', authenticateApiKey, verifyJwt, async (req, res) => {
    try {
        // 1. 클라이언트가 보낸 질문을 받음 (JSON body)
        const { question, sessionId } = req.body;

        if (!question) {
            return res.status(400).send({ error: '질문(question)은 필수입니다.' });
        }

        // 2. 네가 만든 AI 헬퍼(서비스)를 호출
        const aiResponseText = await callFlowise(
            question, 
            sessionId || 'http-default-session', // 세션 ID가 없으면 기본값
            'http-api-chat',
            client
        );

        // 3. AI의 답변을 클라이언트에게 JSON으로 응답
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

const startBot = async () => {
    try {
        // 1. DB 연결
        await connectDB();
        console.log('DB 연결 성공. 봇 로그인을 시도합니다...');

        // 2. 봇 로그인
        await client.login(process.env.DISCORD_DEV_BOT_TOKEN);
        console.log(`✅ ${client.user.tag}으로 성공적으로 로그인했습니다!`);

        await registerGlobalCommands(process.env.COMMIT_SHA);
        console.log('✅ 봇이 성공적으로 시작되었습니다!');

    } catch (error) {
        console.error("!!! 봇 시작 중 치명적인 오류 발생 !!!", error);
        throw error;
    }
};

app.listen(port, () => {
  console.log(`Dummy server (and AI API) listening on port ${port}`);

  startBot().catch(err => {
      console.error("!!! startBot() 실행 중 치명적인 오류 발생 (서버는 시작됨) !!!", err);
  });
});
