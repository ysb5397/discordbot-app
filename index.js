// discord.js v14 이상 필요
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, InteractionType, Events } = require('discord.js'); // AttachmentBuilder 제거
// node-fetch v2 설치 필요 (npm install node-fetch@2)
const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config(); // .env 파일 로드

// v14 Intents 사용
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- 환경 변수 확인 및 로드 ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

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
        .setName('chat')
        .setDescription('AI와 대화합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 내용')
                .setRequired(true)), // 텍스트 질문만 받음
    // *** 파일 첨부 옵션 제거됨 ***
    // --- 다른 명령어들 ---
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
        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );
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
client.on(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}.`);
    console.log(`Flowise Endpoint: ${flowiseEndpoint}`);
});

// --- 슬래시 명령어 처리 핸들러 ---
client.on(Events.InteractionCreate, async interaction => {
    console.log('Interaction received!');
    if (!interaction.isChatInputCommand()) {
        console.log('Interaction is not a chat input command.');
        return;
    }

    const { commandName } = interaction;
    console.log(`Processing interaction: /${commandName}`);

    // --- /chat 명령어 처리 ---
    if (commandName === 'chat') {
        if (interaction.deferred || interaction.replied) {
             console.log("Interaction already deferred or replied.");
             return;
        }
        try {
            await interaction.deferReply();
        } catch (deferError) {
            console.error("Failed to defer reply:", deferError);
            return;
        }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const userName = interaction.user.globalName || interaction.user.username;
        console.log(`User Name: ${userName}`);

        // *** 파일 첨부 관련 로직 제거됨 ***

        // Flowise API 요청 본문 (uploads 필드 없음)
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId,
                vars: {
                    userName: userName
                }
            }
        };

        console.log(`[Session: ${sessionId}] Sending to Flowise:`, JSON.stringify(requestBody, null, 2));

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
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            const flowiseResponse = await response.json();
            console.log(`[Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

            const replyText = flowiseResponse.text || '죄송합니다, AI로부터 답변을 받지 못했습니다.';
            const mentionString = `<@${interaction.user.id}>`;
            const finalReply = `${mentionString} ${replyText}`;
            await interaction.editReply(finalReply);

        } catch (error) {
            console.error(`[Session: ${sessionId}] Error processing Flowise request for /chat:`, error);
            try {
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`);
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
            // *** 파일 첨부 안내 제거됨 ***
            .setDescription('명령어: /chat [질문], /help, /avatar, /server, /call');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
             await interaction.editReply({ embeds: [embed] });
        }
    }
    // ... (avatar, server, call 명령어 처리 코드는 동일) ...
    else if (commandName === 'avatar') {
         if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true });
         } else {
             await interaction.editReply({ content: interaction.user.displayAvatarURL() });
         }
    }
    else if (commandName === 'server') {
         if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
         } else {
             await interaction.editReply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
         }
    }
     else if (commandName === 'call') {
         if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(`<@${interaction.user.id}> !callback`);
         } else {
             await interaction.editReply(`<@${interaction.user.id}> !callback`);
         }
    }
});
// ```

// **설명:**

// * `/chat` 명령어 정의에서 `.addAttachmentOption()` 부분이 삭제되었습니다.
// * `interactionCreate` 핸들러 내에서 `interaction.options.getAttachment('file')` 호출 및 관련 `if (attachment)` 블록이 삭제되었습니다. Flowise 요청 본문(`requestBody`)에 `uploads` 필드를 추가하는 로직이 없어졌습니다.
// * `/help` 명령어 설명에서 `[file:첨부파일]` 부분이 삭제되었습니다.

// 이제 이 코드를 배포하시면 `/chat` 명령어는 텍스트 질문만 받게 됩니다. "명령어 전송 중..." 메시지가 계속 뜨는 현상이 파일 처리 로직 때문이었다면 이 수정으로 해결될 수 있습니다.

// **검색 기능 강화에 대하여:**

// Discord 봇 코드에서 파일 처리 부분을 제거했지만, 이것이 Flowise의 **검색 기능 자체를 강화하는 것은 아닙니다.** 검색 기능(PDF 검색 또는 웹 검색)의 성능을 개선하려면 여전히 **Flowise 캔버스**에서 관련 설정을 조정해야 합니다. 예를 들면:

// * **`Retriever Tool` 설명 개선:** 에이전트가 PDF 검색을 더 잘 이해하도록 설명을 더 명확하고 구체적으로 작성합니다.
// * **`Pinecone` 노드 설정:** `topK` (가져올 결과 수) 값을 조정하거나, MMR(Max Marginal Relevance) 검색 옵션을 사용해 볼 수 있습니다.
// * **`Google Custom Search API` 노드 설정:** 검색 결과 수를 조정하거나, 특정 사이트만 검색하도록 설정할 수 있습니다.
// * **`Tool Agent` 시스템 메시지:** 어떤 상황에 어떤 검색 도구를 우선적으로 사용해야 할지 더 명확하게 지시합니다.

// 우선 이 수정된 코드를 배포하여 로딩 지연 문제가 해결되는지 확인해 보시고, 그 다음에 Flowise 쪽에서 검색 기능 강화를 위한 설정을 조정하는 단계를 진행하시면 좋겠습
