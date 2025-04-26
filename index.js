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
        const userName = interaction.user.globalName || interaction.user.username;
        console.log(`User Name: ${userName}`);

        // Flowise API 요청 본문 기본 구조
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId,
                vars: {
                    userName: userName
                }
            }
        };

        // 파일 첨부 처리
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
                // *** 오류 발생 시에도 멘션 포함 (선택 사항) ***
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, AI 응답 생성 중 오류가 발생했습니다. (Code: ${response.status})`);
                return;
            }

            const flowiseResponse = await response.json();
            console.log(`[Session: ${sessionId}] Received from Flowise:`, flowiseResponse);

            const replyText = flowiseResponse.text || '죄송합니다, AI로부터 답변을 받지 못했습니다.';

            // *** 사용자 멘션 추가 ***
            const mentionString = `<@${interaction.user.id}>`; // 사용자 멘션 문자열 생성
            const finalReply = `${mentionString} ${replyText}`; // 멘션과 답변 텍스트 결합

            // 지연된 응답 수정하여 최종 답변 전송 (멘션 포함)
            await interaction.editReply(finalReply);

        } catch (error) {
            console.error(`[Session: ${sessionId}] Error processing Flowise request for /chat:`, error);
            try {
                // *** 오류 발생 시에도 멘션 포함 (선택 사항) ***
                await interaction.editReply(`<@${interaction.user.id}> 죄송합니다, 요청 처리 중 오류가 발생했습니다.`);
            } catch (editError) {
                console.error("Failed to send error reply via editReply:", editError);
            }
        }
    }
    // --- 다른 슬래시 명령어 처리 ---
    // 다른 명령어들도 필요하다면 멘션을 추가할 수 있습니다.
    // 예: interaction.editReply(`<@${interaction.user.id}> ${replyContent}`);
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("도움말")
            .setColor(0x000000)
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call');
        if (!interaction.replied && !interaction.deferred) {
            // help는 ephemeral이므로 멘션하지 않음
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
             await interaction.editReply({ embeds: [embed] });
        }
    }
    else if (commandName === 'avatar') {
         if (!interaction.replied && !interaction.deferred) {
            // avatar는 ephemeral이므로 멘션하지 않음
            await interaction.reply({ content: interaction.user.displayAvatarURL(), ephemeral: true });
         } else {
             await interaction.editReply({ content: interaction.user.displayAvatarURL() });
         }
    }
    else if (commandName === 'server') {
         if (!interaction.replied && !interaction.deferred) {
            // server 정보는 멘션 추가 가능
            await interaction.reply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
         } else {
             await interaction.editReply(`<@${interaction.user.id}> 현재 서버 이름: ${interaction.guild.name}\n총 멤버 수: ${interaction.guild.memberCount}`);
         }
    }
     else if (commandName === 'call') {
         if (!interaction.replied && !interaction.deferred) {
            // call 응답에도 멘션 추가 가능
            await interaction.reply(`<@${interaction.user.id}> !callback`);
         } else {
             await interaction.editReply(`<@${interaction.user.id}> !callback`);
         }
    }
});
// ```

// **주요 변경점:**

// * `/chat` 명령어 처리 로직에서 Flowise로부터 응답(`replyText`)을 받은 후, `const mentionString = \`<@${interaction.user.id}>\`;` 코드로 사용자 멘션 문자열을 만듭니다.
// * `const finalReply = \`${mentionString} ${replyText}\`;` 코드로 멘션과 응답 텍스트를 합칩니다.
// * `await interaction.editReply(finalReply);` 코드로 멘션이 포함된 최종 답변을 전송합니다.
// * 오류 발생 시 응답에도 멘션을 포함하도록 수정했습니다 (선택 사항).
// * 다른 명령어(`/server`, `/call`)에도 예시로 멘션을 추가했습니다. `/help`, `/avatar`는 보통 사용자에게만 보이는 `ephemeral` 응답이라 멘션을 넣지 않았습니다. 필요에 따라 다른 명령어에도 멘션을 추가하거나 제거할 수 있습니다.

// 이제 이 코드를 배포하시면 `/chat` 명령어를 사용했을 때 봇이 사용자를 멘션하며 답변할 것입
