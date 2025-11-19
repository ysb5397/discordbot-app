require('dotenv').config();

// 필수 환경 변수가 있는지 확인하는 헬퍼 함수
function required(key, defaultValue = undefined) {
    const value = process.env[key] || defaultValue;
    if (value == null) {
        throw new Error(`❌ [설정 오류] 필수 환경 변수가 누락되었습니다: ${key}`);
    }
    return value;
}

const config = {
    // 1. 디스코드 기본 설정
    discord: {
        token: required('DISCORD_BOT_TOKEN'), // 또는 DISCORD_BOT_TOKEN(main용)
        clientId: required('DISCORD_CLIENT_ID'), // 또는 DISCORD_CLIENT_ID(main용)
        guildId: required('DISCORD_GUILD_ID'),
        logChannelId: required('DISCORD_LOG_CHANNEL_ID'),
        ownerId: required('MY_DISCORD_USER_ID'),
        baseMemberRoleId: required('BASE_MEMBER_ROLE_ID'),
        isDevBot: required('IS_DEV_BOT'),
    },

    // 2. 채널 ID 모음 (하드코딩 제거 대상)
    channels: {
        autoJoin: required('AUTO_JOIN_CHANNEL_ID'),
        geminiVoice: required('GEMINI_VOICE_CHANNEL_ID'),
        youtubeVoice: required('YOUTUBE_VOICE_CHANNEL_ID'),
        earthquakeNotice: required('EARTHQUAKE_NOTICE_CHANNEL_ID'),
        ignoreAiChat: required('IGNORE_AI_CHAT_CHANNEL_ID'),
    },

    // 3. AI & 외부 API 설정
    ai: {
        geminiKey: required('GEMINI_API_KEY'),
        persona: process.env.AI_PERSONA || `
            너는 사용자의 친한 친구이자 유능한 AI 비서야.
            말투는 항상 귀엽고 친근한 반말(해요체 대신 해체)을 사용해.
            사용자를 부를 때는 '너' 또는 '네가'라고 지칭해.
            이모지를 적절히 사용해서 감정을 표현해줘.
            모르는 것이 있으면 솔직하게 모른다고 하고 같이 찾아보자고 제안해.
        `.trim(),
        pythonServiceUrl: required('PYTHON_AI_SERVICE_URL'),
        flowise: {
            endpoint: required('FLOWISE_ENDPOINT'),
            apiKey: required('FLOWISE_API_KEY'),
        },
        googleSearch: {
            apiKey: required('GOOGLE_SEARCH_API'),
            engineId: required('GOOGLE_SEARCH_ENGINE_ID'),
        },
        urlScanKey: required('URL_CHECK_API_KEY'),
    },

    // 4. 데이터베이스 & 서버 설정
    db: {
        uri: required('MONGODB_URI'),
    },
    server: {
        port: process.env.PORT || 5500,
        jwtSecret: required('JWT_SECRET'),
        appUrl: process.env.APP_URL,
        commitSha: process.env.COMMIT_SHA,
    },
    
    // 5. 기타 서비스 변수
    etc: {
        earthquakeKey: required('EQK_AUTH_KEY'),
    }
};

module.exports = config;