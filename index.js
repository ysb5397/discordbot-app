// discord.js v14 이상 필요
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용 및 MessageContent 추가
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // 메시지 내용을 읽기 위해 필수! Discord Developer Portal에서도 활성화 필요
    ]
});

// --- 환경 변수 확인 및 로드 ---
// Cloudtype 또는 .env 파일에 설정된 환경 변수 이름을 사용합니다.
// 아래 변수 이름(예: DISCORD_BOT_TOKEN)이 실제 설정된 이름과 일치하는지 확인하세요.
const discordToken = process.env.DISCORD_BOT_TOKEN; // Discord 봇 토큰
const prefix = process.env.PREFIX || '!';           // 명령어 접두사 (없으면 '!' 기본값)
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT; // Flowise API 엔드포인트
const flowiseApiKey = process.env.FLOWISE_API_KEY;   // Flowise API 키 (선택 사항)

// 필수 환경 변수 확인
if (!discordToken) {
    console.error("환경 변수 'DISCORD_BOT_TOKEN'이 설정되지 않았습니다.");
    process.exit(1);
}
if (!flowiseEndpoint) {
    console.error("환경 변수 'FLOWISE_ENDPOINT'가 설정되지 않았습니다.");
    process.exit(1);
}
if (!process.env.PREFIX) { // .env 파일에 PREFIX가 설정되었는지 확인 (없어도 기본값 사용)
    console.warn("환경 변수 'PREFIX'가 설정되지 않았습니다. 기본값 '!'를 사용합니다.");
}
if (!flowiseApiKey) { // API 키는 선택 사항
    console.warn("환경 변수 'FLOWISE_API_KEY'가 설정되지 않았습니다. API 키가 필요 없는 Flowise 설정인 경우 무시하세요.");
}


// --- 유틸리티 함수 ---
const sleep = (ms) => {
    return new Promise((r) => setTimeout(r, ms));
}

// --- Discord 봇 로그인 ---
const discordLogin = async () => {
    try {
        await client.login(discordToken); // 환경 변수에서 읽어온 토큰 사용
    } catch (error) {
        console.error("Discord 로그인 실패:", error.message);
        if (error.code === 'TOKEN_INVALID') {
            console.error("-> 제공된 토큰이 유효하지 않습니다. 환경 변수 'DISCORD_BOT_TOKEN' 값을 확인하세요.");
        }
        await sleep(5000);
        process.exit(1);
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
    // (기존 코드는 여기에 그대로 두거나 필요에 맞게 수정)
    try {
        if (msg.content === prefix + 'call') {
            return msg.channel.send(`!callback`);
        }
        if (msg.content === prefix + 'avatar') {
            return msg.channel.send(msg.author.displayAvatarURL());
        }
        if (msg.content === prefix + 'help') {
            const embed = new EmbedBuilder()
                .setTitle("도움말")
                .setColor(0x000000)
                .setDescription(`명령어 접두사: ${prefix}\n사용 가능 명령어: call, avatar, help, server\n그 외 ${prefix}로 시작하는 메시지는 AI와 대화합니다.`);
            return msg.reply({ embeds: [embed] });
        }
        if (msg.content === prefix + 'server') {
            return msg.channel.send(`현재 서버 이름: ${msg.guild.name}\n총 멤버 수: ${msg.guild.memberCount}`);
        }

        // --- Flowise AI 호출 로직 ---
        // 메시지가 설정된 PREFIX로 시작하고, 위에서 처리되지 않은 경우 AI에게 전달
        if (msg.content.startsWith(prefix)) {
            const userQuestion = msg.content.substring(prefix.length).trim();

            // 질문 내용이 없으면 무시
            if (!userQuestion) return;

            // *** 핵심: 세션 ID 설정 (사용자별 대화 기록 유지를 위해 사용자 ID 사용) ***
            const sessionId = msg.author.id;

            // Flowise API 요청 본문 구성
            const requestBody = {
                question: userQuestion,
                overrideConfig: {
                    sessionId: sessionId // sessionId 전달
                }
            };

            console.log(`[Session: ${sessionId}] Sending to Flowise: "${userQuestion}"`); // 요청 로그

            // Flowise API 호출
            const response = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Flowise API 키가 환경 변수에 설정되어 있다면 Authorization 헤더 추가
                    ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
                },
                body: JSON.stringify(requestBody)
            });

            // API 응답 상태 확인
            if (!response.ok) {
                const errorData = await response.text(); // 오류 내용을 텍스트로 받음
                console.error(`[Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                return msg.reply(`죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
            }

            // 성공 응답 처리
            const flowiseResponse = await response.json();
            console.log(`[Session: ${sessionId}] Received from Flowise:`, flowiseResponse); // 응답 로그

            // 응답 텍스트 추출 (Flowise 응답 구조에 따라 .text 확인)
            const replyText = flowiseResponse.text || '죄송합니다, AI로부터 답변을 받지 못했습니다.';

            // Discord에 답변 전송
            return msg.reply(replyText);
        }
        // PREFIX로 시작하지 않는 메시지는 현재 무시됨

    } catch (e) {
        console.error("Error in messageCreate handler:", e);
        try {
            // 사용자에게 오류 알림
            await msg.reply('앗, 메시지를 처리하는 중에 예상치 못한 오류가 발생했어요.');
        } catch (replyError) {
            console.error("Failed to send error reply:", replyError);
        }
    }
});
```

**최종 확인 및 배포 전 체크리스트:**

1.  **환경 변수:** Cloudtype 설정에서 `DISCORD_BOT_TOKEN`, `PREFIX`, `FLOWISE_ENDPOINT`, `FLOWISE_API_KEY`(필요시) 환경 변수가 **코드에서 사용하는 이름과 정확히 일치**하고 **올바른 값**으로 설정되었는지 다시 한번 확인하세요.
2.  **Dependencies:** `package.json`에 `"discord.js": "^14.0.0"` (또는 최신 v14)와 `"node-fetch": "^2.6.7"`이 포함되어 있는지 확인하세요.
3.  **Node.js 버전:** Cloudtype 애플리케이션 설정에서 Node.js 버전이 **18 이상**으로 설정되어 있는지 확인하세요.
4.  **Discord Intents:** Discord Developer Portal에서 봇의 **Message Content Intent**가 활성화되어 있는지 확인하세요.
5.  **배포:** 수정한 코드를 Cloudtype에 저장하고 **재배포(Redeploy)** 하세요.

이제 이 코드를 사용하면 Discord에서도 대화 기록이 유지되고, Flowise에 설정된 시간 인지 기능도 정상적으로 작동할 것입
