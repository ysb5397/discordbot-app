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
    // *** 추가된 로그: 인터랙션 수신 확인 ***
    console.log('Interaction received!');

    // 상호작용이 슬래시 명령어가 아니면 무시
    if (!interaction.isChatInputCommand()) {
        console.log('Interaction is not a chat input command.'); // 추가 로그: 슬래시 명령어가 아님
        return;
    }

    const { commandName } = interaction;

    // *** 수정된 로그: 수신된 명령어 이름 포함 ***
    console.log(`Processing interaction: /${commandName}`);

    // --- /chat 명령어 처리 ---
    if (commandName === 'chat') {
        // 응답 지연 (Flowise 응답이 오래 걸릴 수 있으므로)
        // deferReply는 한 번만 호출해야 하므로, 이미 defer되었는지 확인 (선택적 개선)
        if (interaction.deferred || interaction.replied) {
             console.log("Interaction already deferred or replied.");
             return;
        }
        try {
            await interaction.deferReply();
        } catch (deferError) {
            console.error("Failed to defer reply:", deferError);
            return; // defer 실패 시 더 이상 진행 불가
        }


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
                // deferReply 후에는 editReply 사용
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
        // deferReply 없이 바로 응답 가능하면 reply 사용
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
            // 이미 defer되었다면 editReply 사용 (내용은 동일하게)
             await interaction.editReply({ embeds: [embed] }); // ephemeral은 editReply에서 직접 지원 안 함
             // 또는 followUp으로 ephemeral 메시지 전송 고려
             // await interaction.followUp({ embeds: [embed], ephemeral: true });
        }
    }
    else if (commandName === 'avatar') {
         if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true });
         } else {
             await interaction.editReply({ content: interaction.user.displayAvatarURL() });
             // await interaction.followUp({ content: interaction.user.displayAvatarURL(), ephemeral: true });
         }
    }
    else if (commandName === 'server') {
         if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(`현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
         } else {
             await interaction.editReply(`현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
         }
    }
     else if (commandName === 'call') {
         if (!interaction.replied && !interaction.deferred) {
            await interaction.reply('!callback');
         } else {
             await interaction.editReply('!callback');
         }
    }
    // 여기에 다른 슬래시 명령어 처리 로직 추가 가능
});


// --- 기존 메시지 기반 명령어 처리 (선택 사항) ---
// 슬래시 명령어로 모두 전환했다면 이 핸들러는 필요 없을 수 있습니다.
/*
client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    // 여기에 !call, !avatar 등 간단한 기존 명령어 처리 로직만 남겨둘 수 있습니다.
});
*/
```

**주요 변경점:**

* `client.on(Events.InteractionCreate, async interaction => { ... });` 핸들러 시작 부분에 `console.log('Interaction received!');` 로그를 추가했습니다.
* 슬래시 명령어가 아닌 다른 상호작용(버튼 클릭 등)일 경우를 대비해 로그를 추가했습니다 (`console.log('Interaction is not a chat input command.');`).
* 처리 시작 시 어떤 명령어가 수신되었는지 로그를 남기도록 수정했습니다 (`console.log(\`Processing interaction: /${commandName}\`);`).
* 다른 명령어(`/help`, `/avatar` 등) 처리 시에도 `interaction.reply()` 또는 `interaction.editReply()`를 상황에 맞게 사용하도록 예시를 조금 더 보강했습니다. (Flowise 호출이 없는 명령어는 `deferReply`가 필요 없으므로 바로 `reply`를 사용할 수 있습니다.)

이제 이 코드를 Cloudtype에 다시 배포하고 Discord에서 슬래시 명령어를 사용했을 때, Cloudtype 로그에 **"Interaction received!"** 와 **"Processing interaction: /명령어이름"** 로그가 출력되는지 확인해 보세요. 로그가 출력된다면 이벤트 자체는 정상적으로 수신되고 있는 것입
