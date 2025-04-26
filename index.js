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

// discord.js v14 이상 필요
// 필요한 모듈 추가 (기존 코드에 이어서)
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, InteractionType, Events, ChannelType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
// ... (기존 require 및 환경 변수 로드) ...

// --- 슬래시 명령어 정의 (기존 commands 배열에 추가) ---
const commands = [
    // ... (기존 /chat, /help 등 명령어 정의) ...
    new SlashCommandBuilder()
        .setName('create_event')
        .setDescription('서버 이벤트를 생성합니다.')
        .addStringOption(option => // 이벤트 이름
            option.setName('name')
                .setDescription('이벤트의 이름을 입력하세요.')
                .setRequired(true))
        .addStringOption(option => // 이벤트 설명
            option.setName('description')
                .setDescription('이벤트 설명을 입력하세요.')
                .setRequired(true))
        .addStringOption(option => // 시작 시간 (예: 'YYYY-MM-DD HH:MM')
            option.setName('start_time')
                .setDescription("시작 시간 (예: '2025-05-10 20:00') - KST 기준")
                .setRequired(true))
        .addChannelOption(option => // 이벤트 채널 (음성 또는 스테이지)
            option.setName('channel')
                .setDescription('이벤트가 열릴 음성 또는 스테이지 채널')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice) // 채널 타입 제한
                .setRequired(true))
        // .addStringOption(option => // 종료 시간 (선택적)
        //     option.setName('end_time')
        //         .setDescription("종료 시간 (선택 사항, 예: '2025-05-10 22:00')")
        //         .setRequired(false))
        // .addStringOption(option => // 외부 위치 (선택적)
        //     option.setName('location')
        //         .setDescription("외부 이벤트 장소 (URL 또는 장소 이름)")
        //         .setRequired(false))
].map(command => command.toJSON());

// --- 명령어 등록 로직 ---
// ... (기존 등록 로직과 동일) ...

// --- 이벤트 핸들러 ---
// ... (ClientReady 핸들러는 동일) ...

