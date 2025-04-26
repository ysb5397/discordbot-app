// discord.js v14 이상 필요
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, InteractionType, Events, AttachmentBuilder } = require('discord.js'); // AttachmentBuilder 추가 (필요시)
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
                .setRequired(true)) // 텍스트 질문은 필수로 유지
        // *** 파일 첨부 옵션 추가 ***
        .addAttachmentOption(option =>
            option.setName('file') // 옵션 이름: file
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)), // 파일 첨부는 선택 사항
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
        // *** 첨부 파일 정보 가져오기 ***
        const attachment = interaction.options.getAttachment('file'); // 'file' 옵션으로 첨부된 파일 가져오기

        // Flowise API 요청 본문 기본 구조
        const requestBody = {
            question: userQuestion,
            overrideConfig: {
                sessionId: sessionId
            }
            // uploads 필드는 파일이 있을 때만 추가
        };

        // *** 파일이 첨부되었을 경우 uploads 필드 추가 ***
        if (attachment) {
            console.log(`Attachment found: ${attachment.name} (${attachment.contentType}, ${attachment.url})`);
            requestBody.uploads = [
                {
                    // Flowise API 스키마에 맞춰 데이터 구성 (URL 방식)
                    type: 'url', // 또는 'file'로 하고 data에 base64 인코딩 데이터 전달 가능
                    name: attachment.name, // 파일 이름
                    mime: attachment.contentType || 'application/octet-stream', // MIME 타입 (없으면 기본값)
                    data: attachment.url // 파일 접근 URL
                }
            ];
            // 만약 Flowise가 base64 인코딩된 데이터를 요구한다면:
            // 1. 파일을 다운로드 받아서
            // 2. Buffer로 읽은 후
            // 3. base64로 인코딩하여 `data` 필드에 넣고 `type`을 'file'로 설정해야 합니다.
            //    (이 과정은 코드가 더 복잡해지므로 여기서는 URL 방식만 예시로 듭니다.)
        }

        console.log(`[Session: ${sessionId}] Sending to Flowise:`, JSON.stringify(requestBody, null, 2)); // 요청 로그 (파일 정보 포함)

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

            // 응답 텍스트 추출 및 전송
            const replyText = flowiseResponse.text || '죄송합니다, AI로부터 답변을 받지 못했습니다.';
            // 파일 처리 결과에 대한 추가 정보가 있다면 여기에 포함시킬 수 있음 (Flowise 응답 구조 확인 필요)
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
            // 도움말에 파일 첨부 옵션 설명 추가
            .setDescription('명령어: /chat [질문] [file:첨부파일], /help, /avatar, /server, /call');
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

// --- 기존 메시지 기반 명령어 처리 (주석 처리 또는 제거 권장) ---
/*
client.on('messageCreate', async msg => {
    // ...
});
*/
// ```

// **주요 변경점:**

// 1.  **명령어 정의 수정:** `SlashCommandBuilder`를 사용하여 `/chat` 명령어에 `addAttachmentOption('file')`을 추가했습니다. 이제 사용자는 `/chat` 명령어 사용 시 파일을 선택적으로 첨부할 수 있습니다.
// 2.  **첨부 파일 처리:** `interactionCreate` 핸들러에서 `interaction.options.getAttachment('file')`을 사용하여 첨부된 파일 객체를 가져옵니다.
// 3.  **`uploads` 필드 추가:** 파일이 첨부된 경우, Flowise API 요청 본문(`requestBody`)에 Flowise API 스키마에 맞는 `uploads` 배열을 추가합니다. 여기서는 파일 URL, 이름, MIME 타입을 포함하는 객체를 넣었습니다 (`type: 'url'`).
// 4.  **도움말 업데이트:** `/help` 명령어의 설명에 파일 첨부 옵션(`[file:첨부파일]`)을 추가했습니다.

// **다음 단계:**

// 1.  이 수정된 `index.js` 코드를 Cloudtype에 **재배포**합니다. (명령어 정의가 변경되었으므로 등록 과정이 다시 실행됩니다.)
// 2.  Discord에서 `/chat` 명령어를 사용할 때, 질문 입력 필드 외에 **파일 첨부 옵션**이 나타나는지 확인합니다.
// 3.  파일(이미지, 텍스트 파일 등)을 첨부하고 질문과 함께 명령어를 실행해 보세요.
// 4.  Cloudtype **로그**를 확인하여 `Attachment found:` 로그와 함께 Flowise로 `uploads` 필드가 포함된 요청이 전송되는지 확인합니다.
// 5.  **Flowise 챗플로우 수정:** 이제 Discord 봇은 파일 정보를 보내주므로, **Flowise 챗플로우를 수정**하여 이 `uploads` 정보를 받아 처리하도록 만들어야 합니다. (예: 이미지 URL을 처리할 수 있는 멀티모달 모델 사용, URL에서 텍스트를 추출하는 도구 추가 등) Flowise 쪽 수정 없이는 봇이 파일 내용을 이해하지 못합니다.

// 이제 Discord 봇은 파일 정보를 Flowise로 전달할 준비가 되었습
