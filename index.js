// discord.js v14 이상 필요
// EmbedBuilder를 이미 require 하고 있는지 확인
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
        // ... (오류 처리) ...
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
            await interaction.deferReply(); // 응답 지연
        } catch (deferError) {
            console.error("Failed to defer reply:", deferError);
            return;
        }

        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;
        const attachment = interaction.options.getAttachment('file');

        // Flowise API 요청 본문
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId
            }
        };
        if (attachment) {
            requestBody.uploads = [{
                type: 'url',
                name: attachment.name,
                mime: attachment.contentType || 'application/octet-stream',
                data: attachment.url
            }];
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

            // --- *** Embed로 응답 보내도록 수정 *** ---
            let replyEmbeds = []; // Embed 배열

            // 이미지 URL 처리 (이전 코드와 동일)
            const imageUrl = flowiseResponse.imageUrl || (typeof flowiseResponse.text === 'string' && (flowiseResponse.text.startsWith('http://') || flowiseResponse.text.startsWith('https://')) && /\.(jpg|jpeg|png|gif)$/i.test(flowiseResponse.text) ? flowiseResponse.text : null);

            if (imageUrl) {
                console.log(`[Session: ${sessionId}] Detected image URL: ${imageUrl}`);
                const imageEmbed = new EmbedBuilder()
                    .setTitle('AI가 생성한 이미지')
                    .setImage(imageUrl)
                    .setColor(0x0099FF);
                replyEmbeds.push(imageEmbed);
            }

            // 텍스트 응답 처리 (이미지가 아닐 경우 또는 추가 텍스트)
            const replyText = flowiseResponse.text;
            if (replyText && !imageUrl) { // 텍스트가 있고, 이미지 URL이 아닐 경우에만 텍스트 Embed 생성
                const textEmbed = new EmbedBuilder()
                    // .setTitle('AI 응답') // 제목은 선택 사항
                    .setDescription(replyText.length > 4096 ? replyText.substring(0, 4093) + '...' : replyText) // Embed Description 최대 길이 제한 고려
                    .setColor(0x00FA9A) // 하늘색에 가까운 연두색 (원하는 색상 코드로 변경 가능)
                    .setTimestamp() // 메시지 시간 표시 (선택 사항)
                    .setFooter({ text: '해당 결과는 AI에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' }); // 꼬리말 (선택 사항)
                replyEmbeds.push(textEmbed);
            } else if (!imageUrl && !replyText) {
                 // 응답이 아예 없는 경우
                 const errorEmbed = new EmbedBuilder()
                    .setDescription('죄송합니다, AI로부터 답변을 받지 못했습니다.')
                    .setColor(0xFF0000); // 빨간색
                 replyEmbeds.push(errorEmbed);
            }

            // 최종 응답 전송 (content는 비우고 embeds만 사용)
            await interaction.editReply({ content: ' ', embeds: replyEmbeds }); // content를 빈 문자열로 보내야 Embed만 보임

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
    // (help, avatar, server, call 등은 이전과 동일하게 Embed 또는 일반 텍스트 사용 가능)
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("도움말")
            .setColor(0xFFD700)
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
             await interaction.editReply({ embeds: [embed] });
        }
    }
    // ... (avatar, server, call 명령어 처리 코드는 이전과 동일) ...
    else if (commandName === 'avatar') { /*...*/ }
    else if (commandName === 'server') { /*...*/ }
    else if (commandName === 'call') { /*...*/ }
});

// ... (나머지 코드) ...
// ```

// **주요 변경점:**

// 1.  **`/chat` 응답 처리:**
//     * Flowise로부터 응답(`flowiseResponse`)을 받은 후, 이미지 URL이 있는지 먼저 확인합니다.
//     * 이미지 URL이 있다면 이미지 Embed를 생성합니다.
//     * 이미지 URL이 없고 텍스트 응답(`replyText`)이 있다면, **`EmbedBuilder`를 새로 생성**하여 `.setDescription(replyText)`로 텍스트 내용을 설정합니다.
//     * `.setColor(0x5865F2)` 등으로 **왼쪽 바의 색상**을 지정할 수 있습니다. (원하는 16진수 색상 코드로 변경 가능)
//     * `.setTitle()`, `.setTimestamp()`, `.setFooter()` 등으로 Embed에 제목, 시간, 꼬리말 등을 추가할 수 있습니다 (선택 사항).
//     * 생성된 Embed 객체를 `replyEmbeds` 배열에 추가합니다.
//     * 최종적으로 `interaction.editReply()`를 호출할 때, **`content: ' '`** (빈 문자열 또는 공백)로 설정하고 **`embeds: replyEmbeds`**를 전달하여 Embed만 보이도록 합니다.
// 2.  **다른 명령어:** `/help` 명령어는 이미 Embed를 사용하고 있었고, `/avatar`, `/server`, `/call` 등 다른 명령어는 필요에 따라 Embed를 사용하도록 수정하거나 그대로 둘 수 있습니다.

// 이제 이 코드를 배포하면 `/chat` 명령어에 대한 AI의 답변이 일반 텍스트 대신 왼쪽에 색깔 줄이 있는 Embed 형태로 표시될 것입