// --- 슬래시 명령어 처리 핸들러 (기존 핸들러에 추가) ---
client.on(Events.InteractionCreate, async interaction => {
    // ... (기존 Interaction 수신 로그, 타입 확인 등) ...

    const { commandName } = interaction;
    console.log(`Processing interaction: /${commandName}`);

    // --- /chat 명령어 처리 ---
    if (commandName === 'chat') {
        // ... (기존 /chat 처리 로직) ...
    }
    // --- /create_event 명령어 처리 ---
    else if (commandName === 'create_event') {
        // 권한 확인 (선택적이지만 권장)
        if (!interaction.member.permissions.has('ManageEvents')) {
             return interaction.reply({ content: '이 명령어를 사용하려면 이벤트 관리 권한이 필요합니다.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true }); // 명령어 사용자에게만 진행 상황 표시

            // 옵션 값 가져오기
            const eventName = interaction.options.getString('name');
            const eventDescription = interaction.options.getString('description');
            const startTimeString = interaction.options.getString('start_time');
            const eventChannel = interaction.options.getChannel('channel');
            // const endTimeString = interaction.options.getString('end_time'); // 선택적 옵션
            // const location = interaction.options.getString('location'); // 선택적 옵션

            // 시작 시간 처리 (간단한 예시, 실제로는 더 엄격한 유효성 검사 및 시간대 처리 필요)
            let scheduledStartTime;
            try {
                // 입력된 시간을 KST(UTC+9)로 간주하고 Date 객체 생성 시도
                // new Date()는 로컬 시간대를 기준으로 하므로, UTC 기준으로 변환 후 KST 오프셋 적용 필요
                // 또는 dayjs 같은 라이브러리 사용 권장
                const dateParts = startTimeString.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})/);
                if (!dateParts) throw new Error('Invalid date format');
                // 주의: 이 방식은 서버의 로컬 시간대에 따라 다르게 동작할 수 있음.
                // 'YYYY-MM-DDTHH:mm:ss+09:00' 같은 ISO 8601 형식 사용 권장
                scheduledStartTime = new Date(parseInt(dateParts[1]), parseInt(dateParts[2]) - 1, parseInt(dateParts[3]), parseInt(dateParts[4]), parseInt(dateParts[5]));
                if (isNaN(scheduledStartTime.getTime())) throw new Error('Invalid date');
                // Discord API는 미래 시간만 받으므로 확인
                if (scheduledStartTime < new Date()) {
                    return interaction.editReply('오류: 이벤트 시작 시간은 현재 시간 이후여야 합니다.');
                }

            } catch (e) {
                console.error("Date parsing error:", e);
                return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요. (예: '2025-05-10 20:00')`);
            }

            // 종료 시간 처리 (선택적)
            // let scheduledEndTime = null;
            // if (endTimeString) { /* endTimeString 파싱 및 Date 객체 생성 */ }

            // 이벤트 생성 옵션 구성
            const eventOptions = {
                name: eventName,
                description: eventDescription,
                scheduledStartTime: scheduledStartTime,
                // scheduledEndTime: scheduledEndTime, // 필요시 추가
                privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, // 서버 멤버만
                entityType: GuildScheduledEventEntityType.Voice, // 우선 음성 채널로 가정
                channel: eventChannel.id // 채널 ID 전달
                // entityMetadata: location ? { location: location } : undefined, // 외부 위치 설정 시
            };

            // 채널 타입에 따라 entityType 변경
            if (eventChannel.type === ChannelType.GuildStageVoice) {
                eventOptions.entityType = GuildScheduledEventEntityType.StageInstance;
            }
            // 외부 위치 옵션이 있다면 entityType을 External로 변경 (채널 옵션과 동시 사용 불가)
            // if (location) {
            //     eventOptions.entityType = GuildScheduledEventEntityType.External;
            //     delete eventOptions.channel; // 외부 위치 사용 시 채널은 제거
            // }

            // 이벤트 생성 시도
            const createdEvent = await interaction.guild.scheduledEvents.create(eventOptions);

            console.log(`Event created: ${createdEvent.name} (ID: ${createdEvent.id})`);
            await interaction.editReply(`✅ 이벤트 "${createdEvent.name}"이(가) 성공적으로 생성되었습니다!`);

        } catch (error) {
            console.error('Error creating scheduled event:', error);
            await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다. 입력값이나 봇 권한을 확인해주세요.');
        }
    }
    // --- 다른 슬래시 명령어 처리 ---
    // ... (help, avatar, server, call 등) ...
});

// ... (나머지 코드) ...
// ```

// **주요 변경점 및 주의사항:**

// * **명령어 추가:** `/create_event` 명령어를 정의하고 필요한 옵션(이름, 설명, 시작 시간, 채널)을 추가했습니다.
// * **권한 확인:** 명령어 실행 시 사용자에게 '이벤트 관리' 권한이 있는지 확인하는 로직을 추가했습니다 (선택 사항).
// * **옵션 파싱:** `interaction.options`를 사용하여 사용자가 입력한 값을 가져옵니다.
// * **시간 처리:** 사용자가 입력한 시간 문자열(`start_time`)을 JavaScript `Date` 객체로 변환하는 간단한 예시를 넣었습니다. **실제 서비스에서는 시간대 처리와 유효성 검사를 더 정교하게 해야 합니다.** (`dayjs` 같은 라이브러리 사용 추천)
// * **채널 타입:** 음성 채널과 스테이지 채널만 선택 가능하도록 옵션을 제한했습니다.
// * **`guild.scheduledEvents.create()`:** 이 메소드를 사용하여 이벤트를 생성합니다.
// * **오류 처리:** 이벤트 생성 중 발생할 수 있는 오류를 `try...catch`로 처리합니다.

// 이 코드를 적용하고 필요한 권한을 부여하면, Discord 사용자는 `/create_event` 명령어를 통해 봇에게 이벤트를 생성하도록 지시할 수 있습니다. AI가 자연어 요청을 해석하여 이 명령어를 실행하도록 만들려면 Flowise 쪽에 추가적인 설정(자연어 처리, 도구 호출 등)이 필요합

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
