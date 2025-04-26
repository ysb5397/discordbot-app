// discord.js v14 이상 필요
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, InteractionType, Events } = require('discord.js');
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages, // 기존 명령어 처리를 위해 남겨둘 수 있음
        GatewayIntentBits.MessageContent // 기존 명령어 처리를 위해 남겨둘 수 있음
    ]
});

// --- 환경 변수 확인 및 로드 ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID; // 슬래시 명령어 등록에 필요!
const guildId = process.env.DISCORD_GUILD_ID;   // 슬래시 명령어 등록에 필요! (특정 서버 전용)
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY; // Flowise API 키 (선택 사항)

// 필수 환경 변수 확인
if (!discordToken || !clientId || !guildId || !flowiseEndpoint) {
    console.error("필수 환경 변수(DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, FLOWISE_ENDPOINT) 중 하나 이상이 설정되지 않았습니다.");
    process.exit(1);
}
if (!flowiseApiKey) {
    console.warn("환경 변수 'FLOWISE_API_KEY'가 설정되지 않았습니다. API 키가 필요 없는 Flowise 설정인 경우 무시하세요.");
}

// --- 슬래시 명령어 정의 ---
const commands = [
    new SlashCommandBuilder()
        .setName('chat') // 명령어 이름: /chat
        .setDescription('AI와 대화합니다.')
        .addStringOption(option =>
            option.setName('question') // 옵션 이름: question
                .setDescription('AI에게 할 질문 내용')
                .setRequired(true)), // 필수 입력
    // 다른 슬래시 명령어 (예: /help, /avatar 등)도 여기에 추가 가능
    new SlashCommandBuilder().setName('help').setDescription('봇 도움말을 표시합니다.'),
    new SlashCommandBuilder().setName('avatar').setDescription('당신의 아바타 URL을 보여줍니다.'),
    new SlashCommandBuilder().setName('server').setDescription('서버 정보를 보여줍니다.'),
    new SlashCommandBuilder().setName('call').setDescription('콜백 메시지를 보냅니다.'),

].map(command => command.toJSON());

// --- 명령어 등록 로직 ---
const rest = new REST({ version: '10' }).setToken(discordToken);

(async () => {
    try {
        console.log('(/) 슬래시 명령어 등록 시작...');

        // 특정 서버(Guild)에 명령어 등록 (개발/테스트 시 유용)
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        // 전역(Global) 명령어 등록 (모든 서버에 적용, 반영에 시간 소요)
        // await rest.put(
        //  Routes.applicationCommands(clientId),
        //  { body: commands },
        // );

        console.log('(/) 슬래시 명령어가 성공적으로 등록되었습니다.');
    } catch (error) {
        console.error('(/) 슬래시 명령어 등록 중 오류 발생:', error);
    }
})();


// --- 유틸리티 함수 ---
const sleep = (ms) => {
    return new Promise((r) => setTimeout(r, ms));
}

// --- Discord 봇 로그인 ---
const discordLogin = async () => {
    try {
        await client.login(discordToken);
    } catch (error) {
        console.error("Discord 로그인 실패:", error.message);
        if (error.code === 'TOKEN_INVALID') {
            console.error("-> 제공된 토큰이 유효하지 않습니다.");
        }
        await sleep(5000);
        process.exit(1);
    }
}

discordLogin();

