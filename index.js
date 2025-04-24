// discord.js v14 이상 필요
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config();

// v14 Intents 사용 및 MessageContent 추가
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // 메시지 내용을 읽기 위해 필수!
    ]
});

// --- 환경 변수 확인 및 로드 ---
// TOKEN, PREFIX는 기존 코드에서 사용 중
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY; // Flowise API 키 (설정했다면)

if (!process.env.DISCORD_BOT_TOKEN) {
    console.error("Discord 봇 토큰(TOKEN)이 .env 파일에 설정되지 않았습니다.");
    process.exit(1); // 오류 발생 시 종료
}
if (!process.env.PREFIX) {
    console.warn("명령어 접두사(PREFIX)가 .env 파일에 설정되지 않았습니다. 기본값 '!'를 사용합니다.");
}
const prefix = process.env.PREFIX || '!'; // PREFIX 환경 변수가 없으면 '!' 사용

if (!flowiseEndpoint) {
    console.error("Flowise 엔드포인트(FLOWISE_ENDPOINT)가 .env 파일에 설정되지 않았습니다.");
    process.exit(1);
}
// API 키는 선택적일 수 있으므로 경고만 표시
if (!flowiseApiKey) {
    console.warn("Flowise API 키(FLOWISE_API_KEY)가 .env 파일에 설정되지 않았습니다. API 키가 필요 없는 경우 무시하세요.");
}

// --- 유틸리티 함수 ---
const sleep = (ms) => {
    return new Promise((r) => setTimeout(r, ms));
}

// --- Discord 봇 로그인 ---
const discordLogin = async () => {
    try {
        await client.login(process.env.DISCORD_BOT_TOKEN);
    } catch (error) {
        console.error("Discord 로그인 실패:", error.message);
        if (error.code === 'TOKEN_INVALID') {
            console.error("-> 제공된 토큰이 유효하지 않습니다.");
        }
        await sleep(5000);
        process.exit(1); // 로그인 실패 시 종료
    }
}

discordLogin();

// --- 이벤트 핸들러 ---
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}.`);
    console.log(`Command Prefix: ${prefix}`);
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

client.on('messageCreate', async msg => {
    // 봇 메시지 무시
    if (msg.author.bot) return;

    // --- 기존 명령어 처리 ---
    try {
        if (msg.content === prefix + 'call') {
            return msg.channel.send(`!callback`); // 기존 명령어 처리 후 함수 종료
        }

        if (msg.content === prefix + 'avatar') {
            return msg.channel.send(msg.author.displayAvatarURL()); // 기존 명령어 처리 후 함수 종료
        }

        if (msg.content === prefix + 'help') {
            // EmbedBuilder 사용 (v14 방식)
            const embed = new EmbedBuilder()
                .setTitle("도움말")
                .setColor(0x000000) // 16진수 색상 코드
                .setDescription('디스코드봇 테스트입니다. \n명령어: !call, !avatar, !help, !server\n그 외 메시지는 AI와 대화합니다.');
            return msg.reply({ embeds: [embed] }); // 기존 명령어 처리 후 함수 종료
        }

        if (msg.content === prefix + 'server') {
            return msg.channel.send(`현재 서버의 이름은 ${msg.guild.name} 입니다.\n총 멤버 수는 ${msg.guild.memberCount} 명 입니다.`); // 기존 명령어 처리 후 함수 종료
        }

        // --- Flowise AI 호출 로직 ---
        // 메시지가 PREFIX로 시작하지만, 위에서 처리된 특정 명령어가 아닐 경우
        if (msg.content.startsWith(prefix)) {
            const userQuestion = msg.content.substring(prefix.length).trim();

            // 질문 내용이 비어있으면 무시
            if (!userQuestion) return;

            // 세션 ID 설정 (사용자 ID 사용)
            const sessionId = msg.author.id;

            // Flowise API 요청 본문
            const requestBody = {
                question: userQuestion,
                overrideConfig: {
                    sessionId: sessionId
                }
            };

            console.log(`[${sessionId}] Sending to Flowise: ${userQuestion}`); // 요청 로그

            // Flowise API 호출
            const response = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Flowise API 키가 설정되어 있다면 헤더에 추가
                    ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                // 사용자에게 너무 자세한 오류 대신 간단한 메시지 전달
                return msg.reply(`죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
            }

            const flowiseResponse = await response.json();
            console.log(`[${sessionId}] Received from Flowise:`, flowiseResponse); // 응답 로그

            // 응답 텍스트 추출 (Flowise 응답 구조에 따라 .text 또는 다른 필드 확인 필요)
            const replyText = flowiseResponse.text || '죄송합니다, AI로부터 답변을 받지 못했습니다.';

            // Discord에 답변 전송
            return msg.reply(replyText);
        }
        // PREFIX로 시작하지 않는 메시지는 무시 (필요시 이 부분 수정)
        // console.log(`Ignored message from ${msg.author.tag}: ${msg.content}`);

    } catch (e) {
        console.error("Error in messageCreate handler:", e);
        // 오류 발생 시 사용자에게 알림 (선택 사항)
        try {
            await msg.reply('앗, 메시지를 처리하는 중에 예상치 못한 오류가 발생했어요.');
        } catch (replyError) {
            console.error("Failed to send error reply:", replyError);
        }
    }
});
