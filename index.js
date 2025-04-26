// discord.js v14 이상 필요
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, InteractionType, Events, AttachmentBuilder } = require('discord.js');
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
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
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
        const attachment = interaction.options.getAttachment('file');

        // *** 사용자 이름 가져오기 ***
        // globalName (표시 이름) 우선 사용, 없으면 username 사용
        const userName = interaction.user.globalName || interaction.user.username;
        console.log(`User Name: ${userName}`); // 사용자 이름 로그 추가

        // Flowise API 요청 본문 기본 구조
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId,
                // *** vars 객체에 사용자 이름 추가 ***
                vars: {
                    userName: userName // Flowise에서 참조할 변수 이름 (예: userName)
                }
            }
            // uploads 필드는 파일이 있을 때만 추가
        };

        // 파일이 첨부되었을 경우 uploads 필드 추가
        if (attachment) {
            console.log(`Attachment found: ${attachment.name} (${attachment.contentType}, ${attachment.url})`);
            requestBody.uploads = [
                {
                    type: 'url',
                    name: attachment.name,
                    mime: attachment.contentType || 'application/octet-stream',
                    data: attachment.url
                }
            ];
        }

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
                await interaction.editReply(`죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            const flowiseResponse = await response.json();
            console.log(`[Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

            const replyText = flowiseResponse.text || '죄송합니다, AI로부터 답변을 받지 못했습니다.';
            await interaction.editReply(replyText);

        } catch (error) {
            console.error(`[Session: ${sessionId}] Error processing Flowise request for /chat:`, error);
            try {
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
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
             await interaction.editReply({ embeds: [embed] });
        }
    }
    else if (commandName === 'avatar') {
         if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true });
         } else {
             await interaction.editReply({ content: interaction.user.displayAvatarURL() });
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
});
// ```

// **주요 변경점:**

// 1.  **사용자 이름 가져오기:** `interaction.user.globalName || interaction.user.username` 코드를 추가하여 명령어를 사용한 유저의 이름을 `userName` 변수에 저장합니다.
// 2.  **`overrideConfig.vars` 추가:** Flowise API 요청 본문(`requestBody`)의 `overrideConfig` 안에 `vars` 객체를 추가하고, 그 안에 `{ userName: userName }` 형태로 사용자 이름을 포함시켰습니다.

// **이제 어떻게 될까요?**

// * 이 수정된 코드를 배포하면, Discord 봇은 `/chat` 명령어가 사용될 때마다 해당 사용자의 이름을 알아내어 Flowise API 요청에 `userName`이라는 변수 이름으로 함께 보냅니다.
// * **하지만 Flowise 챗봇이 이 정보를 실제로 사용하게 하려면 (예: "안녕하세요, [사용자 이름]님!")**, **Flowise 캔버스에서 `Tool Agent`의 시스템 메시지나 프롬프트를 수정**하여 `overrideConfig.vars`로 전달된 `userName` 변수를 인식하고 활용하도록 만들어야 합니다. 단순히 Discord 봇 코드만 수정한다고 해서 Flowise 챗봇이 자동으로 이름을 부르지는 않습니다.

// 우선 이 코드를 적용하여 사용자 이름이 Flowise로 잘 전달되는지 확인해 보