// --- 이벤트 핸들러 ---
client.on(Events.ClientReady, () => { // 'ready' 대신 Events.ClientReady 사용 (v14)
    console.log(`Logged in as ${client.user.tag}.`);
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 슬래시 명령어 처리 핸들러 ---
client.on(Events.InteractionCreate, async interaction => {
    // 상호작용이 슬래시 명령어가 아니면 무시
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    console.log(`Received interaction: /${commandName}`); // 인터랙션 로그

    // --- /chat 명령어 처리 ---
    if (commandName === 'chat') {
        // 응답 지연 (Flowise 응답이 오래 걸릴 수 있으므로)
        await interaction.deferReply();

        // 사용자가 입력한 질문 가져오기
        const userQuestion = interaction.options.getString('question');
        // 세션 ID 설정 (사용자 ID 사용)
        const sessionId = interaction.user.id;

        // Flowise API 요청 본문
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId // 세션 ID 포함!
            }
        };

        console.log(`[Session: ${sessionId}] Sending to Flowise: "${userQuestion}"`); // 요청 로그

        try {
            // Flowise API 호출
            const response = await fetch(flowiseEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {})
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[Session: ${sessionId}] Flowise API Error: ${response.status} ${response.statusText}`, errorData);
                await interaction.editReply(`죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            const flowiseResponse = await response.json();
            console.log(`[Session: ${sessionId}] Received from Flowise:`, flowiseResponse); // 응답 로그

            const replyText = flowiseResponse.text || '죄송합니다, AI로부터 답변을 받지 못했습니다.';

            // 지연된 응답 수정하여 최종 답변 전송
            await interaction.editReply(replyText);

        } catch (error) {
            console.error(`[Session: ${sessionId}] Error processing Flowise request for /chat:`, error);
            try {
                // 이미 응답이 지연된 상태이므로 editReply 사용
                await interaction.editReply('죄송합니다, 요청 처리 중 오류가 발생했습니다.');
            } catch (editError) {
                console.error("Failed to send error reply via editReply:", editError);
            }
        }
    }
    // --- 다른 슬래시 명령어 처리 ---
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("도움말")
            .setColor(0x000000)
            .setDescription('명령어: /chat [질문], /help, /avatar, /server, /call');
        await interaction.reply({ embeds: [embed], ephemeral: true }); // ephemeral: true -> 명령어 사용자에게만 보임
    }
    else if (commandName === 'avatar') {
        await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true });
    }
    else if (commandName === 'server') {
        await interaction.reply(`현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
    }
     else if (commandName === 'call') {
        await interaction.reply('!callback'); // 콜백 메시지 전송
    }
    // 여기에 다른 슬래시 명령어 처리 로직 추가 가능
});


// --- 기존 메시지 기반 명령어 처리 (선택 사항) ---
// 슬래시 명령어로 모두 전환했다면 이 핸들러는 필요 없을 수 있습니다.
// 만약 기존 !명령어도 유지하고 싶다면, 아래 코드를 남겨두되,
// Flowise 호출 로직은 위 interactionCreate 핸들러에서 처리하므로 제거해야 합니다.
/*
client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    // 여기에 !call, !avatar 등 간단한 기존 명령어 처리 로직만 남겨둘 수 있습니다.
    // Flowise 호출 로직은 제거합니다.
});
*/
```

**실행 전 확인 및 준비사항:**

1.  **환경 변수 추가:** `.env` 파일 또는 Cloudtype 환경 변수 설정에 **`DISCORD_CLIENT_ID`**와 **`DISCORD_GUILD_ID`**를 **반드시 추가**해야 합니다. 이 값들은 Discord Developer Portal에서 봇 애플리케이션 정보와 봇을 추가한 서버 ID를 확인하여 얻을 수 있습니다.
2.  **라이브러리 설치:** `discord.js` v14 이상, `node-fetch@2`, `dotenv`가 설치되어 있는지 확인합니다.
3.  **Intents:** `GatewayIntentBits.Guilds`는 슬래시 명령어를 특정 서버에 등록할 때 필요할 수 있습니다. (MessageContent는 슬래시 명령어만 사용한다면 필수는 아닙니다.)
4.  **봇 권한:** 봇이 서버에서 **`application.commands` 권한**을 가지고 있어야 슬래시 명령어를 사용하고 응답할 수 있습니다. 봇 초대 시 이 권한을 부여했는지 확인하거나, 서버 설정 > 통합(Integrations) 에서 봇 권한을 수정해야 할 수 있습니다.
5.  **코드 통합:** 기존 `index.js`를 이 코드로 대체하거나, 필요한 부분을 병합하세요. 특히 `ready` 이벤트 핸들러와 `interactionCreate` 핸들러 추가, `messageCreate` 핸들러 수정이 중요합니다.
6.  **배포:** 수정한 코드를 저장하고 Cloudtype에 다시 배포합니다.

이제 Discord에서 `/chat 질문내용` 형식으로 명령어를 사용하면 AI와 대화하고 메모리도 유지될 것입니다. 다른 명령어들도 `/help`, `/avatar` 등으로 사용할 수 있습
